const { contextBridge, ipcRenderer } = require('electron');

try {
  const style = document.createElement('style');
  style.textContent =
    'html{-webkit-font-smoothing:antialiased;background:#0d0d0d}';
  const attach = () => {
    const html = document.documentElement;
    if (!html || html.contains(style)) return;
    html.appendChild(style);
  };
  if (document.documentElement) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
} catch (e) { }

contextBridge.exposeInMainWorld('centinela', {
  selectSite: (index) => ipcRenderer.send('navigate', index),
  getCurrent: () => ipcRenderer.invoke('get-current'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getNews: () => ipcRenderer.invoke('news:get'),
  onNews: (cb) => ipcRenderer.on('news-update', (_e, items) => cb(items))
});
