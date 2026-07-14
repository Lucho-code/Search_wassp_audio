// Service worker mínimo: valores por defecto al instalar y apertura de la
// página de opciones. Toda la lógica pesada (captura, transcripción, índice,
// búsqueda) vive en el content script, en el contexto de la pestaña de
// WhatsApp Web — no hace falta un service worker persistente para eso.

// Nota: "Xenova/whisper-tiny" duplica el valor de DEFAULT_MODEL_ID
// (src/lib/constants.js) como literal, a propósito: este bundle no importa
// @xenova/transformers para mantenerse liviano (el service worker no
// transcribe nada, solo fija valores por defecto al instalar).
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({
      enabled: true,
      excludedChats: [],
      language: "es",
      model: "Xenova/whisper-tiny",
    });
  }
});
