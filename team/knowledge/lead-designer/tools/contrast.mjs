#!/usr/bin/env node
// WCAG 2.2 contrast ratios for Clearline's real token pairs (website, product UI, deck, whitepaper).
// Formula: WCAG 2.2 "relative luminance" and "contrast ratio" definitions
// (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance, #dfn-contrast-ratio).
// Semi-transparent colours are composited over their stated background first (alpha over opaque).
// Run: node team/knowledge/lead-designer/tools/contrast.mjs            (markdown table)
//      node team/knowledge/lead-designer/tools/contrast.mjs '#a3abba' '#0a0c11'   (one pair)

const hex = (h) => {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; // WCAG 2.2 uses 0.04045 (2.x text said 0.03928; no practical difference)
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
const toHex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

// kind: "text" (needs 4.5), "large" (18.66px bold / 24px regular: needs 3), "ui" (non-text, needs 3)
const P = (surface, fgName, fg, bgName, bg, kind, where) => ({ surface, fgName, fg, bgName, bg, kind, where });

const W = { ink: "#0a0c11", panel: "#11141b", panel2: "#161a23", fg: "#eceef4", muted: "#a3abba", faint: "#8a93a3", accent: "#8ea2ff", accentStrong: "#6e7df0", good: "#5fd3a0", warn: "#f5b85c", bad: "#f28b82", white: "#ffffff" };
// website/src/app/globals.css on origin/pitch-deck @ ad15acb, lines 5-17
const L = { canvas: "#f7f7f5", panel: "#ffffff", panel2: "#fafaf9", text: "#17181c", text2: "#5b5e66", text3: "#8a8d94", border: "#e4e4e0", borderStrong: "#d2d2cc", accent: "#3b5bdb", accentText: "#ffffff", accentSoft: "#edf1fd", green: "#1f7a3d", greenSoft: "#e9f5ec", amber: "#8a5a00", amberSoft: "#fdf3dc", red: "#b42318", redSoft: "#fdecea", focus: "#3b5bdb" };
// src/app/globals.css on origin/main @ 8decb27, lines 2-25 (light)
const D = { canvas: "#111215", panel: "#18191d", panel2: "#1d1e23", text: "#ececee", text2: "#a4a7ae", text3: "#767982", border: "#2a2b31", borderStrong: "#383a41", accent: "#6b86f0", accentText: "#0d1020", accentSoft: "#1e2440", green: "#5cc98a", greenSoft: "#15291e", amber: "#e8b45a", amberSoft: "#2e2512", red: "#f1877d", redSoft: "#351a18", focus: "#8aa0f5" };
// same file, lines 28-49 (dark)
const K = { ink: "#0b0e14", card: "#151a24", line: "#2a3140", white: "#f2f4f7", muted: "#a3aab6", faint: "#767e8c", acc: "#8ea2ff", acc2: "#b9c6ff", red: "#ff8a7f" };
// pitch/src/deck_style.py on origin/pitch-deck, lines 13-15
const T = { paper: "#ffffff", ink: "#0a0c11", accent: "#6e7df0", accentbg: "#f4f5ff", muted: "#5b6272", rule: "#c9cdd6", vgreen: "#2f7d5b", aamber: "#a8670f", gred: "#b23a30" };
// whitepaper/style.tex on origin/whitepaper @ 827a0ec, lines 3-10

const lineStrongOnInk = toHex(over([255, 255, 255], 0.14, hex(W.ink)));
const lineOnInk = toHex(over([255, 255, 255], 0.08, hex(W.ink)));

export const pairs = [
  // ---------- website (dark only) ----------
  P("website", "fg", W.fg, "ink", W.ink, "text", "body text"),
  P("website", "muted", W.muted, "ink", W.ink, "text", "sublines, section body"),
  P("website", "muted", W.muted, "panel", W.panel, "text", "card body (bg-panel)"),
  P("website", "faint", W.faint, "ink", W.ink, "text", "13-13.5px footnotes, footer legal"),
  P("website", "faint", W.faint, "panel", W.panel, "text", "browser-frame label 12px"),
  P("website", "faint", W.faint, "panel2", W.panel2, "text", "worst-case panel-2"),
  P("website", "accent", W.accent, "ink", W.ink, "text", "eyebrows, links"),
  P("website", "ink on fg", W.ink, "fg", W.fg, "text", "primary button label"),
  P("website", "good", W.good, "ink", W.ink, "text", "status dot / good text"),
  P("website", "warn", W.warn, "ink", W.ink, "text", "warning text"),
  P("website", "bad", W.bad, "ink", W.ink, "text", "error text"),
  P("website", "accent (focus ring)", W.accent, "ink", W.ink, "ui", "2px :focus-visible outline"),
  P("website", "line-strong (14% white)", lineStrongOnInk, "ink", W.ink, "ui", "secondary-button border, form-field border"),
  P("website", "line (8% white)", lineOnInk, "ink", W.ink, "ui", "dividers (decorative, exempt)"),
  P("website", "accent-strong", W.accentStrong, "ink", W.ink, "text", "if ever used as text"),
  // ---------- product light ----------
  P("product light", "text", L.text, "canvas", L.canvas, "text", "body"),
  P("product light", "text-2", L.text2, "panel", L.panel, "text", ".muted"),
  P("product light", "text-2", L.text2, "canvas", L.canvas, "text", ".muted on canvas"),
  P("product light", "text-3", L.text3, "panel", L.panel, "text", ".faint, table headers 12px, .k labels, hints"),
  P("product light", "text-3", L.text3, "canvas", L.canvas, "text", ".faint on canvas, .pay-foot"),
  P("product light", "text-3", L.text3, "panel-2", L.panel2, "text", ".faint on panel-2"),
  P("product light", "accent", L.accent, "panel", L.panel, "text", "links"),
  P("product light", "accent", L.accent, "canvas", L.canvas, "text", "links on canvas"),
  P("product light", "accent-text", L.accentText, "accent", L.accent, "text", "primary button"),
  P("product light", "accent", L.accent, "accent-soft", L.accentSoft, "text", "pill confirming / tone-progress"),
  P("product light", "green", L.green, "green-soft", L.greenSoft, "text", "pill completed / tone-paid"),
  P("product light", "green", L.green, "panel", L.panel, "text", "pill matched, s-pass"),
  P("product light", "amber", L.amber, "amber-soft", L.amberSoft, "text", "bar-amber, needs review"),
  P("product light", "red", L.red, "red-soft", L.redSoft, "text", "bar-red, blocked"),
  P("product light", "text-2", L.text2, "panel-2", L.panel2, "text", "badge, awaiting pill"),
  P("product light", "border-strong", L.borderStrong, "panel", L.panel, "ui", ".btn / .input border"),
  P("product light", "border", L.border, "panel", L.panel, "ui", "panel border (decorative)"),
  P("product light", "focus", L.focus, "panel", L.panel, "ui", "focus ring"),
  P("product light", "focus", L.focus, "canvas", L.canvas, "ui", "focus ring on canvas"),
  // ---------- product dark ----------
  P("product dark", "text", D.text, "canvas", D.canvas, "text", "body"),
  P("product dark", "text-2", D.text2, "panel", D.panel, "text", ".muted"),
  P("product dark", "text-3", D.text3, "panel", D.panel, "text", ".faint, table headers"),
  P("product dark", "text-3", D.text3, "canvas", D.canvas, "text", ".faint on canvas"),
  P("product dark", "accent", D.accent, "panel", D.panel, "text", "links"),
  P("product dark", "accent-text", D.accentText, "accent", D.accent, "text", "primary button"),
  P("product dark", "accent", D.accent, "accent-soft", D.accentSoft, "text", "pill confirming"),
  P("product dark", "green", D.green, "green-soft", D.greenSoft, "text", "pill completed"),
  P("product dark", "amber", D.amber, "amber-soft", D.amberSoft, "text", "bar-amber"),
  P("product dark", "red", D.red, "red-soft", D.redSoft, "text", "bar-red"),
  P("product dark", "border-strong", D.borderStrong, "panel", D.panel, "ui", ".btn / .input border"),
  P("product dark", "focus", D.focus, "panel", D.panel, "ui", "focus ring"),
  // ---------- deck (dark) ----------
  P("deck", "WHITE", K.white, "INK", K.ink, "text", "titles, body"),
  P("deck", "MUTED", K.muted, "INK", K.ink, "text", "subtitles 20pt"),
  P("deck", "MUTED", K.muted, "CARD", K.card, "text", "card body"),
  P("deck", "FAINT", K.faint, "INK", K.ink, "text", "10pt source footers"),
  P("deck", "FAINT", K.faint, "CARD", K.card, "text", "faint on card"),
  P("deck", "ACC", K.acc, "INK", K.ink, "text", "pills, accents"),
  P("deck", "ACC2", K.acc2, "INK", K.ink, "text", "tagline, label tags"),
  P("deck", "RED", K.red, "INK", K.ink, "text", "warnings"),
  P("deck", "LINE", K.line, "CARD", K.card, "ui", "card border (decorative)"),
  // ---------- whitepaper (print, white paper) ----------
  P("whitepaper", "ink", T.ink, "paper", T.paper, "text", "body"),
  P("whitepaper", "muted", T.muted, "paper", T.paper, "text", "captions, footnotes, footer"),
  P("whitepaper", "accent", T.accent, "paper", T.paper, "text", "links, section rule"),
  P("whitepaper", "ink", T.ink, "accentbg", T.accentbg, "text", "statusbox text"),
  P("whitepaper", "vgreen", T.vgreen, "paper", T.paper, "text", "[VERIFIED] tag (scriptsize)"),
  P("whitepaper", "aamber", T.aamber, "paper", T.paper, "text", "[ASSUMPTION] tag (scriptsize)"),
  P("whitepaper", "gred", T.gred, "paper", T.paper, "text", "[GUESS] tag (scriptsize)"),
  P("whitepaper", "rule", T.rule, "paper", T.paper, "ui", "table rules (decorative)"),
];

const need = (k) => (k === "text" ? 4.5 : 3);

function table() {
  const rows = pairs.map((p) => {
    const r = ratio(hex(p.fg), hex(p.bg));
    const ok = r >= need(p.kind);
    const largeOnly = p.kind === "text" && !ok && r >= 3;
    const verdict = ok ? "PASS" : largeOnly ? "FAIL (large text only)" : "FAIL";
    return `| ${p.surface} | ${p.fgName} \`${p.fg}\` | ${p.bgName} \`${p.bg}\` | ${r.toFixed(2)}:1 | ${p.kind} (${need(p.kind)}:1) | ${verdict} | ${p.where} |`;
  });
  return ["| Surface | Foreground | Background | Ratio | Needs | Result | Used for |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
}

if (process.argv[2] && process.argv[3]) {
  console.log(ratio(hex(process.argv[2]), hex(process.argv[3])).toFixed(2) + ":1");
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(table());
}
