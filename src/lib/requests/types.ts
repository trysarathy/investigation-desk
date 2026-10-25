// Payment requests: a business asks for an exact amount of one token on one network, a sender
// pays it, and we track the transfer until the business acknowledges it. Read-only throughout:
// nothing here holds keys or moves funds.

import type { Evidence } from "../types";

/** The one token and network the first version supports (see README "Payment requests"). */
export const REQUEST_CHAIN = "ethereum" as const;
export const REQUEST_TOKEN = "USDC" as const;
export const USDC_DECIMALS = 6;

/**
 * Operational states, derived from the records every time (never stored, so they can't drift):
 *
 *  awaiting_payment   no valid transfer counts toward the request yet (or the business is waiting
 *                     for the balance of a short payment)
 *  transfer_detected  a valid transfer to the request's address is seen, not yet in a block
 *  confirming         in a block, fewer confirmations than the business requires
 *  matched            confirmed transfers in the official token add up to exactly the amount, and
 *                     nothing needs a person; on-chain this is done, but the business hasn't said so
 *  needs_review       a person must decide: short or over payment, a suspicious or failed transfer,
 *                     or a transfer that could belong to more than one request
 *  completed          the business acknowledged it (credited the customer, marked the invoice paid).
 *                     Only an operator's acknowledgement gets here; a confirmed transfer never does.
 */
export type RequestState = "awaiting_payment" | "transfer_detected" | "confirming" | "matched" | "needs_review" | "completed";

export const STATE_LABELS: Record<RequestState, string> = {
  awaiting_payment: "Awaiting payment",
  transfer_detected: "Transfer detected",
  confirming: "Confirming",
  matched: "Matched",
  needs_review: "Needs review",
  completed: "Completed",
};

export const STATE_MEANING: Record<RequestState, string> = {
  awaiting_payment: "No valid transfer counts toward this request yet.",
  transfer_detected: "A transfer to this address is seen but not yet in a block.",
  confirming: "In a block; waiting for the confirmations the business requires.",
  matched: "Confirmed in genuine USDC for exactly the amount. Waiting for the business to acknowledge it.",
  needs_review: "A person must decide before this can complete.",
  completed: "The business acknowledged the payment.",
};

export type Source = "simulated" | "live";

export interface Activity {
  at: string;
  /** Who or what: an operator's name, "Simulated provider", "Live chain lookup", "System". */
  actor: string;
  kind: "created" | "transfer" | "duplicate" | "confirmations" | "match" | "check" | "decision" | "acknowledged" | "note" | "owner";
  text: string;
  observationKey?: string;
}

export type DecisionKind =
  | "request_balance"     // short payment: keep waiting for the rest
  | "accept_short"        // short payment: accept as settled (completes, with a note)
  | "accept_over"         // over payment: accept; the difference is handled outside the app
  | "dismiss_transfer"    // a flagged transfer is not a payment for this request
  | "assign_transfer"     // an ambiguous transfer belongs to this request
  | "count_transfer"      // a transfer mined before the request was created is this request's payment
  | "acknowledge";        // the business has credited it

export interface Decision {
  at: string;
  by: string;
  kind: DecisionKind;
  note: string;
  observationKey?: string;
}

export interface PaymentRequest {
  id: string;                 // REQ-1042: what the business sees
  publicId: string;           // random: the sender link, not guessable from the number
  demo: boolean;
  customerRef: string;
  invoiceRef: string;
  amount: string;             // exact decimal string, at most 6 places
  token: typeof REQUEST_TOKEN;
  chain: typeof REQUEST_CHAIN;
  tokenContract: string;      // the official contract, fixed when the request is made
  receivingAddress: string;
  createdAt: string;
  createdBy: string;
  owner?: string;
  note?: string;
  decisions: Decision[];      // append-only
  activity: Activity[];       // append-only
}

/** One engine check of one transfer. Appended, never replaced: re-checks keep the earlier ones. */
export interface CheckSnapshot {
  at: string;
  code: string | null;        // null: nothing to check yet (not in a block)
  label: string;
  confidence: "High" | "Medium" | null;
  /** The engine found something a person must look at (fake token, failed, frozen...). */
  problem: boolean;
  summary: string;
  evidence: Evidence[];
  ruleVersion?: string;
  settingsVersion?: string;
}

export type Attribution =
  | { kind: "request"; requestId: string; reason: string; by: string; at: string }
  | { kind: "ambiguous"; candidates: string[]; reason: string; at: string }
  | { kind: "none"; reason: string; at: string };

/** A token transfer we observed (simulated or live), keyed so a repeat delivery is recognised. */
export interface Observation {
  key: string;                // ethereum:<hash>:<logIndex>
  source: Source;
  demo: boolean;
  chain: typeof REQUEST_CHAIN;
  hash: string;
  logIndex: number;
  from: string;
  to: string;
  tokenContract: string;
  tokenSymbol: string;
  amount: string;
  status: "success" | "failed";
  blockNumber?: number;       // undefined: seen, not yet in a block
  blockTime?: string;
  confirmations: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  attribution: Attribution;
  /** Earlier attributions, oldest first: a person's assignment never erases what the system decided. */
  attributionHistory?: Attribution[];
  checks: CheckSnapshot[];
}

export interface RequestsData {
  version: 1;
  rev?: number;
  nextNumber: number;
  requests: Record<string, PaymentRequest>;
  observations: Record<string, Observation>;
  /** The simulated chain's head block. Only the demo provider moves it. */
  demoHead?: number;
}

export const emptyRequests = (): RequestsData => ({ version: 1, nextNumber: 1001, requests: {}, observations: {} });

/** What a transfer source delivers. The same shape from the demo provider and a live lookup. */
export interface TransferEvent {
  source: Source;
  demo: boolean;
  chain: typeof REQUEST_CHAIN;
  hash: string;
  logIndex: number;
  from: string;
  to: string;
  tokenContract: string;
  tokenSymbol: string;
  amount: string;
  status: "success" | "failed";
  blockNumber?: number;
  blockTime?: string;
  confirmations: number;
}
