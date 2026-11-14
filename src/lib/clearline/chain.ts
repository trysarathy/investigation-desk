/**
 * Synthetic Base Sepolia chain evidence (crypto-protocol rules).
 * - Observation is not finality: a transfer is "observed" at 0 confirmations, "pending finality"
 *   below the threshold and "final" at or above it.
 * - Only allowlisted (chainId, contract, symbol, decimals) identities count. Anything else raises
 *   unsupported_token_or_network and is never counted.
 * - A chain transfer never proves a supplier's bank credit.
 * - The token contract below is a SYNTHETIC sandbox identity. It is deliberately NOT an issuer's
 *   official address (official addresses must come from the issuer's own page with a recorded
 *   on-chain symbol()/decimals() check — not from memory).
 */
import { openException } from "./exceptions";
import { MAX_AMOUNT_MINOR } from "./money";
import { sha256Hex } from "./sha256";
import type { AllowlistedToken, ChainObservation, ChainObservationInput, PaymentIntent } from "./types";
import { fail, type Tx } from "./tx";

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
/** Sandbox policy value, not a protocol constant. */
export const FINALITY_THRESHOLD = 12;
export const CHAIN_LABEL =
  "Synthetic Base Sepolia testnet data (chain id 84532). Not real on-chain evidence. A chain transfer never proves a supplier bank credit." as const;

export const ALLOWLISTED_TOKENS: readonly AllowlistedToken[] = [
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    network: "base-sepolia",
    symbol: "USDC",
    decimals: 6,
    contract: "0x5a4d00000000000000000000000000000000c1ea",
    label: "Synthetic sandbox USDC identity on Base Sepolia — not the issuer's official contract",
  },
];

const isHex = (v: string, len: number) => new RegExp(`^0x[0-9a-f]{${len}}$`).test(v);

export function validateChainInput(o: ChainObservationInput): string | null {
  if (!o || typeof o !== "object") return "observation must be an object.";
  if (typeof o.intentId !== "string" || !o.intentId) return "intentId must be a string.";
  if (typeof o.chainId !== "number" || !Number.isSafeInteger(o.chainId) || o.chainId <= 0) return "chainId must be a positive integer.";
  if (typeof o.network !== "string" || !/^[a-z0-9-]{1,40}$/.test(o.network)) return "network must be a short lowercase string.";
  if (typeof o.tokenContract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(o.tokenContract)) return "tokenContract must be 0x + 40 hex characters.";
  if (typeof o.tokenSymbol !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(o.tokenSymbol)) return "tokenSymbol must be a short alphanumeric string.";
  if (typeof o.txHash !== "string" || !isHex(o.txHash, 64)) return "txHash must be 0x + 64 lowercase hex characters.";
  if (typeof o.toAddress !== "string" || !isHex(o.toAddress, 40)) return "toAddress must be 0x + 40 lowercase hex characters.";
  if (typeof o.amountMinor !== "number" || !Number.isSafeInteger(o.amountMinor) || o.amountMinor <= 0 || o.amountMinor > MAX_AMOUNT_MINOR) return `amountMinor must be a positive integer up to ${MAX_AMOUNT_MINOR} (token minor units, 6 decimals).`;
  if (typeof o.blockNumber !== "number" || !Number.isSafeInteger(o.blockNumber) || o.blockNumber < 0) return "blockNumber must be a non-negative integer.";
  if (typeof o.confirmations !== "number" || !Number.isSafeInteger(o.confirmations) || o.confirmations < 0) return "confirmations must be a non-negative integer.";
  return null;
}

export const tokenAllowed = (o: Pick<ChainObservationInput, "chainId" | "network" | "tokenContract" | "tokenSymbol">) =>
  ALLOWLISTED_TOKENS.find(
    (t) => t.chainId === o.chainId && t.network === o.network && t.contract === o.tokenContract.toLowerCase() && t.symbol === o.tokenSymbol,
  );

const statusFor = (confirmations: number): ChainObservation["status"] =>
  confirmations === 0 ? "observed" : confirmations < FINALITY_THRESHOLD ? "pending_finality" : "final";

/** Expected on-chain amount for an intent: the selected quote's estimated recipient amount. */
export function expectedChainAmount(tx: Tx, intentId: string): number | undefined {
  const intent = tx.ws.intents.find((i) => i.id === intentId);
  const quote = tx.ws.quotes.find((q) => q.id === intent?.selectedQuoteId);
  return quote && quote.destinationCurrency === "USDC" ? quote.estimatedRecipientMinor : undefined;
}

/** Execution states in which chain evidence for a submitted stablecoin payout is meaningful. */
export const CHAIN_ELIGIBLE_STATES = ["submitted", "in_transit", "provider_reported_completed"] as const;

/** Sandbox wallet registry: the beneficiary's expected (synthetic) Base Sepolia address. */
export function expectedBeneficiaryWallet(intent: PaymentIntent): string {
  const override = intent.metadata?.beneficiary_wallet;
  if (typeof override === "string" && /^0x[0-9a-f]{40}$/.test(override)) return override;
  return "0x" + sha256Hex("synthetic-wallet:" + intent.beneficiaryRef).slice(0, 40);
}

/**
 * Preconditions (B1): only a submitted stablecoin payout on the testnet route can receive chain
 * evidence. Anything else is a typed error and changes nothing.
 */
export function assertChainApplicable(tx: Tx, intent: PaymentIntent): void {
  const instr = tx.ws.instructions.find((i) => i.id === intent.instructionId);
  const route = tx.ws.routes.find((r) => r.id === instr?.routeId);
  if (!instr || !route || route.rail !== "stablecoin_testnet" || intent.destinationCurrency !== "USDC")
    fail("precondition_failed", "Chain evidence applies only to a USDC payout on the Base Sepolia testnet route; this payout is not one.", { entityId: intent.id });
  if (!instr.providerPaymentId || !(CHAIN_ELIGIBLE_STATES as readonly string[]).includes(intent.status.execution))
    fail("precondition_failed", `Chain evidence is accepted only after submission and before a terminal state (now ${intent.status.execution}).`, { entityId: intent.id });
}

function noteOnContradictions(tx: Tx, intentId: string, detail: string) {
  for (const e of tx.ws.exceptions.filter((x) => x.intentId === intentId && x.category === "contradictory_evidence" && x.status !== "resolved")) {
    e.history.push({ at: tx.at, actorId: tx.actorId, action: "evidence_received", detail });
    e.lastUpdatedAt = tx.at;
  }
}

/**
 * Allocate a final chain observation to its payout only when the provider itself reported the same
 * transaction hash (the trusted reference) and wallet and amount already matched. Otherwise
 * reconciliation stays as it is.
 */
export function tryAllocateChain(tx: Tx, intent: PaymentIntent): void {
  const ws = tx.ws;
  const obs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
  if (!obs || obs.status !== "final" || intent.status.settlement !== "verified") return;
  const prior = ws.allocations.find((a) => a.evidenceKind === "chain_observation" && (a.statementLineId === obs.id || (a.target.kind === "payment" && a.target.intentId === intent.id)));
  if (prior) {
    // rc3 (C-3): the same observation final again (after a person resolved a reorg contradiction) restores the match.
    if (prior.statementLineId === obs.id && prior.target.kind === "payment" && prior.target.intentId === intent.id && intent.status.reconciliation !== "exception") intent.status.reconciliation = "matched";
    return;
  }
  const reported = ws.providerEvents.filter((e) => e.intentId === intent.id && typeof e.detail.txHash === "string" && (e.processingOutcome === "applied" || e.processingOutcome === "recorded_no_state_change"));
  if (!reported.length) return;
  if (reported.some((e) => e.detail.txHash !== obs.txHash)) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_TX_DIFFERS_FROM_PROVIDER",
      explanation: `The provider reported transaction ${String(reported[0].detail.txHash).slice(0, 12)}… but the observed transfer is ${obs.txHash.slice(0, 12)}….`,
      intentId: intent.id,
      supportingEventIds: [obs.id, ...reported.map((e) => e.id)],
    });
    return;
  }
  const a = { id: tx.id("alc"), statementLineId: obs.id, evidenceKind: "chain_observation" as const, target: { kind: "payment" as const, intentId: intent.id }, amountMinor: obs.amountMinor, currency: "USDC" as const, matchedBy: "trusted_reference" as const, codes: ["RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW" as const], createdAt: tx.at };
  ws.allocations.push(a);
  if (intent.status.reconciliation !== "exception") intent.status.reconciliation = "matched";
  tx.log("reconciliation.allocated", "chain_observation", obs.id, `Final synthetic transfer allocated to ${intent.id} by provider-reported tx hash`);
}

/** Ingest/refresh a synthetic chain observation. Returns the processing outcome. */
export function ingestChainObservation(tx: Tx, input: ChainObservationInput): string {
  const ws = tx.ws;
  const intent = ws.intents.find((i) => i.id === input.intentId);
  if (!intent) fail("not_found", "Intent not found.", { entityId: input.intentId });
  assertChainApplicable(tx, intent);
  const token = tokenAllowed(input);
  const txHash = input.txHash.toLowerCase();
  if (!token) {
    const obs: ChainObservation = { ...input, txHash, id: tx.id("chn"), observedAt: tx.at, updatedAt: tx.at, finalityThreshold: FINALITY_THRESHOLD, status: "rejected_unsupported", label: "Synthetic Base Sepolia testnet observation" };
    ws.chainObservations.push(obs);
    openException(tx, {
      category: "unsupported_token_or_network",
      explanationCode: "CH_UNSUPPORTED_TOKEN_OR_NETWORK",
      explanation: `Transfer on chain ${input.chainId} (${input.network}) with token ${input.tokenSymbol} at ${input.tokenContract} is not on the allowlist; it is not counted.`,
      intentId: intent.id,
      supportingEventIds: [obs.id],
    });
    tx.log("chain.rejected_unsupported", "chain_observation", obs.id, "Unsupported token or network; not counted");
    return "exception_raised";
  }
  // rc3 (C-1) + review M-3: the same transaction hash already recorded with a DIFFERENT identity — another
  // chain or network, another token contract or symbol, or rejected as unsupported (on any chain, for any
  // payout) — is never counted: a hash judged unsupported or seen elsewhere cannot later evidence a payout.
  // The earlier record is never overwritten or "revived" by this one. Review m-3: a record a person has
  // superseded (by resolving the conflict exception, see actions.ts resolve) no longer blocks.
  const sameIdentity = (o: ChainObservation) =>
    o.chainId === input.chainId && o.network === input.network && o.tokenContract.toLowerCase() === input.tokenContract.toLowerCase() && o.tokenSymbol === input.tokenSymbol;
  const conflict = ws.chainObservations.find((o) => o.txHash === txHash && !o.supersededBy && (o.status === "rejected_unsupported" || !sameIdentity(o)));
  if (conflict) {
    const otherChain = conflict.chainId !== input.chainId || conflict.network !== input.network;
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: otherChain ? "CH_TX_HASH_ON_OTHER_CHAIN" : "CH_TX_HASH_CONFLICT",
      explanation: otherChain
        ? `Transaction ${txHash.slice(0, 12)}… was already observed on chain ${conflict.chainId} (${conflict.network}); the same hash on chain ${input.chainId} (${input.network}) is not counted.`
        : `Transaction ${txHash.slice(0, 12)}… was already recorded on this chain as ${conflict.tokenSymbol} at ${conflict.tokenContract}${conflict.status === "rejected_unsupported" ? " (not counted: unsupported token)" : ""}; the same hash reported as ${input.tokenSymbol} is not counted.`,
      intentId: intent.id,
      supportingEventIds: [conflict.id],
    });
    tx.log(otherChain ? "chain.hash_on_other_chain" : "chain.hash_conflict", "chain_observation", conflict.id, "Same tx hash recorded with another identity; not counted");
    return "contradictory_exception_raised";
  }
  // B2: one transaction can evidence at most one payout.
  const linkedElsewhere = ws.chainObservations.find((o) => o.txHash === txHash && o.intentId !== intent.id && o.status !== "rejected_unsupported");
  if (linkedElsewhere) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_TX_ALREADY_LINKED",
      explanation: `Transaction ${txHash.slice(0, 12)}… is already linked to ${linkedElsewhere.intentId}; it cannot also evidence ${intent.id}. Neither payout was changed.`,
      intentId: intent.id,
      candidates: [linkedElsewhere.intentId, intent.id],
      supportingEventIds: [linkedElsewhere.id],
    });
    return "contradictory_exception_raised";
  }
  const otherTx = ws.chainObservations.find((o) => o.intentId === intent.id && o.txHash !== txHash && o.status !== "rejected_unsupported");
  if (otherTx) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_SECOND_TX_FOR_PAYOUT",
      explanation: `A second transaction ${txHash.slice(0, 12)}… was observed for a payout already linked to ${otherTx.txHash.slice(0, 12)}…. Not counted.`,
      intentId: intent.id,
      supportingEventIds: [otherTx.id],
    });
    return "contradictory_exception_raised";
  }
  // B1: wallet and amount must match the payout exactly.
  const wallet = expectedBeneficiaryWallet(intent);
  if (input.toAddress.toLowerCase() !== wallet) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_WALLET_NOT_BENEFICIARY",
      explanation: `Transfer went to ${input.toAddress}, not the beneficiary's registered sandbox wallet ${wallet}. Not counted.`,
      intentId: intent.id,
    });
    return "contradictory_exception_raised";
  }
  const expected = expectedChainAmount(tx, intent.id);
  if (expected === undefined || expected !== input.amountMinor) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_AMOUNT_DIFFERS_FROM_QUOTE",
      explanation: `On-chain amount ${input.amountMinor} differs from the expected ${expected ?? "unknown"} USDC minor units (6 decimals). Not counted.`,
      intentId: intent.id,
    });
    return "contradictory_exception_raised";
  }
  // rc3 (C-1): a rejected (unsupported) observation is never updated into a counted one.
  const existing = ws.chainObservations.find((o) => o.txHash === txHash && o.intentId === intent.id && o.status !== "rejected_unsupported");
  let obs: ChainObservation;
  if (existing) {
    const decreased = input.confirmations < existing.confirmations;
    // rc3 (C-2): the same transaction in a different block means it was re-included after a reorg.
    const moved = input.blockNumber !== existing.blockNumber;
    const before = existing.confirmations;
    const beforeBlock = existing.blockNumber;
    existing.confirmations = input.confirmations;
    existing.blockNumber = input.blockNumber;
    existing.updatedAt = tx.at;
    existing.status = statusFor(input.confirmations);
    obs = existing;
    if (decreased || moved) {
      openException(tx, {
        category: "contradictory_evidence",
        explanationCode: decreased ? "CH_CONFIRMATIONS_DECREASED" : "CH_BLOCK_CHANGED",
        explanation: decreased
          ? `Confirmations dropped from ${before} to ${input.confirmations}; possible reorganisation. Finality is not assumed.`
          : `The transaction moved from block ${beforeBlock} to block ${input.blockNumber}; it was re-included after a reorganisation. Finality is not assumed.`,
        intentId: intent.id,
        supportingEventIds: [existing.id],
      });
      intent.status.settlement = "contradicted";
      intent.status.settlementScope = "onchain_transfer";
      // rc3 (C-3): an allocation made on the earlier (final) observation no longer stands as a match.
      intent.status.reconciliation = "exception";
      tx.log(decreased ? "chain.confirmations_decreased" : "chain.block_changed", "chain_observation", existing.id, decreased ? "Confirmations decreased" : "Block number changed");
      return "contradictory_exception_raised";
    }
  } else {
    obs = { ...input, txHash, tokenContract: input.tokenContract.toLowerCase(), toAddress: input.toAddress.toLowerCase(), id: tx.id("chn"), observedAt: tx.at, updatedAt: tx.at, finalityThreshold: FINALITY_THRESHOLD, status: statusFor(input.confirmations), label: "Synthetic Base Sepolia testnet observation" };
    ws.chainObservations.push(obs);
    ws.evidence.push({ id: tx.id("evd"), kind: "chain_observation", intentId: intent.id, description: `Synthetic Base Sepolia transfer ${obs.txHash.slice(0, 12)}… observed`, source: "Synthetic chain observer (testnet)", independent: true, reference: obs.txHash, recordedBy: "system", recordedAt: tx.at });
  }
  // M3: a contradicted settlement is never overwritten by later evidence; a person resolves it.
  if (intent.status.settlement === "contradicted") {
    noteOnContradictions(tx, intent.id, `New observation stored: ${obs.status}, ${obs.confirmations}/${FINALITY_THRESHOLD} confirmations. Settlement left as contradicted.`);
    tx.log("chain.observation_recorded", "chain_observation", obs.id, "Stored without changing a contradicted settlement");
    return "recorded_no_state_change";
  }
  intent.status.settlementScope = "onchain_transfer";
  if (obs.status === "observed") intent.status.settlement = "observed";
  else if (obs.status === "pending_finality") {
    intent.status.settlement = "pending_finality";
    openException(tx, {
      category: "pending_finality",
      explanationCode: "CH_BELOW_FINALITY_THRESHOLD",
      explanation: `Transfer observed with ${obs.confirmations}/${FINALITY_THRESHOLD} confirmations. Observation is not finality.`,
      intentId: intent.id,
      supportingEventIds: [obs.id],
    });
  } else {
    intent.status.settlement = "verified";
    tryAllocateChain(tx, intent);
  }
  tx.log("chain.observation", "chain_observation", obs.id, `${obs.status} · ${obs.confirmations}/${FINALITY_THRESHOLD} confirmations (synthetic)`);
  return "applied";
}
