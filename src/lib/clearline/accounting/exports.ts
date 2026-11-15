/**
 * Accounting Bridge (rc4) — deterministic exports. PURE: the same workspace and arguments always give
 * byte-identical JSON and CSV, and the same export id and SHA-256.
 *
 * 1. Accounting-ready reconciliation export (`buildReconciliationExport`): one row per settled, returned or
 *    unresolved money movement whose date falls in [from, to): every statement line, every chain observation,
 *    and every provider-reported completion or return that has no statement or chain evidence. Each row says
 *    whether it is `evidenced`, `provider_reported_only` or `unresolved`.
 * 2. Journal export (`buildJournalExport`): the approved (or, for a recorded export, exported) proposals of a
 *    period, with the customer's account codes, for a generic CSV journal import. It is a FILE: Clearline posts
 *    nothing anywhere.
 *
 * Ids: `documentId` = "rx_" / "jx_" + the first 16 hex digits of `sha256`, the SHA-256 of the document's canonical
 * JSON with `documentId`, `sha256` and `generatedAt` left out (so the id names the content, not the clock).
 * CSV: RFC 4180, CRLF; text cells starting with = + - @ (or a tab / CR) are prefixed with ' (as in report.ts).
 */
import { formatDecimal } from "../money";
import { sha256Hex } from "../sha256";
import { isIsoDate, orgDate, referenceTokens, stableStringify } from "../tx";
import { describeCode } from "../labels";
import { bankKey, deriveJournalCandidates, isActiveProposal } from "./derive";
import { EXPORT_EVIDENCE_CLASS, EXPORT_MOVEMENT, EXPORT_ROW_RULE, JOURNAL_RULE, PROPOSAL_STATUS } from "./labels";
import { unmappedKeys } from "./periods";
import type { CurrencyCode, EngineError, Result, Workspace } from "../types";
import type { AccountMappingEntry, JournalProposal } from "./types";

export const ACCOUNTING_EXPORT_MARKING = "FICTIONAL · SANDBOX — synthetic data from the Clearline test-mode engine. Not a real bank, chain, payment or ledger record. Clearline has posted nothing." as const;

export type ExportEvidenceClass = "evidenced" | "provider_reported_only" | "unresolved";
export type ExportMovementKind =
  | "supplier_payout_debit" | "payout_debit_not_delivered" | "payout_return_credit" | "advance_disbursement" | "repayment_credit"
  | "unallocated_credit" | "unallocated_debit" | "provider_settlement_report" | "stablecoin_transfer"
  | "provider_reported_completion" | "provider_reported_return"
  /** Review F1: a stablecoin payout funded in one currency and paid in USDC, whose conversion is not evidenced. */
  | "stablecoin_conversion";

export interface ExportAmount { value: string; currency: CurrencyCode }

export interface ReconciliationExportRow {
  rowId: string;
  movement: ExportMovementKind;
  movementLabel: string;
  evidenceClass: ExportEvidenceClass;
  evidenceClassLabel: string;
  direction: "out" | "in";
  amount: ExportAmount;
  /** stablecoin_conversion only: the USDC the chain transfer paid (amount is what the on-ramp funding debited). */
  counterAmount?: ExportAmount;
  valueDate: string;
  source: {
    statementLineId?: string; bankLineId?: string; statementSource?: string; accountRef?: string; reference?: string; counterparty?: string;
    chainObservationId?: string; txHash?: string; network?: string;
    providerEventIds: string[]; evidenceRecordIds: string[];
  };
  paymentId?: string;
  internalReference?: string;
  advanceId?: string;
  obligationId?: string;
  allocationIds: string[];
  reconciliationStatus: string;
  /** The engine's explanation codes on the line / allocation (RC_*). */
  classificationCodes: string[];
  /** The rule that classified this row (XR_*). */
  ruleCode: string;
  ruleLabel: string;
  openExceptions: { id: string; category: string; code: string; label: string }[];
  /** Journal proposals (not superseded or rejected) that rest on this movement. */
  journal: { proposalId: string; status: string; ruleCode: string }[];
}

export interface ReconciliationExport {
  exportVersion: 1;
  kind: "reconciliation";
  marking: typeof ACCOUNTING_EXPORT_MARKING;
  fictional: true;
  sandbox: true;
  documentId: string;
  sha256: string;
  /** The simulated clock (informational; not part of the id). */
  generatedAt: string;
  organization: { id: string; name: string; timezone: string };
  period: { from: string; to: string };
  summary: Record<ExportEvidenceClass, { rows: number; byCurrency: Partial<Record<CurrencyCode, string>> }>;
  rows: ReconciliationExportRow[];
}

const nf = (code: EngineError["code"], message: string, field?: string): { ok: false; error: EngineError } => ({ ok: false, error: { code, message, ...(field ? { field } : {}) } });
const amt = (amountMinor: number, currency: CurrencyCode): ExportAmount => ({ value: formatDecimal(amountMinor, currency), currency });

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
/** Deterministic JSON: sorted keys, 2-space indent, trailing newline. */
export const accountingExportToJson = (doc: ReconciliationExport | JournalExport): string => JSON.stringify(sortKeys(doc), null, 2) + "\n";

function sealed<T extends { documentId: string; sha256: string; generatedAt?: string }>(prefix: "rx" | "jx", body: Omit<T, "documentId" | "sha256">): T {
  const { generatedAt: _g, ...hashed } = body as Omit<T, "documentId" | "sha256"> & { generatedAt?: string };
  void _g;
  const sha256 = sha256Hex(stableStringify(hashed));
  return { ...(body as object), documentId: `${prefix}_${sha256.slice(0, 16)}`, sha256 } as T;
}

export function validRange(from: unknown, to: unknown): { field: string; message: string } | undefined {
  if (!isIsoDate(from)) return { field: "from", message: "from must be YYYY-MM-DD." };
  if (!isIsoDate(to)) return { field: "to", message: "to must be YYYY-MM-DD." };
  if (!(from < to)) return { field: "to", message: "to must be after from (the period is [from, to))." };
  return undefined;
}

/** Build the reconciliation export for [from, to) (calendar dates in the organisation's time zone). */
export function buildReconciliationExport(ws: Workspace, range: { from: string; to: string }): Result<ReconciliationExport> {
  const bad = validRange(range?.from, range?.to);
  if (bad) return nf("invalid_field", bad.message, bad.field);
  const { from, to } = range;
  const tz = ws.organization.timezone;
  const inRange = (d: string) => from <= d && d < to;
  const intentById = new Map(ws.intents.map((i) => [i.id, i]));
  const proposals = (ws.accounting?.proposals ?? []).filter((p) => p.status !== "superseded" && p.status !== "rejected");
  const journalFor = (ids: string[]) => proposals.filter((p) => p.lines.some((l) => l.evidenceIds.some((e) => ids.includes(e)))).map((p) => ({ proposalId: p.id, status: p.status, ruleCode: p.ruleCode }));
  const openExc = (pred: (e: Workspace["exceptions"][number]) => boolean) =>
    ws.exceptions.filter((e) => e.status !== "resolved" && pred(e)).map((e) => ({ id: e.id, category: e.category, code: e.explanationCode, label: describeCode(e.explanationCode) }));
  const { candidates } = deriveJournalCandidates(ws);
  const candidateFor = (allocationId: string) => candidates.find((c) => c.evidence.allocationIds.includes(allocationId) && c.ruleCode !== "JR_REVERSAL");
  const rows: ReconciliationExportRow[] = [];
  const row = (r: Omit<ReconciliationExportRow, "movementLabel" | "evidenceClassLabel" | "ruleLabel">) =>
    rows.push({ ...r, movementLabel: EXPORT_MOVEMENT[r.movement], evidenceClassLabel: EXPORT_EVIDENCE_CLASS[r.evidenceClass], ruleLabel: EXPORT_ROW_RULE[r.ruleCode] ?? r.ruleCode });

  for (const line of ws.statementLines) {
    if (!inRange(line.valueDate)) continue;
    const allocs = ws.allocations.filter((a) => a.statementLineId === line.id && a.evidenceKind === "statement_line");
    const allocated = allocs.reduce((s, a) => s + a.amountMinor, 0);
    const a = allocs[0];
    const intent = a?.target.kind === "payment" ? intentById.get(a.target.intentId) : undefined;
    const ob = a?.target.kind === "repayment" ? ws.obligations.find((o) => o.id === (a.target as { obligationId: string }).obligationId) : undefined;
    const cand = a ? candidateFor(a.id) : undefined;
    const evidenceRecordIds = ws.evidence.filter((e) => e.reference === line.lineId && (e.kind === "bank_statement_line" || e.kind === "provider_settlement_report") && (!intent || e.intentId === intent.id || !e.intentId)).map((e) => e.id);
    const base = {
      rowId: `XR-${line.id}`, direction: line.direction === "debit" ? ("out" as const) : ("in" as const), amount: amt(line.amountMinor, line.currency), valueDate: line.valueDate,
      source: { statementLineId: line.id, bankLineId: line.lineId, statementSource: line.source, accountRef: line.accountRef, reference: line.reference, counterparty: line.counterparty, providerEventIds: cand?.evidence.providerEventIds ?? [], evidenceRecordIds },
      paymentId: intent?.id ?? (ob ? ws.advances.find((x) => x.id === ob.advanceId)?.intentId : undefined), internalReference: intent?.internalReference,
      advanceId: intent?.advanceId ?? ob?.advanceId, obligationId: ob?.id, allocationIds: allocs.map((x) => x.id),
      reconciliationStatus: line.status, classificationCodes: [...line.explanationCodes],
      openExceptions: openExc((e) => e.statementLineId === line.id || (!!intent && e.intentId === intent.id)),
      journal: journalFor([line.id, ...allocs.map((x) => x.id)]),
    };
    if (line.source === "provider_settlement_report") { row({ ...base, movement: "provider_settlement_report", evidenceClass: "provider_reported_only", ruleCode: "XR_PROVIDER_REPORT" }); continue; }
    if (!a) { row({ ...base, movement: line.direction === "credit" ? "unallocated_credit" : "unallocated_debit", evidenceClass: "unresolved", ruleCode: "XR_LINE_NOT_ALLOCATED" }); continue; }
    if (allocated < line.amountMinor) { row({ ...base, movement: line.direction === "credit" ? "unallocated_credit" : "unallocated_debit", evidenceClass: "unresolved", ruleCode: "XR_LINE_PARTIAL" }); continue; }
    if (a.target.kind === "repayment") { row({ ...base, movement: "repayment_credit", evidenceClass: "evidenced", ruleCode: "XR_REPAYMENT_BY_REFERENCE" }); continue; }
    if (a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")) { row({ ...base, movement: "payout_return_credit", evidenceClass: "evidenced", ruleCode: "XR_RETURN_CREDIT_BY_REFERENCE" }); continue; }
    const movement: ExportMovementKind = cand?.ruleCode === "JR_ADVANCE_DISBURSED" ? "advance_disbursement" : cand?.ruleCode === "JR_PAYOUT_DEBIT_NOT_DELIVERED" ? "payout_debit_not_delivered" : "supplier_payout_debit";
    row({ ...base, movement, evidenceClass: "evidenced", ruleCode: "XR_BANK_DEBIT_BY_REFERENCE" });
  }

  for (const o of ws.chainObservations) {
    // Review F9: the same date as the journal entry: the org date of the allocation (finality), else of the first sighting.
    const alloc = ws.allocations.find((a) => a.evidenceKind === "chain_observation" && a.statementLineId === o.id);
    const d = orgDate(alloc?.createdAt ?? o.observedAt, tz);
    if (!inRange(d)) continue;
    const intent = intentById.get(o.intentId);
    const allocs = ws.allocations.filter((a) => a.evidenceKind === "chain_observation" && a.statementLineId === o.id);
    const cand = allocs[0] ? candidateFor(allocs[0].id) : undefined;
    const counted = o.status !== "rejected_unsupported";
    row({
      rowId: `XR-${o.id}`, movement: "stablecoin_transfer", evidenceClass: cand ? "evidenced" : "unresolved", direction: "out", amount: amt(o.amountMinor, "USDC"), valueDate: d,
      source: { chainObservationId: o.id, txHash: o.txHash, network: o.network, providerEventIds: ws.providerEvents.filter((e) => e.intentId === o.intentId && e.detail.txHash === o.txHash).map((e) => e.id), evidenceRecordIds: ws.evidence.filter((e) => e.kind === "chain_observation" && e.reference === o.txHash && e.intentId === o.intentId).map((e) => e.id) },
      paymentId: intent?.id, internalReference: intent?.internalReference, advanceId: intent?.advanceId, allocationIds: allocs.map((a) => a.id),
      reconciliationStatus: o.status, classificationCodes: allocs.flatMap((a) => a.codes),
      ruleCode: cand ? "XR_CHAIN_FINAL_BY_TX_HASH" : counted ? "XR_CHAIN_NOT_FINAL" : "XR_CHAIN_NOT_COUNTED",
      openExceptions: openExc((e) => e.intentId === o.intentId), journal: journalFor([o.id, ...allocs.map((a) => a.id)]),
    });
  }

  for (const intent of ws.intents) {
    const allocs = ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id);
    const debits = allocs.filter((a) => !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"));
    const returns = allocs.filter((a) => a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"));
    const ppid = ws.instructions.find((x) => x.id === intent.instructionId)?.providerPaymentId?.toUpperCase();
    const reportLines = ppid ? ws.statementLines.filter((l) => l.source === "provider_settlement_report" && referenceTokens(l.reference).includes(ppid)) : [];
    const ev = (type: string) => ws.providerEvents.filter((e) => e.intentId === intent.id && e.normalizedType === type && e.processingOutcome === "applied");
    const mk = (movement: "provider_reported_completion" | "provider_reported_return", ruleCode: string, events: typeof ws.providerEvents) => {
      const d = orgDate(events[0].receivedAt, tz);
      if (!inRange(d)) return;
      row({
        rowId: `XR-${events[0].id}`, movement, evidenceClass: "provider_reported_only", direction: movement === "provider_reported_return" ? "in" : "out", amount: amt(intent.amountMinor, intent.sourceCurrency), valueDate: d,
        source: { providerEventIds: events.map((e) => e.id), evidenceRecordIds: [] }, paymentId: intent.id, internalReference: intent.internalReference, advanceId: intent.advanceId, allocationIds: [],
        reconciliationStatus: intent.status.reconciliation, classificationCodes: [], ruleCode, openExceptions: openExc((e) => e.intentId === intent.id), journal: [],
      });
    };
    // Review F1: a stablecoin-route payout funded by a bank debit and paid by a final chain transfer leaves an
    // unevidenced conversion in stablecoin clearing; it is listed as unresolved (the SGD and USDC legs are never netted).
    const fund = candidates.find((c) => c.ruleCode === "JR_STABLECOIN_ONRAMP_FUNDING" && c.intentId === intent.id);
    const paid = candidates.find((c) => c.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER" && c.intentId === intent.id);
    if (fund && paid && fund.currency !== paid.currency && inRange(paid.entryDate))
      row({
        rowId: `XR-CONV-${intent.id}`, movement: "stablecoin_conversion", evidenceClass: "unresolved", direction: "out", amount: amt(fund.lines[0].amountMinor, fund.currency), counterAmount: amt(paid.lines[0].amountMinor, paid.currency), valueDate: paid.entryDate,
        source: { providerEventIds: paid.evidence.providerEventIds, evidenceRecordIds: [...fund.evidence.evidenceRecordIds, ...paid.evidence.evidenceRecordIds], statementLineId: fund.evidence.statementLineIds[0], chainObservationId: paid.evidence.chainObservationIds[0] },
        paymentId: intent.id, internalReference: intent.internalReference, advanceId: intent.advanceId, allocationIds: [...fund.evidence.allocationIds, ...paid.evidence.allocationIds],
        reconciliationStatus: intent.status.reconciliation, classificationCodes: [], ruleCode: "XR_CONVERSION_NOT_EVIDENCED", openExceptions: openExc((e) => e.intentId === intent.id), journal: journalFor([...fund.evidence.allocationIds, ...paid.evidence.allocationIds]),
      });
    const completed = ev("payout.completed");
    if (completed.length && intent.status.execution === "provider_reported_completed" && debits.length === 0 && reportLines.length === 0) mk("provider_reported_completion", "XR_PROVIDER_COMPLETION_NO_EVIDENCE", completed);
    const returned = ev("payout.returned");
    if (returned.length && intent.status.execution === "returned" && returns.length === 0) mk("provider_reported_return", "XR_PROVIDER_RETURN_NOT_ON_STATEMENT", returned);
  }

  rows.sort((a, b) => (a.valueDate !== b.valueDate ? (a.valueDate < b.valueDate ? -1 : 1) : a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
  const summary = { evidenced: { rows: 0, byCurrency: {} }, provider_reported_only: { rows: 0, byCurrency: {} }, unresolved: { rows: 0, byCurrency: {} } } as ReconciliationExport["summary"];
  const totals = new Map<string, bigint>();
  for (const r of rows) {
    summary[r.evidenceClass].rows += 1;
    const k = `${r.evidenceClass}|${r.amount.currency}`;
    totals.set(k, (totals.get(k) ?? 0n) + BigInt(r.amount.value.replace(".", "")));
  }
  for (const [k, v] of [...totals].sort()) {
    const [cls, cur] = k.split("|") as [ExportEvidenceClass, CurrencyCode];
    summary[cls].byCurrency[cur] = formatDecimal(Number(v), cur);
  }
  return {
    ok: true,
    value: sealed<ReconciliationExport>("rx", {
      exportVersion: 1, kind: "reconciliation", marking: ACCOUNTING_EXPORT_MARKING, fictional: true, sandbox: true, generatedAt: ws.asOf,
      organization: { id: ws.organization.id, name: ws.organization.name, timezone: tz }, period: { from, to }, summary, rows,
    }),
  };
}

/** One CSV cell. Text cells starting with = + - @ (or a tab/CR) are prefixed with ' so spreadsheets never run them. */
export function csvCell(v: string | undefined, kind: "text" | "amount" = "text"): string {
  let s = (v ?? "").replace(/[\r\n\u2028\u2029]+/g, " ⏎ ");
  if (kind === "text" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) || s.includes("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

export const RECONCILIATION_EXPORT_CSV_COLUMNS = ["section", "row_id", "movement", "evidence_class", "direction", "amount", "currency", "value_date", "statement_line_id", "bank_line_id", "account_ref", "reference", "counterparty", "chain_observation_id", "tx_hash", "provider_event_ids", "evidence_record_ids", "payment_id", "internal_reference", "advance_id", "obligation_id", "allocation_ids", "reconciliation_status", "classification_codes", "rule_code", "rule_label", "open_exceptions", "journal_proposals", "counter_amount", "counter_currency", "marking"] as const;

/** RFC 4180 CSV (CRLF). Row 1 is the header; the next rows mark the file FICTIONAL / sandbox and give its id and period. */
export function reconciliationExportToCsv(doc: ReconciliationExport): string {
  const n = RECONCILIATION_EXPORT_CSV_COLUMNS.length;
  const meta = (code: string, text: string) => { const r = Array<string>(n).fill(""); r[0] = csvCell("meta"); r[1] = csvCell(code); r[n - 6] = csvCell(code); r[n - 5] = csvCell(text); r[n - 1] = csvCell("FICTIONAL SANDBOX"); return r; };
  const out: string[][] = [
    meta("XR_FICTIONAL_SANDBOX", doc.marking),
    meta("XR_GENERATED_AT", `${doc.documentId} sha256 ${doc.sha256} generated ${doc.generatedAt} (simulated clock)`),
    meta("XR_PERIOD", `[${doc.period.from}, ${doc.period.to}) ${doc.organization.name} (${doc.organization.timezone})`),
  ];
  for (const r of doc.rows)
    out.push([
      csvCell(r.evidenceClass), csvCell(r.rowId), csvCell(r.movement), csvCell(r.evidenceClassLabel), csvCell(r.direction), csvCell(r.amount.value, "amount"), csvCell(r.amount.currency), csvCell(r.valueDate),
      csvCell(r.source.statementLineId), csvCell(r.source.bankLineId), csvCell(r.source.accountRef), csvCell(r.source.reference), csvCell(r.source.counterparty), csvCell(r.source.chainObservationId), csvCell(r.source.txHash), csvCell(r.source.providerEventIds.join(" ")), csvCell(r.source.evidenceRecordIds.join(" ")),
      csvCell(r.paymentId), csvCell(r.internalReference), csvCell(r.advanceId), csvCell(r.obligationId), csvCell(r.allocationIds.join(" ")), csvCell(r.reconciliationStatus), csvCell(r.classificationCodes.join(" ")),
      csvCell(r.ruleCode), csvCell(r.ruleLabel), csvCell(r.openExceptions.map((e) => `${e.id}:${e.code}`).join(" ")), csvCell(r.journal.map((j) => `${j.proposalId}:${j.status}`).join(" ")),
      csvCell(r.counterAmount?.value, "amount"), csvCell(r.counterAmount?.currency), csvCell("FICTIONAL SANDBOX"),
    ]);
  return [RECONCILIATION_EXPORT_CSV_COLUMNS.join(","), ...out.map((x) => x.join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------
// Journal export
// ---------------------------------------------------------------------------------------------

export interface JournalExportLine { lineNo: number; accountKey: string; accountCode: string; accountName: string; debit: string; credit: string; currency: CurrencyCode; memo: string; ruleCode: string; evidenceIds: string[] }
export interface JournalExportEntry {
  proposalId: string; journalDate: string; entryDate: string; priorPeriodItem: boolean; priorPeriodReason?: string;
  ruleCode: string; ruleLabel: string; narrative: string; currency: CurrencyCode; reverses?: string;
  approvedBy: string; preparedBy: string;
  lines: JournalExportLine[];
  totals: { debit: string; credit: string };
}
export interface JournalExport {
  exportVersion: 1;
  kind: "journal";
  marking: typeof ACCOUNTING_EXPORT_MARKING;
  fictional: true;
  sandbox: true;
  /** Always true: the file is a proposal to import; Clearline has no connection to any ledger. */
  notPostedByClearline: true;
  documentId: string;
  sha256: string;
  organization: { id: string; name: string; timezone: string };
  period: { id: string; name: string; from: string; to: string };
  mappingRevision: number;
  entries: JournalExportEntry[];
}

/** The accounts a journal export would use, and the keys that are not mapped. */
export function journalExportAccounts(ws: Workspace, proposals: JournalProposal[], entries: readonly AccountMappingEntry[] = ws.accounting?.mapping?.entries ?? []): { accounts: AccountMappingEntry[]; unmapped: string[] } {
  const used = proposals.flatMap((p) => p.lines.map((l) => l.accountKey));
  const unmapped = unmappedKeys({ revision: 0, entries: [...entries], updatedAt: "", updatedBy: "" }, used);
  const accounts = [...new Set(used)].sort().map((k) => entries.find((e) => e.accountKey === k)).filter((e): e is AccountMappingEntry => !!e).map((e) => ({ ...e }));
  return { accounts, unmapped };
}

/**
 * The journal export of a period. `exportId` (an AccountingExportRecord id) re-renders a recorded export byte for
 * byte from its stored proposals and account codes; otherwise it previews the period's APPROVED proposals with the
 * current mapping. Refused (precondition_failed) while any account key is unmapped.
 */
export function buildJournalExport(ws: Workspace, ref: { periodId: string } | { exportId: string }): Result<JournalExport> {
  const bridge = ws.accounting;
  let periodId: string;
  let proposals: JournalProposal[];
  let accounts: readonly AccountMappingEntry[];
  let revision: number;
  if ("exportId" in ref) {
    const rec = bridge?.exports.find((x) => x.id === ref.exportId && x.kind === "journal");
    if (!rec || !rec.periodId) return nf("not_found", `Journal export ${String(ref.exportId)} not found.`);
    periodId = rec.periodId;
    proposals = (rec.proposalIds ?? []).map((id) => bridge!.proposals.find((p) => p.id === id)).filter((p): p is JournalProposal => !!p);
    accounts = rec.accounts ?? [];
    revision = rec.mappingRevision ?? 0;
  } else {
    periodId = ref?.periodId;
    proposals = (bridge?.proposals ?? []).filter((p) => p.periodId === periodId && p.status === "approved");
    accounts = bridge?.mapping?.entries ?? [];
    revision = bridge?.mapping?.revision ?? 0;
  }
  const period = bridge?.periods.find((p) => p.id === periodId);
  if (!period) return nf("not_found", `Accounting period ${String(periodId)} not found.`);
  if (!proposals.length) return nf("precondition_failed", `NOTHING_TO_EXPORT: period ${period.name} has no approved proposals.`);
  const { unmapped } = journalExportAccounts(ws, proposals, accounts);
  if (unmapped.length) return nf("precondition_failed", `UNMAPPED_ACCOUNT_ROLE: map ${unmapped.join(", ")} to your account codes before exporting.`, "mapping");
  const code = (k: string) => accounts.find((e) => e.accountKey === k)!;
  const entries: JournalExportEntry[] = [...proposals].sort((a, b) => (a.postingDate !== b.postingDate ? (a.postingDate < b.postingDate ? -1 : 1) : a.id < b.id ? -1 : 1)).map((p) => {
    const debit = p.lines.filter((l) => l.side === "debit").reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const credit = p.lines.filter((l) => l.side === "credit").reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    return {
      proposalId: p.id, journalDate: p.postingDate, entryDate: p.entryDate, priorPeriodItem: !!p.priorPeriodItem, ...(p.priorPeriodItem ? { priorPeriodReason: p.priorPeriodItem.reason } : {}),
      ruleCode: p.ruleCode, ruleLabel: JOURNAL_RULE[p.ruleCode], narrative: p.narrative, currency: p.currency, ...(p.reverses ? { reverses: p.reverses } : {}),
      approvedBy: p.approval?.by ?? "", preparedBy: p.createdBy,
      lines: p.lines.map((l) => ({ lineNo: l.lineNo, accountKey: l.accountKey, accountCode: code(l.accountKey).accountCode, accountName: code(l.accountKey).accountName, debit: l.side === "debit" ? formatDecimal(l.amountMinor, l.currency) : "", credit: l.side === "credit" ? formatDecimal(l.amountMinor, l.currency) : "", currency: l.currency, memo: l.memo, ruleCode: l.ruleCode, evidenceIds: [...l.evidenceIds] })),
      totals: { debit: formatDecimal(Number(debit), p.currency), credit: formatDecimal(Number(credit), p.currency) },
    };
  });
  return {
    ok: true,
    value: sealed<JournalExport>("jx", {
      exportVersion: 1, kind: "journal", marking: ACCOUNTING_EXPORT_MARKING, fictional: true, sandbox: true, notPostedByClearline: true,
      organization: { id: ws.organization.id, name: ws.organization.name, timezone: ws.organization.timezone },
      period: { id: period.id, name: period.name, from: period.from, to: period.to }, mappingRevision: revision, entries,
    }),
  };
}

/** Generic CSV journal import format (docs/clearline/ACCOUNTING_BRIDGE.md §5): one row per journal line. journal_id is "SANDBOX-<proposal id>" (review F12: the marking survives an importer dropping unmapped columns). */
export const JOURNAL_EXPORT_CSV_COLUMNS = ["journal_id", "journal_date", "entry_date", "account_code", "account_name", "debit", "credit", "currency", "memo", "rule_code", "evidence_ids", "prior_period_item", "reverses", "prepared_by", "approved_by", "export_id", "marking"] as const;

/** RFC 4180 CSV (CRLF): a header, then only journal lines (importers read every row), each marked FICTIONAL SANDBOX. */
export function journalExportToCsv(doc: JournalExport): string {
  const rows: string[][] = [];
  for (const e of doc.entries)
    for (const l of e.lines)
      rows.push([csvCell(`SANDBOX-${e.proposalId}`), csvCell(e.journalDate), csvCell(e.entryDate), csvCell(l.accountCode), csvCell(l.accountName), csvCell(l.debit, "amount"), csvCell(l.credit, "amount"), csvCell(l.currency), csvCell(l.memo), csvCell(l.ruleCode), csvCell(l.evidenceIds.join(" ")), csvCell(e.priorPeriodItem ? "true" : "false"), csvCell(e.reverses), csvCell(e.preparedBy), csvCell(e.approvedBy), csvCell(doc.documentId), csvCell("FICTIONAL SANDBOX")]);
  return [JOURNAL_EXPORT_CSV_COLUMNS.join(","), ...rows.map((x) => x.join(","))].join("\r\n") + "\r\n";
}

export { bankKey, isActiveProposal, PROPOSAL_STATUS };
