/**
 * What the upload pipeline must decide for each order of a synthetic world, derived from the generator's ground truth
 * (computeTruth) and the file shapes uploaded. Pure; shared by the control truth test and the e2e upload journey.
 *
 * - "truth": the engine must reproduce the generator's decision, rule and differences exactly.
 * - "rule": the truth, made stricter by a documented rule that applies to these files (an imported bank line never
 *   verifies settlement while the policy flag is off — founder decision 2; a totals-only settlement report only
 *   PROPOSES a grouping a person confirms — rc6). Exact decision and rule.
 * - "abstain": the files lack information the truth relies on (named in `why`); the engine must not close the order
 *   (no matched / matched_with_difference), and where the abstention is a rule it is given exactly.
 */
import type { OrderTruth, SyntheticTruth, SyntheticWorld } from "../../../src/lib/clearline/synthetic";

export type ProviderShape = "A" | "B" | "C" | "Aq";
export interface FileShapes {
  provider: ProviderShape;
  settlement: "lines" | "totals";
  /** merchant policy allowImportedBankLinesAsVerified */
  importedLinesVerify: boolean;
}

export type Expectation =
  | { kind: "truth"; decision: string; ruleId?: string; differences: [string, bigint][] }
  | { kind: "rule"; decision: string; ruleId: string; differences: [string, bigint][]; why: string }
  | { kind: "abstain"; why: string; decision?: string; ruleId?: string; noRecord?: boolean };

const CLOSING = new Set(["matched", "matched_with_difference"]);
export const isClosing = (decision: string) => CLOSING.has(decision);

/** The shape's facts that matter for the truth (see the generator's writers/provider.ts). */
const SHAPE = {
  // quote terms (rate, window; B also the quoted amount) are in no plain provider shape
  quoteTerms: { A: false, B: false, C: false, Aq: true },
  // shape A shows the provider's DISPLAYED status ("Completed" for held, re-quoted and paid alike), not its claim
  claims: { A: false, B: true, C: true, Aq: false },
  // shape B has no token symbol: an Ethereum payment's token (USDC or USDT) cannot be identified
  ethereumToken: { A: true, B: false, C: true, Aq: true },
} as const;

export function expectationFor(world: SyntheticWorld, truth: SyntheticTruth, t: OrderTruth, files: FileShapes): Expectation {
  const order = world.orders.find((o) => o.orderId === t.orderId)!;
  const metas = world.paymentMeta.filter((m) => m.orderId === t.orderId);
  const diffs = (): [string, bigint][] => t.differences.map((d) => [d.type, d.amountMinor]);
  if (t.decision === "not_evaluated") return { kind: "abstain", why: "unpaid: no provider row, nothing to reconcile", noRecord: true };
  if (metas.length === 0)
    return { kind: "abstain", why: "the provider export lists no payment for it, so Clearline knows no deposit address to read (the chain transfer it received is never seen)", noRecord: true };
  if (!SHAPE.ethereumToken[files.provider] && metas.some((m) => m.network === "ethereum"))
    return { kind: "abstain", why: "shape B has no token symbol: an Ethereum payment's token cannot be identified, so its rows are refused", noRecord: metas.every((m) => m.network === "ethereum") };
  const early = !!order.design.early;
  const linkRows = order.linkIds.length > 0;
  // A status the displayed word hides (held for review, re-quoted): shape A cannot reproduce a claim-based truth.
  const held = order.design.scenario === "held_by_provider";
  if (!SHAPE.claims[files.provider] && (held || order.design.scenario === "requote_within" || order.design.scenario === "requote_beyond")) {
    const why = `shape ${files.provider} shows the displayed status "Completed", not the provider's claim (${held ? "held for review" : "re-quoted"})`;
    // what the engine then decides from what the file does say: without quote terms it abstains; with them, a held
    // payment in no batch is only a proposed grouping and a late payment the file does not call re-quoted is an exception
    const got = !SHAPE.quoteTerms[files.provider] ? ["suggested_for_review", "M3.quote.terms_unknown"]
      : held ? ["suggested_for_review", "M5.grouping.proposed_needs_confirmation"] : ["exception", "M3.window.after_expiry_no_requote"];
    return { kind: "abstain", why, decision: got[0], ruleId: got[1] };
  }
  if (!early && !t.differenceTypes.includes("unexplained") && (!SHAPE.quoteTerms[files.provider] || linkRows)) {
    return {
      kind: "rule", decision: "suggested_for_review", ruleId: "M3.quote.terms_unknown", differences: [],
      why: linkRows ? "a payment-link row gives the link's address and amount, not its quote's terms or the link's window" : `shape ${files.provider} has no quote rate or validity window${files.provider === "B" ? " (nor the quoted amount)" : ""}`,
    };
  }
  if (early || t.decision === "exception" || t.decision === "any_non_closing") return { kind: "truth", decision: t.decision, ...(t.ruleId ? { ruleId: t.ruleId } : {}), differences: diffs() };
  // step 5 on these files
  const unheld = order.design.payments.some((p) => !p.held);
  if (files.settlement === "totals" && isClosing(t.decision) && unheld)
    return { kind: "rule", decision: "suggested_for_review", ruleId: "M5.grouping.proposed_needs_confirmation", differences: diffs(), why: "a totals-only settlement report links no payment to a batch: the grouping is only proposed" };
  const untieable = t.batchIds.filter((b) => !batchTieable(world, truth, b, files));
  if (files.settlement === "lines" && isClosing(t.decision) && untieable.length)
    return { kind: "abstain", decision: "exception", ruleId: "M5.batch.not_tied", why: `batch ${untieable.join(", ")} cannot tie from these files: ${tieGap(world, truth, untieable[0], files)}` };
  if (files.settlement === "lines" && !files.importedLinesVerify && isClosing(t.decision) && t.batchIds.length)
    return { kind: "rule", decision: "suggested_for_review", ruleId: "M5.bank.imported_not_verified", differences: diffs(), why: "the bank line is imported, not bank-authenticated, and the policy flag is off" };
  return { kind: "truth", decision: t.decision, ...(t.ruleId ? { ruleId: t.ruleId } : {}), differences: diffs() };
}

export function expectationsFor(world: SyntheticWorld, truth: SyntheticTruth, files: FileShapes, entityId?: string): Map<string, Expectation> {
  return new Map(truth.orders.filter((t) => !entityId || t.entityId === entityId).map((t) => [t.orderId, expectationFor(world, truth, t, files)]));
}

/** Why a batch the truth ties cannot tie from these files ("" when it can). */
function tieGap(world: SyntheticWorld, truth: SyntheticTruth, batchId: string, files: FileShapes): string {
  const b = truth.batches.find((x) => x.batchId === batchId);
  if (!b || !b.tied) return "the truth does not tie it either";
  if (!SHAPE.claims[files.provider] && b.timing.held.length) return `a payment held for review (${b.timing.held.join(", ")}) shows as "Completed" in shape ${files.provider}, so its merchant day cannot be bridged`;
  const refused = b.paymentIds.filter((id) => world.paymentMeta.find((m) => m.providerPaymentId === id)?.network === "ethereum");
  if (!SHAPE.ethereumToken[files.provider] && refused.length) return `its Ethereum payments (${refused.join(", ")}) were refused: shape B has no token symbol`;
  return "";
}
/** Whether a batch the truth ties can tie from these files (per-line settlement). */
export function batchTieable(world: SyntheticWorld, truth: SyntheticTruth, batchId: string, files: FileShapes): boolean {
  const b = truth.batches.find((x) => x.batchId === batchId);
  return !!b && b.tied && tieGap(world, truth, batchId, files) === "";
}
