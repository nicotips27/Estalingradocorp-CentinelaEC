const { contextBridge, ipcRenderer } = require('electron');

try {
  const style = document.createElement('style');
  style.textContent =
    'html{-webkit-font-smoothing:antialiased;background:#07090c}';
  const attach = () => {
    const html = document.documentElement;
    if (!html || html.contains(style)) return;
    html.appendChild(style);
  };
  if (document.documentElement) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
} catch (e) { }

contextBridge.exposeInMainWorld('centinela', {
  // Navegación
  selectSite: (index) => ipcRenderer.send('navigate', index),
  getCurrent: () => ipcRenderer.invoke('get-current'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Pestañas
  getTabs: () => ipcRenderer.invoke('tabs:get'),
  onTabs: (cb) => ipcRenderer.on('tabs-update', (_e, tabs) => cb(tabs)),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  newTab: () => ipcRenderer.send('tabs:new'),
  cycleTab: (dir) => ipcRenderer.send('tabs:cycle', dir),

  // Barra de direcciones
  go: (url) => ipcRenderer.send('nav:go', url),
  focusUrl: () => ipcRenderer.send('nav:focus-url'),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  reloadBypass: () => ipcRenderer.send('nav:reload-bypass'),
  home: () => ipcRenderer.send('nav:home'),

  // Herramientas
  openNotes: () => ipcRenderer.send('open-notes'),
  capture: () => ipcRenderer.invoke('app:capture'),
  setChromeHeight: (h) => ipcRenderer.send('chrome:height', h),
  setEncryption: (on) => ipcRenderer.send('encrypt:set', on),

  // Noticias y avisos
  getNews: () => ipcRenderer.invoke('news:get'),
  onNews: (cb) => ipcRenderer.on('news-update', (_e, items) => cb(items)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
  onFocusUrl: (cb) => ipcRenderer.on('focus-url', () => cb()),
  onEncryption: (cb) => ipcRenderer.on('encrypt:set', (_e, on) => cb(on))
});
