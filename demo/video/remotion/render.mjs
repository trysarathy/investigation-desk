// Renders a composition frame by frame (JPEG), finds the rare one-frame glitches the headless browser
// produces (a frame that is suddenly half blank), re-renders just those frames, and repeats until clean.
// The caller then joins the frames with the mixed audio (src/render.sh).
//
//   node render.mjs <Composition> <props.json> <public_dir> <frames_dir>
import { bundle } from "@remotion/bundler";
import { renderFrames, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [id, propsFile, publicDir, outDir] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const inputProps = JSON.parse(fs.readFileSync(propsFile, "utf8"));
const browserExecutable = process.env.CHROME || undefined;
const chromeMode = process.env.CHROME ? "chrome-for-testing" : undefined;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir: path.resolve(publicDir) });
const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable, chromeMode });
const name = (f) => path.join(outDir, `f${String(f).padStart(5, "0")}.jpeg`);
let last = -1;
await renderFrames({
  serveUrl, composition, inputProps, browserExecutable, chromeMode, outputDir: outDir, imageFormat: "jpeg", jpegQuality: 94,
  concurrency: Number(process.env.CONCURRENCY || 2),
  onStart: () => {}, onFrameUpdate: (n) => { if (n - last >= 300) { last = n; console.log(`${id}: ${n}/${composition.durationInFrames}`); } },
});
// Normalise names to f00000.jpeg (Remotion writes element-NNNN.jpeg).
for (const f of fs.readdirSync(outDir)) {
  const m = f.match(/(\d+)\.jpeg$/);
  if (m && f !== path.basename(name(Number(m[1])))) fs.renameSync(path.join(outDir, f), name(Number(m[1])));
}

const scan = path.join(here, "../src/glitch_scan.py");
for (let pass = 1; pass <= 4; pass++) {
  const bad = JSON.parse(execFileSync("python3", [scan, outDir]).toString());
  console.log(`${id}: glitch scan pass ${pass}: ${bad.length} frame(s) ${bad.join(" ")}`);
  if (!bad.length) process.exit(0);
  for (const frame of bad) {
    await renderStill({ serveUrl, composition, inputProps, browserExecutable, chromeMode, frame, output: name(frame), imageFormat: "jpeg", jpegQuality: 94, overwrite: true });
  }
}
console.error(`${id}: glitches remain after 4 passes`);
process.exit(1);
