// Paso de instalación, se corre UNA sola vez (con conexión a internet) para
// descargar los pesos de Whisper-tiny y dejarlos empaquetados en models/.
// A partir de ahí la extensión corre sin red: env.allowRemoteModels = false
// en runtime (ver src/lib/env-config.js) hace que sea imposible que el audio,
// o cualquier otra cosa, salga hacia un servidor externo durante el uso normal.
import { pipeline, env } from "@xenova/transformers";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modelsDir = path.join(root, "models");

env.cacheDir = modelsDir;
env.allowRemoteModels = true; // solo en este script de instalación, nunca en la extensión
env.localModelPath = modelsDir;

const MODEL_ID = "Xenova/whisper-tiny";

console.log(`Descargando ${MODEL_ID} en ${modelsDir} ...`);
await pipeline("automatic-speech-recognition", MODEL_ID, {
  progress_callback: (p) => {
    if (p.status === "progress") {
      process.stdout.write(`\r${p.file}: ${Math.round(p.progress || 0)}%   `);
    }
  },
});

console.log("\nModelo descargado. Ya podés correr `npm run build` y usar la extensión sin conexión.");
