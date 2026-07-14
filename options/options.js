const languageEl = document.getElementById("language");
const excludedEl = document.getElementById("excludedChats");
const statusEl = document.getElementById("status");

async function load() {
  const { language, excludedChats } = await chrome.storage.local.get(["language", "excludedChats"]);
  languageEl.value = language || "";
  excludedEl.value = (excludedChats || []).join("\n");
}

document.getElementById("save").addEventListener("click", async () => {
  const excludedChats = excludedEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
  await chrome.storage.local.set({ language: languageEl.value || null, excludedChats });
  statusEl.textContent = "Guardado ✓";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

load();
