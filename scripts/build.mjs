// Empaqueta todo (content script, worker, background) en dist/, incluyendo
// @xenova/transformers vendorizado desde node_modules. No hay ningún <script
// src="https://..."> ni fetch a un CDN en tiempo de ejecución: todo el JS y
// el modelo quedan dentro de la extensión.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const common = {
  bundle: true,
  format: "esm",
  target: "chrome111",
  outdir: path.join(root, "dist"),
  loader: { ".css": "text" },
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: { content: path.join(root, "src/content/index.js") },
});

await build({
  ...common,
  entryPoints: { worker: path.join(root, "src/worker/transcribe-worker.js") },
});

await build({
  ...common,
  entryPoints: { background: path.join(root, "src/background/background.js") },
});

// El runtime WASM de onnxruntime-web (usado por @xenova/transformers) no se
// puede bundlear como JS: son binarios .wasm que se cargan por separado.
// Los copiamos a dist/ para que env.backends.onnx.wasm.wasmPaths los encuentre.
const ortDist = path.join(root, "node_modules/onnxruntime-web/dist");
const outDir = path.join(root, "dist");
for (const file of fs.readdirSync(ortDist)) {
  if (file.endsWith(".wasm")) fs.copyFileSync(path.join(ortDist, file), path.join(outDir, file));
}

console.log("\nBuild completo. Cargá la carpeta del plugin como extensión sin empaquetar (ver README).");
