/**
 * rc4 Accounting Bridge — accounting-ready reconciliation export and journal export (CHANGE 15).
 * Invariant: idempotent exports (same inputs → byte-identical JSON and CSV, same id and hash).
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_EXPORT_MARKING, JOURNAL_EXPORT_CSV_COLUMNS, RECONCILIATION_EXPORT_CSV_COLUMNS, accountingExportToJson, buildJournalExport, buildReconciliationExport,
  journalExportToCsv, loadWorkspace, reconciliationExportToCsv, sampleWorkspace, serializeWorkspace, type ReconciliationExport,
} from "@/lib/clearline";
import { sha256Hex } from "@/lib/clearline/sha256";
import { stableStringify } from "@/lib/clearline/tx";
import { debitLine, errorCode, run, submitted } from "./helpers";
import { active, period, propose, s4Final, tryAct } from "./rc4-helpers";

const NOV = { from: "2026-11-01", to: "2026-12-01" };
const ws0 = sampleWorkspace();
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("reconciliation export: rows per money movement, evidenced / provider-reported only / unresolved kept apart", () => {
  const doc = ok(buildReconciliationExport(ws0, NOV));
  const row = (lineId: string) => doc.rows.find((r) => r.source.bankLineId === lineId)!;

  it("is marked FICTIONAL / sandbox and covers [from, to)", () => {
    expect(doc).toMatchObject({ marking: ACCOUNTING_EXPORT_MARKING, fictional: true, sandbox: true, period: NOV, kind: "reconciliation" });
    expect(doc.marking).toMatch(/^FICTIONAL · SANDBOX/);
    expect(doc.marking).toMatch(/Clearline has posted nothing/);
  });
  it("every sample movement has one row with source evidence ids, exact decimal amounts, value date, status, rule and open exceptions", () => {
    expect(doc.rows.map((r) => r.rowId).sort()).toEqual([...new Set(doc.rows.map((r) => r.rowId))].sort());
    expect(row("SIMBANK-0001")).toMatchObject({ evidenceClass: "evidenced", movement: "supplier_payout_debit", amount: { value: "24651.37", currency: "SGD" }, valueDate: "2026-11-12", ruleCode: "XR_BANK_DEBIT_BY_REFERENCE", paymentId: "pi_00001", reconciliationStatus: "allocated" });
    expect(row("SIMBANK-0001").source.evidenceRecordIds.length).toBe(1);
    expect(row("SIMBANK-0001").allocationIds.length).toBe(1);
    expect(row("SIMBANK-0001").journal[0]).toMatchObject({ status: "proposed", ruleCode: "JR_SUPPLIER_PAYOUT_DEBIT" });
    expect(row("SIMBANK-0003")).toMatchObject({ evidenceClass: "evidenced", movement: "advance_disbursement", amount: { value: "50000.00", currency: "SGD" }, advanceId: "adv_00121" });
    expect(row("SIMBANK-0004")).toMatchObject({ evidenceClass: "evidenced", movement: "repayment_credit", amount: { value: "30000.00" }, ruleCode: "XR_REPAYMENT_BY_REFERENCE" });
    expect(row("SIMBANK-0005")).toMatchObject({ evidenceClass: "unresolved", movement: "unallocated_credit", amount: { value: "20000.00" }, ruleCode: "XR_LINE_NOT_ALLOCATED", journal: [] });
    expect(row("SIMBANK-0005").openExceptions.map((e) => e.code)).toEqual(["RC_AMOUNT_ONLY_CANDIDATES"]);
    expect(row("SIMBANK-0002")).toMatchObject({ evidenceClass: "evidenced", movement: "payout_debit_not_delivered", amount: { value: "12784.90", currency: "USD" } });
    expect(row("SIMBANK-0002").source.providerEventIds.length).toBe(1);
    expect(row("SIMBANK-0006")).toMatchObject({ evidenceClass: "evidenced", movement: "payout_return_credit", ruleCode: "XR_RETURN_CREDIT_BY_REFERENCE" });
    expect(row("SIMBANK-0002").openExceptions.map((e) => e.category)).toContain("returned_payout");
  });
  it("s4: the not-final chain transfer is unresolved, and the provider's completion claim is provider-reported only (USDC 6 dp)", () => {
    const chain = doc.rows.find((r) => r.movement === "stablecoin_transfer")!;
    expect(chain).toMatchObject({ evidenceClass: "unresolved", ruleCode: "XR_CHAIN_NOT_FINAL", amount: { currency: "USDC" } });
    expect(chain.amount.value).toMatch(/^\d+\.\d{6}$/);
    expect(chain.source.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const claim = doc.rows.find((r) => r.movement === "provider_reported_completion")!;
    expect(claim).toMatchObject({ evidenceClass: "provider_reported_only", amount: { value: "6427.830000", currency: "USDC" }, ruleCode: "XR_PROVIDER_COMPLETION_NO_EVIDENCE" });
    expect(claim.source.providerEventIds.length).toBe(1);
  });
  it("summary totals per class and currency, never across currencies", () => {
    expect(doc.summary.evidenced).toEqual({ rows: 5, byCurrency: { SGD: "104651.37", USD: "25569.80" } });
    expect(doc.summary.provider_reported_only.rows).toBe(1);
    expect(doc.summary.unresolved.rows).toBe(2);
  });
  it("after finality the chain row is evidenced and the provider-only completion row disappears", () => {
    const d = ok(buildReconciliationExport(s4Final(), NOV));
    expect(d.rows.find((r) => r.movement === "stablecoin_transfer")!).toMatchObject({ evidenceClass: "evidenced", ruleCode: "XR_CHAIN_FINAL_BY_TX_HASH" });
    expect(d.rows.some((r) => r.movement === "provider_reported_completion")).toBe(false);
  });
  it("a provider settlement report row is provider-reported only; a returned payout without its return credit has a provider-reported return row", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace; // returned
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: `PAYOUT ${ppid}` }) }).workspace;
    const d = ok(buildReconciliationExport(ws, NOV));
    expect(d.rows.find((r) => r.movement === "provider_settlement_report")!.evidenceClass).toBe("provider_reported_only");
    expect(d.rows.find((r) => r.movement === "provider_reported_return" && r.paymentId === id)!).toMatchObject({ evidenceClass: "provider_reported_only", ruleCode: "XR_PROVIDER_RETURN_NOT_ON_STATEMENT" });
  });
  it("only rows dated in [from, to): an empty period has no rows; a bad range is refused", () => {
    expect(ok(buildReconciliationExport(ws0, { from: "2026-10-01", to: "2026-11-01" })).rows).toEqual([]);
    expect(ok(buildReconciliationExport(ws0, { from: "2026-11-12", to: "2026-11-13" })).rows.length).toBe(doc.rows.length);
    expect(ok(buildReconciliationExport(ws0, { from: "2026-11-13", to: "2026-11-14" })).rows.length).toBe(0);
    expect(buildReconciliationExport(ws0, { from: "2026-11-13", to: "2026-11-13" }).ok).toBe(false);
    expect(buildReconciliationExport(ws0, { from: "13/11/2026", to: "2026-11-14" }).ok).toBe(false);
  });
});

describe("invariant: idempotent exports — the same inputs give byte-identical output and the same id", () => {
  const strip = (d: ReconciliationExport) => { const { documentId: _i, sha256: _h, generatedAt: _g, ...rest } = d; void _i; void _h; void _g; return rest; };
  it("two builds, and a build after a serialise/load round trip, are byte-identical (JSON and CSV)", () => {
    const a = ok(buildReconciliationExport(ws0, NOV));
    const b = ok(buildReconciliationExport(sampleWorkspace(), NOV));
    const loaded = loadWorkspace(serializeWorkspace(ws0));
    if (!loaded.ok) throw new Error(loaded.error.message);
    const c = ok(buildReconciliationExport(loaded.value.workspace, NOV));
    expect(accountingExportToJson(b)).toBe(accountingExportToJson(a));
    expect(accountingExportToJson(c)).toBe(accountingExportToJson(a));
    expect(reconciliationExportToCsv(b)).toBe(reconciliationExportToCsv(a));
    expect(a.documentId).toBe(`rx_${a.sha256.slice(0, 16)}`);
    expect(a.sha256).toBe(sha256Hex(stableStringify(strip(a))));
  });
  it("the id names the content, not the clock: advancing the clock keeps the id; changing the evidence changes it", () => {
    const a = ok(buildReconciliationExport(ws0, NOV));
    const later = run(ws0, "usr_maya", { type: "advance_clock", to: "2026-11-13T05:00:00.000Z" }).workspace;
    const b = ok(buildReconciliationExport(later, NOV));
    expect(b.generatedAt).not.toBe(a.generatedAt);
    expect(b.documentId).toBe(a.documentId);
    const more = run(ws0, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: "", amountMinor: 1, valueDate: "2026-11-20" }) }).workspace;
    expect(ok(buildReconciliationExport(more, NOV)).documentId).not.toBe(a.documentId);
  });
  it("building an export never changes the workspace", () => {
    const before = serializeWorkspace(ws0);
    buildReconciliationExport(ws0, NOV);
    buildJournalExport(ws0, { periodId: period(ws0).id });
    expect(serializeWorkspace(ws0)).toBe(before);
  });
  it("record_reconciliation_export stores the id and hash and audits it; building again afterwards gives the same id", () => {
    const r = run(ws0, "usr_daniel", { type: "record_reconciliation_export", ...NOV });
    const rec = r.workspace.accounting!.exports.at(-1)!;
    const doc = ok(buildReconciliationExport(ws0, NOV));
    expect(rec).toMatchObject({ kind: "reconciliation", documentId: doc.documentId, sha256: doc.sha256, rowCount: doc.rows.length, by: "usr_daniel", from: NOV.from, to: NOV.to });
    expect(r.audit.at(-1)!.summary).toContain(doc.documentId);
    expect(ok(buildReconciliationExport(r.workspace, NOV)).documentId).toBe(doc.documentId);
    expect(errorCode(tryAct(ws0, "usr_alex", { type: "record_reconciliation_export", ...NOV }))).toBe("unauthorized_actor");
  });
});

describe("CSV: RFC 4180, formula-injection guarded, marked FICTIONAL", () => {
  it("header, then the FICTIONAL marking row; every row has the column count", () => {
    const csv = reconciliationExportToCsv(ok(buildReconciliationExport(ws0, NOV)));
    const lines = csv.split("\r\n");
    for (const r of parseCsv(csv)) expect(r).toHaveLength(RECONCILIATION_EXPORT_CSV_COLUMNS.length);
    expect(lines[0]).toBe(RECONCILIATION_EXPORT_CSV_COLUMNS.join(","));
    expect(lines[1]).toMatch(/^meta,XR_FICTIONAL_SANDBOX,.*FICTIONAL · SANDBOX/);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("a spreadsheet formula in a line id, account, reference or counterparty is neutralised (every text cell)", () => {
    const evil = run(ws0, "usr_maya", { type: "ingest_statement_line", line: debitLine({ lineId: "-1-1", accountRef: "+SUM(1)", reference: "=HYPERLINK(\"http://x\")", counterparty: "@SUM(1)", amountMinor: 1, valueDate: "2026-11-20" }) }).workspace;
    const csv = reconciliationExportToCsv(ok(buildReconciliationExport(evil, NOV)));
    const cells = parseCsv(csv).flat();
    expect(cells).toContain("'=HYPERLINK(\"http://x\")");
    expect(cells).toContain("'@SUM(1)");
    expect(cells).toContain("'+SUM(1)");
    expect(cells).toContain("'-1-1");
    expect(cells.filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]);
  });
});

/** Minimal RFC 4180 parser (quoted cells, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  return rows;
}

describe("journal export (generic CSV journal import)", () => {
  const approveAll = () => {
    let ws = ws0;
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    return ws;
  };
  it("only approved proposals; nothing approved → NOTHING_TO_EXPORT", () => {
    const r = buildJournalExport(ws0, { periodId: period(ws0).id });
    expect(!r.ok && r.error.message).toMatch(/^NOTHING_TO_EXPORT/);
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "export_journal", periodId: period(ws0).id }))).toBe("precondition_failed");
  });
  it("uses the customer's account codes, balances every entry, carries evidence ids and says nothing was posted", () => {
    const doc = ok(buildJournalExport(approveAll(), { periodId: period(ws0).id }));
    expect(doc).toMatchObject({ notPostedByClearline: true, fictional: true, sandbox: true, mappingRevision: 1 });
    expect(doc.entries).toHaveLength(5);
    for (const e of doc.entries) {
      expect(e.totals.debit).toBe(e.totals.credit);
      expect(e.approvedBy).toBe("usr_daniel");
      expect(e.preparedBy).toBe("usr_maya");
      for (const l of e.lines) {
        expect(l.accountCode).toMatch(/^\d{4}$/);
        expect(l.evidenceIds.length).toBeGreaterThan(0);
        expect(l.debit === "" ? l.credit : l.debit).toMatch(/^\d+\.\d{2}$/);
      }
    }
    const s1 = doc.entries.find((e) => e.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
    expect(s1.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([["2100", "24651.37", ""], ["1010", "", "24651.37"]]);
  });
  it("the recorded export re-renders byte for byte from its record, even after the mapping changes", () => {
    let ws = approveAll();
    const preview = ok(buildJournalExport(ws, { periodId: period(ws).id }));
    const r = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id });
    ws = r.workspace;
    const rec = ws.accounting!.exports.at(-1)!;
    expect(rec).toMatchObject({ kind: "journal", documentId: preview.documentId, sha256: preview.sha256, rowCount: 10, mappingRevision: 1 });
    ws = run(ws, "usr_daniel", { type: "set_account_mapping", entries: ws.accounting!.mapping!.entries.map((e) => ({ ...e, accountCode: e.accountCode + "0" })) }).workspace;
    const again = ok(buildJournalExport(ws, { exportId: rec.id }));
    expect(accountingExportToJson(again)).toBe(accountingExportToJson(preview));
    expect(journalExportToCsv(again)).toBe(journalExportToCsv(preview));
    expect(ws.accounting!.proposals.filter((p) => p.status === "exported").map((p) => p.export!.exportId)).toEqual(Array(5).fill(rec.id));
    expect(buildJournalExport(ws, { periodId: period(ws).id }).ok).toBe(false); // nothing approved left
  });
  it("CSV: header then only journal lines, each marked FICTIONAL SANDBOX, with debit/credit decimals", () => {
    const csv = journalExportToCsv(ok(buildJournalExport(approveAll(), { periodId: period(ws0).id })));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(JOURNAL_EXPORT_CSV_COLUMNS.join(","));
    for (const r of parseCsv(csv)) expect(r).toHaveLength(JOURNAL_EXPORT_CSV_COLUMNS.length);
    expect(lines).toHaveLength(11);
    for (const l of lines.slice(1)) expect(l.endsWith(",FICTIONAL SANDBOX")).toBe(true);
  });
  it("a prior-period item is flagged in the export", () => {
    let ws = approveAll();
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    ws = run(ws, "usr_daniel", { type: "close_accounting_period", periodId: period(ws).id }).workspace;
    ws = run(ws, "usr_maya", { type: "open_accounting_period", name: "2026-12", from: "2026-12-01", to: "2027-01-01" }).workspace;
    ws = propose(s4Final(ws)).workspace;
    const late = ws.accounting!.proposals.at(-1)!;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: late.id }).workspace;
    const doc = ok(buildJournalExport(ws, { periodId: late.periodId }));
    expect(doc.entries[0]).toMatchObject({ priorPeriodItem: true, journalDate: "2026-12-01" });
    expect(journalExportToCsv(doc).split("\r\n")[1]).toMatch(/,true,/);
  });
});
