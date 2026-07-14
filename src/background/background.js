// Service worker mínimo: valores por defecto al instalar y apertura de la
// página de opciones. Toda la lógica pesada (captura, transcripción, índice,
// búsqueda) vive en el content script, en el contexto de la pestaña de
// WhatsApp Web — no hace falta un service worker persistente para eso.

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({
      enabled: true,
      excludedChats: [],
      language: null,
    });
  }
});
