/**
 * v1 Phase 0 (approval-only draft), against PostgreSQL: orders priced directly in a token, through the upload pipeline
 * (orders file → provider export without quote terms → reconciliation with a recorded chain client). The database keeps
 * exactly one pricing mode per invoice and never changes a price; the engine closes a token-priced order at step 4 only
 * when the token amount is exact and linked by reference (then step 5 applies), and sends a one-unit difference to
 * review with a typed difference. Every value is fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { withTenant, type TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { listMerchantPayments, merchantPaymentDetail, monthEnd, runReconciliation } from "../../src/server/merchant";
import { evidencePack, monthEndView } from "../../src/server/merchant-ui";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile } from "../../src/lib/clearline/merchant";
import { USDT_TRON } from "../../src/lib/clearline/merchant/config";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `tok-price-${++n}-${Date.now()}`;

async function pipeline(c: TenantContext, entityId: string, fileType: FileType, fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const up = await createUpload(c, { entityId, fileType, fileName, bytes }, key());
  await setUploadMapping(c, up.upload.id, { mapping }, key());
  const v = (await validateUpload(c, up.upload.id, key())).body;
  await decideUpload(c, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(c, up.upload.id, key())).body;
}

/** SG-1001 and SG-1002 priced in USDT on TRON (1,000 and 2,000 USDT); SG-1003 and SG-1004 in SGD as before. */
const ORDERS = new TextEncoder().encode([
  "Invoice,Total,Currency,Token price,Chain,Contract",
  "SG-1001,,SGD,1000.00,tron," + USDT_TRON,
  "SG-1002,,SGD,2000.00,tron," + USDT_TRON,
  "SG-1003,1350.00,SGD,,,",
  "SG-1004,675.00,SGD,,,",
].join("\n") + "\n");
const ORDERS_MAPPING: Mapping = { fileType: "orders_invoices", columns: {
  order_id: { header: "Invoice" }, invoice_amount: { header: "Total" }, currency: { header: "Currency" },
  price_token_amount: { header: "Token price" }, network: { header: "Chain" }, token_contract: { header: "Contract" },
} };

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-tokp");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("token-priced invoices through the pipeline", () => {
  it("stores one pricing mode per invoice, closes only the exact one by reference, reviews a one-unit difference", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    const orders = await pipeline(ops, sc.SG.entityId, "orders_invoices", "orders.csv", ORDERS, ORDERS_MAPPING);
    expect(orders.counts).toMatchObject({ created: 4, conflict: 0 });
    const inv = await ownerDb().select().from(t.invoices).where(eq(t.invoices.orgId, s.orgs.a));
    const by = Object.fromEntries(inv.map((i) => [i.orderId, i]));
    expect([by["SG-1001"].amountMinor, by["SG-1001"].priceNetwork, by["SG-1001"].priceTokenContract, String(by["SG-1001"].priceTokenAmount)]).toEqual([null, "tron", USDT_TRON, "1000000000"]);
    expect([by["SG-1003"].amountMinor, by["SG-1003"].priceTokenAmount]).toEqual([135000n, null]);

    // the provider export without quote terms or batches (so step 5 can only propose a grouping); the orders exist already
    const { quote_rate: _r, quoted_token_amount: _a, created_at: _c, expires_at: _e, invoice_amount: _i, batch_id: _b, ...rest } = sc.SG_EXPORT_MAPPING.columns;
    void _r; void _a; void _c; void _e; void _i; void _b;
    const exp = await pipeline(ops, sc.SG.entityId, "provider_export", "export.csv", sc.sgExportCsv(), { fileType: "provider_export", columns: rest });
    expect(exp.counts.conflict).toBe(0);

    const chain = new RecordingChainClient(recordingOf(sc.observedTransfers(sc.SG)), { now: "2026-11-23T00:00:00.000Z" });
    const run = await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    expect(run.body).toMatchObject({ changed: true, records: 4 });

    const input = await withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => loadReconcileInput(tx, ops.orgId, sc.SG.entityId), { read: true });
    expect(input.invoices.find((i) => i.orderId === "SG-1001")).toMatchObject({ amountMinor: 0n, price: { token: { network: "tron", contract: USDT_TRON }, baseUnits: 1_000_000_000n } });
    expect(input.invoices.find((i) => i.orderId === "SG-1003")!.price).toBeUndefined();
    const r = reconcile(input);
    const rec = (o: string) => r.records.find((x) => x.orderId === o)!;
    // SG-1001: exact 1,000 USDT by reference → matched at step 4; the record names its transaction but no batch → step 5 proposes a grouping
    expect(rec("SG-1001").explanation.history.some((h) => h.ruleId === "M4.exact.token_priced" && h.outcome === "pass")).toBe(true);
    expect([rec("SG-1001").explanation.decision, rec("SG-1001").explanation.ruleId]).toEqual(["suggested_for_review", "M5.grouping.proposed_needs_confirmation"]);
    // no fx_rates are recorded for this entity: the fiat value is flagged, never invented
    expect(rec("SG-1001").ledger.fiatValue).toMatchObject({ status: "needs_rate", pair: "USDT/SGD" });
    // SG-1002: 1,999 USDT received against a 2,000 USDT price → review, typed in base units
    expect([rec("SG-1002").explanation.decision, rec("SG-1002").explanation.ruleId]).toEqual(["suggested_for_review", "M4.token_priced.amount_difference"]);
    expect(rec("SG-1002").explanation.differences[0]).toMatchObject({ type: "price_token_amount", token: { baseUnits: -1_000_000n } });
    // stored = computed, and the new difference type is accepted by the database
    const stored = await ownerDb().select().from(t.matchRecords).where(eq(t.matchRecords.orgId, s.orgs.a));
    expect(stored.map((m) => [m.orderId, m.decision, m.ruleId]).sort()).toEqual(r.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId]).sort());
    const diffs = await ownerDb().select().from(t.differences).where(and(eq(t.differences.orgId, s.orgs.a), eq(t.differences.orderId, "SG-1002")));
    expect(diffs.map((d) => d.type)).toEqual(["price_token_amount"]);
    // no journal proposal for a token-priced order
    const jp = await ownerDb().select().from(t.merchantJournalProposals).where(eq(t.merchantJournalProposals.orgId, s.orgs.a));
    expect(jp.filter((j) => JSON.stringify(j).includes("SG-1001") || JSON.stringify(j).includes("SG-1002"))).toEqual([]);
  });

  it("#173: without a recorded rate no surface shows or emits 0 for the fiat value: lists, payment, month-end, evidence pack", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    // the payments list: the token price, fiatValueStatus needs_rate, no fiat value; SG-1002's open balance (short in
    // the token) is unknown, SG-1001's (paid exactly in the token) is a true zero
    const list = Object.fromEntries((await listMerchantPayments(ops, { entityId: sc.SG.entityId })).map((r) => [r.orderId, r]));
    expect(list["SG-1001"]).toMatchObject({ invoiceMinor: null, fiatValueStatus: "needs_rate", fiatValueMinor: null, openBalanceMinor: "0" });
    expect(list["SG-1002"]).toMatchObject({ invoiceMinor: null, fiatValueStatus: "needs_rate", fiatValueMinor: null, openBalanceMinor: null });
    expect(list["SG-1003"]).toMatchObject({ invoiceMinor: "135000" });
    expect(list["SG-1003"]).not.toHaveProperty("fiatValueStatus");
    // the payment detail keeps the record (the page renders it through fiat-value.ts; see the unit test)
    expect((await merchantPaymentDetail(ops, "SG-1002")).parts.ledger).toMatchObject({ fiatValue: { status: "needs_rate" }, balanceState: "short_paid" });
    // month-end: the unknown open balance is named apart, never added as 0
    const me = await monthEnd(ops, sc.SG.entityId, "2026-11");
    expect(me.openReceivablesNeedingRate).toMatchObject({ count: 1, orderIds: ["SG-1002"] });
    expect((await monthEndView(ops, sc.SG.entityId, "2026-11", null)).openReceivablesNeedingRate.count).toBe(1);
    // the evidence pack: null with fiatValueStatus in JSON, needs_rate in CSV, "needs a rate" in the PDF text model
    const pack = JSON.parse((await evidencePack(fin, { kind: "payment", orderId: "SG-1002" }, "json")).body as string);
    expect(pack.payments[0].ledger).toMatchObject({ fiatValueStatus: "needs_rate", invoice: { amountMinor: null }, openBalanceMinor: null });
    expect(pack.differences).toEqual([expect.objectContaining({ type: "price_token_amount", amountMinor: null, fiatValueStatus: "needs_rate" })]);
    expect(pack.payments[0].explanation.differences[0]).toMatchObject({ amountMinor: null, fiatValueStatus: "needs_rate" });
    const packCsv = (await evidencePack(fin, { kind: "payment", orderId: "SG-1002" }, "csv")).body as string;
    const diffRow = packCsv.split("\r\n").find((l) => l.startsWith("difference,"))!;
    expect(diffRow.split(",")[4]).toBe("needs_rate");
    expect(packCsv).toMatch(/fiat value needs a rate/);
  });

  it("the database refuses both pricing modes, neither, an unconfigured token, and any price change", async () => {
    const db = ownerDb();
    // drizzle wraps the PostgreSQL error: read its message and constraint name
    const refused = async (q: Promise<unknown>, re: RegExp) => {
      const e = await q.then(() => null, (x: { message?: string; cause?: { message?: string; constraint?: string } }) => x);
      expect(e, "refused").not.toBeNull();
      expect(`${e!.cause?.message ?? e!.message} ${e!.cause?.constraint ?? ""}`).toMatch(re);
    };
    const ins = (cols: string) => db.execute(sql.raw(`insert into invoices (org_id, order_id, entity_id, currency, status, issued_at, ${cols.split("|")[0]}) values ('${s.orgs.a}', 'X-${++n}', '${sc.SG.entityId}', 'SGD', 'open', now(), ${cols.split("|")[1]})`));
    await refused(ins(`amount_minor, price_network, price_token_contract, price_token_amount|100, 'tron', '${USDT_TRON}', 5`), /invoices_pricing_mode_chk/);
    await refused(ins(`amount_minor|null`), /invoices_pricing_mode_chk/);
    await refused(ins(`price_network, price_token_contract, price_token_amount|'tron', '${USDT_TRON}', 0`), /invoices_pricing_mode_chk/);
    await refused(ins(`price_network, price_token_contract, price_token_amount|'tron', 'TFictionalNotConfigured000000000000', 5`), /invoices_price_token_fk/);
    await refused(db.execute(sql`update invoices set price_token_amount = price_token_amount + 1 where org_id = ${s.orgs.a} and order_id = 'SG-1001'`), /price is immutable/);
    await refused(db.execute(sql`update invoices set amount_minor = amount_minor + 1 where org_id = ${s.orgs.a} and order_id = 'SG-1003'`), /price is immutable/);
    // a status change is still allowed
    await expect(db.execute(sql`update invoices set status = 'void' where org_id = ${s.orgs.a} and order_id = 'SG-1004'`)).resolves.toBeDefined();
  });
});
