import { isCurrency } from "./money";
import { isIsoDate, isIsoInstant, isTimeZone } from "./tx";
import type { Result, Workspace } from "./types";

export const serializeWorkspace = (ws: Workspace): string => JSON.stringify(ws);

class Invalid extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const need = (cond: boolean, field: string, what: string) => {
  if (!cond) throw new Invalid(field, `${field}: ${what}`);
};
const str = (o: Obj, k: string, path: string) => need(typeof o[k] === "string" && (o[k] as string).length > 0, `${path}.${k}`, "must be a non-empty string");
const int = (o: Obj, k: string, path: string, min = 0) => need(typeof o[k] === "number" && Number.isSafeInteger(o[k]) && (o[k] as number) >= min, `${path}.${k}`, `must be a safe integer ≥ ${min}`);
const cur = (o: Obj, k: string, path: string) => need(isCurrency(o[k]), `${path}.${k}`, "must be a supported currency");
const oneOf = (o: Obj, k: string, path: string, values: readonly string[]) => need(values.includes(o[k] as string), `${path}.${k}`, `must be one of ${values.join(", ")}`);
const instant = (o: Obj, k: string, path: string) => need(isIsoInstant(o[k]), `${path}.${k}`, "must be an ISO-8601 instant");
const date = (o: Obj, k: string, path: string) => need(isIsoDate(o[k]), `${path}.${k}`, "must be YYYY-MM-DD");
const arr = (o: Obj, k: string, path: string) => need(Array.isArray(o[k]), `${path}.${k}`, "must be an array");

/** CHANGE 5 (F2): optional structured amount difference on statement lines and exceptions. */
const amountDifference = (o: Obj, p: string) => {
  if (o.amountDifference === undefined) return;
  need(isObj(o.amountDifference), `${p}.amountDifference`, "must be an object");
  const d = o.amountDifference as Obj;
  const q = `${p}.amountDifference`;
  oneOf(d, "code", q, ["RC_UNDER_AMOUNT_REPORT", "RC_PARTIAL_AMOUNT"]);
  int(d, "expectedMinor", q, 1); int(d, "reportedMinor", q, 1); int(d, "differenceMinor", q, 1); cur(d, "currency", q);
  oneOf(d, "source", q, ["bank_statement", "provider_settlement_report"]); str(d, "statementLineId", q); str(d, "requiredNextAction", q);
  need(d.expectedMinor === (d.reportedMinor as number) + (d.differenceMinor as number), `${q}.differenceMinor`, "must equal expectedMinor − reportedMinor");
};

/**
 * Review v2 (m4): a difference must describe the line it sits on (statement line) or the line its
 * exception is linked to: same internal line id, currency, source and reported amount, and a code that
 * fits the source (provider reports give RC_UNDER_AMOUNT_REPORT, bank lines RC_PARTIAL_AMOUNT).
 */
const differenceMatchesLine = (d: Obj, line: Obj | undefined, q: string) => {
  need(line !== undefined, `${q}.statementLineId`, "must identify a statement line in this workspace");
  const l = line as Obj;
  need(d.statementLineId === l.id, `${q}.statementLineId`, "must equal the id of its statement line");
  need(d.currency === l.currency, `${q}.currency`, "must equal its statement line's currency");
  need(d.source === l.source, `${q}.source`, "must equal its statement line's source");
  need(d.reportedMinor === l.amountMinor, `${q}.reportedMinor`, "must equal its statement line's amount");
  need((d.code === "RC_UNDER_AMOUNT_REPORT") === (d.source === "provider_settlement_report"), `${q}.code`, "must be RC_UNDER_AMOUNT_REPORT for a provider report and RC_PARTIAL_AMOUNT for a bank line");
};

const EXECUTION = ["created", "quoted", "approved", "submitted", "in_transit", "provider_reported_completed", "awaiting_information", "on_hold", "failed", "returned", "cancelled", "expired"];
const SETTLEMENT = ["none", "observed", "pending_finality", "verified", "contradicted"];
const SCOPE = ["none", "provider_report", "bank_statement", "onchain_transfer"];
const RECON = ["not_started", "pending", "matched", "partially_matched", "exception"];

/** Element validators: each throws Invalid with a field path. */
const ELEMENTS: Partial<Record<keyof Workspace, (e: Obj, p: string) => void>> = {
  actors: (e, p) => { str(e, "name", p); oneOf(e, "role", p, ["operator", "approver", "compliance", "viewer"]); },
  routes: (e, p) => { str(e, "providerId", p); str(e, "providerName", p); arr(e, "sourceCurrencies", p); need(isObj(e.providerFees), `${p}.providerFees`, "must be an object"); int(e, "platformFeeBps", p); },
  intents: (e, p) => {
    str(e, "internalReference", p); int(e, "amountMinor", p, 1); cur(e, "sourceCurrency", p); cur(e, "destinationCurrency", p); str(e, "beneficiaryRef", p);
    instant(e, "createdAt", p); arr(e, "quoteIds", p); need(isObj(e.metadata), `${p}.metadata`, "must be an object");
    need(isObj(e.status), `${p}.status`, "must be an object");
    const s = e.status as Obj;
    oneOf(s, "execution", `${p}.status`, EXECUTION); oneOf(s, "settlement", `${p}.status`, SETTLEMENT); oneOf(s, "settlementScope", `${p}.status`, SCOPE); oneOf(s, "reconciliation", `${p}.status`, RECON);
  },
  quotes: (e, p) => { str(e, "intentId", p); str(e, "routeId", p); need(typeof e.eligible === "boolean", `${p}.eligible`, "must be boolean"); int(e, "estimatedRecipientMinor", p); instant(e, "expiresAt", p); },
  instructions: (e, p) => { str(e, "intentId", p); str(e, "quoteId", p); str(e, "makerId", p); int(e, "amountMinor", p, 1); cur(e, "currency", p); oneOf(e, "status", p, ["pending_approval", "approved", "rejected", "submitted"]); },
  providerEvents: (e, p) => { str(e, "providerId", p); instant(e, "receivedAt", p); int(e, "sequence", p); str(e, "processingOutcome", p); need(isObj(e.detail), `${p}.detail`, "must be an object"); },
  evidence: (e, p) => { str(e, "kind", p); instant(e, "recordedAt", p); need(typeof e.independent === "boolean", `${p}.independent`, "must be boolean"); },
  statementLines: (e, p) => {
    int(e, "amountMinor", p, 1); cur(e, "currency", p); oneOf(e, "direction", p, ["debit", "credit"]); oneOf(e, "kind", p, ["payment", "return", "reversal"]);
    oneOf(e, "status", p, ["unallocated", "allocated", "partially_allocated", "exception"]); arr(e, "allocationIds", p); arr(e, "explanationCodes", p); date(e, "valueDate", p); need(typeof e.reference === "string", `${p}.reference`, "must be a string");
    amountDifference(e, p);
  },
  allocations: (e, p) => { str(e, "statementLineId", p); need(isObj(e.target), `${p}.target`, "must be an object"); int(e, "amountMinor", p, 1); cur(e, "currency", p); arr(e, "codes", p); oneOf(e, "evidenceKind", p, ["statement_line", "chain_observation"]); },
  exceptions: (e, p) => {
    str(e, "category", p); oneOf(e, "status", p, ["open", "in_review", "resolved", "reopened"]); oneOf(e, "severity", p, ["low", "medium", "high", "critical"]);
    for (const k of ["candidates", "supportingEventIds", "supportingEvidenceIds", "history"]) arr(e, k, p);
    instant(e, "createdAt", p);
    amountDifference(e, p);
  },
  cases: (e, p) => { oneOf(e, "status", p, ["open", "resolved", "reopened"]); for (const k of ["notes", "requestedInfo", "evidenceIds", "exceptionIds", "history"]) arr(e, k, p); },
  holds: (e, p) => {
    str(e, "intentId", p); oneOf(e, "status", p, ["open", "documents_submitted", "partner_release_reported", "released", "rejected"]); need(e.autoRelease === false, `${p}.autoRelease`, "must be false");
    for (const k of ["requestedDocuments", "submittedDocuments", "decisions"]) arr(e, k, p);
  },
  liquidity: (e, p) => { str(e, "providerId", p); cur(e, "currency", p); int(e, "eligibleMinor", p); int(e, "restrictedMinor", p); int(e, "safeguardedMinor", p); instant(e, "asOf", p); },
  chainObservations: (e, p) => { str(e, "intentId", p); str(e, "txHash", p); int(e, "confirmations", p); int(e, "amountMinor", p, 1); oneOf(e, "status", p, ["observed", "pending_finality", "final", "rejected_unsupported"]); },
  advances: (e, p) => { str(e, "intentId", p); int(e, "principalMinor", p, 1); cur(e, "currency", p); date(e, "dueDate", p); str(e, "preparedBy", p); str(e, "repaymentReference", p); },
  fundingDecisions: (e, p) => { str(e, "advanceId", p); str(e, "makerId", p); str(e, "checkerId", p); oneOf(e, "outcome", p, ["approve", "decline"]); },
  obligations: (e, p) => { str(e, "advanceId", p); int(e, "principalMinor", p, 1); cur(e, "currency", p); date(e, "dueDate", p); str(e, "reference", p); },
  repaymentAllocations: (e, p) => { str(e, "obligationId", p); str(e, "statementLineId", p); int(e, "amountMinor", p, 1); cur(e, "currency", p); },
  audit: (e, p) => { instant(e, "at", p); str(e, "action", p); },
};

/** Fill fields added after a workspace may have been saved in browser storage (sandbox migration). */
function migrate(w: Obj) {
  if (Array.isArray(w.allocations)) for (const a of w.allocations) if (isObj(a) && a.evidenceKind === undefined) a.evidenceKind = "statement_line";
  if (Array.isArray(w.providerEvents)) for (const e of w.providerEvents) if (isObj(e) && e.providerName === undefined) e.providerName = e.providerId;
}

function validate(w: unknown): Workspace {
  need(isObj(w), "workspace", "must be a JSON object");
  const ws = w as Obj;
  need(ws.schemaVersion === 1 && ws.mode === "sandbox", "schemaVersion", "unsupported workspace schema; reset to sample");
  instant(ws, "asOf", "workspace");
  int(ws, "seq", "workspace");
  need(isObj(ws.organization), "organization", "must be an object");
  const org = ws.organization as Obj;
  str(org, "id", "organization"); need(org.fictional === true, "organization.fictional", "must be true"); cur(org, "baseCurrency", "organization");
  need(isTimeZone(org.timezone), "organization.timezone", "must be an IANA time zone");
  need(isObj(ws.liquidityPolicy), "liquidityPolicy", "must be an object");
  const pol = ws.liquidityPolicy as Obj;
  str(pol, "label", "liquidityPolicy"); int(pol, "bufferBps", "liquidityPolicy"); int(pol, "maxAgeMinutes", "liquidityPolicy", 1);
  need(isObj(pol.minBufferMinor), "liquidityPolicy.minBufferMinor", "must be an object");
  need(isObj(ws.idempotency), "idempotency", "must be an object");
  for (const [k, v] of Object.entries(ws.idempotency as Obj)) need(isObj(v) && typeof v.intentId === "string" && typeof v.fingerprint === "string", `idempotency.${k}`, "must be {intentId, fingerprint}");
  migrate(ws);
  for (const [key, check] of Object.entries(ELEMENTS) as [keyof Workspace, (e: Obj, p: string) => void][]) {
    need(Array.isArray(ws[key]), key, "must be an array");
    (ws[key] as unknown[]).forEach((e, i) => {
      const path = `${key}[${i}]`;
      need(isObj(e), path, "must be an object");
      str(e as Obj, "id", path);
      check(e as Obj, path);
    });
  }
  // Review v2 (m4): cross-check every amount difference against its own / linked statement line.
  const lines = ws.statementLines as Obj[];
  lines.forEach((l, i) => {
    if (l.amountDifference !== undefined) differenceMatchesLine(l.amountDifference as Obj, l, `statementLines[${i}].amountDifference`);
  });
  (ws.exceptions as Obj[]).forEach((e, i) => {
    if (e.amountDifference === undefined) return;
    const q = `exceptions[${i}].amountDifference`;
    need(typeof e.statementLineId === "string", `exceptions[${i}].statementLineId`, "must be set when the exception carries an amount difference");
    need((e.amountDifference as Obj).statementLineId === e.statementLineId, `${q}.statementLineId`, "must equal the exception's statementLineId");
    differenceMatchesLine(e.amountDifference as Obj, lines.find((l) => l.id === e.statementLineId), q);
  });
  crossCheck(ws);
  return ws as unknown as Workspace;
}

const TERMINAL = ["failed", "cancelled", "expired", "returned"];

/**
 * rc3 (I-1): cross-field integrity. Every action re-validates the workspace it is given (applyAction →
 * parseWorkspaceValue), so a stored or posted workspace that breaks one of these financial invariants is
 * refused with a typed error instead of being built on:
 * - an allocation names an existing statement line (listed in its allocationIds, same currency) or an
 *   existing chain observation of the same payout;
 * - one statement line or chain observation is never allocated to two different payouts or obligations,
 *   and never above its own amount;
 * - a repayment allocation is unique per statement line and matches that line's repayment allocation;
 * - maker ≠ checker on every recorded instruction check and funding decision;
 * - a hold is released or rejected only with a matching reviewer decision;
 * - a failed, cancelled, expired or returned payout never carries settlement "verified".
 */
function crossCheck(ws: Obj) {
  const lines = ws.statementLines as Obj[];
  const lineById = new Map(lines.map((l) => [l.id as string, l]));
  const obsById = new Map((ws.chainObservations as Obj[]).map((o) => [o.id as string, o]));
  const owner = new Map<string, string>();
  const total = new Map<string, number>();
  const allocById = new Map<string, Obj>();
  (ws.allocations as Obj[]).forEach((a, i) => {
    const p = `allocations[${i}]`;
    const t = a.target as Obj;
    const okTarget = (t.kind === "payment" && typeof t.intentId === "string") || (t.kind === "repayment" && typeof t.obligationId === "string");
    need(okTarget, `${p}.target`, "must be {kind:'payment', intentId} or {kind:'repayment', obligationId}");
    need(!allocById.has(a.id as string), `${p}.id`, "must be unique");
    allocById.set(a.id as string, a);
    const key = t.kind === "payment" ? `payment:${t.intentId}` : `repayment:${t.obligationId}`;
    const ref = a.statementLineId as string;
    if (a.evidenceKind === "statement_line") {
      const l = lineById.get(ref);
      need(l !== undefined, `${p}.statementLineId`, "must identify a statement line in this workspace");
      need((l!.allocationIds as unknown[]).includes(a.id), `${p}.id`, "must be listed in its statement line's allocationIds");
      need(a.currency === l!.currency, `${p}.currency`, "must equal its statement line's currency");
    } else {
      const o = obsById.get(ref);
      need(o !== undefined, `${p}.statementLineId`, "must identify a chain observation in this workspace");
      need(t.kind === "payment" && o!.intentId === t.intentId, `${p}.target`, "a chain observation can evidence only its own payout");
    }
    const prev = owner.get(ref);
    need(prev === undefined || prev === key, `${p}.target`, "one statement line or chain observation cannot be allocated to two different payouts or obligations");
    owner.set(ref, key);
    total.set(ref, (total.get(ref) ?? 0) + (a.amountMinor as number));
  });
  lines.forEach((l, i) => {
    need((total.get(l.id as string) ?? 0) <= (l.amountMinor as number), `statementLines[${i}].allocationIds`, "allocations exceed the line amount");
    for (const id of l.allocationIds as unknown[]) need(typeof id === "string" && allocById.get(id)?.statementLineId === l.id, `statementLines[${i}].allocationIds`, "must list only allocations of this line");
  });
  const repaid = new Set<string>();
  (ws.repaymentAllocations as Obj[]).forEach((r, i) => {
    const ref = r.statementLineId as string;
    need(!repaid.has(ref), `repaymentAllocations[${i}].statementLineId`, "one statement line can repay at most one obligation once");
    repaid.add(ref);
    need(owner.get(ref) === `repayment:${r.obligationId}`, `repaymentAllocations[${i}].obligationId`, "must match its statement line's repayment allocation");
  });
  // Review m-3: a superseded chain observation is a rejected one, superseded by a person's resolved conflict exception.
  (ws.chainObservations as Obj[]).forEach((o, i) => {
    if (o.supersededBy === undefined) return;
    const e = (ws.exceptions as Obj[]).find((x) => x.id === o.supersededBy);
    need(o.status === "rejected_unsupported" && !!e && e.status === "resolved" && (e.supportingEventIds as unknown[]).includes(o.id), `chainObservations[${i}].supersededBy`, "must name a resolved hash-conflict exception about this rejected observation");
  });
  (ws.instructions as Obj[]).forEach((x, i) => {
    if (x.checkerId !== undefined) need(x.checkerId !== x.makerId, `instructions[${i}].checkerId`, "maker and checker must be different people");
  });
  (ws.fundingDecisions as Obj[]).forEach((d, i) => need(d.checkerId !== d.makerId, `fundingDecisions[${i}].checkerId`, "maker and checker must be different people"));
  (ws.holds as Obj[]).forEach((h, i) => {
    const decided = (h.decisions as Obj[]).map((d) => (isObj(d) ? d.decision : undefined));
    if (h.status === "released") need(decided.includes("release"), `holds[${i}].status`, "a hold is released only after the compliance reviewer's release decision");
    if (h.status === "rejected") need(decided.includes("reject"), `holds[${i}].status`, "a hold is rejected only by the compliance reviewer's decision");
  });
  (ws.intents as Obj[]).forEach((x, i) => {
    const s = x.status as Obj;
    need(!(TERMINAL.includes(s.execution as string) && s.settlement === "verified"), `intents[${i}].status.settlement`, `a ${String(s.execution)} payout cannot carry verified settlement`);
  });
}

/** Maximum nesting depth accepted in a workspace value (QA L4). Real workspaces nest < 10 deep. */
export const MAX_WORKSPACE_DEPTH = 32;

/** Iterative (no recursion, no stack overflow) depth check. */
function depthWithin(v: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (x === null || typeof x !== "object") continue;
    if (d > max) return false;
    for (const child of Array.isArray(x) ? x : Object.values(x as Obj)) if (child !== null && typeof child === "object") stack.push([child, d + 1]);
  }
  return true;
}

/** Validate an already-parsed value as a workspace (used by the API, which receives parsed JSON). */
export function parseWorkspaceValue(v: unknown): Result<Workspace> {
  if (!depthWithin(v, MAX_WORKSPACE_DEPTH)) return { ok: false, error: { code: "invalid_field", message: `Workspace nests deeper than ${MAX_WORKSPACE_DEPTH} levels.`, field: "workspace" } };
  try {
    return { ok: true, value: validate(v) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { code: "invalid_field", message: `Damaged workspace — ${e.message}. Reset to the sample.`, field: e.field } };
    return { ok: false, error: { code: "invalid_field", message: "Damaged workspace; reset to the sample.", field: "workspace" } };
  }
}

/** Parse stored workspace JSON, validating its structure. On any error the UI should reset to the sample. */
export function parseWorkspace(text: string): Result<Workspace> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalid_field", message: "Stored workspace is not valid JSON.", field: "workspace" } };
  }
  return parseWorkspaceValue(v);
}
