/**
 * The synthetic ground truth against the CURRENT engine, via the direct (non-file) conversion.
 *
 * Policy note: the truth is built for the target tolerance policy (band = LARGER of 0.5% and a fixed amount per
 * currency; write-off threshold = that amount), while the rc6 engine as shipped uses the SMALLER of the two. Only
 * orders built as policy_band_small / policy_band_large depend on that choice (truth.policySensitive). For those, the
 * engine must agree with the truth under ONE band rule, the same for all of them; every other assertion, and above
 * all the zero-wrong-match assertion, is policy-independent and exact.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import {
  RC6_SHIPPED_POLICY, TARGET_POLICY, computeTruth, monthWorld, pairKey, smallWorld, toReconcileInput, transferKey,
  type OrderTruth, type SyntheticTruth, type SyntheticWorld,
} from "@/lib/clearline/synthetic";

type Result = ReturnType<typeof merchant.reconcile>;
type Rec = Result["records"][number];

const verdictOf = (rec: Rec) => ({ decision: rec.explanation.decision, step: rec.explanation.decidingStep, ruleId: rec.explanation.ruleId, owner: rec.attention?.owner });
const verdictTruth = (t: OrderTruth) => ({ decision: t.decision, step: t.decidingStep, ruleId: t.ruleId, owner: t.owner });
const diffs = (xs: readonly { type: string; amountMinor: bigint }[]) => xs.map((d) => `${d.type}:${d.amountMinor}`).sort();

function run(world: SyntheticWorld) {
  return world.entitySpecs.map((e) => {
    const input = toReconcileInput(world, e.id);
    const result = merchant.reconcile(input);
    return { entityId: e.id, input, result, journals: merchant.proposeJournals(input, result) };
  });
}

function suite(name: string, make: () => SyntheticWorld) {
  describe(`synthetic ${name} preset × current engine`, () => {
    const world = make();
    const target = computeTruth(world, TARGET_POLICY);
    const shipped = computeTruth(world, RC6_SHIPPED_POLICY);
    const runs = run(world);
    const truthOf = (t: SyntheticTruth, id: string) => t.orders.find((o) => o.orderId === id)!;

    it("ZERO wrong matches: every transfer on a record was sent to an address issued for that order", () => {
      let attached = 0;
      for (const { result } of runs)
        for (const rec of result.records)
          for (const t of [...rec.chain.transfers, ...rec.chain.pending]) {
            attached++;
            expect(target.correctPairs.has(pairKey(transferKey(t), rec.orderId)), `${transferKey(t)} on ${rec.orderId}`).toBe(true);
          }
      expect(attached).toBeGreaterThan(0);
    });

    it("every correct attachment is present, and transfers that belong to no order are on no record", () => {
      for (const { entityId, result } of runs) {
        const onRecords = new Map(result.records.flatMap((r) => [...r.chain.transfers, ...r.chain.pending].map((t) => [transferKey(t), r.orderId] as const)));
        for (const t of target.transfers.filter((x) => x.entityId === entityId)) {
          if (t.expectation.kind === "attached") {
            expect(onRecords.get(t.key), t.key).toBe(t.expectation.orderId);
          } else {
            expect(onRecords.has(t.key), t.key).toBe(false);
            const f = result.transferFindings.find((x) => transferKey(x.transfer) === t.key);
            expect(f && [f.kind, f.step, f.ruleId], t.key).toEqual(["exception", t.expectation.step, t.expectation.ruleId]);
            const ex = result.exceptions.find((x) => x.transfer && transferKey(x.transfer) === t.key);
            expect(ex?.owner, t.key).toBe(t.expectation.owner);
          }
        }
      }
    });

    it("every evaluated order gets the expected decision, step, rule, owner, differences, write-off and batch tie", () => {
      let checked = 0;
      for (const { entityId, result } of runs) {
        for (const t of target.orders.filter((o) => o.entityId === entityId)) {
          const rec = result.records.find((r) => r.orderId === t.orderId);
          if (t.decision === "not_evaluated") { expect(rec, t.orderId).toBeUndefined(); continue; }
          expect(rec, t.orderId).toBeDefined();
          expect(rec!.bank.batchTied, `${t.orderId} batchTied`).toBe(t.batchTied);
          if (t.policySensitive) continue; // policy-parameterised below
          checked++;
          if (t.decision === "any_non_closing") { expect(["matched", "matched_with_difference"]).not.toContain(rec!.explanation.decision); continue; }
          expect(verdictOf(rec!), `${t.orderId} (${t.scenario})`).toEqual(verdictTruth(t));
          expect(diffs(rec!.explanation.differences), `${t.orderId} differences`).toEqual(diffs(t.differences));
          const wo = result.writeOffs.find((w) => w.orderId === t.orderId);
          expect(wo?.amountMinor, `${t.orderId} write-off`).toBe(t.writeOffMinor);
        }
      }
      expect(checked).toBeGreaterThan(20);
    });

    it("policy-sensitive orders follow ONE band rule consistently (larger = target, smaller = rc6 as shipped)", () => {
      const agree: Record<"larger" | "smaller", string[]> = { larger: [], smaller: [] };
      const sensitive = target.orders.filter((o) => o.policySensitive);
      expect(sensitive.length).toBeGreaterThanOrEqual(2);
      for (const t of sensitive) {
        const rec = runs.flatMap((r) => r.result.records).find((r) => r.orderId === t.orderId)!;
        const got = verdictOf(rec);
        const L = verdictTruth(truthOf(target, t.orderId)), S = verdictTruth(truthOf(shipped, t.orderId));
        if (JSON.stringify(got) === JSON.stringify(L)) agree.larger.push(t.orderId);
        if (JSON.stringify(got) === JSON.stringify(S)) agree.smaller.push(t.orderId);
        expect([L, S], `${t.orderId} (${t.scenario}) got ${JSON.stringify(got)}`).toContainEqual(got);
        expect(diffs(rec.explanation.differences)).toEqual(diffs(t.differences)); // the typed differences never depend on the band
      }
      const rule = agree.larger.length === sensitive.length ? "larger" : agree.smaller.length === sensitive.length ? "smaller" : "mixed";
      console.info(`[synthetic ${name}] engine band rule detected: ${rule} (${sensitive.length} policy-sensitive orders: ${sensitive.map((o) => o.orderId).join(", ")})`);
      expect(rule).not.toBe("mixed");
    });

    it("every bank line is tied to a batch or explained; every batch bridges as built", () => {
      for (const { input, result } of runs) {
        for (const l of input.bankLines) {
          const tied = result.bridges.some((b) => b.tied && b.bankLineId === l.bankLineId);
          const explained = target.bankLines.find((x) => x.bankLineId === l.bankLineId)!;
          expect(tied || explained.kind === "non_settlement", l.bankLineId).toBe(true);
          expect(tied, l.bankLineId).toBe(explained.kind === "settlement");
        }
        expect(result.proposedGroupings).toEqual([]);
        for (const b of result.bridges) {
          const t = target.batches.find((x) => x.batchId === b.batchId)!;
          expect([b.batchId, b.tied, b.settlementVerified, b.bankLineId]).toEqual([t.batchId, t.tied, true, t.bankLineId]);
          const ids = (kind: string, sign: 1 | -1) => b.lines.filter((x) => x.kind === kind && (sign > 0 ? x.amountMinor > 0n : x.amountMinor < 0n)).flatMap((x) => x.paymentIds).sort();
          expect(ids("timing_prior_batch", 1), `${b.batchId} inPrior`).toEqual(t.timing.inPrior);
          expect(ids("timing_next_batch", 1), `${b.batchId} inNext`).toEqual(t.timing.inNext);
          expect(ids("timing_prior_batch", -1), `${b.batchId} outPrior`).toEqual(t.timing.outPrior);
          expect(ids("timing_next_batch", -1), `${b.batchId} outNext`).toEqual(t.timing.outNext);
          expect(ids("held_by_provider", -1), `${b.batchId} held`).toEqual(t.timing.held);
          expect(new Set(b.lines.flatMap((x) => (x.differenceType && x.amountMinor !== 0n ? [x.differenceType] : []))), b.batchId).toEqual(new Set(t.differenceTypes));
        }
      }
    });

    it("provider clearing nets to zero exactly for the tied batches the truth says it does", () => {
      for (const { journals, result } of runs)
        for (const b of result.bridges.filter((x) => x.tied)) {
          const t = target.batches.find((x) => x.batchId === b.batchId)!;
          expect(merchant.accountBalance(journals, "provider_clearing", { batchId: b.batchId }) === 0n, b.batchId).toBe(t.clearingNetsToZero);
        }
    });

    it("every exception, and every record left for review or exception, has an owner, a reason and a next step", () => {
      for (const { result } of runs) {
        expect(result.exceptions.length).toBeGreaterThan(0);
        for (const e of result.exceptions) for (const v of [e.owner, e.reason, e.nextStep]) expect(v?.trim().length, e.id).toBeGreaterThan(0);
        for (const r of result.records.filter((x) => x.explanation.decision === "exception" || x.explanation.decision === "suggested_for_review"))
          for (const v of [r.attention?.owner, r.attention?.reason, r.attention?.nextStep]) expect(v?.trim().length, r.orderId).toBeGreaterThan(0);
      }
    });
  });
}

suite("small", () => smallWorld());
suite("month", () => monthWorld());
