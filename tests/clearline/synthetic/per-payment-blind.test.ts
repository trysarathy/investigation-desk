/**
 * v1 Phase 0 (approval-only draft): blind-test style numbers for the per-payment settlement file, in memory (the engine
 * only, not the browser journey). The data is the rc7 blind test's month (seed 20261100, 2026-10, 2,000 orders, two
 * entities), handed to the engine the way shape D's files give it: no quote terms, the provider's claimed statuses,
 * chain facts read by Clearline's client, settlement as batch totals only and imported bank lines. "After" adds one
 * per-payment settlement row per payment of each batch (fee allocated per payment so the rows sum to the batch's fee).
 * Asserted: zero wrong matches everywhere, every closure is one the generator's truth closes.
 * v1 Phase 0.5 (evidence-level split, decisions 12–16): with the flag off, an exact payment in a tied batch whose bank
 * line is imported is now MATCHED (M5.batch.tied_evidence_separate) instead of staying in review
 * (M5.bank.imported_not_verified); its bank evidence is shown apart. Before this change the test asserted that nothing
 * closes with the flag off; it now asserts exactly which payments the split closes. Totals-only input: exact payments
 * whose provider record names a batch are matched with settlement not linked (M5.grouping.matched_settlement_unlinked);
 * none is settled. The table is printed for the report (run with --silent=false). A batch with refunds
 * cannot tie from per-payment rows alone (they name no refund), so its exact payments become M5.batch.not_tied
 * exceptions instead of proposed groupings: stricter, never looser. Synthetic · fictional data.
 * v1 #174 (A3): refund rows (linked to the original payment by its ID) let those batches tie.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import type { ReconcileInput } from "@/lib/clearline/merchant";
import { computeTruth, monthWorld, smallWorld, transferKey, type SyntheticWorld } from "@/lib/clearline/synthetic";
import { blindInput, perPaymentLines } from "../../fixtures/synthetic/blind-input";

const CLOSING = new Set(["matched", "matched_with_difference"]);

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
  const refunds = before.map((i) => ({ ...i, settlementPaymentLines: perPaymentLines(world, i, true) }));
  const flag = (xs: ReconcileInput[]) => xs.map((i) => ({ ...i, policy: { ...i.policy, allowImportedBankLinesAsVerified: true } }));
  return [
    ["before: totals only, flag off (default)", measure(world, before)],
    ["before: totals only, flag on (check only)", measure(world, flag(before))],
    ["after: + per-payment file, flag off (default)", measure(world, after)],
    ["after: + per-payment file, flag on (check only)", measure(world, flag(after))],
    ["after #174: + per-payment file with refund rows, flag off (default)", measure(world, refunds)],
    ["after #174: + per-payment file with refund rows, flag on (check only)", measure(world, flag(refunds))],
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
      const [beforeOff, beforeOn, afterOff, afterOn, refundOff, refundOn] = rows.map(([, r]) => r);
      // totals only: the grouping is only proposed, so nothing is settled; since v1 Phase 0.5 (decisions 12 and 14) the exact
      // payments whose provider record names a batch are matched with settlement not linked (was: 0 closed). Nothing
      // with a difference closes.
      expect(beforeOff.withDifference).toBe(0);
      expect(beforeOff.rules["matched M5.grouping.matched_settlement_unlinked"] ?? 0).toBe(beforeOff.matched);
      // v1 Phase 0.5: flag off, exact payments in tied batches are matched with their bank evidence shown apart; nothing
      // else closes (a difference in such a batch is still review), and they are exactly the ones the flag would close
      expect(afterOff.withDifference).toBe(0);
      expect(afterOff.rules["matched M5.batch.tied_evidence_separate"]).toBe(afterOff.matched);
      expect(afterOff.rules["suggested_for_review M5.bank.imported_not_verified"] ?? 0).toBe(0);
      expect(afterOff.matched).toBe(afterOn.matched);
      expect(afterOff.exception).toBe(afterOn.exception);
      // before, the flag changes nothing (no payment is linked to a batch), as in the rc7 blind test
      expect([beforeOn.matched, beforeOn.withDifference, beforeOn.review, beforeOn.exception]).toEqual([beforeOff.matched, beforeOff.withDifference, beforeOff.review, beforeOff.exception]);
      // after, with the flag on (a check only), exact payments in tied batches close
      expect(afterOn.matched).toBeGreaterThan(0);
      expect(afterOn.rules["matched M5.batch.tied_verified"]).toBe(afterOn.matched);
      expect(beforeOff.payments).toBe(afterOff.payments);
      // #174: refund rows let the batches with refunds tie. Flag off, the evidence split (Phase 0.5) closes exactly the
      // payments the flag would close, nothing with a difference; with the flag on never fewer closures nor more
      // exceptions than without refund rows (a refunded order itself is never closed automatically)
      expect(refundOff.withDifference).toBe(0);
      expect(refundOff.rules["matched M5.batch.tied_evidence_separate"] ?? 0).toBe(refundOff.matched);
      expect(refundOff.rules["suggested_for_review M5.bank.imported_not_verified"] ?? 0).toBe(0);
      expect(refundOff.matched).toBe(refundOn.matched);
      expect(refundOff.exception).toBe(refundOn.exception);
      expect(refundOn.matched).toBeGreaterThanOrEqual(afterOn.matched);
      expect(refundOn.exception).toBeLessThanOrEqual(afterOn.exception);
      expect(refundOn.rules["matched M5.batch.tied_verified"]).toBe(refundOn.matched);
      if (world.refunds.length) expect(refundOn.exception).toBeLessThan(afterOn.exception);
    });
  }
});
