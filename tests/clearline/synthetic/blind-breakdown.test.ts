/**
 * Phase 0.5: the blind-test breakdown (scripts/blind/reasons.ts) names a reason for every payment that did not auto-match,
 * counts add up, and the printed reasons carry no order ID, amount or address (they are counted, and wallet addresses are
 * personal data). Synthetic · fictional data.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { smallWorld } from "@/lib/clearline/synthetic";
import { blindInput, perPaymentLines } from "../../fixtures/synthetic/blind-input";
import { blockingReason, breakdownOf, isAutoMatched, renderBreakdown } from "../../../scripts/blind/reasons";

describe("blind breakdown reasons", () => {
  const world = smallWorld();
  for (const [name, withLines] of [["totals only", false], ["per-payment file", true]] as const) {
    it(`${name}: one reason per payment not auto-matched; no IDs or addresses in the reasons`, () => {
      const inputs = world.entitySpecs.map((e) => blindInput(world, e.id)).map((i) => (withLines ? { ...i, settlementPaymentLines: perPaymentLines(world, i) } : i));
      const ents = inputs.map((i) => ({ entityId: i.entity.id, recs: merchant.reconcile(i).records }));
      for (const { recs } of ents) {
        const b = breakdownOf(recs);
        const notAuto = recs.filter((r) => !isAutoMatched(r)).length;
        expect(Object.values(b.reasons).reduce((a, c) => a + c, 0)).toBe(notAuto);
        expect(b.payments).toBe(recs.length);
        for (const r of recs) expect(blockingReason(r) === undefined).toBe(isAutoMatched(r));
        const orderIds = recs.map((r) => r.orderId);
        for (const k of Object.keys(b.reasons)) {
          for (const id of orderIds) expect(k).not.toContain(id);
          expect(k).not.toMatch(/\b(0x)?[A-Za-z0-9]{20,}\b/);
        }
      }
      const md = renderBreakdown(name, ents.map((e) => ({ entityId: e.entityId, b: breakdownOf(e.recs) })));
      expect(md).toContain("total not auto-matched");
    });
  }
});
