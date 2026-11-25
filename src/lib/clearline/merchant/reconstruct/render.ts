/**
 * The reconstruction report as files: JSON (the report itself), CSV (the public case demo's columns) and a
 * self-contained HTML page (inline styles only; no script, image, font or link to anything outside the file).
 * Pure: the same report gives the same bytes.
 */
import { csvCell } from "../../../csv/cell";
import type { ReconstructionReport } from "./types";

/** The public case demo's CSV columns (rc6 phase 9). */
export const CSV_COLUMNS = ["order", "amounts", "difference", "type", "result", "rule", "owner"] as const;

export const reportJson = (r: ReconstructionReport): string => `${JSON.stringify(r, null, 2)}\n`;

/**
 * One row per typed difference (or one row for an item with none). Every cell goes through rc5's csvCell: a value a
 * spreadsheet could run (= + - @, a tab or a carriage return, even after leading spaces) is prefixed with ', and
 * RFC 4180 quoting doubles quotes. UTF-8 with a byte-order mark; CRLF line ends.
 */
export function reportCsv(r: ReconstructionReport): string {
  const line = (cells: readonly string[]) => cells.map((c) => csvCell(c)).join(",");
  const rows: string[][] = [];
  for (const it of r.items) {
    const amounts = `Invoice ${it.invoice}; credited ${it.credited}`;
    const result = `${it.result} (${it.resultText}, step ${it.decidingStep})`;
    const diffs = it.differences.length ? it.differences : [null];
    for (const d of diffs) rows.push([it.orderId, amounts, d ? d.amount : it.difference, d ? d.type : "none", result, it.rule, it.owner ?? ""]);
  }
  const lines = [line([r.label]), line([r.title]), line(CSV_COLUMNS), ...rows.map(line)];
  return `﻿${lines.join("\r\n")}\r\n`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text for HTML element content and attribute values. */
export const esc = (v: string | number | boolean | null | undefined): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const STYLE = `
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1f24;background:#fff}
body{margin:0 auto;max-width:72rem;padding:1rem 1.25rem 3rem;line-height:1.45}
.label{background:#fff4ce;border:2px solid #8a6d00;color:#3d3000;font-weight:700;padding:.5rem .75rem;margin:0 0 1rem}
h1{font-size:1.5rem;margin:.25rem 0}h2{font-size:1.2rem;margin:2rem 0 .5rem;border-bottom:1px solid #c9ced6;padding-bottom:.25rem}h3{font-size:1rem;margin:1.25rem 0 .25rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}th,td{border:1px solid #c9ced6;padding:.3rem .45rem;text-align:left;vertical-align:top}
th{background:#eef1f5}td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em}
dl.figs{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem;margin:.5rem 0}
dl.figs div{border:1px solid #c9ced6;padding:.5rem}dl.figs dt{font-size:.85rem;color:#4a515b}dl.figs dd{margin:0;font-weight:700}
.muted{color:#4a515b;font-size:.9rem}.ok{color:#11612b;font-weight:700}.bad{color:#9b1c1c;font-weight:700}
`;

const table = (caption: string, head: readonly string[], rows: readonly string[][], numeric: readonly number[] = []): string =>
  `<table><caption class="muted">${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

const yesNo = (ok: boolean) => (ok ? '<span class="ok">yes</span>' : '<span class="bad">no</span>');

export function reportHtml(r: ReconstructionReport): string {
  const s: string[] = [];
  s.push(`<!doctype html><html lang="en"><head><meta charset="utf-8">`);
  s.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'">`);
  s.push(`<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(r.title)}</title><style>${STYLE}</style></head><body>`);
  s.push(`<header><p class="label" role="note">${esc(r.label)}</p><h1>${esc(r.title)}</h1>`);
  s.push(`<p class="muted">Entity ${esc(r.entity.name)} (${esc(r.entity.id)}), ${esc(r.entity.currency)}, ${esc(r.entity.timeZone)}. Tolerance band ${esc(r.policy.band)}; write-off threshold ${esc(r.policy.writeOffThreshold)}. Generated: ${esc(r.generatedAt ?? "not stated")}. Input digest <code>${esc(r.inputDigest)}</code>.</p></header><main>`);

  s.push(`<section aria-labelledby="h-figures"><h2 id="h-figures">Summary</h2><dl class="figs">`);
  for (const f of r.figures) s.push(`<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>${f.onceBankConfirmed ? `<dd class="muted">Once the bank line is confirmed: ${esc(f.onceBankConfirmed)}</dd>` : ""}${f.note ? `<dd class="muted">${esc(f.note)}</dd>` : ""}</div>`);
  s.push(`</dl></section>`);

  s.push(`<section aria-labelledby="h-questions"><h2 id="h-questions">Questions to ask the provider</h2>`);
  s.push(r.questions.length ? `<ol>${r.questions.map((q) => `<li>${esc(q.text)} <span class="muted">${esc(q.because)}</span></li>`).join("")}</ol>` : `<p>None: the data had no gaps the tool could detect.</p>`);
  s.push(`</section><section aria-labelledby="h-unmappable"><h2 id="h-unmappable">Unmappable fields</h2>`);
  s.push(r.unmappable.length ? table("Source columns with no mapping, and required fields missing", ["Source", "Field", "Kind", "Records", "Detail"], r.unmappable.map((u) => [esc(u.source), `<code>${esc(u.field)}</code>`, esc(u.kind), esc(u.records ?? ""), esc(u.detail)]), [3]) : `<p>None.</p>`);
  s.push(`</section>`);

  s.push(`<section aria-labelledby="h-items"><h2 id="h-items">Items</h2>`);
  s.push(table("Result, rule and deciding step per order", ["Order", "Invoice", "Credited", "Difference", "Result", "Rule", "Step", "Once bank-confirmed", "Owner and next step"],
    r.items.map((it) => [
      `<code>${esc(it.orderId)}</code>`, esc(it.invoice), esc(it.credited),
      it.differences.length ? it.differences.map((d) => `${esc(d.amount)} ${esc(d.typeText)}<br><span class="muted">${esc(d.reason)}</span>`).join("<br>") : esc(it.difference),
      esc(it.resultText), `<code>${esc(it.rule)}</code><br><span class="muted">${esc(it.ruleText)}</span>`, esc(it.decidingStep),
      `${esc(it.onceBankConfirmed.resultText)} (<code>${esc(it.onceBankConfirmed.rule)}</code>, step ${esc(it.onceBankConfirmed.decidingStep)})`,
      it.owner ? `${esc(it.owner)}: ${esc(it.nextStep)}` : "",
    ]), [1, 2, 6]));
  s.push(`</section>`);

  s.push(`<section aria-labelledby="h-bridges"><h2 id="h-bridges">Bridge per batch</h2>`);
  if (!r.bridges.length) s.push(`<p>No settlement batch.</p>`);
  for (const b of r.bridges) {
    s.push(`<h3>Batch ${esc(b.batchId)}</h3><p class="muted">Merchant day ${esc(b.merchantDay)} (${esc(b.merchantTimeZone)}); provider day ${esc(b.providerDay)} (${esc(b.providerTimeZone)}). Bank line ${esc(b.bankLineId ?? "none")}${b.bankLineLabel ? ` (${esc(b.bankLineLabel)})` : ""}. Tied: ${yesNo(b.tied)}. Settlement verified: ${yesNo(b.settlementVerified)}; once the bank line is confirmed: ${yesNo(b.settlementVerifiedOnceBankConfirmed)}. ${esc(b.bankEvidenceLabel)}.</p>`);
    s.push(table(`Bridge for ${b.batchId}`, ["Line", "Amount", "Reason"], b.lines.map((l) => [esc(l.label), esc(l.amount), esc(l.reason)]), [1]));
    s.push(table(`Checks for ${b.batchId}`, ["Check", "Holds"], b.checks.map((c) => [esc(c.check), yesNo(c.ok)])));
  }
  if (r.groupings.length) s.push(table("Groupings that need a person's confirmation (no batch ID)", ["Grouping", "Status", "Provider day", "Total", "Orders", "Note"], r.groupings.map((g) => [esc(g.id), esc(g.status), esc(g.providerDay), esc(g.total), esc(g.orderIds.join(", ")), esc(g.note)]), [3]));
  s.push(`</section>`);

  s.push(`<section aria-labelledby="h-journals"><h2 id="h-journals">Journal proposals</h2><p>Every entry is a proposal: <strong>posting rule pending sign-off</strong>. Nothing is posted.</p>`);
  const journals = (js: ReconstructionReport["journals"], what: string) => {
    if (!js.length) { s.push(`<p>None ${esc(what)}.</p>`); return; }
    for (const j of js) {
      s.push(`<h3>${esc(j.id)} · ${esc(j.kindText)} · ${esc(j.postingRule)}</h3><p class="muted">${esc(j.memo)} Entry date ${esc(j.entryDate ?? "on approval")}. Rule <code>${esc(j.ruleId)}</code>.</p>`);
      s.push(table(`Lines of ${j.id}`, ["Account", "Debit", "Credit"], j.lines.map((l) => [esc(l.account), l.side === "debit" ? esc(l.amount) : "", l.side === "credit" ? esc(l.amount) : ""]), [1, 2]));
    }
  };
  journals(r.journals, "as imported");
  const extra = r.journalsOnceBankConfirmed.filter((j) => !r.journals.some((x) => x.id === j.id)).map((j) => j.id);
  if (extra.length) s.push(`<p>Once the bank line is confirmed in the bank feed, these would also be proposed: ${esc(extra.join(", "))}.</p>`);
  s.push(`</section>`);

  if (r.rejected.length) s.push(`<section aria-labelledby="h-rejected"><h2 id="h-rejected">Rejected rows</h2>${table("Rows that were not read, with the reason", ["Source", "Row", "Code", "Reason"], r.rejected.map((x) => [esc(x.source), esc(x.row ?? ""), esc(x.code), esc(x.reason)]), [1])}</section>`);
  if (r.notes.length || r.assumptions.length) s.push(`<section aria-labelledby="h-notes"><h2 id="h-notes">Notes and assumptions</h2><ul>${[...r.notes, ...r.assumptions.map((a) => `[ASSUMPTION] ${a}`)].map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`);
  s.push(`<section aria-labelledby="h-inputs"><h2 id="h-inputs">Inputs</h2>${table("Files read", ["File", "Role", "Bytes", "SHA-256"], r.inputs.map((i) => [esc(i.file), esc(i.role), esc(i.bytes), `<code>${esc(i.sha256)}</code>`]), [2])}</section>`);
  s.push(`</main><footer><p class="label" role="note">${esc(r.label)}</p><p class="muted">Clearline does not move money. Provider statuses are claims, not proof. Produced locally; nothing left this machine.</p></footer></body></html>\n`);
  return s.join("");
}
