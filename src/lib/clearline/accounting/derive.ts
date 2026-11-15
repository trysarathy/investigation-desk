/**
 * Accounting Bridge (rc4) — journal candidates from recorded evidence. PURE: reads the workspace only.
 *
 * Rules (each line names its rule and its evidence ids):
 * - A bank statement DEBIT allocated to a payout by trusted reference (the provider payment id):
 *   - live payout (not returned / failed / cancelled / expired / on hold):
 *     - funded by an approved advance → JR_ADVANCE_DISBURSED: Dr customer_receivable / Cr bank:<account>;
 *     - otherwise → JR_SUPPLIER_PAYOUT_DEBIT: Dr supplier_payable / Cr bank:<account>;
 *   - returned / failed / cancelled / expired / on hold → JR_PAYOUT_DEBIT_NOT_DELIVERED: Dr provider_clearing /
 *     Cr bank:<account>. The supplier payable is never debited, so the books never show the supplier paid.
 * - A statement-confirmed return credit (allocation code RC_RETURN_CONFIRMS_PROVIDER_RETURN) → JR_PAYOUT_RETURN_CREDIT:
 *   Dr bank:<account> / Cr provider_clearing. It reverses the payout's debit; the supplier payable stays open.
 * - A repayment allocation (the credit quoted the repayment reference) → JR_REPAYMENT_BY_REFERENCE:
 *   Dr bank:<account> / Cr customer_receivable.
 * - A FINAL chain observation allocated to its payout by the provider-reported tx hash, payout not terminal →
 *   JR_STABLECOIN_FINAL_TRANSFER: Dr supplier_payable (or customer_receivable) / Cr stablecoin_clearing. It never
 *   touches a bank account: a chain transfer never proves a bank credit.
 * - Review F1 (sandbox rule, for Aashmiin's sign-off): the supplier payable is cleared ONCE, by the evidence that
 *   the beneficiary was paid on the payout's own rail. On the stablecoin route a bank debit only funds the on-ramp
 *   → JR_STABLECOIN_ONRAMP_FUNDING: Dr stablecoin_clearing (in the debit's currency) / Cr bank; the final chain
 *   transfer clears the payable. The SGD↔USDC conversion difference is not proposed (NP_FX_NOT_EVIDENCED).
 * - Review F2: a return credit is proposed only for a CREDIT line; a debit-direction return / reversal gives no
 *   entry (NP_EVIDENCE_CONTRADICTED).
 * - An exported or posted proposal whose evidence no longer gives the same entry, or an exported entry a person
 *   withdrew (review F7), → JR_REVERSAL (lines swapped).
 *
 * Everything else is listed in `notProposed` with its reason: provider reports and provider-reported completion
 * (pending evidence, no entry and no memo line), amount-only or ambiguous lines, unallocated lines, partial
 * remainders, accepted differences, fees and FX (no exact evidence in the engine), non-final or uncounted chain
 * transfers, contradicted evidence.
 */
import { isTerminalForSettlementReport } from "../state";
import { orgDate, stableStringify } from "../tx";
import { evidenceSourceLabel } from "../reconciliation";
import { sha256Hex } from "../sha256";
import { formatMinor } from "../money";
import { JOURNAL_RULE, NOT_PROPOSED } from "./labels";
import type { CurrencyCode, PaymentIntent, ReconciliationAllocation, StatementLine, Workspace } from "../types";
import type { AccountKey, JournalEvidenceRefs, JournalLine, JournalProposal, JournalRuleCode, NotProposedCode, NotProposedItem } from "./types";

export interface JournalCandidate {
  sourceKey: string;
  ruleCode: JournalRuleCode;
  entryDate: string;
  currency: CurrencyCode;
  lines: JournalLine[];
  evidence: JournalEvidenceRefs;
  intentId?: string;
  advanceId?: string;
  obligationId?: string;
  reverses?: string;
  narrative: string;
  showsSupplierPaid: boolean;
  basisHash: string;
}

export interface JournalDerivation {
  candidates: JournalCandidate[];
  notProposed: NotProposedItem[];
}

export const bankKey = (accountRef: string): AccountKey => `bank:${accountRef}`;
const NOT_DELIVERED = (i: PaymentIntent) => isTerminalForSettlementReport(i.status.execution) || i.status.execution === "on_hold";
const ACTIVE_STATUSES = ["proposed", "approved"] as const;
const STANDING_STATUSES = ["exported", "posted"] as const;
export const isActiveProposal = (p: JournalProposal) => (ACTIVE_STATUSES as readonly string[]).includes(p.status);
export const isStandingProposal = (p: JournalProposal) => (STANDING_STATUSES as readonly string[]).includes(p.status);
/** Review F7: an exported entry a person withdrew (rejected after export). It may have been imported, so it is reversed. */
export const isWithdrawnAfterExport = (p: JournalProposal) => p.status === "rejected" && !!p.export;
/** Entries that are (or may be) in the customer's ledger: exported, posted, or withdrawn after export. */
export const isInLedger = (p: JournalProposal) => isStandingProposal(p) || isWithdrawnAfterExport(p);
/** Entries that count towards what the books show: in the ledger, or proposed / approved (a reversal subtracts by its sides). */
export const isCounted = (p: JournalProposal) => isInLedger(p) || isActiveProposal(p);

const emptyRefs = (): JournalEvidenceRefs => ({ statementLineIds: [], allocationIds: [], chainObservationIds: [], repaymentAllocationIds: [], providerEventIds: [], evidenceRecordIds: [] });
const allIds = (r: JournalEvidenceRefs): string[] => [...r.statementLineIds, ...r.allocationIds, ...r.chainObservationIds, ...r.repaymentAllocationIds, ...r.providerEventIds, ...r.evidenceRecordIds];

/** The canonical basis a proposal rests on; a change supersedes it. Dates from the clock (reversals) are excluded. */
export function basisOf(c: Omit<JournalCandidate, "basisHash" | "narrative">): string {
  const sortRefs = Object.fromEntries(Object.entries(c.evidence).map(([k, v]) => [k, [...(v as string[])].sort()]));
  return sha256Hex(stableStringify({
    sourceKey: c.sourceKey, ruleCode: c.ruleCode, currency: c.currency, reverses: c.reverses,
    entryDate: c.ruleCode === "JR_REVERSAL" ? undefined : c.entryDate,
    lines: c.lines.map((l) => [l.accountKey, l.side, l.amountMinor, l.currency, l.ruleCode, [...l.evidenceIds].sort()]),
    evidence: sortRefs, intentId: c.intentId, advanceId: c.advanceId, obligationId: c.obligationId, showsSupplierPaid: c.showsSupplierPaid,
  }));
}

function finish(c: Omit<JournalCandidate, "basisHash">): JournalCandidate {
  return { ...c, basisHash: basisOf(c) };
}

function twoLines(rule: JournalRuleCode, debit: AccountKey, credit: AccountKey, amountMinor: number, currency: CurrencyCode, memo: string, evidenceIds: string[]): JournalLine[] {
  return [
    { lineNo: 1, accountKey: debit, side: "debit", amountMinor, currency, memo, ruleCode: rule, evidenceIds: [...evidenceIds] },
    { lineNo: 2, accountKey: credit, side: "credit", amountMinor, currency, memo, ruleCode: rule, evidenceIds: [...evidenceIds] },
  ];
}

/** Evidence records the engine wrote for a statement line (reference = the bank's own line id, source = its account). */
function lineEvidenceIds(ws: Workspace, line: StatementLine): string[] {
  const src = evidenceSourceLabel(line);
  return ws.evidence.filter((e) => (e.kind === "bank_statement_line" || e.kind === "provider_settlement_report") && e.reference === line.lineId && e.source === src).map((e) => e.id);
}

/** Review F1: whether the payout's route is the stablecoin rail (a bank debit then funds the on-ramp; the chain transfer pays). */
export function onStablecoinRail(ws: Workspace, intent: PaymentIntent): boolean {
  const instr = ws.instructions.find((x) => x.id === intent.instructionId);
  return ws.routes.find((r) => r.id === instr?.routeId)?.rail === "stablecoin_testnet";
}

/**
 * Review F1: the most the supplier payable (or customer receivable) may be debited for one payout, per currency:
 * the payout amount in its source currency, and the quoted recipient amount in its destination currency.
 */
export function payableBound(ws: Workspace, intent: PaymentIntent, currency: CurrencyCode): number {
  if (currency === intent.sourceCurrency) return intent.amountMinor;
  const q = ws.quotes.find((x) => x.id === intent.selectedQuoteId);
  return currency === intent.destinationCurrency ? (q?.estimatedRecipientMinor ?? 0) : 0;
}

const openExceptionIds = (ws: Workspace, pred: (e: Workspace["exceptions"][number]) => boolean) => ws.exceptions.filter((e) => e.status !== "resolved" && pred(e)).map((e) => e.id);

/** Whether a payout is funded by an advance that treasury approved (a decision and an obligation exist). */
function approvedAdvance(ws: Workspace, intent: PaymentIntent) {
  if (!intent.advanceId) return undefined;
  const adv = ws.advances.find((a) => a.id === intent.advanceId);
  const dec = adv && ws.fundingDecisions.find((d) => d.id === adv.decisionId);
  return adv && dec?.outcome === "approve" && adv.obligationId ? adv : undefined;
}

/** Applied provider events that put the payout in a not-delivered state (the claim the classification rests on). */
function notDeliveredEventIds(ws: Workspace, intent: PaymentIntent): string[] {
  return ws.providerEvents.filter((e) => e.intentId === intent.id && e.processingOutcome === "applied" && ["payout.returned", "payout.failed", "payout.on_hold"].includes(e.normalizedType)).map((e) => e.id);
}

export function deriveJournalCandidates(ws: Workspace): JournalDerivation {
  const candidates: JournalCandidate[] = [];
  const notProposed: NotProposedItem[] = [];
  const np = (code: NotProposedCode, detail: string, refs: string[], exceptionIds: string[], amount?: { amountMinor: number; currency: CurrencyCode }) =>
    notProposed.push({ code, text: `${NOT_PROPOSED[code]}. ${detail}`, refs, exceptionIds, ...(amount ? { amount } : {}) });
  const intentById = new Map(ws.intents.map((i) => [i.id, i]));
  const lineById = new Map(ws.statementLines.map((l) => [l.id, l]));
  const ppidOf = (i: PaymentIntent) => ws.instructions.find((x) => x.id === i.instructionId)?.providerPaymentId;
  const payoutsWithEntry = new Set<string>();

  for (const a of ws.allocations) {
    if (a.evidenceKind === "statement_line") {
      const line = lineById.get(a.statementLineId);
      if (!line || line.source !== "bank_statement") continue;
      const lineRefs = { ...emptyRefs(), statementLineIds: [line.id], allocationIds: [a.id], evidenceRecordIds: lineEvidenceIds(ws, line) };
      if (a.target.kind === "payment") {
        const intent = intentById.get(a.target.intentId);
        if (!intent) continue;
        payoutsWithEntry.add(intent.id);
        const ppid = ppidOf(intent) ?? "?";
        const what = `${intent.internalReference} · ${intent.beneficiaryName} · provider payment ${ppid}`;
        const bank = bankKey(line.accountRef);
        const isReturn = a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN");
        if (isReturn && line.direction !== "credit") {
          // Review F2: money went OUT on a "return" / "reversal" line (e.g. the bank reversing a return credit). Never cash in.
          np("NP_EVIDENCE_CONTRADICTED", `Bank line ${line.lineId} (${line.accountRef}) is a ${line.direction} ${line.kind} line for ${what}: money left the account, so it is not a return credit.`, [line.id, a.id, intent.id], openExceptionIds(ws, (e) => e.statementLineId === line.id || e.intentId === intent.id), { amountMinor: line.amountMinor, currency: line.currency });
          continue;
        }
        if (isReturn) {
          const events = notDeliveredEventIds(ws, intent);
          const refs = { ...lineRefs, providerEventIds: events };
          const ids = allIds(refs);
          candidates.push(finish({
            sourceKey: `JR_PAYOUT_RETURN_CREDIT:${a.id}`, ruleCode: "JR_PAYOUT_RETURN_CREDIT", entryDate: line.valueDate, currency: a.currency,
            lines: twoLines("JR_PAYOUT_RETURN_CREDIT", bank, "provider_clearing", a.amountMinor, a.currency, `[SANDBOX] Return credit ${line.lineId} for ${what} — supplier NOT paid; supplier payable stays open`, ids),
            evidence: refs, intentId: intent.id, advanceId: intent.advanceId,
            narrative: `${formatMinor(a.amountMinor, a.currency)} came back on bank line ${line.lineId} (${line.accountRef}) for returned payout ${what}. This reverses the payout's debit; the supplier is NOT paid and the supplier payable stays open.`,
            showsSupplierPaid: false,
          }));
          continue;
        }
        if (line.direction !== "debit") continue; // only debits and return credits are allocated to a payout
        if (NOT_DELIVERED(intent)) {
          const events = notDeliveredEventIds(ws, intent);
          const refs = { ...lineRefs, providerEventIds: events };
          const ids = allIds(refs);
          candidates.push(finish({
            sourceKey: `PAYOUT_DEBIT:${a.id}`, ruleCode: "JR_PAYOUT_DEBIT_NOT_DELIVERED", entryDate: line.valueDate, currency: a.currency,
            lines: twoLines("JR_PAYOUT_DEBIT_NOT_DELIVERED", "provider_clearing", bank, a.amountMinor, a.currency, `[SANDBOX] Debit ${line.lineId} for ${what} — payout ${intent.status.execution.replace(/_/g, " ")}; supplier NOT paid`, ids),
            evidence: refs, intentId: intent.id, advanceId: intent.advanceId,
            narrative: `${formatMinor(a.amountMinor, a.currency)} left the bank on line ${line.lineId} (${line.accountRef}) for ${what}, but the payout is ${intent.status.execution.replace(/_/g, " ")}. Booked to provider clearing: the supplier is NOT paid and the supplier payable stays open.`,
            showsSupplierPaid: false,
          }));
          continue;
        }
        const adv = approvedAdvance(ws, intent);
        const ids = allIds(lineRefs);
        if (onStablecoinRail(ws, intent)) {
          // Review F1: on the stablecoin route the bank debit funds the on-ramp; only the final chain transfer pays the supplier.
          candidates.push(finish({
            sourceKey: `PAYOUT_DEBIT:${a.id}`, ruleCode: "JR_STABLECOIN_ONRAMP_FUNDING", entryDate: line.valueDate, currency: a.currency,
            lines: twoLines("JR_STABLECOIN_ONRAMP_FUNDING", "stablecoin_clearing", bank, a.amountMinor, a.currency, `[SANDBOX] On-ramp funding ${line.lineId} for stablecoin payout ${what} — supplier not yet paid (the final chain transfer pays)`, ids),
            evidence: lineRefs, intentId: intent.id, advanceId: adv?.id, obligationId: adv?.obligationId,
            narrative: `${formatMinor(a.amountMinor, a.currency)} left the bank on line ${line.lineId} (${line.accountRef}) to fund the stablecoin payout ${what}. Booked to stablecoin clearing: the supplier is paid only by the final on-chain transfer to their wallet.`,
            showsSupplierPaid: false,
          }));
        } else if (adv) {
          candidates.push(finish({
            sourceKey: `PAYOUT_DEBIT:${a.id}`, ruleCode: "JR_ADVANCE_DISBURSED", entryDate: line.valueDate, currency: a.currency,
            lines: twoLines("JR_ADVANCE_DISBURSED", "customer_receivable", bank, a.amountMinor, a.currency, `[SANDBOX] Advance ${adv.id} disbursed for ${adv.customerName}: ${what} (bank line ${line.lineId})`, ids),
            evidence: lineRefs, intentId: intent.id, advanceId: adv.id, obligationId: adv.obligationId,
            narrative: `Advance ${adv.id}: ${formatMinor(a.amountMinor, a.currency)} left the bank on line ${line.lineId} (${line.accountRef}) to pay ${adv.supplierName} for ${adv.customerName}, who owes it back under reference ${adv.repaymentReference}.`,
            showsSupplierPaid: true,
          }));
        } else {
          candidates.push(finish({
            sourceKey: `PAYOUT_DEBIT:${a.id}`, ruleCode: "JR_SUPPLIER_PAYOUT_DEBIT", entryDate: line.valueDate, currency: a.currency,
            lines: twoLines("JR_SUPPLIER_PAYOUT_DEBIT", "supplier_payable", bank, a.amountMinor, a.currency, `[SANDBOX] Payout ${what} debited on bank line ${line.lineId}`, ids),
            evidence: lineRefs, intentId: intent.id, advanceId: intent.advanceId,
            narrative: `${formatMinor(a.amountMinor, a.currency)} left the bank on line ${line.lineId} (${line.accountRef}) for ${what}, matched by the provider payment id. The bank debit is the evidence; the supplier's own credit is not independently evidenced.`,
            showsSupplierPaid: true,
          }));
        }
      } else {
        const rpa = ws.repaymentAllocations.find((r) => r.statementLineId === line.id && r.obligationId === (a.target as { obligationId: string }).obligationId);
        const ob = ws.obligations.find((o) => o.id === (a.target as { obligationId: string }).obligationId);
        if (!rpa || !ob) continue;
        const adv = ws.advances.find((x) => x.id === ob.advanceId);
        const refs = { ...lineRefs, repaymentAllocationIds: [rpa.id], evidenceRecordIds: [...new Set([...lineRefs.evidenceRecordIds, rpa.evidenceId])] };
        const ids = allIds(refs);
        candidates.push(finish({
          sourceKey: `JR_REPAYMENT_BY_REFERENCE:${rpa.id}`, ruleCode: "JR_REPAYMENT_BY_REFERENCE", entryDate: line.valueDate, currency: a.currency,
          lines: twoLines("JR_REPAYMENT_BY_REFERENCE", bankKey(line.accountRef), "customer_receivable", a.amountMinor, a.currency, `[SANDBOX] Repayment ${ob.reference} on bank line ${line.lineId}${adv ? ` from ${adv.customerName}` : ""}`, ids),
          evidence: refs, intentId: adv?.intentId, advanceId: ob.advanceId, obligationId: ob.id,
          narrative: `${formatMinor(a.amountMinor, a.currency)} received on bank line ${line.lineId} (${line.accountRef}) quoting repayment reference ${ob.reference}; it reduces the receivable for advance ${ob.advanceId}.`,
          showsSupplierPaid: false,
        }));
      }
    } else {
      const obs = ws.chainObservations.find((o) => o.id === a.statementLineId);
      const intent = a.target.kind === "payment" ? intentById.get(a.target.intentId) : undefined;
      if (!obs || !intent) continue;
      if (obs.status !== "final") continue; // listed below as not final
      if (NOT_DELIVERED(intent)) {
        np("NP_EVIDENCE_CONTRADICTED", `Transfer ${obs.txHash.slice(0, 12)}… is final, but the provider reports payout ${intent.internalReference} ${intent.status.execution.replace(/_/g, " ")}.`, [obs.id, a.id, intent.id], openExceptionIds(ws, (e) => e.intentId === intent.id));
        continue;
      }
      payoutsWithEntry.add(intent.id);
      const adv = approvedAdvance(ws, intent);
      // Review F8: only the first event that reported this hash (applied or recorded); redeliveries and duplicates never change the basis.
      const reported = ws.providerEvents.filter((e) => e.intentId === intent.id && e.detail.txHash === obs.txHash && (e.processingOutcome === "applied" || e.processingOutcome === "recorded_no_state_change")).slice(0, 1).map((e) => e.id);
      const chainEvidence = ws.evidence.filter((e) => e.kind === "chain_observation" && e.intentId === intent.id && e.reference === obs.txHash).map((e) => e.id);
      const refs = { ...emptyRefs(), allocationIds: [a.id], chainObservationIds: [obs.id], providerEventIds: reported, evidenceRecordIds: chainEvidence };
      const ids = allIds(refs);
      const debit = adv ? "customer_receivable" : "supplier_payable";
      candidates.push(finish({
        sourceKey: `JR_STABLECOIN_FINAL_TRANSFER:${a.id}`, ruleCode: "JR_STABLECOIN_FINAL_TRANSFER", entryDate: orgDate(a.createdAt, ws.organization.timezone), currency: a.currency,
        lines: twoLines("JR_STABLECOIN_FINAL_TRANSFER", debit, "stablecoin_clearing", a.amountMinor, a.currency, `[SANDBOX] Final synthetic Base Sepolia transfer ${obs.txHash.slice(0, 18)}… to the beneficiary wallet for ${intent.internalReference} — not a bank credit`, ids),
        evidence: refs, intentId: intent.id, advanceId: adv?.id, obligationId: adv?.obligationId,
        narrative: `${formatMinor(a.amountMinor, a.currency)} reached the beneficiary's registered wallet in a final synthetic testnet transfer (${obs.confirmations} confirmations), matched by the provider-reported tx hash. Booked against stablecoin clearing; this never evidences a bank credit.`,
        showsSupplierPaid: true,
      }));
    }
  }

  // Statement lines that give no entry.
  for (const line of ws.statementLines) {
    const exc = openExceptionIds(ws, (e) => e.statementLineId === line.id);
    const amount = { amountMinor: line.amountMinor, currency: line.currency };
    if (line.source === "provider_settlement_report") {
      np("NP_PROVIDER_REPORT_ONLY", `Line ${line.lineId} (${line.accountRef}) is the provider's report of ${formatMinor(line.amountMinor, line.currency)}.`, [line.id], exc, amount);
      continue;
    }
    const allocated = ws.allocations.filter((a) => a.statementLineId === line.id && a.evidenceKind === "statement_line").reduce((s, a) => s + a.amountMinor, 0);
    if (allocated === 0) {
      const codes = new Set(ws.exceptions.filter((e) => e.statementLineId === line.id).map((e) => e.explanationCode));
      const accepted = ws.exceptions.find((e) => e.statementLineId === line.id && e.status === "resolved" && e.resolution?.acceptedDifference);
      const code: NotProposedCode = codes.has("RC_AMOUNT_ONLY_CANDIDATES") ? "NP_AMOUNT_ONLY_MATCH" : codes.has("RC_AMBIGUOUS_REFERENCE") ? "NP_AMBIGUOUS_REFERENCE" : accepted ? "NP_ACCEPTED_DIFFERENCE" : "NP_UNALLOCATED_LINE";
      const all = ws.exceptions.filter((e) => e.statementLineId === line.id);
      np(code, `Bank line ${line.lineId} (${line.accountRef}), ${line.direction} ${formatMinor(line.amountMinor, line.currency)}, reference "${line.reference || "(none)"}".`, [line.id, ...(accepted ? [accepted.id] : [])], exc.length ? exc : all.filter((e) => e.status !== "resolved" || code === "NP_ACCEPTED_DIFFERENCE").map((e) => e.id), amount);
    } else if (allocated < line.amountMinor) {
      np("NP_PARTIAL_REMAINDER", `Bank line ${line.lineId}: ${formatMinor(line.amountMinor - allocated, line.currency)} of it is not matched.`, [line.id], exc, { amountMinor: line.amountMinor - allocated, currency: line.currency });
    }
  }

  // Payouts: provider-reported only, partial remainders, fees and FX.
  for (const intent of ws.intents) {
    const payAllocs = ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"));
    const exc = openExceptionIds(ws, (e) => e.intentId === intent.id);
    if (intent.status.execution === "provider_reported_completed" && payAllocs.length === 0) {
      const done = ws.providerEvents.filter((e) => e.intentId === intent.id && e.normalizedType === "payout.completed" && e.processingOutcome === "applied").map((e) => e.id);
      np("NP_PROVIDER_COMPLETION_ONLY", `Payout ${intent.internalReference} (${formatMinor(intent.amountMinor, intent.sourceCurrency)}) is reported completed by the provider only.`, [intent.id, ...done], exc, { amountMinor: intent.amountMinor, currency: intent.sourceCurrency });
    }
    const bankCovered = payAllocs.filter((a) => a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency).reduce((s, a) => s + a.amountMinor, 0);
    if (bankCovered > 0 && bankCovered < intent.amountMinor && !NOT_DELIVERED(intent))
      np("NP_PARTIAL_REMAINDER", `Payout ${intent.internalReference}: ${formatMinor(intent.amountMinor - bankCovered, intent.sourceCurrency)} is not evidenced by a bank debit.`, [intent.id], exc, { amountMinor: intent.amountMinor - bankCovered, currency: intent.sourceCurrency });
    // Review F13: what the final chain transfer does not cover (same currency: the indicative fee; another currency: conversion).
    const chainCovered = payAllocs.filter((a) => a.evidenceKind === "chain_observation" && ws.chainObservations.some((o) => o.id === a.statementLineId && o.status === "final")).reduce((s, a) => s + a.amountMinor, 0);
    if (chainCovered > 0 && !NOT_DELIVERED(intent)) {
      const bound = payableBound(ws, intent, "USDC");
      if (intent.sourceCurrency === "USDC" && chainCovered < intent.amountMinor)
        np("NP_PARTIAL_REMAINDER", `Payout ${intent.internalReference}: the final chain transfer covers ${formatMinor(chainCovered, "USDC")} of ${formatMinor(intent.amountMinor, "USDC")}; ${formatMinor(intent.amountMinor - chainCovered, "USDC")} is not evidenced (likely the indicative fee; not proposed).`, [intent.id], exc, { amountMinor: intent.amountMinor - chainCovered, currency: "USDC" });
      else if (intent.sourceCurrency !== "USDC" && bound > 0 && chainCovered < bound)
        np("NP_PARTIAL_REMAINDER", `Payout ${intent.internalReference}: the final chain transfer covers ${formatMinor(chainCovered, "USDC")} of the quoted ${formatMinor(bound, "USDC")}.`, [intent.id], exc, { amountMinor: bound - chainCovered, currency: "USDC" });
    }
    if (!payoutsWithEntry.has(intent.id)) continue;
    const q = ws.quotes.find((x) => x.id === intent.selectedQuoteId);
    const fees = (q?.providerFeeMinor ?? 0) + (q?.platformFeeMinor ?? 0);
    if (q && fees > 0)
      np("NP_FEE_NOT_EVIDENCED", `Payout ${intent.internalReference}: the quote shows ${formatMinor(fees, intent.sourceCurrency)} of indicative fees; no statement line or provider charge evidences them.`, [intent.id, q.id], [], { amountMinor: fees, currency: intent.sourceCurrency });
    if (intent.sourceCurrency !== intent.destinationCurrency)
      np("NP_FX_NOT_EVIDENCED", onStablecoinRail(ws, intent)
        ? `Payout ${intent.internalReference} funds the on-ramp in ${intent.sourceCurrency} and pays ${intent.destinationCurrency} on chain; the conversion difference left in stablecoin clearing is not proposed (no rate evidence).`
        : `Payout ${intent.internalReference} converts ${intent.sourceCurrency} to ${intent.destinationCurrency} at a rate the engine has no evidence of; its entry is in ${intent.sourceCurrency}, the currency that left the bank.`, [intent.id], []);
  }

  // Chain observations that give no entry.
  for (const o of ws.chainObservations) {
    if (o.status === "rejected_unsupported") {
      np("NP_CHAIN_NOT_COUNTED", `Transfer ${o.txHash.slice(0, 12)}… on ${o.network} is not counted.`, [o.id], openExceptionIds(ws, (e) => e.intentId === o.intentId && e.supportingEventIds.includes(o.id)));
      continue;
    }
    const allocated = ws.allocations.some((a) => a.evidenceKind === "chain_observation" && a.statementLineId === o.id);
    if (o.status !== "final" || !allocated)
      np("NP_CHAIN_NOT_FINAL", `Transfer ${o.txHash.slice(0, 12)}… has ${o.confirmations} of ${o.finalityThreshold} confirmations${o.status === "final" ? " but is not matched by the provider-reported tx hash" : ""}.`, [o.id], openExceptionIds(ws, (e) => e.intentId === o.intentId), { amountMinor: o.amountMinor, currency: "USDC" });
  }

  // Reversals of exported or posted proposals whose evidence no longer gives the same entry.
  const bySource = new Map(candidates.map((c) => [c.sourceKey, c]));
  const proposals = ws.accounting?.proposals ?? [];
  for (const p of proposals) {
    if (p.ruleCode === "JR_REVERSAL" || !isInLedger(p)) continue;
    const now = bySource.get(p.sourceKey);
    const withdrawn = isWithdrawnAfterExport(p);
    if (!withdrawn && now && now.basisHash === p.basisHash) continue;
    const why = withdrawn ? `${p.rejection!.by} withdrew it after export ${p.export!.exportId} (${p.rejection!.reason.slice(0, 60)}); the file may already be imported` : now ? `its evidence now gives a different entry (${JOURNAL_RULE[now.ruleCode]})` : "its evidence no longer supports an entry";
    const lines: JournalLine[] = p.lines.map((l) => ({ ...l, side: l.side === "debit" ? "credit" : "debit", ruleCode: "JR_REVERSAL", memo: `[SANDBOX] Reversal of ${p.id}: ${why}` }));
    candidates.push(finish({
      sourceKey: `REV:${p.id}`, ruleCode: "JR_REVERSAL", entryDate: orgDate(ws.asOf, ws.organization.timezone), currency: p.currency,
      lines, evidence: structuredClone(p.evidence), intentId: p.intentId, advanceId: p.advanceId, obligationId: p.obligationId, reverses: p.id,
      narrative: `Reverses ${withdrawn ? "exported" : p.status} entry ${p.id} (${JOURNAL_RULE[p.ruleCode]}) because ${why}. Corrections are new entries; ${p.id} itself is never changed.`,
      showsSupplierPaid: false,
    }));
  }
  return { candidates, notProposed };
}

/** Sum of debits and credits per currency (BigInt, exact). */
export function balanceOf(lines: Pick<JournalLine, "side" | "amountMinor" | "currency">[]): Map<CurrencyCode, { debit: bigint; credit: bigint }> {
  const out = new Map<CurrencyCode, { debit: bigint; credit: bigint }>();
  for (const l of lines) {
    const t = out.get(l.currency) ?? { debit: 0n, credit: 0n };
    if (l.side === "debit") t.debit += BigInt(l.amountMinor);
    else t.credit += BigInt(l.amountMinor);
    out.set(l.currency, t);
  }
  return out;
}

export const isBalanced = (lines: Pick<JournalLine, "side" | "amountMinor" | "currency">[]): boolean =>
  lines.length >= 2 && [...balanceOf(lines).values()].every((t) => t.debit === t.credit && t.debit > 0n);

/**
 * Signed movement per (account key, currency) over the given entries, debit positive (BigInt). Reversals carry the
 * opposite sides, so they subtract from what they reverse.
 */
export function netByKey(ps: Pick<JournalProposal, "lines">[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const p of ps) for (const l of p.lines) m.set(`${l.accountKey}\u0000${l.currency}`, (m.get(`${l.accountKey}\u0000${l.currency}`) ?? 0n) + BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n));
  return m;
}

/**
 * Review F1 / F5: problems with what the counted entries (in the ledger, proposed or approved) show, or undefined:
 * - per payout and currency, the net debit to supplier_payable + customer_receivable never exceeds payableBound;
 * - per bank statement line, the net bank movement never exceeds the line amount (a bank line is never booked twice).
 */
export function ledgerProblem(ws: Workspace, only?: "payable" | "bank"): string | undefined {
  const counted = (ws.accounting?.proposals ?? []).filter(isCounted);
  const byIntent = new Map<string, JournalProposal[]>();
  for (const p of counted) if (p.intentId) byIntent.set(p.intentId, [...(byIntent.get(p.intentId) ?? []), p]);
  if (only !== "bank") for (const [id, ps] of byIntent) {
    const intent = ws.intents.find((i) => i.id === id);
    if (!intent) continue;
    const net = netByKey(ps);
    const byCur = new Map<CurrencyCode, bigint>();
    for (const [k, v] of net) {
      const [key, cur] = k.split("\u0000") as [string, CurrencyCode];
      if (key === "supplier_payable" || key === "customer_receivable") byCur.set(cur, (byCur.get(cur) ?? 0n) + v);
    }
    for (const [cur, v] of byCur) if (v > BigInt(payableBound(ws, intent, cur))) return `payout ${id}: the supplier payable / receivable is debited ${formatMinor(Number(v), cur)}, more than the payout (${formatMinor(payableBound(ws, intent, cur), cur)})`;
  }
  if (only !== "payable") for (const line of ws.statementLines) {
    let v = 0n;
    for (const p of counted) if (p.evidence.statementLineIds.includes(line.id)) for (const l of p.lines) if (l.accountKey.startsWith("bank:")) v += BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n);
    if (v > BigInt(line.amountMinor) || -v > BigInt(line.amountMinor)) return `bank line ${line.id}: booked ${formatMinor(Number(v < 0n ? -v : v), line.currency)}, more than the line (${formatMinor(line.amountMinor, line.currency)})`;
  }
  return undefined;
}

export type { ReconciliationAllocation };
