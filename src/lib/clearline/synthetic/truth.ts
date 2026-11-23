/**
 * Ground truth for a synthetic world. Derived from how each order was BUILT (world.design) and the documented
 * matching rules (docs/MATCHING_RULES.md) under a given tolerance policy — never by running the engine.
 *
 * Steps 1–3 outcomes are fixed by construction. The step-4 outcome is the documented band rule applied to the
 * designed, typed differences. Step 5 can only confirm an exact match (every batch is built to tie). Where an outcome
 * is not certain from the rules, the expectation is "any_non_closing": the engine must not close it (no matched or
 * matched_with_difference), whatever else it decides.
 */
import { bandFor, withBandRule, type SyntheticPolicy } from "./policy";
import { addDays } from "./time";
import { EXTRAS, SCENARIOS, type Scenario, type SyntheticWorld, type WorldOrder } from "./world";
import type { Decision, DifferenceType, FiatCurrency, Owner, Step } from "../merchant/types";

export type ExpectedDecision = Decision | "any_non_closing" | "not_evaluated";

export interface ExpectedDifference { type: DifferenceType; amountMinor: bigint }

export interface OrderTruth {
  orderId: string;
  entityId: string;
  scenario: Scenario;
  tags: string[];
  decision: ExpectedDecision;
  /** Present only when certain. */
  decidingStep?: Step;
  ruleId?: string;
  owner?: Owner;
  differences: ExpectedDifference[];
  differenceTypes: DifferenceType[];
  /** Absolute write-off the engine should propose (matched_with_difference only). */
  writeOffMinor?: bigint;
  batchIds: string[];
  /** Expected MatchRecord.bank.batchTied. */
  batchTied: boolean;
  /** True when this order's decision or rule differs between the "larger" and "smaller" band rules. */
  policySensitive: boolean;
  /** Transfers that may be attached to this order (all others attached to it would be wrong matches). */
  correctTransferKeys: string[];
}

export interface BatchTruth {
  batchId: string;
  entityId: string;
  currency: FiatCurrency;
  providerDay: string;
  tied: boolean;
  grossMinor: bigint;
  feesMinor: bigint;
  refundsMinor: bigint;
  netMinor: bigint;
  bankLineId: string | null;
  /** Provider clearing for this batch nets to zero in the journal proposals (every payment chain-evidenced). */
  clearingNetsToZero: boolean;
  paymentIds: string[];
  timing: { inPrior: string[]; inNext: string[]; outPrior: string[]; outNext: string[]; held: string[] };
  /** Bridge difference types this batch shows. */
  differenceTypes: DifferenceType[];
}

export type TransferExpectation =
  | { kind: "attached"; orderId: string }
  | { kind: "transfer_exception"; step: Step; ruleId: string; owner: Owner };

export interface TransferTruth { key: string; entityId: string; expectation: TransferExpectation; coincidesWithOrderId?: string }

export interface BankLineTruth { bankLineId: string; account: string; kind: "settlement" | "non_settlement"; batchId?: string; reason: string }

export interface SyntheticTruth {
  policy: SyntheticPolicy;
  orders: OrderTruth[];
  batches: BatchTruth[];
  transfers: TransferTruth[];
  bankLines: BankLineTruth[];
  /** "transferKey→orderId" for every CORRECT attachment. Anything else on a record is a wrong match. */
  correctPairs: Set<string>;
}

export const pairKey = (transferKey: string, orderId: string): string => `${transferKey}→${orderId}`;
const abs = (x: bigint) => (x < 0n ? -x : x);

interface Outcome { decision: ExpectedDecision; decidingStep?: Step; ruleId?: string; owner?: Owner; writeOffMinor?: bigint }

/** The documented step-4 rule plus step 5's confirmation of an exact match in a tied, verified batch. */
function step4(o: WorldOrder, policy: SyntheticPolicy, differences: ExpectedDifference[], batched: boolean): Outcome {
  const types = new Set(differences.map((d) => d.type));
  const total = differences.reduce((t, d) => t + d.amountMinor, 0n);
  const cur = o.invoice.currency;
  if (total === 0n && differences.length === 0) return batched ? { decision: "matched", decidingStep: 5, ruleId: "M5.batch.tied_verified" } : { decision: "matched", decidingStep: 4, ruleId: "M4.match.no_difference" };
  if (types.has("unexplained")) return { decision: "exception", decidingStep: 4, ruleId: "M4.tolerance.unexplained", owner: "Payment Operations" };
  const partOpen = types.has("partial_payment_open");
  const band = bandFor(policy, o.invoice.amountMinor, cur);
  if (abs(total) <= band && !partOpen) {
    if (abs(total) > policy.writeoffThresholdMinor[cur]) return { decision: "suggested_for_review", decidingStep: 4, ruleId: "M4.tolerance.writeoff_threshold", owner: "Finance Controller" };
    return { decision: "matched_with_difference", decidingStep: 4, ruleId: "M4.tolerance.within_band", writeOffMinor: abs(total) };
  }
  if (types.has("underpayment")) return { decision: "exception", decidingStep: 4, ruleId: "M4.tolerance.underpayment_beyond_band", owner: "Payment Operations" };
  if (types.has("overpayment")) return { decision: "exception", decidingStep: 4, ruleId: "M4.tolerance.overpayment_beyond_band", owner: "Payment Operations" };
  return { decision: "suggested_for_review", decidingStep: 4, ruleId: "M4.tolerance.explained_outside_band", owner: "Payment Operations" };
}

function designedDifferences(o: WorldOrder): ExpectedDifference[] {
  const d = o.design;
  const out: ExpectedDifference[] = [];
  if (d.unexplainedMinor) out.push({ type: "unexplained", amountMinor: d.unexplainedMinor });
  if (d.partialOpenMinor) out.push({ type: "partial_payment_open", amountMinor: d.partialOpenMinor });
  if (d.tokenDiff && d.tokenDiff.amountMinor !== 0n) out.push({ type: d.tokenDiff.type, amountMinor: d.tokenDiff.amountMinor });
  if (d.rateDiff && d.rateDiff.amountMinor !== 0n && !d.partialOpenMinor) out.push({ type: d.rateDiff.type, amountMinor: d.rateDiff.amountMinor });
  return out;
}

function outcomeFor(o: WorldOrder, policy: SyntheticPolicy, realBatches: Set<string>): { outcome: Outcome; differences: ExpectedDifference[] } {
  if (o.design.scenario === "unpaid") return { outcome: { decision: "not_evaluated" }, differences: [] };
  if (o.design.early) {
    const e = o.design.early;
    return { outcome: { decision: e.decision, decidingStep: e.step, ruleId: e.ruleId, owner: e.owner }, differences: [] };
  }
  const differences = designedDifferences(o);
  const batched = o.design.payments.some((p) => p.batchId && realBatches.has(p.batchId));
  return { outcome: step4(o, policy, differences, batched), differences };
}

export function computeTruth(world: SyntheticWorld, policy: SyntheticPolicy = world.policy): SyntheticTruth {
  const realBatches = new Set(world.batches.map((b) => b.batchId));
  const other = withBandRule(policy, policy.bandRule === "larger" ? "smaller" : "larger");
  const orders: OrderTruth[] = world.orders.map((o) => {
    const { outcome, differences } = outcomeFor(o, policy, realBatches);
    const alt = outcomeFor(o, other, realBatches).outcome;
    const batchIds = [...new Set(o.design.payments.map((p) => p.batchId).filter((b): b is string => !!b && realBatches.has(b)))].sort();
    return {
      orderId: o.orderId, entityId: o.entityId, scenario: o.design.scenario, tags: [...o.design.tags],
      ...outcome, differences, differenceTypes: [...new Set(differences.map((d) => d.type))].sort(),
      batchIds, batchTied: batchIds.length > 0,
      policySensitive: alt.decision !== outcome.decision || alt.ruleId !== outcome.ruleId,
      correctTransferKeys: [...o.design.transferKeys],
    };
  });
  const orderTruth = new Map(orders.map((t) => [t.orderId, t]));

  // ---- batches: bridge expectations from the designed merchant days and batch days.
  const dayOfBatch = new Map(world.batches.map((b) => [b.batchId, b.providerDay]));
  const batches: BatchTruth[] = world.batches.map((b) => {
    const spec = world.entitySpecs.find((e) => e.bankAccountId === b.targetBankAccount)!;
    const pays = world.orders.filter((o) => o.entityId === spec.id).flatMap((o) => o.design.payments.map((p) => ({ ...p, orderId: o.orderId })));
    const D = b.providerDay;
    const inB = pays.filter((p) => p.batchId === b.batchId);
    const out = pays.filter((p) => p.merchantDay === D && p.batchId !== b.batchId);
    const otherDay = (p: (typeof pays)[number]) => (p.batchId ? dayOfBatch.get(p.batchId) ?? "" : "");
    const ids = (ps: typeof pays) => ps.map((p) => p.providerPaymentId).sort();
    const timing = {
      inPrior: ids(inB.filter((p) => p.merchantDay !== undefined && p.merchantDay < D)),
      inNext: ids(inB.filter((p) => p.merchantDay !== undefined && p.merchantDay > D)),
      outPrior: ids(out.filter((p) => otherDay(p) !== "" && otherDay(p) < D)),
      outNext: ids(out.filter((p) => otherDay(p) > D)),
      held: ids(out.filter((p) => p.held)),
    };
    const explained = new Set(Object.values(timing).flat());
    const strays = [...out, ...inB.filter((p) => p.merchantDay !== D)].filter((p) => !explained.has(p.providerPaymentId));
    const bank = world.bankLines.find((l) => l.account === b.targetBankAccount && l.description.includes(b.batchId)) ?? null;
    const lines = world.batchLines.filter((l) => l.batchId === b.batchId);
    const tied = strays.length === 0 && !!bank && bank.amountMinor === b.netMinor && b.grossMinor - b.feesMinor - b.refundsMinor === b.netMinor
      && lines.filter((l) => l.kind === "payment").reduce((t, l) => t + l.amountMinor, 0n) === b.grossMinor
      && lines.filter((l) => l.kind === "refund").reduce((t, l) => t + l.amountMinor, 0n) === b.refundsMinor;
    const evidenced = (orderId: string) => {
      const t = orderTruth.get(orderId)!;
      return (t.decidingStep !== undefined && t.decidingStep >= 4 || t.ruleId === "M3.batch.held_by_provider") && !t.differenceTypes.includes("unexplained");
    };
    const types: DifferenceType[] = [];
    if (b.feesMinor !== 0n) types.push("provider_fee");
    if (b.refundsMinor !== 0n) types.push("refund_netted");
    if (timing.inPrior.length || timing.outPrior.length) types.push("timing_prior_batch");
    if (timing.inNext.length || timing.outNext.length) types.push("timing_next_batch");
    if (timing.held.length) types.push("held_by_provider");
    return {
      batchId: b.batchId, entityId: spec.id, currency: b.currency, providerDay: D, tied, grossMinor: b.grossMinor, feesMinor: b.feesMinor, refundsMinor: b.refundsMinor,
      netMinor: b.netMinor, bankLineId: bank?.bankLineId ?? null, clearingNetsToZero: tied && inB.every((p) => evidenced(p.orderId)), paymentIds: ids(inB), timing, differenceTypes: types,
    };
  });

  const transfers: TransferTruth[] = world.transferMeta.map((m) => {
    if (m.orderId) return { key: m.key, entityId: m.entityId, expectation: { kind: "attached", orderId: m.orderId } };
    const exp: TransferExpectation = m.extra === "disabled_network"
      ? { kind: "transfer_exception", step: 1, ruleId: "M1.identity.network_disabled", owner: "Treasury" }
      : m.extra === "lookalike_unattributed"
        ? { kind: "transfer_exception", step: 1, ruleId: "M1.identity.lookalike_token", owner: "Treasury" }
        : { kind: "transfer_exception", step: 2, ruleId: "M2.reference.unattributed", owner: "Payment Operations" };
    return { key: m.key, entityId: m.entityId, expectation: exp, ...(m.coincidesWithOrderId ? { coincidesWithOrderId: m.coincidesWithOrderId } : {}) };
  });

  const bankLines: BankLineTruth[] = world.bankLineMeta.map((m) => ({ bankLineId: m.bankLineId, account: world.bankLines.find((l) => l.bankLineId === m.bankLineId)!.account, kind: m.kind, ...(m.batchId ? { batchId: m.batchId } : {}), reason: m.reason }));
  const correctPairs = new Set(orders.flatMap((o) => o.correctTransferKeys.map((k) => pairKey(k, o.orderId))));
  return { policy, orders, batches, transfers, bankLines, correctPairs };
}

// ---------------------------------------------------------------- coverage

export const DIFFERENCE_TYPES: readonly DifferenceType[] = [
  "sender_side_fee", "underpayment", "overpayment", "requote_after_expiry", "rate_difference", "provider_fee",
  "refund_netted", "timing_prior_batch", "timing_next_batch", "held_by_provider", "partial_payment_open", "unexplained",
];

/** Situations the generator must cover (see the rc7 brief). */
export const SITUATIONS = [
  "exact_match", "sender_side_fee", "underpayment_within_band", "underpayment_beyond_band", "overpayment_within_band", "overpayment_beyond_band",
  "requote_after_expiry", "rate_difference", "provider_fee", "refund_netted", "timing_prior_batch", "timing_next_batch", "day_boundary",
  "held_by_provider", "partial_payment_open", "partial_completed_two_chains", "unattributed_transfer", "lookalike_token", "disabled_network",
  "unknown_batch", "duplicate_equal_amounts_same_day", "amount_only_coincidence", "not_final_transfer", "misleading_completed_claim",
  "no_chain_transfer", "unexplained_credit", "next_business_day_settlement", "policy_sensitive", "unpaid_invoice",
] as const;
export type Situation = (typeof SITUATIONS)[number];

export interface Coverage {
  /** Order-level types: orders showing the type. Bridge-level types: provider_fee = batches with a fee, refund_netted = refund lines, timing_* = (batch, payment) bridge entries, held_by_provider = held orders. */
  differenceTypes: Record<DifferenceType, number>;
  situations: Record<Situation, number>;
  decisions: Record<ExpectedDecision, number>;
  scenarios: Record<Scenario, number>;
  extras: Record<string, number>;
}

export function coverage(world: SyntheticWorld, truth: SyntheticTruth): Coverage {
  const differenceTypes = Object.fromEntries(DIFFERENCE_TYPES.map((t) => [t, 0])) as Record<DifferenceType, number>;
  for (const o of truth.orders) for (const t of o.differenceTypes) differenceTypes[t]++;
  differenceTypes.provider_fee = truth.batches.filter((b) => b.feesMinor !== 0n).length;
  differenceTypes.refund_netted = world.refunds.length;
  differenceTypes.timing_prior_batch = truth.batches.reduce((n, b) => n + b.timing.inPrior.length + b.timing.outPrior.length, 0);
  differenceTypes.timing_next_batch = truth.batches.reduce((n, b) => n + b.timing.inNext.length + b.timing.outNext.length, 0);
  differenceTypes.held_by_provider = truth.orders.filter((o) => o.ruleId === "M3.batch.held_by_provider").length;
  const by = (f: (o: OrderTruth) => boolean) => truth.orders.filter(f).length;
  const sc = (s: Scenario) => by((o) => o.scenario === s);
  const extra = (x: string) => world.transferMeta.filter((m) => m.extra === x).length;
  const situations: Record<Situation, number> = {
    exact_match: by((o) => o.decision === "matched"),
    sender_side_fee: by((o) => o.differenceTypes.includes("sender_side_fee")),
    underpayment_within_band: by((o) => o.differenceTypes.includes("underpayment") && (o.decision === "matched_with_difference" || o.ruleId === "M4.tolerance.writeoff_threshold")),
    underpayment_beyond_band: by((o) => o.ruleId === "M4.tolerance.underpayment_beyond_band"),
    overpayment_within_band: by((o) => o.differenceTypes.includes("overpayment") && (o.decision === "matched_with_difference" || o.ruleId === "M4.tolerance.writeoff_threshold")),
    overpayment_beyond_band: by((o) => o.ruleId === "M4.tolerance.overpayment_beyond_band"),
    requote_after_expiry: by((o) => o.differenceTypes.includes("requote_after_expiry")),
    rate_difference: by((o) => o.differenceTypes.includes("rate_difference")),
    provider_fee: differenceTypes.provider_fee,
    refund_netted: world.refunds.length,
    timing_prior_batch: differenceTypes.timing_prior_batch,
    timing_next_batch: differenceTypes.timing_next_batch,
    day_boundary: by((o) => o.tags.includes("day_boundary")),
    held_by_provider: sc("held_by_provider"),
    partial_payment_open: by((o) => o.differenceTypes.includes("partial_payment_open")),
    partial_completed_two_chains: by((o) => o.scenario === "partial_completed" && o.tags.includes("two_chains")),
    unattributed_transfer: extra("unattributed") + extra("unattributed_amount_coincidence"),
    lookalike_token: sc("lookalike_token") + extra("lookalike_unattributed"),
    disabled_network: extra("disabled_network"),
    unknown_batch: sc("unknown_batch"),
    duplicate_equal_amounts_same_day: sc("duplicate_amount") / 2,
    amount_only_coincidence: sc("amount_coincidence") / 2 + extra("unattributed_amount_coincidence"),
    not_final_transfer: by((o) => o.tags.includes("not_final")),
    misleading_completed_claim: by((o) => o.tags.includes("misleading_completed")),
    no_chain_transfer: sc("no_chain_transfer"),
    unexplained_credit: sc("credit_mismatch"),
    // Credited later than the calendar day after the provider day (weekend roll or a one-business-day delay).
    next_business_day_settlement: world.bankLineMeta.filter((m) => m.kind === "settlement" && m.batchId).filter((m) => {
      const b = world.batches.find((x) => x.batchId === m.batchId)!;
      const l = world.bankLines.find((x) => x.bankLineId === m.bankLineId)!;
      return l.valueDate > addDays(b.providerDay, 1);
    }).length,
    policy_sensitive: by((o) => o.policySensitive),
    unpaid_invoice: sc("unpaid"),
  };
  const decisions = { matched: 0, matched_with_difference: 0, suggested_for_review: 0, exception: 0, any_non_closing: 0, not_evaluated: 0 } as Record<ExpectedDecision, number>;
  for (const o of truth.orders) decisions[o.decision]++;
  const scenarios = Object.fromEntries(SCENARIOS.map((s) => [s, sc(s)])) as Record<Scenario, number>;
  const extras = Object.fromEntries(EXTRAS.map((x) => [x, x === "refund" ? world.refunds.length : extra(x)]));
  return { differenceTypes, situations, decisions, scenarios, extras };
}
