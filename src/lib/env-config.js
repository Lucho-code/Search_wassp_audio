// Configuración compartida de @xenova/transformers.
// Objetivo: cero llamadas de red en tiempo de ejecución.
// El modelo se descarga UNA sola vez, durante la instalación (scripts/download-model.mjs),
// y queda embebido en la carpeta models/ de la extensión.
import { env } from "@xenova/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false; // el modelo ya vive empaquetado; no depender del cache del navegador
env.localModelPath = chrome.runtime.getURL("models/");
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("dist/");

export const MODEL_ID = "Xenova/whisper-tiny";
export const SAMPLE_RATE = 16000;
