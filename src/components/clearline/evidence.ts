/**
 * Assembles the investigation timeline from engine records for one payment. It only orders
 * and labels records the engine already produced; it computes no amount or status.
 * (Requested as an engine read model in docs/clearline/UI_REQUESTS.md, R1.)
 */
import {
  QUOTE_LABEL, formatMinor, formatMoney, timelineFor, RECONCILIATION_CODE_TEXT,
  type ProcessingOutcome, type Workspace,
} from "@/lib/clearline";

export type TLKind = "instruction" | "quote" | "approval" | "provider_ack" | "provider_event" | "statement" | "chain" | "matching" | "evidence" | "exception" | "hold" | "missing";

export type TLEntry = {
  key: string;
  at?: string;
  kind: TLKind;
  kindLabel: string;
  title: string;
  source: string;
  provenance: string;
  details: string[];
  codes: string[];
  outcome?: ProcessingOutcome;
  independent?: boolean;
  problem?: boolean;
};

const KIND_LABEL: Record<TLKind, string> = {
  instruction: "Instruction", quote: "Route and quote", approval: "Approval", provider_ack: "Provider acknowledgement",
  provider_event: "Provider event", statement: "Statement record", chain: "Chain evidence", matching: "Matching decision",
  evidence: "Evidence", exception: "Exception", hold: "Compliance hold", missing: "Missing evidence",
};

const PROBLEM_OUTCOMES: ProcessingOutcome[] = ["duplicate_ignored", "stored_late_no_regression", "contradictory_exception_raised", "rejected_signature", "rejected_unknown_payment"];

export function evidenceTimeline(ws: Workspace, intentId: string, name: (id?: string) => string, unknowns: { code: string; text: string }[]): TLEntry[] {
  const intent = ws.intents.find((i) => i.id === intentId);
  if (!intent) return [];
  const out: TLEntry[] = [];
  const push = (e: Omit<TLEntry, "kindLabel">) => out.push({ ...e, kindLabel: KIND_LABEL[e.kind] });

  push({
    key: "intent", at: intent.createdAt, kind: "instruction", title: "Payment intent created",
    source: "Clearline Connect", provenance: `User action by ${name(intent.createdBy)}`,
    details: [`Idempotency key ${intent.idempotencyKey}`, `Beneficiary ref ${intent.beneficiaryRef}`, `Requested execution ${intent.requestedExecutionDate}`],
    codes: [],
  });

  for (const q of ws.quotes.filter((x) => x.intentId === intentId)) {
    push({
      key: q.id, at: q.quotedAt, kind: "quote",
      title: `${q.providerName}: ${q.eligible ? "eligible" : "not eligible"}${q.id === intent.selectedQuoteId ? " — selected route" : ""}`,
      source: q.source, provenance: QUOTE_LABEL,
      details: [q.eligibilityReason, q.eligible ? `Indicative rate ${q.indicativeRate}; est. recipient ${formatMinor(q.estimatedRecipientMinor, q.destinationCurrency)}` : "", `Expires ${q.expiresAt} (${q.freshness})`].filter(Boolean),
      codes: [],
    });
  }

  for (const ins of ws.instructions.filter((x) => x.intentId === intentId)) {
    push({
      key: ins.id + "-made", at: ins.madeAt, kind: "approval", title: "Instruction prepared (maker)",
      source: "Clearline Connect", provenance: `Maker: ${name(ins.makerId)}`,
      details: [`Instruction ${ins.id}`, `Route ${ins.routeId}`, formatMoney({ amountMinor: ins.amountMinor, currency: ins.currency })], codes: [],
    });
    if (ins.checkedAt) push({
      key: ins.id + "-checked", at: ins.checkedAt, kind: "approval", title: `Checker decision: ${ins.status === "rejected" ? "rejected" : "approved"}`,
      source: "Clearline Connect", provenance: `Checker: ${name(ins.checkerId)}`, details: [], codes: [],
    });
    if (ins.submittedAt) push({
      key: ins.id + "-sub", at: ins.submittedAt, kind: "provider_ack", title: "Submitted; provider acknowledged",
      source: ins.providerId, provenance: "Provider API response (sandbox)",
      details: ins.providerPaymentId ? [`Provider payment id ${ins.providerPaymentId}`] : [], codes: [],
    });
  }

  for (const ev of timelineFor(ws, intentId)) {
    push({
      key: ev.id, at: ev.receivedAt, kind: ev.normalizedType.startsWith("chain.") ? "chain" : "provider_event",
      title: ev.normalizedType, source: ev.providerId, provenance: `${ev.provenance.replace(/_/g, " ")} · ${ev.confidence.replace(/_/g, " ")}`,
      details: [
        `Provider time ${ev.providerTimestamp} · sequence ${ev.sequence}`,
        `Signature ${ev.signatureResult.replace(/_/g, " ")} · payload ${ev.payloadHash.slice(0, 16)}…`,
        ev.errorClass !== "none" ? `Error class ${ev.errorClass.replace(/_/g, " ")}` : "",
        ...Object.entries(ev.detail).map(([k, v]) => `${k}: ${v}`),
      ].filter(Boolean),
      codes: [], outcome: ev.processingOutcome, problem: PROBLEM_OUTCOMES.includes(ev.processingOutcome),
    });
  }

  for (const al of ws.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === intentId)) {
    const line = ws.statementLines.find((l) => l.id === al.statementLineId);
    if (line) push({
      key: line.id, at: line.receivedAt, kind: "statement", title: `${line.source === "bank_statement" ? "Bank statement" : "Provider settlement report"} line ${line.lineId}`,
      source: line.accountRef, provenance: line.source.replace(/_/g, " "),
      details: [`${line.direction} ${line.kind} ${formatMoney({ amountMinor: line.amountMinor, currency: line.currency })}`, `Reference “${line.reference || "(none)"}” · value date ${line.valueDate}`, `Counterparty ${line.counterparty}`],
      codes: [],
    });
    push({
      key: al.id, at: al.createdAt, kind: "matching", title: `Allocated ${formatMoney({ amountMinor: al.amountMinor, currency: al.currency })} by trusted reference`,
      source: "Clearline reconciliation rules", provenance: `Statement line ${al.statementLineId}`,
      details: al.codes.map((c) => RECONCILIATION_CODE_TEXT[c] ?? c), codes: al.codes,
    });
  }

  for (const ob of ws.chainObservations.filter((c) => c.intentId === intentId)) {
    push({
      key: ob.id, at: ob.updatedAt, kind: "chain", title: `${ob.label}: ${ob.status.replace(/_/g, " ")}`,
      source: `${ob.network} (chain ${ob.chainId})`, provenance: "Synthetic chain observer",
      details: [`${ob.confirmations} of ${ob.finalityThreshold} confirmations`, `Token ${ob.tokenSymbol} ${ob.tokenContract}`, `Tx ${ob.txHash}`, `Block ${ob.blockNumber}`],
      codes: [], independent: true,
    });
  }

  for (const ev of ws.evidence.filter((e) => e.intentId === intentId)) {
    push({
      key: ev.id, at: ev.recordedAt, kind: ev.kind === "bank_statement_line" ? "statement" : ev.kind === "chain_observation" ? "chain" : "evidence",
      title: ev.description, source: ev.source, provenance: `${ev.independent ? "Independent" : "Not independent"} · recorded by ${name(ev.recordedBy)}`,
      details: [ev.kind.replace(/_/g, " "), ev.reference ? `Reference ${ev.reference}` : "", ev.documentName ? `Document ${ev.documentName} (metadata only)` : ""].filter(Boolean),
      codes: [], independent: ev.independent,
    });
  }

  const hold = ws.holds.find((h) => h.intentId === intentId);
  if (hold) {
    push({
      key: hold.id, at: hold.createdAt, kind: "hold", title: `Partner placed a compliance hold: ${hold.reason}`,
      source: hold.providerId, provenance: "Reported by partner; Clearline does not decide compliance",
      details: [`Requested: ${hold.requestedDocuments.join(", ") || "—"}`], codes: [], problem: true,
    });
    hold.decisions.forEach((d, i) => push({
      key: hold.id + "-d" + i, at: d.at, kind: "hold", title: `Reviewer decision recorded: ${d.decision.replace(/_/g, " ")}`,
      source: "Clearline (human reviewer)", provenance: `Reviewer ${name(d.reviewerId)}`, details: [d.reason], codes: [],
    }));
  }

  for (const ex of ws.exceptions.filter((e) => e.intentId === intentId)) {
    push({
      key: ex.id, at: ex.createdAt, kind: "exception", title: `Exception raised: ${ex.category.replace(/_/g, " ")}`,
      source: "Clearline rules engine", provenance: `Severity ${ex.severity} · ${ex.status.replace(/_/g, " ")}`,
      details: [ex.explanation], codes: [ex.explanationCode], problem: ex.status !== "resolved",
    });
  }

  out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  for (const u of unknowns) {
    out.push({ key: "missing-" + u.code, kind: "missing", kindLabel: KIND_LABEL.missing, title: u.text, source: "Not yet received", provenance: "Expected evidence not in the workspace", details: [], codes: [u.code], problem: true });
  }
  return out;
}
