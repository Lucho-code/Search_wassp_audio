// Web Worker: corre el modelo Whisper (WASM/ONNX) fuera del hilo principal,
// para que la escritura en el buscador y el scroll del chat nunca se congelen.
// Cada modelo se carga una sola vez (por sesión de la pestaña) y se reutiliza.

import { pipeline } from "@xenova/transformers";
import "../lib/env-config.js";
import { DEFAULT_MODEL_ID } from "../lib/constants.js";

const transcribers = new Map(); // modelId -> Promise<pipeline>

function getTranscriber(modelId) {
  if (!transcribers.has(modelId)) {
    transcribers.set(
      modelId,
      pipeline("automatic-speech-recognition", modelId, {
        progress_callback: (p) => postMessage({ type: "model-progress", modelId, progress: p }),
      })
    );
  }
  return transcribers.get(modelId);
}

self.onmessage = async (event) => {
  const { type, jobId, audio, language, modelId } = event.data;
  if (type !== "transcribe") return;

  try {
    const transcriber = await getTranscriber(modelId || DEFAULT_MODEL_ID);
    const result = await transcriber(audio, {
      // Fijo en 'transcribe': jamás 'translate'. Así el texto queda en el idioma
      // original del audio, sin pasar por ningún traductor automático.
      task: "transcribe",
      language: language || undefined, // undefined = detección automática de idioma, no traducción
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    postMessage({ type: "result", jobId, text: (result?.text || "").trim() });
  } catch (err) {
    postMessage({ type: "error", jobId, error: String(err?.message || err) });
  }
};
