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

const EXECUTION = ["created", "quoted", "approved", "submitted", "in_transit", "provider_reported_completed", "awaiting_information", "on_hold", "failed", "returned", "cancelled", "expired"];
const SETTLEMENT = ["none", "observed", "pending_finality", "verified", "contradicted"];
const SCOPE = ["none", "provider_report", "bank_statement", "onchain_transfer"];
const RECON = ["not_started", "pending", "matched", "partially_matched", "exception"];

/** Element validators: each throws Invalid with a field path. */
const ELEMENTS: Partial<Record<keyof Workspace, (e: Obj, p: string) => void>> = {
  actors: (e, p) => { str(e, "name", p); oneOf(e, "role", p, ["operator", "approver", "compliance", "viewer"]); },
  routes: (e, p) => { str(e, "providerId", p); str(e, "providerName", p); arr(e, "sourceCurrencies", p); need(isObj(e.providerFees), `${p}.providerFees`, "must be an object"); },
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
  },
  allocations: (e, p) => { str(e, "statementLineId", p); need(isObj(e.target), `${p}.target`, "must be an object"); int(e, "amountMinor", p, 1); cur(e, "currency", p); arr(e, "codes", p); oneOf(e, "evidenceKind", p, ["statement_line", "chain_observation"]); },
  exceptions: (e, p) => {
    str(e, "category", p); oneOf(e, "status", p, ["open", "in_review", "resolved", "reopened"]); oneOf(e, "severity", p, ["low", "medium", "high", "critical"]);
    for (const k of ["candidates", "supportingEventIds", "supportingEvidenceIds", "history"]) arr(e, k, p);
    instant(e, "createdAt", p);
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
  return ws as unknown as Workspace;
}

/** Parse stored workspace JSON, validating its structure. On any error the UI should reset to the sample. */
export function parseWorkspace(text: string): Result<Workspace> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalid_field", message: "Stored workspace is not valid JSON.", field: "workspace" } };
  }
  try {
    return { ok: true, value: validate(v) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { code: "invalid_field", message: `Damaged workspace — ${e.message}. Reset to the sample.`, field: e.field } };
    return { ok: false, error: { code: "invalid_field", message: "Damaged workspace; reset to the sample.", field: "workspace" } };
  }
}
