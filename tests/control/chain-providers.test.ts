/**
 * v1 phase 2.4: chain data from a PRIMARY and a FALLBACK provider (FallbackChainReader), end to end against
 * PostgreSQL 16: agreement, fallback when the primary is down, "chain data conflicting", "chain data unavailable" when
 * both fail, and a reorg that reverts a final fact (and so the payment's decision) to review with an audit entry.
 * Both providers are recorded clients (never the network). Every value is fictional.
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
import { verifyChainForEntity } from "../../src/server/chain-verify";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile } from "../../src/lib/clearline/merchant";
import {
  FallbackChainReader, NoChainClient, ReadersChainClient, RecordingChainClient, type VerifyChainClient, fakeRuntime, readerOfClient, recordingOf,
} from "../../src/lib/clearline/merchant/chain";
import type { ChainTransfer } from "../../src/lib/clearline/merchant/types";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `cp-key-${++n}-${Date.now()}`;
const NOW = new Date("2026-11-21T00:00:00.000Z");
let clock = NOW.getTime();
const later = () => new Date((clock += 3_600_000));

async function pipeline(c: TenantContext, entityId: string, fileType: "orders_invoices" | "provider_export", fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const up = await createUpload(c, { entityId, fileType, fileName, bytes }, key());
  await setUploadMapping(c, up.upload.id, { mapping }, key());
  const v = (await validateUpload(c, up.upload.id, key())).body;
  await decideUpload(c, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  await normaliseUpload(c, up.upload.id, key());
}
const decisions = async (c: TenantContext) => {
  const input = await withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => loadReconcileInput(tx, c.orgId, sc.SG.entityId), { read: true });
  return Object.fromEntries(reconcile(input).records.map((r) => [r.orderId, `${r.explanation.decision} ${r.explanation.ruleId}`]));
};
/** SG chain data: the four payments, all deep (50 confirmations). `tweak` changes one provider's copy. */
const chain = (tweak: (x: ChainTransfer[]) => ChainTransfer[] = (x) => x): ChainTransfer[] => {
  const seen = sc.observedTransfers(sc.SG);
  const o4 = sc.SG.orders[3];
  return tweak([...seen, { ...seen[0], txHash: sc.hash(o4.payment!.txIndex), to: o4.address, amountBaseUnits: 500_000_000n, block: 70_100, timestamp: o4.payment!.paidAt }].map((x) => ({ ...x, confirmations: 50 })));
};
const rec = (transfers: ChainTransfer[]) => new RecordingChainClient(recordingOf(transfers), { now: NOW.toISOString() });
/** The verify client: TRON through a FallbackChainReader over two recorded providers. */
const pairOf = (primary: Pick<VerifyChainClient, "incoming" | "transfer">, fallback: Pick<VerifyChainClient, "incoming" | "transfer">) =>
  new ReadersChainClient({ tron: new FallbackChainReader({ primary: readerOfClient(primary, "tron", "primary"), fallback: readerOfClient(fallback, "tron", "fallback"), runtime: fakeRuntime() }) });
const SG1_TX = sc.hash(1);
const allFacts = () => ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "chain_client")));
const readsWith = (status: string) => ownerDb().select().from(t.chainReads).where(and(eq(t.chainReads.orgId, s.orgs.a), eq(t.chainReads.status, status)));
const audits = (action: string) => ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), eq(t.auditEvents.action, action)));

let ops: TenantContext, fin: TenantContext;
beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  [ops, fin] = await Promise.all([liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "finance@live-a.example", "a")]);
  await pipeline(fin, sc.SG.entityId, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING);
  await pipeline(ops, sc.SG.entityId, "provider_export", "export.csv", sc.sgExportCsv(), sc.SG_EXPORT_MAPPING);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("primary + fallback chain providers", () => {
  it("BOTH providers down → every payment is 'chain data unavailable' (an exception), never matched, never zero", async () => {
    const res = await verifyChainForEntity(ops, sc.SG.entityId, pairOf(new NoChainClient("primary: recorded outage"), new NoChainClient("fallback: recorded outage")), { now: later() });
    expect(res).toMatchObject({ facts: 0, final: 0, conflicting: 0, reverted: 0 });
    expect(res.unavailable).toBeGreaterThanOrEqual(4);
    const reads = await readsWith("unavailable");
    expect(reads.some((r) => r.reason === "both providers failed (primary: primary: recorded outage; fallback: fallback: recorded outage)")).toBe(true);
    expect(Object.values(await decisions(ops))).toEqual(Array(4).fill("exception M1.chain.unavailable"));
  });

  it("primary down, fallback answers → the facts are stored but NOT final (one source); payments wait for confirmation, unmatched", async () => {
    const res = await verifyChainForEntity(ops, sc.SG.entityId, pairOf(new NoChainClient("primary: recorded outage"), rec(chain())), { now: later() });
    expect(res).toMatchObject({ facts: 4, final: 0, pending: 4, unavailable: 0 });
    const out = await decisions(ops);
    for (const o of ["SG-1001", "SG-1002", "SG-1004"]) expect(out[o]).toBe("suggested_for_review M1.finality.pending");
  });

  it("both providers agree → final facts with evidence; the payments reconcile on chain facts as with one provider", async () => {
    const res = await verifyChainForEntity(ops, sc.SG.entityId, pairOf(rec(chain()), rec(chain())), { now: later() });
    expect(res).toMatchObject({ addresses: 4, facts: 4, final: 4, pending: 0, unavailable: 0, conflicting: 0, reverted: 0 });
    expect((await allFacts()).every((f) => f.finalised && f.evidenceSource === "recording")).toBe(true);
    expect(await decisions(ops)).toMatchObject({ "SG-1001": "exception M3.batch.unknown_batch", "SG-1002": "exception M3.batch.unknown_batch", "SG-1003": "exception M4.tolerance.underpayment_beyond_band" });
  });

  it("the providers DISAGREE on SG-1001's amount → 'chain data conflicting': its final fact reverts (audited), SG-1001 is a typed exception, never matched; the rest are unaffected", async () => {
    const before = (await audits("merchant_chain_final_reverted")).length;
    const fallback = rec(chain((x) => x.map((c) => (c.txHash === SG1_TX ? { ...c, amountBaseUnits: c.amountBaseUnits - 1n } : c))));
    const res = await verifyChainForEntity(ops, sc.SG.entityId, pairOf(rec(chain()), fallback), { now: later() });
    expect(res.conflicting).toBeGreaterThanOrEqual(1);
    expect(res.reverted).toBe(1);
    const conflicting = await readsWith("conflicting");
    expect(conflicting.some((r) => r.txHash === SG1_TX && /^chain data conflicting: primary and fallback disagree/.test(r.reason ?? ""))).toBe(true);
    expect(conflicting.some((r) => r.address === sc.SG.orders[0].address)).toBe(true);
    const f1 = (await allFacts()).find((f) => f.txHash === SG1_TX)!;
    expect([f1.finalised, f1.amountBaseUnits]).toEqual([false, "1000000000"]); // facts stay as first read; only finality changed
    const a = await audits("merchant_chain_final_reverted");
    expect(a.length).toBe(before + 1);
    expect(a.at(-1)!.details).toEqual({ mode: "recorded", reverted: 1 });
    expect(a.at(-1)!.summary).not.toContain(SG1_TX); // ids and counts only
    const out = await decisions(ops);
    expect(out["SG-1001"]).toBe("exception M1.chain.conflicting");
    expect(out["SG-1002"]).toBe("exception M3.batch.unknown_batch");
    const r = reconcile(await withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => loadReconcileInput(tx, ops.orgId, sc.SG.entityId), { read: true }));
    const e = r.exceptions.find((x) => x.orderId === "SG-1001")!;
    expect([e.owner, e.reason.startsWith("Chain data conflicting"), e.nextStep.length > 20]).toEqual(["Payment Operations", true, true]);
  });

  it("when the providers agree again, SG-1001 is re-checked and final again (the conflict is never silently forgotten: it is in the read log)", async () => {
    await verifyChainForEntity(ops, sc.SG.entityId, pairOf(rec(chain()), rec(chain())), { now: later() });
    expect((await decisions(ops))["SG-1001"]).toBe("exception M3.batch.unknown_batch");
    expect((await readsWith("conflicting")).length).toBeGreaterThan(0); // append-only history
  });

  it("REORG: a later read reports SG-1001's final transaction reorged → its fact reverts to not final, audited, and the payment returns to review", async () => {
    const before = (await audits("merchant_chain_final_reverted")).length;
    const base = rec(chain());
    const reorged: VerifyChainClient = {
      mode: "recorded",
      incoming: async (network, address, f, to) => {
        const o = await base.incoming(network, address, f, to);
        if (o.status !== "ok" || !o.transfers.some((x) => x.txHash === SG1_TX)) return o;
        return { ...o, transfers: o.transfers.filter((x) => x.txHash !== SG1_TX), unresolved: [{ txHash: SG1_TX, status: "reorged", reason: "the transaction moved block between reads (reorg)" }] };
      },
      transfer: async (network, h) => (h === SG1_TX ? { status: "reorged", reason: "the transaction moved block between reads (reorg)", transfers: [], evidence: [] } : base.transfer(network, h)),
    };
    const res = await verifyChainForEntity(ops, sc.SG.entityId, reorged, { now: later() });
    expect(res.reverted).toBe(1);
    const f1 = (await allFacts()).find((f) => f.txHash === SG1_TX)!;
    expect(f1.finalised).toBe(false);
    expect((await audits("merchant_chain_final_reverted")).length).toBe(before + 1);
    expect((await readsWith("reorged")).some((r) => r.txHash === SG1_TX)).toBe(true);
    expect((await decisions(ops))["SG-1001"]).toBe("suggested_for_review M1.finality.pending");
    // the next clean read re-checks it and finalises it again
    await verifyChainForEntity(ops, sc.SG.entityId, pairOf(rec(chain()), rec(chain())), { now: later() });
    expect((await decisions(ops))["SG-1001"]).toBe("exception M3.batch.unknown_batch");
  });

  it("SECURITY: a 'conflicting' read is append-only like every chain read; an unknown status is refused by the database", async () => {
    const { sql } = await import("drizzle-orm");
    const as = (q: ReturnType<typeof sql>) => withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(q));
    await expect(as(sql`update chain_reads set status = 'ok' where org_id = ${s.orgs.a} and status = 'conflicting'`)).rejects.toThrow();
    await expect(as(sql`insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at) values (${s.orgs.a}, ${sc.SG.entityId}, 'tron', ${"e".repeat(64)}, 'disputed', 'recording', now())`)).rejects.toThrow();
  });
});
