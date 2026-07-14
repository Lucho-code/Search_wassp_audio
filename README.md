# WhatsApp Web — Búsqueda en Audios

Extensión de navegador (Chrome/Edge/Brave, Manifest V3) que agrega a WhatsApp Web la
posibilidad de buscar por el **contenido hablado** de notas de voz, junto con los
resultados de texto que WhatsApp ya muestra.

No es un bot, no envía mensajes, no usa la API de WhatsApp Business. Es una extensión
de solo lectura que corre en tu propio navegador, sobre tu propia sesión de WhatsApp Web.

---

## 1. Enfoque elegido y por qué

WhatsApp expone dos superficies distintas y ninguna de las dos es un "sistema de
plugins" oficial:

| Opción | Qué es | Por qué se descartó / eligió |
|---|---|---|
| **WhatsApp Business Cloud API** | API HTTP de Meta para que empresas envíen/reciban mensajes de forma programática | No tiene concepto de "buscador" ni de interfaz de usuario: es mensajería servidor-a-servidor. No da acceso al historial de chats personales de un usuario, solo a los mensajes que llegan a un número de negocio. No sirve para este caso de uso. |
| **WhatsApp Web (cliente), vía extensión de navegador** ✅ | Extensión que se inyecta en `web.whatsapp.com` y actúa sobre el DOM que el propio cliente ya renderiza | Es la única forma de "interceptar la búsqueda del usuario" en el sentido literal del pedido: hay un cuadro de búsqueda real, con resultados reales, que se puede complementar. Además permite operar 100% del lado del cliente, sin backend propio. |

**Elegido: extensión de navegador para WhatsApp Web.**

Consideración importante: esta es una integración **no oficial** (como la mayoría de
extensiones de productividad para WhatsApp Web que existen hoy). No se automatiza el
envío de mensajes, no se hacen requests a servidores de WhatsApp fuera de lo que el
propio cliente ya hace, y no se altera el protocolo de cifrado. Aun así, es responsabilidad
de quien la instale revisar los Términos de Servicio de WhatsApp antes de usarla.

### Cómo se obtiene el audio sin tocar el cifrado E2E

WhatsApp Web descifra las notas de voz **en el navegador** para poder reproducirlas: el
elemento `<audio>` del mensaje termina apuntando a un `blob:` URL local, ya en texto
plano. La extensión no rompe ni interfiere con el cifrado de WhatsApp — simplemente lee,
con `fetch()`, un recurso `blob:` que el propio WhatsApp Web ya dejó disponible en el
documento para reproducir el audio. Nunca se hace ninguna petición de red para obtener
el audio.

Por eso, además, **la extensión nunca fuerza la reproducción de una nota de voz que el
usuario no escuchó**: eso generaría el "doble check" de reproducido en la cuenta del
usuario, un efecto colateral indeseado. Solo se indexan notas de voz ya reproducidas al
menos una vez durante la sesión (ver limitaciones al final).

---

## 2. Transcripción vs. metadatos — decisión

Se implementó **transcripción de voz a texto**, no solo metadatos, por una razón simple:
el pedido es "buscar dentro del contenido de audios". Los metadatos (remitente, hora,
duración) ya son buscables indirectamente con la búsqueda nativa de WhatsApp (por nombre
de contacto, por fecha en el scroll). Lo que falta — y lo que agrega valor real — es
poder escribir "reunión del viernes" y encontrar la nota de voz donde alguien dijo esa
frase.

- **Motor**: [`@xenova/transformers`](https://github.com/xenova/transformers.js) corriendo
  **Whisper** (OpenAI Whisper, puerto a ONNX) enteramente en WASM, dentro de un Web Worker
  del navegador. Es la misma arquitectura que ya usa el bot de Telegram de este repo
  (`bot.py` de `attendance-bot`, ver `openai-whisper` en su `requirements.txt`), aquí
  adaptada a un entorno sin backend: todo corre client-side. Por defecto se usa
  **whisper-tiny** (rápido, ~40 MB); desde el popup de la extensión se puede elegir
  **base** o **small** si antes se descargaron (ver sección 7).
- **Nunca traducción**: la tarea se fija explícitamente en `task: "transcribe"` en
  `src/worker/transcribe-worker.js` — jamás `"translate"`. El texto queda siempre en el
  idioma original del audio, pase lo que pase.
- **Idioma fijado en español por defecto**: como el uso esperado es mayormente audios en
  español, el idioma viene fijo en `"es"` (se salta el paso de autodetección de Whisper:
  más rápido y más preciso en notas de voz cortas, que es la mayoría). Se puede cambiar a
  automático o a otro idioma desde Opciones — igual sigue siendo siempre "transcribir", no
  "traducir".
- **Metadatos igual se guardan** (remitente, chat, timestamp) para poder mostrar contexto
  y agrupar resultados, pero no reemplazan la transcripción — la complementan.

---

## 3. Formatos de audio soportados

WhatsApp usa mayormente **OGG/Opus** para notas de voz grabadas en la app, y **M4A/AAC**
o **MP3** para audios compartidos/reenviados desde otras fuentes. La extensión no
implementa un decodificador propio: delega la decodificación en la Web Audio API
(`AudioContext.decodeAudioData`), que en Chrome/Edge soporta nativamente OGG/Opus, M4A/AAC,
MP3, WAV y WebM. Esto cubre la totalidad de los formatos que WhatsApp Web puede reproducir
en el propio navegador — si el navegador puede reproducirlo, la extensión puede
transcribirlo.

---

## 4. Cómo se mantiene rápida la búsqueda

La transcripción **no ocurre en el momento de buscar**. Ocurre antes, de forma
perezosa y en segundo plano:

1. Mientras navegás tus chats normalmente, un `MutationObserver` detecta notas de voz ya
   reproducidas.
2. Cada audio detectado se encola (`TranscriptionQueue` en `src/content/index.js`) y se
   procesa de a uno, en tiempo ocioso del navegador (`requestIdleCallback`), dentro de un
   **Web Worker** — nunca en el hilo principal, así el chat y la búsqueda nunca se traban.
3. El resultado se guarda en **IndexedDB** junto con un índice invertido en memoria
   (`src/lib/db.js`).
4. Cuando escribís en el buscador, la extensión **solo consulta el índice ya construido**
   (una búsqueda por hash/substring sobre texto ya transcripto) — es instantánea, no
   dispara ninguna transcripción nueva.

En otras palabras: el costo de la IA (que es lo lento) está totalmente desacoplado del
costo de la búsqueda (que es lo que tiene que ser rápido).

Por defecto la búsqueda es **global** (todos los chats, igual que WhatsApp cuando no hay
un chat en foco). El panel de resultados tiene un toggle **"solo este chat"** para acotarla
al chat que tenés abierto.

### Resiliencia al cambiar de chat

WhatsApp Web es una SPA: al abrir otra conversación puede reemplazar por completo el
contenedor del chat (`#main`) en vez de solo vaciar su contenido. Si eso pasara, el
`MutationObserver` que vigila las notas de voz quedaría mirando un nodo ya desconectado del
DOM. Para blindarlo, `AudioCapture` (`src/content/audio-capture.js`) hace un chequeo liviano
cada 3 segundos (`setInterval`, solo compara una referencia de nodo) y re-adjunta el
observer si `#main` cambió — sin esto, la detección de audios nuevos podría dejar de
funcionar silenciosamente después de navegar entre chats.

---

## 5. Privacidad

- El audio **nunca sale del navegador**. La transcripción corre localmente vía WASM.
- El texto transcripto se guarda solo en el `IndexedDB` de tu perfil de navegador, en el
  origen `web.whatsapp.com` — no se sincroniza a ningún servidor.
- La única conexión de red del proyecto es la descarga **inicial y única** del modelo
  Whisper-tiny (~40 MB) durante la instalación (`npm run download-model`), necesaria
  porque el modelo no cabe razonablemente en el repositorio de Git. Después de ese paso,
  la extensión corre completamente offline (`env.allowRemoteModels = false` en
  `src/lib/env-config.js` lo hace imposible en runtime).
- Podés excluir chats sensibles desde la página de Opciones para que jamás se indexen.
- El botón "Borrar índice local" del popup elimina todo lo transcripto.

---

## 6. Estructura de carpetas

```
.
├── manifest.json              # Manifest V3
├── package.json
├── scripts/
│   ├── download-model.mjs     # Descarga Whisper-tiny una sola vez (paso de instalación)
│   └── build.mjs              # Empaqueta content/worker/background con esbuild
├── src/
│   ├── lib/
│   │   ├── env-config.js      # Config de transformers.js: sin red en runtime
│   │   ├── db.js              # IndexedDB + índice invertido + búsqueda
│   │   └── dom-utils.js       # Lectura de metadatos del DOM de WhatsApp Web
│   ├── content/
│   │   ├── index.js           # Entry point: arranca captura, cola, índice, UI
│   │   ├── audio-capture.js   # Detecta y decodifica notas de voz ya reproducidas
│   │   ├── search-ui.js       # Panel de resultados bajo el buscador nativo
│   │   └── styles.css
│   ├── worker/
│   │   └── transcribe-worker.js  # Whisper-tiny en un Web Worker (WASM)
│   └── background/
│       └── background.js      # Valores por defecto al instalar
├── popup/                     # Toggle on/off, estadísticas, borrar índice
├── options/                   # Idioma, chats excluidos
├── models/                    # (generado) pesos de Whisper descargados + manifest.json
└── dist/                      # (generado) JS empaquetado, listo para cargar
```

---

## 7. Instalación (WhatsApp Web, Chrome/Edge/Brave)

**Requisitos**: Node.js 18+, y Chrome/Edge/Brave actualizado (Manifest V3, `world` de
content scripts requiere Chrome 111+).

```bash
git clone https://github.com/lucho-code/search_wassp_audio.git
cd search_wassp_audio
npm install
npm run setup      # descarga el modelo (única vez, con internet) + build
```

Luego, cargar la extensión sin empaquetar:

1. Abrir `chrome://extensions` (o `edge://extensions`).
2. Activar **"Modo de desarrollador"**.
3. **"Cargar descomprimida"** → seleccionar la carpeta del repo clonado.
4. Abrir o recargar `https://web.whatsapp.com`.

A partir de acá:
- Navegá tus chats normalmente; las notas de voz que reproduzcas se indexan solas en
  segundo plano.
- Escribí en el buscador de WhatsApp Web como siempre: debajo de los resultados nativos
  vas a ver un panel **"🎙️ Coincidencias en notas de voz"** con las notas donde aparece
  ese texto. Click en un resultado para saltar directo al mensaje en el chat.
- Click en el ícono de la extensión (popup) para ver cuántas notas están indexadas,
  desactivarla, elegir el modelo, o borrar el índice local.

### Elegir un modelo más preciso (base / small)

Por defecto solo se descarga **tiny**. Para tener **base** o **small** disponibles como
opción en el popup:

```bash
npm run download-model -- --models=tiny,base,small
npm run build
```

El popup solo muestra, en el selector, los modelos que efectivamente estén en `models/`
(lee `models/manifest.json`) — así nunca ofrece una opción que fallaría por no estar
descargada. Cambiar el modelo desde el popup pide recargar la pestaña de WhatsApp Web para
aplicarse (el Worker ya está corriendo con el modelo anterior).

### Reconstruir tras un cambio de código

```bash
npm run build   # recompila JS; no vuelve a descargar el modelo si ya está en models/
```

Después de `npm run build`, recargar la extensión desde `chrome://extensions` (botón de
recarga) y refrescar la pestaña de WhatsApp Web.

---

## 8. Tests

```bash
npm test
```

Corre `test/run.mjs`: levanta un Chromium real (vía Playwright) contra
`test/fixtures/whatsapp-fake.html`, un DOM que imita los puntos concretos de WhatsApp Web
que el plugin toca (`#main`/`header`, burbujas con `data-id` + `data-pre-plain-text`,
`<audio>`, buscador `contenteditable`). Sobre ese DOM corren las clases **reales**
(`AudioCapture`, `SearchUI`, `TranscriptIndex`, `dom-utils`) — no hay mocks de DOM,
`IndexedDB`, `MutationObserver` ni `AudioContext`: son los del navegador. Se genera un WAV
válido en memoria para que `fetch()` + `decodeAudioData()` corran sobre audio real, no un
`src` inventado.

Cubre: extracción de metadatos desde el DOM, deduplicación, resiliencia cuando WhatsApp
reemplaza `#main` al cambiar de chat, tokenización/normalización de tildes, XSS en
transcripciones (un transcript con `<img onerror=...>` no debe ejecutarse), resaltado de
coincidencias, el toggle "solo este chat", y el click en resultados (tanto el caso feliz
como cuando el mensaje no está en el chat abierto).

**Lo que no prueba**: la transcripción real con Whisper. Eso requiere el modelo descargado
(`npm run download-model`, con internet) corriendo dentro de un Worker; el test reemplaza
ese paso por un stub que simula un resultado exitoso, para poder validar todo el resto del
pipeline rápido y sin red. Tampoco se probó contra una sesión real de `web.whatsapp.com`
(ver limitaciones abajo sobre los selectores del DOM).

---

## 9. Limitaciones conocidas

- **Solo se indexan notas de voz ya reproducidas** en la sesión del navegador. Es una
  decisión deliberada: auto-reproducir audios para indexarlos marcaría los mensajes como
  "escuchados" ante el remitente, un efecto colateral no deseado sobre la cuenta del
  usuario. El índice crece con el uso normal de WhatsApp, no de forma retroactiva
  instantánea sobre todo el historial.
- Los selectores del DOM (`src/lib/dom-utils.js`) dependen de la estructura HTML actual
  de WhatsApp Web (en particular el atributo `data-pre-plain-text`, usado desde hace años
  por herramientas de exportación de chats). Si WhatsApp cambia su markup, puede requerir
  un ajuste puntual en ese archivo — el resto del plugin no se ve afectado. No se probó
  contra una sesión real de WhatsApp Web durante el desarrollo; si algo no detecta audios
  o no engancha el buscador, lo primero a revisar es si esos selectores siguen vigentes.
- `chatId` se deriva del nombre visible del chat (no hay un ID estable expuesto en el DOM
  sin engancharse al Store interno de WhatsApp, mucho más frágil entre versiones). Dos
  chats con el mismo nombre comparten `chatId`: no afecta la búsqueda (cada nota de voz
  tiene su propio `messageId` único), pero sí puede mezclar el toggle "solo este chat" o la
  exclusión de chats entre ellos.
- La búsqueda es global (todos los chats), pero clickear un resultado de un chat que **no**
  es el que tenés abierto no navega ahí automáticamente — no hay una forma confiable de
  simular ese click en la lista de chats de WhatsApp sin agregar más selectores frágiles.
  En ese caso el panel se queda abierto y muestra un aviso ("Abrí ese chat para ver este
  mensaje") en vez de fallar en silencio. Si el resultado es del chat ya abierto, el click
  sí hace scroll directo al mensaje.
- El índice vive en el navegador/perfil donde se instaló la extensión; no se sincroniza
  entre dispositivos.
- El modelo por defecto (whisper-tiny) prioriza velocidad sobre precisión. Se puede elegir
  base o small desde el popup una vez descargados (ver sección 7).
