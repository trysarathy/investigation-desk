/**
 * rc4 Clearline Connect — the provider adapter contract (sandbox only).
 *
 * An `AdapterDescriptor` declares, as DATA, everything Clearline must know about one payment
 * provider before a single event of theirs is trusted: its raw status vocabulary and how each raw
 * status maps to (execution claim, settlement claim, confidence); its webhook verification
 * scheme(s); its dedupe-key rule; how its events are ordered; what it can be polled for; and how
 * its outbound idempotency keys behave.
 *
 * Every descriptor in this repository is FICTIONAL. No live provider is connected. See
 * docs/clearline/CONNECT_ADAPTERS.md.
 */
import type { CurrencyCode, ExecutionState, NormalizedEventType } from "../types";

/**
 * How much a provider status says. None of these is ever `verified`: settlement is verified only
 * by independent evidence (a bank statement line, or Clearline's own chain observation).
 * - provider_claim: the provider says so.
 * - provider_time_inferred: the provider infers it from elapsed time (a return window passed with
 *   no return). Weaker than a claim of an observed event.
 * - provider_ledger_claim: the provider's own internal ledger says so (an internal transfer); it is
 *   never chain evidence, whatever word the provider uses.
 * - provider_preliminary: the provider itself says the value may still change (a preliminary hash).
 */
export type ClaimConfidence = "provider_claim" | "provider_time_inferred" | "provider_ledger_claim" | "provider_preliminary";

/** What the provider claims about settlement. Recorded verbatim; it NEVER changes `settlement`. */
export type SettlementClaim =
  | "none"
  | "provider_claims_paid"
  | "provider_claims_reversed"
  | "provider_claims_onchain_preliminary"
  | "provider_claims_onchain_final"
  | "provider_claims_internal_ledger";

/**
 * The raw provider status, kept verbatim next to the normalised claim on every provider event
 * (ProviderEvent.detail: rawStatus, rawSubStatus, rawAddendum, rawRank, claimConfidence,
 * settlementClaim, objectVersion, rawTxHashPreliminary).
 */
export interface ProviderRawStatus {
  status: string;
  subStatus?: string;
  addendum?: string;
  /** The provider's own reason / failure code, verbatim. */
  reasonCode?: string;
  /** Adapter-declared progress rank of this raw status; terminal outcomes rank highest. */
  rank: number;
  claimConfidence: ClaimConfidence;
  settlementClaim: SettlementClaim;
  /** Provider object version, when the provider has one. */
  objectVersion?: number;
  /** A hash the provider itself calls preliminary. Never used as chain evidence or for allocation. */
  txHashPreliminary?: string;
}

/** One row of a descriptor's mapping table. */
export interface StatusMapping {
  /** Raw status exactly as the provider sends it. */
  raw: string;
  /** Raw sub-status; omitted = this row matches when the provider sends no sub-status. "*" = any. */
  subStatus?: string;
  /** The engine event this status claims. */
  event: Exclude<NormalizedEventType, "payout.timeout" | "chain.transfer_observed" | "chain.confirmations_updated">;
  /** The execution state the claim implies (must equal EVENT_TARGET[event]; tested). */
  execution: ExecutionState | "unchanged";
  settlementClaim: SettlementClaim;
  confidence: ClaimConfidence;
  rank: number;
  /** For failure/return/hold statuses: the engine's normalised provider code. */
  reason?: string;
  /** Stablecoin statuses: whether the status's hash is final, preliminary, or absent. */
  txHash?: "final" | "preliminary";
}

/** Webhook verification schemes this sandbox implements (plus `none` and declared-but-unimplemented ones). */
export type VerificationSchemeId =
  | "clearline_sandbox_v1"
  | "hex_hmac_sha256_ts"
  | "multi_sig_hmac_sha256_ts"
  | "none"
  /** Declared (a real provider might use it) but NOT implemented here: always "unverified". */
  | "asymmetric_rsa_sha256_ts";

export interface VerificationScheme {
  id: VerificationSchemeId;
  /** Lower-case header names this scheme reads. */
  signatureHeader?: string;
  timestampHeader?: string;
  /** Replay window: max |now − signed timestamp|, seconds. */
  toleranceSeconds: number;
}

/** One webhook signing secret. Sandbox secrets must start with `test_` and protect nothing. */
export interface SigningKey {
  keyId: string;
  secret: string;
  /** Unix seconds; the key verifies only inside [activeFrom, activeUntil]. Omitted = unbounded. */
  activeFrom?: number;
  activeUntil?: number;
}

export type DedupeRule =
  /** The provider's event id (field `eventIdField` of the envelope). */
  | { declared: "event_id"; fallback: "object_version" | "object_status" }
  /** (object reference, object version): identical for a webhook and a poll of the same version. */
  | { declared: "object_version"; fallback: "payload_hash" };

export type OrderingRule =
  /** Order by the provider's own object version (monotonic per object). */
  | { kind: "object_version" }
  /** The provider has no version: order by the adapter's raw status rank. */
  | { kind: "state_rank" };

export interface PollingCapability {
  fetchStatus: true;
  /** Change feed: every version since a cursor, in provider order. */
  listSince: boolean;
  /** Fictional webhook delivery guarantee, the reason polling is required. */
  webhookDelivery: "at_least_once" | "at_most_once" | "unverifiable";
}

export interface IdempotencySemantics {
  header: string;
  format: "printable" | "uuid";
  maxLength: number;
  ttlHours: number;
  /** What the provider does when the same key is sent again with the same body. */
  onRepeat: "replay_first_response" | "reject_duplicate";
  /** What the provider does when the same key is sent with a different body. */
  onBodyMismatch: "reject";
}

/** Where fields live in the provider's (fictional) JSON. */
export interface PayloadShape {
  /** Envelope field holding the provider event id (webhooks only). */
  eventIdField?: string;
  /** Envelope field holding the object; omitted = the body IS the object. */
  objectField?: string;
  ref: string;
  version?: string;
  status: string;
  subStatus?: string;
  addendum?: string;
  amount: string;
  currency: string;
  occurredAt: string;
  txHash?: string;
  reason?: string;
}

export interface AdapterDescriptor {
  providerId: string;
  /** Always includes "(fictional sandbox)". */
  providerName: string;
  /** Prefix of the provider's (fictional) payment reference. */
  refPrefix: string;
  /** Which real-world documented pattern motivated this fictional provider (docs only). */
  motivatedBy: string;
  statuses: readonly StatusMapping[];
  verification: readonly VerificationScheme[];
  dedupe: DedupeRule;
  ordering: OrderingRule;
  polling: PollingCapability;
  idempotency: IdempotencySemantics;
  shape: PayloadShape;
  /** A provider settlement report is a provider report. The type allows nothing else. */
  settlementReportClass: "provider_report";
  /** Settlement currencies this fictional provider pays out in. */
  currencies: readonly CurrencyCode[];
}

export type ConnectVerification =
  | { status: "verified"; scheme: VerificationSchemeId; keyId: string; timestamp: number }
  | { status: "invalid"; scheme: VerificationSchemeId; reason: "missing_signature" | "malformed_header" | "timestamp_outside_tolerance" | "signature_mismatch" | "no_active_key" }
  | { status: "unverified"; scheme: VerificationSchemeId | "unknown"; reason: "no_signature_scheme" | "unknown_scheme" | "scheme_not_implemented" };

/** A raw provider event or poll snapshot after parsing and mapping, before the engine sees it. */
export interface NormalizedClaim {
  providerId: string;
  /** Provider payment reference (= PaymentInstruction.providerPaymentId). */
  ref: string;
  dedupeKey: string;
  /** Which part of the dedupe rule produced the key. */
  dedupeKeySource: "declared" | "fallback";
  /** Engine ordering value: object version, or raw rank for state-rank providers. */
  sequence: number;
  occurredAt: string;
  amountMinor: number;
  currency: CurrencyCode;
  mapping: StatusMapping;
  raw: ProviderRawStatus;
  /** Final hash only. */
  txHash?: string;
}
