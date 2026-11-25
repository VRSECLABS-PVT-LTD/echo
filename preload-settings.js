const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
contextBridge.exposeInMainWorld('sapi', {
  getConfig: call('cfg:get'),
  setConfig: call('cfg:set'),
  models: call('models:list'),
  netlog: call('netlog:get'),
  clearNetlog: call('netlog:clear'),
  openData: call('data:open'),
  wipe: call('data:wipe'),
  openSite: call('open:site'),
  openReport: call('open:report'),
  rerunSetup: call('setup:rerun'),
  list: call('int:list'),
  importText: (name, text) => ipcRenderer.invoke('int:importText', { name, text }),
  importFile: (name) => ipcRenderer.invoke('int:importFile', { name }),
  update: call('int:update'),
  remove: call('int:remove'),
  onGoto: (cb) => ipcRenderer.on('goto', (_e, s) => cb(s)),
});
