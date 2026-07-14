import { TranscriptIndex } from "../lib/db.js";
import { AudioCapture } from "./audio-capture.js";
import { SearchUI } from "./search-ui.js";
import panelCss from "./styles.css";

async function main() {
  injectStyles();

  const settings = await getSettings();
  if (!settings.enabled) return;

  const index = new TranscriptIndex();
  await index.init();

  const worker = new Worker(chrome.runtime.getURL("dist/worker.js"), { type: "module" });
  const queue = new TranscriptionQueue(worker, index, settings);
  worker.addEventListener("message", (e) => queue.handleWorkerMessage(e.data));

  const capture = new AudioCapture({
    index,
    isEnabledForChat: (chatId) => !settings.excludedChats.includes(chatId),
    enqueueTranscription: (job) => queue.enqueue(job),
  });
  capture.start();

  const searchUI = new SearchUI({ index });
  searchUI.start();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "clear-index") index.clear();
    if (msg.type === "get-stats") return Promise.resolve({ count: index.size });
  });
}

/** Procesa una nota de voz por vez, en tiempo ocioso, para no competir con la UI. */
class TranscriptionQueue {
  constructor(worker, index, settings) {
    this.worker = worker;
    this.index = index;
    this.settings = settings;
    this.pending = [];
    this.jobsById = new Map();
    this.busy = false;
    this.nextId = 1;
  }

  enqueue(job) {
    this.pending.push(job);
    this._drain();
  }

  _drain() {
    if (this.busy || this.pending.length === 0) return;
    const runNext = () => {
      if (this.pending.length === 0) return;
      this.busy = true;
      const job = this.pending.shift();
      const jobId = this.nextId++;
      this.jobsById.set(jobId, job);
      this.worker.postMessage(
        { type: "transcribe", jobId, audio: job.audio, language: this.settings.language || undefined },
        [job.audio.buffer]
      );
    };
    if ("requestIdleCallback" in self) requestIdleCallback(runNext, { timeout: 4000 });
    else setTimeout(runNext, 0);
  }

  async handleWorkerMessage(msg) {
    if (msg.type === "result" || msg.type === "error") {
      const job = this.jobsById.get(msg.jobId);
      this.jobsById.delete(msg.jobId);
      this.busy = false;

      if (msg.type === "result" && job && msg.text) {
        await this.index.put({
          messageId: job.messageId,
          chatId: job.chatId,
          chatName: job.chatName,
          sender: job.sender,
          timestampText: job.timestampText,
          transcript: msg.text,
          durationSec: job.durationSec,
          indexedAt: Date.now(),
        });
      }
      this._drain();
    }
  }
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = panelCss;
  document.head.appendChild(style);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["enabled", "excludedChats", "language"]);
  return {
    enabled: stored.enabled ?? true,
    excludedChats: stored.excludedChats ?? [],
    language: stored.language ?? null,
  };
}

main().catch((err) => console.error("[wa-audio-search] fallo al iniciar:", err));
