'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ramAuto: true,      // gestione automatica della memoria (in base alla RAM del PC)
  ramMB: 4096,        // memoria massima per il gioco (usata solo se ramAuto = false)
  vrMode: false,      // se true installa anche le mod taggate "vr" (Vivecraft)
  keepOpen: false,    // se true il launcher resta visibile mentre giochi
  autoJoin: true,     // entra direttamente nel server Oculandia
  extraMods: [],      // slug delle mod opzionali "esperienza immersiva" scelte
};

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...DEFAULTS, ...raw };
    } catch (_) { /* primo avvio o file corrotto: si usano i default */ }
  }

  get() { return { ...this.data }; }

  set(patch) {
    this.data = { ...this.data, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { console.error('Impossibile salvare le impostazioni:', e); }
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
