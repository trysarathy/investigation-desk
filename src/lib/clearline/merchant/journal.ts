/**
 * rc6 journal proposals from match results. Every entry is a proposal (`status: "proposed"`) whose posting rule is
 * pending sign-off. Nothing here posts, approves or moves money; the preparer never approves.
 * Patterns are derived from the case figures [ASSUMPTION: Document A not available; reconcile]:
 *  - provider confirmation: Dr Provider clearing (credited) / Cr AR (up to the invoice) / Cr Customer overpayments (excess);
 *  - approved write-off: Dr Payment shortfall expense (shortfall, sender fee) / Dr Re-quote / rate difference / Cr AR;
 *  - settlement: Dr Bank (net) / Dr Payment processing fees / Dr Sales refunds / Cr Provider clearing (gross).
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
} as const;
export type MerchantAccount = keyof typeof MERCHANT_ACCOUNTS;

export interface JournalLine { side: "debit" | "credit"; account: MerchantAccount; amountMinor: bigint; orderId?: string; batchId?: string; bankAccount?: string }

export interface JournalProposal {
  label: TestModeLabel;
  id: string;
  kind: "provider_confirmation" | "approved_writeoff" | "settlement";
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

  for (const rec of result.records) {
    const e = rec.explanation;
    // Chain evidence first: a provider "paid" or "completed" is a claim, and an amount alone never closes AR.
    const evidenced = (e.decidingStep >= 4 || e.ruleId === "M3.batch.held_by_provider") && !e.differences.some((d) => d.ruleId === "M4.provider.credit_mismatch");
    if (!evidenced && active("J.confirmation.chain_evidenced")) continue;
    let arLeft = rec.ledger.invoice.amountMinor;
    const parts = rec.provider.records
      .map((p) => ({ p, t: rec.chain.transfers.find((t) => p.transferRef && t.txHash === p.transferRef.txHash && t.logIndex === p.transferRef.logIndex && t.network === p.transferRef.network) }))
      .filter((x) => !active("J.confirmation.chain_evidenced") || (x.t && x.t.amountBaseUnits === x.p.receivedBaseUnits))
      .sort((a, b) => ((a.t?.timestamp ?? "") < (b.t?.timestamp ?? "") ? -1 : 1));
    for (const { p, t } of parts) {
      const toAr = active("J.confirmation.overpayment_liability") ? (p.creditedMinor < arLeft ? p.creditedMinor : arLeft) : p.creditedMinor;
      arLeft -= toAr;
      const tag = { orderId: rec.orderId, ...(p.batchId ? { batchId: p.batchId } : {}) };
      const lines = [dr("provider_clearing", p.creditedMinor, tag), cr("accounts_receivable", toAr, tag)];
      if (p.creditedMinor > toAr) lines.push(cr("customer_overpayments", p.creditedMinor - toAr, tag));
      out.push({
        ...base, id: `JP-CONF-${p.providerPaymentId}`, kind: "provider_confirmation", ruleId: p.creditedMinor > toAr ? "J.confirmation.overpayment_liability" : "J.confirmation.chain_evidenced",
        entryDate: t ? localDate(t.timestamp, input.entity.timeZone.utcOffsetMinutes) : null,
        memo: `Provider confirmation of ${p.providerPaymentId} for ${rec.orderId}, backed by transfer ${t?.txHash ?? "none"}.${p.batchId ? "" : " Not in any settlement: clearing stays open as a receivable from the provider."}`,
        lines: lines.filter((l) => l.amountMinor !== 0n),
        evidence: { orderIds: [rec.orderId], providerPaymentIds: [p.providerPaymentId], txHashes: t ? [t.txHash] : [], ...(p.batchId ? { batchId: p.batchId } : {}) },
      });
    }
  }

  for (const wo of result.writeOffs) {
    if (!active("J.writeoff.on_approval")) continue;
    const rec = result.records.find((r) => r.orderId === wo.orderId)!;
    const diffs = rec.explanation.differences.filter((d) => wo.differenceIds.includes(d.id));
    const lines: JournalLine[] = diffs.map((d) => {
      const account: MerchantAccount = RATE_TYPES.includes(d.type) ? "requote_rate_difference" : "payment_shortfall_expense";
      return d.amountMinor < 0n ? dr(account, -d.amountMinor, { orderId: wo.orderId }) : cr(account, d.amountMinor, { orderId: wo.orderId });
    });
    const net = sum(diffs.map((d) => d.amountMinor));
    lines.push(net < 0n ? cr("accounts_receivable", -net, { orderId: wo.orderId }) : dr("customer_overpayments", net, { orderId: wo.orderId }));
    out.push({
      ...base, id: `JP-WO-${wo.orderId}`, kind: "approved_writeoff", ruleId: "J.writeoff.on_approval", entryDate: null, requiresApprovalOf: wo.id,
      memo: `Write-off ${wo.id} (${wo.direction}); post only after it is approved outside the engine.`, lines,
      evidence: { orderIds: [wo.orderId], providerPaymentIds: rec.provider.records.map((p) => p.providerPaymentId), txHashes: rec.chain.transfers.map((t) => t.txHash), differenceIds: wo.differenceIds },
    });
  }

  for (const b of result.bridges) {
    if (!b.tied || (!b.settlementVerified && active("J.settlement.verified_batch"))) continue;
    const batch = input.batches.find((x) => x.batchId === b.batchId)!;
    const bank = input.bankLines.find((l) => l.bankLineId === b.bankLineId)!;
    const tag = { batchId: b.batchId };
    out.push({
      ...base, id: `JP-SETL-${b.batchId}`, kind: "settlement", ruleId: "J.settlement.verified_batch", entryDate: bank.valueDate,
      memo: `Settlement of ${b.batchId} to ${batch.targetBankAccount}${b.bankLineLabel ? ` (${b.bankLineLabel})` : ""}.`,
      lines: [
        dr("bank", batch.netMinor, { ...tag, bankAccount: batch.targetBankAccount }), dr("payment_processing_fees", batch.feesMinor, tag), dr("sales_refunds", batch.refundsMinor, tag), cr("provider_clearing", batch.grossMinor, tag),
      ].filter((l) => l.amountMinor !== 0n),
      evidence: { orderIds: b.lines.find((l) => l.kind === "gross")!.orderIds, providerPaymentIds: b.paymentIds, txHashes: [], batchId: b.batchId, bankLineId: bank.bankLineId },
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Debits minus credits per account, optionally filtered to lines of one batch ("" = lines with no batch). */
export function accountBalance(proposals: readonly JournalProposal[], account: MerchantAccount, filter: { batchId?: string; orderId?: string } = {}): bigint {
  return sum(proposals.flatMap((p) => p.lines)
    .filter((l) => l.account === account && (filter.batchId === undefined || (l.batchId ?? "") === filter.batchId) && (filter.orderId === undefined || l.orderId === filter.orderId))
    .map((l) => (l.side === "debit" ? l.amountMinor : -l.amountMinor)));
}
