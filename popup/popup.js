const enabledBox = document.getElementById("enabled");
const statEl = document.getElementById("stat");

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

async function init() {
  const { enabled } = await chrome.storage.local.get(["enabled"]);
  enabledBox.checked = enabled ?? true;
  await refreshStats();
}

enabledBox.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledBox.checked });
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
