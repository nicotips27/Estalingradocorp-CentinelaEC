const { app, BrowserWindow, WebContentsView, session, shell, Menu, ipcMain, dialog,
        desktopCapturer, screen, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initAdblock } = require('./adblock');

// Identidad de Windows: hace que las notificaciones (capturas) salgan como METATRON.
app.setAppUserModelId('com.metatron.beta');

// User-Agent de Chrome real: evita que Cloudflare/sitios bloqueen a Electron.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SITES = [
  { name: 'EC Terminal Data',  url: 'https://nicotips27.github.io/Estalingrado-corp-Terminal-data/', shortcut: 'CmdOrCtrl+1', img: 'logo.jpg',               desc: 'Mercados, divisas, materias primas.' },
  { name: 'EC NEWS',            url: 'https://nicotips27.github.io/ECnews/',                      shortcut: 'CmdOrCtrl+2', img: 'img-ecnews.jpg',         desc: 'Prensa y agencias globales.' },
  { name: 'EC Send Pro',       url: 'https://estalingradocorp.github.io/ECsendpro/',            shortcut: 'CmdOrCtrl+3', img: 'img-ecsendpro.png',      desc: 'Intercambio y envíos Estalingrado Corp.' },
  { name: 'Osiris AI',         url: 'https://osirisai.live/',                        shortcut: 'CmdOrCtrl+4', img: 'img-osiris.png',         desc: 'Inteligencia y análisis en tiempo real.' },
  { name: 'OpenGrid Works',    url: 'https://opengridworks.com/power-plants', shortcut: 'CmdOrCtrl+5', img: 'img-opengrid.webp',      desc: 'Centrales eléctricas en tiempo real.' },
  { name: 'Provenance',        url: 'https://provenance-online.com/app?lat=5.6961&lon=-52.32892&z=1.74&layers=&base=satellite', shortcut: 'CmdOrCtrl+6', img: 'img-warwatch.png', desc: 'Mapa satelital de procedencia.' },
  { name: 'Radio Garden',      url: 'https://radio.garden/',                                   shortcut: 'CmdOrCtrl+7', img: 'img-radiogarden.png',    desc: 'Estaciones de radio de todo el mundo.' },
  { name: 'Famelack',          url: 'https://famelack.com/',                                    shortcut: 'CmdOrCtrl+8', img: 'img-famelack.png',       desc: 'Contenido y comunidad Famelack.' },
  { name: 'Drive & Listen',    url: 'https://driveandlisten.app/',                               shortcut: 'CmdOrCtrl+9', img: 'img-driveandlisten.png', desc: 'Recorridos virtuales con radio local.' }
];

// Página de inicio del navegador: se abre por defecto al arrancar METATRON.
const HOME_PAGE = {
  id: 'inicio',
  name: 'Estalingrado Corp',
  url: 'https://estalingradocorp.com.ar/',
  img: 'logo.jpg',
  desc: 'Portal de Estalingrado Corp.',
  builtin: true
};

const SPLASH_MIN_MS = 1800;
let mainWindow = null;
let splashWindow = null;
let notesView = null;      // vista del anotador (se usa como pestaña de herramienta)

// ── Navegador con pestañas ──────────────────────────────────────────────────
// Cada plataforma se abre como una pestaña dentro de la misma ventana.
// Las vistas se desenganchan al cambiar de pestaña (conservan su estado) y
// solo la pestaña activa queda visible bajo la barra del navegador.
let chromeHeight = 78;    // alto real de la barra (lo informa el renderizador)
let tabs = [];            // { id, kind:'site'|'tool', tool, siteIndex, title, url, view, loading }
let activeTabId = null;
let tabSeq = 0;
let encryptionOn = false;

function getSiteOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function findSiteIndex(url) {
  const origin = getSiteOrigin(url);
  if (!origin) return -1;
  return SITES.findIndex(s => getSiteOrigin(s.url) === origin);
}

// Normaliza lo que se escribe en la barra de direcciones.
// Devuelve null si no es una URL http/https válida.
function normalizeWebUrl(raw) {
  let input = String(raw || '').trim();
  if (!input || /^metatron:/i.test(input)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = 'https://' + input;
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (e) { return null; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// ── Teleprompter de noticias de última hora ────────────────────────────────
const NEWS_FEEDS = [
  { name: 'Google News', url: 'https://news.google.com/rss?hl=es-419&gl=US&ceid=US:es-419' },
  { name: 'BBC Mundo',  url: 'https://feeds.bbci.co.uk/mundo/rss.xml' },
  { name: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'El País',    url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'NBC News',   url: 'https://feeds.nbcnews.com/nbcnews/public/world' },
  { name: 'The Verge',  url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' }
];

const NEWS_REFRESH_MS = 10 * 60 * 1000;
const NEWS_MAX_ITEMS = 24;
const NEWS_MAX_PER_FEED = 5;

const URGENT_WORDS = [
  'urgente', 'breaking news', 'última hora', 'ultima hora', 'alerta máxima', 'alerta maxima',
  'estado de emergencia', 'toque de queda', 'evacuación', 'evacuacion', 'evacúan', 'evacuan',
  'explosión', 'explosion', 'atentado', 'terremoto', 'earthquake', 'tsunami', 'tiroteo',
  'masacre', 'muertos', 'víctimas', 'victimas', 'bombardeo'
];

let newsItems = [];
let newsTimer = null;

function decodeEntities(text) {
  const amp = String.fromCharCode(38);
  const lt = String.fromCharCode(60);
  const gt = String.fromCharCode(62);
  const quot = String.fromCharCode(34);
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(new RegExp(amp + 'lt;', 'gi'), lt)
    .replace(new RegExp(amp + 'gt;', 'gi'), gt)
    .replace(new RegExp(amp + 'quot;', 'gi'), quot)
    .replace(new RegExp(amp + 'apos;', 'gi'), "'")
    .replace(new RegExp(amp + 'nbsp;', 'gi'), ' ')
    .replace(new RegExp(amp + 'amp;', 'gi'), amp)
    .replace(/\s+/g, ' ')
    .trim();
}

function feedTag(chunk, tag) {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = chunk.match(re);
  return m ? decodeEntities(m[1]) : '';
}

function parseFeed(xml, feed) {
  const chunks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const parsed = [];
  for (const chunk of chunks) {
    const rawTitle = feedTag(chunk, 'title');
    if (!rawTitle) continue;
    let link = feedTag(chunk, 'link');
    if (!link) {
      const m = chunk.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decodeEntities(m[1]) : '';
    }
    const source = feedTag(chunk, 'source') || feed.name;
    const title = source && rawTitle.endsWith(' - ' + source) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const pub = feedTag(chunk, 'pubDate') || feedTag(chunk, 'published') || feedTag(chunk, 'updated');
    const ts = pub ? Date.parse(pub) : NaN;
    parsed.push({
      title,
      source,
      link,
      ts: Number.isFinite(ts) ? ts : 0,
      urgent: URGENT_WORDS.some(w => title.toLowerCase().includes(w))
    });
  }
  return parsed;
}

function fetchText(url, redirects = 0) {
  return new Promise(resolve => {
    if (redirects > 4) return resolve(null);
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return resolve(null); }
    const lib = parsedUrl.protocol === 'https:' ? require('https') : require('http');
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const req = lib.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        let next = res.headers.location;
        try { next = new URL(next, url).toString(); } catch { return done(null); }
        done(fetchText(next, redirects + 1));
        return;
      }
      if (status !== 200) { res.resume(); return done(null); }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
        if (raw.length > 400000) { done(raw); req.destroy(); }
      });
      res.on('end', () => done(raw));
    });
    req.on('error', () => done(null));
    req.on('timeout', () => { req.destroy(); done(null); });
  });
}

async function refreshNews() {
  const feeds = await Promise.all(NEWS_FEEDS.map(async feed => {
    const xml = await fetchText(feed.url);
    return xml ? parseFeed(xml, feed).slice(0, NEWS_MAX_PER_FEED) : [];
  }));

  const seen = new Set();
  const merged = [];
  for (const list of feeds) {
    for (const item of list) {
      const key = item.title.toLowerCase();
      if (!item.title || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  merged.sort((a, b) => b.ts - a.ts);
  newsItems = merged.slice(0, NEWS_MAX_ITEMS);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('news-update', newsItems);
  }
}

function startNewsFeed() {
  if (newsTimer) return;
  refreshNews();
  newsTimer = setInterval(refreshNews, NEWS_REFRESH_MS);
}

function contentBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
  const [width, height] = mainWindow.getContentSize();
  return { x: 0, y: 0, width, height };
}

// Área de contenido: todo lo que queda debajo de la barra del navegador.
function pageBounds() {
  const b = contentBounds();
  return { x: 0, y: chromeHeight, width: b.width, height: Math.max(0, b.height - chromeHeight) };
}

function tabById(id) { return tabs.find(t => t.id === id) || null; }
function activeTab() { return tabById(activeTabId); }
function notesTab() { return tabs.find(t => t.kind === 'tool' && t.tool === 'notes') || null; }

function currentSiteIndex() {
  const tab = activeTab();
  return tab && tab.kind === 'site' ? tab.siteIndex : -1;
}

function navFlags(tab) {
  const wc = tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  let back = false;
  let forward = false;
  if (wc) {
    try { back = wc.canGoBack(); forward = wc.canGoForward(); } catch (e) {}
  }
  return { back, forward };
}

function activeWebContents() {
  const tab = activeTab();
  if (tab && tab.view && !tab.view.webContents.isDestroyed()) return tab.view.webContents;
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function destroyView(view) {
  if (!view) return;
  try { mainWindow && mainWindow.contentView.removeChildView(view); } catch (e) {}
  try { view.webContents.close(); } catch (e) {}
}

// Desengancha todas las vistas sin cerrarlas (conservan su estado).
function detachViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const t of tabs) {
    if (t.view && !t.view.webContents.isDestroyed()) {
      try { mainWindow.contentView.removeChildView(t.view); } catch (e) {}
    }
  }
}

function tabsState() {
  return tabs.map(t => {
    const f = navFlags(t);
    return {
      id: t.id,
      kind: t.kind,
      tool: t.tool || '',
      siteIndex: typeof t.siteIndex === 'number' ? t.siteIndex : -1,
      pageId: t.pageId || '',
      img: t.img || '',
      title: t.title,
      pageTitle: t.pageTitle || t.title,
      url: t.url,
      loading: !!t.loading,
      active: t.id === activeTabId,
      canGoBack: f.back,
      canGoForward: f.forward
    };
  });
}

function pushTabsState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tabs-update', tabsState());
  mainWindow.webContents.send('current-update', currentSiteIndex());
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tab = activeTab();
  mainWindow.setTitle(tab ? `METATRON — ${tab.title}` : 'METATRON — Inicio');
}

function layoutViews() {
  const tab = activeTab();
  if (tab && tab.view && !tab.view.webContents.isDestroyed()) tab.view.setBounds(pageBounds());
}

function activateTab(id) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tab = tabById(id);
  detachViews();
  activeTabId = tab ? tab.id : null;

  if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
    mainWindow.contentView.addChildView(tab.view);
    tab.view.setBounds(pageBounds());
    tab.view.webContents.focus();
  }
  mainWindow.focus();
  updateWindowTitle();
  pushTabsState();
  buildMenu();
}

// Abre la página de inicio (estalingradocorp.com.ar) en una pestaña.
function openHomePage() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const existing = tabs.find(t => t.kind === 'page' && t.pageId === HOME_PAGE.id);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }
  const tab = createWebTab(HOME_PAGE.url, { title: HOME_PAGE.name, img: HOME_PAGE.img, pageId: HOME_PAGE.id });
  activateTab(tab.id);
  return tab;
}

// Abre / cierra el cajón OSINT (el panel vive en el renderizador).
function toggleDrawer(force) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('drawer:toggle', force === true);
}

function toastToLauncher(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', message);
}

// Ctrl+1 … Ctrl+9 abren el módulo correspondiente en una pestaña,
// sin importar qué vista tenga el foco.
function attachModuleShortcuts(wc) {
  if (!wc || wc.__metatronShortcuts) return;
  wc.__metatronShortcuts = true;
  try {
    wc.on('before-input-event', (event, input) => {
      if (!input || input.type !== 'keyDown') return;
      if (!input.control && !input.meta) return;
      const key = String(input.key || '');
      if (key.length !== 1) return;
      const n = parseInt(key, 10);
      if (n >= 1 && n <= 9) {
        event.preventDefault();
        openSiteTab(n - 1);
      }
    });
  } catch (e) {}
}

function buildMenu() {
  const tab = activeTab();
  const flags = navFlags(tab);

  const menu = Menu.buildFromTemplate([
    {
      label: 'METATRON',
      submenu: [
        { label: 'Página de inicio', accelerator: 'CmdOrCtrl+H', click: () => openHomePage() },
        { label: 'Nueva pestaña', accelerator: 'CmdOrCtrl+T', click: () => openHomePage() },
        { label: 'Cajón OSINT', accelerator: 'CmdOrCtrl+Shift+O', click: () => toggleDrawer() },
        { label: 'Cerrar pestaña', accelerator: 'CmdOrCtrl+W', enabled: !!tab, click: () => closeActiveTab() },
        { type: 'separator' },
        {
          label: 'Pestaña siguiente',
          accelerator: 'CmdOrCtrl+Tab',
          enabled: tabs.length > 1,
          click: () => cycleTab(1)
        },
        {
          label: 'Pestaña anterior',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          enabled: tabs.length > 1,
          click: () => cycleTab(-1)
        },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => navReload(false) },
        { label: 'Recargar sin caché', accelerator: 'CmdOrCtrl+Shift+R', click: () => navReload(true) },
        { type: 'separator' },
        { label: 'Atrás', enabled: flags.back, click: () => navBack() },
        { label: 'Adelante', enabled: flags.forward, click: () => navForward() },
        { type: 'separator' },
        { label: 'Agrandar', accelerator: 'CmdOrCtrl+=', click: () => zoomBy(0.1) },
        { label: 'Achicar', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-0.1) },
        { label: 'Tamaño normal', accelerator: 'CmdOrCtrl+0', click: () => zoomBy(0, true) },
        { type: 'separator' },
        { label: 'DevTools', accelerator: 'F12', click: () => activeWebContents()?.toggleDevTools() },
        { type: 'separator' },
        { label: 'Pantalla completa', accelerator: 'F11', click: () => {
          if (!mainWindow) return;
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }},
        {
          label: 'Abrir carpeta de capturas',
          click: () => {
            try {
              fs.mkdirSync(capturesDir(), { recursive: true });
              shell.openPath(capturesDir());
            } catch (e) {}
          }
        }
      ]
    },
    {
      label: 'Herramientas',
      submenu: [
        { label: 'Anotador', accelerator: 'CmdOrCtrl+N', click: () => openNotesTab() },
        { label: 'Captura de pantalla', accelerator: 'CmdOrCtrl+Shift+S', click: () => takeScreenshot() },
        { type: 'separator' },
        {
          label: 'Abrir carpeta de notas',
          click: () => {
            try {
              ensureNotesDir();
              shell.openPath(notesDataDir());
            } catch (e) {}
          }
        },
        { label: 'Restaurar última copia de notas', click: () => restoreNotesBackup() },
        { type: 'separator' },
        {
          label: 'Encriptar la Intra-Net',
          type: 'checkbox',
          checked: encryptionOn,
          click: item => setEncryption(item.checked)
        },
        {
          label: 'Vaciar caché de navegación',
          click: () => {
            session.defaultSession.clearCache()
              .then(() => toastToLauncher('Caché de navegación vaciada'))
              .catch(() => toastToLauncher('No se pudo vaciar la caché'));
          }
        }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Sobre el programa', accelerator: 'F1', click: showAbout },
        { type: 'separator' },
        { label: 'Abrir página en una pestaña', enabled: false },
        ...SITES.map((s, i) => ({ label: s.name, click: () => openSiteTab(i) })),
        { type: 'separator' },
        { label: 'Estalingrado Corp (inicio)', click: () => openHomePage() }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

function setEncryption(on) {
  encryptionOn = !!on;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('encrypt:set', encryptionOn);
  buildMenu();
}

function restoreNotesBackup() {
  const restored = restoreLatestBackup();
  if (restored) {
    toastToLauncher('Copia restaurada · ' + restored.notes.length + ' notas');
    const tab = notesTab();
    if (tab && tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
  } else {
    toastToLauncher('No hay copias de seguridad de notas');
  }
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'METATRON',
    message: 'METATRON v1.0.0 · Servicio Estalingrado Corp',
    detail: 'Centro de inteligencia global. Monitoreá el mundo, analizá información y seguí acontecimientos en tiempo real desde una única plataforma.\n\nAtajos: Ctrl+1–9 para módulos | Ctrl+H para inicio | Ctrl+T nueva pestaña | Ctrl+W cerrar pestaña | Ctrl+Tab cambiar de pestaña | Ctrl+N anotador | Ctrl+Shift+S captura\n\nWeb: estalingradocorp.qzz.io',
    buttons: ['Cerrar', 'Visitar Estalingrado Corp'],
    cancelId: 0,
    defaultId: 0
  }).then(({ response }) => {
    if (response === 1) openWebTab('https://estalingradocorp.qzz.io/');
  });
}

// ── Anotador: almacenamiento, copias y utilidades ───────────────────────────
const NOTES_MAX_NOTES = 500;
const NOTES_MAX_TITLE = 200;
const NOTES_MAX_BODY = 200000;
const NOTES_MAX_BACKUPS = 20;
const NOTES_BACKUP_INTERVAL_MS = 60 * 1000;

let lastBackupAt = 0;

// Las notas se guardan FUERA de la carpeta de datos de Electron
// (%APPDATA%\metatron) para que reinstalar o desinstalar la app
// NO borre el contenido del anotador.
function dataDir() {
  return path.join(app.getPath('appData'), 'METATRON');
}
function notesDataDir() {
  return path.join(dataDir(), 'notas');
}
function notesFilePath() { return path.join(notesDataDir(), 'anotador.json'); }
function notesTxtPath() { return path.join(notesDataDir(), 'notas.txt'); }
function notesBackupDir() { return path.join(notesDataDir(), 'copias'); }
function legacyNotesFilePath() { return path.join(app.getPath('userData'), 'anotador.json'); }
// Ubicación anterior (versión Centinela BETA): se migra sola a %APPDATA%\METATRON\notas
function legacyCentinelaNotesDir() {
  return path.join(app.getPath('appData'), 'Centinela', 'notas');
}

function ensureNotesDir() {
  try {
    fs.mkdirSync(notesDataDir(), { recursive: true });
    fs.mkdirSync(notesBackupDir(), { recursive: true });
  } catch (e) {}
}

function stampForFile(d) {
  const p2 = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    '_' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '-' + p2(d.getSeconds());
}

function sanitizeNotesState(input) {
  const now = Date.now();
  const seen = new Set();
  const notes = [];
  const source = input && Array.isArray(input.notes) ? input.notes.slice(0, NOTES_MAX_NOTES) : [];

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    let id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
    if (!id) id = crypto.randomUUID();
    if (seen.has(id)) continue;
    seen.add(id);
    notes.push({
      id,
      title: String(raw.title || '').slice(0, NOTES_MAX_TITLE),
      body: String(raw.body || '').slice(0, NOTES_MAX_BODY),
      pinned: Boolean(raw.pinned),
      created: Number(raw.created) || now,
      updated: Number(raw.updated) || now
    });
  }

  let activeId = typeof (input && input.activeId) === 'string' ? input.activeId : null;
  if (!notes.some(n => n.id === activeId)) activeId = notes.length ? notes[0].id : null;

  return { notes, activeId };
}

function noteDisplayTitle(note) {
  const line = String(note.title || '').trim() || String(note.body || '').split('\n')[0].trim();
  return line || 'Nota sin titulo';
}

function notesToTxt(state) {
  const lines = [];
  lines.push('METATRON - ANOTADOR');
  lines.push('Exportado: ' + new Date().toLocaleString('es-ES'));
  lines.push('Notas: ' + state.notes.length);
  lines.push('');
  state.notes.forEach((note, i) => {
    lines.push('==============================================================');
    lines.push('[' + (i + 1) + '] ' + noteDisplayTitle(note) + (note.pinned ? '  [FIJADA]' : ''));
    lines.push(new Date(note.updated || Date.now()).toLocaleString('es-ES'));
    lines.push('--------------------------------------------------------------');
    lines.push(note.body || '');
    lines.push('');
  });
  return lines.join('\r\n');
}

function writeNotesTxt(state) {
  try { fs.writeFileSync(notesTxtPath(), notesToTxt(state), 'utf8'); } catch (e) {}
}

function listBackups() {
  try {
    return fs.readdirSync(notesBackupDir())
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        const full = path.join(notesBackupDir(), f);
        const st = fs.statSync(full);
        return { name: f, path: full, size: st.size, mtime: st.mtimeMs };
      });
  } catch (e) { return []; }
}

function pruneBackups() {
  const files = listBackups();
  for (let i = NOTES_MAX_BACKUPS; i < files.length; i++) {
    try { fs.unlinkSync(files[i].path); } catch (e) {}
  }
}

function createBackup(state) {
  const now = Date.now();
  if (now - lastBackupAt < NOTES_BACKUP_INTERVAL_MS) return;
  lastBackupAt = now;
  try {
    ensureNotesDir();
    const file = path.join(notesBackupDir(), 'anotador-' + stampForFile(new Date(now)) + '.json');
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    pruneBackups();
  } catch (e) {}
}

function restoreLatestBackup() {
  for (const backup of listBackups()) {
    try {
      const state = sanitizeNotesState(JSON.parse(fs.readFileSync(backup.path, 'utf8')));
      if (state.notes.length) {
        writeNotesState(state);
        return state;
      }
    } catch (e) {}
  }
  return null;
}

function readNotesState() {
  ensureNotesDir();
  let raw = null;
  try { raw = fs.readFileSync(notesFilePath(), 'utf8'); } catch (e) {}

  if (!raw) {
    // Migracion desde Centinela BETA (%APPDATA%\Centinela\notas) → %APPDATA%\METATRON\notas
    const migrated = migrateCentinelaNotes();
    if (migrated) return migrated;

    // Migracion desde la ubicacion anterior (%APPDATA%\centinela-beta\anotador.json)
    try {
      const legacyRaw = fs.readFileSync(legacyNotesFilePath(), 'utf8');
      const state = sanitizeNotesState(JSON.parse(legacyRaw));
      if (state.notes.length) {
        writeNotesState(state);
        try {
          fs.copyFileSync(legacyNotesFilePath(),
            path.join(notesBackupDir(), 'migracion-' + stampForFile(new Date()) + '.json'));
        } catch (e) {}
        return state;
      }
    } catch (e) {}
    return { notes: [], activeId: null };
  }

  try {
    const state = sanitizeNotesState(JSON.parse(raw));
    if (state.notes.length) return state;
  } catch (e) {
    const restored = restoreLatestBackup();
    if (restored) return restored;
  }
  return { notes: [], activeId: null };
}

// Copia la carpeta de notas de Centinela BETA a la de METATRON (una sola vez).
function migrateCentinelaNotes() {
  const legacyDir = legacyCentinelaNotesDir();
  const legacyFile = path.join(legacyDir, 'anotador.json');
  let legacyRaw = null;
  try { legacyRaw = fs.readFileSync(legacyFile, 'utf8'); } catch (e) {}
  if (!legacyRaw) return null;

  try {
    const state = sanitizeNotesState(JSON.parse(legacyRaw));
    if (!state.notes.length) return null;

    ensureNotesDir();
    // Copia el espejo en texto plano y las copias de seguridad si existen.
    try { fs.copyFileSync(path.join(legacyDir, 'notas.txt'), notesTxtPath()); } catch (e) {}
    try {
      const legacyBackups = path.join(legacyDir, 'copias');
      if (fs.existsSync(legacyBackups)) {
        for (const f of fs.readdirSync(legacyBackups)) {
          if (!f.endsWith('.json')) continue;
          fs.copyFileSync(path.join(legacyBackups, f), path.join(notesBackupDir(), f));
        }
      }
    } catch (e) {}

    writeNotesState(state);
    try {
      fs.copyFileSync(legacyFile,
        path.join(notesBackupDir(), 'migracion-centinela-' + stampForFile(new Date()) + '.json'));
    } catch (e) {}
    return state;
  } catch (e) { return null; }
}

function writeNotesState(input) {
  const state = sanitizeNotesState(input);
  ensureNotesDir();
  const file = notesFilePath();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  writeNotesTxt(state);
  createBackup(state);
  return state;
}

function mergeNotesStates(current, incoming) {
  const base = sanitizeNotesState(current);
  const add = sanitizeNotesState(incoming);
  const known = new Set(base.notes.map(n => n.id));
  let added = 0;
  for (const note of add.notes) {
    if (known.has(note.id)) continue;
    base.notes.unshift(note);
    known.add(note.id);
    added++;
  }
  base.notes = base.notes.slice(0, NOTES_MAX_NOTES);
  return { state: base, added };
}

// ── Cajón OSINT: páginas integradas + las que agrega el usuario ──────────────
const PAGES_MAX = 60;

function pagesFilePath() { return path.join(dataDir(), 'paginas.json'); }

function readCustomPages() {
  let list = [];
  try {
    const raw = fs.readFileSync(pagesFilePath(), 'utf8');
    const data = JSON.parse(raw);
    list = Array.isArray(data) ? data : (Array.isArray(data.pages) ? data.pages : []);
  } catch (e) { return []; }

  const out = [];
  for (const p of list) {
    if (!p || typeof p.url !== 'string') continue;
    const url = normalizeWebUrl(p.url);
    if (!url) continue;
    out.push({
      id: String(p.id || ('u-' + crypto.randomUUID().slice(0, 8))).slice(0, 64),
      name: String(p.name || hostOf(url)).slice(0, 80),
      url,
      desc: String(p.desc || '').slice(0, 120),
      img: '',
      builtin: false
    });
    if (out.length >= PAGES_MAX) break;
  }
  return out;
}

function writeCustomPages(list) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = pagesFilePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ pages: list }, null, 2), 'utf8');
    fs.renameSync(tmp, pagesFilePath());
    return true;
  } catch (e) { return false; }
}

// Lista completa del cajón: home + 9 plataformas + las que agregó el usuario.
function allPages() {
  const builtin = SITES.map((s, i) => ({
    id: 'site-' + i,
    name: s.name,
    url: s.url,
    desc: s.desc,
    img: s.img,
    siteIndex: i,
    builtin: true
  }));
  return [HOME_PAGE, ...builtin, ...readCustomPages()];
}

function pushPagesState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pages-update', allPages());
  }
}

function addCustomPage(name, url, desc) {
  const target = normalizeWebUrl(url);
  if (!target) return { ok: false, error: 'URL inválida' };
  const list = readCustomPages();
  if (list.length >= PAGES_MAX) return { ok: false, error: 'Límite de páginas alcanzado (' + PAGES_MAX + ')' };

  const dup = list.find(p => p.url === target || getSiteOrigin(p.url) === getSiteOrigin(target));
  if (dup) return { ok: false, error: 'Esa página ya está en el cajón' };

  const page = {
    id: 'u-' + crypto.randomUUID().slice(0, 8),
    name: String(name || '').trim().slice(0, 80) || hostOf(target),
    url: target,
    desc: String(desc || '').trim().slice(0, 120),
    img: '',
    builtin: false
  };
  list.push(page);
  if (!writeCustomPages(list)) return { ok: false, error: 'No se pudo guardar la página' };
  pushPagesState();
  return { ok: true, page };
}

function removeCustomPage(id) {
  const list = readCustomPages();
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return { ok: false, error: 'No se encontró la página' };
  if (!writeCustomPages(next)) return { ok: false, error: 'No se pudo guardar el cajón' };
  pushPagesState();
  return { ok: true };
}

// Abre una página del cajón OSINT en una pestaña.
function openPageById(id) {
  const page = allPages().find(p => p.id === String(id || ''));
  if (!page) return null;
  if (typeof page.siteIndex === 'number') return openSiteTab(page.siteIndex);

  const existing = tabs.find(t => t.kind === 'page' && t.pageId === page.id);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }
  const tab = createWebTab(page.url, { title: page.name, img: page.img, pageId: page.id });
  activateTab(tab.id);
  return tab;
}

// ── Anotador (pestaña de herramienta) ───────────────────────────────────────
function openNotes() {
  openNotesTab();
}

function closeNotes() {
  const tab = notesTab();
  if (tab) closeTab(tab.id);
}

// ── Capturas de pantalla ────────────────────────────────────────────────────
function capturesDir() {
  return path.join(app.getPath('pictures'), 'METATRON Capturas');
}

function screenshotName() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  return 'METATRON ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    ' ' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '-' + p2(d.getSeconds()) + '.png';
}

async function captureAppWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale))
    },
    fetchWindowIcons: false
  });

  let id = '';
  try { id = mainWindow.getMediaSourceId(); } catch (e) {}
  const source = (id && sources.find(s => s.id === id)) ||
    sources.find(s => s.name === mainWindow.getTitle()) ||
    null;

  return source && !source.thumbnail.isEmpty() ? source.thumbnail : null;
}

async function takeScreenshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'sin ventana' };

  let image = null;
  try { image = await captureAppWindow(); } catch (e) {}

  if (!image) {
    try {
      const wc = activeWebContents();
      if (wc) image = await wc.capturePage();
    } catch (e) {}
  }

  if (!image || image.isEmpty()) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Captura de pantalla',
      message: 'No se pudo capturar la ventana.',
      buttons: ['Cerrar']
    });
    return { ok: false, error: 'captura vacía' };
  }

  try {
    const dir = capturesDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, screenshotName());
    fs.writeFileSync(file, image.toPNG());
    clipboard.writeImage(image);

    try {
      if (Notification.isSupported()) {
        const toast = new Notification({
          title: 'Captura guardada',
          body: path.basename(file) + ' · copiada al portapapeles',
          silent: true
        });
        toast.on('click', () => shell.showItemInFolder(file));
        toast.show();
      }
    } catch (e) {}

    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function registerNotesIpc() {
  ipcMain.handle('notes:load', () => readNotesState());

  ipcMain.handle('notes:save', (event, state) => {
    try { return writeNotesState(state); }
    catch (e) { return null; }
  });

  ipcMain.on('notes:save-sync', (event, state) => {
    try { writeNotesState(state); event.returnValue = true; }
    catch (e) { event.returnValue = false; }
  });

  ipcMain.on('notes:open-folder', () => {
    try {
      ensureNotesDir();
      if (!fs.existsSync(notesFilePath())) writeNotesState({ notes: [], activeId: null });
      shell.openPath(notesDataDir());
    } catch (e) {}
  });

  ipcMain.handle('notes:path', () => notesDataDir());

  ipcMain.handle('notes:backups', () => listBackups());

  ipcMain.handle('notes:export-all', async () => {
    const state = readNotesState();
    const content = notesToTxt(state);
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options = {
      title: 'Exportar todas las notas',
      defaultPath: path.join(app.getPath('documents'), 'METATRON-anotador-' + stampForFile(new Date()) + '.txt'),
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    };

    let result;
    try {
      result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { ok: true, path: result.filePath, count: state.notes.length };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('notes:import', async () => {
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options = {
      title: 'Importar copia de seguridad',
      defaultPath: notesDataDir(),
      filters: [
        { name: 'Copia de METATRON', extensions: ['json'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    };

    let result;
    try {
      result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }

    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    try {
      const incoming = sanitizeNotesState(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')));
      if (!incoming.notes.length) return { ok: false, error: 'El archivo no contiene notas' };
      const merged = mergeNotesStates(readNotesState(), incoming);
      writeNotesState(merged.state);
      return { ok: true, added: merged.added, total: merged.state.notes.length, path: result.filePaths[0] };
    } catch (e) {
      return { ok: false, error: 'No se pudo leer la copia de seguridad' };
    }
  });

  ipcMain.handle('notes:restore', async (event, name) => {
    const safe = String(name || '').replace(/[\\/]/g, '');
    if (!safe.endsWith('.json')) return { ok: false, error: 'Copia invalida' };
    const file = path.join(notesBackupDir(), safe);
    try {
      const state = sanitizeNotesState(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!state.notes.length) return { ok: false, error: 'La copia esta vacia' };
      writeNotesState(state);
      return { ok: true, state, path: file, count: state.notes.length };
    } catch (e) {
      return { ok: false, error: 'No se pudo restaurar la copia' };
    }
  });

  ipcMain.on('notes:close', () => closeNotes());

  ipcMain.handle('notes:capture', () => takeScreenshot());

  ipcMain.handle('notes:export', async (event, payload) => {
    const rawTitle = String((payload && payload.title) || 'nota');
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'nota';
    const body = String((payload && payload.body) || '');
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options = {
      title: 'Exportar nota',
      defaultPath: path.join(app.getPath('documents'), safeTitle + '.txt'),
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    };

    let result;
    try {
      result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, body, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
}

// Crea una vista de navegación y la registra como pestaña.
// siteIndex >= 0 → es una de las 9 plataformas; pageId → es una página del cajón
// OSINT (home o agregada por el usuario); sin ninguno → es una web libre
// (cualquier URL http/https) abierta dentro del mismo navegador.
function createWebTab(url, opts = {}) {
  const siteIndex = typeof opts.siteIndex === 'number' ? opts.siteIndex : -1;
  const pageId = opts.pageId || '';
  const startUrl = normalizeWebUrl(url) || url;
  const fallbackTitle = opts.title || hostOf(startUrl) || 'Web';
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      userAgent: USER_AGENT
    }
  });
  const wc = view.webContents;
  attachModuleShortcuts(wc);
  const tab = {
    id: 'tab-' + (++tabSeq),
    kind: siteIndex >= 0 ? 'site' : (pageId ? 'page' : 'web'),
    tool: '',
    siteIndex,
    pageId,
    img: opts.img || '',
    title: fallbackTitle,
    pageTitle: fallbackTitle,
    url: startUrl,
    baseUrl: startUrl,
    view,
    loading: true
  };

  // Los links que piden una ventana nueva se abren como PESTÁÑA INTERNA:
  // nunca se delega al navegador del sistema.
  wc.setWindowOpenHandler(({ url: openUrl }) => {
    if (/^https?:\/\//i.test(openUrl)) {
      const i = findSiteIndex(openUrl);
      if (i >= 0) openSiteTab(i);
      else openWebTab(openUrl);
    }
    return { action: 'deny' };
  });

  // La navegación dentro de la pestaña se permite (como en un navegador);
  // los protocolos que no son web (mailto:, file:, etc.) se bloquean.
  wc.on('will-navigate', (event, navUrl) => {
    if (!/^https?:\/\//i.test(navUrl)) {
      event.preventDefault();
      toastToLauncher('Protocolo no permitido: ' + String(navUrl).split(':')[0]);
    }
  });

  wc.on('did-start-loading', () => { tab.loading = true; pushTabsState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushTabsState(); buildMenu(); });
  wc.on('page-title-updated', (event, title) => {
    tab.pageTitle = title || fallbackTitle;
    pushTabsState();
  });
  wc.on('did-navigate', (event, navUrl) => {
    tab.url = navUrl;
    // Si la pestaña sale de su plataforma o de su página del cajón, pasa a ser web libre.
    if (tab.kind === 'site' && findSiteIndex(navUrl) < 0) {
      tab.kind = 'web';
      tab.siteIndex = -1;
      tab.img = '';
    } else if (tab.kind === 'page' && getSiteOrigin(navUrl) !== getSiteOrigin(tab.baseUrl)) {
      tab.kind = 'web';
      tab.pageId = '';
      tab.img = '';
    }
    if (tab.kind === 'web') tab.title = hostOf(navUrl) || tab.title;
    pushTabsState();
  });
  wc.on('did-navigate-in-page', (event, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = navUrl;
    if (tab.kind === 'site' && findSiteIndex(navUrl) < 0) {
      tab.kind = 'web';
      tab.siteIndex = -1;
      tab.img = '';
    } else if (tab.kind === 'page' && getSiteOrigin(navUrl) !== getSiteOrigin(tab.baseUrl)) {
      tab.kind = 'web';
      tab.pageId = '';
      tab.img = '';
    }
    if (tab.kind === 'web') tab.title = hostOf(navUrl) || tab.title;
    pushTabsState();
  });
  wc.on('did-fail-load', (event, code, _desc, _validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abort
    tab.loading = false;
    tab.pageTitle = fallbackTitle + ' · sin conexión';
    pushTabsState();
  });

  tabs.push(tab);
  wc.loadURL(startUrl);
  return tab;
}

function createSiteTab(siteIndex) {
  const site = SITES[siteIndex];
  return createWebTab(site.url, { siteIndex, title: site.name, img: site.img });
}

// Abre cualquier URL en una pestaña interna del navegador.
function openWebTab(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const target = normalizeWebUrl(url);
  if (!target) return null;
  const tab = createWebTab(target, { title: hostOf(target) });
  activateTab(tab.id);
  return tab;
}

function openSiteTab(siteIndex) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const i = Number(siteIndex);
  if (!Number.isInteger(i) || i < 0 || i >= SITES.length) return null;

  const existing = tabs.find(t => t.kind === 'site' && t.siteIndex === i);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }

  const tab = createSiteTab(i);
  activateTab(tab.id);
  return tab;
}

function createNotesTab() {
  if (!notesView || notesView.webContents.isDestroyed()) {
    notesView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'notes-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    notesView.webContents.loadFile(path.join(__dirname, 'notes.html'));
    attachModuleShortcuts(notesView.webContents);
  }

  const tab = {
    id: 'tab-' + (++tabSeq),
    kind: 'tool',
    tool: 'notes',
    siteIndex: -1,
    pageId: '',
    img: '',
    title: 'Anotador',
    url: 'metatron://notas',
    view: notesView,
    loading: false
  };
  tabs.push(tab);
  return tab;
}

function openNotesTab() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const existing = notesTab();
  if (existing) {
    activateTab(existing.id);
    return existing;
  }
  const tab = createNotesTab();
  activateTab(tab.id);
  return tab;
}

async function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  const wasActive = tab.id === activeTabId;

  tabs.splice(idx, 1);
  if (wasActive) activeTabId = null;

  // El anotador se vacía antes de destruirse para no perder el último texto tipeado.
  if (tab.kind === 'tool' && tab.tool === 'notes' && tab.view && !tab.view.webContents.isDestroyed()) {
    try {
      await tab.view.webContents.executeJavaScript('window.__anotadorFlush && window.__anotadorFlush()');
    } catch (e) {}
    if (notesView === tab.view) notesView = null;
  }
  destroyView(tab.view);

  if (wasActive) {
    const next = tabs[idx] || tabs[idx - 1] || null;
    if (next) activateTab(next.id);
    else {
      detachViews();
      updateWindowTitle();
      pushTabsState();
      buildMenu();
    }
  } else {
    pushTabsState();
    buildMenu();
  }
}

function closeActiveTab() {
  if (!activeTabId) {
    openHomePage();
    return;
  }
  closeTab(activeTabId);
}

function cycleTab(direction) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex(t => t.id === activeTabId);
  const next = (i + direction + tabs.length) % tabs.length;
  activateTab(tabs[next].id);
}

function navBack() {
  const wc = activeWebContents();
  if (wc) wc.goBack();
}

function navForward() {
  const wc = activeWebContents();
  if (wc) wc.goForward();
}

function navReload(bypassCache) {
  const wc = activeWebContents();
  if (!wc) return;
  if (bypassCache) wc.reloadIgnoringCache();
  else wc.reload();
}

function zoomBy(delta, reset) {
  const wc = activeWebContents();
  if (!wc) return;
  if (reset) { wc.setZoomFactor(1); return; }
  let factor = 1;
  try { factor = wc.getZoomFactor(); } catch (e) {}
  wc.setZoomFactor(Math.min(2, Math.max(0.5, factor + delta)));
}

// Barra de direcciones: cualquier sitio se abre DENTRO del navegador.
// Si hay una pestaña de web activa se navega en ella; si no, se abre una nueva.
function navigateToUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return;

  if (/^metatron:/i.test(input)) { openHomePage(); return; }

  const target = normalizeWebUrl(input);
  if (!target) {
    toastToLauncher('Destino inválido');
    return;
  }

  const tab = activeTab();
  const wc = tab && tab.kind !== 'tool' && tab.view && !tab.view.webContents.isDestroyed()
    ? tab.view.webContents : null;
  if (wc) {
    wc.loadURL(target);
    return;
  }
  openWebTab(target);
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.setAlwaysOnTop(true, 'screen-saver');
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    fullscreen: true,
    autoHideMenuBar: false,
    backgroundColor: '#0d0d0d',
    icon: path.join(__dirname, 'icon.png'),
    title: 'METATRON — Inicio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'home.html'));
  attachModuleShortcuts(mainWindow.webContents);

  const layoutViewsNow = () => layoutViews();

  mainWindow.on('resize', layoutViewsNow);
  mainWindow.on('enter-full-screen', layoutViewsNow);
  mainWindow.on('leave-full-screen', layoutViewsNow);

  const reveal = () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const started = Date.now();
  mainWindow.webContents.once('did-finish-load', () => {
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - started));
    setTimeout(reveal, wait);
    pushTabsState();
  });

  setTimeout(reveal, SPLASH_MIN_MS + 10000);

  mainWindow.on('closed', () => {
    for (const t of tabs) destroyView(t.view);
    tabs = [];
    activeTabId = null;
    notesView = null;
    mainWindow = null;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(USER_AGENT, 'en-US,en;q=0.9');
  await initAdblock();
  registerNotesIpc();
  buildMenu();
  createSplash();
  createMain();
  startNewsFeed();

  // El navegador arranca con la página de inicio (estalingradocorp.com.ar).
  openHomePage();

  ipcMain.on('navigate', (event, index) => {
    const i = Number(index);
    if (i === -1) openHomePage();
    else openSiteTab(i);
  });

  ipcMain.handle('get-current', () => currentSiteIndex());

  // ── Navegador con pestañas ────────────────────────────────────────────────
  ipcMain.handle('tabs:get', () => tabsState());

  ipcMain.on('tabs:activate', (event, id) => activateTab(String(id || '')));

  ipcMain.on('tabs:close', (event, id) => closeTab(String(id || '')));

  ipcMain.on('tabs:new', () => openHomePage());

  ipcMain.on('tabs:cycle', (event, dir) => cycleTab(Number(dir) >= 0 ? 1 : -1));

  ipcMain.on('nav:back', () => navBack());

  ipcMain.on('nav:forward', () => navForward());

  ipcMain.on('nav:reload', () => navReload(false));

  ipcMain.on('nav:reload-bypass', () => navReload(true));

  ipcMain.on('nav:home', () => openHomePage());

  // ── Cajón OSINT: páginas integradas + las que agrega el usuario ────────────
  ipcMain.handle('pages:get', () => allPages());

  ipcMain.handle('pages:add', (event, payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    return addCustomPage(data.name, data.url, data.desc);
  });

  ipcMain.handle('pages:remove', (event, id) => removeCustomPage(String(id || '')));

  ipcMain.on('pages:open', (event, id) => openPageById(String(id || '')));

  ipcMain.on('nav:go', (event, url) => navigateToUrl(url));

  ipcMain.on('nav:focus-url', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-url');
  });

  // El renderizador informa el alto real de la barra del navegador.
  ipcMain.on('chrome:height', (event, height) => {
    const value = Math.round(Number(height) || 0);
    if (!value || value < 40 || value > 400) return;
    if (Math.abs(value - chromeHeight) < 1) return;
    chromeHeight = value;
    layoutViews();
  });

  ipcMain.on('encrypt:set', (event, on) => {
    encryptionOn = !!on;
    buildMenu();
  });

  ipcMain.handle('news:get', () => newsItems);

  ipcMain.on('open-notes', () => openNotes());

  ipcMain.handle('app:capture', () => takeScreenshot());

  ipcMain.on('tabs:open-url', (event, url) => { openWebTab(url); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});