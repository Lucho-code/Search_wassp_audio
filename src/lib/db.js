// Almacenamiento local (IndexedDB) de transcripciones + índice invertido en memoria.
// Todo vive en el origen https://web.whatsapp.com, aislado del resto del navegador.

const DB_NAME = "wa-audio-search";
const DB_VERSION = 1;
const STORE = "transcripts";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "messageId" });
        store.createIndex("chatId", "chatId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Normaliza texto en español para búsqueda: minúsculas, sin tildes.
 *  Exportada porque search-ui.js la necesita para resaltar coincidencias
 *  que solo matchean después de normalizar (ver highlight() ahí). */
export function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenize(text) {
  return normalize(text)
    .split(/[^a-z0-9áéíóúñ]+/i)
    .filter((t) => t.length >= 2);
}

export class TranscriptIndex {
  constructor() {
    this.db = null;
    this.records = new Map(); // messageId -> record
    this.invertedIndex = new Map(); // token -> Set<messageId>
  }

  async init() {
    this.db = await openDb();
    await this._loadAll();
  }

  async _loadAll() {
    const tx = this.db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          this._indexInMemory(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  _indexInMemory(record) {
    this.records.set(record.messageId, record);
    for (const token of tokenize(record.transcript)) {
      if (!this.invertedIndex.has(token)) this.invertedIndex.set(token, new Set());
      this.invertedIndex.get(token).add(record.messageId);
    }
  }

  has(messageId) {
    return this.records.has(messageId);
  }

  async put(record) {
    // record: { messageId, chatId, chatName, sender, timestampText, transcript, durationSec, indexedAt }
    this._indexInMemory(record);
    const tx = this.db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear() {
    this.records.clear();
    this.invertedIndex.clear();
    const tx = this.db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  get size() {
    return this.records.size;
  }

  /** Búsqueda instantánea: solo consulta el índice ya construido, nunca transcribe en caliente. */
  search(query, { chatId = null, limit = 20 } = {}) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    let candidateIds = null;
    for (const term of terms) {
      const matchingSets = [];
      for (const [token, ids] of this.invertedIndex) {
        if (token.includes(term)) matchingSets.push(ids);
      }
      const merged = new Set();
      for (const set of matchingSets) for (const id of set) merged.add(id);
      candidateIds = candidateIds === null ? merged : new Set([...candidateIds].filter((id) => merged.has(id)));
      if (candidateIds.size === 0) break;
    }

    const results = [...(candidateIds || [])]
      .map((id) => this.records.get(id))
      .filter((r) => r && (!chatId || r.chatId === chatId))
      .map((r) => ({ ...r, snippet: buildSnippet(r.transcript, terms) }))
      .sort((a, b) => b.indexedAt - a.indexedAt)
      .slice(0, limit);

    return results;
  }
}

function buildSnippet(transcript, terms) {
  const normalized = normalize(transcript);
  let pos = -1;
  for (const term of terms) {
    pos = normalized.indexOf(term);
    if (pos !== -1) break;
  }
  if (pos === -1) return transcript.slice(0, 120);
  const start = Math.max(0, pos - 40);
  const end = Math.min(transcript.length, pos + 80);
  return (start > 0 ? "…" : "") + transcript.slice(start, end) + (end < transcript.length ? "…" : "");
}
