// Re-renders listed frames of an already-rendered JPEG sequence (used after a scan finds glitches).
//   node repair.mjs <Composition> <props.json> <public_dir> <frames_dir> <frame> [frame...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs"; import path from "node:path";
const [id, propsFile, publicDir, outDir, ...frames] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const inputProps = JSON.parse(fs.readFileSync(propsFile, "utf8"));
const o = { browserExecutable: process.env.CHROME || undefined, chromeMode: process.env.CHROME ? "chrome-for-testing" : undefined };
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir: path.resolve(publicDir) });
const composition = await selectComposition({ serveUrl, id, inputProps, ...o });
for (const f of frames.map(Number))
  await renderStill({ serveUrl, composition, inputProps, ...o, frame: f, output: path.join(outDir, `f${String(f).padStart(5, "0")}.jpeg`), imageFormat: "jpeg", jpegQuality: 94, overwrite: true });
console.log("repaired", frames.join(" "));
