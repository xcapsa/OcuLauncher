'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const config = require('./config');
const { Settings } = require('./settings');
const { Account } = require('./auth');
const { getManifest, launchGame, computeAutoRam } = require('./launcher');
const { pingServer } = require('./serverping');
const os = require('os');

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

const gameDir = () => path.join(app.getPath('appData'), 'OcuLauncher', 'minecraft');

/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1020,
    height: 660,
    minWidth: 860,
    minHeight: 560,
    title: 'OcuLauncher — Oculandia VR',
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
      links: { website: config.WEBSITE_URL, map: config.MAP_URL, rules: config.RULES_URL },
    };
  });

  ipcMain.handle('silent-login', async () => {
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
  ipcMain.handle('open-external', (_ev, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('play', async () => {
    if (gameRunning) return { ok: false, error: 'Il gioco è già in esecuzione.' };
    if (!account.profile) return { ok: false, error: 'Fai prima il login.' };
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
        authorization: account.mclcAuth(),
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
/* Auto-update del launcher (GitHub Releases)                          */
/* ------------------------------------------------------------------ */

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', async (info) => {
      if (!win || win.isDestroyed()) return;
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Riavvia e aggiorna', 'Più tardi'],
        title: 'Aggiornamento OcuLauncher',
        message: `È pronta la versione ${info.version} di OcuLauncher. Vuoi installarla ora?`,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdates().catch((e) => console.warn('Auto-update:', e.message));
  } catch (e) {
    console.warn('Auto-update non disponibile:', e.message);
  }
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
    const userData = path.join(app.getPath('appData'), 'OcuLauncher');
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
