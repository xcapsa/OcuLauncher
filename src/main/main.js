'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { Settings } = require('./settings');
const { Account } = require('./auth');
const { getManifest, launchGame, computeAutoRam } = require('./launcher');
const { pingServer } = require('./serverping');
const { isValidUsername, localAuthorization } = require('./localauth');
const os = require('os');

// Edizione del launcher: "microsoft" (pubblica) o "staff" (accesso locale).
// Impostata a build-time scrivendo src/edition.json.
let EDITION = 'microsoft';
try { EDITION = (require('../edition.json').edition || 'microsoft'); } catch (_) {}
const IS_STAFF = EDITION === 'staff';

// Piccola cache in memoria per non riscaricare il manifest a ogni chiamata IPC.
let manifestCache = null;
let manifestCacheAt = 0;
async function getManifestCached() {
  if (manifestCache && Date.now() - manifestCacheAt < 60000) return manifestCache;
  manifestCache = await getManifest(gameDir());
  manifestCacheAt = Date.now();
  return manifestCache;
}

let win = null;
let settings = null;
let account = null;
let gameRunning = false;

// Aggiornamento del launcher in attesa, mostrato come bottone nell'interfaccia.
// kind: 'install'  → un clic riavvia e installa (Windows, edizione pubblica)
// kind: 'download' → un clic apre il download dell'installer nuovo (Mac e Staff)
let pendingUpdate = null;

// Cartella dati separata per edizione (Staff non condivide identità/mondo con la pubblica).
const DATA_FOLDER = IS_STAFF ? 'OcuLauncher-Staff' : 'OcuLauncher';
const gameDir = () => path.join(app.getPath('appData'), DATA_FOLDER, 'minecraft');

/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1020,
    height: 660,
    minWidth: 860,
    minHeight: 560,
    title: IS_STAFF ? 'OcuLauncher Staff — Accesso locale' : 'OcuLauncher — Oculandia VR',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    backgroundColor: '#0b1220',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

let lastStatusAt = 0;
function sendStatus(text, progress = null) {
  // Piccolo throttle: i progressi arrivano a raffica, non serve inondare l'interfaccia.
  const now = Date.now();
  if (progress != null && now - lastStatusAt < 80) return;
  lastStatusAt = now;
  if (win && !win.isDestroyed()) win.webContents.send('status', { text, progress });
}

function sendGameState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('game-state', state);
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('get-state', async () => {
    const { manifest, source } = await getManifestCached();
    return {
      profile: account.profile,
      settings: settings.get(),
      manifest: {
        minecraft: manifest.minecraft,
        fabricLoader: manifest.fabricLoader,
        news: manifest.news || '',
        server: manifest.server,
        mods: manifest.mods.map((m) => ({ name: m.name, tags: m.tags || [] })),
        optionalMods: (manifest.optionalMods || []).map((m) => ({
          slug: m.slug, name: m.name, desc: m.desc, category: m.category,
          heavy: !!m.heavy, type: m.type, requires: m.requires || [],
          sizeMB: Math.round(m.files.reduce((a, f) => a + (f.size || 0), 0) / 1e6),
        })),
        source,
      },
      systemRamMB: Math.round(os.totalmem() / (1024 * 1024)),
      autoRamMB: computeAutoRam(manifest, settings.get().extraMods),
      version: app.getVersion(),
      edition: EDITION,
      update: pendingUpdate,
      links: { website: config.WEBSITE_URL, map: config.MAP_URL, rules: config.RULES_URL },
    };
  });

  // Aggiornamento launcher: installa subito (Windows pubblica) o apre il download.
  ipcMain.handle('apply-update', () => {
    if (!pendingUpdate) return { ok: false, error: 'Nessun aggiornamento in attesa.' };
    if (pendingUpdate.kind === 'install') {
      try {
        require('electron-updater').autoUpdater.quitAndInstall(true, true);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
    if (pendingUpdate.url) shell.openExternal(pendingUpdate.url);
    return { ok: true };
  });

  // "Password del server dimenticata?": apre la chat del bot Telegram.
  // Il bot risponde già a "reset NomeMinecraft" scritto in chat privata.
  ipcMain.handle('open-password-reset', () => {
    shell.openExternal(config.TELEGRAM_BOT_URL);
    return true;
  });

  // Edizione Staff: imposta/valida il nome utente locale (nessun account Microsoft).
  ipcMain.handle('set-local-username', (_ev, name) => {
    const trimmed = (name || '').trim();
    if (!isValidUsername(trimmed)) {
      return { ok: false, error: 'Nome non valido: 3-16 caratteri tra lettere, numeri e underscore.' };
    }
    settings.set({ localUsername: trimmed });
    return { ok: true, name: trimmed };
  });

  ipcMain.handle('silent-login', async () => {
    if (IS_STAFF) return null; // edizione Staff: nessun login Microsoft
    // Timeout: se la rete è lenta non teniamo l'interfaccia in "Accesso in corso" per sempre.
    return Promise.race([
      account.trySilentLogin(),
      new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
  });

  ipcMain.handle('get-auto-ram', async () => {
    const { manifest } = await getManifestCached();
    return computeAutoRam(manifest, settings.get().extraMods);
  });

  ipcMain.handle('login', async () => {
    try {
      return { ok: true, profile: await account.interactiveLogin() };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('logout', () => { account.logout(); return true; });

  ipcMain.handle('set-settings', (_ev, patch) => settings.set(patch));

  ipcMain.handle('ping-server', async () => {
    const { manifest } = await getManifestCached();
    const srv = manifest.server || {};
    if (!srv.host) return { online: false };
    return pingServer(srv.host, srv.port || 25565);
  });

  ipcMain.handle('open-game-folder', () => shell.openPath(gameDir()));
  ipcMain.handle('open-custom-mods-folder', () => {
    const dir = path.join(gameDir(), 'mods-custom');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return shell.openPath(dir);
  });
  ipcMain.handle('open-external', (_ev, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('play', async () => {
    if (gameRunning) return { ok: false, error: 'Il gioco è già in esecuzione.' };
    // Autorizzazione: Microsoft (pubblica) oppure locale offline (Staff).
    let authorization;
    if (IS_STAFF) {
      const name = (settings.get().localUsername || '').trim();
      if (!isValidUsername(name)) return { ok: false, error: 'Inserisci prima un nome utente valido.' };
      try { authorization = localAuthorization(name); }
      catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    } else {
      if (!account.profile) return { ok: false, error: 'Fai prima il login.' };
      authorization = account.mclcAuth();
    }
    gameRunning = true;
    sendGameState('preparing');
    try {
      // Al momento del GIOCA si riprova sempre il manifest fresco.
      manifestCache = null;
      const { manifest, source } = await getManifestCached();
      if (source !== 'remote') sendStatus('⚠ Server aggiornamenti non raggiungibile: uso l\'ultima configurazione nota.');
      const launcher = await launchGame({
        gameDir: gameDir(),
        manifest,
        authorization,
        settings: settings.get(),
        onStatus: sendStatus,
      });

      let started = false;
      launcher.on('progress', (e) => {
        // e = { type, task, total }
        if (e && e.total) sendStatus(`Scarico ${e.type}… (${e.task}/${e.total})`, e.task / e.total);
      });
      launcher.on('data', () => {
        if (!started) {
          started = true;
          sendStatus('Minecraft avviato. Buon divertimento su Oculandia!');
          sendGameState('running');
          if (!settings.get().keepOpen && win && !win.isDestroyed()) win.minimize();
        }
      });
      launcher.on('debug', (m) => console.log('[MCLC]', m));
      launcher.on('close', (code) => {
        gameRunning = false;
        sendStatus(code === 0 || code === null ? 'Partita terminata.' : `Minecraft si è chiuso (codice ${code}).`);
        sendGameState('idle');
        if (win && !win.isDestroyed()) {
          win.restore();
          win.focus();
        }
      });
      return { ok: true };
    } catch (e) {
      gameRunning = false;
      sendGameState('idle');
      const msg = String(e && e.message || e);
      sendStatus('Errore: ' + msg);
      return { ok: false, error: msg };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Aggiornamento del launcher (GitHub Releases)                        */
/* ------------------------------------------------------------------ */

function sendUpdate(update) {
  pendingUpdate = update;
  if (win && !win.isDestroyed()) win.webContents.send('update', update);
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  // Windows, edizione pubblica: aggiornamento integrato con electron-updater.
  // Scarica in background e mostra il bottone "Riavvia e aggiorna" quando è pronto.
  if (process.platform === 'win32' && !IS_STAFF) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.on('update-downloaded', (info) => {
        sendUpdate({ kind: 'install', version: info.version });
      });
      autoUpdater.on('error', (e) => console.warn('Auto-update:', e && e.message));
      autoUpdater.checkForUpdates().catch((e) => console.warn('Auto-update:', e.message));
      return;
    } catch (e) {
      console.warn('Auto-update non disponibile:', e.message);
    }
  }

  // Mac (app senza firma Apple: l'auto-install non è permesso) ed edizione
  // Staff (le release staff sono pre-release separate): si controlla a mano
  // e il bottone apre il download dell'installer giusto per questa macchina.
  const { findUpdate } = require('./updater');
  findUpdate({ repo: config.GITHUB_REPO, staff: IS_STAFF, currentVersion: app.getVersion() })
    .then((u) => {
      if (u) sendUpdate({ kind: 'download', version: u.version, url: u.url });
    })
    .catch((e) => console.warn('Controllo aggiornamenti:', e.message));
}

/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    const userData = path.join(app.getPath('appData'), DATA_FOLDER);
    settings = new Settings(userData);
    account = new Account(userData);
    registerIpc();
    createWindow();
    setupAutoUpdate();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || !gameRunning) app.quit();
  });
}
