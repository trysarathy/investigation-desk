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
import type { AllowlistedToken, ChainObservation, ChainObservationInput } from "./types";
import type { Tx } from "./tx";

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
  if (!isHex(o.txHash, 64)) return "txHash must be 0x + 64 lowercase hex characters.";
  if (!isHex(o.toAddress, 40)) return "toAddress must be 0x + 40 lowercase hex characters.";
  if (!Number.isSafeInteger(o.amountMinor) || o.amountMinor <= 0) return "amountMinor must be a positive integer (token minor units).";
  if (!Number.isSafeInteger(o.blockNumber) || o.blockNumber < 0) return "blockNumber must be a non-negative integer.";
  if (!Number.isSafeInteger(o.confirmations) || o.confirmations < 0) return "confirmations must be a non-negative integer.";
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

/** Ingest/refresh a synthetic chain observation. Returns the processing outcome. */
export function ingestChainObservation(tx: Tx, input: ChainObservationInput): string {
  const ws = tx.ws;
  const intent = ws.intents.find((i) => i.id === input.intentId)!;
  const token = tokenAllowed(input);
  const existing = ws.chainObservations.find((o) => o.txHash === input.txHash);
  if (!token) {
    const obs: ChainObservation = {
      ...input,
      id: tx.id("chn"),
      observedAt: tx.at,
      updatedAt: tx.at,
      finalityThreshold: FINALITY_THRESHOLD,
      status: "rejected_unsupported",
      label: "Synthetic Base Sepolia testnet observation",
    };
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
  const expected = expectedChainAmount(tx, intent.id);
  if (expected !== undefined && expected !== input.amountMinor) {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "CH_AMOUNT_DIFFERS_FROM_QUOTE",
      explanation: `On-chain amount ${input.amountMinor} differs from the expected ${expected} USDC minor units.`,
      intentId: intent.id,
    });
    intent.status.settlement = "contradicted";
    intent.status.settlementScope = "onchain_transfer";
    intent.status.reconciliation = "exception";
    tx.log("chain.amount_mismatch", "intent", intent.id, "On-chain amount contradicts the expected amount");
    return "contradictory_exception_raised";
  }
  let obs: ChainObservation;
  if (existing) {
    if (input.confirmations < existing.confirmations) {
      openException(tx, {
        category: "contradictory_evidence",
        explanationCode: "CH_CONFIRMATIONS_DECREASED",
        explanation: `Confirmations dropped from ${existing.confirmations} to ${input.confirmations}; possible reorganisation. Finality is not assumed.`,
        intentId: intent.id,
        supportingEventIds: [existing.id],
      });
      intent.status.settlement = "contradicted";
      tx.log("chain.confirmations_decreased", "chain_observation", existing.id, "Confirmations decreased");
      return "contradictory_exception_raised";
    }
    existing.confirmations = input.confirmations;
    existing.blockNumber = input.blockNumber;
    existing.updatedAt = tx.at;
    existing.status = statusFor(input.confirmations);
    obs = existing;
  } else {
    obs = {
      ...input,
      tokenContract: input.tokenContract.toLowerCase(),
      id: tx.id("chn"),
      observedAt: tx.at,
      updatedAt: tx.at,
      finalityThreshold: FINALITY_THRESHOLD,
      status: statusFor(input.confirmations),
      label: "Synthetic Base Sepolia testnet observation",
    };
    ws.chainObservations.push(obs);
    ws.evidence.push({
      id: tx.id("evd"),
      kind: "chain_observation",
      intentId: intent.id,
      description: `Synthetic Base Sepolia transfer ${obs.txHash.slice(0, 12)}… observed`,
      source: "Synthetic chain observer (testnet)",
      independent: true,
      reference: obs.txHash,
      recordedBy: "system",
      recordedAt: tx.at,
    });
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
    intent.status.reconciliation = "matched";
  }
  tx.log("chain.observation", "chain_observation", obs.id, `${obs.status} · ${obs.confirmations}/${FINALITY_THRESHOLD} confirmations (synthetic)`);
  return "applied";
}
