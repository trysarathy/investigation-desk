// The request lifecycle as pure functions: create, ingest a transfer event, attribute it to a
// request, derive the state, record a decision. No clock, no network: callers pass `now` and the
// engine check, so the same inputs always give the same records (and tests can replay them).

import { sameAddress } from "../address";
import { compareDecimal, isDecimal } from "../decimal";
import { add, sub } from "../payments/money";
import type {
  Activity, AddressCheck, Attribution, BusinessWallet, CheckSnapshot, Decision, DecisionKind, InboundMessage, Observation, PaymentRequest,
  RequestState, RequestsData, RequestToken, TransferEvent,
} from "./types";
import { ISSUER, REQUEST_CHAIN, REQUEST_TOKENS, USDC_DECIMALS } from "./types";

export const obsKey = (chain: string, hash: string, logIndex: number) => `${chain}:${hash.toLowerCase()}:${logIndex}`;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_LABEL: Record<string, string> = { ethereum: "Ethereum", tron: "Tron" };

// ---------- creating a request ----------

export interface NewRequestInput {
  customerRef: string;
  invoiceRef: string;
  amount: string;
  receivingAddress: string;
  token?: RequestToken;
}

/** Field errors, empty when the request is valid. Amounts are exact decimals with at most 6 places. */
export function validateRequest(i: NewRequestInput): Record<string, string> {
  const e: Record<string, string> = {};
  const text = (v: string, name: string) => {
    if (!v.trim()) e[name] = "Required.";
    else if (v.length > 80) e[name] = "80 characters at most.";
    else if (/[@]/.test(v) && name === "customerRef") e[name] = "Use a customer reference, not an email address.";
  };
  text(i.customerRef ?? "", "customerRef");
  text(i.invoiceRef ?? "", "invoiceRef");
  const amt = (i.amount ?? "").trim();
  if (!isDecimal(amt)) e.amount = "Digits and one optional point, e.g. 1250.00. No commas or signs.";
  else if ((amt.split(".")[1] ?? "").length > USDC_DECIMALS) e.amount = `${i.token ?? "USDC"} has ${USDC_DECIMALS} decimal places at most.`;
  else if (compareDecimal(amt, "0") <= 0) e.amount = "Must be more than zero.";
  else if (amt.split(".")[0].replace(/^0+/, "").length > 12) e.amount = "Too large for one request.";
  if (!EVM_ADDRESS.test((i.receivingAddress ?? "").trim())) e.receivingAddress = "An Ethereum address: 0x followed by 40 hex characters.";
  if (i.token !== undefined && !REQUEST_TOKENS.includes(i.token)) e.token = "USDC or USDT.";
  return e;
}

export function createRequest(data: RequestsData, i: NewRequestInput, o: {
  now: string; by: string; demo: boolean; publicId: string; tokenContract: string; id?: string; autoMarkPaid?: boolean; messages?: InboundMessage[];
}): { data: RequestsData; request: PaymentRequest } {
  const id = o.id ?? `REQ-${data.nextNumber}`;
  if (data.requests[id]) throw new Error(`Request ${id} already exists`);
  const token = i.token ?? "USDC";
  const amount = normaliseAmount(i.amount.trim());
  const request: PaymentRequest = {
    id, publicId: o.publicId, demo: o.demo,
    customerRef: i.customerRef.trim(), invoiceRef: i.invoiceRef.trim(), amount,
    token, chain: REQUEST_CHAIN, tokenContract: o.tokenContract.toLowerCase(),
    receivingAddress: i.receivingAddress.trim(),
    createdAt: o.now, createdBy: o.by, decisions: [],
    ...(o.autoMarkPaid ? { autoMarkPaid: true } : {}),
    ...(o.messages?.length ? { messages: o.messages } : {}),
    activity: [{ at: o.now, actor: o.by, kind: "created", text: `Requested ${formatUsdc(amount)} ${token} on Ethereum for ${i.invoiceRef.trim()}.` }],
  };
  const nextNumber = o.id ? data.nextNumber : data.nextNumber + 1;
  return { data: { ...data, nextNumber, requests: { ...data.requests, [id]: request } }, request };
}

/** 1250 → 1250.00, 1250.5 → 1250.50: two places at least, the exact value kept. */
export function normaliseAmount(a: string): string {
  const [int, frac = ""] = a.split(".");
  const i = int.replace(/^0+(?=\d)/, "");
  return `${i}.${frac.padEnd(2, "0")}`;
}

/** 1250.00 → "1,250.00" for reading. Exact: works on the string, never a float. */
export function formatUsdc(a: string): string {
  const neg = a.startsWith("-");
  const [int, frac = ""] = a.replace(/^-/, "").split(".");
  const f = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`;
}

/** Exact base units for a payment URI: 1250.5 USDC → 1250500000. */
export function toBaseUnits(a: string, decimals = USDC_DECIMALS): string {
  const neg = a.startsWith("-");
  const [int, frac = ""] = a.replace(/^-/, "").split(".");
  if (frac.length > decimals) throw new Error("More decimal places than the token has");
  return `${neg ? "-" : ""}${BigInt(int + frac.padEnd(decimals, "0")).toString()}`;
}

/** part / whole as a percentage with one decimal, exactly (no floats on money): 50 / 5000 → "1.0". */
export function percentOf(part: string, whole: string): string {
  const p = BigInt(toBaseUnits(part.replace(/^-/, ""))), w = BigInt(toBaseUnits(whole));
  if (w === 0n) return "0.0";
  const tenths = (p * 1000n + w / 2n) / w;
  return `${tenths / 10n}.${tenths % 10n}`;
}

// ---------- the business's own wallets ----------

export const walletOf = (data: RequestsData, chain: string, address: string, demo: boolean): BusinessWallet | undefined =>
  (data.wallets ?? []).find((w) => w.chain === chain && w.demo === demo && sameAddress(w.address, address));

export const senderLabel = (data: RequestsData, address: string) =>
  (data.senderLabels ?? []).find((l) => sameAddress(l.address, address));

// ---------- attribution: which request does a transfer belong to? ----------

/**
 * Deterministic and conservative:
 *  - only open requests on the same network whose receiving address is the transfer's destination are candidates;
 *  - one candidate: it is that request's transfer (the address identifies it);
 *  - several candidates: never decided by amount alone. The transfer waits for a person, and an
 *    exact-amount candidate is only offered as a hint;
 *  - none open, but a paid request used the address: it goes back to that request as a possible duplicate.
 */
export function attribute(data: RequestsData, ev: Pick<TransferEvent, "to" | "amount" | "chain" | "demo">, at: string): Attribution {
  // Demo transfers only ever match demo requests, and real ones only real requests.
  const sameWorld = Object.values(data.requests).filter((r) => r.chain === ev.chain && r.demo === ev.demo && sameAddress(r.receivingAddress, ev.to));
  const candidates = sameWorld.filter((r) => !acknowledgement(r)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const done = sameWorld.filter((r) => acknowledgement(r)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (candidates.length === 0 && done.length > 0) {
    const last = done.at(-1)!;
    return { kind: "request", requestId: last.id, at, by: "System",
      reason: `Arrived after ${last.id} was already paid. No other request uses this address: possibly a duplicate payment.` };
  }
  if (candidates.length === 0) {
    const w = walletOf(data, ev.chain, ev.to, ev.demo);
    return { kind: "none", at, reason: w
      ? `Arrived at ${w.label}, which no open request uses, with no invoice reference on-chain.`
      : "No open request uses this receiving address." };
  }
  // A customer paying again after a completed request must not silently pay the next one.
  if (candidates.length === 1 && done.length > 0) {
    return { kind: "ambiguous", candidates: [candidates[0].id], at,
      reason: `${candidates[0].id} is the only open request on this address, but ${done.map((r) => r.id).join(", ")} (paid) used it too: this could be a repeat payment.` };
  }
  if (candidates.length === 1) {
    return { kind: "request", requestId: candidates[0].id, at, by: "System",
      reason: `${candidates[0].id} is the only open request paid to this address.` };
  }
  const exact = candidates.filter((r) => isDecimal(ev.amount) && compareDecimal(ev.amount, r.amount) === 0);
  const hint = exact.length === 1 ? ` The amount equals ${exact[0].id}, but amount alone isn't proof.` : "";
  return { kind: "ambiguous", candidates: candidates.map((r) => r.id), at,
    reason: `${candidates.length} open requests share this address (${candidates.map((r) => r.id).join(", ")}).${hint}` };
}

// ---------- ingesting a transfer event ----------

export type Check = (obs: Observation, request: PaymentRequest | undefined, data: RequestsData) => CheckSnapshot;

export interface IngestResult { data: RequestsData; outcome: "new" | "updated" | "duplicate"; key: string }

export const AUTO_RULE = "Auto-match rule";

/**
 * The single entry point for transfer events, simulated or live. A repeat delivery of the same
 * transfer (chain + hash + log index) never creates a second payment: identical → "duplicate";
 * newer block data → "updated". Confirmations never go backwards.
 *
 * `claimedFor`: the transfer was looked up from a hash given for that request (a customer emailed
 * it). It is recorded against the request even when it went somewhere else, so the request shows
 * what happened to the customer's money; it only counts if it really paid the request.
 */
export function ingest(data: RequestsData, ev: TransferEvent, now: string, actor: string, check: Check, threshold: number, o: { claimedFor?: string } = {}): IngestResult {
  const key = obsKey(ev.chain, ev.hash, ev.logIndex);
  const prev = data.observations[key];
  const requests = { ...data.requests };
  const note = (requestId: string | undefined, a: Activity) => {
    if (!requestId || !requests[requestId]) return;
    requests[requestId] = { ...requests[requestId], activity: [...requests[requestId].activity, a] };
  };

  if (prev) {
    const block = prev.blockNumber ?? ev.blockNumber;
    const confirmations = Math.max(prev.confirmations, ev.confirmations);
    const changed = block !== prev.blockNumber || confirmations !== prev.confirmations || (prev.status !== ev.status && ev.blockNumber !== undefined);
    const owners = ownersOf(prev);
    if (!changed) {
      for (const id of owners) note(id, { at: now, actor, kind: "duplicate", observationKey: key, text: `The same transfer (${short(ev.hash)}) was reported again. Ignored: it counts once.` });
      return { data: { ...data, requests }, outcome: "duplicate", key };
    }
    let next: Observation = { ...prev, blockNumber: block, blockTime: prev.blockTime ?? ev.blockTime, confirmations,
      status: ev.blockNumber !== undefined ? ev.status : prev.status, lastUpdatedAt: now };
    const need = prev.chain === "tron" ? 20 : threshold; // Tron needs 20 (the business's setting), Ethereum 12
    const crossed = prev.confirmations < need && confirmations >= need;
    for (const id of owners) {
      note(id, { at: now, actor, kind: "confirmations", observationKey: key,
        text: prev.blockNumber === undefined && block !== undefined
          ? `Included in block ${block.toLocaleString("en-US")} (${Math.min(confirmations, need)} of ${need} confirmations).`
          : crossed ? `Confirmed: ${need} of ${need} confirmations.` : `${Math.min(confirmations, need)} of ${need} confirmations.` });
    }
    next = withCheck(next, { ...data, requests }, check);
    const out = { ...data, requests, observations: { ...data.observations, [key]: next } };
    return { data: autoMark(out, owners, now, threshold), outcome: "updated", key };
  }

  const claimed = o.claimedFor && data.requests[o.claimedFor] && !(ev.chain === REQUEST_CHAIN && sameAddress(ev.to, data.requests[o.claimedFor].receivingAddress))
    ? data.requests[o.claimedFor] : undefined;
  const attribution: Attribution = claimed
    ? { kind: "request", requestId: claimed.id, at: now, by: actor, claimed: true, reason: `Looked up from the transaction reference given for ${claimed.id}.` }
    : attribute(data, ev, now);
  let obs: Observation = {
    key, source: ev.source, demo: ev.demo, chain: ev.chain, hash: ev.hash.toLowerCase(), logIndex: ev.logIndex,
    from: ev.from, to: ev.to, tokenContract: ev.tokenContract.startsWith("0x") ? ev.tokenContract.toLowerCase() : ev.tokenContract, tokenSymbol: ev.tokenSymbol, amount: ev.amount,
    status: ev.status, blockNumber: ev.blockNumber, blockTime: ev.blockTime, confirmations: ev.confirmations,
    firstSeenAt: now, lastUpdatedAt: now, attribution, checks: [],
  };
  const where = ev.blockNumber === undefined ? "not yet in a block" : `in block ${ev.blockNumber.toLocaleString("en-US")}`;
  const net = ev.chain === REQUEST_CHAIN ? "" : ` on ${CHAIN_LABEL[ev.chain] ?? ev.chain}`;
  const what = `${formatUsdc(ev.amount)} ${ev.tokenSymbol} transfer ${short(ev.hash)}${net}, ${where}.`;
  if (attribution.kind === "request") {
    note(attribution.requestId, { at: now, actor, kind: "transfer", observationKey: key, text: `${claimed ? "Found" : "Detected"} a ${what}` });
    note(attribution.requestId, { at: now, actor: "System", kind: "match", observationKey: key, text: `Attributed to ${attribution.requestId}: ${attribution.reason}` });
  } else if (attribution.kind === "ambiguous") {
    for (const id of attribution.candidates) note(id, { at: now, actor, kind: "transfer", observationKey: key, text: `Detected a ${what} Not attributed: ${attribution.reason}` });
  }
  obs = withCheck(obs, { ...data, requests }, check);
  const out = { ...data, requests, observations: { ...data.observations, [key]: obs } };
  return { data: autoMark(out, ownersOf(obs), now, threshold), outcome: "new", key };
}

/**
 * The business's auto-mark rule: a request that asked for it, and is now matched (confirmed, genuine
 * token, exactly the amount, nothing flagged), is marked paid with no one touching it. Recorded as a
 * decision by the rule, so the record says who marked it paid and why.
 */
function autoMark(data: RequestsData, ids: string[], now: string, threshold: number): RequestsData {
  let d = data;
  for (const id of ids) {
    const r = d.requests[id];
    if (!r?.autoMarkPaid) continue;
    const v = deriveRequest(d, r, threshold);
    if (v.state !== "matched") continue;
    const note = `Exactly ${formatUsdc(r.amount)} ${r.token} from ${ISSUER[r.token]}'s contract, ${threshold} confirmations, nothing flagged.`;
    const decision: Decision = { at: now, by: AUTO_RULE, kind: "acknowledge", note };
    d = { ...d, requests: { ...d.requests, [id]: { ...r, decisions: [...r.decisions, decision],
      activity: [...r.activity, { at: now, actor: AUTO_RULE, kind: "acknowledged", text: `Marked paid automatically. ${note} No one had to touch it.` }] } } };
  }
  return d;
}

/**
 * Run the engine check and append its snapshot when anything it found changed: the verdict, or the
 * evidence (confirmations moving, for example), so the evidence shown is always the latest. Older
 * snapshots stay on file; none is replaced.
 */
function withCheck(obs: Observation, data: RequestsData, check: Check): Observation {
  const req = obs.attribution.kind === "request" ? data.requests[obs.attribution.requestId] : undefined;
  const snap = check(obs, req, data);
  const last = obs.checks.at(-1);
  const sig = (c: CheckSnapshot) => JSON.stringify([c.code, c.label, c.confidence, c.problem, c.evidence.map((e) => [e.id, e.status, e.value, e.detail])]);
  if (last && sig(last) === sig(snap)) return obs;
  return { ...obs, checks: [...obs.checks, snap] };
}

const ownersOf = (o: Observation): string[] =>
  o.attribution.kind === "request" ? [o.attribution.requestId] : o.attribution.kind === "ambiguous" ? o.attribution.candidates : [];

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

// ---------- deriving the state ----------

const SETTLING: DecisionKind[] = ["acknowledge", "accept_short", "accept_over", "accept_other_network", "refund_excess"];

/** The latest decision that marked the request paid, if any. */
export const acknowledgement = (r: PaymentRequest): Decision | undefined =>
  [...r.decisions].reverse().find((d) => SETTLING.includes(d.kind));

const dismissed = (r: PaymentRequest, key: string) => r.decisions.some((d) => d.kind === "dismiss_transfer" && d.observationKey === key);
const counted = (r: PaymentRequest, key: string) => r.decisions.some((d) => d.kind === "count_transfer" && d.observationKey === key);
/** Only a timing flag can be overridden by a person; a fake token or a failed transaction never counts. */
export const isTimingProblem = (p: string) => /before this request was created/.test(p);
export const isWrongNetwork = (o: Observation) => o.chain !== REQUEST_CHAIN;

export type ProblemKind = "failed" | "wrong_network" | "counterfeit" | "wrong_token" | "wrong_address" | "timing" | "engine";

/** Why a transfer doesn't count toward the request, or undefined when it does. */
export function transferIssue(o: Observation, r: PaymentRequest): { kind: ProblemKind; text: string } | undefined {
  if (o.status === "failed") return { kind: "failed", text: "The transaction failed on-chain: no tokens moved." };
  if (isWrongNetwork(o)) {
    return { kind: "wrong_network", text: `Sent on ${CHAIN_LABEL[o.chain] ?? o.chain}, not Ethereum. This request is Ethereum only, so the money never reached the request's address.` };
  }
  // A person who confirmed an unidentified payment for this request has already decided where it went.
  const personAssigned = o.attribution.kind === "request" && !o.attribution.claimed && o.attribution.by !== "System";
  if (!personAssigned && !sameAddress(o.to, r.receivingAddress)) return { kind: "wrong_address", text: "Sent to a different address from the one on this request." };
  if (!sameAddress(o.tokenContract, r.tokenContract)) {
    return o.tokenSymbol.toUpperCase().includes(r.token)
      ? { kind: "counterfeit", text: `Calls itself ${o.tokenSymbol}, but it doesn't come from ${ISSUER[r.token]}'s ${r.token} contract: it isn't real ${r.token}.` }
      : { kind: "wrong_token", text: `${o.tokenSymbol} is not the token requested (${r.token}).` };
  }
  // A transfer mined before the request existed can't be its payment without a person saying so.
  if (o.blockTime && Date.parse(o.blockTime) < Date.parse(r.createdAt) && !counted(r, o.key)) {
    return { kind: "timing", text: `Mined ${o.blockTime.slice(0, 10)}, before this request was created (${r.createdAt.slice(0, 10)}): probably a different payment.` };
  }
  const last = o.checks.at(-1);
  if (last?.problem) return { kind: "engine", text: `${last.label}: ${last.summary}` };
  return undefined;
}
export const transferProblem = (o: Observation, r: PaymentRequest) => transferIssue(o, r)?.text;

export interface RequestView {
  request: PaymentRequest;
  state: RequestState;
  /** Confirmed transfers in the official token that count toward the request. */
  received: string;
  /** Valid transfers still confirming. */
  pending: string;
  /** requested − received (negative: over-paid). */
  outstanding: string;
  counted: Observation[];
  flagged: { obs: Observation; problem: string; kind: ProblemKind }[];
  ambiguous: Observation[];
  maxConfirmations: number;
  /** Why the state is what it is, one line each, for the page. */
  reasons: string[];
  review?: "short" | "over" | "flagged" | "ambiguous";
  /** Over-paid by transfers that each equal the full amount: the customer paid twice. */
  duplicate?: boolean;
  /** A flagged transfer that can never count (counterfeit, wrong network, failed): it can't be marked paid. */
  blocked?: boolean;
  acknowledgedBy?: Decision;
}

export function deriveRequest(data: RequestsData, r: PaymentRequest, threshold: number): RequestView {
  const mine = Object.values(data.observations).filter((o) => o.attribution.kind === "request" && o.attribution.requestId === r.id)
    .sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? -1 : 1));
  const ambiguous = Object.values(data.observations).filter((o) => o.attribution.kind === "ambiguous" && o.attribution.candidates.includes(r.id));
  const flagged: RequestView["flagged"] = [];
  const counted: Observation[] = [];
  for (const o of mine) {
    if (dismissed(r, o.key)) continue;
    const p = transferIssue(o, r);
    if (p) flagged.push({ obs: o, problem: p.text, kind: p.kind }); else counted.push(o);
  }
  const confirmed = counted.filter((o) => o.blockNumber !== undefined && o.confirmations >= threshold);
  const confirming = counted.filter((o) => !confirmed.includes(o));
  const received = confirmed.reduce((s, o) => add(s, o.amount), "0");
  const pending = confirming.reduce((s, o) => add(s, o.amount), "0");
  const outstanding = sub(r.amount, received);
  const cmp = compareDecimal(received.replace(/^-/, ""), r.amount);
  const maxConfirmations = Math.max(0, ...confirming.map((o) => o.confirmations));
  const duplicate = confirmed.length > 1 && cmp > 0 && confirmed.every((o) => compareDecimal(o.amount, r.amount) === 0);
  const base = { request: r, received, pending, outstanding, counted, flagged, ambiguous, maxConfirmations, duplicate };
  const ack = acknowledgement(r);
  const reasons: string[] = [];

  // A transfer that counts and arrived after the request was marked paid reopens it: money came in twice.
  const late = ack ? counted.filter((o) => o.firstSeenAt > ack.at) : [];
  if (ack && late.length === 0) {
    reasons.push(ack.by === AUTO_RULE ? `Marked paid automatically by the matching rule: ${ack.note}`
      : ack.kind === "acknowledge" ? `Marked paid by ${ack.by}.${ack.note ? ` ${ack.note}` : ""}`
      : `Settled by ${ack.by}: ${ack.note}`);
    return { ...base, state: "completed", reasons, acknowledgedBy: ack };
  }
  if (flagged.length) {
    for (const f of flagged) reasons.push(`Transfer ${short(f.obs.hash)} doesn't count: ${f.problem}`);
    const blocked = flagged.some((f) => f.kind !== "timing");
    return { ...base, state: "needs_review", reasons, review: "flagged", blocked };
  }
  if (ambiguous.length) {
    for (const o of ambiguous) reasons.push(`Transfer ${short(o.hash)} could belong to this request or another one using the address.`);
    return { ...base, state: "needs_review", reasons, review: "ambiguous" };
  }
  if (confirming.length) {
    const inBlock = confirming.some((o) => o.blockNumber !== undefined);
    if (ack) reasons.push(`Another payment arrived after this request was marked paid.`);
    reasons.push(inBlock ? `${formatUsdc(pending)} ${r.token} is confirming (${maxConfirmations} of ${threshold}).` : `${formatUsdc(pending)} ${r.token} is seen but not yet in a block.`);
    return { ...base, state: inBlock ? "confirming" : "transfer_detected", reasons };
  }
  if (counted.length === 0) {
    reasons.push("No transfer counts toward this request yet.");
    return { ...base, state: "awaiting_payment", reasons };
  }
  if (cmp === 0) {
    reasons.push(`Confirmed transfers add up to exactly ${formatUsdc(r.amount)} ${r.token}. On-chain this is done; no one has marked it paid yet.`);
    return { ...base, state: "matched", reasons };
  }
  if (cmp < 0) {
    const waiting = [...r.decisions].reverse().find((d) => d.kind === "request_balance");
    reasons.push(`Received ${formatUsdc(received)} of ${formatUsdc(r.amount)} ${r.token}: ${formatUsdc(outstanding)} short.`);
    if (waiting) {
      reasons.push(`${waiting.by} asked the customer for the balance.`);
      return { ...base, state: "awaiting_payment", reasons, review: "short" };
    }
    return { ...base, state: "needs_review", reasons, review: "short" };
  }
  reasons.push(duplicate
    ? `Paid twice: ${confirmed.length} separate transfers of exactly ${formatUsdc(r.amount)} ${r.token}. ${formatUsdc(sub(received, r.amount))} ${r.token} more than the invoice.`
    : `Received ${formatUsdc(received)} ${r.token}, ${formatUsdc(sub(received, r.amount))} more than requested.`);
  return { ...base, state: "needs_review", reasons, review: "over" };
}

/** What the sender still has to send: requested − (confirmed + confirming), in the genuine token. "0" when nothing is due. */
export function amountToSend(v: RequestView): string {
  if (v.state === "completed") return "0";
  const due = sub(v.request.amount, add(v.received, v.pending));
  return due.startsWith("-") || compareDecimal(due, "0") === 0 ? "0" : due;
}

/** The likely cause of a short payment. An inference from the amounts and the sender, shown as one. */
export function shortfallCause(data: RequestsData, v: RequestView): { cause: string; basis: string[] } | undefined {
  if (v.review !== "short" || v.counted.length === 0) return undefined;
  const short = v.outstanding;
  const pct = percentOf(short, v.request.amount);
  const basis = [`The shortfall is ${formatUsdc(short)} ${v.request.token}, ${pct}% of the invoice.`];
  const exchange = v.counted.map((o) => senderLabel(data, o.from)).find((l) => l?.kind === "exchange");
  if (exchange) basis.push(`The transfer came from ${exchange.label}. Exchanges often take their withdrawal fee out of the amount sent.`);
  if (compareDecimal(pct, "2.0") <= 0) {
    return { cause: "Fees deducted before sending (by the customer's exchange, wallet or bank)", basis };
  }
  return { cause: "A partial payment: the customer may be paying in instalments or disputing part of the invoice", basis };
}

// ---------- decisions ----------

/** Which decisions make sense in a view. The server enforces the same list. */
export function allowedDecisions(v: RequestView, data?: RequestsData): DecisionKind[] {
  if (v.state === "completed") return [];
  if (v.review === "flagged") {
    if (v.flagged.some((f) => f.kind === "timing")) return ["count_transfer", "dismiss_transfer"];
    if (data && v.flagged.some((f) => f.kind === "wrong_network" && walletOf(data, f.obs.chain, f.obs.to, f.obs.demo))) return ["accept_other_network", "dismiss_transfer"];
    return ["dismiss_transfer"];
  }
  if (v.review === "ambiguous") return ["assign_transfer"];
  if (v.state === "matched") return ["acknowledge"];
  if (v.review === "short") return v.state === "needs_review" ? ["request_balance", "accept_short"] : ["accept_short"];
  if (v.review === "over") return ["refund_excess", "accept_over"];
  return [];
}

export interface DecisionInput { kind: DecisionKind; note: string; observationKey?: string }

export function decide(data: RequestsData, requestId: string, input: DecisionInput, o: { now: string; by: string; threshold: number; check?: Check }):
  { data: RequestsData; error?: string } {
  const r = data.requests[requestId];
  if (!r) return { data, error: "No such request." };
  const v = deriveRequest(data, r, o.threshold);
  if (!allowedDecisions(v, data).includes(input.kind)) return { data, error: `Not possible while the request is "${v.state.replace(/_/g, " ")}".` };
  const note = input.note.trim();
  if (input.kind !== "acknowledge" && !note) return { data, error: "Say why: a note is required for this decision." };
  if (note.length > 1000) return { data, error: "Keep the note under 1,000 characters." };
  const observations = { ...data.observations };
  if (input.kind === "dismiss_transfer") {
    if (!v.flagged.some((f) => f.obs.key === input.observationKey)) return { data, error: "Pick one of this request's flagged transfers." };
  }
  if (input.kind === "count_transfer") {
    const f = v.flagged.find((x) => x.obs.key === input.observationKey);
    if (!f || f.kind !== "timing") return { data, error: "Only a transfer flagged for its timing can be counted; a fake token or failed transaction never counts." };
  }
  if (input.kind === "accept_other_network") {
    const f = v.flagged.find((x) => x.obs.key === input.observationKey);
    if (!f || f.kind !== "wrong_network" || !walletOf(data, f.obs.chain, f.obs.to, f.obs.demo)) {
      return { data, error: "Only a wrong-network payment that landed in one of your own wallets can be counted." };
    }
  }
  if (input.kind === "assign_transfer") {
    const obs = v.ambiguous.find((a) => a.key === input.observationKey);
    if (!obs) return { data, error: "Pick one of the transfers waiting for a request." };
    const assigned: Observation = { ...obs, attributionHistory: [...(obs.attributionHistory ?? []), obs.attribution],
      attribution: { kind: "request", requestId, by: o.by, at: o.now, reason: `Assigned by ${o.by}: ${note}` } };
    // Re-check against the request it now belongs to: the earlier check had no customer to go on.
    observations[obs.key] = o.check ? withCheck(assigned, { ...data, observations }, o.check) : assigned;
  }
  const decision: Decision = { at: o.now, by: o.by, kind: input.kind, note, ...(input.observationKey ? { observationKey: input.observationKey } : {}) };
  const t = r.token;
  const flaggedObs = v.flagged.find((x) => x.obs.key === input.observationKey)?.obs;
  const text: Record<DecisionKind, string> = {
    acknowledge: `Marked paid: ${formatUsdc(r.amount)} ${t} credited for ${r.invoiceRef}.${note ? ` ${note}` : ""}`,
    accept_short: `Accepted ${formatUsdc(v.received)} of ${formatUsdc(r.amount)} ${t} as settled. ${note}`,
    accept_over: `Accepted ${formatUsdc(v.received)} ${t} (over by ${formatUsdc(sub(v.received, r.amount))}), kept as credit. ${note}`,
    refund_excess: `Invoice paid; ${formatUsdc(sub(v.received, r.amount))} ${t} to be refunded by treasury. ${note}`,
    request_balance: `Waiting for the balance of ${formatUsdc(v.outstanding)} ${t}. ${note}`,
    dismiss_transfer: `Marked transfer ${short(input.observationKey?.split(":")[1] ?? "")} as not a payment for this request. ${note}`,
    count_transfer: `Counted transfer ${short(input.observationKey?.split(":")[1] ?? "")} toward this request although it was mined before the request was created. ${note}`,
    accept_other_network: `Counted the ${flaggedObs ? `${formatUsdc(flaggedObs.amount)} ${flaggedObs.tokenSymbol} on ${CHAIN_LABEL[flaggedObs.chain]}` : "wrong-network payment"} as payment for ${r.invoiceRef}: it is in our own wallet there. ${note}`,
    assign_transfer: `Assigned transfer ${short(input.observationKey?.split(":")[1] ?? "")} to ${requestId}. ${note}`,
  };
  const updated: PaymentRequest = { ...r, decisions: [...r.decisions, decision],
    activity: [...r.activity, { at: o.now, actor: o.by, kind: SETTLING.includes(input.kind) ? "acknowledged" : "decision", text: text[input.kind].trim(), observationKey: input.observationKey }] };
  let requests = { ...data.requests, [requestId]: updated };
  // An assigned transfer leaves the other candidates' review: say so on each of them.
  if (input.kind === "assign_transfer") {
    const obs = data.observations[input.observationKey!];
    if (obs.attribution.kind === "ambiguous") {
      for (const other of obs.attribution.candidates.filter((c) => c !== requestId)) {
        const oreq = requests[other];
        if (oreq) requests = { ...requests, [other]: { ...oreq, activity: [...oreq.activity, { at: o.now, actor: o.by, kind: "decision", observationKey: obs.key, text: `Transfer ${short(obs.hash)} was assigned to ${requestId}, not this request.` }] } };
      }
    }
  }
  return { data: { ...data, requests, observations } };
}

// ---------- unidentified payments ----------

export interface MatchSignal { label: string; points: number; ok: boolean }
export interface MatchSuggestion { request: PaymentRequest; score: number; confidence: "Strong" | "Possible" | "Weak"; signals: MatchSignal[] }

/**
 * Which open request an unidentified payment most likely pays, scored from evidence a person can
 * check. A score out of 100, not a probability. It is only a suggestion: a person confirms it.
 * Never offered for a different token or network: those can't pay the request.
 */
export function suggestMatches(data: RequestsData, obs: Observation, threshold: number): MatchSuggestion[] {
  const open = Object.values(data.requests).filter((r) => r.demo === obs.demo && r.chain === obs.chain && sameAddress(r.tokenContract, obs.tokenContract) && !acknowledgement(r));
  const pastSenders = (customer: string) => Object.values(data.observations).filter((x) => x.key !== obs.key && x.attribution.kind === "request"
    && data.requests[x.attribution.requestId]?.customerRef === customer && !transferProblem(x, data.requests[x.attribution.requestId])).map((x) => x.from);
  const out = open.map((r) => {
    const v = deriveRequest(data, r, threshold);
    const due = amountToSend(v);
    const exact = compareDecimal(obs.amount, due) === 0 && due !== "0";
    const sameAmount = open.filter((x) => compareDecimal(obs.amount, x.amount) === 0).length;
    const knownSender = pastSenders(r.customerRef).some((f) => sameAddress(f, obs.from));
    const after = !obs.blockTime || Date.parse(obs.blockTime) >= Date.parse(r.createdAt);
    const signals: MatchSignal[] = [
      { label: exact ? `Amount is exactly what ${r.customerRef} owes (${formatUsdc(due)} ${r.token})` : `Amount differs from what ${r.customerRef} owes (${formatUsdc(due)} ${r.token})`, points: exact ? 40 : 0, ok: exact },
      { label: knownSender ? `Sent from an address ${r.customerRef} has paid from before` : `Sender not seen paying ${r.customerRef} before`, points: knownSender ? 35 : 0, ok: knownSender },
      { label: exact && sameAmount === 1 ? "No other open request is for this amount" : exact ? `${sameAmount} open requests are for this amount` : "Other requests may be for this amount", points: exact && sameAmount === 1 ? 15 : 0, ok: exact && sameAmount === 1 },
      { label: after ? `Paid after ${r.invoiceRef} was sent` : `Paid before ${r.invoiceRef} was sent`, points: after ? 10 : 0, ok: after },
    ];
    const score = signals.reduce((s, x) => s + x.points, 0);
    return { request: r, score, confidence: (score >= 80 ? "Strong" : score >= 50 ? "Possible" : "Weak") as MatchSuggestion["confidence"], signals };
  });
  // Only suggestions with real evidence (the amount or the sender), never timing alone.
  return out.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score || (a.request.createdAt < b.request.createdAt ? -1 : 1)).slice(0, 3);
}

/** A person confirms which request an unidentified payment pays. The system's earlier "unidentified" stays in the history. */
export function assignUnmatched(data: RequestsData, key: string, requestId: string, note: string, o: { now: string; by: string; threshold: number; check?: Check }):
  { data: RequestsData; error?: string } {
  const obs = data.observations[key];
  const r = data.requests[requestId];
  if (!obs || obs.attribution.kind !== "none") return { data, error: "That payment is already matched." };
  if (!r || r.demo !== obs.demo || acknowledgement(r)) return { data, error: "Pick an open request." };
  if (!sameAddress(obs.tokenContract, r.tokenContract) || obs.chain !== r.chain) return { data, error: `This payment isn't ${r.token} on Ethereum, so it can't pay ${r.id}.` };
  const clean = note.trim();
  if (!clean) return { data, error: "Say why: a note is required for this decision." };
  if (clean.length > 1000) return { data, error: "Keep the note under 1,000 characters." };
  let next: Observation = { ...obs, attributionHistory: [...(obs.attributionHistory ?? []), obs.attribution],
    attribution: { kind: "request", requestId, by: o.by, at: o.now, reason: `Confirmed by ${o.by}: ${clean}` } };
  const requests = { ...data.requests, [requestId]: { ...r, decisions: [...r.decisions, { at: o.now, by: o.by, kind: "assign_transfer" as const, note: clean, observationKey: key }],
    activity: [...r.activity, { at: o.now, actor: o.by, kind: "decision" as const, observationKey: key,
      text: `Matched the unidentified ${formatUsdc(obs.amount)} ${obs.tokenSymbol} payment ${short(obs.hash)} to ${requestId}. ${clean}` }] } };
  if (o.check) next = withCheck(next, { ...data, requests }, o.check);
  return { data: { ...data, requests, observations: { ...data.observations, [key]: next } } };
}

// ---------- the sender's address check ----------

/**
 * Compare an address a sender pasted from their wallet with the request's. A "look-alike" shares the
 * first and last characters but differs in the middle: the pattern address-poisoning scams rely on,
 * because people check only the ends.
 */
export function compareAddress(input: string, real: string): AddressCheck["result"] {
  const a = input.trim();
  if (!EVM_ADDRESS.test(a)) return "invalid";
  if (sameAddress(a, real)) return "match";
  const x = a.toLowerCase().slice(2), y = real.toLowerCase().slice(2);
  return x.slice(0, 4) === y.slice(0, 4) || x.slice(-4) === y.slice(-4) ? "lookalike" : "different";
}

export function recordAddressCheck(data: RequestsData, requestId: string, input: string, now: string): { data: RequestsData; result: AddressCheck["result"] } {
  const r = data.requests[requestId];
  const result = compareAddress(input, r.receivingAddress);
  // Keep only what's needed: the verdict, and the address only when it is a look-alike (evidence of an attack).
  const check: AddressCheck = { at: now, result, address: result === "lookalike" ? input.trim() : "" };
  const checks = [...(r.addressChecks ?? []), check].slice(-20);
  const activity = result === "lookalike"
    ? [...r.activity, { at: now, actor: "Payment page", kind: "check" as const,
      text: `The sender pasted a look-alike address (${input.trim().slice(0, 8)}…${input.trim().slice(-6)}) into the payment page's checker and was told not to send. Possible address poisoning.` }]
    : r.activity;
  return { data: { ...data, requests: { ...data.requests, [requestId]: { ...r, addressChecks: checks, activity } } }, result };
}

export function setOwner(data: RequestsData, requestId: string, owner: string, o: { now: string; by: string }): RequestsData {
  const r = data.requests[requestId];
  const clean = owner.trim().slice(0, 60);
  return { ...data, requests: { ...data.requests, [requestId]: { ...r, owner: clean || undefined,
    activity: [...r.activity, { at: o.now, actor: o.by, kind: "owner", text: clean ? `Owner set to ${clean}.` : "Owner cleared." }] } } };
}

export function addNote(data: RequestsData, requestId: string, text: string, o: { now: string; by: string }): RequestsData {
  const r = data.requests[requestId];
  return { ...data, requests: { ...data.requests, [requestId]: { ...r,
    activity: [...r.activity, { at: o.now, actor: o.by, kind: "note", text: text.trim().slice(0, 1000) }] } } };
}

/** Transfers that no open request claims, for the inbox's "unidentified" list. */
export const unattributed = (data: RequestsData) =>
  Object.values(data.observations).filter((o) => o.attribution.kind === "none");
