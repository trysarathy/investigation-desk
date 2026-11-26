/**
 * Journal proposals from match results, reconciled line by line with the founder's Document A ("use-case mapping",
 * Nov 2026). Every entry is a proposal (`status: "proposed"`) whose posting rule is pending sign-off. Nothing here
 * posts, approves or moves money; the preparer never approves.
 *  - payment (per provider record, chain-evidenced): Dr Provider clearing (credited) / Cr AR / Cr Customer overpayments
 *    (excess). On the part that closes the invoice, the difference lines Document A marks "(on approval)" are in the
 *    same entry: Dr Payment shortfall expense / Dr Re-quote / rate difference, and AR is credited up to the invoice.
 *    Those lines carry `onApproval` and the entry `requiresApprovalOf`: it posts only after that approval.
 *  - refund netted in a settlement: Dr Sales refunds / Cr Provider clearing (Document A, Case 2: its own entry).
 *  - settlement: Dr Bank (net) / Dr Payment processing fees / Cr Provider clearing (gross − refunds).
 * Provider clearing therefore nets to zero for every tied, verified batch.
 */
import { localDate, sum } from "./amounts";
import type { ReconcileResult } from "./reconcile";
import { active, type JournalRuleId } from "./rules";
import { TEST_MODE_LABEL, type DifferenceType, type FiatCurrency, type ReconcileInput, type TestModeLabel } from "./types";

export const MERCHANT_ACCOUNTS = {
  provider_clearing: "Provider clearing",
  accounts_receivable: "Accounts receivable",
  customer_overpayments: "Customer overpayments (liability)",
  payment_shortfall_expense: "Payment shortfall expense",
  requote_rate_difference: "Re-quote / rate difference",
  payment_processing_fees: "Payment processing fees",
  sales_refunds: "Sales refunds",
  bank: "Bank",
  // v1 (decision 9, FX posting rules pending the founder's sign-off): only period-end revaluation proposals use it
  unrealised_fx: "Unrealised FX gain/loss",
} as const;
export type MerchantAccount = keyof typeof MERCHANT_ACCOUNTS;

export interface JournalLine {
  side: "debit" | "credit"; account: MerchantAccount; amountMinor: bigint; orderId?: string; batchId?: string; bankAccount?: string;
  /** Document A "(on approval)": this line posts only after the named approval (a write-off or a resolution). */
  onApproval?: string;
}

export interface JournalProposal {
  label: TestModeLabel;
  id: string;
  kind: "provider_confirmation" | "approved_writeoff" | "refund" | "settlement" | "fx_revaluation";
  status: "proposed";
  postingRuleStatus: "pending_sign_off";
  ruleId: JournalRuleId;
  entityId: string;
  currency: FiatCurrency;
  entryDate: string | null;
  /** A write-off entry may be posted only after the write-off is approved outside the engine. */
  requiresApprovalOf?: string;
  memo: string;
  lines: JournalLine[];
  evidence: { orderIds: string[]; providerPaymentIds: string[]; txHashes: string[]; batchId?: string; bankLineId?: string; differenceIds?: string[] };
}

const RATE_TYPES: readonly DifferenceType[] = ["rate_difference", "requote_after_expiry"];
const dr = (account: MerchantAccount, amountMinor: bigint, extra: Partial<JournalLine> = {}): JournalLine => ({ side: "debit", account, amountMinor, ...extra });
const cr = (account: MerchantAccount, amountMinor: bigint, extra: Partial<JournalLine> = {}): JournalLine => ({ side: "credit", account, amountMinor, ...extra });

export function proposeJournals(input: ReconcileInput, result: ReconcileResult): JournalProposal[] {
  const cur = input.entity.functionalCurrency;
  const base = { label: TEST_MODE_LABEL, status: "proposed" as const, postingRuleStatus: "pending_sign_off" as const, entityId: input.entity.id, currency: cur };
  const out: JournalProposal[] = [];

  // v1 (Phase 0): how a token-priced invoice is booked (its fiat value, FX gain or loss) is pending the founder's
  // sign-off, so no entry is proposed for it, nor for a batch that settles one of its payments.
  const tokenPriced = new Set(result.records.filter((r) => r.ledger.invoice.price).map((r) => r.orderId));
  for (const rec of result.records) {
    if (tokenPriced.has(rec.orderId)) continue;
    const e = rec.explanation;
    // Chain evidence first: a provider "paid" or "completed" is a claim, and an amount alone never closes AR.
    const evidenced = (e.decidingStep >= 4 || e.ruleId === "M3.batch.held_by_provider") && !e.differences.some((d) => d.ruleId === "M4.provider.credit_mismatch");
    if (!evidenced && active("J.confirmation.chain_evidenced")) continue;
    // Document A "(on approval)" lines: an engine-proposed write-off, or a re-quote/rate difference sent for review
    // (the controller decides who bears it: Case 1 BK-24836).
    const wo = result.writeOffs.find((w) => w.orderId === rec.orderId);
    const reviewRate = !wo && e.decision === "suggested_for_review" && e.differences.length > 0 && e.differences.every((d) => RATE_TYPES.includes(d.type) && d.amountMinor < 0n);
    const approvalDiffs = !active("J.writeoff.on_approval") ? [] : wo ? e.differences.filter((d) => wo.differenceIds.includes(d.id)) : reviewRate ? e.differences : [];
    const approval = wo ? wo.id : reviewRate ? `resolution:${rec.orderId}` : undefined;
    let arLeft = rec.ledger.invoice.amountMinor;
    const parts = rec.provider.records
      .map((p) => ({ p, t: rec.chain.transfers.find((t) => p.transferRef && t.txHash === p.transferRef.txHash && t.logIndex === p.transferRef.logIndex && t.network === p.transferRef.network) }))
      .filter((x) => !active("J.confirmation.chain_evidenced") || (x.t && x.t.amountBaseUnits === x.p.receivedBaseUnits))
      .sort((a, b) => ((a.t?.timestamp ?? "") < (b.t?.timestamp ?? "") ? -1 : 1));
    parts.forEach(({ p, t }, i) => {
      const last = i === parts.length - 1;
      const tag = { orderId: rec.orderId, ...(p.batchId ? { batchId: p.batchId } : {}) };
      const diffs = last && approval ? approvalDiffs : [];
      // net < 0: shortfall the approval absorbs (AR closes by more than was credited); net > 0: excess it absorbs.
      const net = sum(diffs.map((d) => d.amountMinor));
      const target = p.creditedMinor - net;
      const toAr = active("J.confirmation.overpayment_liability") ? (target < arLeft ? target : arLeft) : target;
      arLeft -= toAr;
      const lines: JournalLine[] = [dr("provider_clearing", p.creditedMinor, tag)];
      for (const d of diffs) {
        const account: MerchantAccount = RATE_TYPES.includes(d.type) ? "requote_rate_difference" : "payment_shortfall_expense";
        lines.push(d.amountMinor < 0n ? dr(account, -d.amountMinor, { orderId: rec.orderId, onApproval: approval }) : cr(account, d.amountMinor, { orderId: rec.orderId, onApproval: approval }));
      }
      lines.push(cr("accounts_receivable", toAr, tag));
      if (target > toAr) lines.push(cr("customer_overpayments", target - toAr, tag));
      out.push({
        ...base, id: `JP-CONF-${p.providerPaymentId}`, kind: "provider_confirmation", ruleId: diffs.length ? "J.writeoff.on_approval" : target > toAr ? "J.confirmation.overpayment_liability" : "J.confirmation.chain_evidenced",
        entryDate: t ? localDate(t.timestamp, input.entity.timeZone.utcOffsetMinutes) : null,
        ...(diffs.length ? { requiresApprovalOf: approval } : {}),
        memo: `Provider confirmation of ${p.providerPaymentId} for ${rec.orderId}, backed by transfer ${t?.txHash ?? "none"}.${p.batchId ? "" : " Not in any settlement: clearing stays open as a receivable from the provider."}${diffs.length ? ` The ${diffs.map((d) => d.type.replace(/_/g, " ")).join(" and ")} line${diffs.length > 1 ? "s post" : " posts"} only after ${approval} is approved.` : ""}`,
        lines: lines.filter((l) => l.amountMinor !== 0n),
        evidence: { orderIds: [rec.orderId], providerPaymentIds: [p.providerPaymentId], txHashes: t ? [t.txHash] : [], ...(p.batchId ? { batchId: p.batchId } : {}), ...(diffs.length ? { differenceIds: diffs.map((d) => d.id) } : {}) },
      });
    });
  }

  for (const b of result.bridges) {
    if (!b.tied || (!b.settlementVerified && active("J.settlement.verified_batch"))) continue;
    // v1 (decision 9): a batch in another currency than the entity's (e.g. to the SGD entity's USD account) is not
    // proposed: how it is booked (at which rate, realised FX at settlement) is pending the founder's sign-off
    // (docs/POSTING_RULES.md, "Other-currency bank accounts"), and the journal files carry one currency per entity.
    if (b.currency !== cur) continue;
    if (b.lines.some((l) => l.orderIds.some((o) => tokenPriced.has(o)))) continue;
    const batch = input.batches.find((x) => x.batchId === b.batchId)!;
    const bank = input.bankLines.find((l) => l.bankLineId === b.bankLineId)!;
    const tag = { batchId: b.batchId };
    if (batch.refundsMinor > 0n && active("J.settlement.refund_netted")) {
      const refunds = b.lines.filter((l) => l.kind === "refund_netted");
      out.push({
        ...base, id: `JP-RFND-${b.batchId}`, kind: "refund", ruleId: "J.settlement.refund_netted", entryDate: bank.valueDate,
        memo: `Refund${refunds.length > 1 ? "s" : ""} netted in ${b.batchId}${refunds.length ? ` (${refunds.flatMap((l) => l.orderIds).join(", ")})` : ""}: the provider paid the customer from money it owes the merchant.`,
        lines: [dr("sales_refunds", batch.refundsMinor, { ...tag, ...(refunds.length === 1 && refunds[0].orderIds.length === 1 ? { orderId: refunds[0].orderIds[0] } : {}) }), cr("provider_clearing", batch.refundsMinor, tag)],
        evidence: { orderIds: refunds.flatMap((l) => l.orderIds), providerPaymentIds: [], txHashes: [], batchId: b.batchId, bankLineId: bank.bankLineId },
      });
    }
    const refundSeparately = batch.refundsMinor > 0n && active("J.settlement.refund_netted");
    out.push({
      ...base, id: `JP-SETL-${b.batchId}`, kind: "settlement", ruleId: "J.settlement.verified_batch", entryDate: bank.valueDate,
      memo: `Settlement of ${b.batchId} to ${batch.targetBankAccount}${b.bankLineLabel ? ` (${b.bankLineLabel})` : ""}.`,
      lines: [
        dr("bank", batch.netMinor, { ...tag, bankAccount: batch.targetBankAccount }), dr("payment_processing_fees", batch.feesMinor, tag),
        ...(refundSeparately ? [] : [dr("sales_refunds", batch.refundsMinor, tag)]), cr("provider_clearing", refundSeparately ? batch.grossMinor - batch.refundsMinor : batch.grossMinor, tag),
      ].filter((l) => l.amountMinor !== 0n),
      evidence: { orderIds: b.lines.find((l) => l.kind === "gross")!.orderIds, providerPaymentIds: b.paymentIds, txHashes: [], batchId: b.batchId, bankLineId: bank.bankLineId },
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Debits minus credits per account, optionally filtered to lines of one batch ("" = lines with no batch).
 * `approvedOnly` leaves out the whole of any entry still waiting for its approval.
 */
export function accountBalance(proposals: readonly JournalProposal[], account: MerchantAccount, filter: { batchId?: string; orderId?: string; approvedOnly?: boolean } = {}): bigint {
  return sum(proposals.filter((p) => !filter.approvedOnly || !p.requiresApprovalOf).flatMap((p) => p.lines)
    .filter((l) => l.account === account && (filter.batchId === undefined || (l.batchId ?? "") === filter.batchId) && (filter.orderId === undefined || l.orderId === filter.orderId))
    .map((l) => (l.side === "debit" ? l.amountMinor : -l.amountMinor)));
}
