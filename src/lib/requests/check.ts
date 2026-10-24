// Runs the existing investigation engine on one observed transfer, with the requests as the
// company's deposit addresses. The engine decides; this file only builds its input and keeps
// the parts of its answer that make sense for a payment request.

import { VERDICT_LABELS } from "../catalogue";
import { investigate } from "../engine/run";
import { SAMPLE_SETTINGS, USDC_ETHEREUM } from "../fixtures";
import { normaliseInput } from "../normalise";
import type { ChainTx, DepositAddressRow, Evidence, Facts, Settings } from "../types";
import type { CheckSnapshot, Observation, PaymentRequest, RequestsData } from "./types";

/**
 * The sample business's settings for requests: the deposit settings, plus Circle's official
 * USDC contract on Ethereum as an accepted token. Confirmations: 12 on Ethereum.
 */
export const REQUEST_SETTINGS: Settings = {
  ...SAMPLE_SETTINGS,
  version: `${SAMPLE_SETTINGS.version}+requests-usdc`,
  acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, ethereum: [...SAMPLE_SETTINGS.acceptedTokens.ethereum, { symbol: "USDC", contract: USDC_ETHEREUM }] },
  minimums: { ...SAMPLE_SETTINGS.minimums, ethereum: { ...SAMPLE_SETTINGS.minimums.ethereum, USDC: "1" } },
};
export const CONFIRMATIONS = REQUEST_SETTINGS.confirmations.ethereum;
export const OFFICIAL_USDC = USDC_ETHEREUM.toLowerCase();

// What the engine's verdict means for a request. These need a person; the rest don't.
const PROBLEM = new Set(["D03", "D04", "D05", "D06", "D07", "D07b", "D08", "D09", "D17", "D18", "D99"]);

/** Every request's receiving address, as the "deposit address" list the engine expects. */
export function requestAddresses(data: RequestsData): DepositAddressRow[] {
  return Object.values(data.requests).map((r, i) => ({ row: i + 2, address: r.receivingAddress, chain: "ethereum" as const,
    customerId: r.customerRef, assignedAt: r.createdAt }));
}

/** The engine's facts for one observation. For simulated transfers no outside check is made, and none is claimed. */
export function factsFor(obs: Observation, request: PaymentRequest | undefined, data: RequestsData, now: string): Facts | undefined {
  if (obs.blockNumber === undefined) return undefined;
  const tx: ChainTx = {
    chain: "ethereum", hash: obs.hash, status: obs.status, blockNumber: obs.blockNumber, blockTime: obs.blockTime ?? now, isBatch: false,
    errorCode: obs.status === "failed" ? "REVERTED (receipt status 0)" : undefined,
    transfers: [{ logIndex: obs.logIndex, tokenContract: obs.tokenContract, tokenSymbol: obs.tokenSymbol, from: obs.from, to: obs.to, amount: obs.amount }],
  };
  return {
    input: normaliseInput(obs.hash), customerId: request?.customerRef, checkedAt: now,
    lookups: [{ chain: "ethereum", result: "found", fetchedAt: obs.lastUpdatedAt, sourceUrl: "", rawBody: "" }],
    // Confirmations as the engine counts them: blocks on top of the one holding the transfer.
    tx, currentBlock: obs.blockNumber + obs.confirmations,
    freezes: [], freezeStatus: "not_supported", senderHistory: [], senderHistoryStatus: "not_supported",
    depositAddresses: requestAddresses(data), ledger: [], ledgerUploadedAt: now,
  };
}

/**
 * The engine's evidence, minus the rows that would claim something not checked here: the ledger
 * row (a request's "ledger" is the business's acknowledgement, shown separately), and for a
 * simulated transfer the cross-chain lookup and the freeze row, because no chain was asked.
 */
function keepEvidence(e: Evidence[], obs: Observation): Evidence[] {
  return e.filter((x) => x.id !== "ev.ledger" && x.id !== "ev.input" && (obs.source === "live" || (x.id !== "ev.lookup" && x.id !== "ev.freeze")));
}

export function checkObservation(now: string, factsOverride?: Facts) {
  return (obs: Observation, request: PaymentRequest | undefined, data: RequestsData): CheckSnapshot => {
    const facts = factsOverride ?? factsFor(obs, request, data, now);
    if (!facts) {
      return { at: now, code: null, label: "Not yet in a block", confidence: null, problem: false,
        summary: "Seen before inclusion in a block; checks run once it is mined.", evidence: [] };
    }
    const v = investigate(facts, REQUEST_SETTINGS);
    if (v.state === "paused") {
      return { at: now, code: null, label: "Check paused", confidence: null, problem: false,
        summary: `A chain didn't answer (${v.pausedChains.join(", ")}). Nothing is concluded until it does.`, evidence: keepEvidence(v.evidence, obs) };
    }
    const winner = v.checks.find((c) => c.code === v.code);
    return {
      at: now, code: v.code, label: VERDICT_LABELS[v.code], confidence: v.confidence, problem: PROBLEM.has(v.code),
      summary: winner?.reason ?? (v.code === "D99" ? "No rule matched with enough confidence; a person should look." : ""), evidence: keepEvidence(v.evidence, obs), ruleVersion: v.ruleVersion, settingsVersion: v.settingsVersion,
    };
  };
}
