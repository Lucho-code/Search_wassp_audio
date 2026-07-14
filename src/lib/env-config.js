// Configuración del runtime de @xenova/transformers. Solo la importa el
// worker (transcribe-worker.js) — es la única pieza que efectivamente corre
// el modelo. Objetivo: cero llamadas de red en tiempo de ejecución. El
// modelo se descarga UNA sola vez, durante la instalación
// (scripts/download-model.mjs), y queda embebido en la carpeta models/.
import { env } from "@xenova/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false; // el modelo ya vive empaquetado; no depender del cache del navegador
env.localModelPath = chrome.runtime.getURL("models/");
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("dist/");
