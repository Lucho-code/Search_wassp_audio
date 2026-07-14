import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from "../src/lib/constants.js";

const enabledBox = document.getElementById("enabled");
const statEl = document.getElementById("stat");
const modelSelect = document.getElementById("model");
const modelHint = document.getElementById("modelHint");

async function activeWhatsAppTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true, url: "https://web.whatsapp.com/*" });
  return tab;
}

async function refreshStats() {
  const tab = await activeWhatsAppTab();
  if (!tab) {
    statEl.textContent = "Abrí WhatsApp Web para ver estadísticas.";
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "get-stats" });
    statEl.textContent = `Notas de voz indexadas: ${res?.count ?? 0}`;
  } catch {
    statEl.textContent = "Recargá la pestaña de WhatsApp Web.";
  }
}

/** Solo se listan modelos que scripts/download-model.mjs efectivamente dejó
 *  en models/ — evita ofrecer un modelo que fallaría por no estar offline. */
async function getAvailableModelIds() {
  try {
    const res = await fetch(chrome.runtime.getURL("models/manifest.json"));
    const data = await res.json();
    return new Set(data.models || []);
  } catch {
    return new Set([DEFAULT_MODEL_ID]); // manifest ausente: asumimos solo el default (build sin --models)
  }
}

async function populateModelSelect(selectedId) {
  const available = await getAvailableModelIds();
  modelSelect.innerHTML = "";

  for (const { id, label } of Object.values(AVAILABLE_MODELS)) {
    if (!available.has(id)) continue;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  }

  if (modelSelect.options.length === 0) {
    modelHint.textContent = "No hay modelos descargados. Corré: npm run download-model";
    modelSelect.disabled = true;
    return;
  }

  modelSelect.value = available.has(selectedId) ? selectedId : modelSelect.options[0].value;
  modelHint.textContent =
    available.size > 1
      ? ""
      : 'Para más opciones: npm run download-model -- --models=tiny,base,small';
}

async function init() {
  const { enabled, model } = await chrome.storage.local.get(["enabled", "model"]);
  enabledBox.checked = enabled ?? true;
  await populateModelSelect(model ?? DEFAULT_MODEL_ID);
  await refreshStats();
}

enabledBox.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledBox.checked });
});

modelSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ model: modelSelect.value });
  modelHint.textContent = "Guardado. Recargá WhatsApp Web para aplicarlo.";
});

document.getElementById("reindex").addEventListener("click", async () => {
  const tab = await activeWhatsAppTab();
  if (tab) await chrome.tabs.reload(tab.id);
  window.close();
});

document.getElementById("clear").addEventListener("click", async () => {
  const tab = await activeWhatsAppTab();
  if (tab) await chrome.tabs.sendMessage(tab.id, { type: "clear-index" });
  await refreshStats();
});

init();
