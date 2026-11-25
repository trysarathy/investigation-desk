/**
 * v1 phase 3: `npm run bench:volume` — reconciliation at the v1 volume target, against PostgreSQL, on synthetic
 * (fictional) data only. Per repetition, a fresh LIVE benchmark organisation (the generator's two entities, SGD and
 * USD) is seeded with one month (default 100,000 payments and about 5,000 bank lines), then:
 *   1. initial      — the month up to its last day is stored and reconciled (every payment decided for the first time)
 *   2. daily        — the last day is stored and the month reconciled again (the daily incremental run)
 *   3. full month   — the whole month is re-decided under a new rule-set version (every payment re-decided and
 *                     re-written): the "full month reconciliation"
 * Chain transfers are not stored from the world: as for any live merchant, they are facts the run's chain verification
 * reads (here from the recorded synthetic chain data, offline). Each run includes that verification, loading the rows,
 * the engine and every write. Prints one JSON line per repetition and the medians; deletes each organisation after
 * (unless --keep). Targets: full month < 5 min, daily < 60 s.
 *   DATABASE_URL=<runtime login> CLEARLINE_BENCH_OWNER_URL=<owner login> npm run bench:volume [-- --payments 100000 --bank-lines 5000 --reps 3]
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import * as t from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { closeDatabase } from "../../src/server/db/client";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { runReconciliation } from "../../src/server/merchant";
import { writeIngested, type IngestParts } from "../../src/server/merchant-store";
import { deleteMerchant } from "../../src/server/merchant-deletion";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { toEnginePolicy, type SyntheticWorld } from "../../src/lib/clearline/synthetic";
import { VOLUME_TARGET, volumeWorld } from "./volume";
import { dbDigest } from "./db-digest";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
export const TARGETS_MS = { fullMonth: 5 * 60_000, daily: 60_000 } as const;
const CHUNK = 2_000;

/** One entity's parts of the world, split at a UTC day: what was known before it, and what arrived on it. */
export function splitAt(w: SyntheticWorld, entityId: string, cutDay: string): [IngestParts, IngestParts] {
  const spec = w.entitySpecs.find((e) => e.id === entityId)!;
  const cur = w.entities.find((e) => e.id === entityId)!.functionalCurrency;
  const firstQuote = new Map<string, string>();
  for (const q of w.quotes) if (!firstQuote.has(q.orderId) || q.createdAt < firstQuote.get(q.orderId)!) firstQuote.set(q.orderId, q.createdAt);
  const late = (orderId: string) => (firstQuote.get(orderId) ?? "").slice(0, 10) >= cutDay;
  const orders = w.orders.filter((o) => o.entityId === entityId);
  const pidOrder = new Map(w.paymentMeta.map((m) => [m.providerPaymentId, m]));
  const batchIds = new Set(w.batches.filter((b) => b.targetBankAccount === spec.bankAccountId).map((b) => b.batchId));
  const parts = (second: boolean): IngestParts => {
    const keepOrder = (id: string) => late(id) === second;
    const mine = new Set(orders.filter((o) => keepOrder(o.orderId)).map((o) => o.orderId));
    return {
      invoices: orders.filter((o) => mine.has(o.orderId)).map((o) => o.invoice),
      quotes: w.quotes.filter((q) => mine.has(q.orderId)),
      paymentLinks: w.paymentLinks.filter((l) => mine.has(l.orderId)),
      providerRecords: w.providerRecords.filter((r) => { const m = pidOrder.get(r.providerPaymentId); return m?.entityId === entityId && mine.has(m.orderId); }),
      batches: w.batches.filter((b) => batchIds.has(b.batchId) && (b.providerDay >= cutDay) === second),
      batchLines: w.batchLines.filter((l) => batchIds.has(l.batchId) && (w.batches.find((b) => b.batchId === l.batchId)!.providerDay >= cutDay) === second),
      bankLines: w.bankLines.filter((l) => l.account === spec.bankAccountId && (l.valueDate >= cutDay) === second),
      ...(second ? {} : { fxRates: w.fxRates.filter((r) => r.pair.endsWith(`/${cur}`)), addressFacts: w.addressFacts }),
    };
  };
  return [parts(false), parts(true)];
}

/** Store parts in chunks (each chunk in its own owner transaction, as a pipeline would). */
async function store(owner: Db, orgId: string, entityId: string, p: IngestParts) {
  const keys = Object.keys(p) as (keyof IngestParts)[];
  // dependencies first: quotes before links, invoices and quotes of one chunk together
  const orderIds = [...new Set((p.invoices ?? []).map((i) => i.orderId))];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const ids = new Set(orderIds.slice(i, i + CHUNK));
    await owner.transaction((tx) => writeIngested(tx, orgId, entityId, {
      invoices: p.invoices!.filter((x) => ids.has(x.orderId)), quotes: (p.quotes ?? []).filter((x) => ids.has(x.orderId)), paymentLinks: (p.paymentLinks ?? []).filter((x) => ids.has(x.orderId)),
    }, { chainSource: "recorded_fixture" }));
  }
  for (const k of keys) {
    if (k === "invoices" || k === "quotes" || k === "paymentLinks" || k === "batchLines") continue;
    const rows = (p[k] ?? []) as unknown[];
    for (let i = 0; i < rows.length; i += CHUNK) await owner.transaction((tx) => writeIngested(tx, orgId, entityId, { [k]: rows.slice(i, i + CHUNK) } as IngestParts, { chainSource: "recorded_fixture" }));
  }
  // after the batches: a batch's lines are numbered within one call: every batch goes whole into one call
  const byBatch = new Map<string, NonNullable<IngestParts["batchLines"]>>();
  for (const l of p.batchLines ?? []) byBatch.set(l.batchId, [...(byBatch.get(l.batchId) ?? []), l]);
  for (const lines of byBatch.values()) await owner.transaction((tx) => writeIngested(tx, orgId, entityId, { batchLines: lines }, { chainSource: "recorded_fixture" }));
}

export interface VolumeRep { payments: number; bankLines: number; ingestMs: number; initialMs: number; dailyMs: number; fullMonthMs: number; records: number; decisions: Record<string, number>; dailyPayments: number; stages: Record<string, Record<string, number>>; digests?: Record<string, unknown> }

export async function runVolumeRep(owner: Db, world: SyntheticWorld, opts: { keep?: boolean; digest?: boolean } = {}): Promise<VolumeRep> {
  const slug = `vol-${randomUUID().slice(0, 8)}`;
  const orgId = await createOrganization(owner, { slug, name: `Volume ${slug} (synthetic)`, seed: "empty", dataMode: "live" });
  let ops: TenantContext;
  try {
    for (const e of world.entities) {
      const p = toEnginePolicy(world.policy, e.functionalCurrency);
      await owner.insert(t.merchantEntities).values({ orgId, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger: "xero", timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
      await owner.insert(t.merchantPolicy).values({ orgId, entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
        approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString() });
    }
    const email = `ops@${slug}.example`;
    const uid = await createUser(owner, { email, name: "Payment Operations (synthetic)", password: `vol-${randomUUID()}` });
    await grantMembership(owner, { orgSlug: slug, email, role: "payment_ops" });
    ops = await resolveTenant({ userId: uid, name: email, email }, slug);

    const days = [...new Set(world.transfers.map((x) => x.timestamp.slice(0, 10)))].sort();
    const cut = days[days.length - 1];
    const splits = new Map(world.entitySpecs.map((e) => [e.id, splitAt(world, e.id, cut)]));
    const chain = () => new RecordingChainClient(recordingOf(world.transfers), { now: world.asOf });
    const n = { k: 0 };
    const key = () => `vol-${slug}-${++n.k}`;
    const timed = async (fn: () => Promise<unknown>) => { const t0 = performance.now(); await fn(); return performance.now() - t0; };
    const decisions: Record<string, number> = {};
    let records = 0;
    const stages: Record<string, Record<string, number>> = {};
    const runAll = async (version?: string, label = version ? "fullMonth" : "run") => {
      const timings = (stages[label] ??= {});
      for (const e of world.entitySpecs) {
        const r = (await runReconciliation(ops, e.id, key(), { chain: chain(), timings, ...(version ? { ruleSetVersion: version } : {}) })).body;
        if (version) { records += r.records ?? 0; for (const [k, v] of Object.entries(r.runCounts ?? {})) decisions[k] = (decisions[k] ?? 0) + v; }
      }
    };
    let ingestMs = 0;
    ingestMs += await timed(async () => { for (const [id, [before]] of splits) await store(owner, orgId, id, before); });
    const digests: Record<string, unknown> = {};
    const digest = async (label: string) => { if (opts.digest) digests[label] = await dbDigest(owner, orgId, `volume-bench#${slug}`); };
    const initialMs = await timed(() => runAll(undefined, "initial"));
    await digest("initial");
    ingestMs += await timed(async () => { for (const [id, [, after]] of splits) await store(owner, orgId, id, after); });
    const dailyMs = await timed(() => runAll(undefined, "daily"));
    await digest("daily");
    const fullMonthMs = await timed(() => runAll(`volume-bench#${slug}`));
    await digest("fullMonth");
    const dailyPayments = [...splits.values()].reduce((s, [, a]) => s + (a.invoices?.length ?? 0), 0);
    return { payments: world.orders.length, bankLines: world.bankLines.length, ingestMs, initialMs, dailyMs, fullMonthMs, records, decisions, dailyPayments, stages, ...(opts.digest ? { digests } : {}) };
  } finally {
    if (!opts.keep) await deleteMerchant(owner, slug, slug);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const ownerUrl = process.env.CLEARLINE_BENCH_OWNER_URL ?? process.env.CLEARLINE_TEST_OWNER_URL;
  process.env.DATABASE_URL ??= process.env.CLEARLINE_TEST_RUNTIME_URL;
  if (!ownerUrl || !process.env.DATABASE_URL) throw new Error("set DATABASE_URL (runtime login) and CLEARLINE_BENCH_OWNER_URL (owner login) to a migrated database");
  const pool = new Pool({ connectionString: ownerUrl });
  const owner = drizzle(pool, { schema }) as Db;
  try {
    const t0 = performance.now();
    const world = volumeWorld({ payments: Number(arg("payments") ?? VOLUME_TARGET.payments), bankLines: Number(arg("bank-lines") ?? VOLUME_TARGET.bankLines), seed: Number(arg("seed") ?? 20_261_001) });
    process.stdout.write(`${JSON.stringify({ event: "generated", ms: Math.round(performance.now() - t0), payments: world.orders.length, bankLines: world.bankLines.length })}\n`);
    const reps: VolumeRep[] = [];
    for (let i = 0; i < Number(arg("reps") ?? 3); i++) {
      const r = await runVolumeRep(owner, world, { keep: process.argv.includes("--keep"), digest: process.argv.includes("--digest") });
      reps.push(r);
      process.stdout.write(`${JSON.stringify({ event: "rep", rep: i + 1, ...r, ingestMs: Math.round(r.ingestMs), initialMs: Math.round(r.initialMs), dailyMs: Math.round(r.dailyMs), fullMonthMs: Math.round(r.fullMonthMs) })}\n`);
    }
    const m = { fullMonthMs: median(reps.map((r) => r.fullMonthMs)), dailyMs: median(reps.map((r) => r.dailyMs)), initialMs: median(reps.map((r) => r.initialMs)), ingestMs: median(reps.map((r) => r.ingestMs)) };
    process.stdout.write(`${JSON.stringify({ event: "median", reps: reps.length, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)])) })}\n`);
    process.stdout.write(`full month: ${(m.fullMonthMs / 1000).toFixed(1)} s (target ${TARGETS_MS.fullMonth / 1000} s: ${m.fullMonthMs <= TARGETS_MS.fullMonth ? "met" : "MISSED"}); daily: ${(m.dailyMs / 1000).toFixed(1)} s (target ${TARGETS_MS.daily / 1000} s: ${m.dailyMs <= TARGETS_MS.daily ? "met" : "MISSED"})\n`);
    if (m.fullMonthMs > TARGETS_MS.fullMonth || m.dailyMs > TARGETS_MS.daily) process.exitCode = 3;
  } finally {
    await pool.end();
    await closeDatabase();
  }
}
if (/volume-bench\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? (process.env.BENCH_DEBUG ? e.stack : e.message) : String(e)}\n`); process.exitCode = 1; });
