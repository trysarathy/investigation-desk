// View models for the payments screens. Pure; the server renders them.

import { CHAIN_NAMES } from "../types";
import type { EvidenceStatus } from "../types";
import { describe } from "./match";
import type { PaymentsData } from "./store";
import type { CanonicalPayment, Leg, LegName, PaymentRecord, ProviderRecord, SourceRef } from "./types";

export const LEG_ORDER: LegName[] = ["instruction", "chain", "provider", "bank", "ledger"];
export const LEG_LABELS: Record<LegName, string> = {
  instruction: "Instruction", chain: "On-chain", provider: "Provider", bank: "Bank", ledger: "Ledger",
};

export function legStatus(l: Leg): { status: EvidenceStatus; label: string } {
  switch (l.state) {
    case "linked": return { status: "pass", label: "Linked" };
    case "needs_review": return { status: "warn", label: "Needs review" };
    case "missing": return { status: "warn", label: l.suggestions.length ? `Missing · ${l.suggestions.length} to check` : "Missing" };
    case "unknown": return { status: "info", label: "Unknown" };
    case "not_applicable": return { status: "info", label: "No records" };
  }
}

export function recordIndex(data: PaymentsData): Map<string, PaymentRecord> {
  return new Map([...data.records.instruction, ...data.records.provider, ...data.records.bank, ...data.chain.transfers].map((r) => [r.recordId, r]));
}

export interface PaymentRow {
  paymentId: string;
  title: string;
  amount?: string;
  asset?: string;
  chain?: string;
  providerStatus?: { raw: string; meaning: ProviderRecord["statusMeaning"]; provider: string };
  legs: { leg: LegName; status: EvidenceStatus; label: string }[];
  reviews: number;
  duplicates: number;
}

export function paymentRow(p: CanonicalPayment, recs: Map<string, PaymentRecord>, reviews: number): PaymentRow {
  const anchor = recs.get(p.anchor.recordId);
  const providers = p.timeline.filter((t) => t.kind === "provider").map((t) => recs.get(t.recordId) as ProviderRecord)
    .filter((r) => r && r.type === "principal");
  const current = providers[providers.length - 1];
  const title = anchor?.kind === "instruction" ? anchor.instructionId
    : anchor?.kind === "provider" ? `${anchor.provider} ${anchor.providerPaymentId}` : p.paymentId;
  const chainRec = p.timeline.map((t) => recs.get(t.recordId)).find((r) => r?.kind === "chain_transfer");
  return {
    paymentId: p.paymentId, title,
    amount: anchor && "amount" in anchor ? anchor.amount : undefined,
    asset: anchor?.kind === "instruction" ? anchor.token : anchor?.kind === "provider" ? anchor.currency : undefined,
    chain: chainRec?.kind === "chain_transfer" ? CHAIN_NAMES[chainRec.chain] : anchor?.kind === "instruction" && anchor.chain ? CHAIN_NAMES[anchor.chain] : undefined,
    providerStatus: current ? { raw: current.statusRaw, meaning: current.statusMeaning, provider: current.provider } : undefined,
    legs: LEG_ORDER.map((leg) => ({ leg, ...legStatus(p.legs[leg]) })),
    reviews, duplicates: p.duplicateRecords.length,
  };
}

export const MEANING_LABELS: Record<ProviderRecord["statusMeaning"], string> = {
  pending: "Pending", awaiting_approval: "Awaiting approval", processing: "Processing", on_hold: "On hold",
  provider_reports_complete: "Provider reports complete (not proof of credit)",
  cancelled: "Cancelled", expired: "Expired", underpaid: "Underpaid", overpaid: "Overpaid", returned: "Returned",
  unmapped: "Not in mapping",
};

export function sourceLabel(s: SourceRef): { text: string; href?: string } {
  switch (s.kind) {
    case "file": return { text: `${s.fileName} line ${s.line} · ${s.mappingId} v${s.mappingVersion}` };
    case "chain": return { text: "Explorer", href: s.url };
    case "deposit_ledger": return { text: `File B line ${s.line}` };
  }
}

export { describe };
