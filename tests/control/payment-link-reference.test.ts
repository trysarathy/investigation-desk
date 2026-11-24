/**
 * rc8 regression (found in the rc7 blind test): a provider export whose reference column is mapped as "Payment link
 * ID", with no quoted (requested) amount in the file, made every reconciliation run of the entity fail with a generic
 * internal error ("payment link … lacks the fields reconciliation needs"). Now the link is loaded with its requested
 * amount unknown, the run completes, and each such order gets a clear outcome with an owner, a reason and a next step.
 * No match is loosened: here no settlement report is uploaded (the batches the export names are unknown), one payment
 * is short and one has no chain transfer, so nothing closes. Through the services (no UI), against PostgreSQL, with
 * chain facts from a recorded chain client. Every value is fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { withTenant, type TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { runReconciliation } from "../../src/server/merchant";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile } from "../../src/lib/clearline/merchant";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `pl-ref-${++n}-${Date.now()}`;

async function pipeline(c: TenantContext, entityId: string, fileType: FileType, fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const up = await createUpload(c, { entityId, fileType, fileName, bytes }, key());
  await setUploadMapping(c, up.upload.id, { mapping }, key());
  const v = (await validateUpload(c, up.upload.id, key())).body;
  await decideUpload(c, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(c, up.upload.id, key())).body;
}

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-plref");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("a reference column mapped as Payment link ID, with no quoted amount in the file", () => {
  it("reconciles with a clear outcome per order (never a failed run, never a looser match)", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    await pipeline(ops, sc.SG.entityId, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING);
    // the person maps the reference column as a payment link ID; the file's quote terms are not mapped
    const { quote_id: _q, quoted_token_amount: _a, quote_rate: _r, created_at: _c, expires_at: _e, invoice_amount: _i, ...rest } = sc.SG_EXPORT_MAPPING.columns;
    void _q; void _a; void _r; void _c; void _e; void _i;
    const norm = await pipeline(ops, sc.SG.entityId, "provider_export", "export.csv", sc.sgExportCsv(), { fileType: "provider_export", columns: { ...rest, payment_link_id: { header: "Quote ID" } } });
    expect(norm.counts.conflict).toBe(0);
    const links = await ownerDb().select().from(t.paymentLinks).where(and(eq(t.paymentLinks.orgId, s.orgs.a)));
    expect(links.length).toBe(4);
    expect(links.every((l) => l.requestedBaseUnits === null)).toBe(true);

    // the run completes (before the fix: "payment link … lacks the fields reconciliation needs", a failed run)
    const chain = new RecordingChainClient(recordingOf(sc.observedTransfers(sc.SG)), { now: "2026-11-23T00:00:00.000Z" });
    const run = await runReconciliation(ops, sc.SG.entityId, key(), { chain });
    expect(run.body).toMatchObject({ changed: true, records: 4 });
    const failed = await ownerDb().select().from(t.reconciliationRuns).where(and(eq(t.reconciliationRuns.orgId, s.orgs.a), eq(t.reconciliationRuns.status, "failed")));
    expect(failed).toEqual([]);

    const input = await withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => loadReconcileInput(tx, ops.orgId, sc.SG.entityId), { read: true });
    expect(input.paymentLinks.map((l) => [l.requestedUnknown, l.windowUnknown])).toEqual(links.map(() => [true, true]));
    const r = reconcile(input);
    expect(r.records.length).toBe(4);
    for (const rec of r.records) {
      // nothing closes here (unknown batches, a short payment, a payment with no chain transfer)
      expect(["suggested_for_review", "exception"], `${rec.orderId} ${rec.explanation.ruleId}`).toContain(rec.explanation.decision);
      expect(rec.attention, rec.orderId).toBeDefined();
      expect([rec.attention!.owner.length > 2, rec.attention!.reason.length > 10, rec.attention!.nextStep.length > 10]).toEqual([true, true, true]);
    }
    // an order whose payment is otherwise fine abstains for the missing terms, with the quoted amount among them
    expect(r.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId])).toEqual([
      ["SG-1001", "exception", "M3.batch.unknown_batch"], ["SG-1002", "exception", "M3.batch.unknown_batch"],
      ["SG-1003", "suggested_for_review", "M3.quote.terms_unknown"], ["SG-1004", "exception", "M2.reference.no_chain_transfer"],
    ]);
    const abstained = r.records.filter((x) => x.explanation.ruleId === "M3.quote.terms_unknown");
    for (const x of abstained) expect(x.explanation.history.find((h) => h.ruleId === "M3.quote.terms_unknown")!.detail).toMatch(/quoted amount/);
    const stored = await ownerDb().select().from(t.matchRecords).where(eq(t.matchRecords.orgId, s.orgs.a));
    expect(stored.map((m) => [m.orderId, m.decision, m.ruleId]).sort()).toEqual(r.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId]).sort());
  });
});
