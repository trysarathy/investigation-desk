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

// What the engine's verdict means for a request. These need a person; the rest don't. D17/D18
// (another customer's or a retired address) don't apply: a request's address belongs to the request.
const PROBLEM = new Set(["D03", "D04", "D05", "D06", "D07", "D07b", "D08", "D09", "D99"]);
const REQUEST_CUSTOMER = "request";

/**
 * The "deposit address" rows the engine expects. Matched to a request: that request's address,
 * held by the request since the start of time (when it was mined is judged by our own rule, not
 * the engine's File A logic). Not matched: the destination as a company address with no customer.
 */
export function requestAddresses(data: RequestsData, request?: PaymentRequest, to?: string): DepositAddressRow[] {
  const address = request?.receivingAddress ?? to;
  if (!address) return [];
  return [{ row: 2, address, chain: "ethereum" as const, customerId: REQUEST_CUSTOMER, assignedAt: "1970-01-01T00:00:00Z" }];
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
    input: normaliseInput(obs.hash), customerId: request ? REQUEST_CUSTOMER : undefined, checkedAt: now,
    lookups: [{ chain: "ethereum", result: "found", fetchedAt: obs.lastUpdatedAt, sourceUrl: "", rawBody: "" }],
    // Confirmations as the engine counts them: blocks on top of the one holding the transfer.
    tx, currentBlock: obs.blockNumber + obs.confirmations,
    freezes: [], freezeStatus: "not_supported", senderHistory: [], senderHistoryStatus: "not_supported",
    depositAddresses: requestAddresses(data, request, obs.to), ledger: [], ledgerUploadedAt: now,
  };
}

/**
 * The engine's evidence, minus the rows that would claim something not checked here: the ledger
 * row (a request's "ledger" is the business's acknowledgement, shown separately), and for a
 * simulated transfer the cross-chain lookup and the freeze row, because no chain was asked.
 */
function keepEvidence(e: Evidence[], obs: Observation, request?: PaymentRequest): Evidence[] {
  return e
    .filter((x) => x.id !== "ev.ledger" && x.id !== "ev.input" && (obs.source === "live" || (x.id !== "ev.lookup" && x.id !== "ev.freeze")))
    .map((x) => {
      // The engine words the address row for deposit files ("File A line N"); say what is true for a request.
      if (x.id === "ev.address") {
        return { ...x, detail: undefined, mono: undefined, source: { kind: "none" as const },
          value: request ? `Paid to ${request.id}'s receiving address` : "Paid to a receiving address that no single open request claims" };
      }
      // A simulated transfer has no public record: never store an explorer link for it.
      if (obs.source === "simulated" && x.source.kind === "explorer") return { ...x, source: { kind: "none" as const } };
      return x;
    });
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
        summary: `A chain didn't answer (${v.pausedChains.join(", ")}). Nothing is concluded until it does.`, evidence: keepEvidence(v.evidence, obs, request) };
    }
    const winner = v.checks.find((c) => c.code === v.code);
    return {
      at: now, code: v.code, label: VERDICT_LABELS[v.code], confidence: v.confidence, problem: PROBLEM.has(v.code),
      summary: winner?.reason ?? (v.code === "D99" ? "No rule matched with enough confidence; a person should look." : ""), evidence: keepEvidence(v.evidence, obs, request), ruleVersion: v.ruleVersion, settingsVersion: v.settingsVersion,
    };
  };
}
