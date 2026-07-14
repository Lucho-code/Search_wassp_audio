// Se engancha a la caja de búsqueda nativa de WhatsApp Web y agrega, debajo de
// los resultados propios de WhatsApp, un panel con las coincidencias encontradas
// dentro de transcripciones de audio. No reemplaza ni modifica la búsqueda nativa:
// solo la complementa (WhatsApp no expone una API para intervenir su propio motor
// de búsqueda de texto).

import { findSearchInput, scrollToMessage, getOpenChatId } from "../lib/dom-utils.js";

const PANEL_ID = "wa-audio-search-panel";
const DEBOUNCE_MS = 180;

export class SearchUI {
  constructor({ index }) {
    this.index = index;
    this.debounceTimer = null;
    this.currentInput = null;
    this.mo = null;
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
      if (query.length < 2) return this._removePanel();
      this._renderResults(query);
    }, DEBOUNCE_MS);
  }

  _maybeHide() {
    const query = this.currentInput?.textContent?.trim() || "";
    if (!query) this._removePanel();
  }

  _renderResults(query) {
    // Búsqueda global (no solo el chat abierto): igual que la búsqueda nativa de WhatsApp,
    // que también busca en todos los chats cuando no hay uno abierto en foco de mensajes.
    const results = this.index.search(query, { limit: 15 });
    if (results.length === 0) return this._removePanel();

    const panel = this._ensurePanel();
    panel.innerHTML = `
      <div class="wa-as-header">🎙️ Coincidencias en notas de voz (${results.length})</div>
      <div class="wa-as-list">
        ${results.map((r) => this._resultRow(r, query)).join("")}
      </div>
    `;

    panel.querySelectorAll("[data-message-id]").forEach((row) => {
      row.addEventListener("click", () => {
        scrollToMessage(row.getAttribute("data-message-id"));
        this._removePanel();
      });
    });
  }

  _resultRow(r, query) {
    const safeName = escapeHtml(r.chatName || r.sender || "Chat");
    const safeSender = escapeHtml(r.sender || "");
    const safeTime = escapeHtml(r.timestampText || "");
    const snippet = highlight(escapeHtml(r.snippet), query);
    return `
      <div class="wa-as-row" data-message-id="${escapeHtml(r.messageId)}">
        <div class="wa-as-row-title">${safeName} ${safeSender ? "· " + safeSender : ""} ${safeTime ? "· " + safeTime : ""}</div>
        <div class="wa-as-row-snippet">${snippet}</div>
      </div>
    `;
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

function highlight(escapedSnippet, query) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeHtml);
  let out = escapedSnippet;
  for (const term of terms) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}
