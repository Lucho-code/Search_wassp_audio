// Arnés de test: carga las clases REALES del plugin (no reimplementaciones)
// contra el DOM falso de whatsapp-fake.html, con un stub en lugar del Worker
// real (ver test/run.mjs para por qué: transcribir de verdad requiere el
// modelo Whisper descargado, que no es parte de este test).
import { AudioCapture } from "../../src/content/audio-capture.js";
import { SearchUI } from "../../src/content/search-ui.js";
import { TranscriptIndex } from "../../src/lib/db.js";

const CANNED_TRANSCRIPTS = {
  msg1: "Hola, nos vemos el viernes a las diez para la reunión",
  msg2: "Recordá comprar pan y leche",
  msg3: "Audio nuevo después de que WhatsApp reemplazó el chat",
};

/** Genera un WAV válido y corto (silencio) como blob: URL real, para que
 *  fetch() + decodeAudioData() de AudioCapture corran sobre audio real. */
function makeSilentWavBlobUrl(durationSec = 1, sampleRate = 8000) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => str.split("").forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  // samples ya quedan en 0 (silencio) por defecto en el ArrayBuffer

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

const state = {
  queuedJobs: [],
  autoResolve: true,
  ready: false,
};
window.__test = state;
state.makeSilentWavBlobUrl = makeSilentWavBlobUrl;

const index = new TranscriptIndex();
await index.init();
state.index = index;

const capture = new AudioCapture({
  index,
  isEnabledForChat: () => true,
  enqueueTranscription: (job) => {
    state.queuedJobs.push(job);
    if (state.autoResolve) {
      const text = CANNED_TRANSCRIPTS[job.messageId] || `transcripción de ${job.messageId}`;
      index.put({
        messageId: job.messageId,
        chatId: job.chatId,
        chatName: job.chatName,
        sender: job.sender,
        timestampText: job.timestampText,
        transcript: text,
        durationSec: job.durationSec,
        indexedAt: Date.now(),
      });
    }
  },
});
capture.start();
state.capture = capture;

const searchUI = new SearchUI({ index });
searchUI.start();
state.searchUI = searchUI;

state.ready = true;
