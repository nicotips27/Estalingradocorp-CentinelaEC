const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anotador', {
  load: () => ipcRenderer.invoke('notes:load'),
  save: (state) => ipcRenderer.invoke('notes:save', state),
  saveSync: (state) => ipcRenderer.sendSync('notes:save-sync', state),
  exportNote: (payload) => ipcRenderer.invoke('notes:export', payload),
  openFolder: () => ipcRenderer.send('notes:open-folder'),
  close: () => ipcRenderer.send('notes:close'),
  capture: () => ipcRenderer.invoke('notes:capture')
});
