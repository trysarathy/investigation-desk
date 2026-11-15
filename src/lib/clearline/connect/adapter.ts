/**
 * rc4 Connect — the engine-facing adapter for a FICTIONAL Connect provider. It turns an
 * `AdapterDescriptor` into the engine's `ProviderAdapter`, so Connect events enter through the same
 * `ingestPayload` path as every other provider event (webhook, API response or poll).
 *
 * Quotes, eligibility, settlement-report rows and error normalisation are delegated to the
 * original sandbox implementation (passed in, so this module has no runtime import of adapters.ts).
 */
import type { EligibilityResult, NormalizedProviderError, ProviderAdapter, ProviderCapabilities, ScriptStep, SubmitAck } from "../adapters";
import { expectedBeneficiaryWallet } from "../chain";
import { sha256Hex } from "../sha256";
import type { CurrencyCode, PaymentInstruction, PaymentIntent, ProviderErrorClass, ProviderRoute, Quote, Result, SandboxWebhookPayload, StatementLineInput, Workspace } from "../types";
import type { WebhookVerification } from "../webhooks";
import { connectKeyring, connectRoutes } from "./descriptors";
import { parseProviderBody, toEnginePayload } from "./normalize";
import { fetchStatusSnapshot, providerTruth, snapshotObject, type StatusSnapshot } from "./simulator";
import type { AdapterDescriptor, ConnectVerification } from "./types";
import { decodeHeaderBundle, encodeHeaderBundle, IMPLEMENTED_SCHEMES, signDelivery, verifyDelivery } from "./verify";

/** Maps a Connect verification onto the engine's WebhookVerification. Only `verified` is valid. */
export function toWebhookVerification(v: ConnectVerification): WebhookVerification {
  if (v.status === "verified") return { valid: true, timestamp: v.timestamp };
  if (v.status === "unverified") return { valid: false, reason: "unverified_scheme" };
  return { valid: false, reason: v.reason === "timestamp_outside_tolerance" ? "timestamp_outside_tolerance" : v.reason === "signature_mismatch" || v.reason === "no_active_key" ? "signature_mismatch" : "malformed_header" };
}

export class ConnectAdapter implements ProviderAdapter {
  readonly providerId: string;
  constructor(readonly descriptor: AdapterDescriptor, private readonly base: ProviderAdapter) {
    this.providerId = descriptor.providerId;
  }

  capabilities(): ProviderCapabilities {
    const rails = [...new Set(this.routes().map((r) => r.rail))];
    return {
      providerId: this.providerId,
      providerName: this.descriptor.providerName,
      rails,
      quotes: true,
      webhooks: true,
      polling: true,
      statements: true,
      returns: true,
      chainEvidence: rails.includes("stablecoin_testnet"),
      sandbox: true,
      liveExecution: false,
    };
  }

  routes(): ProviderRoute[] {
    return connectRoutes().filter((r) => r.providerId === this.providerId);
  }

  eligibility(intent: PaymentIntent, route: ProviderRoute): EligibilityResult {
    return this.base.eligibility(intent, route);
  }

  quote(intent: PaymentIntent, route: ProviderRoute, at: string, quoteId: string): Quote {
    return { ...this.base.quote(intent, route, at, quoteId), source: `${this.descriptor.providerName} quote simulator (fixed illustrative rates)` };
  }

  submit(instruction: PaymentInstruction, intent: PaymentIntent, at: string): Result<SubmitAck> {
    if (intent.sandboxOutcome === "submission_failure")
      return { ok: false, error: { code: "precondition_failed", message: this.base.normalizeError("validation_failed").message, entityId: instruction.id } };
    const providerPaymentId = `${this.descriptor.refPrefix}-${sha256Hex(instruction.id + ":" + intent.idempotencyKey).slice(0, 10).toUpperCase()}`;
    const submitted: PaymentInstruction = { ...instruction, providerPaymentId, submittedAt: at };
    const v1 = providerTruth(this.descriptor, intent, submitted)[0];
    // The synchronous API response IS version 1 of the provider object (same bytes a later poll returns).
    const payload = snapshotObject(this.descriptor, intent, submitted, v1 ?? { version: 1, at, entry: { afterMinutes: 0, status: this.descriptor.statuses[0].raw } });
    return { ok: true, value: { providerPaymentId, acceptedAt: at, payload } };
  }

  acknowledge(ack: SubmitAck): SubmitAck["payload"] {
    return ack.payload;
  }

  expectedWallet(intent: PaymentIntent): string {
    return expectedBeneficiaryWallet(intent);
  }

  /** Connect providers are not driven by `simulate_provider_event`; use their webhooks or `poll_provider`. */
  pollStatus(): ScriptStep {
    return { kind: "none", reason: `${this.descriptor.providerName}: deliver the provider's webhook or poll it (poll_provider).` };
  }

  fetchStatus(_ws: Workspace, intent: PaymentIntent, instruction: PaymentInstruction, at: string, version?: number): StatusSnapshot {
    return fetchStatusSnapshot(this.descriptor, intent, instruction, at, version);
  }

  /** Signs as the fictional provider would; returns the Connect header bundle. */
  signWebhook(rawBody: string, unixSeconds: number): string {
    return encodeHeaderBundle(signDelivery(this.descriptor.verification[0], rawBody, connectKeyring(this.providerId), unixSeconds));
  }

  verifyConnect(rawBody: string, headers: Record<string, string>, nowUnixSeconds: number): ConnectVerification {
    return verifyDelivery(this.descriptor.verification, rawBody, headers, connectKeyring(this.providerId), nowUnixSeconds);
  }

  verifyWebhook(rawBody: string, signatureHeader: string, nowUnixSeconds: number): WebhookVerification {
    const headers = decodeHeaderBundle(signatureHeader);
    if (!headers) {
      const implemented = this.descriptor.verification.some((s) => IMPLEMENTED_SCHEMES.includes(s.id));
      return implemented ? { valid: false, reason: "malformed_header" } : { valid: false, reason: "unverified_scheme" };
    }
    return toWebhookVerification(this.verifyConnect(rawBody, headers, nowUnixSeconds));
  }

  parseWebhook(rawBody: string): Result<SandboxWebhookPayload> {
    const c = parseProviderBody(this.descriptor, rawBody);
    return c.ok ? { ok: true, value: toEnginePayload(c.value) } : c;
  }

  /** A provider settlement report row is ALWAYS a provider report (never a bank statement line). */
  ingestStatementRow(row: { id: string; payment_id: string; amount_minor: number; currency: CurrencyCode; value_date: string; type: "payout" | "return" }): StatementLineInput {
    return { ...this.base.ingestStatementRow(row), source: "provider_settlement_report" };
  }

  normalizeError(providerCode: string): NormalizedProviderError {
    return this.base.normalizeError(providerCode);
  }

  reportReturn(payload: SandboxWebhookPayload): { amountMinor?: number; reason: string; errorClass: ProviderErrorClass } {
    return this.base.reportReturn(payload);
  }

  reconciliationEvidence(instruction: PaymentInstruction) {
    return { field: "provider_payment_id" as const, trustedReference: instruction.providerPaymentId };
  }
}
