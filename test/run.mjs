// Test funcional del plugin contra un DOM que imita WhatsApp Web (ver
// test/fixtures/). Corre las clases reales (AudioCapture, SearchUI,
// TranscriptIndex, dom-utils) en un Chromium real vía Playwright — no
// mocks de DOM/IndexedDB/MutationObserver, esos son los del navegador.
//
// Lo que NO prueba: la transcripción real con Whisper. Eso requiere el
// modelo descargado (scripts/download-model.mjs, ~40MB+, con internet) y
// corre en un Worker aparte; acá se reemplaza por un stub que simula un
// resultado de transcripción exitoso, para poder probar todo el resto del
// pipeline (captura de audio real vía fetch+decodeAudioData, indexado,
// búsqueda, UI, resiliencia ante cambios del DOM) de forma rápida y sin red.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Usa CHROME_PATH si está seteado, o cualquier Chromium de Playwright que
// encuentre bajo PLAYWRIGHT_BROWSERS_PATH (o ~/.cache/ms-playwright, default
// de `npx playwright install chromium`). Si no encuentra ninguno, deja que
// playwright-core intente su resolución default (y falle con un mensaje claro).
function findChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.HOME || "", ".cache/ms-playwright")].filter(Boolean);
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const match = fs.readdirSync(base).find((d) => d.startsWith("chromium-") && !d.includes("headless_shell"));
    if (match) {
      const candidate = path.join(base, match, "chrome-linux", "chrome");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const CHROME_PATH = findChromePath();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

function startServer() {
  const server = http.createServer((req, res) => {
    const filePath = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found: " + filePath);
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
}

/** El buscador es un div contenteditable: hay que limpiarlo antes de cada
 *  query nueva, si no keyboard.type() lo va concatenando con lo anterior. */
async function typeQuery(page, text) {
  const input = page.locator('#side div[contenteditable="true"]');
  await input.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await input.type(text);
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}), headless: true });
  const page = await browser.newPage();

  page.on("pageerror", (err) => console.error("[pageerror]", err));
  page.on("console", (msg) => {
    // El propio Chrome pide /favicon.ico solo; no tiene nada que ver con el plugin.
    if (msg.type() === "error" && !msg.text().includes("favicon")) console.error("[console.error]", msg.text());
  });
  page.on("requestfailed", (req) => console.error("[requestfailed]", req.url(), req.failure()?.errorText));
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().endsWith("/favicon.ico")) console.error("[http " + res.status() + "]", res.url());
  });

  await page.goto(`http://127.0.0.1:${port}/test/fixtures/whatsapp-fake.html`);
  await page.waitForFunction(() => window.__test?.ready === true);

  // --- A. extractMessageMeta / captura básica -----------------------------
  let queued = await page.evaluate(() => window.__test.queuedJobs.length);
  check("A1. audio sin blob src no se encola", queued === 0, `queuedJobs=${queued}`);

  await page.evaluate(() => {
    const url = window.__test.makeSilentWavBlobUrl(1.2, 8000);
    document.getElementById("audio1").setAttribute("src", url);
  });
  await page.waitForFunction(() => window.__test.queuedJobs.length >= 1, { timeout: 5000 });

  const job1 = await page.evaluate(() => {
    const { audio, ...rest } = window.__test.queuedJobs[0] || {};
    return rest;
  });
  check("A2. audio con blob src real se encola", !!job1?.messageId, JSON.stringify(job1));
  check("A3. messageId correcto (data-id del ancestro)", job1?.messageId === "msg1");
  check("A4. sender correcto (parseado de data-pre-plain-text)", job1?.sender === "Juan Pérez", `sender="${job1?.sender}"`);
  check("A5. timestamp correcto", job1?.timestampText === "10:32, 14/7/2026", `ts="${job1?.timestampText}"`);
  check("A6. chatName = título del header abierto", job1?.chatName === "Juan Pérez");
  check("A7. duración > 0 (decodeAudioData corrió sobre audio real)", job1?.durationSec > 0, `dur=${job1?.durationSec}`);

  // --- B. dedup: mismo elemento no se vuelve a encolar --------------------
  await page.evaluate(() => {
    // re-disparar una mutación de atributo sobre el mismo <audio>
    document.getElementById("audio1").setAttribute("src", document.getElementById("audio1").getAttribute("src"));
  });
  await page.waitForTimeout(300);
  queued = await page.evaluate(() => window.__test.queuedJobs.length);
  check("B1. no duplica el mismo audio ya visto", queued === 1, `queuedJobs=${queued}`);

  // --- C. mensaje "out" usa "Yo" como sender cuando no hay data-pre-plain-text útil
  await page.evaluate(() => {
    document.querySelector('[data-id="msg2"] .copyable-text').removeAttribute("data-pre-plain-text");
    const url = window.__test.makeSilentWavBlobUrl(0.8, 8000);
    document.getElementById("audio2").setAttribute("src", url);
  });
  await page.waitForFunction(() => window.__test.queuedJobs.length >= 2, { timeout: 5000 });
  const job2 = await page.evaluate(() => window.__test.queuedJobs[1]);
  check("C1. mensaje propio sin metadata usa sender 'Yo'", job2?.sender === "Yo", `sender="${job2?.sender}"`);

  // --- D. resiliencia: WhatsApp reemplaza #main por un nodo nuevo ---------
  await page.evaluate(() => {
    const oldMain = document.getElementById("main");
    const newMain = document.createElement("div");
    newMain.id = "main";
    newMain.innerHTML = `
      <header><span title="Otro Chat">Otro Chat</span></header>
      <div data-id="msg3">
        <div class="copyable-text" data-pre-plain-text="[11:00, 14/7/2026] Ana: "></div>
        <audio id="audio3" src="${window.__test.makeSilentWavBlobUrl(1, 8000)}"></audio>
      </div>`;
    oldMain.replaceWith(newMain);
  });
  // el chequeo de resiliencia corre cada 3s (REATTACH_CHECK_MS) — esperamos un poco más
  await page.waitForFunction(() => window.__test.queuedJobs.some((j) => j.messageId === "msg3"), { timeout: 5000 });
  const job3 = await page.evaluate(() => {
    const { audio, ...rest } = window.__test.queuedJobs.find((j) => j.messageId === "msg3") || {};
    return rest;
  });
  check("D1. tras reemplazar #main, se detecta audio en el nuevo nodo", !!job3?.messageId, JSON.stringify(job3));
  check("D2. metadata del chat nuevo es correcta", job3?.chatName === "Otro Chat" && job3?.sender === "Ana");

  // --- E. TranscriptIndex: tokenización, tildes, snippet ------------------
  await page.evaluate(() => {
    window.__test.index.put({
      messageId: "msg-xss",
      chatId: "Chat Malicioso",
      chatName: "Chat Malicioso",
      sender: "Test",
      timestampText: "12:00, 14/7/2026",
      transcript: '<img src=x onerror="window.__xssFired = true"> reunión mañana',
      durationSec: 2,
      indexedAt: Date.now(),
    });
  });

  const searchAccents = await page.evaluate(() => window.__test.index.search("reunion").length);
  check("E1. búsqueda ignora tildes ('reunion' encuentra 'reunión')", searchAccents >= 1, `hits=${searchAccents}`);

  const searchPartial = await page.evaluate(() => window.__test.index.search("comp").length);
  check("E2. búsqueda por substring/parcial ('comp' encuentra 'comprar')", searchPartial >= 1, `hits=${searchPartial}`);

  const searchNone = await page.evaluate(() => window.__test.index.search("xyzxyz-no-existe").length);
  check("E3. búsqueda sin resultados no rompe", searchNone === 0);

  // --- F. SearchUI: render, escape/XSS, highlight, toggle -----------------
  await typeQuery(page, "reunion");
  await page.waitForTimeout(400); // debounce de 180ms

  const panelText = await page.evaluate(() => document.getElementById("wa-audio-search-panel")?.innerText || "");
  check("F1. panel de resultados aparece con la búsqueda", panelText.includes("Coincidencias en notas de voz"), panelText.slice(0, 80));

  const xssFired = await page.evaluate(() => window.__xssFired === true);
  check("F2. transcript con HTML malicioso NO se ejecuta (escapeHtml funciona)", xssFired !== true);

  const hasRawImgTag = await page.evaluate(() => document.getElementById("wa-audio-search-panel").innerHTML.includes("<img"));
  check("F3. HTML del transcript se muestra escapado, no como tag real", hasRawImgTag === false);

  const markCount = await page.evaluate(() => document.querySelectorAll("#wa-audio-search-panel mark").length);
  check("F4. término buscado queda resaltado con <mark>", markCount > 0, `marks=${markCount}`);

  // toggle "solo este chat": el chat abierto es "Otro Chat" (por el swap del paso D);
  // buscar "reunión" debería incluir tanto msg1 (chat "Juan Pérez") como msg-xss (chat "Chat Malicioso").
  const countBeforeToggle = await page.evaluate(() => document.querySelectorAll("#wa-audio-search-panel .wa-as-row").length);
  await page.click("#wa-as-scope-toggle");
  await page.waitForTimeout(100);
  const countAfterToggle = await page.evaluate(() => document.querySelectorAll("#wa-audio-search-panel .wa-as-row").length);
  check(
    "F5. toggle 'solo este chat' reduce los resultados al chat abierto",
    countAfterToggle < countBeforeToggle,
    `antes=${countBeforeToggle} después=${countAfterToggle} (chat abierto: Otro Chat)`
  );

  // --- G. clic en un resultado: caso feliz (mensaje en el chat abierto) ---
  // El chat abierto en este punto es "Otro Chat" (por el swap del paso D), y
  // msg3 vive ahí — es el único caso donde clickear un resultado global puede
  // efectivamente encontrar el mensaje en el DOM actual. F5 dejó el toggle
  // "solo este chat" activado: lo desactivamos para volver a búsqueda global.
  await page.evaluate(() => {
    window.__scrolledInto = false;
    document.querySelector('[data-id="msg3"]').scrollIntoView = () => (window.__scrolledInto = true);
  });
  await typeQuery(page, "audio nuevo");
  await page.waitForTimeout(400);
  if (await page.locator("#wa-as-scope-toggle").isChecked()) {
    await page.click("#wa-as-scope-toggle");
    await page.waitForTimeout(100);
  }
  const rowSelectorFound = '#wa-audio-search-panel [data-message-id="msg3"]';
  if (await page.locator(rowSelectorFound).count()) {
    await page.click(rowSelectorFound);
    await page.waitForTimeout(50);
    const scrolled = await page.evaluate(() => window.__scrolledInto);
    check("G1. click en resultado del chat abierto dispara scroll", scrolled === true);
    const panelGone = await page.evaluate(() => document.getElementById("wa-audio-search-panel") === null);
    check("G2. panel se cierra tras un click exitoso", panelGone === true);
  } else {
    check("G1. click en resultado del chat abierto dispara scroll", false, "fila msg3 no encontrada en el panel");
  }

  // --- H. clic en un resultado de OTRO chat: no falla en silencio ---------
  // msg1 pertenece al chat "Juan Pérez", que ya no está en el DOM (se
  // reemplazó por "Otro Chat" en el paso D) — no hay forma de navegar ahí
  // automáticamente, así que el plugin debe avisar en vez de simular éxito.
  await typeQuery(page, "reunion");
  await page.waitForTimeout(400);
  const rowSelectorMissing = '#wa-audio-search-panel [data-message-id="msg1"]';
  if (await page.locator(rowSelectorMissing).count()) {
    await page.click(rowSelectorMissing);
    await page.waitForTimeout(50);
    const panelStillThere = await page.evaluate(() => document.getElementById("wa-audio-search-panel") !== null);
    check("H1. panel NO se cierra cuando el mensaje no está en el chat abierto", panelStillThere === true);
    const noticeText = await page.evaluate(
      () => document.querySelector('[data-message-id="msg1"] .wa-as-row-notice')?.textContent || ""
    );
    check("H2. se muestra un aviso en vez de fallar en silencio", noticeText.length > 0, `aviso="${noticeText}"`);
  } else {
    check("H1. panel NO se cierra cuando el mensaje no está en el chat abierto", false, "fila msg1 no encontrada en el panel");
  }

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks OK`);
  if (failed.length) {
    console.log("\nFallos:");
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
