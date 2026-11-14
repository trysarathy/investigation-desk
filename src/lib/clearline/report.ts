/**
 * rc3 — deterministic synthetic case report.
 *
 * `buildCaseReport(ws, ref)` is a pure function from (workspace, payment id or case id) to a structured
 * report: summary, the three truths (execution / settlement evidence / reconciliation) kept separate,
 * the evidence timeline with sources, findings, exceptions and every amount as an exact decimal string.
 * It reads only the workspace (the simulated clock `ws.asOf` is the report time) — the same input always
 * gives byte-identical JSON and CSV. Every report is marked FICTIONAL / sandbox.
 *
 * `caseReportToJson` (sorted keys, 2-space indent, trailing newline) and `caseReportToCsv` (RFC 4180,
 * CRLF, one row per item, spreadsheet-formula cells neutralised) serialise it.
 */
import { evidenceTimelineFor, investigate, matchedMinorFor, ENGINE_DISCLAIMER } from "./investigation";
import { HUMAN_LABELS, describeCode, describeStatus } from "./labels";
import { formatDecimal } from "./money";
import type { CurrencyCode, EngineError, ExceptionCategory, ExceptionStatus, Money, ReconciliationState, Result, SettlementEvidenceState, SettlementScope, Severity, ExecutionState, Workspace } from "./types";

export const CASE_REPORT_MARKING = "FICTIONAL · SANDBOX — synthetic data from the Clearline test-mode engine. Not a real payment, bank, chain or compliance record." as const;

/** An exact amount: `value` is a decimal string with the currency's exact number of decimals (USDC 6). */
export interface DecimalAmount {
  value: string;
  currency: CurrencyCode;
}

export type CaseReportRef = string | { paymentId: string } | { caseId: string };

export interface CaseReportFinding {
  section: "provider_reported" | "independent_evidence" | "unknown" | "contradiction" | "outstanding" | "next_action";
  code: string;
  label: string;
  text: string;
  refs: string[];
  amount?: DecimalAmount;
}

export interface CaseReportTimelineEntry {
  at: string;
  kind: string;
  title: string;
  /** Who produced the record (provider, bank statement account, chain observer, person, engine rule). */
  source: string;
  provenance: string;
  independent: boolean;
  codes: string[];
  refs: string[];
  amountDifference?: { code: string; expected: DecimalAmount; reported: DecimalAmount; difference: DecimalAmount };
}

export interface SyntheticCaseReport {
  reportVersion: 1;
  marking: typeof CASE_REPORT_MARKING;
  fictional: true;
  sandbox: true;
  /** The workspace's simulated clock — never the wall clock. */
  generatedAt: string;
  subject: { paymentId: string; caseId?: string; scenario?: string; internalReference: string; organization: string };
  summary: {
    /** One line, the three truths kept separate (describeStatus().summary). */
    headline: string;
    beneficiaryName: string;
    destinationCountry: string;
    destinationCurrency: CurrencyCode;
    purpose: string;
    requested: DecimalAmount;
    provider?: { name: string; routeId: string; rail: string; providerPaymentId?: string };
    approval?: { makerId: string; checkerId?: string; status: string };
    caseStatus?: string;
    caseOwnerId?: string;
    whoActs: { code: string; label: string; role: string; ownerName?: string };
  };
  threeTruths: {
    execution: { state: ExecutionState; label: string; basis: "provider_claim"; lastProviderEvent?: string; lastProviderEventAt?: string };
    settlement: { state: SettlementEvidenceState; label: string; scope: SettlementScope; scopeLabel: string; independent: boolean; lastIndependentEvidenceAt?: string };
    /** matched = outgoing debits (or a final chain transfer) allocated to the payout by trusted reference; unreconciled = what a sent, live payout still lacks (0 once failed/cancelled/expired/returned or never sent). */
    reconciliation: { state: ReconciliationState; label: string; matched: DecimalAmount; unreconciled: DecimalAmount };
  };
  timeline: CaseReportTimelineEntry[];
  findings: CaseReportFinding[];
  amounts: {
    requested: DecimalAmount;
    matched: DecimalAmount;
    unreconciled: DecimalAmount;
    differences: { code: string; outstanding: boolean; expected: DecimalAmount; reported: DecimalAmount; difference: DecimalAmount; source: string; statementLineId: string }[];
    funding?: { advanceId: string; principal: DecimalAmount; repaid: DecimalAmount; outstanding: DecimalAmount; reference?: string; dueDate?: string; state: string; supplierPaidBasis: string };
    returnPosition?: { code: string; debited: DecimalAmount; returnCredited: DecimalAmount; netMovement?: DecimalAmount; netMovementZero: boolean; beneficiaryPaid: false; text: string };
  };
  exceptions: { id: string; category: ExceptionCategory; categoryLabel: string; severity: Severity; status: ExceptionStatus; code: string; label: string; ownerId?: string; dueDate?: string; impact?: DecimalAmount }[];
  disclaimer: string;
}

const dec = (m: Money): DecimalAmount => ({ value: formatDecimal(m.amountMinor, m.currency), currency: m.currency });
const nf = (message: string, entityId?: string): { ok: false; error: EngineError } => ({ ok: false, error: { code: "not_found", message, entityId } });

/** Build the report for a payment (intent id) or an investigation case (case id). Pure and deterministic. */
export function buildCaseReport(ws: Workspace, ref: CaseReportRef): Result<SyntheticCaseReport> {
  const raw = typeof ref === "string" ? ref : "paymentId" in ref ? ref.paymentId : ref?.caseId;
  if (typeof raw !== "string" || !raw) return { ok: false, error: { code: "invalid_field", message: "Give a payment id or a case id.", field: "ref" } };
  const wantCase = typeof ref === "object" && "caseId" in ref;
  const wantPayment = typeof ref === "object" && "paymentId" in ref;
  let intent = wantCase ? undefined : ws.intents.find((i) => i.id === raw);
  const c0 = wantPayment ? undefined : ws.cases.find((c) => c.id === raw);
  if (!intent && c0) {
    intent = ws.intents.find((i) => i.id === c0.intentId);
    if (!intent) return { ok: false, error: { code: "precondition_failed", message: `Case ${c0.id} is not linked to a payment; a case report needs one.`, entityId: c0.id } };
  }
  if (!intent) return nf(`No payment or case with id ${raw}.`, raw);
  const v = investigate(ws, intent.id);
  if (!v.ok) return v;
  const view = v.value;
  const c = ws.cases.find((x) => x.id === intent!.caseId);
  const cur = intent.sourceCurrency;
  const m = (amountMinor: number): DecimalAmount => dec({ amountMinor, currency: cur });
  const status = describeStatus(view.status);
  const unreconciledMinor = view.outstanding.filter((o) => o.code === "OS_NOT_RECONCILED" || o.code === "OS_PARTIALLY_RECONCILED").reduce((t, o) => t + (o.amount?.amountMinor ?? 0), 0);
  // Review B-1: matched comes from the allocations themselves (investigation.ts matchedMinorFor), never from
  // "requested − outstanding" — a failed, cancelled or never-sent payout has nothing matched.
  const matchedMinor = matchedMinorFor(ws, intent);
  const requested = m(intent.amountMinor);
  const lastProvider = view.providerReported.events.filter((e) => e.provenance !== "clearline_timer").at(-1);

  const findings: CaseReportFinding[] = [];
  const push = (section: CaseReportFinding["section"], items: { code: string; text: string; refs?: string[]; amount?: Money }[]) => {
    for (const i of items) findings.push({ section, code: i.code, label: describeCode(i.code), text: i.text, refs: [...(i.refs ?? [])], ...(i.amount ? { amount: dec(i.amount) } : {}) });
  };
  push("provider_reported", view.providerReported.findings);
  push("independent_evidence", view.independentEvidence);
  push("unknown", view.unknowns);
  push("contradiction", view.contradictions);
  push("outstanding", view.outstanding);
  push("next_action", view.nextActions);

  const diff = (d: { code: string; expectedMinor: number; reportedMinor: number; differenceMinor: number; currency: CurrencyCode }) => ({
    code: d.code,
    expected: dec({ amountMinor: d.expectedMinor, currency: d.currency }),
    reported: dec({ amountMinor: d.reportedMinor, currency: d.currency }),
    difference: dec({ amountMinor: d.differenceMinor, currency: d.currency }),
  });
  const timeline: CaseReportTimelineEntry[] = evidenceTimelineFor(ws, intent.id).map((e) => ({
    at: e.at, kind: e.kind, title: e.title, source: e.source, provenance: e.provenance, independent: e.independent, codes: [...e.codes], refs: [...e.refs],
    ...(e.amountDifference ? { amountDifference: diff(e.amountDifference) } : {}),
  }));
  const f = view.funding;
  const rp = view.returnPosition;
  const report: SyntheticCaseReport = {
    reportVersion: 1,
    marking: CASE_REPORT_MARKING,
    fictional: true,
    sandbox: true,
    generatedAt: ws.asOf,
    subject: { paymentId: intent.id, ...(c ? { caseId: c.id } : {}), ...(intent.scenario ? { scenario: intent.scenario } : {}), internalReference: intent.internalReference, organization: ws.organization.name },
    summary: {
      headline: status.summary,
      beneficiaryName: intent.beneficiaryName,
      destinationCountry: intent.destinationCountry,
      destinationCurrency: intent.destinationCurrency,
      purpose: intent.purpose,
      requested,
      ...(view.provider ? { provider: { name: view.provider.providerName, routeId: view.provider.routeId, rail: view.provider.rail, ...(view.provider.providerPaymentId ? { providerPaymentId: view.provider.providerPaymentId } : {}) } } : {}),
      ...(view.approval ? { approval: { makerId: view.approval.makerId, ...(view.approval.checkerId ? { checkerId: view.approval.checkerId } : {}), status: view.approval.status } } : {}),
      ...(c ? { caseStatus: c.status, ...(c.ownerId ? { caseOwnerId: c.ownerId } : {}) } : {}),
      whoActs: { code: view.whoActs.code, label: describeCode(view.whoActs.code), role: view.whoActs.role, ...(view.whoActs.ownerName ? { ownerName: view.whoActs.ownerName } : {}) },
    },
    threeTruths: {
      execution: { state: view.status.execution, label: status.execution, basis: "provider_claim", ...(lastProvider ? { lastProviderEvent: lastProvider.normalizedType, lastProviderEventAt: lastProvider.receivedAt } : {}) },
      settlement: {
        state: view.status.settlement, label: status.settlement, scope: view.status.settlementScope, scopeLabel: status.settlementScope,
        independent: view.status.settlementScope === "bank_statement" || view.status.settlementScope === "onchain_transfer",
        ...(view.lastIndependentVerificationAt ? { lastIndependentEvidenceAt: view.lastIndependentVerificationAt } : {}),
      },
      reconciliation: { state: view.status.reconciliation, label: status.reconciliation, matched: m(matchedMinor), unreconciled: m(unreconciledMinor) },
    },
    timeline,
    findings,
    amounts: {
      requested,
      matched: m(matchedMinor),
      unreconciled: m(unreconciledMinor),
      differences: [...view.amountDifferences, ...view.resolvedAmountDifferences].map((d) => ({ ...diff(d), outstanding: d.outstanding, source: d.source, statementLineId: d.statementLineId })),
      ...(f ? { funding: { advanceId: f.advanceId, principal: dec(f.principal), repaid: dec(f.repaid), outstanding: dec(f.outstanding), ...(f.obligation ? { reference: f.obligation.reference, dueDate: f.obligation.dueDate } : {}), state: f.state, supplierPaidBasis: f.supplierPaidBasis } } : {}),
      ...(rp ? { returnPosition: { code: rp.code, debited: dec(rp.debited), returnCredited: dec(rp.returnCredited), ...(rp.netMovement ? { netMovement: dec(rp.netMovement) } : {}), netMovementZero: rp.netMovementZero, beneficiaryPaid: false as const, text: rp.text } } : {}),
    },
    exceptions: view.exceptions.map((e) => ({
      id: e.id, category: e.category, categoryLabel: HUMAN_LABELS.exceptionCategory[e.category], severity: e.severity, status: e.status, code: e.explanationCode, label: describeCode(e.explanationCode),
      ...(e.ownerId ? { ownerId: e.ownerId } : {}), ...(e.dueDate ? { dueDate: e.dueDate } : {}), ...(e.impact ? { impact: dec(e.impact) } : {}),
    })),
    disclaimer: ENGINE_DISCLAIMER,
  };
  return { ok: true, value: report };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

/** Deterministic JSON: sorted keys, 2-space indent, trailing newline. */
export const caseReportToJson = (r: SyntheticCaseReport): string => JSON.stringify(sortKeys(r), null, 2) + "\n";

export const CASE_REPORT_CSV_COLUMNS = ["section", "code", "label", "at", "source", "independent", "amount", "currency", "text", "refs"] as const;

/** One CSV cell. Text cells starting with = + - @ (or a tab/CR) are prefixed with ' so spreadsheets never run them. */
function cell(v: string | undefined, kind: "text" | "amount" = "text"): string {
  let s = (v ?? "").replace(/[\r\n\u2028\u2029]+/g, " ⏎ ");
  if (kind === "text" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) || s.includes("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV (CRLF). Row 1 is the header; row 2 marks the report FICTIONAL / sandbox. */
export function caseReportToCsv(r: SyntheticCaseReport): string {
  const rows: string[][] = [];
  const row = (section: string, o: { code?: string; label?: string; at?: string; source?: string; independent?: boolean; amount?: DecimalAmount; text?: string; refs?: string[] }) =>
    rows.push([cell(section), cell(o.code), cell(o.label), cell(o.at), cell(o.source), cell(o.independent === undefined ? "" : String(o.independent)), cell(o.amount?.value, "amount"), cell(o.amount?.currency), cell(o.text), cell((o.refs ?? []).join(" "))]);
  row("marking", { code: "FICTIONAL_SANDBOX", label: "FICTIONAL / SANDBOX", text: r.marking });
  row("meta", { code: "GENERATED_AT", at: r.generatedAt, text: "Simulated workspace clock" });
  row("meta", { code: "SUBJECT", text: `${r.subject.internalReference} · ${r.subject.organization}`, refs: [r.subject.paymentId, ...(r.subject.caseId ? [r.subject.caseId] : []), ...(r.subject.scenario ? [r.subject.scenario] : [])] });
  row("summary", { code: "HEADLINE", label: r.summary.beneficiaryName, amount: r.summary.requested, text: r.summary.headline });
  row("summary", { code: r.summary.whoActs.code, label: r.summary.whoActs.label, text: r.summary.whoActs.ownerName ?? r.summary.whoActs.role });
  const t = r.threeTruths;
  row("truth_execution", { code: t.execution.state, label: t.execution.label, at: t.execution.lastProviderEventAt, source: "provider_claim", independent: false, text: t.execution.lastProviderEvent ?? "" });
  row("truth_settlement", { code: t.settlement.state, label: t.settlement.label, at: t.settlement.lastIndependentEvidenceAt, source: t.settlement.scope, independent: t.settlement.independent, text: t.settlement.scopeLabel });
  row("truth_reconciliation", { code: t.reconciliation.state, label: t.reconciliation.label, amount: t.reconciliation.matched, text: `matched; unreconciled ${t.reconciliation.unreconciled.value} ${t.reconciliation.unreconciled.currency}` });
  for (const e of r.timeline) row("timeline", { code: e.kind, label: e.title, at: e.at, source: e.source, independent: e.independent, amount: e.amountDifference?.difference, text: `${e.provenance}${e.codes.length ? " · " + e.codes.join(" ") : ""}`, refs: e.refs });
  for (const x of r.findings) row(`finding_${x.section}`, { code: x.code, label: x.label, amount: x.amount, text: x.text, refs: x.refs });
  const a = r.amounts;
  row("amount", { code: "REQUESTED", amount: a.requested });
  row("amount", { code: "MATCHED", amount: a.matched });
  row("amount", { code: "UNRECONCILED", amount: a.unreconciled });
  for (const d of a.differences) row("amount_difference", { code: d.code, label: d.outstanding ? "outstanding" : "no longer outstanding", source: d.source, amount: d.difference, text: `expected ${d.expected.value}, reported ${d.reported.value}`, refs: [d.statementLineId] });
  if (a.funding) {
    row("amount_funding", { code: "PRINCIPAL", amount: a.funding.principal, label: a.funding.state, refs: [a.funding.advanceId] });
    row("amount_funding", { code: "REPAID", amount: a.funding.repaid, refs: [a.funding.advanceId] });
    row("amount_funding", { code: "OUTSTANDING", amount: a.funding.outstanding, text: a.funding.reference ? `reference ${a.funding.reference}, due ${a.funding.dueDate}` : "", refs: [a.funding.advanceId] });
  }
  if (a.returnPosition) {
    row("amount_return", { code: "DEBITED", amount: a.returnPosition.debited });
    row("amount_return", { code: "RETURN_CREDITED", amount: a.returnPosition.returnCredited });
    if (a.returnPosition.netMovement) row("amount_return", { code: "NET_MOVEMENT", amount: a.returnPosition.netMovement });
    row("amount_return", { code: a.returnPosition.code, label: describeCode(a.returnPosition.code), text: `${a.returnPosition.text} netMovementZero=${a.returnPosition.netMovementZero} beneficiaryPaid=false` });
  }
  for (const e of r.exceptions) row("exception", { code: e.code, label: `${e.categoryLabel} · ${e.severity} · ${e.status}`, at: e.dueDate, amount: e.impact, text: e.label, refs: [e.id, ...(e.ownerId ? [e.ownerId] : [])] });
  row("disclaimer", { text: r.disclaimer });
  return [CASE_REPORT_CSV_COLUMNS.join(","), ...rows.map((x) => x.join(","))].join("\r\n") + "\r\n";
}
