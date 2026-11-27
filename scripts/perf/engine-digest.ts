/**
 * v1 phase 3: the engine's results on a fixed synthetic seed, as one digest per entity, to prove an optimisation
 * changes no decision. Pure (no database); synthetic data only. Prints JSON lines with counts, timings and digests.
 *   npx tsx scripts/perf/engine-digest.ts [--payments 100000] [--seed 20261001] [--month 2026-10] [--bank-lines 5000]
 */
import { createHash } from "node:crypto";
import { reconcile } from "../../src/lib/clearline/merchant";
import { stableJson } from "../../src/lib/clearline/merchant/adapters/common";
import { volumeWorld } from "./volume";
import { toReconcileInputs } from "../../src/lib/clearline/synthetic";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const t0 = performance.now();
const world = volumeWorld({ payments: Number(arg("payments", "100000")), seed: Number(arg("seed", "20261001")), month: arg("month", "2026-10"), bankLines: Number(arg("bank-lines", "5000")) });
console.log(JSON.stringify({ event: "generated", ms: Math.round(performance.now() - t0), payments: world.orders.length, bankLines: world.bankLines.length, transfers: world.transfers.length }));
for (const input of toReconcileInputs(world)) {
  const t1 = performance.now();
  const r = reconcile(input);
  const ms = Math.round(performance.now() - t1);
  const digest = createHash("sha256").update(stableJson(r)).digest("hex");
  console.log(JSON.stringify({ event: "reconciled", entityId: input.entity.id, invoices: input.invoices.length, records: r.records.length, exceptions: r.exceptions.length, ms, digest }));
}
