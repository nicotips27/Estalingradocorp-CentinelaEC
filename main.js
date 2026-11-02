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

let currentSite = -1;
const SPLASH_MIN_MS = 1800;
let mainWindow = null;
let splashWindow = null;
let notesView = null;      // anotador como vista interna (no rompe pantalla completa)
let notesVisible = false;
let siteView = null;      // vista del sitio actualmente visible
let pendingView = null;   // vista cargando (todavía no visible)

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

function activeWebContents() {
  if (notesView && notesVisible && !notesView.webContents.isDestroyed()) return notesView.webContents;
  if (siteView && !siteView.webContents.isDestroyed()) return siteView.webContents;
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function destroyView(view) {
  if (!view) return;
  try { mainWindow && mainWindow.contentView.removeChildView(view); } catch (e) {}
  try { view.webContents.close(); } catch (e) {}
}

function buildMenu() {
  const siteMenuItems = SITES.map((s, i) => ({
    label: s.name,
    accelerator: s.shortcut,
    type: 'radio',
    checked: i === currentSite,
    click: () => navigateTo(i)
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: 'Centinela',
      submenu: [
        { label: 'Inicio', accelerator: 'CmdOrCtrl+H', click: () => goHome() },
        {
          label: notesVisible ? 'Cerrar anotador' : 'Anotador',
          accelerator: 'CmdOrCtrl+N',
          click: () => { notesVisible ? closeNotes() : openNotes(); }
        },
        { type: 'separator' },
        ...siteMenuItems,
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => activeWebContents()?.reload() },
        { label: 'DevTools', accelerator: 'F12', click: () => activeWebContents()?.toggleDevTools() },
        { type: 'separator' },
        { label: 'Captura de pantalla', accelerator: 'CmdOrCtrl+Shift+S', click: () => takeScreenshot() },
        {
          label: 'Abrir carpeta de capturas',
          click: () => {
            try {
              fs.mkdirSync(capturesDir(), { recursive: true });
              shell.openPath(capturesDir());
            } catch (e) {}
          }
        },
        { type: 'separator' },
        { label: 'Pantalla completa', accelerator: 'F11', click: () => {
          if (!mainWindow) return;
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }}
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

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Centinela BETA',
    message: 'Centinela BETA v1.0.0 · Servicio Estalingrado Corp',
    detail: 'Centro de inteligencia global. Monitoreá el mundo, analizá información y seguí acontecimientos en tiempo real desde una única plataforma.\n\nAtajos: Ctrl+1–9 para módulos | Ctrl+H para inicio\n\nWeb: estalingradocorp.qzz.io',
    buttons: ['Cerrar', 'Visitar Estalingrado Corp'],
    cancelId: 0,
    defaultId: 0
  }).then(({ response }) => {
    if (response === 1) shell.openExternal('https://estalingradocorp.qzz.io/');
  });
}

// ── Anotador ────────────────────────────────────────────────────────────────
const NOTES_MAX_NOTES = 500;
const NOTES_MAX_TITLE = 200;
const NOTES_MAX_BODY = 200000;

function notesFilePath() {
  return path.join(app.getPath('userData'), 'anotador.json');
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
      created: Number(raw.created) || now,
      updated: Number(raw.updated) || now
    });
  }

  let activeId = typeof (input && input.activeId) === 'string' ? input.activeId : null;
  if (!notes.some(n => n.id === activeId)) activeId = notes.length ? notes[0].id : null;

  return { notes, activeId };
}

function readNotesState() {
  try {
    const raw = fs.readFileSync(notesFilePath(), 'utf8');
    const state = sanitizeNotesState(JSON.parse(raw));
    if (state.notes.length) return state;
  } catch (e) {}
  return { notes: [], activeId: null };
}

function writeNotesState(input) {
  const state = sanitizeNotesState(input);
  const file = notesFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return state;
}

// ── Anotador (vista interna) ────────────────────────────────────────────────
function openNotes() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

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
  }

  if (!notesVisible) {
    mainWindow.contentView.addChildView(notesView);
    notesVisible = true;
  }

  notesView.setBounds(contentBounds());
  notesView.webContents.focus();
  mainWindow.focus();
  buildMenu();
}

function closeNotes() {
  if (!notesView || !notesVisible) return;
  try { mainWindow.contentView.removeChildView(notesView); } catch (e) {}
  notesVisible = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (siteView && !siteView.webContents.isDestroyed()) siteView.webContents.focus();
    else mainWindow.webContents.focus();
    mainWindow.focus();
  }
  buildMenu();
}

function destroyNotesView() {
  if (!notesView) return;
  const view = notesView;
  notesView = null;
  notesVisible = false;
  destroyView(view);
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
      const file = notesFilePath();
      if (!fs.existsSync(file)) writeNotesState({ notes: [], activeId: null });
      shell.showItemInFolder(file);
    } catch (e) {}
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

function attachView(view, index) {
  if (!mainWindow || mainWindow.isDestroyed()) { destroyView(view); return; }
  if (siteView && siteView !== view) destroyView(siteView);
  siteView = view;
  pendingView = null;
  mainWindow.contentView.addChildView(view);
  view.setBounds(contentBounds());
  mainWindow.setTitle(`Centinela BETA — ${SITES[index].name}`);
  view.webContents.focus();
  mainWindow.focus();
}

function loadSite(index) {
  if (!mainWindow || mainWindow.isDestroyed() || index < 0 || index >= SITES.length) return;

  const site = SITES[index];
  const url = site.url;
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

  wc.setWindowOpenHandler(({ url: u }) => {
    if (isAllowedUrl(u)) {
      const i = findSiteIndex(u);
      if (i >= 0) navigateTo(i);
    } else {
      shell.openExternal(u);
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, u) => {
    if (!isAllowedUrl(u)) {
      event.preventDefault();
      shell.openExternal(u);
    }
  });

  const stale = () => pendingView !== view;

  wc.once('did-finish-load', () => {
    if (stale()) { destroyView(view); return; }
    attachView(view, index);
  });

  wc.on('did-fail-load', (_e, code, _desc, _validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abort
    if (stale()) { destroyView(view); return; }
    pendingView = null;
    destroyView(view);
    if (!siteView) mainWindow.setTitle('Centinela BETA — Inicio');
  });

  if (pendingView) destroyView(pendingView);
  pendingView = view;
  wc.loadURL(url);
}

function goHome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  closeNotes();
  if (pendingView) { destroyView(pendingView); pendingView = null; }
  if (siteView) { destroyView(siteView); siteView = null; }
  currentSite = -1;
  buildMenu();
  mainWindow.setTitle('Centinela BETA — Inicio');
  mainWindow.webContents.focus();
  mainWindow.focus();
}

function navigateTo(index) {
  if (!mainWindow || mainWindow.isDestroyed() || index < 0 || index >= SITES.length) return;
  closeNotes();
  currentSite = index;
  buildMenu();
  mainWindow.setTitle(`Centinela BETA — Cargando ${SITES[index].name}…`);
  loadSite(index);
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

  const layoutViews = () => {
    const bounds = contentBounds();
    if (siteView && !siteView.webContents.isDestroyed()) siteView.setBounds(bounds);
    if (notesView && notesVisible && !notesView.webContents.isDestroyed()) notesView.setBounds(bounds);
  };

  mainWindow.on('resize', layoutViews);
  mainWindow.on('enter-full-screen', layoutViews);
  mainWindow.on('leave-full-screen', layoutViews);

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
  });

  setTimeout(reveal, SPLASH_MIN_MS + 10000);

  mainWindow.on('closed', () => {
    destroyView(pendingView); pendingView = null;
    destroyView(siteView); siteView = null;
    destroyNotesView();
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
    if (index === -1) goHome(); else navigateTo(index);
  });

  ipcMain.handle('get-current', () => currentSite);

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