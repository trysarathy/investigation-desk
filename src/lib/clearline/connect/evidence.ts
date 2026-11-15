/**
 * rc4 Connect — evidence source classification (P2).
 *
 * - independent: a bank statement line, or Clearline's OWN chain observation. Only these can verify settlement.
 * - provider_report: a provider-authored settlement report. It stays a provider report however
 *   official it looks (it gives settlement `observed / provider_report`, never `verified`).
 * - provider_claim: a provider status event, including a provider-ledger "done/confirmed" for an
 *   internal transfer and a preliminary hash. Never chain evidence.
 * - supporting: metadata a person attached (document names, notes). Context, not settlement evidence.
 */
import type { EvidenceRecord, ProviderEvent, StatementSource } from "../types";

export type EvidenceSourceClass = "independent" | "provider_report" | "provider_claim" | "supporting";

export type EvidenceSourceKind =
  | "bank_statement"
  | "clearline_chain_observation"
  | "provider_settlement_report"
  | "provider_status_event"
  | "provider_ledger_confirmation"
  | "provider_preliminary_hash";

/** The classification table (data, reviewed with the descriptors). */
export const EVIDENCE_SOURCE_CLASS: Readonly<Record<EvidenceSourceKind, { class: EvidenceSourceClass; chainEvidence: boolean; canVerifySettlement: boolean }>> = {
  bank_statement: { class: "independent", chainEvidence: false, canVerifySettlement: true },
  clearline_chain_observation: { class: "independent", chainEvidence: true, canVerifySettlement: true },
  provider_settlement_report: { class: "provider_report", chainEvidence: false, canVerifySettlement: false },
  provider_status_event: { class: "provider_claim", chainEvidence: false, canVerifySettlement: false },
  provider_ledger_confirmation: { class: "provider_claim", chainEvidence: false, canVerifySettlement: false },
  provider_preliminary_hash: { class: "provider_claim", chainEvidence: false, canVerifySettlement: false },
};

export const classifyStatementSource = (s: StatementSource): "independent" | "provider_report" => (s === "bank_statement" ? "independent" : "provider_report");

/** Classifies a stored evidence record. Person-attached records are always `supporting`. */
export function classifyEvidenceRecord(r: EvidenceRecord): EvidenceSourceClass {
  if (r.recordedBy !== "system") return "supporting";
  switch (r.kind) {
    case "bank_statement_line":
    case "chain_observation":
      return "independent";
    case "provider_settlement_report":
      return "provider_report";
    case "provider_status_report":
      return "provider_claim";
    default:
      return "supporting";
  }
}

/** Classifies a provider event's source kind from its raw-status detail. Always a provider claim. */
export function providerEventSourceKind(e: ProviderEvent): EvidenceSourceKind {
  if (e.detail.claimConfidence === "provider_ledger_claim") return "provider_ledger_confirmation";
  if (typeof e.detail.rawTxHashPreliminary === "string") return "provider_preliminary_hash";
  return "provider_status_event";
}
