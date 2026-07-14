// Constantes livianas, sin dependencias pesadas. Separado de env-config.js
// (que sí importa @xenova/transformers) para que el content script no
// arrastre todo el runtime ONNX solo por leer una constante — ese runtime
// solo lo necesita el worker, que es quien realmente transcribe.

export const AVAILABLE_MODELS = {
  tiny: { id: "Xenova/whisper-tiny", label: "Rápido (tiny, ~40 MB)" },
  base: { id: "Xenova/whisper-base", label: "Balanceado (base, ~80 MB)" },
  small: { id: "Xenova/whisper-small", label: "Preciso (small, ~250 MB)" },
};

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS.tiny.id;
export const SAMPLE_RATE = 16000;
