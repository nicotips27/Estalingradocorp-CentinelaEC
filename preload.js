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

contextBridge.exposeInMainWorld('metatron', {
  // Navegación
  selectSite: (index) => ipcRenderer.send('navigate', index),
  getCurrent: () => ipcRenderer.invoke('get-current'),
  // Abre cualquier URL en una pestaña INTERNA del navegador de METATRON.
  openTab: (url) => ipcRenderer.send('tabs:open-url', url),

  // Pestañas
  getTabs: () => ipcRenderer.invoke('tabs:get'),
  onTabs: (cb) => ipcRenderer.on('tabs-update', (_e, tabs) => cb(tabs)),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  newTab: () => ipcRenderer.send('tabs:new'),
  reopenTab: () => ipcRenderer.send('tabs:reopen'),
  cycleTab: (dir) => ipcRenderer.send('tabs:cycle', dir),

  // Barra de direcciones
  go: (url) => ipcRenderer.send('nav:go', url),
  focusUrl: () => ipcRenderer.send('nav:focus-url'),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  reloadBypass: () => ipcRenderer.send('nav:reload-bypass'),
  home: () => ipcRenderer.send('nav:home'),

  // Cajón OSINT
  getPages: () => ipcRenderer.invoke('pages:get'),
  onPages: (cb) => ipcRenderer.on('pages-update', (_e, pages) => cb(pages)),
  addPage: (name, url, desc) => ipcRenderer.invoke('pages:add', { name, url, desc }),
  removePage: (id) => ipcRenderer.invoke('pages:remove', id),
  // Agrega la pestaña actual al cajón OSINT (Ctrl+D / botón de la barra).
  addBookmark: () => ipcRenderer.send('bookmark:add'),
  // Abre la carpeta de descargas de METATRON.
  openDownloads: () => ipcRenderer.send('open-downloads'),
  // Descarga en curso y progreso de carga de la pestaña.
  onDownloadStatus: (cb) => ipcRenderer.on('download-status', (_e, d) => cb(d)),
  onLoadProgress: (cb) => ipcRenderer.on('load-progress', (_e, p) => cb(p)),
  // Buscar dentro de la página (Ctrl+F)
  onFindOpen: (cb) => ipcRenderer.on('find:open', () => cb()),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r)),
  findQuery: (text) => ipcRenderer.send('find:query', { text }),
  findStep: (dir) => ipcRenderer.send('find:step', dir),
  findClose: () => ipcRenderer.send('find:close'),
  // background = true (Ctrl+clic o clic medio) abre la página sin cambiar de pestaña.
  openPage: (id, background) => ipcRenderer.send('pages:open', id, !!background),
  onDrawerToggle: (cb) => ipcRenderer.on('drawer:toggle', (_e, force) => cb(force)),

  // Herramientas
  openNotes: () => ipcRenderer.send('open-notes'),
  openHistory: () => ipcRenderer.send('open-history'),
  openSettings: () => ipcRenderer.send('settings:open'),
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
