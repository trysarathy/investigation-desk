/**
 * Phase 0.5: the blind test's breakdown — for every payment that did not auto-match, the rule and the specific condition
 * that failed, counted by reason and per entity. Two sources:
 *
 *   db      — what the browser blind test left in its database (run right after `npm run e2e:blind`, with
 *             DATABASE_URL = the runtime login of that database). Read only, through the blind merchant's Finance
 *             member and row-level security, exactly as tests/e2e-merchant/blind-judge.ts reads it; the stored
 *             decisions are checked against what the engine computes from the stored input.
 *   memory  — the same month handed to the engine in memory the way shape D's files give it
 *             (tests/fixtures/synthetic/blind-input.ts), totals only and with a per-payment settlement file.
 *
 * Usage:
 *   DATABASE_URL=postgres://clearline_runtime:…@127.0.0.1:54329/<blind db> npx tsx --conditions=react-server scripts/blind/breakdown.ts db
 *   npx tsx scripts/blind/breakdown.ts memory
 * Prints Markdown (for docs/release/BLIND_BREAKDOWN_*.md). Synthetic, fictional data only; prints counts, never IDs.
 */
import { merchant } from "../../src/lib/clearline";
import { computeTruth, monthWorld, transferKey, type SyntheticWorld } from "../../src/lib/clearline/synthetic";
import type { MatchRecord, ReconcileInput } from "../../src/lib/clearline/merchant";
import { blindInput, perPaymentLines } from "../../tests/fixtures/synthetic/blind-input";
import { breakdownOf, isAutoMatched, renderBreakdown, type Breakdown } from "./reasons";

/** Closed (matched / with difference) although the truth does not close it that way, or with a transfer not the order's. */
export function wrongMatches(world: SyntheticWorld, records: readonly MatchRecord[]): string[] {
  const truth = computeTruth(world);
  const tOf = new Map(truth.orders.map((o) => [o.orderId, o]));
  const out: string[] = [];
  for (const r of records) {
    if (!isAutoMatched(r)) continue;
    const t = tOf.get(r.orderId);
    const ok = new Set(t?.correctTransferKeys ?? []);
    if (!t || t.decision !== r.explanation.decision || r.chain.transfers.some((x) => !ok.has(transferKey(x)))) out.push(r.orderId);
  }
  return out;
}

/** Bank evidence levels on the records, when the engine records them (absent before the evidence split). */
function evidenceCounts(records: readonly MatchRecord[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of records) {
    const lvl = (r.bank as { evidence?: string }).evidence ?? "(not recorded)";
    const k = `${r.explanation.decision} · ${lvl}`;
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}

function section(title: string, world: SyntheticWorld, inputs: ReconcileInput[]): string {
  const ents: { entityId: string; b: Breakdown }[] = [];
  const all: MatchRecord[] = [];
  const ev: Record<string, number> = {};
  for (const i of inputs) {
    const recs = merchant.reconcile(i).records;
    all.push(...recs);
    ents.push({ entityId: i.entity.id, b: breakdownOf(recs) });
    for (const [k, v] of Object.entries(evidenceCounts(recs))) ev[k] = (ev[k] ?? 0) + v;
  }
  const wrong = wrongMatches(world, all);
  return [renderBreakdown(title, ents), `Wrong matches against the generator's truth: **${wrong.length}**.`, "",
    "Decision · bank evidence level:", "", ...Object.entries(ev).sort().map(([k, v]) => `- ${k}: ${v}`), ""].join("\n");
}

export function memoryReport(): string {
  const world = monthWorld({ seed: 20_261_100, month: "2026-10" });
  const totals = world.entitySpecs.map((e) => blindInput(world, e.id));
  const perPayment = totals.map((i) => ({ ...i, settlementPaymentLines: perPaymentLines(world, i) }));
  const unconfirmed = world.entitySpecs.map((e) => blindInput(world, e.id, { secondPersonConfirmed: false })).map((i) => ({ ...i, settlementPaymentLines: perPaymentLines(world, i) }));
  const flag = (xs: ReconcileInput[]) => xs.map((i) => ({ ...i, policy: { ...i.policy, allowImportedBankLinesAsVerified: true } }));
  return [
    "## In memory (engine only): the blind month as shape D's files give it", "",
    section("Totals-only settlement (as the browser test), flag off", world, totals),
    section("Totals-only settlement, flag on (check only)", world, flag(totals)),
    section("+ per-payment settlement file, statement confirmed by a second person, flag off", world, perPayment),
    section("+ per-payment settlement file, flag on (check only)", world, flag(perPayment)),
    section("+ per-payment settlement file, statement NOT confirmed by a second person, flag off", world, unconfirmed),
  ].join("\n");
}

async function dbReport(): Promise<string> {
  const { database, closeDatabase } = await import("../../src/server/db/client");
  const t = await import("../../src/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const { resolveTenant, withTenant } = await import("../../src/server/tenant");
  const { loadReconcileInput } = await import("../../src/server/merchant-store");
  const { BLIND, blindWorld } = await import("../../tests/e2e-merchant/blind-world");
  try {
    const { world } = blindWorld();
    const db = database();
    const [fin] = await db.select().from(t.users).where(eq(t.users.email, BLIND.users[0][0]));
    if (!fin) throw new Error("no blind merchant in this database: run npm run e2e:blind first");
    const ctx = await resolveTenant({ userId: fin.id, name: fin.name, email: fin.email }, BLIND.org.slug);
    const read = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
    const stored = await read((tx) => tx.select().from(t.matchRecords).where(eq(t.matchRecords.orgId, ctx.orgId)));
    const storedOf = new Map(stored.map((m) => [m.orderId, m]));
    // the STORED records (what the run wrote), so a later engine change never alters what this reads
    const ents: { entityId: string; b: Breakdown }[] = [];
    const all: MatchRecord[] = [];
    const ev: Record<string, number> = {};
    const flags: string[] = [];
    let storedDiffers = 0;
    for (const e of world.entitySpecs) {
      const input = await read((tx) => loadReconcileInput(tx, ctx.orgId, e.id));
      flags.push(`${e.id} ${input.policy.allowImportedBankLinesAsVerified ? "on" : "off"}`);
      const orderIds = new Set(input.invoices.map((i) => i.orderId));
      const recs = stored.filter((m) => orderIds.has(m.orderId)).map((m) => {
        const x = m.explanation as MatchRecord["explanation"] & { attention: MatchRecord["attention"] | null };
        return { orderId: m.orderId, chain: m.chain, bank: m.bank, explanation: x, ...(x.attention ? { attention: x.attention } : {}) } as unknown as MatchRecord;
      });
      for (const r of merchant.reconcile(input).records) {
        const s = storedOf.get(r.orderId);
        if (!s || s.decision !== r.explanation.decision || s.ruleId !== r.explanation.ruleId) storedDiffers++;
      }
      all.push(...recs);
      ents.push({ entityId: e.id, b: breakdownOf(recs) });
      for (const [k, v] of Object.entries(evidenceCounts(recs))) ev[k] = (ev[k] ?? 0) + v;
    }
    const wrong = wrongMatches(world, all);
    return ["## Browser blind test (`npm run e2e:blind`), its database read afterwards", "",
      `Imported-bank-line flag at read time: ${flags.join(", ")}. Stored decisions that differ from what the engine in this checkout computes from the stored input: ${storedDiffers}.`, "",
      renderBreakdown("As stored after the run (final state: flag off again)", ents), `Wrong matches against the generator's truth: **${wrong.length}**.`, "",
      "Decision · bank evidence level:", "", ...Object.entries(ev).sort().map(([k, v]) => `- ${k}: ${v}`), ""].join("\n");
  } finally { await closeDatabase(); }
}

const isMain = process.argv[1]?.endsWith("breakdown.ts");
if (isMain) {
  const mode = process.argv[2];
  (mode === "db" ? dbReport() : mode === "memory" ? Promise.resolve(memoryReport()) : Promise.reject(new Error("usage: breakdown.ts db|memory")))
    .then((s) => process.stdout.write(`${s}\n`)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
