// Smallest change to a colour (mixing toward black or white, keeping hue) that reaches a target ratio
// against every listed background. Usage: node suggest.mjs <fg> <target> <bg1> [bg2 ...]
import { ratio } from "./contrast.mjs";
const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const [fg, target, ...bgs] = process.argv.slice(2);
const f = hex(fg), t = parseFloat(target), B = bgs.map(hex);
const lum = (c) => c.reduce((a, v) => a + v, 0);
const towardWhite = B.every((b) => lum(b) < 384); // dark backgrounds: lighten the text
for (let k = 0; k <= 1.0001; k += 0.01) {
  const c = f.map((v) => (towardWhite ? v + (255 - v) * k : v * (1 - k)));
  const worst = Math.min(...B.map((b) => ratio(c.map(Math.round), b)));
  if (worst >= t) { console.log(`${toHex(c)} (worst ${worst.toFixed(2)}:1, ${Math.round(k * 100)}% toward ${towardWhite ? "white" : "black"})`); process.exit(0); }
}
console.log("no solution");
