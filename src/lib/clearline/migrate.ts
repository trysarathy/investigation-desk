/**
 * Load-time migration to rc3 (review M-1, re-review R-M1 / R-m1, second re-review R2-M1).
 *
 * A workspace saved by an earlier engine version (v2 = cf8732e, or efabe6a) can hold states that rc3 can never
 * produce, because rc3 changed the evidence rules. On every load (parseWorkspace / loadWorkspace and every
 * applyAction) the stored EVIDENCE is re-validated against rc3's rules, and only the states rc3 cannot produce
 * are corrected. Each correction:
 * - never upgrades evidence (settlement may only stay or move down: verified → pending → observed → none, or to
 *   contradicted);
 * - raises the exception rc3's rule raises for the same facts (with an owner: the case owner, else the payment's
 *   creator), unless it already exists (open or resolved);
 * - is recorded as a `workspace.migrated` audit event and returned as a WorkspaceMigration with plain text;
 * - is idempotent (a migrated workspace matches no rule), and nothing changes on a workspace rc3 produced
 *   (property-tested over many rc3 action sequences).
 *
 * Rules (each is a state no rc3 action sequence can reach):
 * A. A counted chain observation whose (chain id, network, token contract, symbol) is not on the allowlist
 *    (v2 C-1 revival). → status rejected_unsupported; CH_UNSUPPORTED_TOKEN_OR_NETWORK ensured; settlement recomputed.
 * B. A counted chain observation whose transaction hash was recorded EARLIER as rejected or with another identity,
 *    not superseded by a person (v2 M-3). → the CH_TX_HASH_CONFLICT / CH_TX_HASH_ON_OTHER_CHAIN exception rc3 raises;
 *    settlement contradicted until a person resolves it.
 * C. A failed, cancelled, expired or returned payout whose settlement still shows bank or chain evidence as
 *    observed, pending finality or verified (v2 T-1 incl. before finality, T-2, pre-CHANGE 6 returned). → rc3's
 *    terminal rule: contradicted with its rule exception, or none if a person resolved exactly that exception.
 * D. Reconciliation "matched" on a chain allocation whose observation is no longer final, without a full bank
 *    match (v2 C-3 reorg). → reconciliation exception.
 * E. (QA rc3 L1) A settlement or reconciliation above what the recorded evidence can support (derive.ts
 *    evidenceCeiling), e.g. a crafted "verified / matched" with only a pending-finality transfer. → capped to rc3's
 *    own derive (recomputeDimensions), never upgraded; no exception is raised (the evidence itself is unchanged).
 * Not detectable from stored data: a v2 C-2 block change that was applied silently (the earlier block is not kept).
 */
import { tokenAllowed } from "./chain";
import { evidenceCeiling, recomputeDimensions } from "./derive";
import { EXCEPTION_DUE_DAYS, EXCEPTION_REQUIRED_ACTION } from "./exceptions";
import { addDays, orgDate } from "./tx";
import type { ChainObservation, ExceptionCategory, PaymentIntent, ReconciliationException, Severity, StatusDimensions, Workspace, WorkspaceMigration } from "./types";

const TERMINAL = ["failed", "cancelled", "expired", "returned"];
const EVIDENCED = ["observed", "pending_finality", "verified"];
const RANK: Record<string, number> = { none: 0, observed: 1, pending_finality: 2, verified: 3 };
const seqOf = (id: string) => Number(/_(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

export function migrateToRc3(ws: Workspace): WorkspaceMigration[] {
  const out: WorkspaceMigration[] = [];
  const asOf = ws.asOf;
  const nextId = (prefix: string) => {
    ws.seq += 1;
    return `${prefix}_${String(ws.seq).padStart(5, "0")}`;
  };
  const counted = (o: ChainObservation) => o.status !== "rejected_unsupported";

  /** The exception rc3 would have opened, created with an owner and linked to the payout's case. */
  function raise(intent: PaymentIntent, spec: { category: ExceptionCategory; code: string; explanation: string; severity: Severity; statementLineId?: string; supportingEventIds?: string[]; supportingEvidenceIds?: string[] }) {
    let c = ws.cases.find((x) => x.id === intent.caseId);
    const owner = [c?.ownerId, intent.createdBy].find((a) => typeof a === "string" && ws.actors.some((x) => x.id === a && x.role !== "viewer"));
    if (!c) {
      c = { id: nextId("case"), intentId: intent.id, ...(intent.advanceId ? { advanceId: intent.advanceId } : {}), title: `Payment ${intent.internalReference} · ${intent.beneficiaryName}`, status: "open", notes: [], requestedInfo: [], evidenceIds: [], exceptionIds: [], history: [{ at: asOf, actorId: "system", action: "opened", detail: "Case opened by the rc3 workspace migration" }], createdAt: asOf, updatedAt: asOf };
      ws.cases.push(c);
      intent.caseId = c.id;
    }
    const excId = nextId("exc");
    const exc: ReconciliationException = {
      id: excId, category: spec.category, severity: spec.severity, status: owner ? "in_review" : "open", explanationCode: spec.code, explanation: spec.explanation, intentId: intent.id,
      ...(spec.statementLineId ? { statementLineId: spec.statementLineId } : {}), caseId: c.id, candidates: [],
      supportingEventIds: [...(spec.supportingEventIds ?? [])], supportingEvidenceIds: [...(spec.supportingEvidenceIds ?? [])],
      ...(owner ? { ownerId: owner } : {}),
      dueDate: addDays(orgDate(asOf, ws.organization.timezone), EXCEPTION_DUE_DAYS[spec.severity]),
      requiredAction: EXCEPTION_REQUIRED_ACTION[spec.category], createdAt: asOf, lastUpdatedAt: asOf,
      history: [
        { at: asOf, actorId: "system", action: "opened", detail: `${spec.code}: ${spec.explanation}` },
        ...(owner ? [{ at: asOf, actorId: "system", action: "owner_assigned", detail: `Owner: ${ws.actors.find((x) => x.id === owner)!.name} (${c.ownerId === owner ? "case owner" : "created the payment"})` }] : []),
      ],
    };
    ws.exceptions.push(exc);
    c.exceptionIds.push(excId);
    if (c.status === "resolved") {
      c.status = "reopened";
      c.history.push({ at: asOf, actorId: "system", action: "reopened", detail: `New exception ${excId} (${spec.category}) linked by the rc3 migration` });
    }
    c.updatedAt = asOf;
    return { excId, owner, caseId: c.id };
  }

  /** Settlement from rc3's own derive, never higher than before (contradicted is always allowed: it is a downgrade). */
  function recomputeSettlement(intent: PaymentIntent) {
    const probe = structuredClone(intent);
    recomputeDimensions(ws, probe);
    const before = intent.status.settlement;
    const next = probe.status.settlement;
    const allowed = next === "contradicted" || (before !== "contradicted" && (RANK[next] ?? 0) <= (RANK[before] ?? 0));
    if (allowed) {
      intent.status.settlement = next;
      intent.status.settlementScope = probe.status.settlementScope;
    } else if (before !== "contradicted" && probe.status.settlementScope !== "none") {
      // Never an upgrade: the level stays where it was; the scope names the evidence that now carries it.
      intent.status.settlementScope = probe.status.settlementScope;
    }
  }

  function record(intent: PaymentIntent, from: StatusDimensions, m: Omit<WorkspaceMigration, "intentId" | "internalReference" | "from" | "to" | "auditId">) {
    const to = { ...intent.status };
    const auditId = nextId("aud");
    ws.audit.push({ id: auditId, at: asOf, actorId: "system", action: "workspace.migrated", entityType: "intent", entityId: intent.id, summary: `rc3 migration (${m.kind}): ${from.execution} / ${from.settlement} (${from.settlementScope}) / ${from.reconciliation} → ${to.settlement}${m.exceptionCode && m.outcome === "contradiction_raised" ? ` with ${m.exceptionCode}` : ""} (${to.settlementScope}) / ${to.reconciliation}; ${m.outcome}${m.exceptionId ? `, ${m.exceptionId}` : ""}. ${m.text}` });
    out.push({ ...m, intentId: intent.id, internalReference: intent.internalReference, from, to, auditId });
  }

  // A. Counted observations that rc3 would never count (not allowlisted).
  for (const o of ws.chainObservations) {
    if (!counted(o) || tokenAllowed(o)) continue;
    const intent = ws.intents.find((i) => i.id === o.intentId);
    if (!intent) continue;
    const from = { ...intent.status };
    o.status = "rejected_unsupported";
    const has = ws.exceptions.some((e) => e.intentId === intent.id && e.explanationCode === "CH_UNSUPPORTED_TOKEN_OR_NETWORK" && e.supportingEventIds.includes(o.id));
    const raised = has ? undefined : raise(intent, { category: "unsupported_token_or_network", code: "CH_UNSUPPORTED_TOKEN_OR_NETWORK", severity: "high", supportingEventIds: [o.id], explanation: `Transfer on chain ${o.chainId} (${o.network}) with token ${o.tokenSymbol} at ${o.tokenContract} is not on the allowlist; it is not counted.` });
    recomputeSettlement(intent);
    const ref = `${intent.internalReference} (${intent.id})`;
    record(intent, from, {
      kind: "chain_observation_not_allowlisted", outcome: "observation_not_counted", observationId: o.id,
      ...(raised ? { exceptionId: raised.excId, exceptionCode: "CH_UNSUPPORTED_TOKEN_OR_NETWORK", ...(raised.owner ? { ownerId: raised.owner } : {}), caseId: raised.caseId } : {}),
      text: `Payment ${ref}: an earlier version counted a transfer on chain ${o.chainId} (${o.network}, ${o.tokenSymbol}) that is not on the allowlist. It is no longer counted; settlement ${from.settlement} → ${intent.status.settlement}.`,
    });
  }

  // B. A counted observation whose hash was recorded earlier as rejected or with another identity.
  for (const o of ws.chainObservations) {
    if (!counted(o)) continue;
    const earlier = ws.chainObservations.find((r) => r.id !== o.id && r.txHash === o.txHash && !r.supersededBy && seqOf(r.id) < seqOf(o.id) &&
      (r.status === "rejected_unsupported" || r.chainId !== o.chainId || r.network !== o.network || r.tokenContract.toLowerCase() !== o.tokenContract.toLowerCase() || r.tokenSymbol !== o.tokenSymbol));
    if (!earlier) continue;
    const intent = ws.intents.find((i) => i.id === o.intentId);
    if (!intent) continue;
    const otherChain = earlier.chainId !== o.chainId || earlier.network !== o.network;
    const code = otherChain ? "CH_TX_HASH_ON_OTHER_CHAIN" : "CH_TX_HASH_CONFLICT";
    if (ws.exceptions.some((e) => e.intentId === intent.id && (e.explanationCode === "CH_TX_HASH_ON_OTHER_CHAIN" || e.explanationCode === "CH_TX_HASH_CONFLICT") && e.supportingEventIds.includes(earlier.id))) continue;
    const from = { ...intent.status };
    const raised = raise(intent, { category: "contradictory_evidence", code, severity: "critical", supportingEventIds: [earlier.id, o.id], explanation: `Transaction ${o.txHash.slice(0, 12)}… was already recorded as ${earlier.tokenSymbol} on chain ${earlier.chainId} (${earlier.network})${earlier.status === "rejected_unsupported" ? ", not counted" : ""} before observation ${o.id}; an earlier engine version counted it anyway. rc3 does not count it until a person resolves this conflict.` });
    recomputeSettlement(intent);
    record(intent, from, {
      kind: "chain_hash_conflict", outcome: "contradiction_raised", observationId: o.id, exceptionId: raised.excId, exceptionCode: code, ...(raised.owner ? { ownerId: raised.owner } : {}), caseId: raised.caseId,
      text: `Payment ${intent.internalReference} (${intent.id}): its transaction hash had already been recorded with another identity, so rc3 does not count the transfer. Settlement ${from.settlement} → ${intent.status.settlement}, with a new exception ${raised.excId} (${code})${raised.owner ? ` for ${raised.owner}` : ""} to review.`,
    });
  }

  // C. Terminal payouts still showing bank or chain evidence as success or progress.
  for (const intent of ws.intents) {
    const st = intent.status;
    const exec = st.execution;
    if (!TERMINAL.includes(exec) || !EVIDENCED.includes(st.settlement) || (st.settlementScope !== "bank_statement" && st.settlementScope !== "onchain_transfer")) continue;
    const id = intent.id;
    const bankAllocs = ws.allocations.filter((a) => a.evidenceKind === "statement_line" && a.target.kind === "payment" && a.target.intentId === id && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"));
    const obs = ws.chainObservations.filter((o) => o.intentId === id && counted(o));
    if (!bankAllocs.length && !obs.length) continue; // never engine-produced: crossCheck refuses verified, others are left
    const from = { ...st };
    const chain = st.settlementScope === "onchain_transfer" || (!bankAllocs.length && obs.length > 0);
    const ruleCode = chain ? "CH_TRANSFER_FOR_TERMINAL_PAYOUT" : exec === "failed" ? "RC_DEBIT_FOR_FAILED_PAYOUT" : "RC_DEBIT_FOR_TERMINAL_PAYOUT";
    const lineIds = new Set(bankAllocs.map((a) => a.statementLineId));
    const obsIds = new Set(obs.map((o) => o.id));
    const mine = ws.exceptions.filter((e) => e.intentId === id);
    // The rc3 rule's own exception about THIS evidence (same code and same line / observations).
    const isRuleException = (e: ReconciliationException) =>
      (exec === "returned" && e.category === "returned_payout") ||
      (e.category === "contradictory_evidence" && (chain
        ? e.explanationCode === "CH_TRANSFER_FOR_TERMINAL_PAYOUT" && e.supportingEventIds.some((x) => obsIds.has(x))
        : (e.explanationCode === ruleCode || (exec === "returned" && e.explanationCode === "RC_DEBIT_FOR_TERMINAL_PAYOUT")) && (typeof e.statementLineId !== "string" || lineIds.has(e.statementLineId))));
    const rule = mine.filter(isRuleException);
    const otherOpen = mine.some((e) => e.status !== "resolved" && (e.category === "contradictory_evidence" || (exec === "returned" && e.category === "returned_payout")));
    let outcome: WorkspaceMigration["outcome"];
    let excId: string | undefined;
    let owner: string | undefined;
    let caseId = intent.caseId;
    if (!rule.length) {
      const r = raise(intent, {
        category: "contradictory_evidence", code: ruleCode, severity: "critical",
        ...(chain ? {} : { statementLineId: bankAllocs[0].statementLineId }),
        supportingEventIds: obs.map((o) => o.id),
        supportingEvidenceIds: ws.evidence.filter((e) => e.intentId === id && (e.kind === "bank_statement_line" || e.kind === "chain_observation")).map((e) => e.id),
        explanation: `${chain ? "An on-chain transfer to the beneficiary's registered wallet was observed" : "A statement debit matches this payout"}, but the provider reports the payout ${exec}. An earlier engine version stored this as ${from.settlement}; rc3 records the disagreement (workspace migration).`,
      });
      excId = r.excId; owner = r.owner; caseId = r.caseId;
      st.settlement = "contradicted";
      if (bankAllocs.length || ws.allocations.some((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === id)) st.reconciliation = "exception";
      outcome = "contradiction_raised";
    } else if (otherOpen || rule.some((e) => e.status !== "resolved")) {
      st.settlement = "contradicted";
      excId = (rule.find((e) => e.status !== "resolved") ?? mine.find((e) => e.status !== "resolved" && (e.category === "contradictory_evidence" || e.category === "returned_payout")))?.id;
      outcome = "contradicted_open";
    } else {
      st.settlement = "none";
      st.settlementScope = "none";
      excId = rule[rule.length - 1].id;
      outcome = "resolved_by_person";
    }
    const ref = `${intent.internalReference} (${id})`;
    const was = `was saved by an earlier version as ${exec} with settlement ${from.settlement === "pending_finality" ? "pending finality" : from.settlement}`;
    const text =
      outcome === "contradiction_raised"
        ? `Payment ${ref} ${was}. It now shows settlement contradicted, with a new exception ${excId} (${ruleCode})${owner ? ` for ${owner}` : ""} to review.`
        : outcome === "contradicted_open"
          ? `Payment ${ref} ${was}. It now shows settlement contradicted, because exception ${excId} is still open.`
          : `Payment ${ref} ${was}. A person had already resolved ${excId}, so it now shows no settlement evidence (the evidence stays on record).`;
    record(intent, from, { kind: from.settlement === "verified" ? "terminal_payout_verified" : "terminal_payout_evidence", outcome, ...(excId ? { exceptionId: excId } : {}), ...(outcome === "contradiction_raised" ? { exceptionCode: ruleCode } : {}), ...(owner ? { ownerId: owner } : {}), ...(caseId ? { caseId } : {}), text });
  }

  // D. Reconciliation matched on a chain allocation whose observation is no longer final.
  for (const intent of ws.intents) {
    if (intent.status.reconciliation !== "matched") continue;
    const chainAllocs = ws.allocations.filter((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === intent.id);
    if (!chainAllocs.length) continue;
    if (chainAllocs.some((a) => ws.chainObservations.find((o) => o.id === a.statementLineId)?.status === "final")) continue;
    const bank = ws.allocations.filter((a) => a.evidenceKind === "statement_line" && a.target.kind === "payment" && a.target.intentId === intent.id && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).reduce((t, a) => t + a.amountMinor, 0);
    if (bank >= intent.amountMinor) continue;
    const from = { ...intent.status };
    intent.status.reconciliation = "exception";
    record(intent, from, {
      kind: "reorg_reconciliation", outcome: "reconciliation_reopened", observationId: chainAllocs[0].statementLineId,
      text: `Payment ${intent.internalReference} (${intent.id}): the on-chain transfer it was matched to is no longer final (reorganisation), so it is no longer shown as matched. Reconciliation matched → exception.`,
    });
  }

  // E. (QA rc3 L1) A stored settlement or reconciliation above what the recorded evidence can support (a crafted or
  // corrupted workspace; no engine version sets a status without its evidence). → capped to rc3's own derive,
  // never upgraded. A terminal payout stored as verified is left to the integrity check, which refuses it.
  for (const intent of ws.intents) {
    const st = intent.status;
    const ceiling = evidenceCeiling(ws, intent);
    const sExceeds = st.settlement !== "contradicted" && (RANK[st.settlement] ?? 0) > RANK[ceiling.settlement] && !(TERMINAL.includes(st.execution) && st.settlement === "verified");
    const rExceeds = (st.reconciliation === "matched" && !ceiling.matched) || (st.reconciliation === "partially_matched" && !ceiling.partiallyMatched);
    if (!sExceeds && !rExceeds) continue;
    const from = { ...st };
    const probe = structuredClone(intent);
    recomputeDimensions(ws, probe);
    if (sExceeds) {
      const derived = probe.status.settlement;
      if (derived === "contradicted" || (RANK[derived] ?? 0) <= RANK[ceiling.settlement]) {
        st.settlement = derived;
        st.settlementScope = probe.status.settlementScope;
      } else {
        st.settlement = ceiling.settlement;
        if (ceiling.settlement === "none") st.settlementScope = "none";
      }
    }
    if (rExceeds) {
      const derived = probe.status.reconciliation;
      const ok = (derived !== "matched" || ceiling.matched) && (derived !== "partially_matched" || ceiling.partiallyMatched);
      st.reconciliation = ok ? derived : ws.instructions.find((i) => i.id === intent.instructionId)?.providerPaymentId ? "pending" : "not_started";
    }
    const lvl = (x: string) => (x === "pending_finality" ? "pending finality" : x === "partially_matched" ? "partially matched" : x.replace("_", " "));
    record(intent, from, {
      kind: "status_exceeds_evidence", outcome: "status_capped",
      text: `Payment ${intent.internalReference} (${intent.id}) was stored with settlement ${lvl(from.settlement)} and reconciliation ${lvl(from.reconciliation)}, more than its recorded evidence supports. It now shows settlement ${lvl(st.settlement)} and reconciliation ${lvl(st.reconciliation)}, as rc3 derives them from the evidence (never upgraded).`,
    });
  }
  return out;
}
