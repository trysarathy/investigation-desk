/**
 * Clearline unified sandbox engine — PUBLIC API. See docs/clearline/ENGINE_API.md.
 *
 * Import from "@/lib/clearline" (this file). Internal module paths may change; these
 * names and signatures are kept stable (changes are announced at the top of ENGINE_API.md).
 *
 * SANDBOX ONLY: fictional organisations and providers; no money movement, custody, keys,
 * lending or compliance decisions. The legacy prototype in ./core.ts remains for the
 * existing console and is not part of this API.
 */
export * from "./types";

// Money
export { CURRENCIES, currencyDecimals, isCurrency, parseAmount, formatMoney, formatMinor, formatMinorPlain, convertMinor } from "./money";

// Workspace lifecycle
export { sampleWorkspace, emptyWorkspace, SAMPLE_AS_OF, SAMPLE_ACTORS, SAMPLE_SCENARIOS, scenarioIntentId, intentForScenario } from "./sample";
export type { SampleScenario } from "./sample";
export { serializeWorkspace, parseWorkspace, parseWorkspaceValue, MAX_WORKSPACE_DEPTH } from "./serialize";
// rc3: per-scenario reset of the five guided cases
export { resetScenario, canResetScenario } from "./scenarios";
export type { ResetCheck, ResetBlockCode, ResetScenarioOutput } from "./scenarios";

// Validation helpers
export { isIsoInstant, isIsoDate } from "./tx";

// Actions (pure: (workspace, action, ctx) => Result<{ workspace, audit, outcome, createdIds }>)
export { applyAction } from "./actions";

// State model
export { EXECUTION_TRANSITIONS, canTransitionExecution, isTerminalExecution } from "./state";

// Provider adapters
export type { ProviderAdapter, ProviderCapabilities, EligibilityResult, SubmitAck, NormalizedProviderError } from "./adapters";
export { SandboxAdapter, SANDBOX_PROVIDERS, sandboxRoutes, getAdapter } from "./adapters";

// Webhooks (test-mode signing; the example secrets are public and protect nothing)
export { signSandboxWebhook, verifySandboxWebhook, sandboxWebhookSecret, WEBHOOK_TOLERANCE_SECONDS } from "./webhooks";

// Reconciliation, exceptions, liquidity, chain, funding
export { RECONCILIATION_CODE_TEXT, RECONCILIATION_CODE_GROUP, RECONCILIATION_WINDOW_DAYS } from "./reconciliation";
export type { ReconciliationCodeGroup } from "./reconciliation";
export { canResolveException, canResolveCase, EXCEPTION_REQUIRED_ACTION, EXCEPTION_DUE_DAYS } from "./exceptions";
export type { ResolutionCheck } from "./exceptions";
export { computeLiquidity } from "./liquidity";
export { BASE_SEPOLIA_CHAIN_ID, ALLOWLISTED_TOKENS, FINALITY_THRESHOLD, CHAIN_LABEL } from "./chain";
export { fundingProjection, obligationOutstanding, FUNDING_PROJECTION_LABEL } from "./funding";

// Read models
export { investigate, evidenceTimelineFor, exportCaseReport, timelineFor, listExceptions, getIntent, ENGINE_DISCLAIMER } from "./investigation";

// Human-readable labels (CHANGE 5)
export { HUMAN_LABELS, CODE_LABELS, describeCode, explainCode, isKnownCode, describeStatus, describeError } from "./labels";
export type { HumanError, StatusDescription } from "./labels";
export { TERMINAL_FOR_SETTLEMENT_REPORT } from "./reconciliation";
