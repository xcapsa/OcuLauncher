'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ocu', {
  getState: () => ipcRenderer.invoke('get-state'),
  silentLogin: () => ipcRenderer.invoke('silent-login'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  setLocalUsername: (name) => ipcRenderer.invoke('set-local-username', name),
  getAutoRam: () => ipcRenderer.invoke('get-auto-ram'),
  pingServer: () => ipcRenderer.invoke('ping-server'),
  play: () => ipcRenderer.invoke('play'),
  openGameFolder: () => ipcRenderer.invoke('open-game-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  applyUpdate: () => ipcRenderer.invoke('apply-update'),
  openPasswordReset: () => ipcRenderer.invoke('open-password-reset'),
  onStatus: (cb) => ipcRenderer.on('status', (_ev, data) => cb(data)),
  onGameState: (cb) => ipcRenderer.on('game-state', (_ev, state) => cb(state)),
  onUpdate: (cb) => ipcRenderer.on('update', (_ev, data) => cb(data)),
});
