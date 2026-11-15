/**
 * rc4 Clearline Connect — provider adapter framework (SANDBOX ONLY; fictional providers; no network).
 * Specification: docs/clearline/CONNECT_ADAPTERS.md. No live provider is connected; live execution
 * needs separate authorisation and review.
 */
export type {
  AdapterDescriptor,
  ClaimConfidence,
  ConnectVerification,
  DedupeRule,
  IdempotencySemantics,
  NormalizedClaim,
  OrderingRule,
  PayloadShape,
  PollingCapability,
  ProviderRawStatus,
  SettlementClaim,
  SigningKey,
  StatusMapping,
  VerificationScheme,
  VerificationSchemeId,
} from "./types";
export { COBALT_WREN, QUILLFERN, SALTGLASS, CONNECT_DESCRIPTORS, CONNECT_SCRIPTS, getDescriptor, connectKeyring, connectRoutes } from "./descriptors";
export type { ScriptEntry } from "./descriptors";
export { verifyDelivery, signDelivery, encodeHeaderBundle, decodeHeaderBundle, assertSandboxKeyring, IMPLEMENTED_SCHEMES } from "./verify";
export { parseProviderBody, toEnginePayload, rawDetail, findMapping, findOrderConflict } from "./normalize";
export type { OrderConflict, OrderConflictCode } from "./normalize";
export { providerTruth, providerScript, providerWebhook, fetchStatusSnapshot, listSince, snapshotObject, webhookBody, eventIdFor, syntheticFinalTxHash, syntheticPreliminaryTxHash } from "./simulator";
export type { TruthVersion, StatusSnapshot, FeedChange } from "./simulator";
export { providerIdempotencyKey, isValidProviderKey, simulateProviderIdempotency, retryDecision } from "./idempotency";
export type { IdempotencyRecord, IdempotencyOutcome } from "./idempotency";
export { EVIDENCE_SOURCE_CLASS, classifyEvidenceRecord, classifyStatementSource, providerEventSourceKind } from "./evidence";
export type { EvidenceSourceClass, EvidenceSourceKind } from "./evidence";
export { ConnectAdapter, toWebhookVerification } from "./adapter";
export { receiveConnectWebhook, reconcileConnect, unresolvedConnectIntents, declaredHeaders, UNRESOLVED_EXECUTION } from "./reconciler";
export type { ConnectReceipt, PollResult } from "./reconciler";
export { withConnectRoutes } from "./workspace";
