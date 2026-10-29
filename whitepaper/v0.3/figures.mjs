// Draws the figures in diagrams.mjs: hand-drawn SVGs with rough.js (in headless Chromium) and an
// editable Excalidraw file for each. Called by build.mjs; can also run alone: `node figures.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAMS, TONES } from "./diagrams.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const INK = "#0a0c11", MUTED = "#4a5160", LINE = "#5b6272";

export function loadChromium() {
  for (const p of ["playwright", "/home/claude/.npm-global/lib/node_modules/playwright"]) {
    try { return require(p).chromium; } catch { /* next */ }
  }
  throw new Error("Playwright not found: npm i -g playwright");
}

// ---------- geometry ----------

const byId = (d) => Object.fromEntries(d.nodes.map((n) => [n.id, n]));

/** Where the line from a node's centre towards (tx, ty) leaves the node's outline. */
function exitPoint(n, tx, ty) {
  const dx = tx - n.x, dy = ty - n.y;
  if (n.shape === "ellipse") {
    const a = n.w / 2, b = n.h / 2, t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return [n.x + dx * t, n.y + dy * t];
  }
  const sx = (n.w / 2) / Math.abs(dx || 1e-9), sy = (n.h / 2) / Math.abs(dy || 1e-9), t = Math.min(sx, sy);
  return [n.x + dx * t, n.y + dy * t];
}

/** Rect-like nodes join at the middle of the side facing the other node; ellipses where the line leaves. */
function anchor(n, other) {
  if (n.shape === "ellipse") return exitPoint(n, other.x, other.y);
  const dx = other.x - n.x, dy = other.y - n.y;
  if (Math.abs(dx) > n.w / 2 + 10) return [n.x + Math.sign(dx) * n.w / 2, n.y];
  return [n.x, n.y + Math.sign(dy || 1) * n.h / 2];
}

function edgeGeometry(d, e) {
  const N = byId(d), a = N[e.from], b = N[e.to];
  const t = anchor(b, a);
  const s = a.shape === "ellipse" ? exitPoint(a, t[0], t[1]) : anchor(a, b);
  const mx = (s[0] + t[0]) / 2, my = (s[1] + t[1]) / 2, len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
  const nx = -(t[1] - s[1]) / len, ny = (t[0] - s[0]) / len;
  const c = [mx + nx * (e.bend ?? 0), my + ny * (e.bend ?? 0)];
  return { s, t, c, mid: [0.25 * s[0] + 0.5 * c[0] + 0.25 * t[0], 0.25 * s[1] + 0.5 * c[1] + 0.25 * t[1]] };
}

function nodeText(n) {
  const lines = [];
  if (n.title) lines.push({ text: n.title, bold: true, serif: !!n.serif, size: n.serif ? 30 : n.shape === "pill" ? 19 : 18.5 });
  for (const l of n.lines ?? []) lines.push({ text: l, bold: false, serif: !!n.serif && n.shape === "ellipse" && l === n.lines[0] && n.lines.length === 1, size: n.serif ? (n.lines.length === 1 ? 30 : 17.5) : 16.8 });
  return lines;
}

// ---------- primitives for the browser ----------

function primitives(d) {
  const P = [];
  if (d.sequence) {
    const q = d.sequence, lane = Object.fromEntries(q.lanes.map((l) => [l.id, l]));
    for (const l of q.lanes) {
      const tone = TONES[l.tone];
      P.push({ k: "rect", x: l.x - 85, y: q.top, w: 170, h: 46, fill: tone.fill, stroke: tone.stroke, seed: l.x });
      P.push({ k: "text", x: l.x, y: q.top + 29, text: l.label, size: 19, bold: true, anchor: "middle" });
      P.push({ k: "line", x1: l.x, y1: q.top + 50, x2: l.x, y2: d.height - 14, stroke: "#c3c8d2", dashed: true, seed: l.x + 1 });
    }
    q.steps.forEach((st, i) => {
      const y = q.top + 92 + i * 45, a = lane[st.from].x, b = lane[st.to].x, dir = Math.sign(b - a);
      P.push({ k: "line", x1: a + dir * 4, y1: y, x2: b - dir * 6, y2: y, stroke: LINE, dashed: !!st.dashed, arrow: true, seed: 100 + i });
      const left = Math.min(a, b);
      P.push({ k: "text", x: left + 10, y: y - 9, text: st.text, size: 17, anchor: "start", halo: true });
    });
    return P;
  }
  for (const e of d.edges) {
    const g = edgeGeometry(d, e), tone = e.tone ? TONES[e.tone].stroke : LINE;
    P.push({ k: "curve", s: g.s, c: g.c, t: g.t, stroke: tone, dashed: !!e.dashed, arrow: !!e.arrow, width: e.tone ? 2.4 : 1.7, seed: g.s[0] + g.t[1] });
    if (e.label) P.push({ k: "text", x: g.mid[0], y: g.mid[1] - 14, text: e.label, size: 15.5, anchor: "middle", muted: true, halo: true });
  }
  for (const n of d.nodes) {
    const tone = TONES[n.tone];
    const shape = n.shape === "ellipse" ? "ellipse" : "rect";
    P.push({ k: shape, x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h, r: n.shape === "pill" ? n.h / 2 : 14, fill: tone.fill, stroke: tone.stroke, seed: n.x * 3 + n.y });
    const lines = nodeText(n), lh = (l) => l.size * 1.3;
    const total = lines.reduce((s, l) => s + lh(l), 0);
    const leftAlign = n.shape === "card";
    let y = n.y - total / 2;
    for (const l of lines) {
      y += lh(l);
      P.push({ k: "text", x: leftAlign ? n.x - n.w / 2 + 16 : n.x, y: y - l.size * 0.32, text: l.text, size: l.size, bold: l.bold, serif: l.serif, anchor: leftAlign ? "start" : "middle", muted: !l.bold && !l.serif });
    }
    if (n.icon) {
      const cx = n.shape === "pill" ? n.x - n.w / 2 + 4 : n.x - n.w / 2 + 2, cy = n.y - n.h / 2 + 2;
      P.push({ k: "ellipse", x: cx - 15, y: cy - 15, w: 30, h: 30, fill: "#ffffff", stroke: tone.stroke, seed: cx + cy });
      P.push({ k: "text", x: cx, y: cy + 5.5, text: n.icon, size: 16, bold: true, anchor: "middle", color: tone.stroke });
    }
  }
  return P;
}

// Runs in the page: rough.js draws shapes; text is plain SVG text so it stays sharp and selectable.
function drawInPage({ width, height, prims, ink, muted }) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  const rc = rough.svg(svg);
  const base = { roughness: 1.05, bowing: 0.9, strokeWidth: 1.7, disableMultiStroke: false };
  const rr = (x, y, w, h, r) => `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
  const arrowHead = (x, y, ang, stroke, seed) => {
    const L = 11;
    for (const s of [-0.45, 0.45]) {
      svg.appendChild(rc.line(x, y, x - L * Math.cos(ang + s), y - L * Math.sin(ang + s), { ...base, stroke, seed, strokeWidth: 1.8 }));
    }
  };
  for (const p of prims) {
    const seed = Math.abs(Math.round(p.seed ?? 1)) % 2147483647 || 1;
    if (p.k === "ellipse") svg.appendChild(rc.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { ...base, fill: p.fill, fillStyle: "solid", stroke: p.stroke, seed }));
    else if (p.k === "rect") svg.appendChild(rc.path(rr(p.x, p.y, p.w, p.h, p.r ?? 12), { ...base, fill: p.fill, fillStyle: "solid", stroke: p.stroke, seed, roughness: 0.9 }));
    else if (p.k === "curve") {
      const [s, c, t] = [p.s, p.c, p.t];
      svg.appendChild(rc.path(`M${s[0]},${s[1]} Q${c[0]},${c[1]} ${t[0]},${t[1]}`, { ...base, stroke: p.stroke, strokeWidth: p.width, seed, strokeLineDash: p.dashed ? [7, 6] : undefined }));
      if (p.arrow) arrowHead(t[0], t[1], Math.atan2(t[1] - c[1], t[0] - c[0]), p.stroke, seed + 1);
    } else if (p.k === "line") {
      svg.appendChild(rc.line(p.x1, p.y1, p.x2, p.y2, { ...base, stroke: p.stroke, seed, strokeLineDash: p.dashed ? [7, 6] : undefined, roughness: p.dashed ? 0.4 : 1 }));
      if (p.arrow) arrowHead(p.x2, p.y2, Math.atan2(p.y2 - p.y1, p.x2 - p.x1), p.stroke, seed + 1);
    } else if (p.k === "text") {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", p.x); t.setAttribute("y", p.y);
      t.setAttribute("text-anchor", p.anchor ?? "start");
      t.setAttribute("font-family", p.serif ? "Newsreader, Georgia, serif" : "Inter, Helvetica, Arial, sans-serif");
      t.setAttribute("font-size", p.size);
      t.setAttribute("font-weight", p.bold ? (p.serif ? 600 : 600) : 400);
      t.setAttribute("fill", p.color ?? (p.muted ? muted : ink));
      if (p.halo) { t.setAttribute("paint-order", "stroke"); t.setAttribute("stroke", "#ffffff"); t.setAttribute("stroke-width", 5); t.setAttribute("stroke-linejoin", "round"); }
      t.textContent = p.text;
      svg.appendChild(t);
    }
  }
  return svg.outerHTML;
}

// ---------- Excalidraw ----------

let counter = 0;
const nextId = (p) => `${p}-${(++counter).toString(36)}`;
const common = (o) => ({
  angle: 0, strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
  roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: Math.floor(Math.random() * 2 ** 31),
  version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), isDeleted: false, boundElements: null,
  updated: 1793232000000, link: null, locked: false, ...o,
});
const textEl = (o) => common({
  type: "text", strokeColor: o.color ?? INK, fontSize: o.fontSize, fontFamily: 1, text: o.text, originalText: o.text,
  textAlign: o.textAlign ?? "center", verticalAlign: o.verticalAlign ?? "middle", containerId: o.containerId ?? null,
  lineHeight: 1.25, autoResize: true, id: o.id, x: o.x, y: o.y,
  width: o.width ?? Math.max(...o.text.split("\n").map((l) => l.length)) * o.fontSize * 0.55,
  height: o.height ?? o.text.split("\n").length * o.fontSize * 1.25,
});

function excalidraw(d) {
  const els = [];
  if (d.sequence) {
    const q = d.sequence, lane = Object.fromEntries(q.lanes.map((l) => [l.id, l]));
    for (const l of q.lanes) {
      const id = nextId("lane"), tid = nextId("t"), tone = TONES[l.tone];
      els.push(common({ id, type: "rectangle", x: l.x - 85, y: q.top, width: 170, height: 46, strokeColor: tone.stroke, backgroundColor: tone.fill, roundness: { type: 3 }, boundElements: [{ type: "text", id: tid }] }));
      els.push(textEl({ id: tid, containerId: id, text: l.label, fontSize: 18, x: l.x - 80, y: q.top + 10, width: 160, height: 23 }));
      els.push(common({ id: nextId("ll"), type: "line", x: l.x, y: q.top + 50, width: 0, height: d.height - q.top - 64, strokeColor: "#c3c8d2", strokeStyle: "dashed", points: [[0, 0], [0, d.height - q.top - 64]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null }));
    }
    q.steps.forEach((st, i) => {
      const y = q.top + 92 + i * 45, a = lane[st.from].x, b = lane[st.to].x;
      els.push(common({ id: nextId("a"), type: "arrow", x: a, y, width: Math.abs(b - a), height: 0, strokeColor: LINE, strokeStyle: st.dashed ? "dashed" : "solid", points: [[0, 0], [b - a, 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false }));
      els.push(textEl({ id: nextId("t"), text: st.text, fontSize: 15, textAlign: "left", verticalAlign: "top", x: Math.min(a, b) + 10, y: y - 26 }));
    });
  } else {
    const ids = {};
    for (const n of d.nodes) {
      const id = nextId("n"), tid = nextId("t"), tone = TONES[n.tone];
      ids[n.id] = id;
      const text = [n.title, ...(n.lines ?? [])].filter(Boolean).join("\n");
      els.push(common({ id, type: n.shape === "ellipse" ? "ellipse" : "rectangle", x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, strokeColor: tone.stroke, backgroundColor: tone.fill, roundness: n.shape === "ellipse" ? { type: 2 } : { type: 3 }, boundElements: [{ type: "text", id: tid }] }));
      const fs = n.serif ? 22 : 15;
      els.push(textEl({ id: tid, containerId: id, text, fontSize: fs, textAlign: n.shape === "card" ? "left" : "center", x: n.x - n.w / 2 + 10, y: n.y - (text.split("\n").length * fs * 1.25) / 2, width: n.w - 20 }));
    }
    for (const e of d.edges) {
      const g = edgeGeometry(d, e), id = nextId("e");
      const pts = [[0, 0], [g.mid[0] - g.s[0], g.mid[1] - g.s[1]], [g.t[0] - g.s[0], g.t[1] - g.s[1]]];
      els.push(common({ id, type: "arrow", x: g.s[0], y: g.s[1], width: Math.abs(g.t[0] - g.s[0]), height: Math.abs(g.t[1] - g.s[1]), strokeColor: e.tone ? TONES[e.tone].stroke : LINE, strokeStyle: e.dashed ? "dashed" : "solid", roundness: { type: 2 }, points: pts, lastCommittedPoint: null, startBinding: { elementId: ids[e.from], focus: 0, gap: 4 }, endBinding: { elementId: ids[e.to], focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: e.arrow ? "arrow" : null, elbowed: false }));
      const s = els.find((x) => x.id === ids[e.from]), t = els.find((x) => x.id === ids[e.to]);
      s.boundElements.push({ type: "arrow", id }); t.boundElements.push({ type: "arrow", id });
      if (e.label) els.push(textEl({ id: nextId("t"), text: e.label, fontSize: 14, x: g.mid[0] - e.label.length * 3.9, y: g.mid[1] - 26 }));
    }
  }
  return { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} };
}

// ---------- main ----------

export async function renderFigures() {
  mkdirSync(path.join(HERE, "figures"), { recursive: true });
  mkdirSync(path.join(HERE, "excalidraw"), { recursive: true });
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: readFileSync(path.join(HERE, "node_modules/roughjs/bundled/rough.js"), "utf8") });
  for (const d of DIAGRAMS) {
    const svg = await page.evaluate(drawInPage, { width: d.width, height: d.height, prims: primitives(d), ink: INK, muted: MUTED });
    writeFileSync(path.join(HERE, "figures", `${d.id}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${d.title}: drawn by figures.mjs from diagrams.mjs. Fonts: Newsreader and Inter (fonts/). -->\n${svg}\n`);
    writeFileSync(path.join(HERE, "excalidraw", `${d.id}.excalidraw`), JSON.stringify(excalidraw(d), null, 2));
    console.log("figure", d.id);
  }
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await renderFigures();
