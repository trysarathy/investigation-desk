/**
 * Investigation view model. Deterministic rules with explanation codes; no generated prose that
 * claims more certainty than the evidence supports.
 */
import { fundingProjection, obligationOutstanding } from "./funding";
import { formatMinor } from "./money";
import { RECONCILIATION_CODE_TEXT, isAgreeingProviderReport, providerReportLinesFor } from "./reconciliation";
import { isTerminalForSettlementReport } from "./state";
import type {
  CaseReport,
  EvidenceTimelineEntry,
  ExceptionCategory,
  ExceptionStatus,
  Finding,
  InvestigationView,
  PaymentIntent,
  ProviderEvent,
  ReconciliationException,
  Result,
  Workspace,
} from "./types";

export const ENGINE_DISCLAIMER =
  "TEST MODE · fictional sandbox data. Provider statuses are provider claims; settlement evidence is shown separately. Clearline does not move money, hold funds or make compliance or credit decisions.";

export const getIntent = (ws: Workspace, id: string): PaymentIntent | undefined => ws.intents.find((i) => i.id === id);

export const timelineFor = (ws: Workspace, intentId: string): ProviderEvent[] =>
  ws.providerEvents.filter((e) => e.intentId === intentId).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id.localeCompare(b.id));

export function listExceptions(ws: Workspace, filter: { status?: ExceptionStatus | "unresolved"; category?: ExceptionCategory; intentId?: string } = {}): ReconciliationException[] {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return ws.exceptions
    .filter((e) => !filter.status || (filter.status === "unresolved" ? e.status !== "resolved" : e.status === filter.status))
    .filter((e) => !filter.category || e.category === filter.category)
    .filter((e) => !filter.intentId || e.intentId === filter.intentId)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

const f = (code: string, text: string, refs: string[] = []): Finding => ({ code, text, refs });

export function investigate(ws: Workspace, intentId: string): Result<InvestigationView> {
  const intent = getIntent(ws, intentId);
  if (!intent) return { ok: false, error: { code: "not_found", message: "Intent not found.", entityId: intentId } };
  const instr = ws.instructions.find((i) => i.id === intent.instructionId);
  const quote = ws.quotes.find((q) => q.id === intent.selectedQuoteId);
  const route = ws.routes.find((r) => r.id === quote?.routeId);
  const events = timelineFor(ws, intent.id);
  const providerEvents = events.filter((e) => e.provenance !== "clearline_timer");
  const applied = providerEvents.filter((e) => e.processingOutcome === "applied" || e.processingOutcome === "recorded_no_state_change");
  const exceptions = listExceptions(ws).filter((e) => e.intentId === intent.id || (intent.advanceId && e.advanceId === intent.advanceId));
  const open = exceptions.filter((e) => e.status !== "resolved");
  const hold = ws.holds.find((h) => h.intentId === intent.id);
  const chain = ws.chainObservations.filter((o) => o.intentId === intent.id).at(-1);
  const funding = intent.advanceId ? fundingProjection(ws).rows.find((r) => r.advanceId === intent.advanceId) : undefined;
  const s = intent.status;
  const codes: string[] = [];
  const add = <T extends Finding>(list: T[], x: T) => { list.push(x); codes.push(x.code); };

  // What the provider reported
  const prFindings: Finding[] = [];
  const last = applied.at(-1);
  if (!instr?.providerPaymentId) add(prFindings, f("PR_NOT_SUBMITTED", "Nothing has been sent to a provider."));
  else if (last) add(prFindings, f("PR_LAST_" + last.normalizedType.replace(".", "_").toUpperCase(), `Last provider report: ${last.normalizedType} (provider claim, ${last.provenance}).`, [last.id]));
  if (applied.some((e) => e.normalizedType === "payout.completed")) add(prFindings, f("PR_COMPLETED_IS_PROVIDER_CLAIM", "The provider reports completion. This is the provider's claim, not settlement evidence.", applied.filter((e) => e.normalizedType === "payout.completed").map((e) => e.id)));
  for (const e of providerEvents.filter((x) => x.processingOutcome === "stored_late_no_regression")) add(prFindings, f("PR_LATE_EVENT_STORED", `Late ${e.normalizedType} (sequence ${e.sequence}) stored without changing state.`, [e.id]));
  for (const e of providerEvents.filter((x) => x.processingOutcome === "duplicate_ignored")) add(prFindings, f("PR_DUPLICATE_IGNORED", `Duplicate delivery of ${e.providerEventId} ignored.`, [e.id]));
  for (const e of providerEvents.filter((x) => x.processingOutcome === "rejected_signature")) add(prFindings, f("PR_BAD_SIGNATURE_REJECTED", "A webhook with an invalid signature was rejected and not applied.", [e.id]));

  // Independent evidence
  const independent: Finding[] = [];
  for (const ev of ws.evidence.filter((e) => e.intentId === intent.id && e.independent)) {
    if (ev.kind === "bank_statement_line") add(independent, f("IE_BANK_STATEMENT_LINE", ev.description, [ev.id]));
    else if (ev.kind === "chain_observation") add(independent, f("IE_CHAIN_OBSERVATION", ev.description, [ev.id]));
  }
  if (chain) add(independent, f(chain.status === "final" ? "IE_CHAIN_FINAL" : chain.status === "rejected_unsupported" ? "IE_CHAIN_UNSUPPORTED_NOT_COUNTED" : "IE_CHAIN_NOT_FINAL", `Synthetic Base Sepolia transfer: ${chain.status}, ${chain.confirmations}/${chain.finalityThreshold} confirmations.`, [chain.id]));
  if (!independent.length) add(independent, f("IE_NONE", "No independent evidence has been recorded."));

  // Unknowns
  const unknowns: Finding[] = [];
  const submitted = Boolean(instr?.providerPaymentId);
  if (submitted && s.settlement === "none") add(unknowns, f("UK_NO_INDEPENDENT_SETTLEMENT_EVIDENCE", "No bank statement or chain evidence of settlement yet."));
  if (s.settlementScope === "bank_statement") add(unknowns, f("UK_BENEFICIARY_CREDIT_NOT_EVIDENCED", "The bank statement evidences the payout debit, not the beneficiary's credit."));
  if (s.settlementScope === "provider_report") add(unknowns, f("UK_ONLY_PROVIDER_SETTLEMENT_REPORT", "Only a provider settlement report has been matched; no independent bank evidence."));
  if (s.settlementScope === "onchain_transfer" || route?.rail === "stablecoin_testnet") {
    add(unknowns, f("UK_BANK_CREDIT_NOT_PROVEN_BY_CHAIN", "A chain transfer never proves a supplier bank credit."));
    add(unknowns, f("UK_WALLET_OWNERSHIP_NOT_VERIFIED", "The sandbox does not verify who controls the receiving wallet."));
  }
  if (applied.some((e) => e.normalizedType === "payout.completed") && !providerEvents.some((e) => e.normalizedType === "payout.in_transit"))
    add(unknowns, f("UK_IN_TRANSIT_NOT_REPORTED", "The provider never reported an in-transit event; none was inferred."));
  if (open.some((e) => e.category === "provider_timeout")) add(unknowns, f("UK_PROVIDER_OUTCOME_UNKNOWN", "The provider has not responded; the payout's outcome is unknown."));
  // Final check C1: a verified/observed bank debit on a held payout means the money left the account,
  // not that the supplier was paid.
  if (s.execution === "on_hold" && s.settlementScope === "bank_statement" && (s.settlement === "verified" || s.settlement === "observed"))
    add(unknowns, f("UK_DEBITED_FUNDS_HELD_BY_PARTNER", "Money left the account (bank debit), but the partner holds the payout. The supplier has not been paid.", hold ? [hold.id] : []));
  if (hold && hold.status !== "released" && hold.status !== "rejected") add(unknowns, f("UK_HOLD_OUTCOME_PENDING", `Partner hold is ${hold.status}; the outcome depends on the partner and your compliance reviewer.`, [hold.id]));

  // Contradictions
  const contradictions: Finding[] = [];
  for (const e of open.filter((x) => x.category === "contradictory_evidence" || x.explanationCode === "EV_SAME_ID_DIFFERENT_PAYLOAD"))
    add(contradictions, f(e.explanationCode, e.explanation, [e.id, ...e.supportingEventIds]));
  // CHANGE 5 (F2): a provider report below the payout amount is a disagreement with the payout.
  for (const e of open.filter((x) => x.explanationCode === "RC_UNDER_AMOUNT_REPORT" && !contradictions.some((c) => c.refs[0] === x.id)))
    add(contradictions, f(e.explanationCode, e.explanation, [e.id, ...(e.statementLineId ? [e.statementLineId] : [])]));
  // Review v2 (M1, derived): a stored workspace can carry a terminal payout with a provider report that
  // was never flagged (e.g. saved before this rule). It is still shown as a contradiction.
  if (isTerminalForSettlementReport(s.execution))
    for (const l of providerReportLinesFor(ws, intent).filter((x) => isAgreeingProviderReport(x)))
      add(contradictions, f("RC_REPORT_ON_TERMINAL_PAYOUT", `${RECONCILIATION_CODE_TEXT.RC_REPORT_ON_TERMINAL_PAYOUT} Line ${l.lineId}; the payout is ${s.execution}.`, [l.id]));
  if (s.settlement === "contradicted" && !contradictions.length) add(contradictions, f("CT_SETTLEMENT_CONTRADICTED", "Settlement evidence is contradicted by another source."));

  // Financially outstanding
  const outstanding: InvestigationView["outstanding"] = [];
  // rc3 (C-3): a chain allocation reconciles the payout only while its observation is still final.
  const finalObs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status === "final");
  const chainMatched = !!finalObs && ws.allocations.some((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === intent.id && a.statementLineId === finalObs.id);
  const matched = chainMatched
    ? intent.amountMinor
    : ws.allocations
        .filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
        .reduce((t, a) => t + a.amountMinor, 0);
  const money = (amountMinor: number) => ({ amountMinor, currency: intent.sourceCurrency });
  if (s.execution === "returned") {
    const returned = ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).reduce((t, a) => t + a.amountMinor, 0);
    outstanding.push({ code: returned ? "OS_RETURN_RECEIVED_SUPPLIER_UNPAID" : "OS_RETURN_NOT_YET_RECEIVED", text: returned ? "Returned funds appear on the statement; the supplier remains unpaid." : "Provider reports a return; returned funds not yet seen on a statement. The supplier remains unpaid.", amount: money(intent.amountMinor) });
  } else if (submitted && !isTerminalForSettlementReport(s.execution) && matched < intent.amountMinor)
    outstanding.push({ code: matched ? "OS_PARTIALLY_RECONCILED" : "OS_NOT_RECONCILED", text: matched ? "Part of the payout is reconciled; the remainder is not." : "The payout amount is not yet reconciled to a statement.", amount: money(intent.amountMinor - matched) });
  if (funding && funding.outstanding.amountMinor > 0)
    outstanding.push({ code: funding.overdue ? "OS_ADVANCE_OVERDUE" : "OS_ADVANCE_OUTSTANDING", text: `Customer repayment outstanding on advance ${funding.advanceId}${funding.obligation ? `, due ${funding.obligation.dueDate}, reference ${funding.obligation.reference}` : ""}.`, amount: funding.outstanding });
  for (const e of open.filter((x) => x.category === "missing_payment_reference" || x.explanationCode === "RC_AMOUNT_ONLY_CANDIDATES"))
    outstanding.push({ code: "OS_UNALLOCATED_RECEIPT", text: `Unallocated receipt (${e.impact ? formatMinor(e.impact.amountMinor, e.impact.currency) : "amount unknown"}) — not applied to any obligation without a reference.`, amount: e.impact });
  codes.push(...outstanding.map((o) => o.code));

  // CHANGE 5 (F2): structured differences from provider reports and bank lines linked to this payout.
  const linkedLineIds = new Set([
    ...ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id).map((a) => a.statementLineId),
    ...ws.exceptions.filter((x) => x.intentId === intent.id && x.statementLineId).map((x) => x.statementLineId!),
  ]);
  // Review v2 (M3): only differences that still apply are current ("financially outstanding"); the rest
  // are history. A bank partial applies while the payout's bank allocations are below its amount (and
  // the payout is not terminal); a provider under-amount report applies while its exception is open.
  const remainderOpen = submitted && !isTerminalForSettlementReport(s.execution) && matched < intent.amountMinor;
  const allDifferences = ws.statementLines
    .filter((l) => l.amountDifference && linkedLineIds.has(l.id))
    .map((l) => {
      const d = l.amountDifference!;
      const outstanding =
        d.code === "RC_UNDER_AMOUNT_REPORT"
          ? ws.exceptions.some((x) => x.statementLineId === l.id && x.explanationCode === "RC_UNDER_AMOUNT_REPORT" && x.status !== "resolved")
          : remainderOpen;
      return { ...d, outstanding };
    });
  // rc3 (R-1): a returned payout states BOTH facts — whether the net movement is zero, and that the
  // beneficiary is unpaid — so "net zero" can never be read as "delivered".
  let returnPosition: InvestigationView["returnPosition"];
  if (s.execution === "returned" || intent.returnStatus) {
    const payAllocs = ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency);
    const debitedMinor = payAllocs.filter((a) => !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).reduce((t, a) => t + a.amountMinor, 0);
    const returnedMinor = payAllocs.filter((a) => a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).reduce((t, a) => t + a.amountMinor, 0);
    const both = debitedMinor > 0 && returnedMinor > 0;
    const code: NonNullable<InvestigationView["returnPosition"]>["code"] = !returnedMinor ? "RT_RETURN_NOT_ON_STATEMENT" : !debitedMinor ? "RT_DEBIT_NOT_ON_STATEMENT" : debitedMinor === returnedMinor ? "RT_NET_ZERO" : "RT_NET_NOT_ZERO";
    const fm = (m: number) => formatMinor(m, intent.sourceCurrency);
    const text = {
      RT_NET_ZERO: `The debit and the return credit (${fm(debitedMinor)} each) net to zero on the statement. The beneficiary was not paid.`,
      RT_NET_NOT_ZERO: `The debit (${fm(debitedMinor)}) and the return credit (${fm(returnedMinor)}) do not net to zero. The beneficiary was not paid.`,
      RT_RETURN_NOT_ON_STATEMENT: "The provider reports the return; no return credit is on the statement yet. The beneficiary was not paid.",
      RT_DEBIT_NOT_ON_STATEMENT: `The return credit (${fm(returnedMinor)}) is on the statement but the outgoing debit is not, so a net-zero movement is not established. The beneficiary was not paid.`,
    }[code];
    returnPosition = {
      returnStatus: intent.returnStatus ?? "provider_reported",
      debited: money(debitedMinor),
      returnCredited: money(returnedMinor),
      ...(both ? { netMovement: money(debitedMinor - returnedMinor) } : {}),
      netMovementZero: code === "RT_NET_ZERO",
      beneficiaryPaid: false,
      code,
      text,
    };
    codes.push(code, "RT_BENEFICIARY_UNPAID");
  }

  const amountDifferences = allDifferences.filter((d) => d.outstanding);
  const resolvedAmountDifferences = allDifferences.filter((d) => !d.outstanding);
  codes.push(...amountDifferences.map((d) => d.code));

  // Who acts
  const c = ws.cases.find((x) => x.id === intent.caseId);
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const top = [...open].sort((a, b) => sevRank[a.severity] - sevRank[b.severity])[0];
  const name = (id?: string) => ws.actors.find((a) => a.id === id)?.name;
  let whoActs: InvestigationView["whoActs"];
  if (hold && hold.status !== "released" && hold.status !== "rejected") whoActs = { ownerId: hold.reviewerId, ownerName: name(hold.reviewerId), role: "compliance reviewer", code: hold.reviewerId ? "WA_COMPLIANCE_REVIEWER" : "WA_COMPLIANCE_UNASSIGNED" };
  else if (top) whoActs = { ownerId: top.ownerId ?? c?.ownerId, ownerName: name(top.ownerId ?? c?.ownerId), role: top.ownerId || c?.ownerId ? "exception owner" : "unassigned — operations should assign", code: top.ownerId || c?.ownerId ? "WA_EXCEPTION_OWNER" : "WA_UNASSIGNED" };
  else if (instr?.status === "pending_approval") whoActs = { role: "checker (approver other than the maker)", code: "WA_CHECKER" };
  else if (["created", "quoted", "approved"].includes(s.execution)) whoActs = { ownerId: intent.createdBy, ownerName: name(intent.createdBy), role: "operations", code: "WA_OPERATIONS" };
  else if (["submitted", "in_transit"].includes(s.execution)) whoActs = { role: "provider (awaiting status)", code: "WA_PROVIDER" };
  else whoActs = { role: "no one — nothing outstanding", code: "WA_NONE" };
  codes.push(whoActs.code);

  // Next actions
  const next: Finding[] = [];
  for (const e of open) add(next, f("NA_" + e.category.toUpperCase(), e.requiredAction, [e.id]));
  if (s.execution === "created") add(next, f("NA_REQUEST_QUOTES", "Request indicative quotes."));
  if (s.execution === "quoted" && !instr) add(next, f("NA_CHOOSE_ROUTE", "Choose an eligible, unexpired route."));
  if (instr?.status === "pending_approval") add(next, f("NA_CHECKER_APPROVAL", "A checker other than the maker approves or rejects the instruction.", [instr.id]));
  if (instr?.status === "approved") add(next, f("NA_SUBMIT", "Submit the approved instruction to the provider sandbox.", [instr.id]));
  if (["submitted", "in_transit"].includes(s.execution)) add(next, f("NA_AWAIT_PROVIDER", "Await the provider's next status (or simulate it)."));
  if (s.execution === "provider_reported_completed" && s.reconciliation !== "matched" && s.settlementScope !== "onchain_transfer")
    add(next, f("NA_INGEST_STATEMENT", "Ingest the statement line that evidences this payout."));
  if (chain && chain.status !== "final" && chain.status !== "rejected_unsupported") add(next, f("NA_AWAIT_FINALITY", `Wait for ${chain.finalityThreshold - chain.confirmations} more confirmations.`, [chain.id]));
  if (!next.length) add(next, f("NA_NONE", "No action required."));

  const lastProvider = [...providerEvents].sort((x, y) => Date.parse(x.receivedAt) - Date.parse(y.receivedAt)).at(-1);
  const independentTimes = [
    ...ws.evidence.filter((e) => e.intentId === intent.id && e.independent).map((e) => e.recordedAt),
    ...ws.chainObservations.filter((o) => o.intentId === intent.id && o.status !== "rejected_unsupported").map((o) => o.updatedAt),
  ].sort((x, y) => Date.parse(x) - Date.parse(y));
  const lastIndependent = independentTimes.at(-1);
  return {
    ok: true,
    value: {
      intentId: intent.id,
      lastEventAt: lastProvider?.receivedAt,
      lastEventType: lastProvider?.normalizedType,
      lastIndependentVerificationAt: lastIndependent,
      lastVerifiedAt: lastIndependent,
      status: { ...s },
      requested: {
        internalReference: intent.internalReference,
        amount: { amountMinor: intent.amountMinor, currency: intent.sourceCurrency },
        destinationCurrency: intent.destinationCurrency,
        beneficiaryName: intent.beneficiaryName,
        destinationCountry: intent.destinationCountry,
        requestedExecutionDate: intent.requestedExecutionDate,
        purpose: intent.purpose,
      },
      provider: quote && route ? { providerId: quote.providerId, providerName: quote.providerName, routeId: route.id, rail: route.rail, providerPaymentId: instr?.providerPaymentId } : undefined,
      approval: instr ? { makerId: instr.makerId, checkerId: instr.checkerId, status: instr.status } : undefined,
      providerReported: { events, lastReported: last?.normalizedType, findings: prFindings },
      independentEvidence: independent,
      unknowns,
      contradictions,
      outstanding,
      whoActs,
      nextActions: next,
      exceptions,
      hold,
      chain,
      funding,
      caseId: intent.caseId,
      explanationCodes: [...new Set(codes)],
      amountDifferences,
      resolvedAmountDifferences,
      ...(returnPosition ? { returnPosition } : {}),
      disclaimer: ENGINE_DISCLAIMER,
    },
  };
}

export function exportCaseReport(ws: Workspace, caseId: string): Result<CaseReport> {
  const c = ws.cases.find((x) => x.id === caseId);
  if (!c) return { ok: false, error: { code: "not_found", message: "Case not found.", entityId: caseId } };
  const view = c.intentId ? investigate(ws, c.intentId) : undefined;
  const v = view?.ok ? view.value : undefined;
  const exceptions = ws.exceptions.filter((e) => c.exceptionIds.includes(e.id));
  const evidence = ws.evidence.filter((e) => c.evidenceIds.includes(e.id) || (c.intentId && e.intentId === c.intentId));
  const ob = c.advanceId ? ws.advances.find((a) => a.id === c.advanceId)?.obligationId : undefined;
  const json: Record<string, unknown> = {
    disclaimer: ENGINE_DISCLAIMER,
    generatedAt: ws.asOf,
    case: c,
    investigation: v,
    exceptions,
    evidence,
    fundingOutstanding: ob ? obligationOutstanding(ws, ob) : undefined,
    audit: ws.audit.filter((a) => a.entityId === c.id || a.entityId === c.intentId || exceptions.some((e) => e.id === a.entityId)),
  };
  const L: string[] = [];
  // User-entered text is flattened to one line so it can never forge a report line.
  const one = (t: string) => t.replace(/[\r\n\u2028\u2029]+/g, " ⏎ ");
  L.push(`CLEARLINE CASE REPORT — ${c.id}`, ENGINE_DISCLAIMER, `Generated (simulated clock): ${ws.asOf}`, `Title: ${c.title}`, `Status: ${c.status}   Owner: ${c.ownerId ?? "unassigned"}`, "");
  if (v) {
    L.push("REQUESTED", `  ${v.requested.internalReference} · ${formatMinor(v.requested.amount.amountMinor, v.requested.amount.currency)} → ${v.requested.destinationCurrency} · ${v.requested.beneficiaryName} (${v.requested.destinationCountry})`);
    L.push(`STATUS  execution=${v.status.execution}  settlement=${v.status.settlement} (${v.status.settlementScope})  reconciliation=${v.status.reconciliation}`);
    L.push(`PROVIDER  ${v.provider ? `${v.provider.providerName} · ${v.provider.routeId} · ${v.provider.providerPaymentId ?? "not submitted"}` : "none selected"}`);
    const sec = (title: string, items: { code: string; text: string }[]) => { L.push(title); for (const i of items) L.push(`  [${i.code}] ${one(i.text)}`); if (!items.length) L.push("  (none)"); };
    sec("PROVIDER REPORTED", v.providerReported.findings);
    sec("INDEPENDENT EVIDENCE", v.independentEvidence);
    sec("UNKNOWN", v.unknowns);
    sec("CONTRADICTORY", v.contradictions);
    sec("FINANCIALLY OUTSTANDING", v.outstanding.map((o) => ({ code: o.code, text: o.text + (o.amount ? ` (${formatMinor(o.amount.amountMinor, o.amount.currency)})` : "") })));
    L.push(`WHO ACTS  [${v.whoActs.code}] ${v.whoActs.ownerName ?? v.whoActs.role}`);
    sec("NEXT", v.nextActions);
  }
  L.push("EXCEPTIONS");
  for (const e of exceptions) L.push(`  ${e.id} ${e.category} ${e.severity} ${e.status} [${e.explanationCode}] owner=${e.ownerId ?? "unassigned"}`);
  L.push("NOTES");
  for (const n of c.notes) L.push(`  ${n.at} ${n.actorId}: ${one(n.text)}`);
  L.push("HISTORY");
  for (const h of c.history) L.push(`  ${h.at} ${h.actorId} ${h.action}: ${one(h.detail)}`);
  // QA residual L6 (R3): EVERY line is flattened, so no user-controlled field (case title, owner or
  // actor names, exception text, evidence descriptions, references, notes) can start a new line.
  const flat = (t: string) => t.replace(/[\r\n\u2028\u2029]+/g, " ⏎ ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  return { ok: true, value: { json, text: L.map(flat).join("\n") } };
}

/**
 * Unified, ordered evidence timeline for one payment (console UI_REQUESTS R2). Every entry says
 * where it came from and whether it is independent. Provider events are provider claims.
 */
export function evidenceTimelineFor(ws: Workspace, intentId: string): EvidenceTimelineEntry[] {
  const intent = getIntent(ws, intentId);
  if (!intent) return [];
  const out: EvidenceTimelineEntry[] = [];
  const name = (id?: string) => ws.actors.find((a) => a.id === id)?.name ?? id ?? "unknown";
  out.push({ id: intent.id, at: intent.createdAt, kind: "intent_created", title: `Intent ${intent.internalReference} created`, source: name(intent.createdBy), provenance: "clearline_user_action", independent: false, codes: [], refs: [intent.id] });
  for (const q of ws.quotes.filter((x) => x.intentId === intent.id))
    out.push({ id: q.id, at: q.quotedAt, kind: "quote", title: `${q.providerName}: ${q.eligible ? "eligible" : "ineligible"} indicative quote`, source: q.source, provenance: "provider_quote_simulator", independent: false, codes: [q.eligible ? "QT_ELIGIBLE" : "QT_INELIGIBLE"], refs: [q.routeId] });
  for (const i of ws.instructions.filter((x) => x.intentId === intent.id)) {
    out.push({ id: i.id + ":made", at: i.madeAt, kind: "instruction_made", title: `Instruction prepared (maker ${name(i.makerId)})`, source: name(i.makerId), provenance: "clearline_user_action", independent: false, codes: ["MC_MAKER"], refs: [i.id, i.quoteId] });
    if (i.checkedAt) out.push({ id: i.id + ":checked", at: i.checkedAt, kind: "instruction_checked", title: `Instruction ${i.status === "rejected" ? "rejected" : "approved"} (checker ${name(i.checkerId)})`, source: name(i.checkerId), provenance: "clearline_user_action", independent: false, codes: ["MC_CHECKER"], refs: [i.id] });
  }
  for (const e of timelineFor(ws, intent.id))
    out.push({ id: e.id, at: e.receivedAt, kind: "provider_event", title: `${e.normalizedType} · ${e.processingOutcome}`, source: e.provenance === "clearline_timer" ? "Clearline timer" : e.providerName, provenance: e.provenance, independent: false, codes: ["PE_" + e.processingOutcome.toUpperCase()], refs: [e.id] });
  const allocs = ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id);
  // rc3 (E-1): also every provider settlement report that names this payout's provider payment id — one
  // recorded as provider-reported evidence has no allocation or exception, and was missing from the timeline.
  const lineIds = new Set([...allocs.map((a) => a.statementLineId), ...ws.exceptions.filter((x) => x.intentId === intent.id && x.statementLineId).map((x) => x.statementLineId!), ...providerReportLinesFor(ws, intent).map((l) => l.id)]);
  for (const l of ws.statementLines.filter((x) => lineIds.has(x.id)))
    out.push({ id: l.id, at: l.receivedAt, kind: "statement_line", title: `${l.source === "bank_statement" ? "Bank statement" : "Provider settlement report"} ${l.direction} ${l.kind} · value ${l.valueDate}`, source: l.accountRef, provenance: l.source, independent: l.source === "bank_statement", codes: l.explanationCodes, refs: [l.id], ...(l.amountDifference ? { amountDifference: { ...l.amountDifference } } : {}) });
  for (const a of allocs)
    out.push({ id: a.id, at: a.createdAt, kind: "allocation", title: a.codes.map((c) => RECONCILIATION_CODE_TEXT[c]).join(" "), source: "Clearline reconciliation rules", provenance: "matching_decision", independent: false, codes: a.codes, refs: [a.statementLineId] });
  for (const o of ws.chainObservations.filter((x) => x.intentId === intent.id))
    out.push({ id: o.id, at: o.updatedAt, kind: "chain_observation", title: `Synthetic Base Sepolia transfer ${o.status} (${o.confirmations}/${o.finalityThreshold})`, source: "Synthetic chain observer (testnet)", provenance: "chain_observer_synthetic", independent: o.status !== "rejected_unsupported", codes: ["CH_" + o.status.toUpperCase()], refs: [o.id, o.txHash] });
  for (const ev of ws.evidence.filter((x) => x.intentId === intent.id && !["bank_statement_line", "provider_settlement_report", "chain_observation", "provider_status_report"].includes(x.kind)))
    out.push({ id: ev.id, at: ev.recordedAt, kind: "evidence", title: ev.description, source: ev.source, provenance: ev.recordedBy === "system" ? "system" : "user_attached_metadata", independent: ev.independent, codes: ["EV_" + ev.kind.toUpperCase()], refs: [ev.id] });
  for (const h of ws.holds.filter((x) => x.intentId === intent.id))
    for (const d of h.decisions)
      out.push({ id: `${h.id}:${d.at}:${d.decision}`, at: d.at, kind: "hold_decision", title: `Compliance reviewer: ${d.decision} — ${d.reason}`, source: name(d.reviewerId), provenance: "clearline_user_action", independent: false, codes: ["HD_" + d.decision.toUpperCase()], refs: [h.id] });
  for (const x of ws.exceptions.filter((e) => e.intentId === intent.id || (intent.advanceId && e.advanceId === intent.advanceId)))
    out.push({ id: x.id, at: x.createdAt, kind: "exception", title: `${x.category} (${x.severity}, ${x.status})`, source: "Clearline exception rules", provenance: "engine_rule", independent: false, codes: [x.explanationCode], refs: [x.id, ...x.candidates], ...(x.amountDifference ? { amountDifference: { ...x.amountDifference } } : {}) });
  const v = investigate(ws, intent.id);
  if (v.ok) for (const u of v.value.unknowns)
    out.push({ id: "missing:" + u.code, at: ws.asOf, kind: "missing_evidence", title: u.text, source: "Clearline investigation rules", provenance: "engine_rule", independent: false, codes: [u.code], refs: u.refs });
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
