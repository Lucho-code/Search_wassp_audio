// Lectura de metadatos desde el DOM de WhatsApp Web.
// WhatsApp Web no expone una API pública: estos selectores son los mismos que usan
// desde hace años herramientas de exportación de chats (basadas en el atributo
// `data-pre-plain-text`, estable entre versiones). Si WhatsApp cambia su markup,
// solo hay que actualizar esta capa — el resto del plugin no depende del DOM.

export function getOpenChatName() {
  const header = document.querySelector('#main header');
  if (!header) return null;
  const titleEl = header.querySelector('span[title]');
  return titleEl?.getAttribute('title') || titleEl?.textContent || null;
}

export function getOpenChatId() {
  // No hay un id estable expuesto en el DOM sin engancharse al Store interno de WA,
  // lo cual es frágil entre versiones. Usamos el nombre del chat + panel activo como
  // clave lógica: es suficiente para agrupar resultados de búsqueda por conversación.
  return getOpenChatName() || 'unknown-chat';
}

/**
 * Dado un elemento <audio> de una nota de voz, sube al contenedor del mensaje
 * y extrae: id del mensaje, remitente y hora, a partir de `data-pre-plain-text`
 * (formato: "[10:32, 14/7/2026] Juan Pérez: ").
 */
export function extractMessageMeta(audioEl) {
  const bubble = audioEl.closest('[data-id]');
  const messageId = bubble?.getAttribute('data-id') || null;

  const copyable = bubble?.querySelector('.copyable-text[data-pre-plain-text]');
  const rawMeta = copyable?.getAttribute('data-pre-plain-text') || '';
  const match = rawMeta.match(/\[(.*?)\]\s*(.*?):\s*$/);

  const timestampText = match?.[1] || null;
  const sender = match?.[2] || (bubble?.classList.contains('message-out') ? 'Yo' : getOpenChatName());

  return { messageId, timestampText, sender };
}

export function findSearchInput() {
  return (
    document.querySelector('div[contenteditable="true"][aria-label="Search input textbox"]') ||
    document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
    document.querySelector('#side div[contenteditable="true"]')
  );
}

export function scrollToMessage(messageId) {
  const el = document.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background-color 0.3s';
    el.style.backgroundColor = 'rgba(0, 168, 132, 0.25)';
    setTimeout(() => (el.style.backgroundColor = ''), 1200);
  }
}
