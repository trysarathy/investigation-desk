/**
 * rc7 end to end, through the services (no UI), against PostgreSQL 16 and a temporary upload folder: three
 * differently shaped provider exports (CSV with BOM, DD/MM, thousand separators and a TOTAL row; XLSX with MM/DD and
 * mixed offsets; nested JSON) with their settlement reports (per payment line, and totals only), three bank formats
 * (CSV with a decimal comma and bracket negatives; MT940; camt.053) → upload → map → validate → confirm (a second
 * person for bank statements) → normalise → reconcile. Every value is fictional and built in the test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, purgeExpiredUploads, setRetentionDays, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { ingestAdapterOutput, runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { accountBalance, proposeJournals, reconcile, type ReconcileResult } from "../../src/lib/clearline/merchant";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let dir: string;
let n = 0;
const key = () => `e2e-key-${++n}-${Date.now()}`;
const MARKER = "ZQX-E2E-MARKER-9137";
const captured: string[] = [];
const uploadIds: Record<string, string> = {};
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

/** upload → map (tables) → validate → confirm (by `confirmer`) → normalise; returns the validated summary. */
async function pipeline(name: string, uploader: TenantContext, confirmer: TenantContext, entityId: string, fileType: FileType, fileName: string, bytes: Uint8Array, mapping?: Mapping) {
  const up = await createUpload(uploader, { entityId, fileType, fileName, bytes }, key());
  uploadIds[name] = up.upload.id;
  if (mapping) await setUploadMapping(uploader, up.upload.id, { mapping }, key());
  const v = (await validateUpload(uploader, up.upload.id, key())).body;
  await decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  const norm = (await normaliseUpload(confirmer, up.upload.id, key())).body;
  return { up, v, norm };
}
const reconcileFromDb = (c: TenantContext, entityId: string) => withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => loadReconcileInput(tx, c.orgId, entityId), { read: true });
const decisions = (r: ReconcileResult) => Object.fromEntries(r.records.map((x) => [x.orderId, `${x.explanation.decision} ${x.explanation.ruleId}`]));
const diffs = (r: ReconcileResult) => Object.fromEntries(r.records.filter((x) => x.explanation.differences.length).map((x) => [x.orderId, x.explanation.differences.map((d) => `${d.type} ${d.amountMinor}`)]));
const shape = (r: ReconcileResult) => r.records.map((x) => ({ o: x.orderId, d: x.explanation.decision, r: x.explanation.ruleId, s: x.explanation.decidingStep, diffs: x.explanation.differences.map((d) => [d.type, d.amountMinor]), tied: x.bank.batchTied, v: x.bank.settlementVerified }));

beforeAll(async () => {
  dir = useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map(String).join(" ")); });
});
afterAll(async () => { vi.restoreAllMocks(); await closeDatabase(); await closeOwner(); });

describe("three provider exports and three bank formats, end to end", () => {
  let fin: TenantContext, ops: TenantContext, approver: TenantContext, finB: TenantContext, approverB: TenantContext;
  beforeAll(async () => {
    [fin, ops, approver, finB, approverB] = await Promise.all([liveCtx(s, "finance@live-a.example", "a"), liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "approver@live-a.example", "a"),
      liveCtx(s, "finance@live-b.example", "b"), liveCtx(s, "approver@live-b.example", "b")]);
    // Chain data a chain reader observed (Phase 2 readers; recorded here). A provider file never makes a transfer final.
    await ingestAdapterOutput(ops, sc.SG.entityId, { transfers: sc.observedTransfers(sc.SG) }, key(), { finalised: () => true });
    await ingestAdapterOutput(ops, sc.US.entityId, { transfers: sc.observedTransfers(sc.US) }, key(), { finalised: () => true });
    await ingestAdapterOutput(finB, sc.AE.entityId, { transfers: sc.observedTransfers(sc.AE) }, key(), { finalised: () => true });
  });

  it("Singapore: an orders file kept 1 day, a CSV export (BOM, DD/MM, thousands, TOTAL row), per-payment settlement, CSV statement", async () => {
    await setRetentionDays(await liveCtx(s, "admin@live-a.example", "a"), 1, key());
    const orders = await pipeline("sgOrders", fin, fin, sc.SG.entityId, "orders_invoices", "orders.csv", sc.sgOrdersCsv(["SG-1999,99.00,SGD,2026-11-01T00:00:00Z"]), sc.SG_ORDERS_MAPPING);
    expect(orders.norm).toMatchObject({ changed: true, counts: { created: 5 } });
    await setRetentionDays(await liveCtx(s, "admin@live-a.example", "a"), 90, key());
    const exp = await pipeline("sgExport", ops, ops, sc.SG.entityId, "provider_export", "Export Nov (fictional).csv", sc.sgExportCsv(MARKER), sc.SG_EXPORT_MAPPING);
    expect(exp.v.counts).toEqual({ rows: 4, accepted: 0, rejected: 0, warning: 4, duplicate: 0 }); // log index absent → assumed 0, warned
    expect(exp.v.notes).toContain("total_rows_excluded");
    expect(exp.norm.counts).toEqual({ created: 4, existing: 0, conflict: 0, skipped: 0 });
    const set = await pipeline("sgSettlement", fin, fin, sc.SG.entityId, "settlement_report", "payouts.csv", sc.sgSettlementCsv(), sc.SG_SETTLEMENT_MAPPING);
    expect(set.norm.counts.created).toBe(2);
    // a bank statement needs a second person: Finance uploads, an Approver confirms
    const bank = await pipeline("sgBank", fin, approver, sc.SG.entityId, "bank_statement", "kontoauszug.csv", sc.sgBankCsv(MARKER), sc.SG_BANK_MAPPING);
    expect(bank.norm.counts).toEqual({ created: 2, existing: 0, conflict: 0, skipped: 1 }); // the debit (bank fee) is not a settlement credit
    // normalising again changes nothing
    expect((await normaliseUpload(approver, uploadIds.sgBank, key())).body).toMatchObject({ changed: false });
    const counted = await ownerDb().execute(sql`select count(*)::int as n from bank_lines where org_id = ${s.orgs.a}`);
    expect(counted.rows[0].n).toBe(2);

    const r = reconcile(await reconcileFromDb(ops, sc.SG.entityId));
    expect(decisions(r)).toEqual({
      "SG-1001": "suggested_for_review M5.bank.imported_not_verified", // ties, but the bank line is imported: never verified with the flag off
      "SG-1002": "suggested_for_review M5.bank.imported_not_verified",
      "SG-1003": "exception M4.tolerance.underpayment_beyond_band",
      "SG-1004": "suggested_for_review M1.finality.pending", // the provider says Completed; the claimed transfer is not chain-verified
    });
    expect(diffs(r)).toEqual({ "SG-1002": ["sender_side_fee -135"], "SG-1003": ["underpayment -27000"] });
    const b = r.bridges.find((x) => x.batchId === sc.SG.batch.id)!;
    expect(b).toMatchObject({ tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated", bankLineSource: "csv_import" });
    expect(r.exceptions.every((e) => e.owner && e.reason.length > 3 && e.nextStep.length > 3)).toBe(true);
    expect(proposeJournals(await reconcileFromDb(ops, sc.SG.entityId), r).some((j) => j.kind === "settlement")).toBe(false);
    // the uploads reconcile exactly as the same values handed to the engine directly
    expect(shape(r)).toEqual(shape(reconcile(sc.engineInput(sc.SG))));

    // Only with the merchant's policy flag on (an Admin's decision; it stays off by default) does the same imported line verify.
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    await updateMerchantPolicy(admin, sc.SG.entityId, { allowImportedBankLinesAsVerified: true }, 1, key());
    try {
      const input = await reconcileFromDb(ops, sc.SG.entityId);
      const on = reconcile(input);
      expect(decisions(on)).toMatchObject({ "SG-1001": "matched M5.batch.tied_verified", "SG-1002": "matched_with_difference M4.tolerance.within_band" });
      expect(on.writeOffs.map((w) => [w.orderId, w.amountMinor, w.direction])).toEqual([["SG-1002", 135n, "shortfall"]]);
      expect(accountBalance(proposeJournals(input, on), "provider_clearing", { batchId: sc.SG.batch.id })).toBe(0n);
    } finally {
      await updateMerchantPolicy(admin, sc.SG.entityId, { allowImportedBankLinesAsVerified: false }, 2, key());
    }
    // the persisted run: every exception has an owner, a reason and a next step
    expect((await runReconciliation(ops, sc.SG.entityId, key())).body).toMatchObject({ changed: true, records: 4 });
    const ex = await ownerDb().select().from(t.reconExceptions).where(eq(t.reconExceptions.orgId, s.orgs.a));
    expect(ex.length).toBeGreaterThan(0);
    for (const e of ex) expect([e.ownerRole.length > 2, e.reason.length > 2, e.nextStep.length > 2]).toEqual([true, true, true]);
  });

  it("United States: an XLSX export (MM/DD, mixed offsets), a tab-separated settlement, an MT940 statement", async () => {
    const exp = await pipeline("usExport", ops, ops, sc.US.entityId, "provider_export", "payments.xlsx", await sc.usExportXlsx(), sc.US_EXPORT_MAPPING);
    expect(exp.v.counts).toMatchObject({ rows: 3, rejected: 0 });
    expect(exp.up.preview.headers[0]).toBe("Order"); // the title rows above the header were skipped
    await pipeline("usSettlement", ops, ops, sc.US.entityId, "settlement_report", "settlement.tsv", sc.usSettlementCsv(), sc.US_SETTLEMENT_MAPPING);
    const bank = await pipeline("usBank", fin, approver, sc.US.entityId, "bank_statement", "statement.sta", sc.usMt940());
    expect(bank.v.fileFormat).toBe("mt940");
    expect(bank.norm.counts).toEqual({ created: 1, existing: 0, conflict: 0, skipped: 1 });
    const r = reconcile(await reconcileFromDb(ops, sc.US.entityId));
    expect(decisions(r)).toEqual({
      "US-2001": "suggested_for_review M5.bank.imported_not_verified",
      "US-2002": "exception M4.tolerance.overpayment_beyond_band",
      "US-2003": "suggested_for_review M4.tolerance.explained_outside_band",
    });
    expect(diffs(r)).toEqual({ "US-2002": ["overpayment 9000"], "US-2003": ["requote_after_expiry -750"] });
    expect(r.bridges[0]).toMatchObject({ batchId: sc.US.batch.id, tied: true, settlementVerified: false });
    expect(shape(r)).toEqual(shape(reconcile(sc.engineInput(sc.US))));
  });

  it("UAE (merchant B): a nested JSON export, a totals-only settlement (grouping only proposed), a camt.053 statement", async () => {
    await pipeline("aeExport", finB, finB, sc.AE.entityId, "provider_export", "export.json", sc.aeExportJson(), sc.AE_EXPORT_MAPPING);
    const set = await pipeline("aeSettlement", finB, finB, sc.AE.entityId, "settlement_report", "settlement.json", sc.aeSettlementJson(), sc.AE_SETTLEMENT_MAPPING);
    expect(set.norm.counts.created).toBe(1);
    await pipeline("aeBank", finB, approverB, sc.AE.entityId, "bank_statement", "camt053.xml", sc.aeCamt053());
    const r = reconcile(await reconcileFromDb(finB, sc.AE.entityId));
    expect(decisions(r)).toEqual({
      "AE-3001": "suggested_for_review M5.grouping.proposed_needs_confirmation",
      "AE-3002": "suggested_for_review M5.grouping.proposed_needs_confirmation",
    });
    expect(r.proposedGroupings.map((g) => [g.id, g.paymentIds, g.totalMinor])).toEqual([["PG-AED-2026-11-20", ["P-AE-1", "P-AE-2"], 550875n]]);
    expect(r.bridges[0]).toMatchObject({ batchId: sc.AE.batch.id, tied: false, settlementVerified: false });
    expect(shape(r)).toEqual(shape(reconcile(sc.engineInput(sc.AE))));
  });

  it("rows carry provenance; a duplicate row in a later upload is not imported twice; conflicts write nothing", async () => {
    const [inv] = await ownerDb().select().from(t.invoices).where(and(eq(t.invoices.orgId, s.orgs.a), eq(t.invoices.orderId, "SG-1001")));
    expect(inv).toMatchObject({ uploadId: uploadIds.sgOrders, sourceRow: 2, uploadedBy: fin.userId });
    const [claim] = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "provider_export")));
    expect(claim).toMatchObject({ finalised: false, confirmations: 0, uploadId: uploadIds.sgExport });
    const [line] = await ownerDb().select().from(t.bankLines).where(and(eq(t.bankLines.orgId, s.orgs.a), eq(t.bankLines.amountMinor, 400816n)));
    expect(line).toMatchObject({ source: "file_import", uploadId: uploadIds.sgBank });
    expect(line.provenance).toMatch(/^imported, not bank-authenticated: upload /);
    // an overlapping statement: the known line is a duplicate, the changed order conflicts
    const again = await pipeline("sgOrders2", fin, fin, sc.SG.entityId, "orders_invoices", "orders-2.csv", new TextEncoder().encode("Invoice,Total,Currency,Issued\nSG-1001,1350.00,SGD,2026-11-01T00:00:00Z\nSG-1002,2799.00,SGD,2026-11-01T00:00:00Z\nSG-1005,10.00,SGD,2026-11-01T00:00:00Z\n"), sc.SG_ORDERS_MAPPING);
    expect(again.v.counts).toMatchObject({ duplicate: 1, accepted: 2 });
    expect(again.norm.counts).toEqual({ created: 1, existing: 1, conflict: 1, skipped: 0 });
    const [still] = await ownerDb().select().from(t.invoices).where(and(eq(t.invoices.orgId, s.orgs.a), eq(t.invoices.orderId, "SG-1002")));
    expect(still.amountMinor).toBe(270000n);
  });

  it("SECURITY: merchant B cannot see or normalise merchant A's uploads or rows, nor use A's template", async () => {
    await refused(normaliseUpload(finB, uploadIds.sgExport, key()), "ACCESS_404");
    for (const table of ["invoices", "bank_lines", "upload_row_targets", "uploads"]) {
      expect((await withTenant({ userId: finB.userId, orgId: s.orgs.a }, (tx) => tx.execute(sql.raw(`select count(*)::int as n from ${table}`)))).rows[0].n, table).toBe(0);
    }
    expect((await reconcileFromDb(finB, sc.AE.entityId)).invoices.every((i) => i.orderId.startsWith("AE-"))).toBe(true);
    await expect(reconcileFromDb(finB, sc.SG.entityId)).rejects.toThrow(); // A's entity does not exist for B
  });

  it("SECURITY: the database refuses a statement line without a second person's confirmation, and a finalised provider claim", async () => {
    const up = await createUpload(fin, { entityId: sc.SG.entityId, fileType: "bank_statement", fileName: "late.csv", bytes: new TextEncoder().encode("Valuta;Betrag;Buchungstag;Verwendungszweck;Auftraggeber\n06.11.2026;5,00;06.11.2026;X;\n") }, key());
    await setUploadMapping(fin, up.upload.id, { mapping: sc.SG_BANK_MAPPING }, key());
    await validateUpload(fin, up.upload.id, key());
    await refused(normaliseUpload(fin, up.upload.id, key()), "UPLOAD_NOT_CONFIRMED");
    const as = (q: ReturnType<typeof sql>) => withTenant({ userId: fin.userId, orgId: s.orgs.a }, (tx) => tx.execute(q));
    await dbRefuses(as(sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source, entity_id, upload_id, uploaded_by)
      values (${s.orgs.a}, 'FORGED-1', 'X', 'SGD', '2026-11-06', 500, 'x', 'file_import', ${sc.SG.entityId}, ${up.upload.id}, ${fin.userId})`), /confirmed upload/);
    await dbRefuses(as(sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source, entity_id)
      values (${s.orgs.a}, 'FORGED-2', 'X', 'SGD', '2026-11-06', 500, 'x', 'file_import', ${sc.SG.entityId})`), /names its upload|bank_lines_upload_chk/);
    await dbRefuses(as(sql`update chain_transfers set finalised = true, confirmations = 50 where org_id = ${s.orgs.a} and source = 'provider_export'`), /never confirmed or finalised/);
    await dbRefuses(as(sql`update invoices set upload_id = null where org_id = ${s.orgs.a} and order_id = 'SG-1001'`), /provenance is immutable/);
  });
});

describe("SECURITY: retention", () => {
  it("purging the 1-day orders upload removes what only it produced; rows another upload confirms stay", async () => {
    const sgInvoices = () => ownerDb().select({ id: t.invoices.orderId }).from(t.invoices).where(and(eq(t.invoices.orgId, s.orgs.a), eq(t.invoices.entityId, sc.SG.entityId)));
    const before = await sgInvoices();
    expect(before.map((x) => x.id).sort()).toEqual(["SG-1001", "SG-1002", "SG-1003", "SG-1004", "SG-1005", "SG-1999"]);
    const purged = await purgeExpiredUploads(ownerDb(), new Date(Date.now() + 2 * 86_400_000));
    expect(purged).toMatchObject({ uploads: 1, files: 1, invoices: 1 });
    const after = await sgInvoices();
    expect(after.map((x) => x.id).sort()).toEqual(["SG-1001", "SG-1002", "SG-1003", "SG-1004", "SG-1005"]);
  });
  it("purging everything leaves nothing derived from any upload: no file, no validation row, no normalised row, no outputs of their orders", async () => {
    await purgeExpiredUploads(ownerDb(), new Date(Date.now() + 400 * 86_400_000));
    for (const table of ["invoices", "merchant_quotes", "payment_links", "provider_payment_records", "chain_transfers", "settlement_batches", "settlement_batch_lines", "bank_lines"]) {
      const left = await ownerDb().execute(sql.raw(`select count(*)::int as n from ${table} where upload_id is not null or source_row is not null`));
      expect(left.rows[0].n, table).toBe(0);
    }
    for (const table of ["upload_rows", "upload_row_targets", "invoices", "match_records", "differences", "recon_exceptions", "writeoff_proposals", "merchant_journal_proposals", "bank_lines", "settlement_batches"]) {
      expect((await ownerDb().execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n, table).toBe(0);
    }
    expect(await ownerDb().select().from(t.uploads).where(isNotNull(t.uploads.storageKey))).toEqual([]);
    for (const org of [s.orgs.a, s.orgs.b]) expect(existsSync(path.join(dir, org)) ? readdirSync(path.join(dir, org)) : []).toEqual([]);
    // chain facts observed by a chain reader are not upload data and stay
    expect((await ownerDb().execute(sql`select count(*)::int as n from chain_transfers where source = 'recorded_fixture'`)).rows[0].n).toBe(8);
    const audit = await ownerDb().select().from(t.auditEvents).where(eq(t.auditEvents.action, "upload_purged"));
    expect(audit.length).toBeGreaterThan(5);
  });
});

describe("SECURITY: no file contents in logs or audit", () => {
  it("the distinctive marker in the uploaded files appears in no console output, audit row or idempotency record", async () => {
    expect(captured.join("\n")).not.toContain(MARKER);
    for (const table of ["audit_events", "idempotency_records", "uploads", "upload_rows", "upload_row_targets"]) {
      const dump = await ownerDb().execute(sql.raw(`select coalesce(string_agg(x::text, ''), '') as dump from ${table} x`));
      expect(String(dump.rows[0].dump), table).not.toContain(MARKER);
    }
  });
});
