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

  quit: () => ipcRenderer.send('app:quit'),
});
