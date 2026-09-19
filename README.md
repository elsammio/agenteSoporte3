# Desktop Agent — Paso 1: el personaje flotante (Electron)

Este es el primer bloque funcional del proyecto: una app de Electron que
dibuja un personaje "suelto" en el escritorio de Windows, sin ventana
rectangular visible, que se puede arrastrar y al que se le puede escribir en
una burbuja de chat. **Ya está conectado a tu workflow "Chat del agente" en
n8n**: lo que escribas en la burbuja viaja por HTTP hasta tu servidor,
n8n busca en la base de conocimiento (Qdrant) y genera la respuesta con
Gemini, y esa respuesta real vuelve a mostrarse en la burbuja.

## 1. El truco técnico (para que entiendas qué hace cada pieza)

Microsoft Agent lograba el efecto de un personaje "suelto" dibujando
directamente sobre el escritorio con transparencia por regiones. En Electron
lo replicamos con tres propiedades de `BrowserWindow` (ver
`src/main/main.js`):

| Propiedad | Qué hace | Por qué importa |
|---|---|---|
| `frame: false` | Quita la barra de título y los bordes de Windows | Sin esto siempre verías un marco rectangular |
| `transparent: true` | El fondo de la ventana es 100% transparente en vez de blanco | Esto es lo que permite que solo se vea el personaje, no un rectángulo |
| `alwaysOnTop: true` | La ventana flota sobre las demás | Para que el personaje no quede "detrás" del Explorador, el navegador, etc. |
| `skipTaskbar: true` | No aparece ícono en la barra de tareas | Se siente como un habitante del escritorio, no como "otra ventana abierta" |

Un detalle importante que la mayoría de tutoriales de Microsoft Agent
"revivido" pasan por alto: **una ventana transparente sigue capturando el
mouse en toda su área**, aunque no se vea nada ahí. Si no se corrige, no
podrías hacer clic en los íconos del escritorio "detrás" del personaje. Lo
resolvemos con `setIgnoreMouseEvents()`:

- Por defecto, la ventana entera deja pasar los clics hacia el escritorio
  (`ignoreMouseEvents = true`).
- Cuando el mouse entra al personaje o a la burbuja de chat, el renderer le
  avisa al proceso principal (`agentAPI.setIgnoreMouse(false)`) y esa zona
  empieza a capturar clics normalmente.
- Al salir, vuelve a dejar pasar los clics.

Esto es exactamente el patrón que usan los overlays "click-through" de
juegos y widgets de escritorio en Windows.

## 2. Estructura del proyecto

```
msagent-electron/
├── package.json               # dependencias y configuración de electron-builder
├── src/
│   ├── main/
│   │   └── main.js            # proceso principal: ventana, tray, IPC
│   └── renderer/
│       ├── index.html         # estructura del personaje + burbuja de chat
│       ├── style.css          # apariencia, transparencia, animaciones
│       ├── renderer.js        # interacción (arrastrar, abrir chat, enviar mensajes)
│       └── preload.js         # puente seguro entre renderer y proceso principal
└── build/                     # (aquí va tu icon.ico cuando empaquetes el instalador)
```

**Seguridad:** el renderer corre con `contextIsolation: true` y
`nodeIntegration: false`. Nunca toca Node.js directamente; todo pasa por
`preload.js`, que expone solo un puñado de funciones controladas
(`setIgnoreMouse`, `sendMessage`, `dragStart/dragMove/dragEnd`,
`showContextMenu`, `quit`). Esto importa especialmente porque el personaje
muestra respuestas que vienen de un LLM — no quieres que texto generado por
IA pueda ejecutar código en tu PC (por eso el Markdown de las respuestas se
renderiza con un parser propio que escapa HTML antes de interpretarlo, ver
sección 6).

## 3. Cómo ejecutarlo en Windows

Requisitos: [Node.js](https://nodejs.org) LTS instalado (incluye `npm`).

```powershell
cd msagent-electron
npm install
npm start
```

Deberías ver el pavo real flotando cerca de la esquina inferior derecha de
tu pantalla, con una animación de "respiración" (sube y baja). Arrástralo
tomándolo con el mouse. Haz clic corto sobre él para abrir/cerrar la burbuja
de chat, escribe una pregunta sobre tu base de conocimiento y presiona
enviar: la app le manda el mensaje a tu n8n (variable `AGENT_WEBHOOK_URL` en
`src/main/main.js`), que responde con una respuesta real generada por Gemini
a partir de tus documentos.

> **Antes de probarlo:** confirma que el contenedor de n8n esté corriendo
> (`docker compose ps` en tu servidor) y que el workflow **"Chat del
> agente"** esté **Published** (no solo guardado) — un webhook de
> producción (`/webhook/...`, sin `-test`) solo responde si el workflow
> está publicado. Si `AGENT_WEBHOOK_URL` no coincide con la IP de tu
> servidor, edítala en `src/main/main.js` (línea ~24) antes de
> `npm start`.
>
> Si n8n no responde (apagado, IP incorrecta, workflow no publicado, etc.)
> la burbuja no se queda "colgada": a los 30 segundos muestra un mensaje de
> error explicando qué falló, en vez de fallar en silencio.

Hay un ícono en la bandeja del sistema (system tray) con un menú para
mostrar/ocultar el personaje, fijar "siempre visible" y salir.

> Nota sobre esta sesión en la nube: aquí no pude ejecutar `npm install`
> porque el entorno de este sandbox tiene bloqueado el acceso al registro de
> npm por política de seguridad (error 403). Sí validé la sintaxis de todos
> los archivos JS y JSON (`node --check`), pero la primera ejecución real
> del `npm install` y `npm start` la vas a hacer tú en tu Windows — es
> exactamente lo que harías de todas formas para tener la app corriendo en tu
> propia máquina.

## 4. Empaquetarlo como instalador de Windows (.exe)

Cuando quieras un instalador real para distribuir o instalar de forma
permanente (con auto-inicio, ícono propio, etc.):

```powershell
npm run dist
```

Esto usa `electron-builder` (ya configurado en `package.json`, sección
`"build"`) para generar un instalador NSIS en la carpeta `release/`. Antes
de hacerlo en serio, reemplaza `build/icon.ico` por un ícono real (hoy no
existe ese archivo, así que `npm run dist` fallará hasta que lo agregues o
quites esa línea de configuración).

## 5. Notas y próximos pasos

- El personaje ahora es la imagen del pavo real que enviaste
  (`src/renderer/assets/peacock.png`): le quité el fondo blanco de forma
  programática (detectando el blanco conectado al borde *y* los huecos
  blancos "atrapados" entre las plumas, para que no quedaran parches
  blancos flotando dentro del abanico) y lo dejé en PNG con transparencia
  real. También generé a partir de la misma imagen el ícono de la bandeja
  del sistema (`assets/tray.png` / `tray@2x.png`) y el ícono de la
  aplicación para Windows (`build/icon.ico`, multi-resolución 16–256px),
  así que el personaje es coherente en la ventana, en el tray y en el
  `.exe` que genera `npm run dist`.
- Hoy el personaje es una imagen estática (no tiene fotogramas de
  animación propios): el "movimiento" que ves es 100% CSS — un balanceo
  suave (`bob`) todo el tiempo, y un resplandor azul pulsante
  (`pulse-glow`) mientras "habla" (mientras espera/recibe respuesta del
  agente). Si más adelante quieres poses distintas (escuchando, pensando,
  saludando) lo ideal es tener varias imágenes/sprites (uno por pose) y
  hacer que `renderer.js` cambie el `src` de `#character-img` según el
  estado; puedo ayudarte a prepararlas cuando las tengas.
- **Poses y expresiones**: el personaje ahora tiene 6 "estados" que cambian
  su animación, el color de su brillo y a veces su pose, según lo que está
  pasando (todo en `renderer.js`, función `setCharacterState`):

  | Estado | Cuándo se activa | Pose | Brillo | Insignia |
  |---|---|---|---|---|
  | `idle` | En reposo | De frente | — | — |
  | `greeting` | Al abrir la app (una vez) | De frente | Dorado | ✨ |
  | `listening` | El usuario tiene el foco en el cuadro de texto | De perfil (mirando a la izquierda) | Celeste | ✏️ |
  | `thinking` | Esperando la respuesta de n8n | De perfil (mirando a la izquierda) | Violeta | 💭 |
  | `speaking` | La respuesta llegó bien | De frente | Celeste pulsante | — |
  | `error` | Falló la conexión con n8n | De frente | Rojo + sacudida | ⚠️ |

  La pose "de perfil" (`assets/peacock-thinking.png`) sale de la segunda
  imagen que nos pasaste (la misma ave, de costado) — le recorté el fondo
  transparente y ajusté el tamaño. La usamos mirando hacia la **izquierda**
  a propósito: la ventana se coloca pegada a la esquina inferior derecha de
  la pantalla (`CHARACTER_WIDTH`/`x` en `main.js`), así que mirando a la
  izquierda el personaje queda "de cara" al resto de tu escritorio en vez
  de mirando hacia afuera de la pantalla. También generé una versión
  reflejada (`assets/peacock-listening.png`, mirando a la derecha) por si
  algún día mueves la ventana al lado izquierdo de la pantalla — hoy no se
  usa, pero queda lista en `assets/`. Si más adelante consigues otras
  poses (abanico cerrado, caminando, etc.), solo hay que agregarlas a
  `assets/` y sumarlas al objeto `POSE_IMAGES` en `renderer.js` — el
  sistema de estados ya está listo para usarlas.
- El arrastre del personaje se implementa a mano (mousedown/mousemove +
  IPC a `main.js`, que reposiciona la ventana con `setPosition`), **no**
  con `-webkit-app-region: drag`. Ese modo nativo se probó primero pero en
  Windows hacía que el sistema operativo se quedara con el `mousedown` para
  mover la ventana, y el evento `click` de Chromium dejaba de dispararse —
  por eso la burbuja de chat no se abría al hacer clic. Con el arrastre
  manual, un clic corto sin movimiento (menos de ~6px y menos de 350ms)
  abre/cierra la burbuja, y un arrastre normal mueve la ventana; ambos
  funcionan de forma confiable.
- Estado del proyecto: (1) ✅ n8n + Qdrant corriendo en Docker en tu
  servidor Linux (con IP fija `192.168.105.129` en el VM), (2) ✅ workflows
  de n8n creados — "Ingesta de documentos" (PDF → Qdrant, con soporte para
  varios PDFs en un solo envío) y "Chat del agente" (Webhook → Qdrant →
  Gemini → respuesta), (3) ✅ `main.js` llama de verdad al webhook de
  producción de n8n, (4) ✅ base de conocimiento cargada y probada
  end-to-end desde la app, (5) ✅ burbuja de chat rediseñada (ver sección 6).
  Pendiente: arranque automático con Windows, y cuando quieras, seguir
  agregando fuentes a la base de conocimiento y exponer n8n a internet con
  dominio + HTTPS.

## 6. Chat más profesional (rediseño de la burbuja)

La burbuja de chat se rediseñó para que se vea y se sienta como una app de
mensajería real, no como una caja de texto genérica:

- **Encabezado propio**: la burbuja ahora tiene una franja superior azul
  con el título "Asistente" y un botón ✕ para cerrarla sin necesidad de
  volver a hacer clic sobre el personaje (`#bubble-header` en
  `index.html`/`style.css`).
- **Burbujas de mensaje estilo WhatsApp**: cada mensaje (tuyo o del agente)
  se dibuja como una burbuja independiente, alineada a la derecha (tú, en
  azul) o a la izquierda (el agente, en celeste claro), con una esquina
  "recortada" que simula la colita de la burbuja — igual que en WhatsApp o
  Telegram (clases `.msg`, `.msg-user`, `.msg-agent` en `style.css`).
- **Markdown real en las respuestas del agente**: si Gemini responde con
  `**negrita**`, `*cursiva*`, listas con `-`/`*` o listas numeradas
  (`1.`, `2.`...), ahora se ven formateadas de verdad (negrita, cursiva,
  viñetas) en vez de mostrar los símbolos tal cual. Esto lo hace un parser
  de Markdown escrito a mano en `renderer.js` (función
  `renderMarkdownToHtml`) — no se usó ninguna librería externa porque la
  política de seguridad de la app (`Content-Security-Policy: script-src
  'self'`) bloquea cargar scripts de internet, y este sandbox de
  desarrollo tampoco tiene acceso al registro de npm. El parser primero
  **escapa** todo el texto (convierte `<`, `>`, `&`, `"` a sus entidades
  HTML) y recién después interpreta la sintaxis Markdown, así que aunque la
  respuesta del LLM contenga código HTML o intente inyectar algo, nunca se
  ejecuta — solo se muestra como texto.
- **Ventana más grande**: `CHARACTER_WIDTH`/`CHARACTER_HEIGHT` en
  `main.js` pasaron de 260×330 a 380×600 para que la burbuja (ahora de
  340×400px) tenga espacio cómodo sin quedar apretada ni recortada.
- **Ocultar el personaje con clic derecho**: además del ícono de la bandeja
  del sistema, ahora puedes hacer **clic derecho sobre el personaje** para
  abrir un menú rápido con "Ocultar personaje" y "Salir"
  (`agent:show-context-menu` en `main.js` + `contextmenu` en
  `renderer.js`). Si lo ocultas así, para volver a mostrarlo usa el ícono
  de la bandeja del sistema (menú "Mostrar/Ocultar personaje") — el clic
  derecho es para ocultarlo rápido cuando estás full-screen o compartiendo
  pantalla, no reemplaza al tray.
- Verificado visualmente con capturas automatizadas (Playwright, sin
  necesidad de `npm install` en este sandbox): el encabezado, las burbujas
  de mensaje, el renderizado de listas/negrita/cursiva y una URL larga de
  prueba se ven correctamente sin desbordar el contenedor horizontalmente.
- **Mensaje de bienvenida y personalidad del agente**: el texto que
  aparece al abrir la burbuja ahora presenta al agente como "Kevin, un
  agente de la Javeriana Cali" (`renderer.js`, al final del archivo). Si
  quieres cambiar el nombre, la institución o el tono, ese es el único
  lugar que hay que tocar.
- **Botón de minimizar en el encabezado**: junto al botón de cerrar (✕)
  ahora hay un ícono "─" estilo Windows (`#bubble-minimize` en
  `index.html`/`style.css`). A diferencia del botón ✕ (que solo cierra la
  burbuja y deja el personaje visible), el botón de minimizar oculta **todo
  el agente** — mismo efecto que "Ocultar personaje" del clic derecho, pero
  visible y descubrible sin necesidad de saber que existe esa opción. Para
  volver a mostrarlo, se usa el ícono de la bandeja del sistema (igual que
  con el clic derecho).
