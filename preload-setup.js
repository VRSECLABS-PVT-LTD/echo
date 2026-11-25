const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
contextBridge.exposeInMainWorld('setup', {
  info: call('setup:info'),
  check: call('setup:check'),
  openDownload: call('setup:openDownload'),
  openSite: call('setup:openSite'),
  copy: call('setup:copy'),
  pull: call('setup:pull'),
  finish: call('setup:finish'),
  close: call('setup:close'),
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, p) => cb(p)),
});
