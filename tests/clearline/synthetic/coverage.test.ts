import { beforeAll, describe, expect, it } from "vitest";
import { DIFFERENCE_TYPES, RC6_SHIPPED_POLICY, SCENARIOS, SITUATIONS, computeTruth, coverage, monthWorld, type Coverage, type SyntheticTruth, type SyntheticWorld } from "@/lib/clearline/synthetic";

let world: SyntheticWorld;
let truth: SyntheticTruth;
let cov: Coverage;
beforeAll(() => {
  world = monthWorld();
  truth = computeTruth(world);
  cov = coverage(world, truth);
  console.info(`[synthetic coverage, month preset]\n${JSON.stringify(cov, null, 1)}`);
});

describe("synthetic month preset: coverage", () => {
  it("is one month, 2,000 orders, two chains, two entities, SGD + USD accounts", () => {
    expect(world.month).toBe("2026-11");
    expect(world.orders).toHaveLength(2_000);
    expect(new Set(world.transfers.map((t) => t.network))).toEqual(new Set(["tron", "ethereum", "polygon"]));
    expect(new Set(world.tokens.map((t) => `${t.network}:${t.symbol}`))).toEqual(new Set(["tron:USDT", "ethereum:USDC", "ethereum:USDT"]));
    expect(world.entities.map((e) => e.functionalCurrency)).toEqual(["SGD", "USD"]);
    expect(world.bankAccounts.map((a) => a.currency)).toEqual(["SGD", "USD"]);
  });

  for (const t of DIFFERENCE_TYPES) it(`has ≥1 instance of difference type ${t}`, () => expect(cov.differenceTypes[t]).toBeGreaterThanOrEqual(1));
  for (const s of SITUATIONS) it(`has ≥1 instance of situation ${s}`, () => expect(cov.situations[s]).toBeGreaterThanOrEqual(1));
  for (const s of SCENARIOS) it(`has ≥1 order built as ${s}`, () => expect(cov.scenarios[s]).toBeGreaterThanOrEqual(1));
  it("has every engine outcome", () => {
    for (const d of ["matched", "matched_with_difference", "suggested_for_review", "exception"] as const) expect(cov.decisions[d], d).toBeGreaterThanOrEqual(1);
  });
  it("covers every situation's rule", () => {
    const rules = new Set(truth.orders.map((o) => o.ruleId));
    for (const r of [
      "M1.identity.lookalike_token", "M1.finality.pending", "M2.reference.no_chain_transfer", "M3.batch.held_by_provider", "M3.batch.unknown_batch",
      "M4.tolerance.unexplained", "M4.tolerance.within_band", "M4.tolerance.writeoff_threshold", "M4.tolerance.explained_outside_band",
      "M4.tolerance.underpayment_beyond_band", "M4.tolerance.overpayment_beyond_band", "M5.batch.tied_verified",
    ]) expect(rules.has(r), r).toBe(true);
    const tRules = new Set(truth.transfers.flatMap((t) => (t.expectation.kind === "transfer_exception" ? [t.expectation.ruleId] : [])));
    expect(tRules).toEqual(new Set(["M2.reference.unattributed", "M1.identity.network_disabled", "M1.identity.lookalike_token"]));
  });

  it("duplicate-amount pairs are identical invoices on the same day with different deposit addresses", () => {
    const dups = world.orders.filter((o) => o.design.scenario === "duplicate_amount");
    expect(dups.length).toBeGreaterThanOrEqual(2);
    for (const o of dups) {
      const twin = world.orders.find((x) => x.orderId === o.design.lookAlikeOrderIds[0])!;
      expect(twin.invoice.amountMinor).toBe(o.invoice.amountMinor);
      const [q1, q2] = [o, twin].map((x) => world.quotes.find((q) => q.orderId === x.orderId)!);
      expect(q1.createdAt.slice(0, 10)).toBe(q2.createdAt.slice(0, 10));
      expect(q1.depositAddress).not.toBe(q2.depositAddress);
    }
  });

  it("amount-only coincidences: the transfer equals another order's quoted amount but reaches its own address", () => {
    const pairs = world.orders.filter((o) => o.design.tags.includes("received_equals_other_order_quote"));
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (const o of pairs) {
      const other = world.quotes.find((q) => q.orderId === o.design.lookAlikeOrderIds[0])!;
      const t = world.transfers.find((x) => o.design.transferKeys.includes(`${x.network}|${x.txHash}|${x.logIndex}`))!;
      expect(t.amountBaseUnits).toBe(other.quotedBaseUnits);
      expect(t.to).not.toBe(other.depositAddress);
    }
    const unattributed = world.transferMeta.filter((m) => m.extra === "unattributed_amount_coincidence");
    expect(unattributed.length).toBeGreaterThanOrEqual(1);
    for (const m of unattributed) {
      const t = world.transfers.find((x) => `${x.network}|${x.txHash}|${x.logIndex}` === m.key)!;
      expect(t.amountBaseUnits).toBe(world.quotes.find((q) => q.orderId === m.coincidesWithOrderId)!.quotedBaseUnits);
    }
  });

  it("policy-sensitive orders are the only ones whose truth changes between the larger and the smaller band", () => {
    const shipped = computeTruth(world, RC6_SHIPPED_POLICY);
    const changed = truth.orders.filter((o, i) => o.decision !== shipped.orders[i].decision || o.ruleId !== shipped.orders[i].ruleId);
    expect(changed.map((o) => o.orderId)).toEqual(truth.orders.filter((o) => o.policySensitive).map((o) => o.orderId));
    expect(new Set(changed.map((o) => o.scenario))).toEqual(new Set(["policy_band_small", "policy_band_large"]));
  });

  it("every batch is built to tie, and every bank line is a settlement or an explained non-settlement line", () => {
    for (const b of truth.batches) expect(b.tied, b.batchId).toBe(true);
    for (const l of truth.bankLines) expect(l.kind === "non_settlement" ? l.reason.length > 0 : truth.batches.some((b) => b.bankLineId === l.bankLineId)).toBe(true);
  });
});
