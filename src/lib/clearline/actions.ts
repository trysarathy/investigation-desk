/**
 * Workspace actions. `applyAction` is pure: it deep-clones the input workspace, applies one
 * action and returns the new workspace plus the audit events it appended — or a typed error and
 * no changes. The engine never reads the wall clock: `ctx.at` is the simulated instant.
 */
import { getAdapter, type ScriptStep } from "./adapters";
import { ingestChainObservation, validateChainInput } from "./chain";
import { ingestPayload, setExecution } from "./events";
import { canResolveCase, canResolveException, ensureCase, openException } from "./exceptions";
import { deriveAdvanceState, obligationOutstanding } from "./funding";
import { computeLiquidity } from "./liquidity";
import { isCurrency, validateAmountMinor } from "./money";
import { reconcileLine } from "./reconciliation";
import { recomputeDimensions } from "./derive";
import { parseWorkspaceValue } from "./serialize";
import { canTransitionExecution } from "./state";
import {
  Abort,
  Tx,
  toUtc,
  fail,
  isIsoDate,
  isIsoInstant,
  minutesBetween,
  requireRole,
  safeNote,
  safeText,
  stableStringify,
} from "./tx";
import type {
  ActionContext,
  ActionResult,
  CreateAdvanceInput,
  CreateIntentInput,
  EvidenceKind,
  ExceptionCategory,
  FailureInjection,
  InvestigationCase,
  PaymentIntent,
  ReconciliationException,
  StatementLine,
  StatementLineInput,
  TargetRef,
  WebhookDelivery,
  Workspace,
  WorkspaceAction,
} from "./types";

const STRICT = typeof process !== "undefined" && !!process.env && (process.env.VITEST === "true" || process.env.CLEARLINE_ENGINE_STRICT === "1");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function applyAction(ws: Workspace, action: WorkspaceAction, ctx: ActionContext): ActionResult {
  if (!ws || ws.schemaVersion !== 1 || ws.mode !== "sandbox") return { ok: false, error: { code: "invalid_field", message: "Not a sandbox workspace.", field: "workspace" } };
  if (!ctx || !isIsoInstant(ctx.at)) return { ok: false, error: { code: "invalid_field", message: "ctx.at must be an ISO-8601 instant.", field: "at" } };
  if (Date.parse(ctx.at) < Date.parse(ws.asOf))
    return { ok: false, error: { code: "invalid_field", message: "ctx.at must not be earlier than the workspace clock (asOf).", field: "at" } };
  let tx: Tx;
  try {
    tx = new Tx(ws, ctx);
  } catch {
    return { ok: false, error: { code: "invalid_field", message: "The workspace could not be copied (malformed data). Reset to the sample.", field: "workspace" } };
  }
  // Re-review m-new-1: damaged data is caught by validation (a typed error), not by a catch-all.
  const valid = parseWorkspaceValue(tx.ws);
  if (!valid.ok) return valid;
  try {
    if (!tx.actor()) fail("unauthorized_actor", "Unknown actor.", { field: "actorId" });
    if (Date.parse(ctx.at) > Date.parse(tx.ws.asOf)) tx.ws.asOf = new Date(Date.parse(ctx.at)).toISOString();
    const outcome = dispatch(tx, action);
    syncDerived(tx);
    return { ok: true, value: { workspace: tx.ws, audit: tx.audit, outcome, createdIds: tx.created } };
  } catch (e) {
    if (e instanceof Abort) return { ok: false, error: e.engineError };
    // Re-review m-new-1: an unexpected error is a programming defect. Under tests (VITEST) or with
    // CLEARLINE_ENGINE_STRICT=1 it is rethrown so it cannot hide; otherwise (browser, API) the caller
    // gets a typed error naming the error class and action, and the API layer never returns 500.
    if (STRICT) throw e;
    const name = e instanceof Error ? e.name : "UnknownError";
    return { ok: false, error: { code: "invalid_field", message: `Internal engine error (${name}) while applying ${String((action as { type?: unknown } | null)?.type ?? "unknown action")}. Please report it; reset to the sample if it persists.` } };
  }
}

function dispatch(tx: Tx, a: WorkspaceAction): string {
  switch (a?.type) {
    case "create_intent": return createIntent(tx, a.input);
    case "request_quotes": return requestQuotes(tx, a.intentId);
    case "choose_route": return chooseRoute(tx, a.intentId, a.quoteId);
    case "approve_instruction": return decideInstruction(tx, a.instructionId, true, "");
    case "reject_instruction": return decideInstruction(tx, a.instructionId, false, a.reason);
    case "submit_instruction": return submitInstruction(tx, a.instructionId);
    case "cancel_intent": return cancelIntent(tx, a.intentId, a.reason);
    case "simulate_provider_event": return simulate(tx, a.intentId, a.injection ?? "none");
    case "ingest_webhook": return ingestWebhook(tx, a.delivery);
    case "ingest_statement_line": return ingestStatement(tx, a.line);
    case "ingest_chain_observation": {
      requireRole(tx, ["operator"]);
      const o = a.observation;
      const problem = validateChainInput(o);
      if (problem) fail("invalid_field", problem);
      if (!tx.ws.intents.some((i) => i.id === o.intentId)) fail("not_found", "Intent not found.", { entityId: o.intentId });
      return ingestChainObservation(tx, o);
    }
    case "advance_clock": return advanceClock(tx, a.to);
    case "assign_owner": return assignOwner(tx, a.target, a.ownerId);
    case "add_note": return addNote(tx, a.target, a.text);
    case "request_info": return requestInfo(tx, a.caseId, a.from, a.request);
    case "attach_evidence": return attachEvidence(tx, a.target, a.evidence);
    case "resolve": return resolve(tx, a.target, a.note);
    case "reopen": return reopen(tx, a.target, a.reason);
    case "submit_hold_documents": return submitHoldDocuments(tx, a.holdId, a.documents);
    case "assign_hold_reviewer": return assignHoldReviewer(tx, a.holdId, a.reviewerId);
    case "record_hold_decision": return holdDecision(tx, a.holdId, a.decision, a.reason);
    case "create_advance": return createAdvance(tx, a.input);
    case "decide_advance": return decideAdvance(tx, a.advanceId, a.outcome, a.reason);
    default:
      return fail("invalid_field", "Unknown action type.", { field: "type" });
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function intentById(tx: Tx, id: string): PaymentIntent {
  const i = tx.ws.intents.find((x) => x.id === id);
  if (!i) fail("not_found", `Intent ${id} not found.`, { entityId: id });
  return i;
}

function transition(tx: Tx, intent: PaymentIntent, to: PaymentIntent["status"]["execution"], why: string) {
  if (!canTransitionExecution(intent.status.execution, to))
    fail("invalid_transition", `Execution cannot move from ${intent.status.execution} to ${to}.`, { entityId: intent.id });
  setExecution(tx, intent, to, why);
}

/** Keep stored advance states consistent with the projection rules. */
function syncDerived(tx: Tx) {
  for (const adv of tx.ws.advances) adv.state = deriveAdvanceState(tx.ws, adv.id, tx.ws.asOf);
}

// ---------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------

const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,47}$/;
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,80}$/;

function createIntent(tx: Tx, input: CreateIntentInput): string {
  requireRole(tx, ["operator"]);
  if (!input || typeof input !== "object") fail("invalid_field", "input required.");
  if (typeof input.idempotencyKey !== "string" || !KEY_RE.test(input.idempotencyKey)) fail("invalid_field", "idempotencyKey must be 8–80 characters [A-Za-z0-9_-:.].", { field: "idempotencyKey" });
  const fingerprint = stableStringify({ ...input, metadata: input.metadata ?? {}, sandboxOutcome: input.sandboxOutcome ?? "success" });
  // m1: own-property lookup only, so keys like "constructor" never hit Object.prototype.
  const prior = Object.prototype.hasOwnProperty.call(tx.ws.idempotency, input.idempotencyKey) ? tx.ws.idempotency[input.idempotencyKey] : undefined;
  if (prior) {
    if (prior.fingerprint !== fingerprint) fail("idempotency_conflict", "This idempotency key was already used with a different request body.", { field: "idempotencyKey", entityId: prior.intentId });
    tx.created.push(prior.intentId);
    return "idempotent_replay";
  }
  const amount = validateAmountMinor(input.amountMinor);
  if (!amount.ok) fail(amount.error.code, amount.error.message, { field: "amountMinor" });
  if (!isCurrency(input.sourceCurrency)) fail("invalid_currency", "Unsupported source currency.", { field: "sourceCurrency" });
  if (!isCurrency(input.destinationCurrency)) fail("invalid_currency", "Unsupported destination currency.", { field: "destinationCurrency" });
  if (typeof input.internalReference !== "string" || !REF_RE.test(input.internalReference)) fail("invalid_field", "internalReference must be 2–48 characters [A-Za-z0-9._-/].", { field: "internalReference" });
  // m6: one active intent per internal reference, corrections included.
  if (tx.ws.intents.some((i) => i.internalReference === input.internalReference && !["cancelled", "expired", "failed", "returned"].includes(i.status.execution)))
    fail("invalid_field", "An active intent already uses this internal reference (duplicate intent). Use a new reference.", { field: "internalReference" });
  if (!safeText(input.purpose)) fail("invalid_field", "purpose must be 2–120 plain characters.", { field: "purpose" });
  if (!safeText(input.beneficiaryName)) fail("invalid_field", "beneficiaryName must be 2–120 plain characters (fictional).", { field: "beneficiaryName" });
  if (typeof input.beneficiaryRef !== "string" || !/^[A-Za-z0-9_\-]{3,40}$/.test(input.beneficiaryRef)) fail("invalid_field", "beneficiaryRef must be an opaque 3–40 character reference, never bank details.", { field: "beneficiaryRef" });
  if (typeof input.destinationCountry !== "string" || !/^[A-Z]{2}$/.test(input.destinationCountry)) fail("invalid_field", "destinationCountry must be ISO 3166-1 alpha-2.", { field: "destinationCountry" });
  if (!isIsoDate(input.requestedExecutionDate)) fail("invalid_field", "requestedExecutionDate must be YYYY-MM-DD.", { field: "requestedExecutionDate" });
  const metadata = input.metadata ?? {};
  if (typeof metadata !== "object" || Object.keys(metadata).length > 10 || Object.entries(metadata).some(([k, v]) => !/^[a-z0-9_]{1,40}$/.test(k) || typeof v !== "string" || v.length > 120))
    fail("invalid_field", "metadata: at most 10 snake_case keys with string values ≤ 120 chars.", { field: "metadata" });
  const outcome = input.sandboxOutcome ?? "success";
  if (!["success", "return", "hold", "chain_delay", "submission_failure"].includes(outcome)) fail("invalid_field", "Unknown sandboxOutcome.", { field: "sandboxOutcome" });
  if (input.correctsIntentId !== undefined) {
    const orig = intentById(tx, input.correctsIntentId);
    if (orig.status.execution !== "returned" && orig.status.execution !== "failed") fail("precondition_failed", "Only a returned or failed payout can be corrected.", { entityId: orig.id });
    // QA M1: at most one live correction per returned/failed payout (no double re-payment).
    const live = tx.ws.intents.find((i) => i.correctsIntentId === orig.id && !["cancelled", "expired", "failed", "returned"].includes(i.status.execution));
    if (live) fail("precondition_failed", `Payout ${orig.id} already has an active correction (${live.id}).`, { entityId: live.id });
  }
  const rails = [...new Set(tx.ws.routes.filter((r) => !r.restriction && r.sourceCurrencies.includes(input.sourceCurrency) && r.destinationCurrencies.includes(input.destinationCurrency)).map((r) => r.rail))];
  const intent: PaymentIntent = {
    id: tx.id("pi"),
    orgId: tx.ws.organization.id,
    internalReference: input.internalReference,
    amountMinor: input.amountMinor,
    sourceCurrency: input.sourceCurrency,
    destinationCurrency: input.destinationCurrency,
    purpose: input.purpose,
    beneficiaryRef: input.beneficiaryRef,
    beneficiaryName: input.beneficiaryName,
    destinationCountry: input.destinationCountry,
    requestedExecutionDate: input.requestedExecutionDate,
    railEligibility: rails,
    idempotencyKey: input.idempotencyKey,
    metadata: { ...metadata },
    sandboxOutcome: outcome,
    status: { execution: "created", settlement: "none", settlementScope: "none", reconciliation: "not_started" },
    quoteIds: [],
    correctsIntentId: input.correctsIntentId,
    createdBy: tx.actorId,
    createdAt: tx.at,
    updatedAt: tx.at,
  };
  tx.ws.intents.push(intent);
  Object.defineProperty(tx.ws.idempotency, input.idempotencyKey, { value: { intentId: intent.id, fingerprint }, enumerable: true, writable: true, configurable: true });
  tx.created.push(intent.id);
  tx.log("intent.created", "intent", intent.id, `${input.internalReference} · ${input.sourceCurrency}→${input.destinationCurrency}`);
  if (input.correctsIntentId) {
    const orig = intentById(tx, input.correctsIntentId);
    const c = ensureCase(tx, { intentId: orig.id });
    c.history.push({ at: tx.at, actorId: tx.actorId, action: "correction_created", detail: `Correction intent ${intent.id} created` });
    tx.log("intent.correction", "intent", orig.id, `Correction intent ${intent.id}`);
  }
  return "applied";
}

function requestQuotes(tx: Tx, intentId: string): string {
  requireRole(tx, ["operator"]);
  const intent = intentById(tx, intentId);
  if (intent.status.execution !== "created" && intent.status.execution !== "quoted")
    fail("invalid_transition", `Quotes can be requested only for created or quoted intents (now ${intent.status.execution}).`, { entityId: intent.id });
  const ids: string[] = [];
  for (const route of tx.ws.routes) {
    const adapter = getAdapter(route.providerId);
    if (!adapter) continue;
    const q = adapter.quote(intent, route, tx.at, tx.id("qt"));
    tx.ws.quotes.push(q);
    ids.push(q.id);
  }
  intent.quoteIds = ids;
  tx.created.push(...ids);
  const eligible = tx.ws.quotes.filter((q) => ids.includes(q.id) && q.eligible).length;
  tx.log("quotes.requested", "intent", intent.id, `${eligible} eligible of ${ids.length} indicative sandbox quotes`);
  if (!eligible) return "no_eligible_route";
  if (intent.status.execution === "created") setExecution(tx, intent, "quoted", "Indicative quotes received");
  return "applied";
}

function chooseRoute(tx: Tx, intentId: string, quoteId: string): string {
  // Approvers may also prepare instructions; they can then never check their own.
  requireRole(tx, ["operator", "approver"]);
  const intent = intentById(tx, intentId);
  if (intent.status.execution !== "quoted") fail("invalid_transition", "A route can be chosen only while the intent is quoted.", { entityId: intent.id });
  const q = tx.ws.quotes.find((x) => x.id === quoteId && x.intentId === intent.id);
  if (!q) fail("not_found", "Quote not found for this intent.", { entityId: quoteId });
  if (!q.eligible) fail("quote_ineligible", `Route is not eligible: ${q.eligibilityReason}`, { entityId: q.id });
  if (Date.parse(tx.at) > Date.parse(q.expiresAt)) fail("quote_expired", "Quote expired; request new quotes.", { entityId: q.id });
  const open = tx.ws.instructions.find((i) => i.intentId === intent.id && i.status !== "rejected");
  if (open) fail("precondition_failed", "An instruction is already pending for this intent; reject it first.", { entityId: open.id });
  const instrId = tx.id("ins");
  tx.ws.instructions.push({
    id: instrId,
    intentId: intent.id,
    quoteId: q.id,
    routeId: q.routeId,
    providerId: q.providerId,
    amountMinor: intent.amountMinor,
    currency: intent.sourceCurrency,
    makerId: tx.actorId,
    madeAt: tx.at,
    status: "pending_approval",
  });
  intent.selectedQuoteId = q.id;
  intent.instructionId = instrId;
  intent.updatedAt = tx.at;
  tx.created.push(instrId);
  tx.log("instruction.created", "instruction", instrId, `Route ${q.routeId} chosen by maker; awaiting a different checker`);
  return "applied";
}

function decideInstruction(tx: Tx, instructionId: string, approve: boolean, reason: string): string {
  const instr = tx.ws.instructions.find((i) => i.id === instructionId);
  if (!instr) fail("not_found", "Instruction not found.", { entityId: instructionId });
  // Separation of duties is checked first so the maker always sees maker_checker_violation.
  if (instr.makerId === tx.actorId) fail("maker_checker_violation", "The checker must be a different person from the maker.", { entityId: instr.id });
  requireRole(tx, ["approver"]);
  if (instr.status !== "pending_approval") fail("invalid_transition", `Instruction is ${instr.status}, not pending approval.`, { entityId: instr.id });
  const intent = intentById(tx, instr.intentId);
  instr.checkerId = tx.actorId;
  instr.checkedAt = tx.at;
  if (!approve) {
    if (!safeNote(reason, 300)) fail("invalid_field", "A rejection reason is required.", { field: "reason" });
    instr.status = "rejected";
    intent.instructionId = undefined;
    intent.selectedQuoteId = undefined;
    tx.log("instruction.rejected", "instruction", instr.id, reason);
    return "applied";
  }
  const q = tx.ws.quotes.find((x) => x.id === instr.quoteId)!;
  if (Date.parse(tx.at) > Date.parse(q.expiresAt)) fail("quote_expired", "The selected quote expired before approval; request new quotes.", { entityId: q.id });
  instr.status = "approved";
  transition(tx, intent, "approved", `Approved by checker ${tx.actorId} (maker ${instr.makerId})`);
  tx.log("instruction.approved", "instruction", instr.id, `Checker ${tx.actorId} approved maker ${instr.makerId}'s instruction`);
  return "applied";
}

function submitInstruction(tx: Tx, instructionId: string): string {
  requireRole(tx, ["operator"]);
  const instr = tx.ws.instructions.find((i) => i.id === instructionId);
  if (!instr) fail("not_found", "Instruction not found.", { entityId: instructionId });
  if (instr.status !== "approved") fail("invalid_transition", `Only an approved instruction can be submitted (now ${instr.status}).`, { entityId: instr.id });
  const intent = intentById(tx, instr.intentId);
  if (intent.status.execution !== "approved") fail("invalid_transition", `Intent is ${intent.status.execution}.`, { entityId: intent.id });
  const adapter = getAdapter(instr.providerId)!;
  const res = adapter.submit(instr, intent, tx.at);
  if (!res.ok) {
    instr.status = "submitted";
    instr.submittedAt = tx.at;
    setExecution(tx, intent, "submitted", "Instruction sent to provider sandbox");
    setExecution(tx, intent, "failed", "Provider sandbox rejected the instruction synchronously");
    openException(tx, {
      category: "failed_submission",
      explanationCode: "PV_SUBMISSION_REJECTED",
      explanation: res.error.message,
      intentId: intent.id,
    });
    return "exception_raised";
  }
  instr.status = "submitted";
  instr.submittedAt = tx.at;
  instr.providerPaymentId = res.value.providerPaymentId;
  setExecution(tx, intent, "submitted", "Instruction accepted by provider sandbox");
  intent.status.reconciliation = "pending";
  ingestPayload(tx, { providerId: instr.providerId, rawBody: JSON.stringify(adapter.acknowledge(res.value)), signatureResult: "not_applicable", provenance: "provider_api_response" });
  tx.log("instruction.submitted", "instruction", instr.id, `Provider payment id ${res.value.providerPaymentId}`);
  return "applied";
}

function cancelIntent(tx: Tx, intentId: string, reason: string): string {
  requireRole(tx, ["operator", "approver"]);
  const intent = intentById(tx, intentId);
  if (!safeNote(reason, 300)) fail("invalid_field", "A cancellation reason is required.", { field: "reason" });
  // M7: once submitted (including on_hold / awaiting_information) a payout ends only through the
  // provider or, for a hold, the compliance reviewer's decision.
  if (!["created", "quoted", "approved"].includes(intent.status.execution))
    fail("invalid_transition", `A ${intent.status.execution} payout cannot be cancelled in Clearline; it was already submitted to the provider.`, { entityId: intent.id });
  transition(tx, intent, "cancelled", reason);
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Provider events
// ---------------------------------------------------------------------------------------------

function deliverStep(tx: Tx, providerId: string, step: ScriptStep, tamper = false): string {
  if (step.kind === "none") return "no_event_pending";
  if (step.kind === "chain") return ingestChainObservation(tx, step.observation);
  const adapter = getAdapter(providerId)!;
  const rawBody = JSON.stringify(step.payload);
  let header = adapter.signWebhook(rawBody, unix(tx.at));
  if (tamper) header = header.slice(0, -4) + (header.endsWith("0000") ? "1111" : "0000");
  return ingestWebhookRaw(tx, { providerId, rawBody, signatureHeader: header });
}

function ingestWebhookRaw(tx: Tx, d: WebhookDelivery): string {
  const adapter = getAdapter(d.providerId);
  if (!adapter) fail("not_found", "Unknown provider.", { field: "providerId" });
  if (typeof d.rawBody !== "string" || d.rawBody.length > 16_000) fail("invalid_field", "rawBody must be a string ≤ 16 KB.", { field: "rawBody" });
  const v = adapter.verifyWebhook(d.rawBody, d.signatureHeader, unix(tx.at));
  return ingestPayload(tx, { providerId: d.providerId, rawBody: d.rawBody, signatureResult: v.valid ? "valid" : "invalid", provenance: "provider_webhook" }).outcome;
}

function ingestWebhook(tx: Tx, d: WebhookDelivery): string {
  requireRole(tx, ["operator"]);
  if (!d || typeof d !== "object") fail("invalid_field", "delivery required.");
  return ingestWebhookRaw(tx, d);
}

function simulate(tx: Tx, intentId: string, injection: FailureInjection): string {
  requireRole(tx, ["operator"]);
  const intent = intentById(tx, intentId);
  const instr = tx.ws.instructions.find((i) => i.id === intent.instructionId);
  if (!instr?.providerPaymentId) fail("precondition_failed", "Submit the instruction before simulating provider events.", { entityId: intent.id });
  const adapter = getAdapter(instr.providerId)!;
  switch (injection) {
    case "none":
      return deliverStep(tx, instr.providerId, adapter.pollStatus(tx.ws, intent, instr, tx.at));
    case "bad_signature":
      return deliverStep(tx, instr.providerId, adapter.pollStatus(tx.ws, intent, instr, tx.at), true);
    case "timeout": {
      tx.ws.providerEvents.push({
        id: tx.id("pev"), providerId: instr.providerId, providerName: adapter.capabilities().providerName, providerEventId: `timeout-${tx.ws.seq}`, intentId: intent.id, providerPaymentId: instr.providerPaymentId,
        payloadRef: "none", payloadHash: "none", providerTimestamp: tx.at, receivedAt: tx.at, sequence: 0, signatureResult: "not_applicable",
        dedupeKey: `timer:${intent.id}:${tx.at}`, normalizedType: "payout.timeout", processingOutcome: "recorded_no_state_change",
        provenance: "clearline_timer", confidence: "observed", errorClass: "timeout", detail: { note: "Clearline timer: no provider response; not a provider event" },
      });
      openException(tx, {
        category: "provider_timeout",
        explanationCode: "PV_NO_RESPONSE_SIMULATED",
        explanation: `No status from ${adapter.capabilities().providerName} for ${instr.providerPaymentId} (simulated timeout). The payout's real outcome is unknown; do not resubmit.`,
        intentId: intent.id,
      });
      return "timeout_exception_raised";
    }
    case "duplicate": {
      const last = [...tx.ws.providerEvents].reverse().find((e) => e.intentId === intent.id && e.provenance === "provider_webhook" && e.signatureResult === "valid");
      if (!last) fail("precondition_failed", "No delivered webhook to duplicate yet.", { entityId: intent.id });
      if (!last.rawBody) fail("precondition_failed", "Original payload not retained.", { entityId: last.id });
      const header = adapter.signWebhook(last.rawBody, unix(tx.at));
      return ingestWebhookRaw(tx, { providerId: instr.providerId, rawBody: last.rawBody, signatureHeader: header });
    }
    case "out_of_order": {
      const first = adapter.pollStatus(tx.ws, intent, instr, tx.at);
      if (first.kind !== "webhook") fail("precondition_failed", "No pair of upcoming webhooks to reorder.", { entityId: intent.id });
      // Compute the event that would follow, on a scratch copy, then deliver it first.
      const scratch = new Tx(tx.ws, tx.ctx);
      ingestPayload(scratch, { providerId: instr.providerId, rawBody: JSON.stringify(first.payload), signatureResult: "valid", provenance: "provider_webhook" });
      const sIntent = scratch.ws.intents.find((i) => i.id === intent.id)!;
      const sInstr = scratch.ws.instructions.find((i) => i.id === instr.id)!;
      const second = adapter.pollStatus(scratch.ws, sIntent, sInstr, tx.at);
      if (second.kind !== "webhook") fail("precondition_failed", "No later webhook exists to deliver out of order.", { entityId: intent.id });
      deliverStep(tx, instr.providerId, second);
      return deliverStep(tx, instr.providerId, first);
    }
    case "contradictory": {
      const exec = intent.status.execution;
      const seq = tx.ws.providerEvents.filter((e) => e.intentId === intent.id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
      const base = { id: `${instr.providerPaymentId}-E${seq}`, provider_payment_id: instr.providerPaymentId!, sequence: seq, occurred_at: tx.at };
      const payload =
        exec === "provider_reported_completed" || exec === "returned"
          ? { ...base, type: "payout.failed" as const, reason: "provider_unavailable" }
          : exec === "failed"
            ? { ...base, type: "payout.completed" as const }
            : { ...base, type: "payout.completed" as const, amount_minor: instr.amountMinor + 100, currency: instr.currency };
      return deliverStep(tx, instr.providerId, { kind: "webhook", payload });
    }
    default:
      return fail("invalid_field", "Unknown failure injection.", { field: "injection" });
  }
}

// ---------------------------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------------------------

function ingestStatement(tx: Tx, input: StatementLineInput): string {
  requireRole(tx, ["operator"]);
  if (!input || typeof input !== "object") fail("invalid_field", "line required.");
  if (typeof input.lineId !== "string" || !/^[A-Za-z0-9_\-:.]{1,64}$/.test(input.lineId)) fail("invalid_field", "lineId required.", { field: "lineId" });
  if (!["bank_statement", "provider_settlement_report"].includes(input.source)) fail("invalid_field", "Unknown statement source.", { field: "source" });
  if (!safeText(input.accountRef, 2, 64)) fail("invalid_field", "accountRef required.", { field: "accountRef" });
  if (!["debit", "credit"].includes(input.direction)) fail("invalid_field", "direction must be debit or credit.", { field: "direction" });
  if (!["payment", "return", "reversal"].includes(input.kind)) fail("invalid_field", "kind must be payment, return or reversal.", { field: "kind" });
  const amt = validateAmountMinor(input.amountMinor);
  if (!amt.ok) fail(amt.error.code, amt.error.message, { field: "amountMinor" });
  if (!isCurrency(input.currency)) fail("invalid_currency", "Unsupported currency.", { field: "currency" });
  if (typeof input.reference !== "string" || input.reference.length > 140 || /[<>]/.test(input.reference)) fail("invalid_field", "reference must be plain text ≤ 140 chars (may be empty).", { field: "reference" });
  if (typeof input.counterparty !== "string" || input.counterparty.length > 120 || /[<>]/.test(input.counterparty)) fail("invalid_field", "counterparty must be plain text.", { field: "counterparty" });
  if (!isIsoDate(input.valueDate)) fail("invalid_field", "valueDate must be YYYY-MM-DD.", { field: "valueDate" });
  if (input.receivedAt !== undefined && !isIsoInstant(input.receivedAt)) fail("invalid_field", "receivedAt must be ISO-8601.", { field: "receivedAt" });
  const dup = tx.ws.statementLines.find((l) => l.source === input.source && l.accountRef === input.accountRef && l.lineId === input.lineId);
  if (dup) fail("duplicate_statement_line", `Statement line ${input.lineId} was already ingested.`, { entityId: dup.id });
  const line: StatementLine = { ...input, id: tx.id("stl"), receivedAt: input.receivedAt !== undefined ? toUtc(input.receivedAt) : tx.at, allocationIds: [], status: "unallocated", explanationCodes: [] };
  tx.ws.statementLines.push(line);
  tx.created.push(line.id);
  tx.log("statement.ingested", "statement_line", line.id, `${input.source} ${input.direction} ${input.amountMinor} ${input.currency} ref "${input.reference}"`);
  return reconcileLine(tx, line);
}

// ---------------------------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------------------------

const TIMEOUT_MIN_MINUTES = 240;
const MISSING_STATEMENT_MINUTES = 2 * 1440;

function advanceClock(tx: Tx, to: string): string {
  requireRole(tx, ["operator", "approver", "compliance"]);
  if (!isIsoInstant(to) || Date.parse(to) < Date.parse(tx.ws.asOf)) fail("invalid_field", "to must be an ISO instant not earlier than asOf.", { field: "to" });
  const ws = tx.ws;
  ws.asOf = new Date(Date.parse(to)).toISOString();
  const now = ws.asOf;
  for (const q of ws.quotes) if (q.freshness === "fresh" && Date.parse(q.expiresAt) < Date.parse(now)) q.freshness = "expired";
  for (const intent of ws.intents) {
    const exec = intent.status.execution;
    if (["created", "quoted", "approved"].includes(exec) && intent.requestedExecutionDate < tx.orgDate(now)) {
      setExecution(tx, intent, "expired", "Requested execution date passed before submission");
      continue;
    }
    const instr = ws.instructions.find((i) => i.id === intent.instructionId);
    const route = ws.routes.find((r) => r.id === instr?.routeId);
    const lastProvider = ws.providerEvents
      .filter((e) => e.intentId === intent.id && e.provenance !== "clearline_timer" && e.processingOutcome !== "rejected_signature")
      .reduce((m, e) => (!m || Date.parse(e.receivedAt) > Date.parse(m) ? e.receivedAt : m), instr?.submittedAt ?? "");
    if ((exec === "submitted" || exec === "in_transit") && lastProvider && route) {
      const limit = Math.max(route.etaMinutes * 2, TIMEOUT_MIN_MINUTES);
      if (minutesBetween(lastProvider, now) > limit)
        openException(tx, {
          category: "provider_timeout",
          explanationCode: "PV_NO_STATUS_WITHIN_WINDOW",
          explanation: `No provider status for ${minutesBetween(lastProvider, now)} minutes (window ${limit}). Outcome unknown; do not resubmit.`,
          intentId: intent.id,
        });
    }
    if (exec === "provider_reported_completed" && intent.status.reconciliation !== "matched" && intent.status.settlementScope !== "onchain_transfer") {
      const done = ws.providerEvents.find((e) => e.intentId === intent.id && e.normalizedType === "payout.completed" && e.processingOutcome === "applied");
      if (done && minutesBetween(done.receivedAt, now) > MISSING_STATEMENT_MINUTES && !ws.allocations.some((a) => a.target.kind === "payment" && a.target.intentId === intent.id))
        openException(tx, {
          category: "missing_statement",
          explanationCode: "RC_NO_STATEMENT_AFTER_COMPLETION",
          explanation: "Provider reported completion more than 2 days ago and no statement line has been matched.",
          intentId: intent.id,
          impact: { amountMinor: intent.amountMinor, currency: intent.sourceCurrency },
        });
    }
  }
  for (const ob of ws.obligations) {
    const out = obligationOutstanding(ws, ob.id);
    if (out.amountMinor > 0 && tx.orgDate(now) > ob.dueDate)
      openException(tx, {
        category: "overdue_advance",
        explanationCode: "FD_OUTSTANDING_AFTER_DUE_DATE",
        explanation: `Repayment reference ${ob.reference} still has ${out.amountMinor} ${out.currency} minor units outstanding after the due date ${ob.dueDate}.`,
        advanceId: ob.advanceId,
        obligationId: ob.id,
        impact: out,
        dueDate: ob.dueDate,
      });
  }
  tx.log("clock.advanced", "workspace", "clock", `Simulated clock moved to ${now}`);
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Cases and exceptions
// ---------------------------------------------------------------------------------------------

function target(tx: Tx, t: TargetRef): { kind: "case"; c: InvestigationCase } | { kind: "exception"; e: ReconciliationException } {
  if (!t || (t.kind !== "case" && t.kind !== "exception")) fail("invalid_field", "target must be {kind:'case'|'exception', id}.", { field: "target" });
  if (t.kind === "case") {
    const c = tx.ws.cases.find((x) => x.id === t.id);
    if (!c) fail("not_found", "Case not found.", { entityId: t.id });
    return { kind: "case", c };
  }
  const e = tx.ws.exceptions.find((x) => x.id === t.id);
  if (!e) fail("not_found", "Exception not found.", { entityId: t.id });
  return { kind: "exception", e };
}

const STAFF = ["operator", "approver", "compliance"] as const;

function assignOwner(tx: Tx, t: TargetRef, ownerId: string): string {
  requireRole(tx, [...STAFF]);
  const owner = tx.ws.actors.find((a) => a.id === ownerId);
  if (!owner || owner.role === "viewer") fail("invalid_field", "Owner must be a non-viewer actor.", { field: "ownerId" });
  const r = target(tx, t);
  const entry = { at: tx.at, actorId: tx.actorId, action: "owner_assigned", detail: `Owner: ${owner.name}` };
  if (r.kind === "case") { r.c.ownerId = ownerId; r.c.history.push(entry); r.c.updatedAt = tx.at; }
  else { r.e.ownerId = ownerId; r.e.history.push(entry); r.e.lastUpdatedAt = tx.at; if (r.e.status === "open") r.e.status = "in_review"; }
  tx.log("owner.assigned", t.kind, t.id, owner.name);
  return "applied";
}

function addNote(tx: Tx, t: TargetRef, text: string): string {
  requireRole(tx, [...STAFF]);
  if (!safeNote(text)) fail("invalid_field", "Note must be 1–1000 plain characters.", { field: "text" });
  const r = target(tx, t);
  if (r.kind === "case") { r.c.notes.push({ at: tx.at, actorId: tx.actorId, text }); r.c.updatedAt = tx.at; }
  else { r.e.history.push({ at: tx.at, actorId: tx.actorId, action: "note", detail: text }); r.e.lastUpdatedAt = tx.at; }
  tx.log("note.added", t.kind, t.id, text.slice(0, 80));
  return "applied";
}

function requestInfo(tx: Tx, caseId: string, from: string, request: string): string {
  requireRole(tx, [...STAFF]);
  const c = tx.ws.cases.find((x) => x.id === caseId);
  if (!c) fail("not_found", "Case not found.", { entityId: caseId });
  if (!safeText(from, 2, 80) || !safeNote(request, 300)) fail("invalid_field", "from and request are required plain text.");
  const id = tx.id("req");
  c.requestedInfo.push({ id, at: tx.at, actorId: tx.actorId, from, request, status: "open" });
  c.history.push({ at: tx.at, actorId: tx.actorId, action: "info_requested", detail: `${from}: ${request}` });
  c.updatedAt = tx.at;
  tx.created.push(id);
  tx.log("case.info_requested", "case", c.id, `${from}: ${request}`);
  return "applied";
}

const EVIDENCE_KINDS: EvidenceKind[] = ["document_metadata", "funds_returned_confirmation", "beneficiary_correction", "note", "bank_statement_line", "provider_settlement_report", "provider_status_report", "chain_observation"];

function attachEvidence(tx: Tx, t: TargetRef, input: { kind: EvidenceKind; description: string; documentName?: string; reference?: string; sha256?: string }): string {
  requireRole(tx, [...STAFF]);
  if (!input || !EVIDENCE_KINDS.includes(input.kind)) fail("invalid_field", "Unknown evidence kind.", { field: "kind" });
  if (!safeNote(input.description, 300)) fail("invalid_field", "description required.", { field: "description" });
  if (input.documentName !== undefined && !safeText(input.documentName, 1, 120)) fail("invalid_field", "documentName must be plain text (metadata only).", { field: "documentName" });
  if (input.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(input.sha256)) fail("invalid_field", "sha256 must be 64 lowercase hex.", { field: "sha256" });
  if (input.reference !== undefined && !safeText(input.reference, 1, 80)) fail("invalid_field", "reference must be plain text.", { field: "reference" });
  const r = target(tx, t);
  const c = r.kind === "case" ? r.c : r.e.caseId ? tx.ws.cases.find((x) => x.id === r.e.caseId) : undefined;
  const ev = {
    id: tx.id("evd"),
    kind: input.kind,
    intentId: c?.intentId ?? (r.kind === "exception" ? r.e.intentId : undefined),
    caseId: c?.id,
    advanceId: c?.advanceId ?? (r.kind === "exception" ? r.e.advanceId : undefined),
    description: input.description,
    source: "User-attached metadata (sandbox; no file stored)",
    independent: false,
    reference: input.reference,
    documentName: input.documentName,
    sha256: input.sha256,
    recordedBy: tx.actorId,
    recordedAt: tx.at,
  };
  tx.ws.evidence.push(ev);
  tx.created.push(ev.id);
  if (c) {
    c.evidenceIds.push(ev.id);
    c.updatedAt = tx.at;
    const req = c.requestedInfo.find((q) => q.id === input.reference && q.status === "open");
    if (req) req.status = "provided";
  }
  if (r.kind === "exception") {
    r.e.supportingEvidenceIds.push(ev.id);
    r.e.history.push({ at: tx.at, actorId: tx.actorId, action: "evidence_attached", detail: input.description });
    r.e.lastUpdatedAt = tx.at;
  }
  tx.log("evidence.attached", t.kind, t.id, `${input.kind}: ${input.description.slice(0, 60)}`);
  return "applied";
}

function resolve(tx: Tx, t: TargetRef, note: string): string {
  requireRole(tx, [...STAFF]);
  if (!safeNote(note, 500)) fail("invalid_field", "A resolution note is required.", { field: "note" });
  const r = target(tx, t);
  if (r.kind === "exception") {
    const check = canResolveException(tx.ws, r.e.id);
    if (!check.allowed) fail("resolution_not_permitted", `${check.code}: ${check.reason}`, { entityId: r.e.id });
    r.e.status = "resolved";
    r.e.resolution = { at: tx.at, actorId: tx.actorId, note };
    r.e.history.push({ at: tx.at, actorId: tx.actorId, action: "resolved", detail: note });
    r.e.lastUpdatedAt = tx.at;
    tx.log("exception.resolved", "exception", r.e.id, note.slice(0, 80));
    // M3/m3: after a person resolves an exception, re-derive the dimensions from recorded evidence.
    const linked = r.e.intentId ? tx.ws.intents.find((i) => i.id === r.e.intentId) : undefined;
    if (linked && linked.instructionId) {
      const before = JSON.stringify(linked.status);
      recomputeDimensions(tx.ws, linked);
      if (JSON.stringify(linked.status) !== before) tx.log("intent.dimensions_recomputed", "intent", linked.id, `After resolving ${r.e.id}: ${JSON.stringify(linked.status)}`);
    }
    return "applied";
  }
  const c = r.c;
  const check = canResolveCase(tx.ws, c.id);
  if (!check.allowed)
    fail(check.code === "ALREADY_RESOLVED" ? "invalid_transition" : check.code === "HOLD_UNDECIDED" ? "hold_requires_human_decision" : "resolution_not_permitted", `${check.code}: ${check.reason}`, { entityId: c.id });
  c.status = "resolved";
  c.history.push({ at: tx.at, actorId: tx.actorId, action: "resolved", detail: note });
  c.updatedAt = tx.at;
  tx.log("case.resolved", "case", c.id, note.slice(0, 80));
  return "applied";
}

function reopen(tx: Tx, t: TargetRef, reason: string): string {
  requireRole(tx, [...STAFF]);
  if (!safeNote(reason, 500)) fail("invalid_field", "A reason is required.", { field: "reason" });
  const r = target(tx, t);
  const entry = { at: tx.at, actorId: tx.actorId, action: "reopened", detail: reason };
  if (r.kind === "case") {
    if (r.c.status !== "resolved") fail("invalid_transition", "Only a resolved case can be reopened.", { entityId: r.c.id });
    r.c.status = "reopened"; r.c.history.push(entry); r.c.updatedAt = tx.at;
  } else {
    if (r.e.status !== "resolved") fail("invalid_transition", "Only a resolved exception can be reopened.", { entityId: r.e.id });
    r.e.status = "reopened"; r.e.history.push(entry); r.e.lastUpdatedAt = tx.at;
    const c = tx.ws.cases.find((x) => x.id === r.e.caseId);
    if (c && c.status === "resolved") { c.status = "reopened"; c.history.push(entry); c.updatedAt = tx.at; }
  }
  tx.log(`${t.kind}.reopened`, t.kind, t.id, reason.slice(0, 80));
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Compliance holds (never auto-released)
// ---------------------------------------------------------------------------------------------

function holdById(tx: Tx, id: string) {
  const h = tx.ws.holds.find((x) => x.id === id);
  if (!h) fail("not_found", "Hold not found.", { entityId: id });
  return h;
}

function submitHoldDocuments(tx: Tx, holdId: string, documents: string[]): string {
  requireRole(tx, ["operator"]);
  const h = holdById(tx, holdId);
  if (h.status === "released" || h.status === "rejected") fail("invalid_transition", "Hold already decided.", { entityId: h.id });
  if (!Array.isArray(documents) || !documents.length || documents.length > 10 || !documents.every((d) => safeText(d, 2, 120)))
    fail("invalid_field", "documents: 1–10 document names (metadata only).", { field: "documents" });
  const c = ensureCase(tx, { intentId: h.intentId });
  for (const name of documents) {
    const ev = { id: tx.id("evd"), kind: "document_metadata" as const, intentId: h.intentId, caseId: c.id, description: `Document submitted to partner: ${name}`, source: "User-attached metadata (sandbox; no file stored)", independent: false, documentName: name, recordedBy: tx.actorId, recordedAt: tx.at };
    tx.ws.evidence.push(ev);
    c.evidenceIds.push(ev.id);
    h.submittedDocuments.push({ name, evidenceId: ev.id, at: tx.at, by: tx.actorId });
    const req = c.requestedInfo.find((q) => q.status === "open" && q.request === name);
    if (req) req.status = "provided";
  }
  if (h.status === "open") h.status = "documents_submitted";
  h.updatedAt = tx.at;
  tx.log("hold.documents_submitted", "hold", h.id, documents.join("; "));
  return "applied";
}

function assignHoldReviewer(tx: Tx, holdId: string, reviewerId: string): string {
  requireRole(tx, ["compliance", "approver"]);
  const h = holdById(tx, holdId);
  const reviewer = tx.ws.actors.find((a) => a.id === reviewerId);
  if (!reviewer || reviewer.role !== "compliance") fail("invalid_field", "Reviewer must have the compliance role.", { field: "reviewerId" });
  h.reviewerId = reviewerId;
  h.updatedAt = tx.at;
  const exc = tx.ws.exceptions.find((e) => e.intentId === h.intentId && e.category === "compliance_hold" && e.status !== "resolved");
  if (exc && !exc.ownerId) { exc.ownerId = reviewerId; exc.status = "in_review"; exc.history.push({ at: tx.at, actorId: tx.actorId, action: "owner_assigned", detail: `Reviewer ${reviewer.name}` }); }
  tx.log("hold.reviewer_assigned", "hold", h.id, reviewer.name);
  return "applied";
}

function holdDecision(tx: Tx, holdId: string, decision: "release" | "reject" | "request_more", reason: string): string {
  const h = holdById(tx, holdId);
  if (h.submittedDocuments.some((d) => d.by === tx.actorId)) fail("maker_checker_violation", "The reviewer must not be the person who submitted the documents.", { entityId: h.id });
  requireRole(tx, ["compliance"]);
  if (h.reviewerId !== tx.actorId) fail("unauthorized_actor", "Only the assigned compliance reviewer can decide this hold.", { entityId: h.id });
  if (h.status === "released" || h.status === "rejected") fail("invalid_transition", "Hold already decided.", { entityId: h.id });
  if (!["release", "reject", "request_more"].includes(decision)) fail("invalid_field", "Unknown decision.", { field: "decision" });
  if (!safeNote(reason, 500)) fail("invalid_field", "A decision reason is required.", { field: "reason" });
  if (h.submittedDocuments.some((d) => d.by === tx.actorId)) fail("maker_checker_violation", "The reviewer must not be the person who submitted the documents.", { entityId: h.id });
  const intent = intentById(tx, h.intentId);
  if (decision === "release" && h.submittedDocuments.length === 0) fail("precondition_failed", "Release requires the requested documents to have been submitted.", { entityId: h.id });
  h.decisions.push({ at: tx.at, reviewerId: tx.actorId, decision, reason });
  h.updatedAt = tx.at;
  if (decision === "release") {
    if (h.partnerReleaseReportedAt) {
      h.status = "released";
      transition(tx, intent, "in_transit", "Compliance reviewer released after the partner reported release");
    }
  } else if (decision === "reject") {
    h.status = "rejected";
    transition(tx, intent, "cancelled", "Compliance reviewer declined to proceed with the held payout");
  } else {
    // m12: keep the partner's release visible if it was already reported.
    h.status = h.partnerReleaseReportedAt ? "partner_release_reported" : "open";
    h.requestedDocuments.push(reason);
    const c = ensureCase(tx, { intentId: h.intentId });
    c.requestedInfo.push({ id: tx.id("req"), at: tx.at, actorId: tx.actorId, from: "operations", request: reason, status: "open" });
  }
  tx.log("hold.decision", "hold", h.id, `${decision}: ${reason.slice(0, 60)}${decision === "release" && h.status !== "released" ? " (awaiting partner release)" : ""}`);
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Funding Desk projection actions
// ---------------------------------------------------------------------------------------------

function createAdvance(tx: Tx, input: CreateAdvanceInput): string {
  requireRole(tx, ["operator"]);
  if (!input || typeof input !== "object") fail("invalid_field", "input required.");
  const intent = intentById(tx, input.intentId);
  if (intent.advanceId) fail("precondition_failed", "This payment already has an advance.", { entityId: intent.advanceId });
  if (["cancelled", "expired", "failed", "returned"].includes(intent.status.execution))
    fail("precondition_failed", `An advance cannot fund a ${intent.status.execution} payment.`, { entityId: intent.id });
  if (!safeText(input.customerRef, 2, 40) || !safeText(input.customerName) || !safeText(input.supplierName) || !safeText(input.invoiceRef, 2, 48))
    fail("invalid_field", "customerRef, customerName, supplierName and invoiceRef are required plain text.");
  if (!isIsoDate(input.dueDate)) fail("invalid_field", "dueDate must be YYYY-MM-DD.", { field: "dueDate" });
  if (typeof input.repaymentReference !== "string" || !/^[A-Z0-9][A-Z0-9\-]{5,39}$/.test(input.repaymentReference))
    fail("invalid_field", "repaymentReference must be 6–40 uppercase letters, digits or hyphens.", { field: "repaymentReference" });
  if (tx.ws.advances.some((a) => a.repaymentReference === input.repaymentReference)) fail("invalid_field", "repaymentReference must be unique.", { field: "repaymentReference" });
  if (tx.ws.advances.some((a) => a.invoiceRef === input.invoiceRef && a.customerRef === input.customerRef && a.state !== "declined"))
    fail("precondition_failed", "Another open advance funds the same customer invoice.", { field: "invoiceRef" });
  const id = tx.id("adv");
  tx.ws.advances.push({
    id, orgId: tx.ws.organization.id, intentId: intent.id, customerRef: input.customerRef, customerName: input.customerName,
    supplierName: input.supplierName, invoiceRef: input.invoiceRef, principalMinor: intent.amountMinor, currency: intent.sourceCurrency,
    preparedBy: tx.actorId, preparedAt: tx.at, dueDate: input.dueDate, repaymentReference: input.repaymentReference, state: "proposed",
  });
  intent.advanceId = id;
  tx.created.push(id);
  tx.log("advance.prepared", "advance", id, `Prepared for treasury: ${intent.amountMinor} ${intent.sourceCurrency} minor units`);
  const usable = computeLiquidity(tx.ws).currentUsableByCurrency[intent.sourceCurrency] ?? 0;
  if (usable < intent.amountMinor)
    openException(tx, {
      category: "funding_shortfall" as ExceptionCategory,
      explanationCode: "FD_FRESH_USABLE_BELOW_PRINCIPAL",
      explanation: `Fresh usable ${intent.sourceCurrency} liquidity (${usable} minor units) is below the advance principal (${intent.amountMinor}). Stale balances are excluded.`,
      advanceId: id,
      impact: { amountMinor: intent.amountMinor - Math.max(0, usable), currency: intent.sourceCurrency },
    });
  return "applied";
}

function decideAdvance(tx: Tx, advanceId: string, outcome: "approve" | "decline", reason: string): string {
  const adv = tx.ws.advances.find((a) => a.id === advanceId);
  if (!adv) fail("not_found", "Advance not found.", { entityId: advanceId });
  if (adv.preparedBy === tx.actorId) fail("maker_checker_violation", "Treasury approval must come from a different person than the preparer.", { entityId: adv.id });
  requireRole(tx, ["approver"]);
  if (adv.decisionId) fail("invalid_transition", "Advance already decided.", { entityId: adv.id });
  if (outcome !== "approve" && outcome !== "decline") fail("invalid_field", "outcome must be approve or decline.", { field: "outcome" });
  if (!safeNote(reason, 300)) fail("invalid_field", "A decision reason is required.", { field: "reason" });
  if (outcome === "approve" && tx.ws.exceptions.some((e) => e.advanceId === adv.id && e.category === "funding_shortfall" && e.status !== "resolved"))
    fail("precondition_failed", "An open funding_shortfall exception blocks approval.", { entityId: adv.id });
  if (outcome === "approve") {
    // m4: re-check fresh liquidity at decision time (balances may have gone stale since preparation).
    const funded = tx.ws.intents.find((i) => i.id === adv.intentId);
    const ownCommitment = funded && ["approved", "submitted", "in_transit", "on_hold", "awaiting_information"].includes(funded.status.execution) ? funded.amountMinor : 0;
    const usable = (computeLiquidity(tx.ws).currentUsableByCurrency[adv.currency] ?? 0) + ownCommitment;
    if (usable < adv.principalMinor) fail("precondition_failed", "Fresh usable liquidity no longer covers this advance; stale balances are excluded.", { entityId: adv.id });
  }
  const id = tx.id("fdec");
  tx.ws.fundingDecisions.push({ id, advanceId: adv.id, makerId: adv.preparedBy, checkerId: tx.actorId, outcome, reason, at: tx.at });
  adv.decisionId = id;
  if (outcome === "approve") {
    const ob = { id: tx.id("obl"), advanceId: adv.id, principalMinor: adv.principalMinor, currency: adv.currency, dueDate: adv.dueDate, reference: adv.repaymentReference, createdAt: tx.at };
    tx.ws.obligations.push(ob);
    adv.obligationId = ob.id;
    tx.created.push(ob.id);
  }
  tx.log("advance.decided", "advance", adv.id, `${outcome} by ${tx.actorId} (prepared by ${adv.preparedBy}): ${reason.slice(0, 60)}`);
  return "applied";
}

