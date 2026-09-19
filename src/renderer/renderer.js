// src/renderer/renderer.js
//
// Lógica de la interfaz: mostrar/ocultar la burbuja de chat, enviar mensajes
// al proceso principal (por ahora un eco simulado) y, sobre todo, decidir en
// cada momento si esta ventana debe "capturar" el mouse o dejarlo pasar hacia
// el escritorio (click-through). Esto es lo que hace que el personaje se
// sienta "suelto": solo él (y su burbuja) reaccionan al mouse.

const character = document.getElementById('character');
const characterImg = document.getElementById('character-img');
const statusBadge = document.getElementById('status-badge');
const bubble = document.getElementById('bubble');
const bubbleMinimize = document.getElementById('bubble-minimize');
const bubbleClose = document.getElementById('bubble-close');
const bubbleForm = document.getElementById('bubble-form');
const bubbleInput = document.getElementById('bubble-input');
const bubbleLog = document.getElementById('bubble-log');

// --- Poses / "expresiones" del personaje ---
//
// Hoy tenemos dos ilustraciones del mismo pavo real: de frente con el
// abanico abierto (la de siempre) y de perfil (la que nos pasaste). Cada
// "estado" del agente puede usar una de las dos, además de su propia
// animación y color de brillo (ver style.css). Si más adelante consigues
// más poses (caminando, abanico cerrado, etc.), solo hay que agregarlas
// aquí y a la carpeta assets/ — el resto del sistema ya las soporta.
//
// Nota sobre la dirección: la ventana se coloca pegada a la esquina
// inferior derecha de la pantalla (ver CHARACTER_WIDTH/x en main.js), así
// que usamos la pose de perfil mirando hacia la IZQUIERDA (hacia el resto
// del escritorio) en vez de la mirando a la derecha (hacia afuera de la
// pantalla) — se ve como si el personaje estuviera atento a tu escritorio,
// no dándole la espalda.
const FRONT_POSE = 'assets/peacock.png';
const PROFILE_POSE = 'assets/peacock-thinking.png'; // de perfil, mirando a la izquierda
const POSE_IMAGES = {
  idle: FRONT_POSE,
  greeting: FRONT_POSE,
  listening: PROFILE_POSE,
  thinking: PROFILE_POSE,
  speaking: FRONT_POSE,
  error: FRONT_POSE,
};

// Precargamos todas las imágenes al arrancar para que el primer cambio de
// pose no tenga que esperar a que el navegador la descargue del disco.
const preloadedImages = new Set();
Object.values(POSE_IMAGES).forEach((src) => {
  if (preloadedImages.has(src)) return;
  preloadedImages.add(src);
  const img = new Image();
  img.src = src;
});

const STATE_BADGES = {
  greeting: '✨',
  listening: '✏️',
  thinking: '💭',
  error: '⚠️',
};

const ALL_STATES = ['idle', 'greeting', 'listening', 'thinking', 'speaking', 'error'];

let currentState = 'idle';
let stateResetTimer = null;

/**
 * Cambia el "estado de ánimo" visible del personaje: su animación, el
 * color de su brillo, la pose (imagen) que usa y la insignia pequeña que
 * lo acompaña. Si se pasa autoResetMs, vuelve solo a "idle" después de
 * ese tiempo (útil para estados momentáneos como "hablando" o "error").
 */
function setCharacterState(state, { autoResetMs } = {}) {
  ALL_STATES.forEach((s) => character.classList.remove(`state-${s}`));
  character.classList.add(`state-${state}`);
  currentState = state;

  const nextSrc = POSE_IMAGES[state] || FRONT_POSE;
  if (characterImg.getAttribute('src') !== nextSrc) {
    characterImg.setAttribute('src', nextSrc);
  }

  const badgeText = STATE_BADGES[state] || '';
  statusBadge.textContent = badgeText;
  statusBadge.classList.toggle('visible', Boolean(badgeText));

  if (stateResetTimer) {
    clearTimeout(stateResetTimer);
    stateResetTimer = null;
  }
  if (autoResetMs) {
    stateResetTimer = setTimeout(() => setCharacterState('idle'), autoResetMs);
  }
}

// --- Click-through: por defecto la ventana deja pasar los clics ---
window.agentAPI.setIgnoreMouse(true);

function bindInteractiveZone(el) {
  el.addEventListener('mouseenter', () => window.agentAPI.setIgnoreMouse(false));
  el.addEventListener('mouseleave', () => window.agentAPI.setIgnoreMouse(true));
}
bindInteractiveZone(character);
bindInteractiveZone(bubble);

// --- Arrastrar el personaje / abrir la burbuja al hacer clic ---
//
// Implementado a mano (en vez de -webkit-app-region: drag) porque en
// Windows esa propiedad hace que el sistema operativo intercepte el
// mousedown para mover la ventana, y el evento "click" de Chromium deja de
// dispararse — eso era lo que impedía que la burbuja se abriera.
const DRAG_THRESHOLD_PX = 6; // movimiento mínimo para considerarlo "arrastre"
const CLICK_MAX_MS = 350; // duración máxima para considerarlo "clic corto"

let isDragging = false;
let dragStartedAt = 0;
let dragStartScreen = { x: 0, y: 0 };
let maxMoved = 0;

function onCharacterMouseDown(event) {
  if (event.button !== 0) return; // solo botón izquierdo
  isDragging = true;
  dragStartedAt = Date.now();
  dragStartScreen = { x: event.screenX, y: event.screenY };
  maxMoved = 0;
  window.agentAPI.dragStart({ mouseX: event.screenX, mouseY: event.screenY });
  document.addEventListener('mousemove', onDocumentMouseMove);
  document.addEventListener('mouseup', onDocumentMouseUp);
}

function onDocumentMouseMove(event) {
  if (!isDragging) return;
  maxMoved = Math.max(
    maxMoved,
    Math.hypot(event.screenX - dragStartScreen.x, event.screenY - dragStartScreen.y)
  );
  window.agentAPI.dragMove({ mouseX: event.screenX, mouseY: event.screenY });
}

function onDocumentMouseUp() {
  if (!isDragging) return;
  isDragging = false;
  document.removeEventListener('mousemove', onDocumentMouseMove);
  document.removeEventListener('mouseup', onDocumentMouseUp);
  window.agentAPI.dragEnd();

  const heldMs = Date.now() - dragStartedAt;
  const wasClick = maxMoved < DRAG_THRESHOLD_PX && heldMs < CLICK_MAX_MS;
  if (!wasClick) return; // fue un arrastre, no un clic: no abrir/cerrar burbuja

  bubble.classList.toggle('hidden');
  if (!bubble.classList.contains('hidden')) {
    bubbleInput.focus();
  }
}

character.addEventListener('mousedown', onCharacterMouseDown);

// --- Escuchando: el personaje reacciona cuando el usuario está escribiendo ---
bubbleInput.addEventListener('focus', () => {
  if (currentState === 'idle') setCharacterState('listening');
});
bubbleInput.addEventListener('blur', () => {
  if (currentState === 'listening') setCharacterState('idle');
});

// --- Envío de mensajes ---

// Escapa HTML antes de insertar cualquier texto vía innerHTML, para que ni
// el texto del usuario ni la respuesta de n8n/Gemini puedan inyectar
// etiquetas reales — solo las etiquetas que nosotros mismos generamos
// abajo (negrita, listas, párrafos) terminan en el HTML final.
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convierte el texto plano (con Markdown simple, que es como responde
// Gemini: **negrita**, listas con "-"/"*"/"1.") a HTML legible dentro de
// la burbuja, en vez de mostrar los asteriscos literales. Soporta lo
// esencial: negrita, cursiva, listas con viñetas, listas numeradas y
// párrafos — suficiente para respuestas del agente, sin depender de una
// librería externa (que no podemos cargar: la app no tiene acceso a
// internet para bajar paquetes, y el CSP bloquea scripts remotos).
function renderMarkdownToHtml(rawText) {
  const lines = escapeHtml(rawText).split('\n');
  const htmlParts = [];
  let listType = null; // 'ul' | 'ol' | null
  let paragraphLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length) {
      htmlParts.push(`<p>${paragraphLines.join('<br>')}</p>`);
      paragraphLines = [];
    }
  };
  const closeList = () => {
    if (listType) {
      htmlParts.push(`</${listType}>`);
      listType = null;
    }
  };
  const inlineFormat = (line) =>
    line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // **negrita**
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>'); // *cursiva*

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const orderedMatch = line.match(/^\d+[.)]\s+(.*)/);

    if (bulletMatch) {
      flushParagraph();
      if (listType !== 'ul') { closeList(); htmlParts.push('<ul>'); listType = 'ul'; }
      htmlParts.push(`<li>${inlineFormat(bulletMatch[1])}</li>`);
    } else if (orderedMatch) {
      flushParagraph();
      if (listType !== 'ol') { closeList(); htmlParts.push('<ol>'); listType = 'ol'; }
      htmlParts.push(`<li>${inlineFormat(orderedMatch[1])}</li>`);
    } else if (line === '') {
      closeList();
      flushParagraph();
    } else {
      closeList();
      paragraphLines.push(inlineFormat(line));
    }
  }
  closeList();
  flushParagraph();
  return htmlParts.join('');
}

// Crea un "globo" de mensaje (estilo WhatsApp) dentro de la burbuja.
function appendMessage(html, from) {
  const wrapper = document.createElement('div');
  wrapper.className = from === 'agent' ? 'msg msg-agent' : 'msg msg-user';
  wrapper.innerHTML = html;
  bubbleLog.appendChild(wrapper);
  bubbleLog.scrollTop = bubbleLog.scrollHeight;
  return wrapper;
}

function appendUserText(text) {
  return appendMessage(`<p>${escapeHtml(text)}</p>`, 'user');
}

function appendAgentText(text) {
  return appendMessage(renderMarkdownToHtml(text), 'agent');
}

// Indicador de "escribiendo…" (tres puntos animados) mientras esperamos la
// respuesta de n8n — se reemplaza por el mensaje real (o el de error) en
// cuanto llega la respuesta.
let typingIndicatorEl = null;

function showTypingIndicator() {
  typingIndicatorEl = document.createElement('div');
  typingIndicatorEl.className = 'msg msg-agent typing-indicator';
  typingIndicatorEl.innerHTML = '<span></span><span></span><span></span>';
  bubbleLog.appendChild(typingIndicatorEl);
  bubbleLog.scrollTop = bubbleLog.scrollHeight;
}

function removeTypingIndicator() {
  if (typingIndicatorEl) {
    typingIndicatorEl.remove();
    typingIndicatorEl = null;
  }
}

bubbleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = bubbleInput.value.trim();
  if (!text) return;

  appendUserText(text);
  bubbleInput.value = '';

  setCharacterState('thinking');
  showTypingIndicator();
  try {
    const response = await window.agentAPI.sendMessage(text);
    removeTypingIndicator();
    appendAgentText(response.text);

    // main.js prefija con "⚠️" los mensajes que en realidad son errores de
    // conexión (ver agent:send-message), así que el personaje reacciona
    // distinto según si la respuesta fue una respuesta real o un error.
    const isError = typeof response.text === 'string' && response.text.startsWith('⚠️');
    setCharacterState(isError ? 'error' : 'speaking', { autoResetMs: isError ? 1600 : 1800 });
  } catch (err) {
    removeTypingIndicator();
    appendAgentText('Ocurrió un error al contactar al agente.');
    setCharacterState('error', { autoResetMs: 1600 });
  }
});

// --- Cerrar la burbuja desde su propio botón (además de clic en el personaje) ---
bubbleClose.addEventListener('click', () => {
  bubble.classList.add('hidden');
});

// --- Minimizar: oculta todo el agente (personaje + burbuja), no solo la
// burbuja. Es el mismo efecto que el clic derecho, pero como ícono visible
// (la rayita "_" típica de Windows) es mucho más fácil de descubrir. ---
bubbleMinimize.addEventListener('click', () => {
  bubble.classList.add('hidden');
  window.agentAPI.hideAgent();
});

// --- Clic derecho sobre el personaje: menú para ocultarlo o salir ---
// Forma rápida de "ocultarlo cuando no lo necesites" sin tener que ir a
// buscar el ícono en la bandeja del sistema.
character.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.agentAPI.showContextMenu();
});

// Mensaje de bienvenida + pequeña animación de saludo al arrancar.
appendAgentText('¡Hola! Soy Kevin, un agente de la Javeriana Cali. ¿En qué puedo ayudarte hoy?');
setCharacterState('greeting', { autoResetMs: 1400 });
