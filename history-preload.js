const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historial', {
  // Lista las visitas (de la más nueva a la más vieja), con filtro opcional.
  get: (filtro) => ipcRenderer.invoke('history:get', filtro || ''),
  // Borra una entrada concreta o todo el historial.
  remove: (id) => ipcRenderer.invoke('history:remove', id),
  clear: () => ipcRenderer.invoke('history:clear'),
  // Abre una visita: en la pestaña actual o en una nueva.
  open: (url, nueva) => ipcRenderer.send('history:open', { url: url, nueva: !!nueva }),
  // Cierra la pestaña del historial.
  cerrar: () => ipcRenderer.send('tool:close')
});