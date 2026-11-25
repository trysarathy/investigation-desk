/**
 * v1 phase 4: the month-end pack as a PDF and an XLSX workbook, from one model (src/server/month-end-pack.ts builds it
 * from the database). Sections: bridges; receivable from the provider by batch; exceptions by age; write-offs with
 * preparer and approver; FX revaluation; journals (draft / pending sign-off labels); evidence index (with the bank
 * evidence level of each payment). `monthEndChecks` proves that the totals reconcile across sections, in BigInt.
 * Files only: nothing is posted, approved or sent anywhere. Amounts are exact minor units until they are written.
 */
import { plainAmount } from "./journal-drafts";
import { BANK_EVIDENCE_RANK, BANK_EVIDENCE_SHORT, type BankEvidenceLevel } from "../merchant/types";

type Minor = string;
export interface PackBridge { batchId: string; providerDay: string; currency: string; grossMinor: Minor; feesMinor: Minor; refundsMinor: Minor; netMinor: Minor; bankLineId: string; bankLine: string; tied: boolean; settlementVerified: boolean; bankEvidence: string; bankEvidenceLabel: string; settled: boolean; payments: number }
export interface PackReceivable { batchId: string; currency: string; creditedMinor: Minor; orderIds: string[]; reason: string }
export interface PackException { id: string; orderId: string; ownerRole: string; owner: string; reason: string; nextStep: string; openedAt: string; ageDays: number; bucket: string }
export interface PackWriteoff { id: string; orderId: string; amountMinor: Minor; currency: string; status: string; preparedBy: string; approvedBy: string; decidedAt: string }
export interface PackFxItem { ref: string; currency: string; foreignMinor: Minor; status: "proposed" | "no_difference" | "needs_rate"; closingMinor: Minor | null; carryingMinor: Minor | null; differenceMinor: Minor | null; note: string }
export type PackFx =
  | { available: true; functionalCurrency: string; closingAt: string; rates: { pair: string; rate: string; asOf: string; source: string }[]; items: PackFxItem[]; proposalIds: string[]; note: string }
  | { available: false; reason: string };
export interface PackJournalLine { side: "debit" | "credit"; account: string; accountName: string; amountMinor: Minor; batchId?: string; onApproval?: string }
export interface PackJournal { id: string; entryDate: string; pattern: string; label: string; requiresApprovalOf: string; lines: PackJournalLine[] }
export interface PackEvidence { orderId: string; decision: string; bankEvidence: string; bankEvidenceLabel: string; settled: boolean; chainTransfers: number; providerRecords: number; packPath: string }

export interface MonthEndPackModel {
  label: string; marking: string; organisation: string; month: string; generatedAt: string; agesAsOf: string;
  entity: { id: string; name: string; currency: string; timezone: string };
  postingRules: { signed: boolean; version: string; signedBy: string | null; signedAt: string | null };
  bridges: PackBridge[]; receivable: PackReceivable[]; exceptions: PackException[]; exceptionBuckets: { label: string; count: number }[];
  writeoffs: PackWriteoff[]; fx: PackFx; journals: PackJournal[]; evidence: PackEvidence[];
}

/** The three bank evidence levels, in rank order, with their short labels (taken from the definitions, never retyped). */
export const EVIDENCE_LEVELS: [string, string][] = (Object.keys(BANK_EVIDENCE_RANK) as BankEvidenceLevel[]).sort((a, b) => BANK_EVIDENCE_RANK[a] - BANK_EVIDENCE_RANK[b]).map((k) => [k, BANK_EVIDENCE_SHORT[k]]);

const B = (s: Minor) => BigInt(s);
const sumOf = <T>(xs: readonly T[], f: (x: T) => bigint) => xs.reduce((t, x) => t + f(x), 0n);
const byCurrency = <T extends { currency: string }>(xs: readonly T[]) => [...new Set(xs.map((x) => x.currency))].sort();

export interface PackCheck { id: string; description: string; left: string; right: string; agrees: boolean }

/** Every cross-section total, recomputed from the sections themselves. */
export function monthEndChecks(m: MonthEndPackModel): PackCheck[] {
  const cur = m.entity.currency;
  const out: PackCheck[] = [];
  const amt = (v: bigint, c: string) => `${c} ${plainAmount(v, c)}`;
  for (const c of byCurrency(m.bridges)) {
    const bs = m.bridges.filter((b) => b.currency === c);
    const left = sumOf(bs, (b) => B(b.grossMinor) - B(b.feesMinor) - B(b.refundsMinor)), right = sumOf(bs, (b) => B(b.netMinor));
    out.push({ id: `bridges.net.${c}`, description: `Bridges (${c}): gross − fees − refunds = net`, left: amt(left, c), right: amt(right, c), agrees: left === right });
  }
  const setl = m.journals.filter((j) => j.pattern === "settlement");
  const bridged = setl.map((j) => ({ j, b: m.bridges.find((b) => j.lines.some((l) => l.batchId === b.batchId)) })).filter((x) => x.b);
  const jBank = sumOf(bridged, ({ j }) => sumOf(j.lines.filter((l) => l.side === "debit" && l.account === "bank"), (l) => B(l.amountMinor)));
  const bNet = sumOf(bridged, ({ b }) => B(b!.netMinor));
  out.push({ id: "journals.settlement_vs_bridges", description: `Settlement journals' bank debits = net of their bridges (${bridged.length} batch(es))`, left: amt(jBank, cur), right: amt(bNet, cur), agrees: jBank === bNet && bridged.every(({ b }) => b!.tied && b!.settlementVerified) });
  const dr = sumOf(m.journals.flatMap((j) => j.lines), (l) => (l.side === "debit" ? B(l.amountMinor) : 0n)), cr = sumOf(m.journals.flatMap((j) => j.lines), (l) => (l.side === "credit" ? B(l.amountMinor) : 0n));
  out.push({ id: "journals.balanced", description: `Journals: total debits = total credits (${m.journals.length} journal(s))`, left: amt(dr, cur), right: amt(cr, cur), agrees: dr === cr && m.journals.every((j) => sumOf(j.lines, (l) => (l.side === "debit" ? 1n : -1n) * B(l.amountMinor)) === 0n) });
  const buckets = m.exceptionBuckets.reduce((t, b) => t + b.count, 0);
  out.push({ id: "exceptions.ages", description: "Exceptions: the age buckets add up to the open exceptions listed", left: String(buckets), right: String(m.exceptions.length), agrees: buckets === m.exceptions.length });
  const wos = m.writeoffs.filter((w) => m.journals.some((j) => j.lines.some((l) => l.onApproval === w.id)));
  const woLines = sumOf(m.journals.flatMap((j) => j.lines).filter((l) => wos.some((w) => w.id === l.onApproval)), (l) => B(l.amountMinor));
  const woAmt = sumOf(wos, (w) => B(w.amountMinor));
  out.push({ id: "writeoffs.vs_journals", description: `Write-offs = the journal lines waiting on them (${wos.length} write-off(s) with a journal this month)`, left: amt(woAmt, cur), right: amt(woLines, cur), agrees: woAmt === woLines });
  const levels = EVIDENCE_LEVELS.map(([k]) => m.evidence.filter((e) => e.bankEvidence === k).length).reduce((a, b) => a + b, 0);
  out.push({ id: "evidence.levels", description: "Evidence index: payments by bank evidence level add up to the payments listed", left: String(levels), right: String(m.evidence.length), agrees: levels === m.evidence.length });
  const settledOk = m.evidence.filter((e) => e.settled).every((e) => e.bankEvidence !== "none");
  out.push({ id: "evidence.settled", description: "Every payment shown as settled has bank evidence of at least an imported, two-person confirmed line", left: String(m.evidence.filter((e) => e.settled).length), right: settledOk ? "all evidenced" : "some without bank evidence", agrees: settledOk });
  if (m.fx.available) {
    const props = m.fx.items.filter((i) => i.status === "proposed").length;
    out.push({ id: "fx.proposals", description: "FX: one revaluation proposal per balance with a difference, none for a balance that needs a rate", left: String(props), right: String(m.fx.proposalIds.length), agrees: props === m.fx.proposalIds.length && m.fx.items.every((i) => i.status !== "needs_rate" || i.differenceMinor === null) });
  }
  return out;
}

export const sectionTotals = (m: MonthEndPackModel) => ({
  receivable: byCurrency(m.receivable).map((c) => ({ currency: c, minor: sumOf(m.receivable.filter((r) => r.currency === c), (r) => B(r.creditedMinor)) })),
  writeoffsApproved: sumOf(m.writeoffs.filter((w) => w.status === "approved"), (w) => B(w.amountMinor)),
  writeoffsOpen: sumOf(m.writeoffs.filter((w) => w.status !== "approved" && w.status !== "rejected"), (w) => B(w.amountMinor)),
});

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

/** Text cell: a leading formula character is neutralised; numbers are written as numbers only by `num`. */
const txt = (v: unknown) => { const s = (v === null || v === undefined ? "" : String(v)).replace(/[\r\n\u2028\u2029]+/g, " "); return /^[=+\-@\t]/.test(s) ? `'${s}` : s; };

export async function monthEndXlsx(m: MonthEndPackModel, checks: PackCheck[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const fixed = new Date(`${m.month}-01T00:00:00.000Z`);
  wb.creator = "Clearline"; wb.created = fixed; wb.modified = fixed; wb.title = `Month-end pack ${m.entity.id} ${m.month}`; wb.subject = m.label;
  const money = (minor: Minor, c: string) => Number(plainAmount(B(minor), c)); // display only: every total is computed in BigInt
  const sheet = (name: string, head: string[], rows: unknown[][], amountCols: number[] = []) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([txt(`${m.label} · ${m.marking}`)]);
    ws.addRow(head.map(txt)).font = { bold: true };
    for (const r of rows) ws.addRow(r.map((v, i) => (amountCols.includes(i) && typeof v === "number" ? v : txt(v))));
    for (const i of amountCols) ws.getColumn(i + 1).numFmt = "#,##0.00";
    ws.columns.forEach((c) => { c.width = 18; });
    return ws;
  };
  const cur = m.entity.currency;
  sheet("Summary", ["Item", "Value"], [
    ["Organisation", m.organisation], ["Entity", `${m.entity.name} (${m.entity.id})`], ["Currency", cur], ["Month", m.month], ["Generated", m.generatedAt], ["Exception ages as of", m.agesAsOf],
    ["Posting rules", m.postingRules.signed ? `Signed: ${m.postingRules.version} by ${m.postingRules.signedBy} at ${m.postingRules.signedAt}` : `Not signed (current version ${m.postingRules.version}): every journal is a draft`],
    ["Nothing posted", "Files only. Nothing was posted to any ledger, approved or paid."],
    ...EVIDENCE_LEVELS.map(([k, l]) => [`Payments with bank evidence: ${l}`, m.evidence.filter((e) => e.bankEvidence === k).length]),
    ...checks.map((c) => [`Check: ${c.description}`, `${c.agrees ? "AGREES" : "DIFFERS"}: ${c.left} | ${c.right}`]),
  ]);
  const bt = (k: "grossMinor" | "feesMinor" | "refundsMinor" | "netMinor", c: string) => money(sumOf(m.bridges.filter((b) => b.currency === c), (b) => B(b[k])).toString(), c);
  sheet("Bridges", ["Batch", "Provider day", "Currency", "Gross", "Fees", "Refunds", "Net", "Bank line", "Tied", "Settlement verified", "Bank evidence", "Settled", "Payments"], [
    ...m.bridges.map((b) => [b.batchId, b.providerDay, b.currency, money(b.grossMinor, b.currency), money(b.feesMinor, b.currency), money(b.refundsMinor, b.currency), money(b.netMinor, b.currency), `${b.bankLineId} ${b.bankLine}`.trim(), b.tied ? "yes" : "no", b.settlementVerified ? "yes" : "no", b.bankEvidenceLabel, b.settled ? "yes" : "no", b.payments]),
    ...byCurrency(m.bridges).map((c) => ["TOTAL", "", c, bt("grossMinor", c), bt("feesMinor", c), bt("refundsMinor", c), bt("netMinor", c)]),
  ], [3, 4, 5, 6]);
  sheet("Receivable from provider", ["Batch", "Currency", "Confirmed by the provider", "Payments", "Why it is open"], [
    ...m.receivable.map((r) => [r.batchId, r.currency, money(r.creditedMinor, r.currency), r.orderIds.join(" "), r.reason]),
    ...sectionTotals(m).receivable.map((t) => ["TOTAL", t.currency, money(t.minor.toString(), t.currency)]),
  ], [2]);
  sheet("Exceptions by age", ["Exception", "Order", "Owner role", "Owner", "Reason", "Next step", "Opened", "Age (days)", "Age bucket"], [
    ...m.exceptions.map((e) => [e.id, e.orderId, e.ownerRole, e.owner, e.reason, e.nextStep, e.openedAt, e.ageDays, e.bucket]),
    ...m.exceptionBuckets.map((b) => ["BUCKET", b.label, b.count]), ["TOTAL", "", m.exceptions.length],
  ]);
  const tot = sectionTotals(m);
  sheet("Write-offs", ["Write-off", "Order", "Amount", "Currency", "Status", "Prepared by", "Approved by", "Decided at"], [
    ...m.writeoffs.map((w) => [w.id, w.orderId, money(w.amountMinor, w.currency), w.currency, w.status, w.preparedBy, w.approvedBy, w.decidedAt]),
    ["TOTAL APPROVED", "", money(tot.writeoffsApproved.toString(), cur), cur], ["TOTAL NOT YET DECIDED", "", money(tot.writeoffsOpen.toString(), cur), cur],
  ], [2]);
  sheet("FX revaluation", ["Balance", "Currency", "Foreign amount", "Status", "Closing value", "Carrying value", "Difference", "Note"], m.fx.available ? [
    ...m.fx.items.map((i) => [i.ref, i.currency, money(i.foreignMinor, i.currency), i.status, i.closingMinor === null ? "needs a rate" : money(i.closingMinor, cur), i.carryingMinor === null ? "not known" : money(i.carryingMinor, cur), i.differenceMinor === null ? "" : money(i.differenceMinor, cur), i.note]),
    ...m.fx.rates.map((r) => ["RATE ON FILE", r.pair, r.rate, r.asOf, r.source]), ["NOTE", m.fx.note],
  ] : [["NOT AVAILABLE IN THIS BUILD", m.fx.reason]], [2, 4, 5, 6]);
  sheet("Journals", ["Journal", "Entry date", "Pattern", "Status", "Waits for", "Side", "Account", "Amount", "Currency"], [
    ...m.journals.flatMap((j) => j.lines.map((l) => [j.id, j.entryDate, j.pattern, j.label, l.onApproval ?? j.requiresApprovalOf, l.side, l.accountName, money(l.amountMinor, cur), cur])),
    ["TOTAL DEBITS", "", "", "", "", "debit", "", money(sumOf(m.journals.flatMap((j) => j.lines), (l) => (l.side === "debit" ? B(l.amountMinor) : 0n)).toString(), cur), cur],
    ["TOTAL CREDITS", "", "", "", "", "credit", "", money(sumOf(m.journals.flatMap((j) => j.lines), (l) => (l.side === "credit" ? B(l.amountMinor) : 0n)).toString(), cur), cur],
  ], [7]);
  sheet("Evidence index", ["Order", "Decision", "Bank evidence level", "Bank evidence", "Settled", "Chain transfers", "Provider records", "Evidence pack"],
    m.evidence.map((e) => [e.orderId, e.decision, e.bankEvidence, e.bankEvidenceLabel, e.settled ? "yes" : "no", e.chainTransfers, e.providerRecords, e.packPath]));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

const winAnsi = (s: string) => s.replace(/[→]/g, "->").replace(/[−–—]/g, "-").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[…]/g, "...").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function monthEndPdf(m: MonthEndPackModel, checks: PackCheck[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const fixed = new Date(`${m.month}-01T00:00:00.000Z`);
  doc.setTitle(`Month-end pack ${m.entity.id} ${m.month} - ${m.label}`); doc.setSubject(m.label); doc.setProducer("Clearline"); doc.setCreationDate(fixed); doc.setModificationDate(fixed);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 44;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const footer = () => page.drawText(winAnsi(`${m.label} · ${m.marking}`), { x: M, y: 22, size: 7, font, color: rgb(0.34, 0.32, 0.29) });
  footer();
  const line = (text: string, o: { size?: number; b?: boolean; gap?: number } = {}) => {
    const size = o.size ?? 8.5, f = o.b ? bold : font;
    let cur = "";
    const flush = () => { if (y < M + 16) { page = doc.addPage([W, H]); y = H - M; footer(); } page.drawText(cur, { x: M, y, size, font: f, color: rgb(0.08, 0.08, 0.08) }); y -= size + 3.5; cur = ""; };
    for (const w of winAnsi(text).split(" ")) { const next = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(next, size) > W - 2 * M && cur) { flush(); cur = w; } else cur = next; }
    if (cur) flush();
    y -= o.gap ?? 0;
  };
  const head = (s: string) => { y -= 5; line(s, { b: true, size: 11, gap: 2 }); };
  const a = (minor: Minor | bigint, c: string) => `${c} ${plainAmount(typeof minor === "bigint" ? minor : B(minor), c)}`;
  const cur = m.entity.currency;
  line(m.label.toUpperCase(), { b: true, size: 9, gap: 3 });
  line(`Month-end pack - ${m.entity.name} (${m.entity.id}), ${m.month}`, { b: true, size: 15, gap: 3 });
  line(`${m.organisation} · ${cur} · ${m.entity.timezone} · generated ${m.generatedAt} · exception ages as of ${m.agesAsOf}`);
  line(m.postingRules.signed ? `Posting rules ${m.postingRules.version} signed by ${m.postingRules.signedBy} at ${m.postingRules.signedAt}. Journals still need their own approval; nothing is posted.` : `Posting rules NOT SIGNED (current version ${m.postingRules.version}): every journal below is a DRAFT and cannot be sent to a ledger.`, { b: true, gap: 4 });
  head("Totals reconcile across sections");
  for (const c of checks) line(`${c.agrees ? "AGREES" : "DIFFERS"} - ${c.description}: ${c.left} | ${c.right}`);
  head(`Bridges (${m.bridges.length})`);
  for (const b of m.bridges) line(`${b.batchId} (${b.providerDay}): gross ${a(b.grossMinor, b.currency)} - fees ${a(b.feesMinor, b.currency)} - refunds ${a(b.refundsMinor, b.currency)} = net ${a(b.netMinor, b.currency)}; bank line ${b.bankLineId || "none"}${b.bankLine ? ` (${b.bankLine})` : ""}; ${b.tied ? "tied" : "not tied"}; ${b.bankEvidenceLabel}; ${b.settled ? "settled" : "not settled"}`);
  head("Receivable from the provider, by batch");
  if (!m.receivable.length) line("None: every payment the provider confirmed this month is in a batch verified against a bank line.");
  for (const r of m.receivable) line(`${r.batchId}: ${a(r.creditedMinor, r.currency)} (${r.orderIds.join(", ")}). ${r.reason}`);
  for (const t of sectionTotals(m).receivable) line(`Total ${a(t.minor, t.currency)}`, { b: true });
  head(`Exceptions by age (${m.exceptions.length})`);
  line(m.exceptionBuckets.map((b) => `${b.label}: ${b.count}`).join(" · "), { b: true });
  for (const e of m.exceptions) line(`${e.id} (${e.orderId}, ${e.bucket}, owner ${e.ownerRole}${e.owner ? ` ${e.owner}` : ""}): ${e.reason} Next: ${e.nextStep}`);
  head(`Write-offs (${m.writeoffs.length})`);
  for (const w of m.writeoffs) line(`${w.id} (${w.orderId}): ${a(w.amountMinor, w.currency)}, ${w.status}; prepared by ${w.preparedBy || "-"}; approved by ${w.approvedBy || "-"}${w.decidedAt ? ` at ${w.decidedAt}` : ""}`);
  const tot = sectionTotals(m);
  line(`Approved ${a(tot.writeoffsApproved, cur)} · not yet decided ${a(tot.writeoffsOpen, cur)}`, { b: true });
  head("FX revaluation");
  if (!m.fx.available) line(`Not available in this build: ${m.fx.reason}`);
  else {
    line(m.fx.note);
    if (!m.fx.items.length) line(`No balance in another currency than ${m.fx.functionalCurrency} is open at the period end (${m.fx.closingAt}).`);
    for (const i of m.fx.items) line(`${i.ref}: ${a(i.foreignMinor, i.currency)}; ${i.status === "needs_rate" ? `needs a rate (${i.note})` : `closing ${i.closingMinor === null ? "-" : a(i.closingMinor, cur)}, carrying ${i.carryingMinor === null ? "not known" : a(i.carryingMinor, cur)}, difference ${i.differenceMinor === null ? "-" : a(i.differenceMinor, cur)}`}`);
    for (const r of m.fx.rates) line(`Rate on file: ${r.pair} ${r.rate} (${r.source}, ${r.asOf})`);
  }
  head(`Journals (${m.journals.length})`);
  for (const j of m.journals) line(`${j.id} ${j.entryDate} [${j.label}${j.requiresApprovalOf ? `; waits for ${j.requiresApprovalOf}` : ""}]: ${j.lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.accountName} ${a(l.amountMinor, cur)}`).join("; ")}`);
  head(`Evidence index (${m.evidence.length})`);
  line(EVIDENCE_LEVELS.map(([k, l]) => `${l}: ${m.evidence.filter((e) => e.bankEvidence === k).length}`).join(" · "), { b: true });
  for (const e of m.evidence) line(`${e.orderId}: ${e.decision}; ${e.bankEvidenceLabel}; ${e.settled ? "settled" : "not settled"}; ${e.chainTransfers} chain transfer(s), ${e.providerRecords} provider record(s); pack ${e.packPath}`);
  return doc.save({ useObjectStreams: false });
}
