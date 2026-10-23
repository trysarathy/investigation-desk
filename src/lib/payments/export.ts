// Reconciled export (CSV) and the per-exception evidence pack (as a document model; pdf.ts draws
// it). Every payment and review ID goes through resolvePaymentRef, the resolver behind
// /api/payments/resolve, so an ID that has since merged or moved into a review is shown with
// where it leads now, never as a dead end.

import { csvValue as cell } from "../csv/cell";
import { CHAIN_NAMES } from "../types";
import type { AuditEntry } from "./audit";
import { recordsOf, sourceText } from "./exceptions";
import { STATUS_LABELS, type InboxData, type InboxItem } from "./inbox";
import { describe, describeRedirect, resolvePaymentRef } from "./match";
import type { PaymentsData } from "./store";
import type { BankRecord, CanonicalPayment, ChainTransferRecord, InstructionRecord, LedgerEntryRecord, LegName, MatchResult, PaymentRecord, ProviderRecord } from "./types";

const LEGS: LegName[] = ["instruction", "chain", "provider", "bank", "ledger"];

export const EXPORT_COLUMNS = [
  "payment_id", "requested_id", "resolution", "reconciliation", "open_items", "instruction_id", "provider", "provider_payment_id",
  "provider_status", "provider_status_meaning", "chain", "tx_hash", "transfer_index", "ledger_entry_id", "ledger_status", "bank_reference",
  "asset", "amount_instruction", "amount_provider", "amount_chain", "amount_ledger", "amount_bank",
  "leg_instruction", "leg_chain", "leg_provider", "leg_bank", "leg_ledger", "duplicate_records", "decisions",
];

/** Inbox items about a payment, by whatever payment ID they were recorded under. */
function itemsFor(result: MatchResult, inbox: InboxData, paymentId: string): InboxItem[] {
  return Object.values(inbox.items).filter((i) => i.subject.kind === "payment" &&
    (resolvePaymentRef(result, i.subject.paymentId).payment?.paymentId ?? i.subject.paymentId) === paymentId);
}

function linked<T extends PaymentRecord>(p: CanonicalPayment, leg: LegName, recs: Map<string, PaymentRecord>): T | undefined {
  const l = p.legs[leg];
  return l.state === "linked" ? recs.get(l.links[0].recordId) as T | undefined : undefined;
}

export function reconciledCsv(data: PaymentsData, inbox: InboxData): string {
  const result = data.match?.result;
  if (!result) return EXPORT_COLUMNS.join(",") + "\n";
  const recs = recordsOf(data);
  const row = (p: CanonicalPayment, requested: string, resolution: string) => {
    const ins = linked<InstructionRecord>(p, "instruction", recs) ?? (recs.get(p.anchor.recordId)?.kind === "instruction" ? recs.get(p.anchor.recordId) as InstructionRecord : undefined);
    const providers = p.timeline.map((t) => recs.get(t.recordId)).filter((r): r is ProviderRecord => r?.kind === "provider" && r.type === "principal");
    const prov = providers.at(-1) ?? (recs.get(p.anchor.recordId)?.kind === "provider" ? recs.get(p.anchor.recordId) as ProviderRecord : undefined);
    const t = linked<ChainTransferRecord>(p, "chain", recs);
    const led = p.timeline.map((x) => recs.get(x.recordId)).filter((r): r is LedgerEntryRecord => r?.kind === "ledger" && !r.reverses).at(-1);
    const bank = linked<BankRecord>(p, "bank", recs);
    const open = itemsFor(result, inbox, p.paymentId).filter((i) => i.status !== "closed");
    const inReview = LEGS.some((l) => p.legs[l].state === "needs_review");
    const allLinked = LEGS.every((l) => p.legs[l].state === "linked" || p.legs[l].state === "not_applicable");
    const reconciliation = inReview ? "in review" : open.length ? "exceptions open" : allLinked ? "reconciled" : "incomplete";
    return [
      p.paymentId, requested, resolution, reconciliation, open.map((i) => i.itemId).join(" "),
      ins?.instructionId, prov?.provider, prov?.providerPaymentId, prov?.statusRaw, prov?.statusMeaning,
      t ? CHAIN_NAMES[t.chain] : ins?.chain ? CHAIN_NAMES[ins.chain] : undefined, t?.txHash ?? ins?.txHash ?? prov?.txHash,
      t?.transferIndex, led?.entryId, led?.status, bank?.bankReference,
      ins?.token ?? prov?.currency ?? t?.token, ins?.amount, prov?.amount, t?.amount, led?.amount, bank?.amount,
      ...LEGS.map((l) => p.legs[l].state.replace("_", " ")),
      p.duplicateRecords.length, p.decisions.map((d) => `${d.decisionId} ${d.action} by ${d.by}`).join("; "),
    ].map(cell).join(",");
  };
  const lines = result.payments.map((p) => {
    const r = resolvePaymentRef(result, p.paymentId);
    return row(r.payment!, p.paymentId, "current");
  });
  // Retired IDs: one row each, showing where they lead now (or that their records were cleared).
  for (const redirect of Object.values(result.redirects ?? {})) {
    const r = resolvePaymentRef(result, redirect.from);
    const how = r.via.map(describeRedirect).join("; ");
    if (r.payment) lines.push(row(r.payment, redirect.from, how));
    else lines.push([undefined, redirect.from, how, "not held", ...Array(EXPORT_COLUMNS.length - 4).fill(undefined)].map(cell).join(","));
  }
  return [EXPORT_COLUMNS.join(","), ...lines].join("\n") + "\n";
}

// ---- Evidence pack ----

export interface PackSection {
  heading: string;
  rows?: [string, string][];
  lines?: string[];
}

export interface EvidencePack {
  title: string;
  subtitle: string;
  generatedAt: string;
  sections: PackSection[];
}

export function evidencePack(itemId: string, data: PaymentsData, inbox: InboxData, audit: AuditEntry[], now: Date): EvidencePack | undefined {
  const item = inbox.items[itemId];
  if (!item) return undefined;
  const result = data.match?.result;
  const recs = recordsOf(data);
  const sections: PackSection[] = [];

  // Resolve the subject first: the pack is about the payment as it is now.
  let payment: CanonicalPayment | undefined;
  const summary: [string, string][] = [
    ["Item", item.itemId], ["Kind", item.kind === "review" ? "Matching review" : item.family === "deposit" ? "Deposit investigation" : "Payment exception"],
    ["Code", item.code], ["Status", STATUS_LABELS[item.status]], ["Owner", item.owner ?? "unassigned"], ["Follow up", item.followUp ?? "none"],
    ["Confidence", item.confidence ?? "n/a"], ["First seen", item.firstSeen], ["Last seen", item.lastSeen], ["Still current", item.current ? "yes" : "no"],
  ];
  if (item.subject.kind === "payment" && result) {
    const r = resolvePaymentRef(result, item.subject.paymentId);
    payment = r.payment;
    summary.push(["Payment (as recorded)", item.subject.paymentId]);
    summary.push(["Payment (now)", payment ? `${payment.paymentId}${r.via.length ? ` · ${r.via.map(describeRedirect).join("; ")}` : ""}` : `not held${r.via.length ? ` · ${r.via.map(describeRedirect).join("; ")}` : ""}`]);
  } else if (item.subject.kind === "record") {
    const rec = recs.get(item.subject.recordId);
    summary.push(["Record", rec ? describe(rec) : item.subject.recordId]);
  } else if (item.subject.kind === "case") {
    summary.push(["Case", `${item.subject.caseId} (${item.subject.href})`]);
  }
  if (item.sample) summary.push(["Data", "Sample case (prototype data, not company data)"]);
  sections.push({ heading: "Summary", rows: summary });
  sections.push({ heading: "What it is", lines: [item.title] });
  sections.push({ heading: "Next step", lines: [item.nextStep] });
  sections.push({ heading: "Evidence", rows: item.evidence.map((e) => [e.label, `${e.value}${e.source ? `  [source: ${e.source}]` : ""}`]) });

  if (payment) {
    sections.push({ heading: `Payment ${payment.paymentId}: legs`, rows: LEGS.map((l) => {
      const leg = payment!.legs[l];
      const detail = leg.state === "linked" ? leg.links.map((x) => x.detail).join(" ")
        : leg.state === "needs_review" ? `review ${resolveReview(result!, leg.reviewId)}`
        : leg.state === "missing" ? leg.note ?? "no record" : leg.state === "unknown" ? leg.note : "no records of this kind imported";
      return [l, `${leg.state.replace("_", " ")} · ${detail}`];
    }) });
    sections.push({ heading: "Timeline (event time by each source; observed = when read)", lines: payment.timeline.map((t) => {
      const r = recs.get(t.recordId);
      return `${t.eventTime ?? "no event time"} · observed ${t.observedTime} · ${t.label}${r ? ` · source: ${r.sources.map(sourceText).join("; ")}` : ""}`;
    }) });
    sections.push({ heading: "Original identifiers (as each source wrote them)", rows: payment.identifiers.map((i) => [`${i.kind} ${i.role}`, `${i.value} (${i.sourceField})`]) });
    const raw = payment.timeline.map((t) => recs.get(t.recordId)).flatMap((r) => r?.sources ?? []).filter((s) => s.kind === "chain");
    if (raw.length) sections.push({ heading: "Chain responses (SHA-256 of the raw bodies kept)", lines: raw.map((s) => s.kind === "chain" ? `${s.url} · fetched ${s.fetchedAt} · ${s.rawSha256.join(", ")}` : "") });
    if (payment.decisions.length) {
      sections.push({ heading: "Review decisions", lines: payment.decisions.map((d) => `${d.decisionId} · ${d.at} · ${d.by} ${d.action === "confirm" ? "confirmed" : "rejected"} ${d.recordId} for the ${d.leg} leg (review ${resolveReview(result!, d.reviewId)}): ${d.why}`) });
    }
  }
  if (item.notes.length) sections.push({ heading: "Notes", lines: item.notes.map((n) => `${n.at} · ${n.by}: ${n.text}`) });
  sections.push({ heading: "History", lines: item.history.map((h) => `${h.at} · ${h.by} · ${h.action}${h.from || h.to ? ` (${h.from ?? "—"} → ${h.to ?? "—"})` : ""}${h.why ? `: ${h.why}` : ""}`) });
  const related = audit.filter((e) => e.subject === item.itemId || (payment && payment.decisions.some((d) => d.reviewId === e.subject)));
  sections.push({ heading: "Audit log entries", lines: related.length ? related.map((e) => `#${e.seq} ${e.at} · ${e.actor}${e.ip ? ` (${e.ip})` : ""} · ${e.action}: ${e.detail}`) : ["none"] });

  return {
    title: `Evidence pack · ${item.itemId}`,
    subtitle: item.title,
    generatedAt: now.toISOString(),
    sections,
  };
}

/** A review ID as it reads now: itself, or where it moved. */
function resolveReview(result: MatchResult, reviewId: string): string {
  const r = resolvePaymentRef(result, reviewId);
  if (r.review?.reviewId === reviewId) return reviewId;
  return r.review ? `${reviewId} (now ${r.review.reviewId})` : r.payment ? `${reviewId} (resolved; payment ${r.payment.paymentId})` : `${reviewId} (closed)`;
}
