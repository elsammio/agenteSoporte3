// src/renderer/preload.js
//
// Puente seguro entre el proceso principal (Node.js) y el renderer (HTML/CSS/JS
// que dibuja al personaje). Con contextIsolation:true, el renderer NO tiene
// acceso a Node ni a Electron directamente; solo puede usar lo que exponemos
// aquí explícitamente vía contextBridge. Esto evita que, si algún día el
// personaje muestra contenido remoto (por ejemplo respuestas de n8n con HTML),
// ese contenido no pueda escapar y ejecutar código arbitrario en el sistema.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentAPI', {
  // Le dice al proceso principal si el mouse debe "atravesar" la ventana
  // (zonas transparentes) o si debe capturarlo (el personaje / la burbuja).
  setIgnoreMouse: (ignore) => ipcRenderer.send('agent:set-ignore-mouse', ignore),

  // Envía un mensaje del usuario y espera la respuesta del agente
  // (llama al webhook real de n8n — ver main.js).
  sendMessage: (text) => ipcRenderer.invoke('agent:send-message', text),

  // Arrastre manual del personaje (reemplaza -webkit-app-region: drag,
  // que en Windows impedía que el clic normal abriera la burbuja).
  dragStart: (pos) => ipcRenderer.send('agent:drag-start', pos),
  dragMove: (pos) => ipcRenderer.send('agent:drag-move', pos),
  dragEnd: () => ipcRenderer.send('agent:drag-end'),

  // Menú de clic derecho sobre el personaje (ocultar / salir).
  showContextMenu: () => ipcRenderer.send('agent:show-context-menu'),

  // Ocultar el personaje directamente (botón "minimizar" de la burbuja).
  hideAgent: () => ipcRenderer.send('agent:hide'),

  // Avisos de la "caminata" de entrada (ver WALK_ENTRANCE en main.js): el
  // proceso principal desliza la ventana real por el escritorio y nos
  // avisa cuándo empieza y cuándo termina, para sincronizar la pose y la
  // animación del personaje con el movimiento real de la ventana. No
  // exponemos ipcRenderer.on directamente (por seguridad); envolvemos cada
  // evento en su propia función para que el renderer solo pueda escuchar,
  // nunca mandar eventos arbitrarios de vuelta.
  onWalkStart: (callback) => ipcRenderer.on('agent:walk-start', () => callback()),
  onWalkEnd: (callback) => ipcRenderer.on('agent:walk-end', () => callback()),

  // Abrir un enlace externo (p. ej. wa.me) en el navegador/WhatsApp del
  // sistema, nunca dentro de la propia ventana de la app. main.js valida
  // el dominio antes de abrir nada (ver agent:open-external-link).
  openExternalLink: (url) => ipcRenderer.send('agent:open-external-link', url),

  // Nombre de usuario de Windows (ver OS_USER_NAME en main.js), para
  // personalizar el saludo inicial en el renderer.
  getUserName: () => ipcRenderer.invoke('agent:get-user-name'),

  quit: () => ipcRenderer.send('app:quit'),
});
