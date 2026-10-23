// Draws an evidence pack as a PDF (A4, standard Helvetica, no external fonts). Text is wrapped to
// the page and paginated; characters the standard font can't encode are mapped to plain ones, so
// an unexpected character never stops a pack from rendering.

import { PDFDocument, StandardFontEmbedder, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { EvidencePack } from "./export";

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const WIDTH = PAGE.w - MARGIN * 2;

// The standard fonts use WinAnsi: keep what it has, map the rest.
const MAP: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≠": "!=", "✓": "v", "×": "x", " ": " " };
export function winAnsi(s: string): string {
  return [...s].map((c) => {
    if (MAP[c] !== undefined) return MAP[c];
    const code = c.codePointAt(0)!;
    if (code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return c;
    return "…·—–‘’“”•€".includes(c) ? c : "?";
  }).join("");
}

// Character widths at size 1, measured once per font and cached: widths add up (no kerning in
// these metrics), so a running total measures a line without re-measuring it.
const widths = new Map<StandardFonts, { embedder: StandardFontEmbedder; cache: Map<string, number> }>();
function charWidth(font: StandardFonts, c: string): number {
  let m = widths.get(font);
  // StandardFonts values are the standard font names the embedder takes.
  if (!m) { m = { embedder: StandardFontEmbedder.for(font as unknown as Parameters<typeof StandardFontEmbedder.for>[0]), cache: new Map() }; widths.set(font, m); }
  let w = m.cache.get(c);
  if (w === undefined) { w = m.embedder.widthOfTextAtSize(c, 1); m.cache.set(c, w); }
  return w;
}

/**
 * Wrap text to a width, in time linear in its length: each character is measured once. Words
 * wrap at spaces; a word wider than the line (a hash, a URL) is broken by characters.
 */
export function wrapLines(text: string, size: number, width: number = WIDTH, font: StandardFonts = StandardFonts.Helvetica): string[] {
  const out: string[] = [];
  const limit = width / size;
  for (const para of winAnsi(text).split("\n")) {
    let line = "";
    let lineW = 0;
    for (const token of para.split(/(\s+)/)) {
      if (!token) continue;
      let tokenW = 0;
      for (const c of token) tokenW += charWidth(font, c);
      if (lineW + tokenW <= limit) { line += token; lineW += tokenW; continue; }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      lineW = 0;
      if (/^\s+$/.test(token)) continue;
      if (tokenW <= limit) { line = token; lineW = tokenW; continue; }
      // Too wide for any line: break it by characters, carrying the remainder on.
      for (const c of token) {
        const cw = charWidth(font, c);
        if (lineW + cw > limit && line) { out.push(line); line = ""; lineW = 0; }
        line += c;
        lineW += cw;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export async function renderPack(pack: EvidencePack): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(pack.title));
  doc.setCreator("Investigation desk");
  doc.setProducer("Investigation desk");
  doc.setCreationDate(new Date(pack.generatedAt));
  doc.setModificationDate(new Date(pack.generatedAt));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.38, 0.38, 0.38);

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const ensure = (h: number) => {
    if (y - h >= MARGIN + 18) return;
    page = doc.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - MARGIN;
  };
  const text = (s: string, opts: { font?: PDFFont; size?: number; x?: number; width?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9;
    const lead = size * 1.35;
    for (const line of wrapLines(s, size, opts.width ?? WIDTH, font === bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)) {
      ensure(lead);
      page.drawText(line, { x: opts.x ?? MARGIN, y: y - size, size, font, color: opts.color });
      y -= lead;
    }
  };

  text(pack.title, { font: bold, size: 15 });
  text(pack.subtitle, { size: 10 });
  text(`Generated ${pack.generatedAt}. Read-only record of what the desk knew; no customer names or personal data.`, { size: 8, color: grey });
  y -= 6;
  for (const s of pack.sections) {
    ensure(30);
    y -= 6;
    text(s.heading, { font: bold, size: 11 });
    for (const [k, v] of s.rows ?? []) {
      // Label and value side by side, line by line, so a row can cross a page break cleanly.
      const labelW = 150;
      const kl = wrapLines(k, 9, labelW - 8, StandardFonts.HelveticaBold);
      const vl = wrapLines(v, 9, WIDTH - labelW);
      for (let i = 0; i < Math.max(kl.length, vl.length); i++) {
        ensure(12.2);
        if (kl[i]) page.drawText(kl[i], { x: MARGIN, y: y - 9, size: 9, font: bold });
        if (vl[i]) page.drawText(vl[i], { x: MARGIN + labelW, y: y - 9, size: 9, font: regular });
        y -= 12.2;
      }
      y -= 2;
    }
    for (const l of s.lines ?? []) text(`• ${l}`, { size: 9 });
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(winAnsi(`${pack.title} · page ${i + 1} of ${pages.length}`), { x: MARGIN, y: MARGIN - 18, size: 7, font: regular, color: grey }));
  return doc.save();
}
