/**
 * rc6 public cases demo: a one-page PDF summary per case (A4, standard Helvetica, pdf-lib). Every figure comes from
 * the case's engine output. The page never grows past one: anything that would not fit is left to the CSV, and the
 * page says so.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { winAnsi, wrapLines } from "../../payments/pdf";
import { fmtFiat } from "../merchant";
import {
  DECISION_TEXT, JOURNAL_KIND_TEXT, LABEL, POSTING_RULE_PENDING, bookCurrency, caseModel, flow, money, needsAttention, signedMoney, summaryFigures, type CaseSlug,
} from "./view";

const PAGE = { w: 595.28, h: 841.89 };
const M = 40;
/** WinAnsi has no true minus sign. */
const plain = (t: string): string => winAnsi(t.replace(/\u2212/g, "-"));
const W = PAGE.w - M * 2;
const INK = rgb(0.09, 0.13, 0.18);
const GREY = rgb(0.31, 0.36, 0.45);
const AMBER = rgb(0.54, 0.33, 0);
const AMBER_BG = rgb(0.996, 0.953, 0.839);

class Writer {
  y = PAGE.h - M;
  truncated = false;
  constructor(private page: PDFPage, private regular: PDFFont, private bold: PDFFont, public floor: number) {}
  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 9;
    const x = o.x ?? M;
    const font = o.bold ? this.bold : this.regular;
    for (const l of wrapLines(plain(t), size, o.width ?? W - (x - M), o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)) {
      if (this.y - size < this.floor) { this.truncated = true; return; }
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= o.gap ?? 0;
  }
  /** One table row: cells at fixed x offsets, each clipped to one line (the CSV has the full text). */
  row(cells: string[], xs: number[], o: { bold?: boolean; size?: number } = {}) {
    const size = o.size ?? 8;
    if (this.y - size < this.floor) { this.truncated = true; return; }
    const font = o.bold ? this.bold : this.regular;
    cells.forEach((c, i) => {
      const width = (xs[i + 1] ?? M + W) - xs[i] - 6;
      let s = plain(c);
      while (s.length > 1 && font.widthOfTextAtSize(s, size) > width) s = s.slice(0, -2) + "…";
      this.page.drawText(s, { x: xs[i], y: this.y - size, size, font, color: INK });
    });
    this.y -= size + 4;
  }
  rule() { if (this.y - 6 < this.floor) return; this.page.drawLine({ start: { x: M, y: this.y - 3 }, end: { x: M + W, y: this.y - 3 }, thickness: 0.5, color: GREY }); this.y -= 8; }
  heading(t: string) { this.y -= 4; this.text(t, { size: 10.5, bold: true, gap: 1 }); }
}

export async function casePdf(slug: CaseSlug): Promise<Uint8Array> {
  const m = caseModel(slug);
  const doc = await PDFDocument.create();
  const title = `Clearline · Case ${m.number}: ${m.title}`;
  doc.setTitle(winAnsi(`${title} (${LABEL})`));
  doc.setSubject(winAnsi(LABEL));
  doc.setCreator("Clearline cases demo");
  doc.setProducer("Clearline cases demo");
  // No clock: the document is dated by the case's first chain transfer, so the same case gives the same bytes.
  const first = m.books[0].input.transfers.map((t) => t.timestamp).sort()[0];
  doc.setCreationDate(new Date(first));
  doc.setModificationDate(new Date(first));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const FOOTER = 46;
  const w = new Writer(page, regular, bold, M + FOOTER);

  // Label band, prominent at the top.
  page.drawRectangle({ x: M, y: w.y - 22, width: W, height: 22, color: AMBER_BG, borderColor: AMBER, borderWidth: 0.8 });
  page.drawText(winAnsi(`${LABEL.toUpperCase()}  ·  every name is fictional`), { x: M + 8, y: w.y - 15, size: 9.5, font: bold, color: AMBER });
  w.y -= 32;
  w.text(title, { size: 16, bold: true, gap: 2 });
  w.text(m.lede, { size: 8.5, color: GREY, gap: 4 });

  for (const b of m.books) {
    const cur = bookCurrency(b);
    w.heading(`${b.title}: ${b.input.entity.name} · ${cur}`);
    const figs = summaryFigures(b);
    for (let i = 0; i < figs.length; i += 2) w.row(figs.slice(i, i + 2).map((f) => `${f.label}: ${f.value}`), [M, M + W / 2]);
    const xs = [M, M + 62, M + 180, M + 380];
    w.y -= 2;
    w.row(["Order", "Result (step)", "Rule", "Owner"], xs, { bold: true });
    w.rule();
    const recs = b.result.records;
    const shown = recs.length > 8 ? recs.filter(needsAttention) : recs;
    for (const r of shown) {
      const e = r.explanation;
      w.row([r.orderId, `${DECISION_TEXT[e.decision]} (${e.decidingStep})`, e.ruleId, r.attention?.owner ?? "none"], xs);
      if (e.differences.length) w.row([`Difference: ${e.differences.map((d) => `${d.type} ${signedMoney(d.amountMinor, d.currency)}`).join("; ")}`], [M + 62]);
    }
    if (shown.length < recs.length) {
      const rest = recs.filter((r) => !needsAttention(r));
      const rules = [...new Set(rest.map((r) => `${r.explanation.ruleId}, step ${r.explanation.decidingStep}`))].join("; ");
      w.text(`${rest.length} other orders: Matched (${rules}). Every order is listed in the CSV.`, { size: 8, color: GREY });
    }
    for (const ex of b.result.exceptions) w.text(`Exception ${ex.orderId ?? ex.id} · owner ${ex.owner}: ${ex.reason} Next step: ${ex.nextStep}`, { size: 8 });
    for (const wo of b.result.writeOffs) w.text(`Write-off ${wo.id}: ${money(wo.amountMinor, wo.currency)} ${wo.direction}, proposed by the engine; needs approval by a second person.`, { size: 8 });

    if (m.number === 2) {
      for (const br of b.result.bridges) {
        if (br.lines.find((l) => l.kind === "merchant_day")?.amountMinor === 0n) {
          w.text(`Batch ${br.batchId} (prior batch): gross ${money(br.lines.find((l) => l.kind === "gross")!.amountMinor, cur)}, net ${money(br.lines.find((l) => l.kind === "net")!.amountMinor, cur)}, ${br.tied ? "tied to the cent" : "not tied"}.`, { size: 8 });
          continue;
        }
        w.text(`Bridge, batch ${br.batchId} → bank line ${br.bankLineId} (${br.tied ? "tied to the cent" : "not tied"}):`, { size: 8.5, bold: true });
        for (const l of br.lines) {
          const amt = l.kind === "merchant_day" || l.kind === "gross" || l.kind === "net" ? money(l.amountMinor, cur) : signedMoney(l.amountMinor, cur);
          w.row([l.label, amt, `${l.paymentIds.length} payment ID${l.paymentIds.length === 1 ? "" : "s"}`], [M + 8, M + 330, M + 430], { size: 8 });
        }
      }
    }
    if (m.number === 3) {
      for (const p of flow(b)) {
        w.text(`Part ${p.part} via ${p.linkId} (${p.network}): ${p.nodes.map((n) => `${n.facts.join(", ")}`).join(" -> ")}. ${p.provider.id} credited ${p.provider.credited} at ${p.provider.rate}. Recorded facts, not judgements.`, { size: 8 });
      }
      const rec = b.result.records[0];
      const gap = rec.ledger.invoice.amountMinor - rec.ledger.creditedMinor;
      w.text(`Credited ${money(rec.ledger.creditedMinor, cur)} of ${money(rec.ledger.invoice.amountMinor, cur)}: gap ${money(gap, cur)} = ${rec.explanation.differences.map((d) => `${fmtFiat(-d.amountMinor, d.currency)} ${d.type}`).join(" + ")}.`, { size: 8.5, bold: true });
      if (m.afterPart1) {
        const r1 = m.afterPart1.result.records[0];
        w.text(`After part 1 only: open balance ${money(r1.ledger.openBalanceMinor, cur)}, ${r1.ledger.balanceLabel} (not overdue).`, { size: 8 });
      }
    }
    const kinds = (Object.keys(JOURNAL_KIND_TEXT) as (keyof typeof JOURNAL_KIND_TEXT)[]).map((k) => [JOURNAL_KIND_TEXT[k], b.journals.filter((j) => j.kind === k).length] as const).filter(([, n]) => n > 0);
    w.text(`Proposed journal entries: ${b.journals.length} (${kinds.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}), each marked "${POSTING_RULE_PENDING}". Nothing is posted.`, { size: 8, gap: 2 });
  }

  if (w.truncated) {
    w.floor = M + FOOTER - 12;
    w.text("More detail did not fit on one page: download the CSV for every order.", { size: 8, bold: true });
  }
  page.drawLine({ start: { x: M, y: M + 30 }, end: { x: M + W, y: M + 30 }, thickness: 0.5, color: GREY });
  page.drawText(winAnsi(`${LABEL}. Every company, person, wallet and bank account is fictional.`), { x: M, y: M + 18, size: 8, font: bold, color: AMBER });
  page.drawText(winAnsi("Figures from the Clearline reconciliation engine. Journal entries are proposals; nothing is posted."), { x: M, y: M + 7, size: 7.5, font: regular, color: GREY });
  return doc.save({ useObjectStreams: false });
}

export const pdfFileName = (slug: CaseSlug): string => `clearline-case-${caseModel(slug).number}-${slug}-test-mode.pdf`;
