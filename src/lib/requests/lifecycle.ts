// The request lifecycle as pure functions: create, ingest a transfer event, attribute it to a
// request, derive the state, record a decision. No clock, no network: callers pass `now` and the
// engine check, so the same inputs always give the same records (and tests can replay them).

import { sameAddress } from "../address";
import { compareDecimal, isDecimal } from "../decimal";
import { add, sub } from "../payments/money";
import type {
  Activity, Attribution, CheckSnapshot, Decision, DecisionKind, Observation, PaymentRequest, RequestState, RequestsData, TransferEvent,
} from "./types";
import { REQUEST_CHAIN, REQUEST_TOKEN, USDC_DECIMALS } from "./types";

export const obsKey = (chain: string, hash: string, logIndex: number) => `${chain}:${hash.toLowerCase()}:${logIndex}`;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// ---------- creating a request ----------

export interface NewRequestInput {
  customerRef: string;
  invoiceRef: string;
  amount: string;
  receivingAddress: string;
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
  else if ((amt.split(".")[1] ?? "").length > USDC_DECIMALS) e.amount = `USDC has ${USDC_DECIMALS} decimal places at most.`;
  else if (compareDecimal(amt, "0") <= 0) e.amount = "Must be more than zero.";
  else if (amt.split(".")[0].replace(/^0+/, "").length > 12) e.amount = "Too large for one request.";
  if (!EVM_ADDRESS.test((i.receivingAddress ?? "").trim())) e.receivingAddress = "An Ethereum address: 0x followed by 40 hex characters.";
  return e;
}

export function createRequest(data: RequestsData, i: NewRequestInput, o: { now: string; by: string; demo: boolean; publicId: string; tokenContract: string; id?: string }):
  { data: RequestsData; request: PaymentRequest } {
  const id = o.id ?? `REQ-${data.nextNumber}`;
  if (data.requests[id]) throw new Error(`Request ${id} already exists`);
  const request: PaymentRequest = {
    id, publicId: o.publicId, demo: o.demo,
    customerRef: i.customerRef.trim(), invoiceRef: i.invoiceRef.trim(), amount: normaliseAmount(i.amount.trim()),
    token: REQUEST_TOKEN, chain: REQUEST_CHAIN, tokenContract: o.tokenContract.toLowerCase(),
    receivingAddress: i.receivingAddress.trim(),
    createdAt: o.now, createdBy: o.by, decisions: [],
    activity: [{ at: o.now, actor: o.by, kind: "created", text: `Requested ${formatUsdc(normaliseAmount(i.amount.trim()))} USDC on Ethereum for ${i.invoiceRef.trim()}.` }],
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
  const [int, frac = ""] = a.split(".");
  if (frac.length > decimals) throw new Error("More decimal places than the token has");
  return (BigInt(int + frac.padEnd(decimals, "0"))).toString();
}

// ---------- attribution: which request does a transfer belong to? ----------


/**
 * Deterministic and conservative:
 *  - only open requests whose receiving address is the transfer's destination are candidates;
 *  - one candidate: it is that request's transfer (the address identifies it);
 *  - several candidates: never decided by amount alone. The transfer waits for a person, and an
 *    exact-amount candidate is only offered as a hint.
 */
export function attribute(data: RequestsData, ev: Pick<TransferEvent, "to" | "amount" | "chain">, at: string): Attribution {
  const candidates = Object.values(data.requests)
    .filter((r) => r.chain === ev.chain && sameAddress(r.receivingAddress, ev.to) && !acknowledgement(r))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (candidates.length === 0) return { kind: "none", reason: "No open request uses this receiving address.", at };
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

/**
 * The single entry point for transfer events, simulated or live. A repeat delivery of the same
 * transfer (chain + hash + log index) never creates a second payment: identical → "duplicate";
 * newer block data → "updated". Confirmations never go backwards.
 */
export function ingest(data: RequestsData, ev: TransferEvent, now: string, actor: string, check: Check, threshold: number): IngestResult {
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
    const crossed = prev.confirmations < threshold && confirmations >= threshold;
    for (const id of owners) {
      note(id, { at: now, actor, kind: "confirmations", observationKey: key,
        text: prev.blockNumber === undefined && block !== undefined
          ? `Included in block ${block.toLocaleString("en-US")} (${confirmations} of ${threshold} confirmations).`
          : crossed ? `Confirmed: ${confirmations} of ${threshold} confirmations.` : `${confirmations} of ${threshold} confirmations.` });
    }
    next = withCheck(next, { ...data, requests }, check);
    return { data: { ...data, requests, observations: { ...data.observations, [key]: next } }, outcome: "updated", key };
  }

  const attribution = attribute(data, ev, now);
  let obs: Observation = {
    key, source: ev.source, demo: ev.demo, chain: ev.chain, hash: ev.hash.toLowerCase(), logIndex: ev.logIndex,
    from: ev.from, to: ev.to, tokenContract: ev.tokenContract.toLowerCase(), tokenSymbol: ev.tokenSymbol, amount: ev.amount,
    status: ev.status, blockNumber: ev.blockNumber, blockTime: ev.blockTime, confirmations: ev.confirmations,
    firstSeenAt: now, lastUpdatedAt: now, attribution, checks: [],
  };
  const where = ev.blockNumber === undefined ? "not yet in a block" : `in block ${ev.blockNumber.toLocaleString("en-US")}`;
  const what = `${formatUsdc(ev.amount)} ${ev.tokenSymbol} transfer ${short(ev.hash)} to the receiving address, ${where}.`;
  if (attribution.kind === "request") {
    note(attribution.requestId, { at: now, actor, kind: "transfer", observationKey: key, text: `Detected a ${what}` });
    note(attribution.requestId, { at: now, actor: "System", kind: "match", observationKey: key, text: `Attributed to ${attribution.requestId}: ${attribution.reason}` });
  } else if (attribution.kind === "ambiguous") {
    for (const id of attribution.candidates) note(id, { at: now, actor, kind: "transfer", observationKey: key, text: `Detected a ${what} Not attributed: ${attribution.reason}` });
  }
  obs = withCheck(obs, { ...data, requests }, check);
  return { data: { ...data, requests, observations: { ...data.observations, [key]: obs } }, outcome: "new", key };
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
  const sig = (c: CheckSnapshot) => JSON.stringify([c.code, c.problem, c.evidence.map((e) => [e.id, e.status, e.value, e.detail])]);
  if (last && sig(last) === sig(snap)) return obs;
  return { ...obs, checks: [...obs.checks, snap] };
}

const ownersOf = (o: Observation): string[] =>
  o.attribution.kind === "request" ? [o.attribution.requestId] : o.attribution.kind === "ambiguous" ? o.attribution.candidates : [];

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

// ---------- deriving the state ----------

export const acknowledgement = (r: PaymentRequest): Decision | undefined =>
  r.decisions.find((d) => d.kind === "acknowledge" || d.kind === "accept_short" || d.kind === "accept_over");

const dismissed = (r: PaymentRequest, key: string) => r.decisions.some((d) => d.kind === "dismiss_transfer" && d.observationKey === key);

/** A transfer counts toward the request only if it is a successful transfer of the request's official token, not flagged. */
export function transferProblem(o: Observation, r: PaymentRequest): string | undefined {
  if (o.status === "failed") return "The transaction failed on-chain: no tokens moved.";
  if (!sameAddress(o.tokenContract, r.tokenContract)) {
    return o.tokenSymbol.toUpperCase().includes("USDC")
      ? `Calls itself ${o.tokenSymbol}, but its contract isn't Circle's USDC contract.`
      : `${o.tokenSymbol} is not the token requested (USDC).`;
  }
  // A transfer mined before the request existed can't be its payment without a person saying so.
  if (o.blockTime && Date.parse(o.blockTime) < Date.parse(r.createdAt)) {
    return `Mined ${o.blockTime.slice(0, 10)}, before this request was created (${r.createdAt.slice(0, 10)}): probably a different payment.`;
  }
  const last = o.checks.at(-1);
  if (last?.problem) return `${last.label}: ${last.summary}`;
  return undefined;
}

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
  flagged: { obs: Observation; problem: string }[];
  ambiguous: Observation[];
  maxConfirmations: number;
  /** Why the state is what it is, one line each, for the page. */
  reasons: string[];
  review?: "short" | "over" | "flagged" | "ambiguous";
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
    const p = transferProblem(o, r);
    if (p) flagged.push({ obs: o, problem: p }); else counted.push(o);
  }
  const confirmed = counted.filter((o) => o.blockNumber !== undefined && o.confirmations >= threshold);
  const confirming = counted.filter((o) => !confirmed.includes(o));
  const received = confirmed.reduce((s, o) => add(s, o.amount), "0");
  const pending = confirming.reduce((s, o) => add(s, o.amount), "0");
  const outstanding = sub(r.amount, received);
  const cmp = compareDecimal(received.replace(/^-/, ""), r.amount);
  const maxConfirmations = Math.max(0, ...confirming.map((o) => o.confirmations));
  const base = { request: r, received, pending, outstanding, counted, flagged, ambiguous, maxConfirmations };
  const ack = acknowledgement(r);
  const reasons: string[] = [];

  if (ack) {
    reasons.push(ack.kind === "acknowledge" ? `Acknowledged by ${ack.by}.` : `Accepted by ${ack.by} as settled: ${ack.note}`);
    return { ...base, state: "completed", reasons, acknowledgedBy: ack };
  }
  if (flagged.length) {
    for (const f of flagged) reasons.push(`Transfer ${short(f.obs.hash)} doesn't count: ${f.problem}`);
    return { ...base, state: "needs_review", reasons, review: "flagged" };
  }
  if (ambiguous.length) {
    for (const o of ambiguous) reasons.push(`Transfer ${short(o.hash)} could belong to this request or another one sharing the address.`);
    return { ...base, state: "needs_review", reasons, review: "ambiguous" };
  }
  if (confirming.length) {
    const inBlock = confirming.some((o) => o.blockNumber !== undefined);
    reasons.push(inBlock ? `${formatUsdc(pending)} USDC is confirming (${maxConfirmations} of ${threshold}).` : `${formatUsdc(pending)} USDC is seen but not yet in a block.`);
    return { ...base, state: inBlock ? "confirming" : "transfer_detected", reasons };
  }
  if (counted.length === 0) {
    reasons.push("No transfer counts toward this request yet.");
    return { ...base, state: "awaiting_payment", reasons };
  }
  if (cmp === 0) {
    reasons.push(`Confirmed transfers add up to exactly ${formatUsdc(r.amount)} USDC. On-chain this is done; the business hasn't acknowledged it yet.`);
    return { ...base, state: "matched", reasons };
  }
  if (cmp < 0) {
    const waiting = [...r.decisions].reverse().find((d) => d.kind === "request_balance");
    reasons.push(`Received ${formatUsdc(received)} of ${formatUsdc(r.amount)} USDC: ${formatUsdc(outstanding)} short.`);
    if (waiting) {
      reasons.push(`${waiting.by} asked the customer for the balance.`);
      return { ...base, state: "awaiting_payment", reasons, review: "short" };
    }
    return { ...base, state: "needs_review", reasons, review: "short" };
  }
  reasons.push(`Received ${formatUsdc(received)} USDC, ${formatUsdc(sub(received, r.amount))} more than requested.`);
  return { ...base, state: "needs_review", reasons, review: "over" };
}

// ---------- decisions ----------

/** Which decisions make sense in a view. The server enforces the same list. */
export function allowedDecisions(v: RequestView): DecisionKind[] {
  if (v.state === "completed") return [];
  if (v.review === "flagged") return ["dismiss_transfer"];
  if (v.review === "ambiguous") return ["assign_transfer"];
  if (v.state === "matched") return ["acknowledge"];
  if (v.review === "short") return v.state === "needs_review" ? ["request_balance", "accept_short"] : ["accept_short"];
  if (v.review === "over") return ["accept_over"];
  return [];
}

export interface DecisionInput { kind: DecisionKind; note: string; observationKey?: string }

export function decide(data: RequestsData, requestId: string, input: DecisionInput, o: { now: string; by: string; threshold: number; check?: Check }):
  { data: RequestsData; error?: string } {
  const r = data.requests[requestId];
  if (!r) return { data, error: "No such request." };
  const v = deriveRequest(data, r, o.threshold);
  if (!allowedDecisions(v).includes(input.kind)) return { data, error: `Not possible while the request is "${v.state.replace(/_/g, " ")}".` };
  const note = input.note.trim();
  if (input.kind !== "acknowledge" && !note) return { data, error: "Say why: a note is required for this decision." };
  if (note.length > 1000) return { data, error: "Keep the note under 1,000 characters." };
  const observations = { ...data.observations };
  if (input.kind === "dismiss_transfer") {
    if (!v.flagged.some((f) => f.obs.key === input.observationKey)) return { data, error: "Pick one of this request's flagged transfers." };
  }
  if (input.kind === "assign_transfer") {
    const obs = v.ambiguous.find((a) => a.key === input.observationKey);
    if (!obs) return { data, error: "Pick one of the transfers waiting for a request." };
    const assigned: Observation = { ...obs, attribution: { kind: "request", requestId, by: o.by, at: o.now, reason: `Assigned by ${o.by}: ${note}` } };
    // Re-check against the request it now belongs to: the earlier check had no customer to go on.
    observations[obs.key] = o.check ? withCheck(assigned, { ...data, observations }, o.check) : assigned;
  }
  const decision: Decision = { at: o.now, by: o.by, kind: input.kind, note, ...(input.observationKey ? { observationKey: input.observationKey } : {}) };
  const text: Record<DecisionKind, string> = {
    acknowledge: `Acknowledged: the business has credited ${formatUsdc(r.amount)} USDC for ${r.invoiceRef}.${note ? ` ${note}` : ""}`,
    accept_short: `Accepted ${formatUsdc(v.received)} of ${formatUsdc(r.amount)} USDC as settled. ${note}`,
    accept_over: `Accepted ${formatUsdc(v.received)} USDC (over by ${formatUsdc(sub(v.received, r.amount))}). ${note}`,
    request_balance: `Waiting for the balance of ${formatUsdc(v.outstanding)} USDC. ${note}`,
    dismiss_transfer: `Marked transfer ${short(input.observationKey?.split(":")[1] ?? "")} as not a payment for this request. ${note}`,
    assign_transfer: `Assigned transfer ${short(input.observationKey?.split(":")[1] ?? "")} to ${requestId}. ${note}`,
  };
  const updated: PaymentRequest = { ...r, decisions: [...r.decisions, decision],
    activity: [...r.activity, { at: o.now, actor: o.by, kind: input.kind === "acknowledge" || input.kind.startsWith("accept") ? "acknowledged" : "decision", text: text[input.kind].trim(), observationKey: input.observationKey }] };
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

/** Transfers that no open request claims, for the inbox's "unmatched" list. */
export const unattributed = (data: RequestsData) =>
  Object.values(data.observations).filter((o) => o.attribution.kind === "none");
