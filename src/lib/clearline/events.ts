/**
 * Provider event ingestion. Rules:
 * - Bad signature → recorded as rejected, never applied.
 * - Dedupe by (provider, provider event id): a redelivery is recorded as duplicate_ignored; a
 *   redelivery with a DIFFERENT payload raises duplicate_event.
 * - Out of order: an earlier event arriving after a later one is stored without regressing state.
 * - Contradictions (impossible transition with a newer sequence, amount differing from the
 *   instruction) raise contradictory_evidence; the state is not changed.
 * - Provider "completed" never sets settlement verified or reconciliation matched.
 * - A partner hold is never released by a provider event alone.
 * - The engine never fabricates intermediate events the provider did not send.
 */
import { getAdapter } from "./adapters";
import { tryAllocateChain } from "./chain";
import { ensureCase, openException } from "./exceptions";
import { onExecutionChanged } from "./reconciliation";
import { sha256Hex } from "./sha256";
import { EVENT_TARGET, PROGRESS_RANK, canTransitionExecution } from "./state";
import type { ComplianceHold, EventProvenance, PaymentIntent, ProviderEvent, SandboxWebhookPayload, SignatureResult } from "./types";
import { fail, toUtc, type Tx } from "./tx";

export interface IngestInput {
  providerId: string;
  rawBody: string;
  signatureResult: SignatureResult;
  provenance: EventProvenance;
}

function record(tx: Tx, e: Omit<ProviderEvent, "id" | "receivedAt">): ProviderEvent {
  const ev: ProviderEvent = { ...e, id: tx.id("pev"), receivedAt: tx.at };
  tx.ws.providerEvents.push(ev);
  return ev;
}

/** Set execution state; caller has validated the transition. */
export function setExecution(tx: Tx, intent: PaymentIntent, to: PaymentIntent["status"]["execution"], why: string) {
  const from = intent.status.execution;
  intent.status.execution = to;
  intent.updatedAt = tx.at;
  tx.log("intent.execution", "intent", intent.id, `${from} → ${to} · ${why}`);
  // Review v2 (M1/M2): re-check recorded settlement reports and evidence on every transition.
  if (from !== to) onExecutionChanged(tx, intent);
}

export function ingestPayload(tx: Tx, input: IngestInput): { outcome: ProviderEvent["processingOutcome"]; event: ProviderEvent } {
  const ws = tx.ws;
  const adapter = getAdapter(input.providerId)!;
  const parsed = adapter.parseWebhook(input.rawBody);
  const payloadHash = sha256Hex(input.rawBody);
  const p: SandboxWebhookPayload | undefined = parsed.ok ? parsed.value : undefined;
  const instr = p ? ws.instructions.find((i) => i.providerId === input.providerId && i.providerPaymentId === p.provider_payment_id) : undefined;
  const intent = instr ? ws.intents.find((i) => i.id === instr.intentId) : undefined;
  const base = {
    providerId: input.providerId,
    providerName: adapter.capabilities().providerName,
    providerEventId: p?.id ?? "unparsed",
    intentId: intent?.id,
    providerPaymentId: p?.provider_payment_id,
    payloadRef: `payload:${payloadHash.slice(0, 16)}`,
    payloadHash,
    rawBody: input.rawBody,
    providerTimestamp: p ? toUtc(p.occurred_at) : tx.at,
    sequence: p?.sequence ?? 0,
    signatureResult: input.signatureResult,
    dedupeKey: `${input.providerId}:${p?.id ?? payloadHash}`,
    normalizedType: p?.type ?? "payout.failed",
    provenance: input.provenance,
    confidence: "provider_claim" as const,
    errorClass: p?.reason ? adapter.normalizeError(p.reason).errorClass : ("none" as const),
    detail: {
      ...(p?.amount_minor !== undefined ? { amountMinor: p.amount_minor } : {}),
      ...(p?.currency ? { currency: p.currency } : {}),
      ...(p?.reason ? { reason: p.reason } : {}),
      ...(p?.tx_hash ? { txHash: p.tx_hash } : {}),
    },
  };
  if (input.signatureResult === "invalid") {
    const ev = record(tx, { ...base, processingOutcome: "rejected_signature" });
    tx.log("event.rejected_signature", "provider_event", ev.id, "Webhook signature invalid; not applied");
    return { outcome: "rejected_signature", event: ev };
  }
  // M6: a correctly signed but malformed payload is refused with a typed error (nothing recorded).
  if (!parsed.ok) fail(parsed.error.code, `Malformed provider payload: ${parsed.error.message}`, { field: parsed.error.field });
  if (!p || !intent || !instr) {
    const ev = record(tx, { ...base, processingOutcome: "rejected_unknown_payment" });
    tx.log("event.rejected_unknown", "provider_event", ev.id, "Unknown or unparseable provider payment; not applied");
    return { outcome: "rejected_unknown_payment", event: ev };
  }

  // Dedupe
  const holdEnded = intent.status.execution !== "on_hold";
  const prior = ws.providerEvents.find(
    (e) => e.dedupeKey === base.dedupeKey && e.processingOutcome !== "rejected_signature" && e.processingOutcome !== "duplicate_ignored" && !(holdEnded && e.detail.suppressedOnHold),
  );
  if (prior) {
    const ev = record(tx, { ...base, processingOutcome: "duplicate_ignored" });
    if (prior.payloadHash !== payloadHash)
      openException(tx, {
        category: "duplicate_event",
        explanationCode: "EV_SAME_ID_DIFFERENT_PAYLOAD",
        explanation: `Provider event ${p.id} was delivered again with a different payload. Neither copy was re-applied.`,
        intentId: intent.id,
        supportingEventIds: [prior.id, ev.id],
        severity: "medium",
      });
    tx.log("event.duplicate", "provider_event", ev.id, `Duplicate of ${prior.id}; ignored`);
    return { outcome: "duplicate_ignored", event: ev };
  }

  const current = intent.status.execution;
  const maxApplied = ws.providerEvents
    .filter((e) => e.intentId === intent.id && (e.processingOutcome === "applied" || e.processingOutcome === "recorded_no_state_change"))
    .reduce((m, e) => Math.max(m, e.sequence), 0);

  // Amount contradiction
  if (p.amount_minor !== undefined && (p.amount_minor !== instr.amountMinor || (p.currency && p.currency !== instr.currency))) {
    const ev = record(tx, { ...base, processingOutcome: "contradictory_exception_raised" });
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "EV_AMOUNT_DIFFERS_FROM_INSTRUCTION",
      explanation: `Provider reported ${p.amount_minor} ${p.currency ?? instr.currency} minor units for an instruction of ${instr.amountMinor} ${instr.currency}. State not changed.`,
      intentId: intent.id,
      supportingEventIds: [ev.id],
    });
    return { outcome: "contradictory_exception_raised", event: ev };
  }

  // H3: while a payout is on hold, NO signed provider event moves it. Only the partner's release
  // report is recorded; leaving the hold needs the compliance reviewer's decision path.
  // Re-review m-new-2: the suppressed event is kept (flag suppressedOnHold) and a human-handled
  // exception is raised. It is NOT applied later automatically; once the hold has ended, the
  // provider's redelivery of the same event is processed normally (it is not treated as a duplicate).
  if (intent.status.execution === "on_hold" && p.type !== "payout.hold_released") {
    const ev = record(tx, { ...base, detail: { ...base.detail, suppressedOnHold: 1 }, processingOutcome: "contradictory_exception_raised" });
    const terminal = p.type === "payout.returned" || p.type === "payout.failed";
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: terminal ? "EV_TERMINAL_EVENT_WHILE_ON_HOLD" : "EV_PROVIDER_EVENT_WHILE_ON_HOLD",
      explanation: terminal
        ? `Provider reported ${p.type} (seq ${p.sequence}) while the payout is on a partner compliance hold. It was recorded but NOT applied. The compliance reviewer must decide the hold first; after the hold ends, ask the provider to redeliver this event and it will be applied (a redelivery during the hold is ignored as a duplicate).`
        : `Provider reported ${p.type} (seq ${p.sequence}) while the payout is on a partner compliance hold with no reviewer decision. State not changed; the hold ends only through the reviewer. After the hold ends, a redelivery of this event is processed normally.`,
      intentId: intent.id,
      supportingEventIds: [ev.id],
    });
    return { outcome: "contradictory_exception_raised", event: ev };
  }

  // Partner reports hold released: recorded, never releases by itself.
  if (p.type === "payout.hold_released") {
    const hold = ws.holds.find((h) => h.intentId === intent.id && h.status !== "released" && h.status !== "rejected");
    if (!hold || current !== "on_hold") {
      const ev = record(tx, { ...base, processingOutcome: "recorded_no_state_change" });
      return { outcome: "recorded_no_state_change", event: ev };
    }
    hold.partnerReleaseReportedAt = tx.at;
    hold.updatedAt = tx.at;
    const humanRelease = hold.decisions.some((d) => d.decision === "release");
    let outcome: ProviderEvent["processingOutcome"] = "recorded_no_state_change";
    if (humanRelease) {
      hold.status = "released";
      setExecution(tx, intent, "in_transit", "Partner release reported after compliance reviewer's release decision");
      outcome = "applied";
    } else hold.status = "partner_release_reported";
    const ev = record(tx, { ...base, processingOutcome: outcome });
    tx.log("hold.partner_release_reported", "hold", hold.id, humanRelease ? "Released (human decision + partner release)" : "Awaiting compliance reviewer decision; not auto-released");
    return { outcome, event: ev };
  }

  const target = EVENT_TARGET[p.type]!;
  if (target === current) {
    const ev = record(tx, { ...base, processingOutcome: "recorded_no_state_change" });
    return { outcome: "recorded_no_state_change", event: ev };
  }
  // A redelivery, after the hold ended, of an event suppressed during the hold is evaluated on its
  // transition alone (its sequence predates the partner's release by construction).
  const redeliveredAfterHold = holdEnded && ws.providerEvents.some((e) => e.dedupeKey === base.dedupeKey && e.detail.suppressedOnHold);
  if (canTransitionExecution(current, target) && (p.sequence > maxApplied || redeliveredAfterHold)) {
    const ev = record(tx, { ...base, processingOutcome: "applied" });
    applySideEffects(tx, intent, p, ev);
    setExecution(tx, intent, target, `Provider reported ${p.type} (${adapter.capabilities().providerName})`);
    if (p.tx_hash) tryAllocateChain(tx, intent);
    return { outcome: "applied", event: ev };
  }
  if (p.sequence < maxApplied && PROGRESS_RANK[target] <= PROGRESS_RANK[current]) {
    const ev = record(tx, { ...base, processingOutcome: "stored_late_no_regression" });
    tx.log("event.late", "provider_event", ev.id, `Late ${p.type} (seq ${p.sequence} < ${maxApplied}); stored, state kept at ${current}`);
    return { outcome: "stored_late_no_regression", event: ev };
  }
  const ev = record(tx, { ...base, processingOutcome: "contradictory_exception_raised" });
  openException(tx, {
    category: "contradictory_evidence",
    explanationCode: "EV_IMPOSSIBLE_TRANSITION",
    explanation: `Provider reported ${p.type} (seq ${p.sequence}) while the payment is ${current}. Both reports are kept; state not changed.`,
    intentId: intent.id,
    supportingEventIds: [ev.id],
  });
  if (intent.status.settlement !== "none") intent.status.settlement = "contradicted";
  return { outcome: "contradictory_exception_raised", event: ev };
}

function applySideEffects(tx: Tx, intent: PaymentIntent, p: SandboxWebhookPayload, ev: ProviderEvent) {
  const ws = tx.ws;
  const adapter = getAdapter(ev.providerId)!;
  ws.evidence.push({
    id: tx.id("evd"),
    kind: "provider_status_report",
    intentId: intent.id,
    description: `Provider reported ${p.type}`,
    source: adapter.capabilities().providerName,
    independent: false,
    reference: p.id,
    recordedBy: "system",
    recordedAt: tx.at,
  });
  if (p.type === "payout.on_hold") {
    const hold: ComplianceHold = {
      id: tx.id("hold"),
      intentId: intent.id,
      providerId: ev.providerId,
      reportedBy: "partner",
      reason: adapter.normalizeError(p.reason ?? "compliance_review").message,
      requestedDocuments: [...(p.requested_documents ?? [])],
      submittedDocuments: [],
      decisions: [],
      status: "open",
      autoRelease: false,
      createdAt: tx.at,
      updatedAt: tx.at,
    };
    ws.holds.push(hold);
    const c = ensureCase(tx, { intentId: intent.id });
    for (const d of hold.requestedDocuments)
      c.requestedInfo.push({ id: tx.id("req"), at: tx.at, actorId: "partner", from: "customer compliance team", request: d, status: "open" });
    openException(tx, {
      category: "compliance_hold",
      explanationCode: "PV_PARTNER_COMPLIANCE_HOLD",
      explanation: `${adapter.capabilities().providerName} placed the payout on hold and requested: ${hold.requestedDocuments.join("; ")}.`,
      intentId: intent.id,
      supportingEventIds: [ev.id],
      impact: { amountMinor: intent.amountMinor, currency: intent.sourceCurrency },
    });
  }
  if (p.type === "payout.returned") {
    const r = adapter.reportReturn(p);
    intent.returnStatus = "provider_reported";
    intent.status.reconciliation = "exception";
    openException(tx, {
      category: "returned_payout",
      explanationCode: "PV_RETURNED_" + r.errorClass.toUpperCase(),
      explanation: `Provider reported the payout returned: ${r.reason}`,
      intentId: intent.id,
      supportingEventIds: [ev.id],
      impact: { amountMinor: intent.amountMinor, currency: intent.sourceCurrency },
    });
  }
  if (p.type === "payout.failed") {
    openException(tx, {
      category: "failed_submission",
      explanationCode: "PV_FAILED_" + ev.errorClass.toUpperCase(),
      explanation: `Provider reported the payout failed${p.reason ? ": " + adapter.normalizeError(p.reason).message : "."}`,
      intentId: intent.id,
      supportingEventIds: [ev.id],
    });
  }
  if (p.type === "payout.information_requested") {
    const c = ensureCase(tx, { intentId: intent.id });
    c.requestedInfo.push({ id: tx.id("req"), at: tx.at, actorId: "partner", from: "operations", request: p.reason ?? "Provider requested information", status: "open" });
  }
  if (p.type === "payout.completed") {
    // A provider claim only: settlement stays as evidenced; reconciliation awaits a statement.
    if (intent.status.reconciliation === "not_started") intent.status.reconciliation = "pending";
  }
}
