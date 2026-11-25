const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  ask: (text) => ipcRenderer.invoke('ask', text),
  clear: () => ipcRenderer.invoke('clear'),
  status: () => ipcRenderer.invoke('status'),
  openSettings: (section) => ipcRenderer.send('open-settings', section),
  hide: () => ipcRenderer.send('hide'),
  resize: (h) => ipcRenderer.send('resize', h),
  onFocus: (cb) => ipcRenderer.on('focus', (_e, info) => cb(info)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onDelta: (cb) => ipcRenderer.on('delta', (_e, t) => cb(t)),
  onReset: (cb) => ipcRenderer.on('reset', () => cb()),
  onSound: (cb) => ipcRenderer.on('play-sound', (_e, kind) => cb(kind)),
});
