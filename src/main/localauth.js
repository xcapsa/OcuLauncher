'use strict';
// Accesso locale (offline) per l'edizione "Staff": nessun account Microsoft.
// Il giocatore sceglie un nome utente; il server è in offline-mode + EasyAuth,
// quindi il nome va comunque protetto in gioco con /register e /login.
// Questo modulo NON verifica l'identità: la sicurezza reale la dà EasyAuth
// (password per nome) + i comandi da op. Perciò questa edizione va tenuta
// riservata allo staff.
const crypto = require('crypto');

/** Validazione nome utente stile Minecraft: 3-16 caratteri, lettere/numeri/underscore. */
function isValidUsername(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name);
}

/**
 * UUID offline deterministico, identico a quello che il server Minecraft
 * assegna in offline-mode: UUID v3 dai byte di "OfflinePlayer:<nome>".
 * Così il giocatore mantiene sempre lo stesso UUID (claim, homes, EasyAuth).
 */
function offlineUUID(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // versione 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Oggetto di autorizzazione nel formato richiesto da minecraft-launcher-core
 * per un avvio offline. I token sono fittizi: su un server offline non servono.
 */
function localAuthorization(name) {
  if (!isValidUsername(name)) {
    throw new Error('Nome utente non valido: usa 3-16 caratteri tra lettere, numeri e underscore.');
  }
  return {
    access_token: '0',
    client_token: crypto.randomBytes(16).toString('hex'),
    uuid: offlineUUID(name),
    name,
    user_properties: '{}',
    meta: { type: 'mojang', demo: false },
  };
}

module.exports = { isValidUsername, offlineUUID, localAuthorization };
