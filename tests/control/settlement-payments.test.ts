/**
 * v1 Phase 0 (approval-only draft), against PostgreSQL: a per-payment settlement file uploaded beside a totals-only
 * settlement report. Before it, a totals-only batch links no payment, so step 5 only proposes a grouping. After it, the
 * batch ties (its per-payment lines sum exactly to the batch and to the bank credit) and an exact payment goes as far as
 * the imported bank line allows: "imported, not bank-authenticated" keeps it in review while the flag is off. The table
 * is insert-only, upload-provenanced and adds up row by row. Every value is fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { accountFields, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { withTenant, type TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload, validationReport } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { purgeDerivedRows } from "../../src/server/upload-retention";
import { runReconciliation } from "../../src/server/merchant";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile, type ReconcileInput } from "../../src/lib/clearline/merchant";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `pp-settle-${++n}-${Date.now()}`;
const utf8 = (x: string) => new TextEncoder().encode(x);

async function pipeline(up: TenantContext, conf: TenantContext, fileType: FileType, fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const u = await createUpload(up, { entityId: sc.SG.entityId, fileType, fileName, bytes, ...(await accountFields(up, sc.SG.entityId, fileType)) }, key());
  await setUploadMapping(up, u.upload.id, { mapping }, key());
  const v = (await validateUpload(up, u.upload.id, key())).body;
  await decideUpload(conf, u.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return { id: u.upload.id, v, norm: (await normaliseUpload(conf, u.upload.id, key())).body };
}

const TOTALS = utf8(`Payout,Day,Ccy,Account,Gross,Fees,Net\n${sc.SG.batch.id},${sc.SG.batch.day},SGD,${sc.SG.account},${sc.SG.batch.gross},${sc.SG.batch.fees},${sc.SG.batch.net}\n`);
const TOTALS_MAPPING: Mapping = { fileType: "settlement_report", shape: "batch_totals", columns: {
  batch_id: { header: "Payout" }, provider_day: { header: "Day" }, currency: { header: "Ccy" }, bank_account: { header: "Account" }, gross: { header: "Gross" }, fee: { header: "Fees" }, net: { header: "Net" },
} };
/** One row per payment of B-SG-1102: 1,350.00 − 13.50 = 1,336.50 and 2,698.65 − 26.99 = 2,671.66 (Σ 4,048.65 − 40.49 = 4,008.16). */
const PER_PAYMENT = utf8(["Payment,Order ref,Payout,Ccy,Gross,Fee,Net,Settled",
  `P-SG-1,SG-1001,${sc.SG.batch.id},SGD,1350.00,13.50,1336.50,2026-11-03`,
  `P-SG-2,SG-1002,${sc.SG.batch.id},SGD,2698.65,26.99,2671.66,2026-11-03`].join("\n") + "\n");
const PER_PAYMENT_MAPPING: Mapping = { fileType: "settlement_payments", columns: {
  payment_id: { header: "Payment" }, order_id: { header: "Order ref" }, batch_id: { header: "Payout" }, currency: { header: "Ccy" },
  gross: { header: "Gross" }, fee: { header: "Fee" }, net: { header: "Net" }, settlement_date: { header: "Settled" },
} };

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-ppset");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

const ids: Record<string, string> = {};
describe("per-payment settlement file beside a totals-only report", () => {
  let input: ReconcileInput;
  it("before: totals only → grouping proposed; after: the batch ties from the per-payment lines, imported bank line keeps review", async () => {
    const [ops, approver] = await Promise.all([liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "approver@live-a.example", "a")]);
    await pipeline(ops, ops, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING);
    // provider export without quote terms (the blind test's shape): decision 1 can close only the exact payment, SG-1001
    const { quote_rate: _r, quoted_token_amount: _a, created_at: _c, expires_at: _e, invoice_amount: _i, ...rest } = sc.SG_EXPORT_MAPPING.columns;
    void _r; void _a; void _c; void _e; void _i;
    await pipeline(ops, ops, "provider_export", "export.csv", sc.sgExportCsv(), { fileType: "provider_export", columns: rest });
    ids.totals = (await pipeline(ops, ops, "settlement_report", "totals.csv", TOTALS, TOTALS_MAPPING)).id;
    await pipeline(ops, approver, "bank_statement", "bank.csv", sc.sgBankCsv(), sc.SG_BANK_MAPPING);
    const chain = new RecordingChainClient(recordingOf(sc.observedTransfers(sc.SG)), { now: "2026-11-23T00:00:00.000Z" });
    await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    const load = () => withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => loadReconcileInput(tx, ops.orgId, sc.SG.entityId), { read: true });
    const before = reconcile(await load());
    const sg1 = (r: typeof before) => r.records.find((x) => x.orderId === "SG-1001")!.explanation;
    expect((await load()).settlementPaymentLines).toBeUndefined();
    expect([sg1(before).decision, sg1(before).ruleId]).toEqual(["suggested_for_review", "M5.grouping.proposed_needs_confirmation"]);
    expect(before.bridges[0].paymentIds).toEqual([]);

    const pp = await pipeline(ops, ops, "settlement_payments", "per-payment.csv", PER_PAYMENT, PER_PAYMENT_MAPPING);
    expect(pp.norm.counts).toMatchObject({ created: 2, conflict: 0 });
    ids.perPayment = pp.id;
    const run = await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    expect(run.body).toMatchObject({ changed: true });
    input = await load();
    expect(input.settlementPaymentLines?.map((l) => [l.providerPaymentId, l.grossMinor, l.feeMinor, l.netMinor])).toEqual([["P-SG-1", 135000n, 1350n, 133650n], ["P-SG-2", 269865n, 2699n, 267166n]]);
    const after = reconcile(input);
    expect(after.bridges[0]).toMatchObject({ batchId: sc.SG.batch.id, tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated", checks: { perPaymentLines: true } });
    expect([sg1(after).decision, sg1(after).ruleId]).toEqual(["suggested_for_review", "M5.bank.imported_not_verified"]);
    // stored = computed
    const stored = await ownerDb().select().from(t.matchRecords).where(eq(t.matchRecords.orgId, s.orgs.a));
    expect(stored.map((m) => [m.orderId, m.decision, m.ruleId]).sort()).toEqual(after.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId]).sort());
    // nothing else closed: every other order keeps a non-closing decision
    for (const r of after.records.filter((x) => x.orderId !== "SG-1001")) expect(r.explanation.decision, r.orderId).not.toMatch(/^matched/);
  });

  it("only with the imported-bank-line flag on (a check, not the default) does the exact payment close at step 5", () => {
    const on = reconcile({ ...input, policy: { ...input.policy, allowImportedBankLinesAsVerified: true } });
    const e = on.records.find((x) => x.orderId === "SG-1001")!.explanation;
    expect([e.decision, e.ruleId]).toEqual(["matched", "M5.batch.tied_verified"]);
    expect(on.records.filter((x) => x.explanation.decision.startsWith("matched")).map((x) => x.orderId)).toEqual(["SG-1001"]);
  });

  it("a row that does not add up is refused at validation; the table refuses changes, bad arithmetic and rows without a confirmed upload", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    const u = await createUpload(ops, { entityId: sc.SG.entityId, fileType: "settlement_payments", fileName: "bad.csv", bytes: utf8(`Payment,Order ref,Payout,Ccy,Gross,Fee,Net,Settled\nP-SG-9,SG-1003,${sc.SG.batch.id},SGD,10.00,1.00,9.01,2026-11-03\n`) }, key());
    await setUploadMapping(ops, u.upload.id, { mapping: PER_PAYMENT_MAPPING }, key());
    await validateUpload(ops, u.upload.id, key());
    const report = await validationReport(ops, u.upload.id);
    expect(report.rows.map((r) => r.status)).toEqual(["rejected"]);
    expect(JSON.stringify(report.rows[0].reasonCodes)).toMatch(/gross_less_fee_not_net/);
    const db = ownerDb();
    const fail = async (q: Promise<unknown>, re: RegExp) => {
      const e = await q.then(() => null, (x: { message?: string; cause?: { message?: string; constraint?: string } }) => x);
      expect(e, "refused").not.toBeNull();
      expect(`${e!.cause?.message ?? e!.message} ${e!.cause?.constraint ?? ""}`).toMatch(re);
    };
    await fail(db.execute(sql`update settlement_payment_lines set gross_minor = gross_minor + 1, net_minor = net_minor + 1 where org_id = ${s.orgs.a}`), /settlement_payment_lines is append-only: UPDATE refused/);
    const upl = (await db.select().from(t.settlementPaymentLines).where(eq(t.settlementPaymentLines.orgId, s.orgs.a)))[0];
    await fail(db.execute(sql`insert into settlement_payment_lines (org_id, entity_id, provider_payment_id, batch_id, currency, gross_minor, fee_minor, net_minor, upload_id, source_row, uploaded_by)
      values (${s.orgs.a}, ${sc.SG.entityId}, 'P-X1', ${sc.SG.batch.id}, 'SGD', 100, 1, 98, ${upl.uploadId}, 9, ${upl.uploadedBy})`), /settlement_payment_lines_arith_chk/);
    await fail(db.execute(sql`insert into settlement_payment_lines (org_id, entity_id, provider_payment_id, batch_id, currency, gross_minor, fee_minor, net_minor, upload_id, source_row, uploaded_by)
      values (${s.orgs.a}, ${sc.SG.entityId}, 'P-X2', ${sc.SG.batch.id}, 'SGD', 100, 1, 99, gen_random_uuid(), 9, ${upl.uploadedBy})`), /confirmed upload of a matching file type/);
    // the runtime role cannot see another merchant's lines (row-level security)
    const finB = await liveCtx(s, "finance@live-b.example", "b");
    const seen = await withTenant({ userId: finB.userId, orgId: finB.orgId }, (tx) => tx.select().from(t.settlementPaymentLines), { read: true });
    expect(seen).toEqual([]);
  });

  it("retention: purging the totals report keeps a batch the per-payment lines still name; purging the lines then lets it go", async () => {
    const db = ownerDb();
    const count = async (table: "settlement_batches" | "settlement_payment_lines") => Number(((await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where org_id = ${s.orgs.a}`)).rows[0] as { n: number }).n);
    await db.transaction((tx) => purgeDerivedRows(tx, { orgId: s.orgs.a, id: ids.totals }));
    expect([await count("settlement_batches"), await count("settlement_payment_lines")]).toEqual([1, 2]);
    await db.transaction((tx) => purgeDerivedRows(tx, { orgId: s.orgs.a, id: ids.perPayment }));
    expect([await count("settlement_batches"), await count("settlement_payment_lines")]).toEqual([0, 0]);
  });
});
