/** rc6 merchant reconciliation entry point. Pure: same input, same output; no I/O, no clock, no randomness. */
import { indexesOf } from "./indexes";
import { resolveClaimedTransfers } from "./claims";
import { buildBridges, type BatchBridge, type ProposedGrouping } from "./bridge";
import { matchPayments, type MatchOutput } from "./match";
import { active, type RuleId } from "./rules";
import { BANK_EVIDENCE_LABEL, TEST_MODE_LABEL, minEvidence, type Attention, type BankEvidenceLevel, type Decision, type HistoryEntry, type MatchRecord, type ReconcileInput, type TestModeLabel } from "./types";

export interface ReconcileResult extends MatchOutput { label: TestModeLabel; entityId: string; bridges: BatchBridge[]; proposedGroupings: ProposedGrouping[] }

const RANK: Record<Decision, number> = { matched: 0, matched_with_difference: 1, suggested_for_review: 2, exception: 3 };

/**
 * Step 5 can only confirm an exact match or make a decision stricter; it never relaxes steps 1–4.
 * v1 Phase 0.5 (decisions 12–16): an imported bank line no longer decides the payment. A payment already exact at step 4
 * in a batch that ties to the cent stays matched (M5.batch.tied_evidence_separate) and its bank evidence level is
 * recorded apart. Everything else is unchanged: a payment with any difference in such a batch is still review
 * (M5.bank.imported_not_verified), a proposed grouping is still review, an untied batch is still an exception.
 */
/**
 * Wave 1 integration guard for M5.grouping.matched_settlement_unlinked: never for an order with a refund (a settlement
 * report refund line, or a per-payment refund row naming the order or its payment, v1 #174), a balance payment link,
 * or any difference. Such an order keeps the proposed-grouping review, exactly as before decisions 12 and 14.
 */
function unlinkedMatchBlocked(rec: MatchRecord, input: ReconcileInput): boolean {
  const pids = new Set(rec.provider.records.map((r) => r.providerPaymentId));
  return rec.explanation.differences.length > 0
    || input.batchLines.some((l) => l.kind === "refund" && l.orderId === rec.orderId)
    || (input.settlementPaymentLines ?? []).some((l) => l.kind === "refund" && (l.orderId === rec.orderId || pids.has(l.providerPaymentId)))
    || input.paymentLinks.some((l) => l.kind === "balance" && l.orderId === rec.orderId);
}

function applyStep5(rec: MatchRecord, bridges: BatchBridge[], groupings: ProposedGrouping[], knownBatches: ReadonlySet<string>, blocked: (r: MatchRecord) => boolean): { decision: Decision; ruleId: RuleId; attention?: Attention; note?: HistoryEntry } | null {
  const ids = new Set(rec.provider.records.map((r) => r.providerPaymentId));
  const mine = bridges.filter((b) => b.paymentIds.some((id) => ids.has(id)));
  const grouped = groupings.filter((g) => g.paymentIds.some((id) => ids.has(id)));
  rec.bank = {
    ...rec.bank,
    status: rec.bank.status === "held_by_provider" ? "held_by_provider" : grouped.length ? "proposed_grouping" : mine.length ? "in_batch" : "not_in_batch",
    batchIds: mine.map((b) => b.batchId), bankLineIds: mine.map((b) => b.bankLineId).filter((x): x is string => !!x),
    batchTied: mine.length > 0 && mine.every((b) => b.tied), settlementVerified: mine.length > 0 && mine.every((b) => b.settlementVerified),
    bankLineLabels: [...new Set(mine.map((b) => b.bankLineLabel).filter((x): x is NonNullable<typeof x> => !!x))],
    // the payment is only as evidenced as its weakest batch, and a batch that does not tie evidences nothing
    evidence: mine.length && !grouped.length ? mine.map((b): BankEvidenceLevel => (b.tied ? b.bankEvidence : "none")).reduce(minEvidence) : "none",
    settled: mine.length > 0 && !grouped.length && mine.every((b) => b.settled),
  };
  const e = rec.explanation;
  if (e.decision === "exception" || e.decidingStep < 4) return null;
  // v1 Phase 0.5 (decisions 12 and 14): an exact payment whose settlement is only a proposed grouping is still matched;
  // settlement is a separate dimension (not linked, not settled, bank evidence none). Only when its provider record
  // itself names a settlement batch that is in the settlement report (a reference, never an amount): a payment the
  // provider names no batch for may be held or unsettled, and stays in review as before.
  if (grouped.length && e.decision === "matched" && !blocked(rec) && active("M5.grouping.matched_settlement_unlinked")
    && rec.provider.records.length > 0 && rec.provider.records.every((r) => r.batchId !== undefined && knownBatches.has(r.batchId))) {
    const note: HistoryEntry = { step: 5, ruleId: "M5.grouping.proposed_needs_confirmation", outcome: "note", detail: `Settlement not linked: the settlement report gives batch totals only, so no payment is linked to batch ${[...new Set(rec.provider.records.map((r) => r.batchId))].join(", ")}; grouping ${grouped.map((g) => g.id).join(", ")} is only proposed. Not settled; ${BANK_EVIDENCE_LABEL[rec.bank.evidence]}. It does not decide the match.` };
    return { decision: "matched", ruleId: "M5.grouping.matched_settlement_unlinked", note };
  }
  if (grouped.length && active("M5.grouping.proposed_needs_confirmation"))
    return { decision: "suggested_for_review", ruleId: "M5.grouping.proposed_needs_confirmation", attention: { owner: "Payment Operations", reason: `No settlement batch ID. Grouping ${grouped.map((g) => g.id).join(", ")} is only proposed.`, nextStep: "Confirm the grouping against the provider's settlement report and the bank line; the engine never closes it." } };
  const offCurrency = mine.find((b) => b.checks.currencyAgrees === false);
  if (offCurrency && active("M5.batch.currency_mismatch"))
    return { decision: "exception", ruleId: "M5.batch.currency_mismatch", attention: { owner: "Payment Operations", reason: `Settlement batch ${offCurrency.batchId} is in ${offCurrency.currency}, but a payment in it or the bank line naming it is in another currency. Amounts are never converted to make them tie.`, nextStep: "Check which bank account and currency the provider settled this batch to, and correct the settlement report or the statement's account." } };
  const untied = mine.find((b) => !b.tied);
  if (untied && active("M5.batch.not_tied"))
    return { decision: "exception", ruleId: "M5.batch.not_tied", attention: { owner: "Payment Operations", reason: `Settlement batch ${untied.batchId} does not tie to the cent (${Object.entries(untied.checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}).`, nextStep: "Get the settlement report and the bank statement for this batch and find the gap." } };
  const unverified = mine.find((b) => !b.settlementVerified);
  if (unverified && e.decision === "matched" && active("M5.batch.tied_evidence_separate")) {
    const note: HistoryEntry = { step: 5, ruleId: "M5.bank.imported_not_verified", outcome: "note", detail: `Batch ${unverified.batchId} ties to the cent; its bank line is imported, not bank-authenticated, so settlement is not verified. ${BANK_EVIDENCE_LABEL[rec.bank.evidence]}. Shown apart; it does not decide the match.` };
    return { decision: "matched", ruleId: "M5.batch.tied_evidence_separate", note };
  }
  if (unverified && active("M5.bank.imported_not_verified"))
    return { decision: "suggested_for_review", ruleId: "M5.bank.imported_not_verified", attention: { owner: "Treasury", reason: `Batch ${unverified.batchId} ties, but its bank line is imported, not bank-authenticated.`, nextStep: "Confirm the credit in the bank feed before treating settlement as verified." } };
  if (mine.length && e.decision === "matched" && active("M5.batch.tied_verified")) return { decision: "matched", ruleId: "M5.batch.tied_verified" };
  return null;
}

export function reconcile(raw: ReconcileInput): ReconcileResult {
  // rc7: provider records named by tx hash only are resolved against chain facts once, for matching and the bridge alike
  const { input } = resolveClaimedTransfers(raw);
  const matched = matchPayments(input);
  const orderOf = (pid: string): string => {
    const ix = indexesOf(input);
    const r = ix.recordByPaymentId.get(pid);
    const id = r?.ref.linkId ?? r?.ref.quoteId;
    return (id === undefined ? undefined : ix.linkById.get(id)?.orderId ?? ix.quoteById.get(id)?.orderId) ?? "unknown";
  };
  const { bridges, groupings } = buildBridges(input, orderOf);
  const exceptions = [...matched.exceptions];
  const knownBatches = new Set(input.batches.map((b) => b.batchId));
  for (const rec of matched.records) {
    const v = applyStep5(rec, bridges, groupings, knownBatches, (r) => unlinkedMatchBlocked(r, input));
    if (v?.note) rec.explanation = { ...rec.explanation, history: [...rec.explanation.history, v.note] };
    const confirms = v?.ruleId === "M5.batch.tied_verified" || v?.ruleId === "M5.batch.tied_evidence_separate" || v?.ruleId === "M5.grouping.matched_settlement_unlinked";
    if (!v || (RANK[v.decision] < RANK[rec.explanation.decision]) || (RANK[v.decision] === RANK[rec.explanation.decision] && !confirms)) continue;
    rec.explanation = { ...rec.explanation, decision: v.decision, decidingStep: 5, ruleId: v.ruleId, history: [...rec.explanation.history, { step: 5, ruleId: v.ruleId, outcome: v.decision === "matched" ? "pass" : "fail", detail: `Decision: ${v.decision}.${v.ruleId === "M5.batch.tied_evidence_separate" || v.ruleId === "M5.grouping.matched_settlement_unlinked" ? ` ${BANK_EVIDENCE_LABEL[rec.bank.evidence]}.${rec.bank.settled ? "" : " Not settled."}` : ""}` }] };
    if (v.attention) rec.attention = v.attention;
    if (v.decision === "exception") exceptions.push({ id: `EX-${rec.orderId}`, step: 5, ruleId: v.ruleId, orderId: rec.orderId, ...v.attention! });
  }
  const writeOffs = matched.writeOffs.filter((w) => matched.records.find((r) => r.orderId === w.orderId)?.explanation.decision === "matched_with_difference");
  exceptions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { label: TEST_MODE_LABEL, entityId: input.entity.id, ...matched, exceptions, writeOffs, bridges, proposedGroupings: groupings };
}
