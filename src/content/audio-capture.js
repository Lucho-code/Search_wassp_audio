// Detecta notas de voz ya renderizadas en el chat abierto, obtiene el audio
// (que WhatsApp Web ya descifró en memoria para poder reproducirlo) y lo
// encola para transcripción local.
//
// Importante: NUNCA se fuerza la reproducción de un audio no escuchado.
// Eso dispararía el "doble check azul" / marca de reproducido en WhatsApp,
// un efecto colateral no deseado sobre la cuenta del usuario. Solo se indexan
// notas de voz que el usuario ya abrió/reprodujo al menos una vez en la sesión.

import { extractMessageMeta, getOpenChatId, getOpenChatName } from "../lib/dom-utils.js";
import { SAMPLE_RATE } from "../lib/env-config.js";

// Formatos soportados: los que el decodificador nativo del navegador entiende
// (cubre lo que WhatsApp usa: OGG/Opus para notas de voz, M4A/AAC y MP3 para
// audios compartidos/reenviados).
const MAX_DURATION_SEC = 10 * 60; // evita transcribir audios/archivos enormes por error

export class AudioCapture {
  constructor({ index, enqueueTranscription, isEnabledForChat }) {
    this.index = index;
    this.enqueueTranscription = enqueueTranscription;
    this.isEnabledForChat = isEnabledForChat;
    this.seen = new WeakSet();
    this.observer = null;
  }

  start() {
    const target = document.getElementById("main") || document.body;
    this.observer = new MutationObserver((mutations) => this._onMutations(mutations));
    this.observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    this._scanExisting();
  }

  stop() {
    this.observer?.disconnect();
  }

  _onMutations(mutations) {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target instanceof HTMLAudioElement) {
        this._maybeCapture(m.target);
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node instanceof HTMLAudioElement) this._maybeCapture(node);
        node.querySelectorAll?.("audio").forEach((el) => this._maybeCapture(el));
      }
    }
  }

  _scanExisting() {
    document.querySelectorAll("#main audio").forEach((el) => this._maybeCapture(el));
  }

  async _maybeCapture(audioEl) {
    if (this.seen.has(audioEl)) return;
    const src = audioEl.getAttribute("src");
    if (!src || !src.startsWith("blob:")) return; // aún no descifrado/renderizado
    if (!this.isEnabledForChat(getOpenChatId())) return;

    this.seen.add(audioEl);

    const { messageId, timestampText, sender } = extractMessageMeta(audioEl);
    if (!messageId || this.index.has(messageId)) return;

    try {
      const pcm = await this._decodeBlobToPcm(src);
      if (!pcm || pcm.durationSec > MAX_DURATION_SEC) return;

      this.enqueueTranscription({
        messageId,
        chatId: getOpenChatId(),
        chatName: getOpenChatName(),
        sender,
        timestampText,
        durationSec: pcm.durationSec,
        audio: pcm.samples,
      });
    } catch (err) {
      console.debug("[wa-audio-search] no se pudo decodificar audio:", err);
    }
  }

  /** Lee el blob local (sin red: blob: es un recurso ya en memoria del documento) y lo
   *  convierte a PCM mono 16kHz, formato que requiere Whisper. */
  async _decodeBlobToPcm(blobUrl) {
    const res = await fetch(blobUrl);
    const arrayBuffer = await res.arrayBuffer();

    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      decodeCtx.close();
    }

    const durationSec = decoded.duration;
    const offline = new OfflineAudioContext(1, Math.ceil(durationSec * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();

    return { samples: resampled.getChannelData(0), durationSec };
  }
}
