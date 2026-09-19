// src/main/main.js
//
// Proceso principal de Electron. Aquí vive la "magia" que hace posible
// un personaje suelto en el escritorio de Windows:
//
//   1) frame: false      -> sin barra de título ni bordes de ventana
//   2) transparent: true -> el fondo de la ventana es 100% transparente
//   3) alwaysOnTop: true -> el personaje flota sobre las demás ventanas
//   4) skipTaskbar: true -> no aparece un ícono de app en la barra de tareas
//
// El resultado: en pantalla solo se ve el personaje (dibujado en HTML/CSS/SVG
// con fondo transparente), nunca un rectángulo blanco ni una ventana "normal".

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, net } = require('electron');
const path = require('node:path');

// Tamaño del "lienzo" donde vive el personaje + su burbuja de chat.
// Se agrandó (antes 260x330) para que la burbuja tenga espacio real donde
// mostrar respuestas largas del agente (pasos numerados, listas, etc.)
// sin quedar apretada. El resto del lienzo sigue siendo transparente y
// deja pasar los clics al escritorio (ver agent:set-ignore-mouse).
const CHARACTER_WIDTH = 380;
const CHARACTER_HEIGHT = 600;

// URL del webhook de PRODUCCIÓN del workflow "Chat del agente" en n8n
// (la que empieza con /webhook/, no /webhook-test/). Si cambia la IP de tu
// servidor o el path del webhook, solo hay que actualizar esta línea.
const AGENT_WEBHOOK_URL = 'http://192.168.105.129:5678/webhook/agente-chat';

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;

// Estado simple en memoria (se ampliará más adelante: URL del webhook de n8n, etc.)
const state = {
  clickThrough: false,
  alwaysOnTop: true,
};

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: CHARACTER_WIDTH,
    height: CHARACTER_HEIGHT,
    x: screenWidth - CHARACTER_WIDTH - 40,
    y: screenHeight - CHARACTER_HEIGHT - 40,

    // --- El truco técnico de la ventana "suelta" ---
    frame: false,             // sin barra de título ni bordes
    transparent: true,        // fondo 100% transparente (no blanco/negro)
    backgroundColor: '#00000000', // transparencia explícita (ARGB)
    hasShadow: false,         // sin la sombra rectangular que Windows añade
    resizable: false,
    movable: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,        // flota sobre el resto de ventanas
    skipTaskbar: true,        // no ocupa espacio en la barra de tareas
    show: false,               // se muestra cuando el contenido ya cargó (evita "flash")
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),

    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,  // aísla el renderer de Node.js (seguridad)
      nodeIntegration: false,  // el renderer NUNCA debe tocar Node directamente
      sandbox: true,
    },
  });

  // Nivel "screen-saver" hace que se mantenga por encima incluso de ventanas
  // en pantalla completa de otras apps (ajustable si no lo quieres tan agresivo).
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Por defecto TODA la ventana recibe clics. Como el personaje no ocupa
  // los 240x320 completos (hay márgenes transparentes alrededor para la
  // burbuja de chat), el renderer nos avisa por IPC quién debe recibir el
  // mouse y quién debe ser "transparente al clic" (ver ipcMain.on('agent:set-ignore-mouse') abajo).

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Ícono del pavo real (el personaje) recortado a cuadrado, para la bandeja.
  const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Respaldo mínimo por si el archivo no se encontró (no debería pasar).
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR4' +
        '2mNkYGD4z0AEYBxVSF9FMFQF/6EK/kMV/IcqGDIKGBkZGRkYGBgYAJC5BAVoRRvUAAAAAElFTkSuQmCC'
    );
  }

  tray = new Tray(icon);
  tray.setToolTip('Desktop Agent');

  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow && mainWindow.isVisible() ? 'Ocultar personaje' : 'Mostrar personaje',
        click: () => {
          if (!mainWindow) return;
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
          rebuildMenu();
        },
      },
      {
        label: 'Siempre visible (always-on-top)',
        type: 'checkbox',
        checked: state.alwaysOnTop,
        click: (menuItem) => {
          state.alwaysOnTop = menuItem.checked;
          mainWindow?.setAlwaysOnTop(state.alwaysOnTop, 'screen-saver');
        },
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuildMenu();
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// --- IPC: comunicación segura entre el renderer (UI del personaje) y este proceso ---

// El renderer nos dice sobre qué zonas de la ventana debe "pasar" el clic
// hacia el escritorio (zonas transparentes) y sobre cuáles debe capturarlo
// (el propio personaje / la burbuja de chat). Esto es lo que permite que el
// resto de la ventana transparente no bloquee clics en el escritorio.
ipcMain.on('agent:set-ignore-mouse', (_event, ignore) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

// --- Arrastre manual del personaje ---
//
// No usamos -webkit-app-region: drag porque en Windows eso hace que el
// sistema operativo se quede con el mousedown para mover la ventana, y el
// evento "click" de Chromium deja de dispararse de forma confiable (por
// eso la burbuja de chat no se abría). En su lugar, el renderer nos manda
// coordenadas de pantalla del mouse y nosotros reposicionamos la ventana
// nosotros mismos — un clic corto sin movimiento sigue siendo un clic normal.
let dragOrigin = null; // { windowX, windowY, mouseX, mouseY }

ipcMain.on('agent:drag-start', (_event, { mouseX, mouseY }) => {
  if (!mainWindow) return;
  const [windowX, windowY] = mainWindow.getPosition();
  dragOrigin = { windowX, windowY, mouseX, mouseY };
});

ipcMain.on('agent:drag-move', (_event, { mouseX, mouseY }) => {
  if (!mainWindow || !dragOrigin) return;
  const deltaX = mouseX - dragOrigin.mouseX;
  const deltaY = mouseY - dragOrigin.mouseY;
  mainWindow.setPosition(dragOrigin.windowX + deltaX, dragOrigin.windowY + deltaY);
});

ipcMain.on('agent:drag-end', () => {
  dragOrigin = null;
});

// --- Menú rápido con clic derecho sobre el personaje ---
//
// Forma rápida y visible de "ocultarlo cuando no lo necesites" sin tener
// que buscar el ícono en la bandeja del sistema. Para volver a mostrarlo,
// se usa el ícono de la bandeja (clic simple, o el menú "Mostrar personaje").
ipcMain.on('agent:show-context-menu', () => {
  if (!mainWindow) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Ocultar personaje',
      click: () => mainWindow?.hide(),
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => app.quit(),
    },
  ]);
  menu.popup({ window: mainWindow });
});

// --- Ocultar el personaje desde el botón "minimizar" de la burbuja ---
//
// Forma directa y descubrible de ocultar el agente (sin depender de que el
// usuario sepa que existe el clic derecho). Es el mismo efecto que "Ocultar
// personaje" del menú de arriba: oculta toda la ventana. Para volver a
// mostrarlo, se usa el ícono de la bandeja del sistema.
ipcMain.on('agent:hide', () => {
  mainWindow?.hide();
});

// Llama al workflow "Chat del agente" en n8n: le manda el texto que
// escribió el usuario en la burbuja y espera de vuelta { text: "..." }.
// n8n internamente busca en Qdrant (base de conocimiento) y genera la
// respuesta con Gemini — aquí solo hacemos la llamada HTTP y manejamos
// los casos en que el servidor no responda (apagado, red caída, etc.).
//
// Importante: usamos net.fetch() (el fetch propio de Electron, que corre
// sobre el motor de red de Chromium) en vez del fetch global de Node.js.
// En Windows, el fetch de Node dentro del proceso principal a veces se
// queda "colgado" sin error ni timeout ante ciertas configuraciones de
// antivirus/red — el mismo síntoma que viste (se agotaban los 30s sin
// respuesta) aunque el mismo request funcionara al instante desde
// PowerShell o el navegador. net.fetch() usa el mismo motor que el
// navegador, evitando esa discrepancia.
ipcMain.handle('agent:send-message', async (_event, userText) => {
  // Por si el n8n tarda demasiado o se queda colgado, no dejamos la
  // burbuja esperando para siempre: abortamos a los 30 segundos.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await net.fetch(AGENT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText }),
      signal: controller.signal,
    });

    // Leemos el cuerpo como texto plano primero (en vez de response.json()
    // directamente): así, si no es JSON válido, podemos mostrar el
    // contenido real recibido en vez de un error genérico "Unexpected end
    // of JSON input" que no dice nada sobre la causa.
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `n8n respondió con estado ${response.status}. Cuerpo: ${rawBody ? rawBody.slice(0, 300) : '(vacío)'}`
      );
    }

    if (!rawBody) {
      throw new Error(
        'n8n respondió con éxito (200) pero con el cuerpo vacío. Revisa el nodo "Respond to Webhook": ' +
          'su "Response Body" debe tener contenido (por ejemplo {{ JSON.stringify({ text: $json.response }) }}).'
      );
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`La respuesta de n8n no es JSON válido. Contenido recibido: "${rawBody.slice(0, 300)}"`);
    }

    if (typeof data.text !== 'string') {
      throw new Error(
        `La respuesta de n8n no tiene el formato esperado ({ text: "..." }). Recibido: ${rawBody.slice(0, 300)}`
      );
    }

    return { text: data.text };
  } catch (error) {
    // No dejamos que un error de red tumbe el proceso principal: se lo
    // devolvemos al renderer como un mensaje legible dentro de la burbuja.
    const reason =
      error.name === 'AbortError'
        ? 'El servidor tardó demasiado en responder (más de 30s).'
        : error.message || 'Error desconocido.';
    console.error('[agent:send-message] Falló la llamada a n8n:', error);
    return {
      text: `⚠️ No pude conectarme con el agente (n8n). Detalle: ${reason}\n\nVerifica que el contenedor de n8n esté corriendo y que el workflow "Chat del agente" esté publicado.`,
    };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.on('app:quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// En Windows/Linux, cerrar todas las ventanas normalmente cierra la app.
// Como este es un agente de bandeja, preferimos mantenerlo vivo salvo que
// el usuario elija "Salir" explícitamente desde el tray.
app.on('window-all-closed', () => {
  // no-op a propósito
});
