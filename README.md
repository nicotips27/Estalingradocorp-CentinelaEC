# Centinela BETA

App de escritorio para Windows que abre **diez plataformas de monitoreo y datos** en vistas dedicadas, sin necesidad de navegador. Construida con Electron, con temática **azul y negro**, pantalla de carga con logo de Estalingrado Corp y bloqueo de anuncios integrado.

---

## Tabla de contenidos

1. [Descripción](#descripción)
2. [Características](#características)
3. [Plataformas](#plataformas)
4. [Estructura del proyecto](#estructura-del-proyecto)
5. [Requisitos](#requisitos)
6. [Puesta en marcha (desarrollo)](#puesta-en-marcha-desarrollo)
7. [Generar el instalador](#generar-el-instalador)
8. [Distribución](#distribución)
9. [Solución de problemas](#solución-de-problemas)

---

## Descripción

**Centinela BETA** es un *wrapper* de escritorio construido con [Electron](https://www.electronjs.org/). Su propósito es ofrecer acceso rápido y autónomo a **diez plataformas** de monitoreo de inteligencia y datos.

Características principales:

- Carga cada web en una **vista aislada** (`WebContentsView`) dentro de la ventana principal.
- **Pantalla de inicio** con tarjetas para elegir cada plataforma.
- **Menú nativo** para alternar entre webs.
- Muestra una pantalla de carga animada mientras las webs se conectan.
- Reenvía los enlaces externos (que no sean de las webs permitidas) al navegador del sistema.
- Se instala como programa normal de Windows (con acceso directo en escritorio e inicio).

---

## Características

- **Vista dedicada por plataforma** (`WebContentsView`): cada sitio se renderiza en su propia vista aislada, con mejor rendimiento y sin recargar la pantalla de inicio. La ventana principal (1280×800, mínimo 800×600) arranca en **pantalla completa**.
- **User-Agent de Chrome 124** (`session.defaultSession.setUserAgent`): evita que Cloudflare y otros sitios anti-bot bloqueen a Electron.
- **Tema azul y negro** en toda la interfaz (pantalla de inicio y splash), con acentos `#0052cc` → `#0066ff`.
- **Pantalla de inicio**: al arrancar (y con **Inicio** del menú / Ctrl+H) se muestra un lanzador con tarjetas para elegir cada web, tagline descriptivo, reloj en vivo, estado de conexión de cada plataforma (online/offline) e **interruptor "Encriptar la Intra-Net"** (desactivado por defecto; al activarlo el **LED** y los indicadores de red pasan a azul y el estado cambia a *SYS.ENCRYPTION ACTIVE*).
- **Fondo de estrellas animado** (canvas 2D) con parallax, twinkling y soporte para `prefers-reduced-motion`.
- **Monitoreo de conectividad** por plataforma mediante peticiones `HEAD` con `AbortController` (timeout 5 s), con reintento y estado agregado en el pie (*INTRA-NET ONLINE / PARCIAL / SIN CONEXIÓN*).
- **Teleprompter de última hora** en la pantalla de inicio: cinta de titulares que se desplaza en la parte superior, alimentada por RSS de **Google News, BBC Mundo, BBC News, El País, Al Jazeera, NBC News, The Verge y TechCrunch** (descarga en el proceso principal, refresco cada 10 min, máximo 24 titulares). Los titulares van en **azul** y los que coinciden con señales de urgencia (*URGENTE, breaking news, alerta máxima, estado de emergencia, evacuación, explosión, terremoto, atentado, tiroteo, víctimas…*) en **rojo** con distintivo `URGENTE`. Clic en un titular → abre la noticia en el navegador. Sin conexión, la cinta muestra *SIN SEÑAL*.
- **Tarjetas con imágenes** propias para todas las plataformas (favicons/iconos oficiales de cada sitio).
- **Opción "Sobre el programa"** en el menú **Ayuda** (F1): modal con la info de Centinela BETA, la descripción y un botón que abre la web de Estalingrado Corp (`estalingradocorp.qzz.io`).
- **Menú nativo** con los módulos **Centinela**, **Ver** y **Ayuda**:
  - **Inicio** (Ctrl+H) y atajos **Ctrl+1 … Ctrl+9** para cambiar de web.
  - Recargar (Ctrl+R), DevTools (F12), Pantalla completa (F11) —_RECARGAR_ y _DEVTOOLS_ operan sobre la vista activa.
  - "Sobre el programa" y accesos a las webs en el navegador.
- **Pantalla de carga (splash)** con logo, título y texto *"Conectando a la Intra-net…"* con spinner circular.
- **Carga en paralelo**: la web se carga en segundo plano mientras se muestra el splash, con transición al terminar (mínimo 1,8 s).
- **Seguridad de navegación**: solo se permiten las plataformas configuradas; el resto de enlaces se abren en el navegador del sistema.
- **Bloqueo de anuncios** (listas EasyList + EasyPrivacy con caché local).
- **Aislamiento de procesos**: `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true` en las vistas de sitio.
- **Instalador NSIS** con asistente, selección de carpeta y accesos directos.

---

## Plataformas

| Atajo | Plataforma | URL |
| --- | --- | --- |
| Ctrl+1 | EC Terminal Data | https://nicotips27.github.io/Estalingrado-corp-Terminal-data/ |
| Ctrl+2 | EC NEWS | https://nicotips27.github.io/ECnews/ |
| Ctrl+3 | EC Send Pro | https://estalingradocorp.github.io/ECsendpro/ |
| Ctrl+4 | Osiris AI | https://osirisai.live/ |
| Ctrl+5 | OpenGrid Works | https://opengridworks.com/power-plants |
| Ctrl+6 | Provenance | https://provenance-online.com/app?lat=5.6961&lon=-52.32892&z=1.74&layers=&base=satellite |
| Ctrl+7 | Radio Garden | https://radio.garden/ |
| Ctrl+8 | Famelack | https://famelack.com/ |
| Ctrl+9 | Drive & Listen | https://driveandlisten.app/ |

> Provenance abre su mapa satelital con una configuración concreta (lat/lon, zoom y capas).

---

## Estructura del proyecto

```
Estalingradocorp-CentinelaEC/
├── package.json        # Configuración del proyecto, scripts y electron-builder
├── package-lock.json   # Bloqueo de dependencias (generado)
├── main.js             # Proceso principal: WebContentsView, menú nativo, navegación segura e IPC
├── preload.js          # Puente seguro entre el renderizador y Node
├── renderer.html       # Página de respaldo (poco usada)
├── splash.html         # Pantalla de carga con el logo y el texto
├── home.html           # Pantalla de inicio (lanzador + teleprompter de noticias)
├── logo.jpg            # Logo de Estalingrado Corp (splash, tarjeta EC Terminal Data)
├── img-ecnews.jpg      # Imagen de la tarjeta EC NEWS
├── img-osiris.png      # Imagen de la tarjeta Osiris AI
├── img-opengrid.webp   # Imagen de la tarjeta OpenGrid Works
├── img-warwatch.png    # Imagen de la tarjeta Provenance
├── img-ecsendpro.png   # Imagen de la tarjeta EC Send Pro
├── img-radiogarden.png   # Imagen de la tarjeta Radio Garden
├── img-famelack.png      # Imagen de la tarjeta Famelack
├── img-driveandlisten.png # Imagen de la tarjeta Drive & Listen
├── img-palantir.png    # Imagen de la tarjeta Palantir
├── img-conflictradar.png # Icono de la tarjeta Conflict Radar 360
├── img-worldmonitor.png  # Icono de la tarjeta World Monitor
├── Imagenes/Iconos/icono/icono.png # Icono maestro (1254×1254, fuente del app icon)
├── icon.png            # Icono de la app (256×256, generado desde el maestro)
├── icon.ico            # Icono del instalador NSIS (generado desde el maestro)
├── make-icon.js        # Script que regenera icon.png e icon.ico
├── adblock.js          # Bloqueo de anuncios con caché local
├── node_modules/       # Dependencias (generado por npm)
└── dist/               # Instaladores generados (resultado del build)
    └── Centinela BETA Setup 1.0.0.exe
```

### Descripción de archivos clave

| Archivo | Rol |
| --- | --- |
| `main.js` | Proceso principal de Electron. Define las webs, construye el menú nativo, crea el splash y la ventana principal, gestiona las `WebContentsView` por plataforma y el IPC. |
| `home.html` | Pantalla de inicio: tarjetas para elegir cada web, reloj, estado de conexión, interruptor de encriptación, canvas de estrellas y tagline. |
| `splash.html` | Pantalla de carga: logo, título, subtítulo y texto de conexión con spinner CSS. |
| `preload.js` | Puente seguro (`window.centinela.{selectSite,getCurrent,openExternal}`) entre el renderizador y el proceso principal, con inyección de estilos base. |
| `adblock.js` | Inicializa el bloqueo de anuncios (`@cliqz/adblocker`) con listas EasyList/EasyPrivacy y caché local. |
| `package.json` | Define nombre, versión, scripts (`start`, `dist`), archivos empaquetados y configuración de electron-builder. |
| `make-icon.js` | Regenera `icon.png` (256×256) e `icon.ico` desde el icono maestro `Imagenes/Iconos/icono/icono.png`. Requiere `npm install` (usa `app-builder`). |

---

## Requisitos

- **Sistema operativo:** Windows 10/11 de 64 bits (para el instalador generado).
- **Node.js** v18 o superior (para desarrollo y compilación). Probado con Node v24.
- **npm** (incluido con Node).

> El instalador generado **no** requiere Node ni Electron instalados en los equipos destino: es un ejecutable autocontenido.

---

## Puesta en marcha (desarrollo)

Desde la carpeta del proyecto:

```powershell
# 1. Instalar dependencias
npm install

# 2. Ejecutar la app en modo desarrollo (ventana de depuración)
npm start
```

Si al instalar dependencias Electron no descarga su binario (política de scripts seguros), asegúrate de que `package.json` contenga:

```json
"allowScripts": {
  "electron": "postinstall"
}
```

y vuelve a ejecutar `npm install`.

---

## Generar el instalador

```powershell
npm run dist
```

O directamente:

```powershell
npx electron-builder --win
```

El resultado queda en `dist/`:

```
dist/
└── Centinela BETA Setup 1.0.0.exe   ← instalador final
```

### Notas sobre el build

- **Icono:** electron-builder convierte `icon.png` (256×256) a `.ico` automáticamente.
- **Primer build:** descarga las herramientas NSIS, así que la primera compilación tarda más.
- **Versión:** el nombre del instalador incluye la `version` de `package.json`. Auméntala (`npm version patch`) antes de publicar una nueva build.

### Regenerar el icono de la app

El icono maestro vive en `Imagenes/Iconos/icono/icono.png` (1254×1254). Para aplicarlo al app:

```powershell
node make-icon.js
```

Esto regenera `icon.png` (256×256, para el `.exe` y la barra de tareas) e `icon.ico` (256×256, para el instalador NSIS). Después hay que reconstruir el instalador:

```powershell
npm run dist
```

---

## Distribución

El instalador es un **programa de uso interno** que no está firmado digitalmente:

1. Copia `dist\Centinela BETA Setup 1.0.0.exe` al equipo destino.
2. Ejecútalo. Windows mostrará el aviso *"Editor desconocido"*:
   - Pulsa **Más información** → **Ejecutar de todos modos**.
3. Sigue el asistente (elige carpeta y accesos directos).
4. La app queda en Inicio y en el Escritorio.

> **Firma de código:** para eliminar el aviso de Windows necesitas un certificado de firma (coste). No es necesario para uso interno.

---

## Solución de problemas

| Problema | Solución |
| --- | --- |
| Aviso azul "Editor desconocido" al instalar | Normal sin firma: **Más información → Ejecutar de todos modos**. |
| La app no muestra la web (pantalla en blanco) | Verifica la conexión a las plataformas y que el sitio esté en línea. |
| Un sitio muestra un aviso de Cloudflare | Verifica que el User-Agent de Chrome 124 se aplique (`session.defaultSession.setUserAgent`). |
| El teleprompter muestra *SIN SEÑAL* | Sin conexión a internet: el proceso principal no pudo descargar los RSS de las agencias. |
| No bloquea anuncios la primera vez | La primera ejecución necesita internet para descargar las listas EasyList/EasyPrivacy y guardarlas en caché. |
| El splash se queda mucho tiempo | Es por red de seguridad; la app fuerza la transición a los ~11,8 s máx. |
| Electron no descarga el binario al `npm install` | Revisa la clave `allowScripts` en `package.json`. |
| La carpeta está en OneDrive y da errores al compilar | OneDrive bloquea archivos en uso. Mueve el proyecto a una ruta local (p. ej. `C:\dev\centinela`). |

---

## Changelog

### v1.0.0
- App inicial *Conflict Radar 360*.
- Renombrado a **Centinela BETA**.
- Pantalla de carga con logo y texto de la Intra-net.
- Icono y empaquetado NSIS.
- Bloqueo de anuncios (EasyList + EasyPrivacy).
- Menú nativo: se añade **World Monitor** y atajos de cambio de web (Ctrl+1 / Ctrl+2).
- **Pantalla de inicio** con tarjetas para elegir cada web (Ctrl+H / menú Centinela).
- Se añaden **EC NEWS**, **EC Terminal Data** y **Radio Garden** (Ctrl+4, Ctrl+5, Ctrl+6).
- **"Sobre el programa"** movido al menú Ayuda con enlace a Estalingrado Corp.
- **Logo de Estalingrado Corp** y tema de interfaz **azul/negro**.
- **Interruptor "Encriptar la Intra-Net"** junto al reloj.
- **Imágenes personalizadas** en las tarjetas de Palantir, EC NEWS y EC Terminal Data.
- Se añaden **EC Send Pro** y **Famelack** (Ctrl+7, Ctrl+8).
- **Ventana nativa de Windows** con menú clásico siempre visible (Centinela, Ver, Ayuda).
- Se añade **War Watch** junto a Palantir (Ctrl+2) y se mejoran los iconos de todas las plataformas con sus favicons oficiales.
- **Arquitectura `WebContentsView`**: cada plataforma se renderiza en una vista aislada, con mejor rendimiento y gestión de vistas pendientes/cargadas.
- **User-Agent de Chrome 124** aplicado a la sesión por defecto para evitar bloqueos anti-bot (Cloudflare).
- **Pantalla completa por defecto** al abrir la app.
- **Fondo de estrellas animado** (canvas 2D) en la pantalla de inicio, con soporte `prefers-reduced-motion`.
- **Toggle "Encriptar la Intra-Net"** funcional: LED e indicadores de red cambian a azul y el estado pasa a *SYS.ENCRYPTION ACTIVE*.
- **Monitoreo de conectividad** por plataforma vía `HEAD` con timeout de 5 s, con estado agregado (*ONLINE / PARCIAL / SIN CONEXIÓN*) en el pie.
- **Splash más rápido** (mínimo 1,8 s) con spinner circular y rediseño del *renderer.html*.
- Se retiran **Palantir**, **War Watch**, **Conflict Radar 360** y **World Monitor**; entran **Osiris AI**, **OpenGrid Works** y **Provenance**.
- **Nuevo icono de la app**: "C" con aguja de brújula sobre fondo oscuro con borde azul. Se aplica al `.exe`, a la barra de tareas y al instalador NSIS. El pipeline queda en `make-icon.js` (lee `Imagenes/Iconos/icono/icono.png`).
- **Nueva plataforma: Drive & Listen** (Ctrl+9) — recorridos virtuales por 100+ ciudades con radio local. Grid de inicio ajustado a 3 columnas (3×3).
- **Teleprompter de última hora** en el inicio (RSS de 8 agencias, titulares en azul y en rojo cuando son urgentes, clic para abrir la noticia).
- **Orden de plataformas reordenado**: EC NEWS (Ctrl+2) junto a EC Terminal Data (Ctrl+1) y EC Send Pro (Ctrl+3) justo después.
- **27/10/2026: se elimina el módulo Centinela Globe (WorldWideView)** de la app: tarjeta, atajo Ctrl+0, menú, loader `globe.html`, `globe-preload.js` y toda la lógica de Docker/auto-login. La app queda con 9 plataformas (Ctrl+1–9). El proyecto `..\worldwideview` y su instancia Docker quedan intactos en disco, fuera de Centinela.
