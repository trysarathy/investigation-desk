/**
 * v1 #174 (approval-only draft), against PostgreSQL: refund rows in a per-payment settlement file. A refund row
 * (line type "refund") names the ORIGINAL payment by its provider payment ID and its own refund ID, with the money
 * returned as a negative gross and net and no fee. At upload the original must be a payment of this merchant entity in
 * reconciliation, in the same currency, and the refund no more than its credit; the engine checks the same again and
 * ties a batch with refunds only when gross − fees − refunds = net exactly and equals the bank line. A refund row never
 * links or closes a payment. Every value is fictional.
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
import { reconcile } from "../../src/lib/clearline/merchant";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `pp-refund-${++n}-${Date.now()}`;
const utf8 = (x: string) => new TextEncoder().encode(x);
const B = sc.SG.batch.id;

async function pipeline(up: TenantContext, conf: TenantContext, fileType: FileType, fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const u = await createUpload(up, { entityId: sc.SG.entityId, fileType, fileName, bytes, ...(await accountFields(up, sc.SG.entityId, fileType)) }, key());
  await setUploadMapping(up, u.upload.id, { mapping }, key());
  const v = (await validateUpload(up, u.upload.id, key())).body;
  await decideUpload(conf, u.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return { id: u.upload.id, v, norm: (await normaliseUpload(conf, u.upload.id, key())).body };
}

/** B-SG-1102 nets a refund of SGD 100.00 of P-SG-2: 4,048.65 − 40.49 − 100.00 = 3,908.16. */
const TOTALS = utf8(`Payout,Day,Ccy,Account,Gross,Fees,Refunds,Net\n${B},${sc.SG.batch.day},SGD,${sc.SG.account},4048.65,40.49,100.00,3908.16\n`);
const TOTALS_MAPPING: Mapping = { fileType: "settlement_report", shape: "batch_totals", columns: {
  batch_id: { header: "Payout" }, provider_day: { header: "Day" }, currency: { header: "Ccy" }, bank_account: { header: "Account" }, gross: { header: "Gross" }, fee: { header: "Fees" }, refund: { header: "Refunds" }, net: { header: "Net" },
} };
const BANK = utf8(["Buchungstag;Valuta;Betrag;Verwendungszweck;Auftraggeber", `03.11.2026;03.11.2026;3.908,16;PAYOUT ${B};Provider A (fictional)`].join("\n") + "\n");
const HEAD = "Type,Payment,Order ref,Payout,Ccy,Gross,Fee,Net,Refund ID,Settled";
const PAY = [`Payment,P-SG-1,SG-1001,${B},SGD,1350.00,13.50,1336.50,,2026-11-03`, `Payment,P-SG-2,SG-1002,${B},SGD,2698.65,26.99,2671.66,,2026-11-03`];
const REFUND = `Refund,P-SG-2,SG-1002,${B},SGD,-100.00,0.00,-100.00,RF-SG-1,2026-11-03`;
const MAPPING: Mapping = { fileType: "settlement_payments", columns: {
  line_type: { header: "Type", statusValueMap: { Payment: "payment", Refund: "refund" } }, payment_id: { header: "Payment" }, order_id: { header: "Order ref" }, batch_id: { header: "Payout" },
  currency: { header: "Ccy" }, gross: { header: "Gross" }, fee: { header: "Fee" }, net: { header: "Net" }, refund_id: { header: "Refund ID" }, settlement_date: { header: "Settled" },
} };
const file = (rows: string[]) => utf8([HEAD, ...rows].join("\n") + "\n");

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-ppref");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("#174 refund rows in a per-payment settlement file", () => {
  const ids: Record<string, string> = {};
  it("before: payment rows only, the batch's refund is unnamed → untied; after: with the refund row it ties (imported bank line keeps review)", async () => {
    const [ops, approver] = await Promise.all([liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "approver@live-a.example", "a")]);
    await pipeline(ops, ops, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING);
    const { quote_rate: _r, quoted_token_amount: _a, created_at: _c, expires_at: _e, invoice_amount: _i, ...rest } = sc.SG_EXPORT_MAPPING.columns;
    void _r; void _a; void _c; void _e; void _i;
    await pipeline(ops, ops, "provider_export", "export.csv", sc.sgExportCsv(), { fileType: "provider_export", columns: rest });
    await pipeline(ops, ops, "settlement_report", "totals.csv", TOTALS, TOTALS_MAPPING);
    await pipeline(ops, approver, "bank_statement", "bank.csv", BANK, sc.SG_BANK_MAPPING);
    const chain = new RecordingChainClient(recordingOf(sc.observedTransfers(sc.SG)), { now: "2026-11-23T00:00:00.000Z" });
    const load = () => withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => loadReconcileInput(tx, ops.orgId, sc.SG.entityId), { read: true });
    const sg1 = (i: Awaited<ReturnType<typeof load>>, flag = false) => reconcile({ ...i, policy: { ...i.policy, allowImportedBankLinesAsVerified: flag } }).records.find((x) => x.orderId === "SG-1001")!.explanation;

    const pays = await pipeline(ops, ops, "settlement_payments", "payments.csv", file(PAY), MAPPING);
    expect(pays.norm.counts).toMatchObject({ created: 2, conflict: 0 });
    await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    const before = await load();
    expect(reconcile(before).bridges[0]).toMatchObject({ batchId: B, tied: false, checks: { perPaymentLines: true, linesEqualGross: false } });
    expect(sg1(before, true).decision).not.toMatch(/^matched/);

    const ref = await pipeline(ops, ops, "settlement_payments", "refunds.csv", file([REFUND]), MAPPING);
    expect(ref.norm.counts).toMatchObject({ created: 1, conflict: 0 });
    ids.refund = ref.id;
    await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    const after = await load();
    expect(after.settlementPaymentLines?.filter((l) => l.kind === "refund")).toEqual([expect.objectContaining({ providerPaymentId: "P-SG-2", refundId: "RF-SG-1", grossMinor: -10000n, feeMinor: 0n, netMinor: -10000n })]);
    const br = reconcile(after).bridges[0];
    expect(br).toMatchObject({ tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated", checks: { perPaymentLines: true, linesEqualGross: true, grossLessFeesRefundsEqualsNet: true, netEqualsBankLine: true } });
    expect(br.lines.find((l) => l.kind === "refund_netted")).toMatchObject({ amountMinor: -10000n, paymentIds: ["RF-SG-1"], orderIds: ["SG-1002"] });
    expect([sg1(after).decision, sg1(after).ruleId]).toEqual(["suggested_for_review", "M5.bank.imported_not_verified"]);
    expect([sg1(after, true).decision, sg1(after, true).ruleId]).toEqual(["matched", "M5.batch.tied_verified"]);
    // the refunded order is never closed
    expect(reconcile({ ...after, policy: { ...after.policy, allowImportedBankLinesAsVerified: true } }).records.find((x) => x.orderId === "SG-1002")!.explanation.decision).not.toMatch(/^matched/);
    const stored = await ownerDb().select().from(t.matchRecords).where(eq(t.matchRecords.orgId, s.orgs.a));
    expect(stored.find((m) => m.orderId === "SG-1001")!.ruleId).toBe("M5.bank.imported_not_verified");
  });

  it("upload validation: a positive refund amount, a fee or a missing refund ID is refused; an unknown payment, another currency's or one above the credit is a conflict", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    const u = await createUpload(ops, { entityId: sc.SG.entityId, fileType: "settlement_payments", fileName: "bad.csv", bytes: file([
      `Refund,P-SG-2,SG-1002,${B},SGD,100.00,0.00,100.00,RF-SG-2,2026-11-03`,
      `Refund,P-SG-2,SG-1002,${B},SGD,-100.00,1.00,-101.00,RF-SG-3,2026-11-03`,
      `Refund,P-SG-2,SG-1002,${B},SGD,-100.00,0.00,-100.00,,2026-11-03`,
      `Payment,P-SG-1,SG-1001,${B},SGD,1350.00,13.50,1336.50,RF-SG-4,2026-11-03`,
    ]) }, key());
    await setUploadMapping(ops, u.upload.id, { mapping: MAPPING }, key());
    await validateUpload(ops, u.upload.id, key());
    const report = await validationReport(ops, u.upload.id);
    expect(report.rows.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(report.rows.map((r) => JSON.stringify(r.reasonCodes))).toEqual([
      expect.stringMatching(/refund_amount_not_negative/), expect.stringMatching(/refund_fee_not_zero/), expect.stringMatching(/missing_value/), expect.stringMatching(/refund_id_on_payment_row/)]);
    const conflicts = await pipeline(ops, ops, "settlement_payments", "conflicts.csv", file([
      `Refund,P-NOT-KNOWN,,${B},SGD,-1.00,0.00,-1.00,RF-SG-5,2026-11-03`,
      `Refund,P-SG-1,SG-1001,${B},SGD,-1350.01,0.00,-1350.01,RF-SG-6,2026-11-03`,
      `Refund,P-SG-2,SG-1002,${B},SGD,-2598.66,0.00,-2598.66,RF-SG-7,2026-11-03`,
    ]), MAPPING);
    // P-SG-2 is credited 2,698.65 and already refunded 100.00: 2,598.66 more is one cent too much
    expect(conflicts.norm.counts).toMatchObject({ created: 0, conflict: 3 });
  });

  it("the table: a refund row's sign, fee and refund ID are checked; payment rows unchanged; retention removes refund rows by their key", async () => {
    const db = ownerDb();
    const fail = async (q: Promise<unknown>, re: RegExp) => {
      const e = await q.then(() => null, (x: { message?: string; cause?: { message?: string; constraint?: string } }) => x);
      expect(e, "refused").not.toBeNull();
      expect(`${e!.cause?.message ?? e!.message} ${e!.cause?.constraint ?? ""}`).toMatch(re);
    };
    const upl = (await db.select().from(t.settlementPaymentLines).where(eq(t.settlementPaymentLines.orgId, s.orgs.a)))[0];
    const ins = (cols: string, vals: string) => db.execute(sql.raw(`insert into settlement_payment_lines (org_id, entity_id, provider_payment_id, batch_id, currency, upload_id, source_row, uploaded_by, ${cols})
      values ('${s.orgs.a}', '${sc.SG.entityId}', 'P-SG-2', '${B}', 'SGD', '${upl.uploadId}', 9, '${upl.uploadedBy}', ${vals})`));
    await fail(ins("kind, refund_id, gross_minor, fee_minor, net_minor", "'refund', 'RF-X1', 100, 0, 100"), /settlement_payment_lines_arith_chk/);
    await fail(ins("kind, refund_id, gross_minor, fee_minor, net_minor", "'refund', 'RF-X2', -100, 1, -101"), /settlement_payment_lines_arith_chk/);
    // a refund row without a refund ID has no key (refused by the generated key's NOT NULL, before the kind check)
    await fail(ins("kind, gross_minor, fee_minor, net_minor", "'refund', -100, 0, -100"), /settlement_payment_lines_kind_chk|null value in column "line_key"/);
    await fail(ins("kind, refund_id, gross_minor, fee_minor, net_minor", "'payment', 'RF-X3', 100, 0, 100"), /settlement_payment_lines_kind_chk/);
    await fail(db.execute(sql`update settlement_payment_lines set refund_id = 'RF-OTHER' where org_id = ${s.orgs.a} and kind = 'refund'`), /append-only: UPDATE refused/);
    const keys = (await db.execute(sql`select line_key from settlement_payment_lines where org_id = ${s.orgs.a} order by line_key`)).rows.map((r) => r.line_key);
    expect(keys).toEqual(["P-SG-1", "P-SG-2", "refund:RF-SG-1"]);
    await db.transaction((tx) => purgeDerivedRows(tx, { orgId: s.orgs.a, id: ids.refund }));
    expect((await db.execute(sql`select line_key from settlement_payment_lines where org_id = ${s.orgs.a} order by line_key`)).rows.map((r) => r.line_key)).toEqual(["P-SG-1", "P-SG-2"]);
  });
});
