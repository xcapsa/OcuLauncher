'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

/** Scarica un URL su file, con progresso e verifica sha1 opzionale. */
async function downloadFile(url, dest, { sha1 = null, onProgress = null, timeout = 120000 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} scaricando ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let done = 0;
    const hash = crypto.createHash('sha1');
    const counter = new (require('stream').Transform)({
      transform(chunk, _enc, cb) {
        done += chunk.length;
        hash.update(chunk);
        if (onProgress && total) onProgress(done, total);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
    const digest = hash.digest('hex');
    if (sha1 && digest !== sha1.toLowerCase()) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Checksum errato per ${path.basename(dest)} (atteso ${sha1}, ottenuto ${digest})`);
    }
    fs.renameSync(tmp, dest);
  } finally {
    clearTimeout(timer);
    fs.rmSync(tmp, { force: true });
  }
}

/** sha1 di un file su disco (stream, senza caricarlo in RAM). */
function fileSha1(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** GET JSON con timeout. */
async function fetchJson(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} da ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { downloadFile, fileSha1, fetchJson };
