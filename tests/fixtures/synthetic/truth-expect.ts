/**
 * What the upload pipeline must decide for each order of a synthetic world, derived from the generator's ground truth
 * (computeTruth) and the file shapes uploaded. Pure; shared by the control truth test and the e2e upload journey.
 *
 * - "truth": the engine must reproduce the generator's decision, rule and differences exactly.
 * - "rule": the truth, made stricter by a documented rule that applies to these files (an imported bank line never
 *   verifies settlement while the policy flag is off — founder decision 2 — so a payment with a difference stays in
 *   review, while an exact one is matched with its bank evidence shown apart (v1 Phase 0.5); a totals-only settlement report only
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

/** The provider claim a shape's file gives the engine (shape A: the displayed word, as a person maps it). */
const CLAIM_FROM_DISPLAYED: Record<string, string> = { Paid: "paid", Completed: "paid", Underpaid: "underpaid", Overpaid: "overpaid", "Partially paid": "partially_paid", Confirming: "pending" };

/**
 * rc8 founder decision 1 (M4.exact.no_quote_terms), from the generator's facts only: one provider record and one chain
 * transfer for the order, both linked by its own reference (no balance link), the file's claim is "paid", no refund in the files,
 * and the credit equals the invoice to the minor unit. Then the engine closes the order at step 4 without quote terms.
 */
export function exactByReference(world: SyntheticWorld, orderId: string, files: FileShapes): boolean {
  const order = world.orders.find((o) => o.orderId === orderId)!;
  const refs = new Set([...order.quoteIds, ...order.linkIds]);
  const recs = world.providerRecords.filter((r) => refs.has(r.ref.linkId ?? r.ref.quoteId ?? ""));
  if (recs.length !== 1 || order.design.transferKeys.length !== 1) return false;
  if (world.paymentLinks.some((l) => l.orderId === orderId && l.kind === "balance")) return false;
  // a refund blocks it only where the files show it (per-line settlement); a totals-only report names no order
  if (files.settlement === "lines" && world.batchLines.some((l) => l.kind === "refund" && l.orderId === orderId)) return false;
  const meta = world.paymentMeta.find((m) => m.providerPaymentId === recs[0].providerPaymentId);
  const claim = SHAPE.claims[files.provider] ? recs[0].statusClaim : CLAIM_FROM_DISPLAYED[meta?.displayedStatus ?? ""];
  return claim === "paid" && recs[0].creditedMinor === order.invoice.amountMinor;
}

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
    // (rc8: without quote terms, a held payment the file shows as an exact "Completed" one closes at step 4 under decision 1,
    // and step 5 then only proposes a grouping, as with quote terms: it is never closed)
    const exactHeld = held && !SHAPE.quoteTerms[files.provider] && exactByReference(world, t.orderId, files);
    const got = !SHAPE.quoteTerms[files.provider] && !exactHeld ? ["suggested_for_review", "M3.quote.terms_unknown"]
      : held ? ["suggested_for_review", "M5.grouping.proposed_needs_confirmation"] : ["exception", "M3.window.after_expiry_no_requote"];
    return { kind: "abstain", why, decision: got[0], ruleId: got[1] };
  }
  // rc8 decision 1: an exact payment linked by reference closes without quote terms; the generator's truth must agree
  const exact = !early && (!SHAPE.quoteTerms[files.provider] || linkRows) && exactByReference(world, t.orderId, files);
  if (exact && !(t.decision === "matched" && t.differences.length === 0))
    throw new Error(`${t.orderId}: decision 1 would close it, but the truth is ${t.decision} ${t.ruleId ?? ""} (${t.differenceTypes.join(", ")})`);
  if (!exact && !early && !t.differenceTypes.includes("unexplained") && (!SHAPE.quoteTerms[files.provider] || linkRows)) {
    return {
      kind: "rule", decision: "suggested_for_review", ruleId: "M3.quote.terms_unknown", differences: [],
      why: linkRows ? "a payment-link row gives the link's address and amount, not its quote's terms or the link's window" : `shape ${files.provider} has no quote rate or validity window${files.provider === "B" ? " (nor the quoted amount)" : ""}`,
    };
  }
  if (early || t.decision === "exception" || t.decision === "any_non_closing") return { kind: "truth", decision: t.decision, ...(t.ruleId ? { ruleId: t.ruleId } : {}), differences: diffs() };
  // step 5 on these files
  const unheld = order.design.payments.some((p) => !p.held);
  // v1 Phase 0.5 (decisions 12 and 14): an exact payment whose provider record names a batch in the settlement report is
  // matched even though a totals-only report links no payment to it (settlement not linked, not settled)
  if (files.settlement === "totals" && t.decision === "matched" && t.differences.length === 0 && unheld && namesKnownBatch(world, t.orderId))
    return { kind: "rule", decision: "matched", ruleId: "M5.grouping.matched_settlement_unlinked", differences: [], why: "matched by reference; a totals-only report links no payment to its batch: settlement not linked, not settled" };
  if (files.settlement === "totals" && isClosing(t.decision) && unheld)
    return { kind: "rule", decision: "suggested_for_review", ruleId: "M5.grouping.proposed_needs_confirmation", differences: diffs(), why: "a totals-only settlement report links no payment to a batch: the grouping is only proposed" };
  const untieable = t.batchIds.filter((b) => !batchTieable(world, truth, b, files));
  if (files.settlement === "lines" && isClosing(t.decision) && untieable.length)
    return { kind: "abstain", decision: "exception", ruleId: "M5.batch.not_tied", why: `batch ${untieable.join(", ")} cannot tie from these files: ${tieGap(world, truth, untieable[0], files)}` };
  // v1 Phase 0.5 (evidence-level split): an exact payment in a tied batch is matched; its imported bank line is shown
  // apart as bank evidence and no longer holds it in review. A payment with any difference still is held.
  if (files.settlement === "lines" && !files.importedLinesVerify && t.decision === "matched" && t.differences.length === 0 && t.batchIds.length)
    return { kind: "rule", decision: "matched", ruleId: "M5.batch.tied_evidence_separate", differences: [], why: "evidence split: matched by reference; the bank line is imported, not bank-authenticated, shown as bank evidence" };
  if (files.settlement === "lines" && !files.importedLinesVerify && isClosing(t.decision) && t.batchIds.length)
    return { kind: "rule", decision: "suggested_for_review", ruleId: "M5.bank.imported_not_verified", differences: diffs(), why: "the bank line is imported, not bank-authenticated, and the policy flag is off" };
  // without a batch, the exact match is decided at step 4 by decision 1's rule (with quote terms: M4.match.no_difference)
  if (exact && t.ruleId === "M4.match.no_difference")
    return { kind: "rule", decision: "matched", ruleId: "M4.exact.no_quote_terms", differences: [], why: "decision 1: exact payment linked by reference, no quote terms needed" };
  return { kind: "truth", decision: t.decision, ...(t.ruleId ? { ruleId: t.ruleId } : {}), differences: diffs() };
}

/** Every provider record of the order names a settlement batch that is in the settlement report. */
function namesKnownBatch(world: SyntheticWorld, orderId: string): boolean {
  const order = world.orders.find((o) => o.orderId === orderId)!;
  const refs = new Set([...order.quoteIds, ...order.linkIds]);
  const recs = world.providerRecords.filter((r) => refs.has(r.ref.linkId ?? r.ref.quoteId ?? ""));
  const known = new Set(world.batches.map((b) => b.batchId));
  return recs.length > 0 && recs.every((r) => r.batchId !== undefined && known.has(r.batchId));
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
