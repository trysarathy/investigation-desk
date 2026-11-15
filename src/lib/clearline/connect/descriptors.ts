/**
 * rc4 Connect — three FICTIONAL sandbox providers, each with different semantics. None names or
 * implies a real company; status names are generic and invented. The real-world documented
 * pattern that motivated each one is cited in docs/clearline/CONNECT_ADAPTERS.md.
 *
 * - Cobalt Wren Payouts: payouts that can move BACKWARDS (delivered → bounced, delivered → clawed back),
 *   hex HMAC-SHA256 with a timestamp header, at-least-once webhooks with event ids.
 * - Quillfern Remit: AT-MOST-ONCE webhooks (polling is required), a time-inferred "presumed paid"
 *   sub-status, multi-signature header with key rotation, a versioned change feed.
 * - Saltglass Digital: stablecoin (testnet) with a PRELIMINARY hash at broadcast, internal book
 *   transfers it calls done without any on-chain transfer, and an asymmetric signature this sandbox
 *   does not implement (so its webhooks are always "unverified → poll to confirm").
 *
 * Keys are fictional `test_` strings and protect nothing.
 */
import { BASE_SEPOLIA_CHAIN_ID } from "../chain";
import type { ProviderRoute } from "../types";
import type { AdapterDescriptor, SigningKey } from "./types";
import { assertSandboxKeyring } from "./verify";

export const COBALT_WREN: AdapterDescriptor = {
  providerId: "prv_cx_cobaltwren",
  providerName: "Cobalt Wren Payouts (fictional sandbox)",
  refPrefix: "CWPO",
  motivatedBy: "Payout statuses documented to regress after a success status (paid → failed; completed → returned/reversed); hex HMAC webhook signatures; at-least-once delivery with no ordering guarantee.",
  statuses: [
    { raw: "queued", event: "payout.accepted", execution: "submitted", settlementClaim: "none", confidence: "provider_claim", rank: 10 },
    { raw: "routing", subStatus: "awaiting_bank", event: "payout.in_transit", execution: "in_transit", settlementClaim: "none", confidence: "provider_claim", rank: 20 },
    { raw: "routing", subStatus: "at_bank", event: "payout.in_transit", execution: "in_transit", settlementClaim: "none", confidence: "provider_claim", rank: 25 },
    { raw: "paused_for_review", event: "payout.on_hold", execution: "on_hold", settlementClaim: "none", confidence: "provider_claim", rank: 20, reason: "compliance_review" },
    // Partner release: recorded only; the hold ends only with the compliance reviewer's decision as well.
    { raw: "review_cleared", event: "payout.hold_released", execution: "unchanged", settlementClaim: "none", confidence: "provider_claim", rank: 20 },
    { raw: "delivered", subStatus: "handed_to_bank", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_paid", confidence: "provider_claim", rank: 50 },
    { raw: "delivered", subStatus: "bank_confirmed", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_paid", confidence: "provider_claim", rank: 52 },
    { raw: "rejected", event: "payout.failed", execution: "failed", settlementClaim: "none", confidence: "provider_claim", rank: 60, reason: "validation_failed" },
    { raw: "bounced", event: "payout.failed", execution: "failed", settlementClaim: "provider_claims_reversed", confidence: "provider_claim", rank: 60, reason: "beneficiary_account_invalid" },
    { raw: "clawed_back", event: "payout.returned", execution: "returned", settlementClaim: "provider_claims_reversed", confidence: "provider_claim", rank: 61, reason: "beneficiary_account_invalid" },
  ],
  verification: [{ id: "hex_hmac_sha256_ts", signatureHeader: "x-cobaltwren-signature", timestampHeader: "x-cobaltwren-timestamp", toleranceSeconds: 300 }],
  dedupe: { declared: "event_id", fallback: "object_version" },
  ordering: { kind: "object_version" },
  polling: { fetchStatus: true, listSince: true, webhookDelivery: "at_least_once" },
  idempotency: { header: "Idempotency-Key", format: "printable", maxLength: 200, ttlHours: 24, onRepeat: "replay_first_response", onBodyMismatch: "reject" },
  shape: { eventIdField: "id", objectField: "payout", ref: "ref", version: "version", status: "status", subStatus: "sub_status", amount: "amount_minor", currency: "currency", occurredAt: "updated_at", reason: "failure_code" },
  settlementReportClass: "provider_report",
  currencies: ["SGD", "USD"],
};

export const QUILLFERN: AdapterDescriptor = {
  providerId: "prv_cx_quillfern",
  providerName: "Quillfern Remit (fictional sandbox)",
  refPrefix: "QFRM",
  motivatedBy: "At-most-once webhook delivery by default and callbacks that stop retrying (polling required); a paid sub-state reached only because a return window elapsed; multiple signatures with a timestamp during key rotation.",
  statuses: [
    { raw: "RECEIVED", event: "payout.accepted", execution: "submitted", settlementClaim: "none", confidence: "provider_claim", rank: 10 },
    { raw: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF", event: "payout.in_transit", execution: "in_transit", settlementClaim: "none", confidence: "provider_claim", rank: 20 },
    { raw: "HALTED", event: "payout.on_hold", execution: "on_hold", settlementClaim: "none", confidence: "provider_claim", rank: 20, reason: "compliance_review" },
    { raw: "RELEASED", event: "payout.hold_released", execution: "unchanged", settlementClaim: "none", confidence: "provider_claim", rank: 20 },
    { raw: "DONE", subStatus: "BANK_ACK", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_paid", confidence: "provider_claim", rank: 50 },
    // Time-based inference: no return arrived within the window. A distinct, weaker confidence; never verified.
    { raw: "DONE", subStatus: "PRESUMED_AFTER_WINDOW", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_paid", confidence: "provider_time_inferred", rank: 55 },
    { raw: "VOIDED", event: "payout.failed", execution: "failed", settlementClaim: "none", confidence: "provider_claim", rank: 60, reason: "validation_failed" },
    { raw: "BOUNCED_BACK", event: "payout.returned", execution: "returned", settlementClaim: "provider_claims_reversed", confidence: "provider_claim", rank: 61, reason: "beneficiary_account_invalid" },
  ],
  verification: [{ id: "multi_sig_hmac_sha256_ts", signatureHeader: "x-quillfern-signatures", timestampHeader: "x-quillfern-timestamp", toleranceSeconds: 300 }],
  dedupe: { declared: "object_version", fallback: "payload_hash" },
  ordering: { kind: "object_version" },
  polling: { fetchStatus: true, listSince: true, webhookDelivery: "at_most_once" },
  idempotency: { header: "X-Request-Key", format: "uuid", maxLength: 36, ttlHours: 24, onRepeat: "reject_duplicate", onBodyMismatch: "reject" },
  shape: { ref: "payment_ref", version: "rev", status: "state", subStatus: "state_detail", addendum: "note", amount: "amount", currency: "ccy", occurredAt: "changed_at", reason: "reason_code" },
  settlementReportClass: "provider_report",
  currencies: ["SGD", "USD", "EUR"],
};

export const SALTGLASS: AdapterDescriptor = {
  providerId: "prv_cx_saltglass",
  providerName: "Saltglass Digital (fictional testnet sandbox)",
  refPrefix: "SGDT",
  motivatedBy: "A transaction hash reported at submission that may be preliminary; internal transfers shown as confirmed without on-chain activity; an asymmetric webhook signature over a timestamp.",
  statuses: [
    { raw: "intake", event: "payout.accepted", execution: "submitted", settlementClaim: "none", confidence: "provider_claim", rank: 10 },
    { raw: "broadcast_unconfirmed", event: "payout.in_transit", execution: "in_transit", settlementClaim: "provider_claims_onchain_preliminary", confidence: "provider_preliminary", rank: 30, txHash: "preliminary" },
    { raw: "onchain_final", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_onchain_final", confidence: "provider_claim", rank: 50, txHash: "final" },
    // Provider-ledger confirmation: a provider claim, NEVER chain evidence (no hash, no observation).
    { raw: "book_transfer_done", event: "payout.completed", execution: "provider_reported_completed", settlementClaim: "provider_claims_internal_ledger", confidence: "provider_ledger_claim", rank: 50 },
    { raw: "dropped", event: "payout.failed", execution: "failed", settlementClaim: "none", confidence: "provider_claim", rank: 60, reason: "provider_unavailable" },
  ],
  verification: [{ id: "asymmetric_rsa_sha256_ts", signatureHeader: "x-saltglass-signature", timestampHeader: "x-saltglass-timestamp", toleranceSeconds: 300 }],
  dedupe: { declared: "event_id", fallback: "object_status" },
  ordering: { kind: "state_rank" },
  polling: { fetchStatus: true, listSince: false, webhookDelivery: "unverifiable" },
  idempotency: { header: "Idempotency-Key", format: "printable", maxLength: 64, ttlHours: 24, onRepeat: "replay_first_response", onBodyMismatch: "reject" },
  shape: { eventIdField: "event_id", objectField: "transfer", ref: "transfer_ref", status: "phase", addendum: "memo", amount: "amount_minor", currency: "asset", occurredAt: "at", txHash: "tx_hash", reason: "error_code" },
  settlementReportClass: "provider_report",
  currencies: ["USDC"],
};

export const CONNECT_DESCRIPTORS: readonly AdapterDescriptor[] = [COBALT_WREN, QUILLFERN, SALTGLASS];

export const getDescriptor = (providerId: string): AdapterDescriptor | undefined => CONNECT_DESCRIPTORS.find((d) => d.providerId === providerId);

/**
 * Fictional signing keys. Quillfern is mid-rotation: two keys are active and it signs with both;
 * an older key is retired. Saltglass's keys are irrelevant (its scheme is not implemented here).
 */
const KEYS: Record<string, SigningKey[]> = {
  prv_cx_cobaltwren: [{ keyId: "cw_2026_a", secret: "test_whsec_cobaltwren_2026a_public_example" }],
  prv_cx_quillfern: [
    { keyId: "qf_2026_old", secret: "test_whsec_quillfern_old_public_example", activeUntil: 1_798_675_200 /* 2026-12-31Z */ },
    { keyId: "qf_2026_new", secret: "test_whsec_quillfern_new_public_example", activeFrom: 1_790_812_800 /* 2026-10-01Z */ },
  ],
  prv_cx_saltglass: [{ keyId: "sg_unused", secret: "test_whsec_saltglass_unused_public_example" }],
};
for (const k of Object.values(KEYS)) assertSandboxKeyring(k);

/** The verifier's keyring for a provider (fictional; a copy). */
export const connectKeyring = (providerId: string): SigningKey[] => (KEYS[providerId] ?? []).map((k) => ({ ...k }));

const CONNECT_ROUTES: readonly ProviderRoute[] = [
  {
    id: "rt_cx_cobaltwren_local",
    providerId: COBALT_WREN.providerId,
    providerName: COBALT_WREN.providerName,
    rail: "fiat_local",
    sourceCurrencies: ["SGD", "USD"],
    destinationCurrencies: ["PHP", "SGD", "USD"],
    destinationCountries: ["PH", "SG"],
    indicativeRates: { "SGD:PHP": "42.1500", "SGD:SGD": "1", "SGD:USD": "0.7450", "USD:PHP": "56.5000", "USD:SGD": "1.3400", "USD:USD": "1" },
    providerFees: { SGD: 1500, USD: 1100 },
    platformFeeBps: 10,
    etaLabel: "Within 3 hours (fictional sandbox)",
    etaMinutes: 180,
    minAmountMinor: 100,
    maxAmountMinor: 25_000_000,
    prerequisites: ["Fictional Connect provider: no live connection"],
  },
  {
    id: "rt_cx_quillfern_corridor",
    providerId: QUILLFERN.providerId,
    providerName: QUILLFERN.providerName,
    rail: "fiat_correspondent",
    sourceCurrencies: ["SGD", "USD", "EUR"],
    destinationCurrencies: ["USD", "SGD", "EUR", "PHP"],
    destinationCountries: ["SG", "US", "GB", "DE", "PH"],
    indicativeRates: { "SGD:USD": "0.7440", "SGD:SGD": "1", "SGD:EUR": "0.6860", "SGD:PHP": "42.1000", "USD:SGD": "1.3390", "USD:USD": "1", "USD:PHP": "56.4800", "EUR:USD": "1.0820", "EUR:EUR": "1" },
    providerFees: { SGD: 1200, USD: 900, EUR: 850 },
    platformFeeBps: 8,
    etaLabel: "Next business day (fictional sandbox)",
    etaMinutes: 1440,
    minAmountMinor: 10_000,
    maxAmountMinor: 100_000_000,
    prerequisites: ["Fictional Connect provider: no live connection"],
  },
  {
    id: "rt_cx_saltglass_base_sepolia",
    providerId: SALTGLASS.providerId,
    providerName: SALTGLASS.providerName,
    rail: "stablecoin_testnet",
    sourceCurrencies: ["USDC"],
    destinationCurrencies: ["USDC"],
    destinationCountries: ["*"],
    indicativeRates: { "USDC:USDC": "1" },
    providerFees: { USDC: 1_000_000 },
    platformFeeBps: 5,
    etaLabel: "After testnet finality (fictional sandbox)",
    etaMinutes: 30,
    minAmountMinor: 1,
    maxAmountMinor: 100_000_000_000,
    prerequisites: ["Allowlisted Base Sepolia wallet for the beneficiary (synthetic)", "Fictional Connect provider: no live connection"],
    network: { name: "Base Sepolia", chainId: BASE_SEPOLIA_CHAIN_ID, testnet: true },
  },
];

/** Routes of the fictional Connect providers. They are NOT in the sample workspace; add them with `withConnectRoutes`. */
export const connectRoutes = (): ProviderRoute[] => structuredClone(CONNECT_ROUTES) as ProviderRoute[];

/**
 * One scripted step of a fictional provider's own truth about an object: at `afterMinutes` after
 * submission the provider's object takes this raw status (version = index + 1).
 */
export interface ScriptEntry {
  afterMinutes: number;
  status: string;
  subStatus?: string;
  addendum?: string;
  txHash?: "final" | "preliminary";
}

/** Scripts by sandboxOutcome, or by intent metadata `connect_script` (which wins). */
export const CONNECT_SCRIPTS: Record<string, Record<string, readonly ScriptEntry[]>> = {
  prv_cx_cobaltwren: {
    success: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 20, status: "routing", subStatus: "at_bank" },
      { afterMinutes: 60, status: "delivered", subStatus: "handed_to_bank" },
      { afterMinutes: 120, status: "delivered", subStatus: "bank_confirmed" },
    ],
    // paid → failed: the provider said delivered, then bounced.
    return: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 60, status: "delivered", subStatus: "handed_to_bank" },
      { afterMinutes: 180, status: "bounced" },
    ],
    // completed → returned.
    clawback: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 60, status: "delivered", subStatus: "bank_confirmed" },
      { afterMinutes: 240, status: "clawed_back" },
    ],
    // A raw regression inside the same execution claim (bank_confirmed → handed_to_bank).
    regress_substatus: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 60, status: "delivered", subStatus: "bank_confirmed" },
      { afterMinutes: 90, status: "delivered", subStatus: "handed_to_bank" },
    ],
    // A raw regression across execution claims (delivered → routing).
    regress_to_routing: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 60, status: "delivered", subStatus: "handed_to_bank" },
      { afterMinutes: 90, status: "routing", subStatus: "at_bank" },
    ],
    hold: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "at_bank" },
      { afterMinutes: 30, status: "paused_for_review" },
    ],
    // Hold, partner release, then the payout resumes (at a LOWER routing rank than before the hold) and completes.
    hold_release: [
      { afterMinutes: 0, status: "queued" },
      { afterMinutes: 10, status: "routing", subStatus: "at_bank" },
      { afterMinutes: 30, status: "paused_for_review" },
      { afterMinutes: 120, status: "review_cleared" },
      { afterMinutes: 130, status: "routing", subStatus: "awaiting_bank" },
      { afterMinutes: 200, status: "delivered", subStatus: "bank_confirmed" },
    ],
  },
  prv_cx_quillfern: {
    success: [
      { afterMinutes: 0, status: "RECEIVED" },
      { afterMinutes: 15, status: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF", addendum: "Limited visibility after clearing handoff (fictional)" },
      { afterMinutes: 90, status: "DONE", subStatus: "BANK_ACK" },
      { afterMinutes: 3 * 1440, status: "DONE", subStatus: "PRESUMED_AFTER_WINDOW", addendum: "Return window elapsed with no return (time-based)" },
    ],
    presumed_only: [
      { afterMinutes: 0, status: "RECEIVED" },
      { afterMinutes: 15, status: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF" },
      { afterMinutes: 3 * 1440, status: "DONE", subStatus: "PRESUMED_AFTER_WINDOW", addendum: "Return window elapsed with no return (time-based)" },
    ],
    // completed → returned.
    return: [
      { afterMinutes: 0, status: "RECEIVED" },
      { afterMinutes: 15, status: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF" },
      { afterMinutes: 90, status: "DONE", subStatus: "BANK_ACK" },
      { afterMinutes: 1440, status: "BOUNCED_BACK" },
    ],
    hold: [
      { afterMinutes: 0, status: "RECEIVED" },
      { afterMinutes: 15, status: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF" },
      { afterMinutes: 30, status: "HALTED" },
    ],
    hold_release: [
      { afterMinutes: 0, status: "RECEIVED" },
      { afterMinutes: 15, status: "IN_FLIGHT", subStatus: "CLEARING_HANDOFF" },
      { afterMinutes: 30, status: "HALTED" },
      { afterMinutes: 120, status: "RELEASED" },
      { afterMinutes: 200, status: "DONE", subStatus: "BANK_ACK" },
    ],
  },
  prv_cx_saltglass: {
    success: [
      { afterMinutes: 0, status: "intake" },
      { afterMinutes: 5, status: "broadcast_unconfirmed", txHash: "preliminary" },
      { afterMinutes: 30, status: "onchain_final", txHash: "final" },
    ],
    internal_ledger: [
      { afterMinutes: 0, status: "intake" },
      { afterMinutes: 5, status: "book_transfer_done", addendum: "Internal book transfer (no on-chain activity)" },
    ],
    return: [
      { afterMinutes: 0, status: "intake" },
      { afterMinutes: 5, status: "broadcast_unconfirmed", txHash: "preliminary" },
      { afterMinutes: 60, status: "dropped" },
    ],
    // Two different completion claims for one payout (review L-2): an on-chain final transfer and an internal book entry.
    claims_conflict: [
      { afterMinutes: 0, status: "intake" },
      { afterMinutes: 10, status: "onchain_final", txHash: "final" },
      { afterMinutes: 20, status: "book_transfer_done" },
    ],
  },
};
