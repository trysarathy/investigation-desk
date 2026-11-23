/**
 * rc7 phase 2: verifying uploaded payments against CHAIN data, against PostgreSQL 16. A provider file's tx hash is
 * only a claim; the verify step reads the chain through a recorded client (never the network in tests), stores what
 * the chain says as facts with evidence, records reads that fail, and the engine reconciles on chain facts only.
 * Every value is fictional.
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
import { runReconciliation } from "../../src/server/merchant";
import { verifyChainForEntity, verifyClientFromEnv } from "../../src/server/chain-verify";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile } from "../../src/lib/clearline/merchant";
import { RecordingChainClient, recordingOf, type VerifyChainClient } from "../../src/lib/clearline/merchant/chain";
import type { ChainTransfer } from "../../src/lib/clearline/merchant/types";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `cv-key-${++n}-${Date.now()}`;
const NOW = new Date("2026-11-21T00:00:00.000Z");

async function pipeline(c: TenantContext, entityId: string, fileType: "orders_invoices" | "provider_export", fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const up = await createUpload(c, { entityId, fileType, fileName, bytes }, key());
  await setUploadMapping(c, up.upload.id, { mapping }, key());
  const v = (await validateUpload(c, up.upload.id, key())).body;
  await decideUpload(c, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  await normaliseUpload(c, up.upload.id, key());
}
const decisions = async (c: TenantContext, entityId: string) => {
  const input = await withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => loadReconcileInput(tx, c.orgId, entityId), { read: true });
  return { input, out: Object.fromEntries(reconcile(input).records.map((r) => [r.orderId, `${r.explanation.decision} ${r.explanation.ruleId}`])) };
};
/** SG chain data as recorded: the three payments a reader saw, and SG-1004's transfer with `conf` confirmations. */
const chainOf = (conf: number): ChainTransfer[] => {
  const seen = sc.observedTransfers(sc.SG);
  const o4 = sc.SG.orders[3];
  return [...seen, { ...seen[0], txHash: sc.hash(o4.payment!.txIndex), to: o4.address, amountBaseUnits: 500_000_000n, block: 70_100, timestamp: o4.payment!.paidAt, confirmations: conf }];
};
const client = (conf: number, unavailable: { network: "tron"; address?: string; txHash?: string; reason: string }[] = []) => new RecordingChainClient(recordingOf(chainOf(conf)), { now: NOW.toISOString(), unavailable });
/** Counts each call; optionally answers the second read of a transaction from another block (a reorg). */
function counting(inner: VerifyChainClient, reorgOnSecondRead = false) {
  const calls = { incoming: 0, transfer: 0 };
  const seen = new Map<string, number>();
  const c: VerifyChainClient = {
    mode: "recorded",
    incoming: (...a) => { calls.incoming++; return inner.incoming(...a); },
    transfer: async (network, h) => {
      calls.transfer++;
      const o = await inner.transfer(network, h);
      const k = (seen.get(h) ?? 0) + 1;
      seen.set(h, k);
      return reorgOnSecondRead && k >= 2 && o.status === "ok" ? { ...o, transfers: o.transfers.map((x) => ({ ...x, blockNumber: x.blockNumber + 1n })) } : o;
    },
  };
  return { c, calls };
}

let ops: TenantContext, fin: TenantContext, finB: TenantContext;
beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  [ops, fin, finB] = await Promise.all([liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "finance@live-a.example", "a"), liveCtx(s, "finance@live-b.example", "b")]);
  await pipeline(fin, sc.SG.entityId, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING);
  await pipeline(ops, sc.SG.entityId, "provider_export", "export.csv", sc.sgExportCsv(), sc.SG_EXPORT_MAPPING);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("verifyChainForEntity", () => {
  it("before any chain read, every claimed payment is 'chain data unavailable' (an exception with owner, reason and next step), never matched", async () => {
    const { input, out } = await decisions(ops, sc.SG.entityId);
    expect(input.transfers).toEqual([]); // provider claims are not chain facts
    expect(Object.values(out)).toEqual(Array(4).fill("exception M1.chain.unavailable"));
    const r = reconcile(input);
    for (const e of r.exceptions) expect([e.owner, e.reason.length > 10, e.nextStep.length > 10]).toEqual(["Payment Operations", true, true]);
  });

  it("stores chain facts with evidence; an unavailable address is recorded and only its order waits; the rest reconcile", async () => {
    const down = sc.SG.orders[2].address;
    const res = await verifyChainForEntity(ops, sc.SG.entityId, client(5, [{ network: "tron", address: down, reason: "recorded outage (HTTP 503)" }]), { now: NOW });
    expect(res).toMatchObject({ mode: "recorded", addresses: 4, facts: 4, final: 3, pending: 1, unavailable: 1 });
    const facts = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "chain_client")));
    expect(facts).toHaveLength(4);
    for (const f of facts) {
      expect(f).toMatchObject({ entityId: sc.SG.entityId, evidenceSource: "recording", evidenceHost: "recorded-fixture", fetchedAt: NOW, uploadId: null });
      expect(f.evidenceEndpoint).toMatch(/^recording\//);
    }
    expect(facts.filter((f) => f.finalised).length).toBe(3);
    // the provider's claims are untouched: unconfirmed and not final
    const claims = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "provider_export")));
    expect(claims.map((c) => [c.confirmations, c.finalised])).toEqual(Array(4).fill([0, false]));
    const reads = await ownerDb().select().from(t.chainReads).where(and(eq(t.chainReads.orgId, s.orgs.a), eq(t.chainReads.status, "unavailable")));
    expect(reads.map((r) => [r.network, r.address, r.txHash, r.source, r.reason])).toEqual([["tron", down, null, "recording", "recorded outage (HTTP 503)"]]);
    const { out } = await decisions(ops, sc.SG.entityId);
    expect(out).toEqual({
      "SG-1001": "exception M3.batch.unknown_batch", // chain-verified; the export names batch B-SG-1102, and no settlement report is uploaded here
      "SG-1002": "exception M3.batch.unknown_batch",
      "SG-1003": "exception M1.chain.unavailable", // its deposit address could not be read: nothing is treated as received or missing
      "SG-1004": "suggested_for_review M1.finality.pending", // seen on chain, 5 of 19 confirmations
    });
  });

  it("a second run reads final transactions from the cache, finalises the pending one after a re-check, and is idempotent", async () => {
    const { c, calls } = counting(client(50));
    const res = await verifyChainForEntity(ops, sc.SG.entityId, c, { now: new Date(NOW.getTime() + 3_600_000) });
    // 4 address listings; claimed transactions: SG-1001..1003 are stored final (SG-1003 was read by hash while its
    // address was down) and come from the cache; SG-1004 is read, then read again before it is stored as final
    expect(res).toMatchObject({ addresses: 4, cached: 3, transactions: 1, unavailable: 0 });
    expect(calls).toEqual({ incoming: 4, transfer: 2 });
    const { out } = await decisions(ops, sc.SG.entityId);
    expect(out).toMatchObject({ "SG-1003": "exception M4.tolerance.underpayment_beyond_band", "SG-1004": "suggested_for_review M5.grouping.proposed_needs_confirmation" });
    const before = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "chain_client")));
    await verifyChainForEntity(ops, sc.SG.entityId, client(50), { now: new Date(NOW.getTime() + 7_200_000) });
    const after = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "chain_client")));
    expect(after.map((x) => [x.txHash, x.logIndex, x.amountBaseUnits, x.finalised])).toEqual(before.map((x) => [x.txHash, x.logIndex, x.amountBaseUnits, x.finalised]));
    expect((await decisions(ops, sc.SG.entityId)).out).toEqual(out);
  });

  it("a fact whose block moves on the re-check before finalising stays not final (reorg), and its read is recorded", async () => {
    await ownerDb().execute(sql`update chain_transfers set finalised = false, confirmations = 5 where org_id = ${s.orgs.a} and source = 'chain_client' and tx_hash = ${sc.hash(4)}`);
    const { c } = counting(client(50), true);
    await verifyChainForEntity(ops, sc.SG.entityId, c, { now: new Date(NOW.getTime() + 9_000_000) });
    const [f] = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.a), eq(t.chainTransfers.source, "chain_client"), eq(t.chainTransfers.txHash, sc.hash(4))));
    expect(f.finalised).toBe(false);
    const reorg = await ownerDb().select().from(t.chainReads).where(and(eq(t.chainReads.orgId, s.orgs.a), eq(t.chainReads.status, "reorged")));
    expect(reorg.length).toBeGreaterThan(0);
    expect((await decisions(ops, sc.SG.entityId)).out["SG-1004"]).toBe("suggested_for_review M1.finality.pending");
    await verifyChainForEntity(ops, sc.SG.entityId, client(50), { now: new Date(NOW.getTime() + 9_600_000) });
    expect((await decisions(ops, sc.SG.entityId)).out["SG-1004"]).toBe("suggested_for_review M5.grouping.proposed_needs_confirmation"); // final; no batch ID, so only a proposed grouping
  });

  it("runReconciliation verifies a live organisation first (audited, ids and counts only)", async () => {
    const r = (await runReconciliation(ops, sc.SG.entityId, key(), { chain: client(50) })).body;
    expect(r).toMatchObject({ records: 4 });
    const audit = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), eq(t.auditEvents.action, "merchant_chain_verified")));
    expect(audit.length).toBeGreaterThanOrEqual(5);
    expect(audit.at(-1)!.summary).toMatch(/^Chain verified \(recorded\): 4 address\(es\)/);
  });

  it("no chain client configured: every read is unavailable, nothing is matched; live reads are refused under tests", async () => {
    expect(verifyClientFromEnv({}).mode).toBe("none");
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_LIVE: "1", VITEST: "true", TRONGRID_API_KEY: "test-placeholder" })).toThrow(/refused in tests and CI/);
    const fresh = await liveCtx(s, "ops@live-a.example", "a");
    const res = await verifyChainForEntity(fresh, sc.SG.entityId, verifyClientFromEnv({}), { now: new Date(Date.now() + 3_600_000) }); // after every earlier read
    expect(res).toMatchObject({ mode: "none", facts: 0, cached: 4, unavailable: 4 }); // the 4 address listings; every claimed transaction is cached final
    const { out } = await decisions(ops, sc.SG.entityId);
    expect(Object.values(out)).toEqual(Array(4).fill("exception M1.chain.unavailable"));
    // a later successful read clears it
    await verifyChainForEntity(fresh, sc.SG.entityId, client(50), { now: new Date(Date.now() + 7_200_000) });
    expect((await decisions(ops, sc.SG.entityId)).out["SG-1001"]).toBe("exception M3.batch.unknown_batch");
  });

  it("SECURITY: chain reads are append-only and tenant-isolated; chain facts stay immutable except confirmations and finality", async () => {
    const as = (c: TenantContext, q: ReturnType<typeof sql>) => withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => tx.execute(q));
    await expect(as(ops, sql`update chain_reads set status = 'ok' where org_id = ${s.orgs.a}`)).rejects.toThrow();
    await expect(as(ops, sql`delete from chain_reads where org_id = ${s.orgs.a}`)).rejects.toThrow();
    expect((await withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => tx.execute(sql`select count(*)::int as n from chain_reads`))).rows[0].n).toBe(0);
    await expect(as(ops, sql`update chain_transfers set amount_base_units = 1 where org_id = ${s.orgs.a} and source = 'chain_client'`)).rejects.toThrow();
    await expect(as(ops, sql`update chain_transfers set finalised = true, confirmations = 99 where org_id = ${s.orgs.a} and source = 'provider_export'`)).rejects.toThrow();
    // a chain_client fact must carry its evidence
    await expect(as(ops, sql`insert into chain_transfers (org_id, network, tx_hash, log_index, token_contract, from_address, to_address, amount_base_units, decimals, block, block_time, confirmations, finalised, source, entity_id)
      values (${s.orgs.a}, 'tron', ${"f".repeat(64)}, 0, ${sc.SG.contract}, 'x', 'y', 1, 6, 1, now(), 1, false, 'chain_client', ${sc.SG.entityId})`)).rejects.toThrow();
  });
});
