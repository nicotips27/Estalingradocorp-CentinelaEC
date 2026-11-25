const { app, BrowserWindow, WebContentsView, session, shell, Menu, ipcMain, dialog,
        desktopCapturer, screen, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initAdblock } = require('./adblock');

// Identidad de Windows: hace que las notificaciones (capturas) salgan como Centinela BETA.
app.setAppUserModelId('com.centinela.beta');

// User-Agent de Chrome real: evita que Cloudflare/sitios bloqueen a Electron.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SITES = [
  { name: 'EC Terminal Data',  url: 'https://nicotips27.github.io/Estalingrado-corp-Terminal-data/', shortcut: 'CmdOrCtrl+1' },
  { name: 'EC NEWS',            url: 'https://nicotips27.github.io/ECnews/',                      shortcut: 'CmdOrCtrl+2' },
  { name: 'EC Send Pro',       url: 'https://estalingradocorp.github.io/ECsendpro/',            shortcut: 'CmdOrCtrl+3' },
  { name: 'Osiris AI',         url: 'https://osirisai.live/',                        shortcut: 'CmdOrCtrl+4' },
  { name: 'OpenGrid Works',    url: 'https://opengridworks.com/power-plants', shortcut: 'CmdOrCtrl+5' },
  { name: 'Provenance',        url: 'https://provenance-online.com/app?lat=5.6961&lon=-52.32892&z=1.74&layers=&base=satellite', shortcut: 'CmdOrCtrl+6' },
  { name: 'Radio Garden',      url: 'https://radio.garden/',                                   shortcut: 'CmdOrCtrl+7' },
  { name: 'Famelack',          url: 'https://famelack.com/',                                    shortcut: 'CmdOrCtrl+8' },
  { name: 'Drive & Listen',    url: 'https://driveandlisten.app/',                               shortcut: 'CmdOrCtrl+9' }
];

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

function isAllowedUrl(url) {
  return findSiteIndex(url) >= 0;
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
  mainWindow.setTitle(tab ? `Centinela BETA — ${tab.title}` : 'Centinela BETA — Inicio');
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

// Vuelve al lanzador de módulos (pestaña nueva) sin cerrar las demás pestañas.
function showLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  detachViews();
  activeTabId = null;
  updateWindowTitle();
  pushTabsState();
  mainWindow.webContents.focus();
  mainWindow.focus();
}

function toastToLauncher(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', message);
}

// Ctrl+1 … Ctrl+9 abren el módulo correspondiente en una pestaña,
// sin importar qué vista tenga el foco.
function attachModuleShortcuts(wc) {
  if (!wc || wc.__centinelaShortcuts) return;
  wc.__centinelaShortcuts = true;
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
      label: 'Centinela',
      submenu: [
        { label: 'Inicio · módulos', accelerator: 'CmdOrCtrl+H', click: () => showLauncher() },
        { label: 'Nueva pestaña', accelerator: 'CmdOrCtrl+T', click: () => showLauncher() },
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
        ...SITES.map(s => ({ label: s.name, click: () => shell.openExternal(s.url) }))
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
    title: 'Centinela BETA',
    message: 'Centinela BETA v1.0.0 · Servicio Estalingrado Corp',
    detail: 'Centro de inteligencia global. Monitoreá el mundo, analizá información y seguí acontecimientos en tiempo real desde una única plataforma.\n\nAtajos: Ctrl+1–9 para módulos | Ctrl+H para inicio | Ctrl+T nueva pestaña | Ctrl+W cerrar pestaña | Ctrl+Tab cambiar de pestaña | Ctrl+N anotador | Ctrl+Shift+S captura\n\nWeb: estalingradocorp.qzz.io',
    buttons: ['Cerrar', 'Visitar Estalingrado Corp'],
    cancelId: 0,
    defaultId: 0
  }).then(({ response }) => {
    if (response === 1) shell.openExternal('https://estalingradocorp.qzz.io/');
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
// (%APPDATA%\centinela-beta) para que reinstalar o desinstalar la app
// NO borre el contenido del anotador.
function notesDataDir() {
  return path.join(app.getPath('appData'), 'Centinela', 'notas');
}
function notesFilePath() { return path.join(notesDataDir(), 'anotador.json'); }
function notesTxtPath() { return path.join(notesDataDir(), 'notas.txt'); }
function notesBackupDir() { return path.join(notesDataDir(), 'copias'); }
function legacyNotesFilePath() { return path.join(app.getPath('userData'), 'anotador.json'); }

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
  lines.push('CENTINELA BETA - ANOTADOR');
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
    // Migracion desde la ubicacion anterior (%APPDATA%\centinela-beta\anotador.json)
    try {
      const legacyRaw = fs.readFileSync(legacyNotesFilePath(), 'utf8');
      const migrated = sanitizeNotesState(JSON.parse(legacyRaw));
      if (migrated.notes.length) {
        writeNotesState(migrated);
        try {
          fs.copyFileSync(legacyNotesFilePath(),
            path.join(notesBackupDir(), 'migracion-' + stampForFile(new Date()) + '.json'));
        } catch (e) {}
        return migrated;
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
  return path.join(app.getPath('pictures'), 'Centinela Capturas');
}

function screenshotName() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  return 'Centinela ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
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
      defaultPath: path.join(app.getPath('documents'), 'Centinela-anotador-' + stampForFile(new Date()) + '.txt'),
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
        { name: 'Copia de Centinela', extensions: ['json'] },
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

function createSiteTab(siteIndex) {
  const site = SITES[siteIndex];
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
    kind: 'site',
    tool: '',
    siteIndex,
    title: site.name,
    pageTitle: site.name,
    url: site.url,
    view,
    loading: true
  };

  // Los enlaces a plataformas permitidas abren en una pestaña nueva; el resto, en el navegador.
  wc.setWindowOpenHandler(({ url }) => {
    const i = findSiteIndex(url);
    if (i >= 0) openSiteTab(i);
    else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  wc.on('did-start-loading', () => { tab.loading = true; pushTabsState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushTabsState(); buildMenu(); });
  wc.on('page-title-updated', (event, title) => {
    tab.pageTitle = title || site.name;
    pushTabsState();
  });
  wc.on('did-navigate', (event, url) => { tab.url = url; pushTabsState(); });
  wc.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame) { tab.url = url; pushTabsState(); }
  });
  wc.on('did-fail-load', (event, code, _desc, _validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abort
    tab.loading = false;
    tab.pageTitle = site.name + ' · sin conexión';
    pushTabsState();
  });

  tabs.push(tab);
  wc.loadURL(site.url);
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
    title: 'Anotador',
    url: 'centinela://anotador',
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
    showLauncher();
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

// Barra de direcciones: sólo se navega a las plataformas permitidas.
// Cualquier otro destino se abre en el navegador del sistema.
function navigateToUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return;

  if (/^centinela:/i.test(input)) { showLauncher(); return; }

  let target = input;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = 'https://' + target;

  const idx = SITES.findIndex(s => getSiteOrigin(s.url) === getSiteOrigin(target));
  if (idx >= 0) {
    const tab = activeTab();
    const wc = tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
    if (wc) wc.loadURL(target);
    else {
      const opened = openSiteTab(idx);
      if (opened && opened.view) opened.view.webContents.loadURL(target);
    }
    return;
  }

  if (/^https?:\/\//i.test(target)) {
    shell.openExternal(target);
    toastToLauncher('Destino no permitido → abierto en el navegador del sistema');
  }
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
    title: 'Centinela BETA — Inicio',
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

  ipcMain.on('navigate', (event, index) => {
    const i = Number(index);
    if (i === -1) showLauncher();
    else openSiteTab(i);
  });

  ipcMain.handle('get-current', () => currentSiteIndex());

  // ── Navegador con pestañas ────────────────────────────────────────────────
  ipcMain.handle('tabs:get', () => tabsState());

  ipcMain.on('tabs:activate', (event, id) => activateTab(String(id || '')));

  ipcMain.on('tabs:close', (event, id) => closeTab(String(id || '')));

  ipcMain.on('tabs:new', () => showLauncher());

  ipcMain.on('tabs:cycle', (event, dir) => cycleTab(Number(dir) >= 0 ? 1 : -1));

  ipcMain.on('nav:back', () => navBack());

  ipcMain.on('nav:forward', () => navForward());

  ipcMain.on('nav:reload', () => navReload(false));

  ipcMain.on('nav:reload-bypass', () => navReload(true));

  ipcMain.on('nav:home', () => showLauncher());

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

  ipcMain.on('open-external', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});