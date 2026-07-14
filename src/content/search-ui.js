// Se engancha a la caja de búsqueda nativa de WhatsApp Web y agrega, debajo de
// los resultados propios de WhatsApp, un panel con las coincidencias encontradas
// dentro de transcripciones de audio. No reemplaza ni modifica la búsqueda nativa:
// solo la complementa (WhatsApp no expone una API para intervenir su propio motor
// de búsqueda de texto).

import { findSearchInput, scrollToMessage, getOpenChatId } from "../lib/dom-utils.js";
import { normalize } from "../lib/db.js";

const PANEL_ID = "wa-audio-search-panel";
const DEBOUNCE_MS = 180;

export class SearchUI {
  constructor({ index }) {
    this.index = index;
    this.debounceTimer = null;
    this.currentInput = null;
    this.mo = null;
    this.scopeToChat = false;
    this.lastQuery = "";
  }

  start() {
    this.mo = new MutationObserver(() => this._attachIfNeeded());
    this.mo.observe(document.body, { childList: true, subtree: true });
    this._attachIfNeeded();
  }

  stop() {
    this.mo?.disconnect();
    this._removePanel();
  }

  _attachIfNeeded() {
    const input = findSearchInput();
    if (!input || input === this.currentInput) return;
    this.currentInput = input;
    input.addEventListener("input", () => this._onInput(input));
    input.addEventListener("blur", () => setTimeout(() => this._maybeHide(), 150));
  }

  _onInput(input) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const query = input.textContent?.trim() || "";
      this.lastQuery = query;
      if (query.length < 2) return this._removePanel();
      this._renderResults(query);
    }, DEBOUNCE_MS);
  }

  _maybeHide() {
    const query = this.currentInput?.textContent?.trim() || "";
    if (!query) this._removePanel();
  }

  _renderResults(query) {
    const openChatId = getOpenChatId();
    const scopeOptions = this.scopeToChat ? { chatId: openChatId, limit: 15 } : { limit: 15 };
    const results = this.index.search(query, scopeOptions);

    // El toggle se muestra igual aunque no haya resultados en el chat actual,
    // para que el usuario pueda desactivarlo y ver si hay coincidencias en otros chats.
    if (results.length === 0 && !this.scopeToChat) return this._removePanel();

    const panel = this._ensurePanel();
    panel.innerHTML = `
      <div class="wa-as-header">
        <span>🎙️ Coincidencias en notas de voz (${results.length})</span>
        <label class="wa-as-scope">
          <input type="checkbox" id="wa-as-scope-toggle" ${this.scopeToChat ? "checked" : ""} />
          solo este chat
        </label>
      </div>
      <div class="wa-as-list">
        ${results.map((r) => this._resultRow(r, query)).join("") || '<div class="wa-as-empty">Sin coincidencias en este chat</div>'}
      </div>
    `;

    panel.querySelector("#wa-as-scope-toggle").addEventListener("change", (e) => {
      this.scopeToChat = e.target.checked;
      this._renderResults(this.lastQuery);
    });

    panel.querySelectorAll("[data-message-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const found = scrollToMessage(row.getAttribute("data-message-id"));
        if (found) {
          this._removePanel();
        } else {
          // El mensaje no está en el chat abierto actualmente (resultado de otro
          // chat): no hay forma de navegar ahí automáticamente, así que avisamos
          // en vez de cerrar el panel simulando que funcionó.
          this._flashRowNotice(row, "Abrí ese chat para ver este mensaje");
        }
      });
    });
  }

  _resultRow(r, query) {
    const safeName = escapeHtml(r.chatName || r.sender || "Chat");
    const safeSender = escapeHtml(r.sender || "");
    const safeTime = escapeHtml(r.timestampText || "");
    const snippet = highlight(r.snippet, query);
    return `
      <div class="wa-as-row" data-message-id="${escapeHtml(r.messageId)}">
        <div class="wa-as-row-title">${safeName} ${safeSender ? "· " + safeSender : ""} ${safeTime ? "· " + safeTime : ""}</div>
        <div class="wa-as-row-snippet">${snippet}</div>
      </div>
    `;
  }

  _flashRowNotice(row, text) {
    let notice = row.querySelector(".wa-as-row-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "wa-as-row-notice";
      row.appendChild(notice);
    }
    notice.textContent = text;
    clearTimeout(notice._hideTimer);
    notice._hideTimer = setTimeout(() => notice.remove(), 2500);
  }

  _ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    const host = document.getElementById("side") || document.body;
    host.appendChild(panel);
    return panel;
  }

  _removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Resalta las coincidencias en `<mark>`, buscando sobre una versión
 * normalizada (sin tildes, minúsculas) del snippet — la misma normalización
 * que usa TranscriptIndex.search — pero mostrando siempre el texto original
 * (con sus tildes) y correctamente escapado. Sin esto, buscar "reunion" no
 * resaltaba nada en un snippet con "reunión", aunque sí aparecía como
 * resultado (la búsqueda en sí ya era insensible a tildes; el resaltado no).
 */
function highlight(rawSnippet, query) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => normalize(t));
  if (terms.length === 0) return escapeHtml(rawSnippet);

  const normalizedSnippet = normalize(rawSnippet);
  const spans = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    let idx;
    while ((idx = normalizedSnippet.indexOf(term, from)) !== -1) {
      spans.push([idx, idx + term.length]);
      from = idx + term.length;
    }
  }
  if (spans.length === 0) return escapeHtml(rawSnippet);

  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  let out = "";
  let cursor = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(rawSnippet.slice(cursor, s));
    out += "<mark>" + escapeHtml(rawSnippet.slice(s, e)) + "</mark>";
    cursor = e;
  }
  out += escapeHtml(rawSnippet.slice(cursor));
  return out;
}
