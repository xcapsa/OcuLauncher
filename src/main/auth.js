'use strict';
const fs = require('fs');
const path = require('path');
const { Auth } = require('msmc');

/**
 * Gestione account Microsoft con persistenza del refresh token,
 * così il login interattivo serve solo la prima volta.
 */
class Account {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'account.json');
    this.token = null;      // token Minecraft (msmc)
    this.profile = null;    // { name, id }
  }

  _readSaved() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return null; }
  }

  _save(refreshToken, profile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ refreshToken, profile }, null, 2));
  }

  /** Prova il login silenzioso col refresh token salvato. */
  async trySilentLogin() {
    const saved = this._readSaved();
    if (!saved || !saved.refreshToken) return null;
    try {
      const authManager = new Auth('select_account');
      const xbox = await authManager.refresh(saved.refreshToken);
      const token = await xbox.getMinecraft();
      this.token = token;
      this.profile = { name: token.profile.name, id: token.profile.id };
      this._save(xbox.save(), this.profile);
      return this.profile;
    } catch (e) {
      console.warn('Login silenzioso fallito:', e.message || e);
      return null;
    }
  }

  /** Login interattivo: apre la finestra Microsoft. */
  async interactiveLogin() {
    const authManager = new Auth('select_account');
    const xbox = await authManager.launch('electron');
    const token = await xbox.getMinecraft();
    this.token = token;
    this.profile = { name: token.profile.name, id: token.profile.id };
    this._save(xbox.save(), this.profile);
    return this.profile;
  }

  /** Autorizzazione nel formato richiesto da minecraft-launcher-core. */
  mclcAuth() {
    if (!this.token) throw new Error('Non hai ancora fatto il login.');
    return this.token.mclc();
  }

  logout() {
    this.token = null;
    this.profile = null;
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { Account };
