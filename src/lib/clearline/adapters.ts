/**
 * Provider adapter contract + deterministic SandboxAdapter for three FICTIONAL providers.
 * No network calls, no keys, no real payouts. Every response is generated from the inputs.
 */
import { BASE_SEPOLIA_CHAIN_ID, ALLOWLISTED_TOKENS } from "./chain";
import { convertMinor } from "./money";
import { sha256Hex } from "./sha256";
import { addMinutes } from "./tx";
import { signSandboxWebhook, sandboxWebhookSecret, verifySandboxWebhook, type WebhookVerification } from "./webhooks";
import {
  QUOTE_LABEL,
  type ChainObservationInput,
  type CurrencyCode,
  type ExceptionCategory,
  type PaymentInstruction,
  type PaymentIntent,
  type ProviderErrorClass,
  type ProviderRoute,
  type Quote,
  type RailKind,
  type Result,
  type SandboxWebhookPayload,
  type StatementLineInput,
  type Workspace,
} from "./types";

export interface ProviderCapabilities {
  providerId: string;
  providerName: string;
  rails: RailKind[];
  quotes: boolean;
  webhooks: boolean;
  polling: boolean;
  statements: boolean;
  returns: boolean;
  chainEvidence: boolean;
  sandbox: true;
  liveExecution: false;
}

export interface EligibilityResult {
  eligible: boolean;
  code: string;
  reason: string;
}

export interface SubmitAck {
  providerPaymentId: string;
  acceptedAt: string;
  payload: SandboxWebhookPayload;
}

export interface NormalizedProviderError {
  errorClass: ProviderErrorClass;
  retryable: boolean;
  message: string;
  exceptionCategory: ExceptionCategory;
}

export type ScriptStep =
  | { kind: "webhook"; payload: SandboxWebhookPayload }
  | { kind: "chain"; observation: ChainObservationInput }
  | { kind: "none"; reason: string };

export interface ProviderAdapter {
  readonly providerId: string;
  capabilities(): ProviderCapabilities;
  routes(): ProviderRoute[];
  eligibility(intent: PaymentIntent, route: ProviderRoute): EligibilityResult;
  quote(intent: PaymentIntent, route: ProviderRoute, at: string, quoteId: string): Quote;
  submit(instruction: PaymentInstruction, intent: PaymentIntent, at: string): Result<SubmitAck>;
  /** Normalised acknowledgement event for an accepted submission. */
  acknowledge(ack: SubmitAck): SandboxWebhookPayload;
  /** Deterministic next status the provider would report (polling / simulation). */
  pollStatus(ws: Workspace, intent: PaymentIntent, instruction: PaymentInstruction, at: string): ScriptStep;
  /** Sign a webhook body the way this provider would (sandbox secret is public). */
  signWebhook(rawBody: string, unixSeconds: number): string;
  verifyWebhook(rawBody: string, signatureHeader: string, nowUnixSeconds: number): WebhookVerification;
  parseWebhook(rawBody: string): Result<SandboxWebhookPayload>;
  /** Normalise a provider settlement-report row into a statement line. */
  ingestStatementRow(row: { id: string; payment_id: string; amount_minor: number; currency: CurrencyCode; value_date: string; type: "payout" | "return" }): StatementLineInput;
  normalizeError(providerCode: string): NormalizedProviderError;
  reportReturn(payload: SandboxWebhookPayload): { amountMinor?: number; reason: string; errorClass: ProviderErrorClass };
  /** The only reference this provider's statements carry that reconciliation may trust. */
  reconciliationEvidence(instruction: PaymentInstruction): { field: "provider_payment_id"; trustedReference?: string };
}

const P = {
  northline: { id: "prv_northline", name: "Northline Payments (sandbox)", prefix: "NLPO" },
  harbour: { id: "prv_harbour", name: "Harbour FX (sandbox)", prefix: "HFPO" },
  tidewater: { id: "prv_tidewater", name: "Tidewater Digital (testnet sandbox)", prefix: "TDPO" },
} as const;

export const SANDBOX_PROVIDERS: readonly { id: string; name: string }[] = Object.values(P).map(({ id, name }) => ({ id, name }));

const ROUTES: readonly ProviderRoute[] = [
  {
    id: "rt_northline_local",
    providerId: P.northline.id,
    providerName: P.northline.name,
    rail: "fiat_local",
    sourceCurrencies: ["SGD", "USD"],
    destinationCurrencies: ["PHP", "SGD", "USD"],
    destinationCountries: ["PH", "SG"],
    indicativeRates: { "SGD:PHP": "42.1738", "SGD:SGD": "1", "SGD:USD": "0.7456", "USD:PHP": "56.5620", "USD:SGD": "1.3412", "USD:USD": "1" },
    providerFees: { SGD: 1845, USD: 1390 },
    platformFeeBps: 10,
    etaLabel: "Within 2 hours (sandbox)",
    etaMinutes: 120,
    minAmountMinor: 100,
    maxAmountMinor: 25_000_000,
    prerequisites: ["Beneficiary details validated by provider sandbox"],
  },
  {
    id: "rt_harbour_correspondent",
    providerId: P.harbour.id,
    providerName: P.harbour.name,
    rail: "fiat_correspondent",
    sourceCurrencies: ["SGD", "USD", "EUR"],
    destinationCurrencies: ["USD", "SGD", "EUR", "PHP"],
    destinationCountries: ["SG", "US", "GB", "DE", "HK", "PH"],
    indicativeRates: { "SGD:USD": "0.7449", "SGD:SGD": "1", "SGD:EUR": "0.6871", "SGD:PHP": "42.1651", "USD:SGD": "1.3398", "USD:USD": "1", "USD:PHP": "56.5410", "EUR:USD": "1.0835", "EUR:EUR": "1" },
    providerFees: { SGD: 1275, USD: 950, EUR: 900 },
    platformFeeBps: 8,
    etaLabel: "Next business day (sandbox)",
    etaMinutes: 1440,
    minAmountMinor: 10_000,
    maxAmountMinor: 100_000_000,
    prerequisites: ["Purpose code", "Supporting invoice on request"],
  },
  {
    id: "rt_harbour_php_local",
    providerId: P.harbour.id,
    providerName: P.harbour.name,
    rail: "fiat_local",
    sourceCurrencies: ["SGD"],
    destinationCurrencies: ["PHP"],
    destinationCountries: ["PH"],
    indicativeRates: { "SGD:PHP": "42.1902" },
    providerFees: { SGD: 650 },
    platformFeeBps: 8,
    etaLabel: "Same day (sandbox)",
    etaMinutes: 360,
    minAmountMinor: 100,
    maxAmountMinor: 5_000_000,
    prerequisites: ["KYC tier 3"],
    restriction: "Sandbox corridor requires KYC tier 3, which this fictional organisation does not hold.",
  },
  {
    id: "rt_tidewater_base_sepolia",
    providerId: P.tidewater.id,
    providerName: P.tidewater.name,
    rail: "stablecoin_testnet",
    sourceCurrencies: ["USDC", "SGD", "USD"],
    destinationCurrencies: ["USDC"],
    destinationCountries: ["*"],
    indicativeRates: { "USDC:USDC": "1", "SGD:USDC": "0.7448", "USD:USDC": "0.9995" },
    providerFees: { USDC: 1_500_000, SGD: 792, USD: 600 },
    platformFeeBps: 5,
    etaLabel: `After ${12} testnet confirmations (sandbox)`,
    etaMinutes: 30,
    minAmountMinor: 1,
    maxAmountMinor: 100_000_000_000,
    prerequisites: ["Allowlisted Base Sepolia wallet for the beneficiary (synthetic)"],
    network: { name: "Base Sepolia", chainId: BASE_SEPOLIA_CHAIN_ID, testnet: true },
  },
];

export const sandboxRoutes = (): ProviderRoute[] => structuredClone(ROUTES) as ProviderRoute[];

const ERRORS: Record<string, NormalizedProviderError> = {
  beneficiary_account_invalid: { errorClass: "beneficiary_rejected", retryable: false, message: "Beneficiary account details rejected by the receiving bank (sandbox).", exceptionCategory: "returned_payout" },
  beneficiary_name_mismatch: { errorClass: "beneficiary_rejected", retryable: false, message: "Beneficiary name does not match the account (sandbox).", exceptionCategory: "beneficiary_mismatch" },
  compliance_review: { errorClass: "compliance_review", retryable: false, message: "Partner compliance review; documents requested (sandbox).", exceptionCategory: "compliance_hold" },
  validation_failed: { errorClass: "insufficient_information", retryable: false, message: "Instruction failed provider validation (sandbox).", exceptionCategory: "failed_submission" },
  provider_unavailable: { errorClass: "provider_unavailable", retryable: true, message: "Provider sandbox unavailable.", exceptionCategory: "provider_timeout" },
  timeout: { errorClass: "timeout", retryable: true, message: "No provider response within the expected window.", exceptionCategory: "provider_timeout" },
};

const lastSequence = (ws: Workspace, intentId: string) =>
  ws.providerEvents
    .filter((e) => e.intentId === intentId && !["rejected_signature", "duplicate_ignored", "rejected_unknown_payment"].includes(e.processingOutcome) && e.provenance !== "clearline_timer")
    .reduce((m, e) => Math.max(m, e.sequence), 0);

export class SandboxAdapter implements ProviderAdapter {
  constructor(readonly providerId: string, private readonly name: string, private readonly prefix: string) {}

  capabilities(): ProviderCapabilities {
    const rails = [...new Set(ROUTES.filter((r) => r.providerId === this.providerId).map((r) => r.rail))];
    return {
      providerId: this.providerId,
      providerName: this.name,
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
    return sandboxRoutes().filter((r) => r.providerId === this.providerId);
  }

  eligibility(intent: PaymentIntent, route: ProviderRoute): EligibilityResult {
    const pair = `${intent.sourceCurrency}:${intent.destinationCurrency}`;
    if (route.restriction) return { eligible: false, code: "ROUTE_RESTRICTED", reason: route.restriction };
    if (!route.sourceCurrencies.includes(intent.sourceCurrency)) return { eligible: false, code: "SOURCE_CURRENCY_UNSUPPORTED", reason: `${intent.sourceCurrency} is not a supported source currency on this route.` };
    if (!route.destinationCurrencies.includes(intent.destinationCurrency)) return { eligible: false, code: "DESTINATION_CURRENCY_UNSUPPORTED", reason: `${intent.destinationCurrency} payouts are not offered on this route.` };
    if (!route.destinationCountries.includes("*") && !route.destinationCountries.includes(intent.destinationCountry)) return { eligible: false, code: "COUNTRY_UNSUPPORTED", reason: `Payouts to ${intent.destinationCountry} are not offered on this route.` };
    if (!route.indicativeRates[pair]) return { eligible: false, code: "PAIR_UNSUPPORTED", reason: `No sandbox rate for ${pair}.` };
    if (intent.amountMinor < route.minAmountMinor) return { eligible: false, code: "BELOW_MINIMUM", reason: "Amount is below the route minimum." };
    if (intent.amountMinor > route.maxAmountMinor) return { eligible: false, code: "ABOVE_MAXIMUM", reason: "Amount exceeds the route maximum." };
    const fee = route.providerFees[intent.sourceCurrency];
    if (fee === undefined) return { eligible: false, code: "FEE_UNDEFINED", reason: "No sandbox fee schedule for this source currency." };
    if (intent.amountMinor <= fee + Math.floor((intent.amountMinor * route.platformFeeBps) / 10000)) return { eligible: false, code: "AMOUNT_BELOW_FEES", reason: "Amount does not cover fees." };
    return { eligible: true, code: "ELIGIBLE", reason: "Corridor, currency, country and amount are within this sandbox route's limits." };
  }

  quote(intent: PaymentIntent, route: ProviderRoute, at: string, quoteId: string): Quote {
    const e = this.eligibility(intent, route);
    const providerFeeMinor = e.eligible ? route.providerFees[intent.sourceCurrency] ?? 0 : 0;
    const platformFeeMinor = e.eligible ? Math.floor((intent.amountMinor * route.platformFeeBps) / 10000) : 0;
    const rate = e.eligible ? route.indicativeRates[`${intent.sourceCurrency}:${intent.destinationCurrency}`] : "—";
    return {
      id: quoteId,
      intentId: intent.id,
      providerId: this.providerId,
      providerName: this.name,
      routeId: route.id,
      rail: route.rail,
      sourceCurrency: intent.sourceCurrency,
      destinationCurrency: intent.destinationCurrency,
      indicativeRate: rate,
      providerFeeMinor,
      platformFeeMinor,
      estimatedRecipientMinor: e.eligible ? convertMinor(intent.amountMinor - providerFeeMinor - platformFeeMinor, intent.sourceCurrency, intent.destinationCurrency, rate) : 0,
      expiresAt: addMinutes(at, 15),
      etaLabel: route.etaLabel,
      prerequisites: route.prerequisites,
      eligible: e.eligible,
      eligibilityReason: e.reason,
      source: `${this.name} quote simulator (fixed illustrative rates)`,
      quotedAt: at,
      freshness: "fresh",
      label: QUOTE_LABEL,
    };
  }

  submit(instruction: PaymentInstruction, intent: PaymentIntent, at: string): Result<SubmitAck> {
    if (intent.sandboxOutcome === "submission_failure")
      return { ok: false, error: { code: "precondition_failed", message: ERRORS.validation_failed.message, entityId: instruction.id } };
    const providerPaymentId = `${this.prefix}-${sha256Hex(instruction.id + ":" + intent.idempotencyKey).slice(0, 10).toUpperCase()}`;
    const ack: SubmitAck = {
      providerPaymentId,
      acceptedAt: at,
      payload: { id: `${providerPaymentId}-E1`, type: "payout.accepted", provider_payment_id: providerPaymentId, sequence: 1, occurred_at: at, amount_minor: instruction.amountMinor, currency: instruction.currency },
    };
    return { ok: true, value: ack };
  }

  acknowledge(ack: SubmitAck): SandboxWebhookPayload {
    return ack.payload;
  }

  pollStatus(ws: Workspace, intent: PaymentIntent, instruction: PaymentInstruction, at: string): ScriptStep {
    const ppid = instruction.providerPaymentId;
    if (!ppid) return { kind: "none", reason: "Instruction not submitted." };
    const seq = lastSequence(ws, intent.id) + 1;
    const base = { provider_payment_id: ppid, sequence: seq, occurred_at: at, id: `${ppid}-E${seq}` };
    const exec = intent.status.execution;
    const route = ROUTES.find((r) => r.id === instruction.routeId);
    const chainRoute = route?.rail === "stablecoin_testnet";
    const quote = ws.quotes.find((q) => q.id === instruction.quoteId);
    if (exec === "submitted") return { kind: "webhook", payload: { ...base, type: "payout.in_transit" } };
    if (exec === "in_transit") {
      if (intent.sandboxOutcome === "return")
        return { kind: "webhook", payload: { ...base, type: "payout.returned", amount_minor: instruction.amountMinor, currency: instruction.currency, reason: "beneficiary_account_invalid" } };
      const hold = ws.holds.find((h) => h.intentId === intent.id);
      if (intent.sandboxOutcome === "hold" && !hold)
        return {
          kind: "webhook",
          payload: { ...base, type: "payout.on_hold", reason: "compliance_review", requested_documents: ["Supporting commercial invoice", "Proof of business relationship with beneficiary"] },
        };
      if (chainRoute) {
        const obs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
        if (!obs) return { kind: "chain", observation: this.chainObservation(intent, ppid, quote?.estimatedRecipientMinor ?? 0, 0) };
      }
      return { kind: "webhook", payload: { ...base, type: "payout.completed", amount_minor: instruction.amountMinor, currency: instruction.currency } };
    }
    if (exec === "on_hold") {
      const hold = ws.holds.find((h) => h.intentId === intent.id);
      if (hold && !hold.partnerReleaseReportedAt && hold.submittedDocuments.length > 0) return { kind: "webhook", payload: { ...base, type: "payout.hold_released" } };
      return { kind: "none", reason: hold?.partnerReleaseReportedAt ? "Partner release reported; awaiting the compliance reviewer's decision." : "Partner is waiting for the requested documents." };
    }
    if (exec === "provider_reported_completed" && chainRoute) {
      const obs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
      if (obs && obs.status !== "final") return { kind: "chain", observation: { ...this.stripObs(obs), confirmations: obs.confirmations + 6, blockNumber: obs.blockNumber } };
    }
    return { kind: "none", reason: `No further sandbox event is scheduled for execution state ${exec}.` };
  }

  private stripObs(o: ChainObservationInput): ChainObservationInput {
    const { intentId, chainId, network, tokenContract, tokenSymbol, txHash, toAddress, amountMinor, blockNumber, confirmations } = o;
    return { intentId, chainId, network, tokenContract, tokenSymbol, txHash, toAddress, amountMinor, blockNumber, confirmations };
  }

  private chainObservation(intent: PaymentIntent, ppid: string, amountMinor: number, confirmations: number): ChainObservationInput {
    const token = ALLOWLISTED_TOKENS[0];
    return {
      intentId: intent.id,
      chainId: token.chainId,
      network: token.network,
      tokenContract: token.contract,
      tokenSymbol: token.symbol,
      txHash: "0x" + sha256Hex("synthetic-tx:" + ppid),
      toAddress: "0x" + sha256Hex("synthetic-wallet:" + intent.beneficiaryRef).slice(0, 40),
      amountMinor,
      blockNumber: 18_000_000 + parseInt(sha256Hex(ppid).slice(0, 4), 16),
      confirmations,
    };
  }

  signWebhook(rawBody: string, unixSeconds: number): string {
    return signSandboxWebhook(rawBody, sandboxWebhookSecret(this.providerId), unixSeconds);
  }

  verifyWebhook(rawBody: string, signatureHeader: string, nowUnixSeconds: number): WebhookVerification {
    return verifySandboxWebhook(rawBody, signatureHeader, sandboxWebhookSecret(this.providerId), nowUnixSeconds);
  }

  parseWebhook(rawBody: string): Result<SandboxWebhookPayload> {
    let v: unknown;
    try {
      v = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: { code: "invalid_field", message: "Webhook body is not JSON.", field: "rawBody" } };
    }
    const p = v as Partial<SandboxWebhookPayload>;
    const types = ["payout.accepted", "payout.in_transit", "payout.completed", "payout.failed", "payout.returned", "payout.on_hold", "payout.information_requested", "payout.hold_released"];
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !types.includes(p.type as string) || typeof p.provider_payment_id !== "string" || !Number.isSafeInteger(p.sequence) || typeof p.occurred_at !== "string")
      return { ok: false, error: { code: "invalid_field", message: "Webhook payload is missing required fields.", field: "rawBody" } };
    if (p.amount_minor !== undefined && (!Number.isSafeInteger(p.amount_minor) || p.amount_minor <= 0))
      return { ok: false, error: { code: "invalid_amount", message: "Webhook amount_minor must be a positive integer.", field: "amount_minor" } };
    return { ok: true, value: p as SandboxWebhookPayload };
  }

  ingestStatementRow(row: { id: string; payment_id: string; amount_minor: number; currency: CurrencyCode; value_date: string; type: "payout" | "return" }): StatementLineInput {
    return {
      lineId: row.id,
      source: "provider_settlement_report",
      accountRef: `${this.providerId}:settlement`,
      direction: row.type === "payout" ? "debit" : "credit",
      kind: row.type === "payout" ? "payment" : "return",
      amountMinor: row.amount_minor,
      currency: row.currency,
      reference: row.payment_id,
      counterparty: this.name,
      valueDate: row.value_date,
    };
  }

  normalizeError(providerCode: string): NormalizedProviderError {
    return ERRORS[providerCode] ?? { errorClass: "unknown", retryable: false, message: `Unrecognised provider code (sandbox): ${providerCode}`, exceptionCategory: "failed_submission" };
  }

  reportReturn(payload: SandboxWebhookPayload) {
    const n = this.normalizeError(payload.reason ?? "unknown");
    return { amountMinor: payload.amount_minor, reason: n.message, errorClass: n.errorClass };
  }

  reconciliationEvidence(instruction: PaymentInstruction) {
    return { field: "provider_payment_id" as const, trustedReference: instruction.providerPaymentId };
  }
}

const ADAPTERS = new Map<string, SandboxAdapter>(Object.values(P).map((p) => [p.id, new SandboxAdapter(p.id, p.name, p.prefix)]));

export const getAdapter = (providerId: string): ProviderAdapter | undefined => ADAPTERS.get(providerId);
