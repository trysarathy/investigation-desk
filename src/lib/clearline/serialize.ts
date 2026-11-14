import { isCurrency } from "./money";
import { EXCEPTION_DUE_DAYS, EXCEPTION_REQUIRED_ACTION } from "./exceptions";
import { addDays, isIsoDate, isIsoInstant, isTimeZone, orgDate } from "./tx";
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
  migrateTerminalVerified(ws);
  crossCheck(ws);
  return ws as unknown as Workspace;
}

/**
 * Review M-1: load-time migration of states that EARLIER engine versions produced and rc3 corrects, so a
 * workspace saved in the browser under v2 is repaired instead of refused. It runs on every parse (stored
 * JSON, posted API workspaces and every applyAction), is idempotent, and is recorded in the audit trail
 * (`workspace.migrated`, actor "system").
 *
 * Handled: a failed, cancelled, expired or returned payout stored with settlement "verified" while
 * settlement evidence exists (a bank debit allocated to it or a counted chain observation) — produced by
 * v2 (T-1: chain-final then payout.failed; T-2: the recompute after a person resolved a failed payout's
 * contradiction) and before CHANGE 6 (returned / verified). It becomes exactly what rc3 gives for the
 * same facts:
 * - a contradiction is still open (or, for returned, the return is) → "contradicted";
 * - a person already resolved a contradiction or the return → "none" (scope "none"), as the rc3 recompute;
 * - otherwise → "contradicted" plus the contradictory_evidence exception rc3 would have raised
 *   (CH_TRANSFER_FOR_TERMINAL_PAYOUT, RC_DEBIT_FOR_FAILED_PAYOUT or RC_DEBIT_FOR_TERMINAL_PAYOUT), owned by
 *   the case owner or else the person who created the payment, linked to the case (reopened if resolved).
 * A terminal "verified" payout WITHOUT any evidence was never produced by any engine version: it is left
 * for crossCheck to refuse.
 */
function migrateTerminalVerified(ws: Obj) {
  const intents = ws.intents as Obj[];
  const exceptions = ws.exceptions as Obj[];
  const cases = ws.cases as Obj[];
  const actors = ws.actors as Obj[];
  const asOf = ws.asOf as string;
  const nextId = (prefix: string) => {
    ws.seq = (ws.seq as number) + 1;
    return `${prefix}_${String(ws.seq).padStart(5, "0")}`;
  };
  for (const intent of intents) {
    const st = intent.status as Obj;
    const exec = st.execution as string;
    if (!TERMINAL.includes(exec) || st.settlement !== "verified") continue;
    const id = intent.id as string;
    const bankAllocs = (ws.allocations as Obj[]).filter((a) => a.evidenceKind === "statement_line" && isObj(a.target) && (a.target as Obj).kind === "payment" && (a.target as Obj).intentId === id && !(a.codes as string[]).includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"));
    const obs = (ws.chainObservations as Obj[]).filter((o) => o.intentId === id && o.status !== "rejected_unsupported");
    if (!bankAllocs.length && !obs.length) continue; // never engine-produced: crossCheck refuses it
    const mine = exceptions.filter((e) => e.intentId === id);
    const openContra = mine.some((e) => e.status !== "resolved" && (e.category === "contradictory_evidence" || (exec === "returned" && e.category === "returned_payout")));
    const resolvedByPerson = mine.some((e) => e.status === "resolved" && (e.category === "contradictory_evidence" || e.category === "returned_payout"));
    const before = `${exec} / verified (${String(st.settlementScope)})`;
    let after: string;
    if (openContra) {
      st.settlement = "contradicted";
      after = "contradicted (a contradiction is open)";
    } else if (resolvedByPerson) {
      st.settlement = "none";
      st.settlementScope = "none";
      after = "none (a person already resolved the contradiction)";
    } else {
      const chain = st.settlementScope === "onchain_transfer" || (!bankAllocs.length && obs.length > 0);
      const code = chain ? "CH_TRANSFER_FOR_TERMINAL_PAYOUT" : exec === "failed" ? "RC_DEBIT_FOR_FAILED_PAYOUT" : "RC_DEBIT_FOR_TERMINAL_PAYOUT";
      let c = cases.find((x) => x.id === intent.caseId);
      const owner = [c?.ownerId, intent.createdBy].find((a) => typeof a === "string" && actors.some((x) => x.id === a && x.role !== "viewer")) as string | undefined;
      if (!c) {
        c = { id: nextId("case"), intentId: id, ...(intent.advanceId ? { advanceId: intent.advanceId } : {}), title: `Payment ${String(intent.internalReference)} · ${String(intent.beneficiaryName)}`, status: "open", notes: [], requestedInfo: [], evidenceIds: [], exceptionIds: [], history: [{ at: asOf, actorId: "system", action: "opened", detail: "Case opened by the rc3 workspace migration" }], createdAt: asOf, updatedAt: asOf };
        cases.push(c);
        intent.caseId = c.id;
      }
      const excId = nextId("exc");
      const explanation = `${chain ? "An on-chain transfer to the beneficiary's registered wallet was observed" : "A statement debit matches this payout"}, but the provider reports the payout ${exec}. An earlier engine version stored this as verified; rc3 records the disagreement (workspace migration).`;
      exceptions.push({
        id: excId, category: "contradictory_evidence", severity: "critical", status: owner ? "in_review" : "open", explanationCode: code, explanation, intentId: id,
        ...(chain ? {} : { statementLineId: bankAllocs[0].statementLineId }), caseId: c.id, candidates: [],
        supportingEventIds: obs.map((o) => o.id as string),
        supportingEvidenceIds: (ws.evidence as Obj[]).filter((e) => e.intentId === id && (e.kind === "bank_statement_line" || e.kind === "chain_observation")).map((e) => e.id as string),
        ...(owner ? { ownerId: owner } : {}),
        dueDate: addDays(orgDate(asOf, (ws.organization as Obj).timezone as string), EXCEPTION_DUE_DAYS.critical),
        requiredAction: EXCEPTION_REQUIRED_ACTION.contradictory_evidence, createdAt: asOf, lastUpdatedAt: asOf,
        history: [
          { at: asOf, actorId: "system", action: "opened", detail: `${code}: ${explanation}` },
          ...(owner ? [{ at: asOf, actorId: "system", action: "owner_assigned", detail: `Owner: ${String(actors.find((x) => x.id === owner)!.name)} (${c.ownerId === owner ? "case owner" : "created the payment"})` }] : []),
        ],
      });
      (c.exceptionIds as string[]).push(excId);
      if (c.status === "resolved") {
        c.status = "reopened";
        (c.history as Obj[]).push({ at: asOf, actorId: "system", action: "reopened", detail: `New exception ${excId} (contradictory_evidence) linked by the rc3 migration` });
      }
      c.updatedAt = asOf;
      st.settlement = "contradicted";
      if (bankAllocs.length || (ws.allocations as Obj[]).some((a) => a.evidenceKind === "chain_observation" && isObj(a.target) && (a.target as Obj).intentId === id)) st.reconciliation = "exception";
      after = `contradicted with ${code} (${excId}${owner ? `, owner ${owner}` : ""})`;
    }
    (ws.audit as Obj[]).push({ id: nextId("aud"), at: asOf, actorId: "system", action: "workspace.migrated", entityType: "intent", entityId: id, summary: `rc3 migration: ${before} → ${after}. Saved by an earlier engine version.` });
  }
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
    // Review M-1 / n-3: the workspace may have been written by this engine; say what is wrong, not "damaged".
    if (e instanceof Invalid) return { ok: false, error: { code: "invalid_field", message: `This workspace cannot be loaded: ${e.message}. No version of the engine produces this, so it was not repaired automatically. Reset to the sample to continue.`, field: e.field } };
    return { ok: false, error: { code: "invalid_field", message: "This workspace cannot be loaded: its structure is not a Clearline workspace. Reset to the sample to continue.", field: "workspace" } };
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
