// Web Worker: corre el modelo Whisper (WASM/ONNX) fuera del hilo principal,
// para que la escritura en el buscador y el scroll del chat nunca se congelen.
// El modelo se carga una sola vez y se reutiliza para todas las notas de voz.

import { pipeline } from "@xenova/transformers";
import "../lib/env-config.js";
import { MODEL_ID } from "../lib/env-config.js";

let transcriberPromise = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      progress_callback: (p) => postMessage({ type: "model-progress", progress: p }),
    });
  }
  return transcriberPromise;
}

self.onmessage = async (event) => {
  const { type, jobId, audio, language } = event.data;
  if (type !== "transcribe") return;

  try {
    const transcriber = await getTranscriber();
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
