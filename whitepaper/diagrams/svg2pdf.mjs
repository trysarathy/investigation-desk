// Render a hand-drawn SVG to a tightly cropped PDF with Chromium (Playwright).
// Usage: node svg2pdf.mjs in.svg out.pdf
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/playwright")); }
const [, , inp, out] = process.argv;
const svg = readFileSync(inp, "utf8");
const w = Number(/width="(\d+)"/.exec(svg)[1]), h = Number(/height="(\d+)"/.exec(svg)[1]);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: "1" });
await browser.close();
