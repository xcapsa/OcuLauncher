'use strict';
const net = require('net');

/** Codifica un VarInt (protocollo Minecraft). */
function writeVarInt(value) {
  const bytes = [];
  do {
    let temp = value & 0x7f;
    value >>>= 7;
    if (value !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buffer.length) return null; // dati incompleti
    const byte = buffer[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error('VarInt troppo lungo');
  }
  return { value: result, offset: pos };
}

function packet(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

/**
 * Server List Ping: ritorna { online, players, motd, latencyMs } oppure { online: false }.
 */
function pingServer(host, port = 25565, timeout = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port, timeout });
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const payload = Buffer.concat([
        writeVarInt(770),               // protocol version (1.21.5); per lo status va bene qualsiasi
        writeVarInt(hostBuf.length), hostBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1),                 // next state: status
      ]);
      socket.write(packet(0x00, payload)); // handshake
      socket.write(packet(0x00, Buffer.alloc(0))); // status request
    });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarInt(buf, 0);
        if (!len) return;
        if (buf.length < len.offset + len.value) return; // pacchetto incompleto
        const id = readVarInt(buf, len.offset);
        const strLen = readVarInt(buf, id.offset);
        const jsonStart = strLen.offset;
        const json = buf.slice(jsonStart, jsonStart + strLen.value).toString('utf8');
        const status = JSON.parse(json);
        const motd = typeof status.description === 'string'
          ? status.description
          : (status.description && (status.description.text ||
              (status.description.extra || []).map((e) => e.text || '').join(''))) || '';
        finish({
          online: true,
          latencyMs: Date.now() - started,
          players: status.players ? { online: status.players.online, max: status.players.max } : null,
          motd: motd.replace(/§./g, ''),
          version: status.version ? status.version.name : '',
        });
      } catch (e) {
        finish({ online: false, error: e.message });
      }
    });

    socket.on('timeout', () => finish({ online: false, error: 'timeout' }));
    socket.on('error', (e) => finish({ online: false, error: e.message }));
  });
}

module.exports = { pingServer };
