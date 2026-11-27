const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('config', {
  // Lee la configuración guardada.
  get: () => ipcRenderer.invoke('settings:get'),
  // Guarda un parche de la configuración (devuelve { ok, config }).
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  // Abre la carpeta de datos de METATRON.
  abrirCarpeta: () => ipcRenderer.send('open-data-dir'),
  // Cierra la pestaña de configuración.
  cerrar: () => ipcRenderer.send('tool:close')
});