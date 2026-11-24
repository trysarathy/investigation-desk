/**
 * v1 Phase 0 (approval-only draft): blind-test style numbers for the per-payment settlement file, in memory (the engine
 * only, not the browser journey). The data is the rc7 blind test's month (seed 20261100, 2026-10, 2,000 orders, two
 * entities), handed to the engine the way shape D's files give it: no quote terms, the provider's claimed statuses,
 * chain facts read by Clearline's client, settlement as batch totals only and imported bank lines. "After" adds one
 * per-payment settlement row per payment of each batch (fee allocated per payment so the rows sum to the batch's fee).
 * Asserted: zero wrong matches everywhere, nothing closes with the imported-bank-line flag off, every closure is one
 * the generator's truth closes. The table is printed for the report (run with --silent=false). A batch with refunds
 * cannot tie from per-payment rows alone (they name no refund), so its exact payments become M5.batch.not_tied
 * exceptions instead of proposed groupings: stricter, never looser. Synthetic · fictional data.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { bpsOf, type ReconcileInput, type SettlementPaymentLine } from "@/lib/clearline/merchant";
import { computeTruth, monthWorld, smallWorld, toReconcileInput, transferKey, type SyntheticWorld } from "@/lib/clearline/synthetic";

const CLOSING = new Set(["matched", "matched_with_difference"]);

/** Shape-D-like input: what the blind test's files give the engine. */
function blindInput(world: SyntheticWorld, entityId: string): ReconcileInput {
  const i = toReconcileInput(world, entityId);
  return {
    ...i,
    quotes: i.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })),
    paymentLinks: i.paymentLinks.map((l) => ({ ...l, windowUnknown: true as const, requestedUnknown: true as const })),
    transfers: i.transfers.map((t) => ({ ...t, source: "chain_client" as const })),
    // the export gives the currency it credited in (shape D does; rc8 decision 1 needs it)
    providerRecords: i.providerRecords.map((r) => ({ ...r, creditedCurrency: i.entity.functionalCurrency })),
    batchLines: [],
    bankLines: i.bankLines.map((b) => ({ ...b, source: "csv_import" as const })),
  };
}

/** One row per payment of each batch (the generator's own settlement), its fee allocated so the rows sum to the batch fee. */
function perPaymentLines(world: SyntheticWorld, input: ReconcileInput): SettlementPaymentLine[] {
  const out: SettlementPaymentLine[] = [];
  for (const b of input.batches) {
    const pays = world.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "payment").sort((x, y) => (x.providerPaymentId! < y.providerPaymentId! ? -1 : 1));
    let left = b.feesMinor;
    pays.forEach((p, k) => {
      const fee = k === pays.length - 1 ? left : bpsOf(p.amountMinor, world.providerFeeBps);
      left -= fee;
      out.push({ batchId: b.batchId, providerPaymentId: p.providerPaymentId!, orderId: p.orderId, currency: b.currency, grossMinor: p.amountMinor, feeMinor: fee, netMinor: p.amountMinor - fee, settlementDate: b.providerDay });
    });
  }
  return out;
}

interface Row { payments: number; matched: number; withDifference: number; review: number; exception: number; wrong: number; closedNotTruth: number; rules: Record<string, number> }
function measure(world: SyntheticWorld, inputs: ReconcileInput[]): Row {
  const truth = computeTruth(world);
  const tOf = new Map(truth.orders.map((o) => [o.orderId, o]));
  const row: Row = { payments: 0, matched: 0, withDifference: 0, review: 0, exception: 0, wrong: 0, closedNotTruth: 0, rules: {} };
  for (const input of inputs) {
    for (const r of merchant.reconcile(input).records) {
      row.payments++;
      const d = r.explanation.decision;
      if (d === "matched") row.matched++; else if (d === "matched_with_difference") row.withDifference++; else if (d === "suggested_for_review") row.review++; else row.exception++;
      row.rules[`${d} ${r.explanation.ruleId}`] = (row.rules[`${d} ${r.explanation.ruleId}`] ?? 0) + 1;
      const t = tOf.get(r.orderId)!;
      if (!CLOSING.has(d)) continue;
      // a wrong match: closed although the truth does not close it this way, or with a transfer that is not the order's
      const ok = new Set(t.correctTransferKeys);
      if (t.decision !== d || r.chain.transfers.some((x) => !ok.has(transferKey(x)))) row.wrong++;
      if (!CLOSING.has(t.decision)) row.closedNotTruth++;
    }
  }
  return row;
}
const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(2)} %`;
function table(label: string, rows: [string, Row][]) {
  const lines = [`${label}`, "| variant | payments | auto-match (matched + with difference) | review | exception | wrong matches |", "|---|---|---|---|---|---|"];
  for (const [name, r] of rows) lines.push(`| ${name} | ${r.payments} | ${r.matched + r.withDifference} (${pct(r.matched + r.withDifference, r.payments)}) | ${r.review} (${pct(r.review, r.payments)}) | ${r.exception} (${pct(r.exception, r.payments)}) | ${r.wrong} |`);
  console.log(lines.join("\n"));
}

function variants(world: SyntheticWorld): [string, Row][] {
  const before = world.entitySpecs.map((e) => blindInput(world, e.id));
  const after = before.map((i) => ({ ...i, settlementPaymentLines: perPaymentLines(world, i) }));
  const flag = (xs: ReconcileInput[]) => xs.map((i) => ({ ...i, policy: { ...i.policy, allowImportedBankLinesAsVerified: true } }));
  return [
    ["before: totals only, flag off (default)", measure(world, before)],
    ["before: totals only, flag on (check only)", measure(world, flag(before))],
    ["after: + per-payment file, flag off (default)", measure(world, after)],
    ["after: + per-payment file, flag on (check only)", measure(world, flag(after))],
  ];
}

describe("per-payment settlement: blind-test style numbers (in memory)", () => {
  for (const [name, make] of [["small preset, seed 40", () => smallWorld()], ["rc7 blind month, seed 20261100, 2026-10", () => monthWorld({ seed: 20_261_100, month: "2026-10" })]] as const) {
    it(`${name}: zero wrong matches; nothing closes with the flag off; every closure is one the truth closes`, () => {
      const world = make();
      const rows = variants(world);
      table(name, rows);
      for (const [v, r] of rows) {
        expect(r.wrong, v).toBe(0);
        expect(r.closedNotTruth, v).toBe(0);
      }
      const [beforeOff, beforeOn, afterOff, afterOn] = rows.map(([, r]) => r);
      // flag off: imported bank lines never verify settlement, before or after
      expect(beforeOff.matched + beforeOff.withDifference).toBe(0);
      expect(afterOff.matched + afterOff.withDifference).toBe(0);
      // before, the flag changes nothing (no payment is linked to a batch), as in the rc7 blind test
      expect(beforeOn.matched + beforeOn.withDifference).toBe(0);
      // after, with the flag on (a check only), exact payments in tied batches close
      expect(afterOn.matched).toBeGreaterThan(0);
      expect(afterOn.rules["matched M5.batch.tied_verified"]).toBe(afterOn.matched);
      expect(beforeOff.payments).toBe(afterOff.payments);
    });
  }
});
