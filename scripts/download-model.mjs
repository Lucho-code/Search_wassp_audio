// Paso de instalación, se corre UNA sola vez (con conexión a internet) para
// descargar los pesos de Whisper y dejarlos empaquetados en models/.
// A partir de ahí la extensión corre sin red: env.allowRemoteModels = false
// en runtime (ver src/lib/env-config.js) hace que sea imposible que el audio,
// o cualquier otra cosa, salga hacia un servidor externo durante el uso normal.
//
// Por defecto descarga solo "tiny". Para habilitar el selector de modelo del
// popup con más opciones: `node scripts/download-model.mjs --models=tiny,base,small`
import { pipeline, env } from "@xenova/transformers";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modelsDir = path.join(root, "models");
const manifestPath = path.join(modelsDir, "manifest.json");

env.cacheDir = modelsDir;
env.allowRemoteModels = true; // solo en este script de instalación, nunca en la extensión
env.localModelPath = modelsDir;

const SHORT_TO_FULL = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

const arg = process.argv.find((a) => a.startsWith("--models="));
const requested = (arg ? arg.split("=")[1] : "tiny").split(",").map((s) => s.trim());

const downloaded = [];
for (const short of requested) {
  const modelId = SHORT_TO_FULL[short];
  if (!modelId) {
    console.warn(`Modelo desconocido "${short}", opciones válidas: ${Object.keys(SHORT_TO_FULL).join(", ")}`);
    continue;
  }
  console.log(`\nDescargando ${modelId} en ${modelsDir} ...`);
  await pipeline("automatic-speech-recognition", modelId, {
    progress_callback: (p) => {
      if (p.status === "progress") process.stdout.write(`\r${p.file}: ${Math.round(p.progress || 0)}%   `);
    },
  });
  downloaded.push(modelId);
}

// Fusiona con lo que ya estaba descargado en corridas anteriores, así
// `npm run download-model -- --models=base` no "olvida" que tiny ya está.
const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).models : [];
const models = [...new Set([...existing, ...downloaded])];
fs.writeFileSync(manifestPath, JSON.stringify({ models }, null, 2));

console.log(`\nModelos disponibles offline: ${models.join(", ")}`);
console.log("Ya podés correr `npm run build` y usar la extensión sin conexión.");
