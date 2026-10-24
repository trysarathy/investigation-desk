// Three-way matching (spec 23 Oct): instruction <-> on-chain transfer <-> provider record, then
// bank record, ledger entry and later returns onto the same canonical payment.
//
// Automatic links use exact identifiers only:
//   instruction <-> provider: the provider's merchant reference equals the instruction ID, or the
//     instruction names the provider payment ID;
//   -> on-chain transfer: chain + tx hash + transfer index. A hash with no index links only when
//     that transaction carries exactly one token transfer, so the hash alone identifies it;
//   -> bank: the bank row's instruction ID or provider payment ID column;
//   -> ledger: chain + tx hash + transfer index of the linked transfer.
// Several candidates, identifiers that disagree, or a record that arrived twice with different
// content all go to review. Amount, time and address similarity rank candidates and nothing more.
// Pure: no I/O, same input, same output.

import { createHash } from "node:crypto";
import { canonicalAddress, sameAddress } from "../address";
import { compareDecimal, isDecimal } from "../decimal";
import { displayAmount } from "../format";
import { CHAIN_NAMES, type Chain } from "../types";
import type {
  BankRecord, Candidate, CanonicalPayment, ChainLookupSummary, ChainTransferRecord, Direction, InstructionRecord, Leg, LegName, Link,
  LedgerEntryRecord, LedgerLink, LinkBasis, MatchResult, PaymentRecord, PaymentRedirect, ProviderRecord, ReviewDecision, ReviewItem, ReviewReason,
  ReviewTarget,
} from "./types";

export interface MatchInput {
  instructions: InstructionRecord[];
  provider: ProviderRecord[];
  bank: BankRecord[];
  chain: ChainTransferRecord[];
  lookups: ChainLookupSummary[];
  ledger?: LedgerEntryRecord[];
  /** Payment IDs from earlier runs, by anchor key. An assigned ID is never changed. */
  assigned?: Record<string, string>;
  /** Redirects from earlier runs. A retired ID keeps its last known redirect until a newer one. */
  redirects?: Record<string, PaymentRedirect>;
  /** Review resolutions made in the app. The latest decision per record wins. */
  decisions?: ReviewDecision[];
  /**
   * The company's deposit addresses (File A). A transfer to one of them is inbound: only the
   * deposit ledger (File B) can be its ledger leg. Anything else is outbound: only the payout ledger.
   * An address counts only while assigned (assignedAt ≤ the transfer's block time < retiredAt); a
   * transfer with no block time can't be checked against those dates, so its direction is unknown.
   * Undefined means File A isn't loaded: a deposit row can't be classified, so its leg is unknown.
   */
  depositAddresses?: DepositAddress[];
  /** Ledger links from the previous run, so a link whose direction flips goes to review, not away. */
  previousLedgerLinks?: LedgerLink[];
}

/** The stable key a decision is recorded against (see ReviewDecision). */
export function recordKeyOf(r: PaymentRecord): string {
  if (r.kind === "provider") return `provider:${r.provider}:${r.providerPaymentId}`;
  if (r.kind === "ledger") return `ledger:${r.ledger}:${r.entryId}`;
  return r.recordId;
}

// ---- Grouping: one logical record per original identifier ----

interface Group<T> {
  key: string;
  /** Every version, oldest event first. */
  records: T[];
  /** Fields every version agrees on. */
  view: Partial<T>;
  /** Fields the versions disagree on. Non-empty means the record needs review. */
  conflicts: string[];
}

function groupBy<T extends PaymentRecord>(records: T[], key: (r: T) => string, fields: (keyof T)[]): Group<T>[] {
  const map = new Map<string, T[]>();
  for (const r of records) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, rs]) => {
    const sorted = [...rs].sort(byEventTime);
    const view: Partial<T> = {};
    const conflicts: string[] = [];
    for (const f of fields) {
      if (sorted.every((r) => sameValue(String(f), r[f], sorted[0][f]))) view[f] = sorted[0][f];
      else conflicts.push(String(f));
    }
    return { key: k, records: sorted, view, conflicts };
  });
}

// Amounts are compared as decimals: 100.00 and 100.000000 are the same amount.
const DECIMAL_FIELDS = new Set(["amount", "fee"]);
const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;
function sameValue(field: string, a: unknown, b: unknown): boolean {
  if (DECIMAL_FIELDS.has(field) && typeof a === "string" && typeof b === "string" && SIGNED_DECIMAL.test(a) && SIGNED_DECIMAL.test(b)) {
    const [sa, ma] = [a.startsWith("-"), a.replace(/^-/, "")];
    const [sb, mb] = [b.startsWith("-"), b.replace(/^-/, "")];
    if (compareDecimal(ma, mb) !== 0) return false;
    return sa === sb || compareDecimal(ma, "0") === 0;
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const byEventTime = (a: PaymentRecord, b: PaymentRecord) =>
  (a.eventTime ? Date.parse(a.eventTime) : Infinity) - (b.eventTime ? Date.parse(b.eventTime) : Infinity) || (a.recordId < b.recordId ? -1 : 1);

const INSTRUCTION_FIELDS: (keyof InstructionRecord)[] = ["chain", "token", "toAddress", "amount", "txHash", "transferIndex", "providerPaymentId", "dueBy"];
// Status and event time may change between reports (a status history); these may not.
const PROVIDER_FIELDS: (keyof ProviderRecord)[] = ["merchantReference", "txHash", "chain", "transferIndex", "amount", "currency"];
const LEDGER_FIELDS: (keyof LedgerEntryRecord)[] = ["amount", "currency", "instructionId", "providerPaymentId", "chain", "txHash", "transferIndex", "reverses"];

type InsGroup = Group<InstructionRecord>;
type ProvGroup = Group<ProviderRecord> & { provider: string; providerPaymentId: string };
type LedgerGroup = Group<LedgerEntryRecord> & { recordKey: string };

/** Items by key, in input order: joins look up instead of scanning (a scan per record was quadratic). */
function indexBy<T>(items: T[], keys: (x: T) => (string | undefined)[]): Map<string, T[]> {
  const ix = new Map<string, T[]>();
  for (const x of items) {
    for (const k of new Set(keys(x))) {
      if (k === undefined) continue;
      const l = ix.get(k);
      if (l) l.push(x); else ix.set(k, [x]);
    }
  }
  return ix;
}

// ---- Similarity: ranks candidates, never links ----

interface Traits { amount?: string; asset?: string; address?: string; chain?: string; time?: string }

const abs = (a?: string) => (a === undefined ? undefined : a.replace(/^-/, ""));
const traits = (r: PaymentRecord): Traits => {
  switch (r.kind) {
    case "instruction": return { amount: r.amount, asset: r.token, address: r.toAddress, chain: r.chain, time: r.eventTime };
    case "provider": return { amount: abs(r.amount), asset: r.currency, chain: r.chain, time: r.eventTime };
    case "chain_transfer": return { amount: r.amount, asset: r.token, address: r.to, chain: r.chain, time: r.eventTime };
    case "bank": return { amount: r.amount, asset: r.currency, time: r.eventTime };
    case "ledger": return { amount: r.amount, chain: r.chain, time: r.eventTime };
  }
};

function similarity(a: Traits, b: Traits): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (a.amount && b.amount && isDecimal(a.amount) && isDecimal(b.amount) && compareDecimal(a.amount, b.amount) === 0) {
    score += 3; reasons.push(`same amount (${displayAmount(a.amount)})`);
  }
  if (a.address && b.address && sameAddress(a.address, b.address)) { score += 3; reasons.push("same destination address"); }
  if (a.asset && b.asset && a.asset.toUpperCase().startsWith(b.asset.toUpperCase().slice(0, 4))) { score += 1; reasons.push(`same asset (${b.asset})`); }
  if (a.chain && b.chain && a.chain === b.chain) { score += 1; reasons.push(`same chain (${CHAIN_NAMES[a.chain as keyof typeof CHAIN_NAMES] ?? a.chain})`); }
  if (a.time && b.time) {
    const hours = Math.abs(Date.parse(a.time) - Date.parse(b.time)) / 3_600_000;
    if (hours <= 1) { score += 2; reasons.push("within an hour"); }
    else if (hours <= 24) { score += 1; reasons.push(`${Math.round(hours)} hours apart`); }
  }
  return { score, reasons };
}

/** Reviews list every candidate; suggestions keep the best five. */
function rank(anchor: PaymentRecord | undefined, pool: PaymentRecord[], max = Infinity): Candidate[] {
  if (!anchor) return pool.slice(0, max).map((r) => ({ recordId: r.recordId, score: 0, reasons: [] }));
  const t = traits(anchor);
  return pool.map((r) => ({ recordId: r.recordId, ...similarity(t, traits(r)) }))
    .sort((a, b) => b.score - a.score || (a.recordId < b.recordId ? -1 : 1)).slice(0, max);
}

const suggestionsFrom = (anchor: PaymentRecord | undefined, pool: PaymentRecord[]) => rank(anchor, pool).filter((c) => c.score > 0).slice(0, 5);

const canonDecimal = (s?: string) => (s && isDecimal(s) ? `${s.split(".")[0].replace(/^0+(?=\d)/, "")}.${(s.split(".")[1] ?? "").replace(/0+$/, "")}` : undefined);
const EXACT_POOL = 256;
const NEAREST_IN_TIME = 50;

/**
 * Suggestions over one pool, for many anchors. Ranking every anchor against every record was
 * quadratic and froze large imports. Small pools are still ranked in full. In large ones, the
 * records ranked for an anchor are those with the same amount or the same destination address
 * (the strong signals), plus the records closest in time; the best five of those are kept.
 */
function suggester(pool: PaymentRecord[]): (anchor: PaymentRecord | undefined, exclude: string) => Candidate[] {
  if (pool.length <= EXACT_POOL) return (anchor, exclude) => suggestionsFrom(anchor, pool.filter((r) => r.recordId !== exclude));
  type Timed = { t: number; r: PaymentRecord }[];
  // The same score as similarity(), on traits worked out once per record; reasons only for the five kept.
  type Fast = { amount?: string; address?: string; asset?: string; chain?: string; t: number };
  const fastOf = (r: PaymentRecord): Fast => {
    const x = traits(r);
    return { amount: canonDecimal(x.amount), address: x.address ? canonicalAddress(x.address) : undefined, asset: x.asset?.toUpperCase(), chain: x.chain, t: x.time ? Date.parse(x.time) : NaN };
  };
  const fast = new Map(pool.map((r) => [r, fastOf(r)]));
  const score = (a: Fast, b: Fast) => {
    let n = 0;
    if (a.amount && a.amount === b.amount) n += 3;
    if (a.address && a.address === b.address) n += 3;
    if (a.asset && b.asset && a.asset.startsWith(b.asset.slice(0, 4))) n += 1;
    if (a.chain && b.chain && a.chain === b.chain) n += 1;
    const hours = Math.abs(a.t - b.t) / 3_600_000;
    if (hours <= 1) n += 2; else if (hours <= 24) n += 1;
    return n;
  };
  const timeOf = (r: PaymentRecord) => { const t = traits(r).time; return t ? Date.parse(t) : NaN; };
  const byAmount = new Map<string, Timed>();
  const byAddress = new Map<string, Timed>();
  const all: Timed = [];
  const push = (m: Map<string, Timed>, k: string | undefined, x: Timed[number]) => { if (k) { const l = m.get(k); if (l) l.push(x); else m.set(k, [x]); } };
  for (const r of pool) {
    const t = traits(r);
    const x = { t: timeOf(r), r };
    push(byAmount, canonDecimal(t.amount), x);
    push(byAddress, t.address ? canonicalAddress(t.address) : undefined, x);
    all.push(x);
  }
  // Records without a time sort last; they are reached only through a small amount or address bucket.
  const order = (l: Timed) => l.sort((a, b) => (Number.isNaN(a.t) ? Infinity : a.t) - (Number.isNaN(b.t) ? Infinity : b.t));
  order(all);
  for (const l of [...byAmount.values(), ...byAddress.values()]) order(l);
  // The k records of a time-sorted list closest to `at` (binary search, then outwards).
  const nearest = (l: Timed, at: number, k: number, out: Set<PaymentRecord>) => {
    let lo = 0, hi = l.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (l[mid].t < at) lo = mid + 1; else hi = mid; }
    let below = lo - 1, above = lo;
    for (let n = 0; n < k && (below >= 0 || above < l.length); n++) {
      const up = above < l.length && !Number.isNaN(l[above].t) ? l[above].t - at : Infinity;
      const down = below >= 0 ? at - l[below].t : Infinity;
      if (up === Infinity && down === Infinity) break;
      out.add(down <= up ? l[below--].r : l[above++].r);
    }
  };
  const take = (l: Timed | undefined, at: number, out: Set<PaymentRecord>) => {
    if (!l) return;
    if (l.length <= EXACT_POOL || Number.isNaN(at)) for (const x of l.slice(0, EXACT_POOL)) out.add(x.r);
    else nearest(l, at, NEAREST_IN_TIME, out);
  };
  return (anchor, exclude) => {
    if (!anchor) return [];
    const a = traits(anchor);
    const at = a.time ? Date.parse(a.time) : NaN;
    const picked = new Set<PaymentRecord>();
    take(byAmount.get(canonDecimal(a.amount) ?? ""), at, picked);
    if (a.address) take(byAddress.get(canonicalAddress(a.address)), at, picked);
    if (!Number.isNaN(at)) nearest(all, at, NEAREST_IN_TIME, picked);
    const fa = fastOf(anchor);
    const top = [...picked].filter((r) => r.recordId !== exclude).map((r) => ({ r, n: score(fa, fast.get(r)!) })).filter((x) => x.n > 0)
      .sort((x, y) => y.n - x.n || (x.r.recordId < y.r.recordId ? -1 : 1)).slice(0, 5);
    const ta = traits(anchor);
    return top.map(({ r }) => ({ recordId: r.recordId, ...similarity(ta, traits(r)) }));
  };
}

// ---- Chain references ----

interface ChainRef { txHash: string; chain?: string; transferIndex?: number; from: string }

type ChainResolution =
  | { kind: "link"; record: ChainTransferRecord; basis: "chain_tx_index" | "chain_tx_single_transfer" }
  | { kind: "missing"; note: string }
  | { kind: "unknown"; note: string }
  | { kind: "review"; reason: ReviewReason; message: string; candidates: ChainTransferRecord[] };

/** `chain` holds the transfers of `ref.txHash` (others are ignored); `lookups` is by hash. */
function resolveChain(ref: ChainRef, chain: ChainTransferRecord[], lookups: Map<string, ChainLookupSummary>, someRejected = false): ChainResolution {
  const lookup = lookups.get(ref.txHash);
  if (!lookup) return { kind: "unknown", note: `Transaction ${short(ref.txHash)} has not been checked on chain yet.` };
  if (lookup.result === "not_found") return { kind: "missing", note: `Transaction ${short(ref.txHash)} (from ${ref.from}) was not found on any supported chain.` };
  if (lookup.result === "pending") return { kind: "unknown", note: `Transaction ${short(ref.txHash)} is known to a node but not mined yet.` };
  if (lookup.result === "error") return { kind: "unknown", note: `Couldn't check transaction ${short(ref.txHash)}: ${lookup.error ?? "lookup failed"}` };
  const chains = lookup.chains ?? (lookup.chain ? [lookup.chain] : []);
  const unresolved = lookup.unresolved ?? [];
  if (chains.length > 1) {
    return { kind: "review", reason: "multiple_candidates", candidates: chain.filter((c) => c.txHash === ref.txHash),
      message: `Transaction ${short(ref.txHash)} exists on ${names(chains)}. A hash found on more than one chain is never linked automatically.` };
  }
  const onChain = chains[0];
  if (ref.chain && ref.chain !== onChain) {
    if (unresolved.includes(ref.chain as Chain)) {
      return { kind: "unknown", note: `The ${ref.from} says ${chainName(ref.chain)}, and ${chainName(ref.chain)} didn't answer; transaction ${short(ref.txHash)} was found on ${chainName(onChain)}.` };
    }
    return { kind: "review", reason: "chain_mismatch", candidates: chain.filter((c) => c.txHash === ref.txHash),
      message: `The ${ref.from} says ${chainName(ref.chain)}, but transaction ${short(ref.txHash)} is on ${chainName(onChain)}.` };
  }
  if (!ref.chain && unresolved.length) {
    return { kind: "unknown", note: `Transaction ${short(ref.txHash)} was found on ${chainName(onChain)}, but ${names(unresolved)} didn't answer, so it isn't confirmed to be only there. The ${ref.from} gives no chain.` };
  }
  const inTx = chain.filter((c) => c.txHash === ref.txHash && c.chain === onChain);
  if (!inTx.length && someRejected) return { kind: "missing", note: `A reviewer rejected the transfer in transaction ${short(ref.txHash)} for this payment.` };
  if (ref.transferIndex !== undefined) {
    const hit = inTx.find((c) => c.transferIndex === ref.transferIndex);
    if (hit) return { kind: "link", record: hit, basis: "chain_tx_index" };
    return { kind: "review", reason: "conflicting_ids", candidates: inTx,
      message: `The ${ref.from} names transfer index ${ref.transferIndex}, which is not in transaction ${short(ref.txHash)} (it has ${inTx.map((c) => c.transferIndex ?? "none").join(", ")}).` };
  }
  if (inTx.length === 1) return { kind: "link", record: inTx[0], basis: "chain_tx_single_transfer" };
  return { kind: "review", reason: "multiple_candidates", candidates: inTx,
    message: `Transaction ${short(ref.txHash)} carries ${inTx.length} token transfers and the ${ref.from} gives no transfer index.` };
}

const short = (h: string) => `${h.slice(0, 10)}…`;
const names = (cs: string[]) => cs.map(chainName).join(cs.length === 2 ? " and " : ", ");
const chainName = (c?: string) => (c ? CHAIN_NAMES[c as keyof typeof CHAIN_NAMES] ?? c : "an unknown chain");
const paymentIdFor = (seed: string) => `PAY-${createHash("sha256").update(seed).digest("hex").slice(0, 10).toUpperCase()}`;

// ---- The matcher ----

interface Draft {
  paymentId: string;
  anchor: PaymentRecord;
  ins?: InsGroup;
  prov?: ProvGroup;
  legs: Partial<Record<LegName, Leg>>;
  chainLink?: { record: ChainTransferRecord; links: Link[] };
  bankLink?: BankRecord;
  ledgerLink?: LedgerGroup;
  decisions: ReviewDecision[];
  returns: Link[];
  fees: Link[];
  linked: Set<string>;
}

export interface DepositAddress { chain: string; address: string; assignedAt?: string; retiredAt?: string }

export function matchPayments(input: MatchInput): MatchResult {
  const chainByHash = indexBy(input.chain, (c) => [c.txHash]);
  const lookupByHash = new Map<string, ChainLookupSummary>();
  for (const l of input.lookups) if (!lookupByHash.has(l.txHash)) lookupByHash.set(l.txHash, l);
  // Reviews are collected per draft and numbered once payment IDs are settled (after step 2).
  const pending: { d: Draft; leg: ReviewTarget; reason: ReviewReason; message: string; candidates: Candidate[]; legRef?: { reviewId: string } }[] = [];
  const reviewed = new Set<string>();
  const addReview = (d: Draft, leg: ReviewTarget, reason: ReviewReason, message: string, candidates: Candidate[]) => {
    for (const c of candidates) reviewed.add(c.recordId);
    const item: (typeof pending)[number] = { d, leg, reason, message, candidates };
    if (leg !== "returns" && leg !== "fees") {
      const legRef = { state: "needs_review" as const, reviewId: "" };
      d.legs[leg] = legRef;
      item.legRef = legRef;
    }
    pending.push(item);
  };

  // Review decisions, oldest first, so the latest per record wins.
  const decisions = [...(input.decisions ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.decisionId < b.decisionId ? -1 : 1));
  const decided = (keys: string[], leg: ReviewTarget) => {
    const out = new Map<string, ReviewDecision>();
    for (const x of decisions) if (x.leg === leg && keys.includes(x.anchorKey)) out.set(x.recordKey, x);
    return out;
  };
  const confirmed = (m: Map<string, ReviewDecision>, exists: (key: string) => boolean) =>
    [...m.values()].filter((x) => x.action === "confirm" && exists(x.recordKey)).at(-1);
  const rejected = (m: Map<string, ReviewDecision>) => new Set([...m.values()].filter((x) => x.action === "reject").map((x) => x.recordKey));
  const note = (d: Draft, m: Map<string, ReviewDecision>) => { for (const x of m.values()) if (!d.decisions.includes(x)) d.decisions.push(x); };
  const confirmedLink = (recordId: string, x: ReviewDecision): Link =>
    ({ recordId, basis: "confirmed", detail: `Confirmed by ${x.by} on ${x.at.slice(0, 10)} (${x.decisionId}): ${x.why}` });
  const provKey = (g: ProvGroup) => `provider:${g.provider}:${g.providerPaymentId}`;

  // Instruction versions a reviewer settled: a confirmed version stands alone; rejected versions drop out.
  const insDecisions = new Map<string, Map<string, ReviewDecision>>();
  const instructions = input.instructions.filter((r) => {
    const m = decided([`instruction:${r.instructionId}`], "instruction");
    if (m.size) insDecisions.set(r.instructionId, m);
    const keep = confirmed(m, (k) => input.instructions.some((i) => i.recordId === k && i.instructionId === r.instructionId));
    return keep ? keep.recordKey === r.recordId : !rejected(m).has(r.recordId);
  });
  const insGroups: InsGroup[] = groupBy(instructions, (r) => r.instructionId, INSTRUCTION_FIELDS);
  const principal = input.provider.filter((r) => r.type === "principal");
  const provGroups: ProvGroup[] = groupBy(principal, (r) => `${r.provider}\u0000${r.providerPaymentId}`, PROVIDER_FIELDS)
    .map((g) => ({ ...g, provider: g.records[0].provider, providerPaymentId: g.records[0].providerPaymentId }));
  const provRecs = (gs: ProvGroup[]) => gs.map((g) => latest(g.records));
  const provByRef = indexBy(provGroups, (p) => p.records.map((r) => r.merchantReference));
  const provById = indexBy(provGroups, (p) => [p.providerPaymentId]);
  const provPos = new Map(provGroups.map((p, i) => [p, i]));

  // 1. Instruction <-> provider. First every exact tie, then decide: a provider payment tied to
  //    two instructions (by either identifier) is contested, and both go to review.
  const drafts: Draft[] = insGroups.map((g) => ({
    paymentId: "", anchor: g.records[0], ins: g, legs: {}, returns: [], fees: [], linked: new Set(), decisions: [],
  }));
  const ties = new Map<Draft, { byRef: ProvGroup[]; byId: ProvGroup[]; namedIds: string[]; confirmed?: { group: ProvGroup; by: ReviewDecision } }>();
  for (const d of drafts) {
    const g = d.ins!;
    if (insDecisions.has(g.key)) note(d, insDecisions.get(g.key)!);
    const namedIds = [...new Set(g.records.map((r) => r.providerPaymentId).filter((x): x is string => !!x))];
    const m = decided([`instruction:${g.key}`], "provider");
    note(d, m);
    const no = rejected(m);
    const yes = confirmed(m, (k) => provGroups.some((p) => provKey(p) === k));
    ties.set(d, {
      namedIds,
      byRef: (provByRef.get(g.key) ?? []).filter((p) => !no.has(provKey(p))),
      byId: [...new Set(namedIds.flatMap((id) => provById.get(id) ?? []))].sort((a, b) => provPos.get(a)! - provPos.get(b)!).filter((p) => !no.has(provKey(p))),
      ...(yes ? { confirmed: { group: provGroups.find((p) => provKey(p) === yes.recordKey)!, by: yes } } : {}),
    });
  }
  // A provider payment a reviewer confirmed for one instruction is no longer a candidate for any other.
  const confirmedGroups = new Set([...ties.values()].map((t) => t.confirmed?.group).filter(Boolean));
  for (const t of ties.values()) {
    if (t.confirmed) continue;
    t.byRef = t.byRef.filter((p) => !confirmedGroups.has(p));
    t.byId = t.byId.filter((p) => !confirmedGroups.has(p));
  }
  const claimedBy = new Map<ProvGroup, Draft[]>();
  for (const d of drafts) for (const p of new Set([...ties.get(d)!.byRef, ...ties.get(d)!.byId])) claimedBy.set(p, [...(claimedBy.get(p) ?? []), d]);
  const claimants = (p: ProvGroup) => claimedBy.get(p) ?? [];

  for (const d of drafts) {
    const g = d.ins!;
    if (g.conflicts.length) {
      addReview(d, "instruction", "conflicting_record",
        `Instruction ${g.key} arrived ${g.records.length} times with different ${g.conflicts.join(", ")}.`,
        g.records.map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    } else {
      d.legs.instruction = { state: "linked", links: [{ recordId: g.records[0].recordId, basis: "anchor", detail: `Instruction ${g.key}` }] };
    }
    const { byRef, byId, namedIds, confirmed: chosen } = ties.get(d)!;
    if (chosen) {
      d.prov = chosen.group;
      d.legs.provider = { state: "linked", links: [confirmedLink(latest(chosen.group.records).recordId, chosen.by)] };
      continue;
    }
    const union = [...new Set([...byRef, ...byId])];
    // Until the instruction's own content is settled, nothing links to it.
    if (g.conflicts.length) {
      addReview(d, "provider", "conflicting_record",
        `Instruction ${g.key} arrived with different ${g.conflicts.join(", ")}; its provider leg waits until that is resolved.`,
        rank(g.records[0], provRecs(union)));
      continue;
    }
    if (!union.length) {
      d.legs.provider = { state: "missing", suggestions: [],
        note: namedIds.length ? `The instruction names provider payment ${namedIds.join(", ")}; no provider record has it.` : undefined };
      continue;
    }
    if (union.length > 1) {
      addReview(d, "provider", "multiple_candidates",
        `${union.length} provider records carry an exact identifier for instruction ${g.key}: ${union.map((p) => `${p.provider} ${p.providerPaymentId}`).join(", ")}.`,
        rank(g.records[0], provRecs(union)));
      continue;
    }
    const p = union[0];
    const named = namedIds.length === 1 ? namedIds[0] : undefined;
    const ref = p.view.merchantReference;
    const others = claimants(p).filter((o) => o !== d);
    if (namedIds.length > 1) {
      addReview(d, "provider", "conflicting_record", `Versions of instruction ${g.key} name different provider payments: ${namedIds.join(", ")}.`, rank(g.records[0], provRecs([p])));
    } else if (p.conflicts.length) {
      addReview(d, "provider", "conflicting_record",
        `${p.provider} payment ${p.providerPaymentId} arrived with different ${p.conflicts.join(", ")}.`,
        p.records.map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    } else if (others.length) {
      addReview(d, "provider", "conflicting_ids",
        `${p.provider} payment ${p.providerPaymentId} is tied by exact identifiers to instructions ${[d, ...others].map((o) => o.ins!.key).sort().join(" and ")}` +
        (ref ? ` (its merchant reference is ${ref}).` : "."),
        rank(g.records[0], provRecs([p])));
    } else if (named && named !== p.providerPaymentId) {
      addReview(d, "provider", "conflicting_ids",
        `Instruction ${g.key} names provider payment ${named}, but ${p.provider} payment ${p.providerPaymentId} carries this instruction's ID as its merchant reference.`,
        rank(g.records[0], provRecs([p])));
    } else if (ref && ref !== g.key) {
      addReview(d, "provider", "conflicting_ids",
        `Instruction ${g.key} names ${p.provider} payment ${p.providerPaymentId}, but that record's merchant reference is ${ref}.`,
        rank(g.records[0], provRecs([p])));
    } else {
      const links: Link[] = [];
      if (byRef.includes(p)) links.push({ recordId: latest(p.records).recordId, basis: "merchant_reference", detail: `${p.provider} merchant reference = instruction ID ${g.key}` });
      if (byId.includes(p)) links.push({ recordId: latest(p.records).recordId, basis: "provider_payment_id", detail: `Instruction names ${p.provider} payment ${p.providerPaymentId}` });
      d.prov = p;
      d.legs.provider = { state: "linked", links };
    }
  }

  // 2. Provider payments no instruction claimed or reviewed become payments of their own.
  const claimed = new Set(drafts.map((d) => d.prov).filter(Boolean));
  for (const p of provGroups) {
    if (claimed.has(p) || p.records.some((r) => reviewed.has(r.recordId))) continue;
    const d: Draft = { paymentId: "", anchor: latest(p.records), prov: p,
      legs: {}, returns: [], fees: [], linked: new Set(), decisions: [] };
    if (p.conflicts.length) {
      addReview(d, "provider", "conflicting_record", `${p.provider} payment ${p.providerPaymentId} arrived with different ${p.conflicts.join(", ")}.`,
        p.records.map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    } else {
      d.legs.provider = { state: "linked", links: [{ recordId: latest(p.records).recordId, basis: "anchor", detail: `${p.provider} payment ${p.providerPaymentId}` }] };
    }
    const ref = p.view.merchantReference;
    d.legs.instruction = { state: "missing", suggestions: [],
      note: ref ? `The provider record's merchant reference is ${ref}; no instruction has that ID.` : "The provider record has no merchant reference." };
    drafts.push(d);
  }

  // Payment IDs. An ID, once assigned to an anchor key, is never changed. An instruction that now
  // links a provider record which had a payment of its own takes over that payment's ID.
  // Two passes, so an ID stays with the payment that owns it: first every payment takes the ID of
  // its own anchor (instruction, or provider record when there is none); only then may a payment
  // take over the ID of a provider record it now links.
  const assigned: Record<string, string> = { ...(input.assigned ?? {}) };
  const inUse = new Set<string>();
  const everAssigned = new Set(Object.values(assigned));
  const keysOf = (d: Draft) => [
    ...(d.ins ? [`instruction:${d.ins.key}`] : []),
    ...(d.prov && (!d.ins || d.legs.provider?.state === "linked") ? [`provider:${d.prov.provider}:${d.prov.providerPaymentId}`] : []),
  ];
  const take = (d: Draft, id: string) => { d.paymentId = id; inUse.add(id); everAssigned.add(id); };
  for (const d of drafts) {
    const own = assigned[keysOf(d)[0]];
    if (own && !inUse.has(own)) take(d, own);
  }
  for (const d of drafts.filter((x) => !x.paymentId)) {
    const keys = keysOf(d);
    let id = keys.slice(1).map((k) => assigned[k]).find((x) => x && !inUse.has(x));
    for (let n = 0; !id; n++) {
      const fresh = paymentIdFor(n ? `${keys[0]}#${n}` : keys[0]);
      if (!inUse.has(fresh) && !everAssigned.has(fresh)) id = fresh;
    }
    take(d, id);
  }
  for (const d of drafts) for (const k of keysOf(d)) assigned[k] ??= d.paymentId;

  // Every key a payment answers to, for the decisions made on it.
  const anchorKeys = (d: Draft) => [
    ...(d.ins ? [`instruction:${d.ins.key}`] : []),
    ...(d.prov ? [`provider:${d.prov.provider}:${d.prov.providerPaymentId}`] : []),
  ];

  // 3. On-chain leg, from the instruction's and the provider record's exact references.
  const chainProposals = new Map<Draft, { record: ChainTransferRecord; links: Link[] }>();
  const chainRejected = new Map<Draft, Set<string>>();
  // A transfer a reviewer confirmed for one payment belongs to that payment alone.
  const chainConfirmedFor = new Map<string, { d: Draft; by: ReviewDecision }>();
  for (const d of drafts) {
    const yes = confirmed(decided(anchorKeys(d), "chain"), (k) => input.chain.some((c) => c.recordId === k));
    if (yes) chainConfirmedFor.set(yes.recordKey, { d, by: yes });
  }
  for (const d of drafts) {
    const m = decided(anchorKeys(d), "chain");
    note(d, m);
    const yes = confirmed(m, (k) => input.chain.some((c) => c.recordId === k));
    if (yes) {
      const rec = input.chain.find((c) => c.recordId === yes.recordKey)!;
      d.chainLink = { record: rec, links: [confirmedLink(rec.recordId, yes)] };
      d.legs.chain = { state: "linked", links: d.chainLink.links };
      continue;
    }
    chainRejected.set(d, rejected(m));
    const refs: ChainRef[] = [];
    if (d.ins) {
      if (d.ins.conflicts.length) {
        const onChain = d.ins.conflicts.some((f) => ["txHash", "chain", "transferIndex"].includes(f));
        addReview(d, "chain", "conflicting_record",
          onChain ? `Versions of instruction ${d.ins.key} give different on-chain references.`
            : `Instruction ${d.ins.key} arrived with different ${d.ins.conflicts.join(", ")}; its on-chain leg waits until that is resolved.`,
          rank(d.anchor, input.chain.filter((c) => d.ins!.records.some((r) => r.txHash === c.txHash))));
        continue;
      }
      if (d.ins.view.txHash) refs.push({ txHash: d.ins.view.txHash, chain: d.ins.view.chain, transferIndex: d.ins.view.transferIndex, from: "instruction" });
    }
    if (d.prov && d.legs.provider?.state === "linked" && d.prov.view.txHash) {
      refs.push({ txHash: d.prov.view.txHash, chain: d.prov.view.chain, transferIndex: d.prov.view.transferIndex, from: `${d.prov.provider} record` });
    }
    if (!refs.length) {
      d.legs.chain = { state: "missing", suggestions: [], note: "No record names an on-chain transaction." };
      continue;
    }
    const [a, b] = refs;
    if (b) {
      const clash = a.txHash !== b.txHash ? `the instruction names transaction ${short(a.txHash)}, the ${b.from} names ${short(b.txHash)}`
        : a.chain && b.chain && a.chain !== b.chain ? `the instruction says ${chainName(a.chain)}, the ${b.from} says ${chainName(b.chain)}`
        : a.transferIndex !== undefined && b.transferIndex !== undefined && a.transferIndex !== b.transferIndex
          ? `the instruction names transfer index ${a.transferIndex}, the ${b.from} names ${b.transferIndex}` : undefined;
      if (clash) {
        addReview(d, "chain", "conflicting_ids", `On-chain references disagree: ${clash}.`,
          rank(d.anchor, input.chain.filter((c) => c.txHash === a.txHash || c.txHash === b.txHash)));
        continue;
      }
    }
    const merged: ChainRef = { txHash: a.txHash, chain: a.chain ?? b?.chain, transferIndex: a.transferIndex ?? b?.transferIndex,
      from: b ? `instruction and ${b.from}` : a.from };
    const no = chainRejected.get(d)!;
    const res = resolveChain(merged, (chainByHash.get(merged.txHash) ?? []).filter((c) => !no.has(c.recordId)), lookupByHash, no.size > 0);
    if (res.kind === "missing") d.legs.chain = { state: "missing", suggestions: [], note: res.note };
    else if (res.kind === "unknown") d.legs.chain = { state: "unknown", note: res.note };
    else if (res.kind === "review") addReview(d, "chain", res.reason, res.message, rank(d.anchor, res.candidates));
    else {
      // Each reference says how it identifies the transfer.
      const t = res.record;
      const where = `${chainName(t.chain)} transaction ${short(t.txHash)}`;
      const linkFor = (r: ChainRef): Link => {
        const base = { recordId: t.recordId };
        if (t.transferIndex === undefined) return { ...base, basis: "chain_tx_single_transfer", detail: `The ${r.from} names ${where}: failed, no token transfer.` };
        if (r.transferIndex !== undefined) return { ...base, basis: "chain_tx_index", detail: `The ${r.from} names ${where}, transfer index ${r.transferIndex}.` };
        if (t.transfersInTx === 1) return { ...base, basis: "chain_tx_single_transfer", detail: `The ${r.from} names ${where}; its only token transfer is index ${t.transferIndex}.` };
        return { ...base, basis: "chain_tx_index", detail: `The ${r.from} names ${where}; index ${t.transferIndex} comes from the other reference to the same hash.` };
      };
      chainProposals.set(d, { record: t, links: refs.map(linkFor) });
    }
  }
  for (const [d, prop] of chainProposals) {
    const claimants = [...chainProposals].filter(([, v]) => v.record === prop.record).map(([o]) => o);
    const taken = chainConfirmedFor.get(prop.record.recordId);
    if (taken && taken.d !== d) {
      addReview(d, "chain", "conflicting_ids",
        `${chainName(prop.record.chain)} transaction ${short(prop.record.txHash)} transfer ${prop.record.transferIndex ?? "(none)"} is named by this payment, but was confirmed for another payment (${label(taken.d)}) by ${taken.by.by} (${taken.by.decisionId}).`,
        rank(d.anchor, [prop.record]));
    } else if (claimants.length > 1) {
      addReview(d, "chain", "conflicting_ids",
        `${chainName(prop.record.chain)} transaction ${short(prop.record.txHash)} transfer ${prop.record.transferIndex ?? "(none)"} is named by ${claimants.length} payments (${claimants.map(label).join(", ")}).`,
        rank(d.anchor, [prop.record]));
    } else {
      d.chainLink = prop;
      d.legs.chain = { state: "linked", links: prop.links };
    }
  }

  // 4. Bank leg: an exact instruction ID or provider payment ID column. Free text is never parsed.
  //    A row naming both links only when both point to the same payment; otherwise it is reviewed.
  const bankPrincipal = input.bank.filter((b) => !b.returnOf);
  const knownProviderIds = new Set(input.provider.map((r) => r.providerPaymentId));
  const providerIdKnown = (id: string) => knownProviderIds.has(id);
  // Drafts by the identifiers ledger and bank rows join on (drafts order kept).
  const draftsByIns = indexBy(drafts, (d) => [d.ins?.key]);
  const draftsByProvId = indexBy(drafts, (d) => [d.prov?.providerPaymentId, d.ins?.view.providerPaymentId]);
  const draftsByTx = indexBy(drafts, (d) => [d.chainLink?.record.txHash]);
  const bankHits = new Map<BankRecord, { drafts: Draft[]; problem?: string }>();
  for (const b of bankPrincipal) {
    const byIns = b.instructionId ? draftsByIns.get(b.instructionId) ?? [] : [];
    const byProv = b.providerPaymentId ? draftsByProvId.get(b.providerPaymentId) ?? [] : [];
    const involved = [...new Set([...byIns, ...byProv])];
    let problem: string | undefined;
    if (involved.length > 1) {
      problem = b.instructionId && b.providerPaymentId
        ? `Bank ${b.bankReference} names instruction ${b.instructionId} and provider payment ${b.providerPaymentId}, which belong to different payments.`
        : `Bank ${b.bankReference} carries an identifier of more than one payment.`;
    } else if (involved.length === 1 && b.instructionId && b.providerPaymentId && (!byIns.length || !byProv.length)) {
      problem = !byProv.length
        ? `Bank ${b.bankReference} names instruction ${b.instructionId} and provider payment ${b.providerPaymentId}, which ${providerIdKnown(b.providerPaymentId) ? "is not linked to this payment" : "no payment has"}.`
        : `Bank ${b.bankReference} names provider payment ${b.providerPaymentId} and instruction ${b.instructionId}, which no payment has.`;
    }
    bankHits.set(b, { drafts: involved, problem });
  }
  const bankChosen = new Map<Draft, { record: BankRecord; by: ReviewDecision }>();
  const bankNo = new Map<Draft, Set<string>>();
  for (const d of drafts) {
    const m = decided(anchorKeys(d), "bank");
    note(d, m);
    const yes = confirmed(m, (k) => input.bank.some((b) => b.recordId === k));
    if (yes) bankChosen.set(d, { record: input.bank.find((b) => b.recordId === yes.recordKey)!, by: yes });
    bankNo.set(d, rejected(m));
  }
  const bankTaken = new Set([...bankChosen.values()].map((c) => c.record));
  const bankByDraft = new Map<Draft, BankRecord[]>();
  for (const b of bankPrincipal) for (const d of bankHits.get(b)!.drafts) bankByDraft.set(d, [...(bankByDraft.get(d) ?? []), b]);
  for (const d of drafts) {
    const chosen = bankChosen.get(d);
    if (chosen) {
      d.bankLink = chosen.record;
      d.legs.bank = { state: "linked", links: [confirmedLink(chosen.record.recordId, chosen.by)] };
      continue;
    }
    const mine = (bankByDraft.get(d) ?? []).filter((b) => !bankTaken.has(b) && !bankNo.get(d)!.has(b.recordId));
    const contested = mine.filter((b) => bankHits.get(b)!.problem);
    if (contested.length) {
      addReview(d, "bank", "conflicting_ids", contested.map((b) => bankHits.get(b)!.problem).join(" "), rank(d.anchor, contested));
    } else if (mine.length > 1) {
      addReview(d, "bank", "multiple_candidates", `${mine.length} bank records carry an identifier of this payment: ${mine.map((b) => b.bankReference).join(", ")}.`, rank(d.anchor, mine));
    } else if (mine.length === 1) {
      const b = mine[0];
      d.bankLink = b;
      const basis = b.instructionId && d.ins?.key === b.instructionId ? "instruction_id" : "provider_payment_id";
      d.legs.bank = { state: "linked", links: [{ recordId: b.recordId, basis,
        detail: basis === "instruction_id" ? `Bank ${b.bankReference} names instruction ${b.instructionId}` : `Bank ${b.bankReference} names provider payment ${b.providerPaymentId}` }] };
    } else {
      d.legs.bank = input.bank.length ? { state: "missing", suggestions: [] } : { state: "not_applicable" };
    }
  }

  // 5. Ledger leg, on exact identifiers: the entry's instruction ID or provider payment ID, or the
  //    linked transfer's chain + hash + index (File B deposits carry only that). Entries are
  //    grouped by entry ID, so "posted" then "reversed" is a status history. An entry naming two
  //    payments, or an instruction plus a provider ID no payment has, is reviewed.
  const ledgerGroups: LedgerGroup[] = groupBy(input.ledger ?? [], (r) => `${r.ledger}:${r.entryId}`, LEDGER_FIELDS)
    .map((g) => ({ ...g, recordKey: `ledger:${g.key}` }));
  const principalLedger = ledgerGroups.filter((g) => !g.records.some((r) => r.reverses));
  const fileA = input.depositAddresses;
  const assignedAt = (a: DepositAddress, at: number) =>
    (!a.assignedAt || Date.parse(a.assignedAt) <= at) && (!a.retiredAt || at < Date.parse(a.retiredAt));
  // Inbound if the destination was a company deposit address at the transfer's block time. Unknown,
  // with the reason, when that can't be told: File A not loaded, or no block time to check its dates.
  const directionOf = (d: Draft): { dir: Direction; why?: string } => {
    const t = d.chainLink?.record;
    if (!t?.to) return { dir: "outbound" };
    if (!fileA) return { dir: "unknown", why: "File A not loaded" };
    const listed = fileA.filter((a) => a.chain === t.chain && canonicalAddress(a.address) === canonicalAddress(t.to!));
    if (!listed.length) return { dir: "outbound" };
    const at = Date.parse(t.eventTime ?? "");
    if (Number.isNaN(at)) return listed.some((a) => a.assignedAt || a.retiredAt) ? { dir: "unknown", why: "No block time" } : { dir: "inbound" };
    return { dir: listed.some((a) => assignedAt(a, at)) ? "inbound" : "outbound" };
  };
  const direction = (d: Draft) => directionOf(d).dir;
  const undecidedNote = (d: Draft, rows: LedgerGroup[]) => {
    const ids = rows.map((g) => g.records[0].entryId).join(", ");
    return directionOf(d).why === "No block time"
      ? `No block time: the transfer has none, so it can't be checked against File A's assigned and retired dates; deposit ledger ${ids} can't be classified.`
      : `File A not loaded: deposit ledger ${ids} carries this transfer, but without File A we can't tell whether it is a deposit.`;
  };
  const toSameAddress = (g: LedgerGroup, d: Draft) => !g.view.toAddress || sameAddress(g.view.toAddress, d.chainLink!.record.to!);
  // Deposit rows only for a transfer into a company deposit address (that same address);
  // payout rows only for everything else. A payout row names our instruction or payment, so it
  // still links when File A isn't loaded; a deposit row then waits (see `undecided`).
  const sameDirection = (g: LedgerGroup, d: Draft) => g.records[0].ledger === "deposit"
    ? direction(d) === "inbound" && toSameAddress(g, d)
    : direction(d) !== "inbound";
  type Basis = { basis: LinkBasis; detail: string };
  const ledgerHits = new Map<LedgerGroup, { drafts: Draft[]; basis: Map<Draft, Basis>; anyBasis: Map<Draft, Basis>; problem?: string; undecided: Draft[] }>();
  for (const g of principalLedger) {
    const e = g.view;
    // Every payment the entry's identifiers point to, then only those in the entry's direction.
    const anyBasis = new Map<Draft, Basis>();
    const byIns = e.instructionId ? draftsByIns.get(e.instructionId) ?? [] : [];
    for (const d of byIns) anyBasis.set(d, { basis: "instruction_id", detail: `Ledger ${g.records[0].entryId} names instruction ${e.instructionId}` });
    const byProv = e.providerPaymentId
      ? draftsByProvId.get(e.providerPaymentId) ?? [] : [];
    for (const d of byProv) if (!anyBasis.has(d)) anyBasis.set(d, { basis: "provider_payment_id", detail: `Ledger ${g.records[0].entryId} names provider payment ${e.providerPaymentId}` });
    const byChain = e.txHash ? (draftsByTx.get(e.txHash) ?? []).filter((d) => {
      const t = d.chainLink?.record;
      return !!t && t.txHash === e.txHash && (!e.chain || e.chain === t.chain) &&
        (e.transferIndex === t.transferIndex || (e.transferIndex === undefined && t.transfersInTx <= 1));
    }) : [];
    for (const d of byChain) {
      if (anyBasis.has(d)) continue;
      const t = d.chainLink!.record;
      anyBasis.set(d, { basis: e.transferIndex === undefined ? "chain_tx_single_transfer" : "chain_tx_index",
        detail: `Ledger ${g.records[0].entryId} carries ${chainName(t.chain)} transaction ${short(t.txHash)}${e.transferIndex !== undefined ? `, index ${e.transferIndex}` : ""}` });
    }
    const basis = new Map([...anyBasis].filter(([d]) => sameDirection(g, d)));
    const undecided = [...anyBasis.keys()].filter((d) => !basis.has(d) && g.records[0].ledger === "deposit" && direction(d) === "unknown" && toSameAddress(g, d));
    const involved = [...basis.keys()];
    let problem: string | undefined;
    const id = g.records[0].entryId;
    if (involved.length > 1) problem = `Ledger entry ${id} carries identifiers of more than one payment.`;
    else if (involved.length === 1 && e.instructionId && e.providerPaymentId && (!byIns.some((x) => basis.has(x)) || !byProv.some((x) => basis.has(x)))) {
      problem = !byProv.some((x) => basis.has(x))
        ? `Ledger entry ${id} names instruction ${e.instructionId} and provider payment ${e.providerPaymentId}, which ${providerIdKnown(e.providerPaymentId) ? "is not linked to this payment" : "no payment has"}.`
        : `Ledger entry ${id} names provider payment ${e.providerPaymentId} and instruction ${e.instructionId}, which no payment has.`;
    }
    ledgerHits.set(g, { drafts: involved, basis, anyBasis, problem, undecided });
  }
  const ledgerChosen = new Map<Draft, { group: LedgerGroup; by: ReviewDecision }>();
  const ledgerNo = new Map<Draft, Set<string>>();
  for (const d of drafts) {
    const m = decided(anchorKeys(d), "ledger");
    note(d, m);
    const yes = confirmed(m, (k) => principalLedger.some((g) => g.recordKey === k));
    if (yes) ledgerChosen.set(d, { group: principalLedger.find((g) => g.recordKey === yes.recordKey)!, by: yes });
    ledgerNo.set(d, rejected(m));
  }
  const ledgerTaken = new Set([...ledgerChosen.values()].map((c) => c.group));
  const awaitingFileA = new Set<string>();
  const unclassifiedLedger: { recordId: string; paymentId: string; note: string }[] = [];
  // Payments whose link waits in a "direction changed" review, with the direction it was linked under.
  const flipPending = new Map<Draft, Direction>();
  const followRedirects = (id: string) => {
    for (let i = 0, r = input.redirects?.[id]; r && r.to.kind !== "none" && i < 20; i++, r = input.redirects?.[id]) id = r.to.paymentId;
    return id;
  };
  const prevLinks = (input.previousLedgerLinks ?? []).map((l) => ({ ...l, paymentId: followRedirects(l.paymentId) }));
  const prevLinksOf = indexBy(prevLinks, (l) => [l.paymentId]);
  const ledgerByKey = new Map(principalLedger.map((g) => [g.recordKey, g]));
  const ledgerByDraft = new Map<Draft, LedgerGroup[]>();
  const undecidedByDraft = new Map<Draft, LedgerGroup[]>();
  for (const g of principalLedger) {
    for (const d of new Set(ledgerHits.get(g)!.drafts)) ledgerByDraft.set(d, [...(ledgerByDraft.get(d) ?? []), g]);
    for (const d of new Set(ledgerHits.get(g)!.undecided)) undecidedByDraft.set(d, [...(undecidedByDraft.get(d) ?? []), g]);
  }
  const undecidedFor = (d: Draft) => (undecidedByDraft.get(d) ?? []).filter((g) => !ledgerTaken.has(g) && !ledgerNo.get(d)!.has(g.recordKey));
  for (const d of drafts) {
    if (!ledgerGroups.length) { d.legs.ledger = { state: "not_applicable" }; continue; }
    const chosen = ledgerChosen.get(d);
    if (chosen) {
      d.ledgerLink = chosen.group;
      d.legs.ledger = { state: "linked", links: [confirmedLink(latest(chosen.group.records).recordId, chosen.by)] };
      continue;
    }
    const mine = (ledgerByDraft.get(d) ?? []).filter((g) => !ledgerTaken.has(g) && !ledgerNo.get(d)!.has(g.recordKey));
    const contested = mine.filter((g) => ledgerHits.get(g)!.problem);
    // Linked last run, but the transfer now counts the other way (e.g. its address was added to
    // File A): not unlinked silently. A person decides, with both views in front of them.
    const now = direction(d);
    const flipped = now === "unknown" ? [] : (prevLinksOf.get(d.paymentId) ?? []).filter((l) => l.direction !== now)
      .map((l) => [ledgerByKey.get(l.ledgerKey)].find((g) => !!g && !mine.includes(g) && !ledgerTaken.has(g) && !ledgerNo.get(d)!.has(g.recordKey)
        && !sameDirection(g, d) && ledgerHits.get(g)!.anyBasis.has(d)))
      .filter((g): g is LedgerGroup => !!g);
    if (flipped.length) {
      const was = prevLinksOf.get(d.paymentId)!.find((l) => l.ledgerKey === flipped[0].recordKey)!.direction;
      const t = d.chainLink!.record;
      const view = (x: Direction) => x === "inbound" ? "inbound (a deposit: only the deposit ledger fits)"
        : x === "outbound" ? "outbound (a payout: only the payout ledger fits)" : "unknown (File A not loaded)";
      addReview(d, "ledger", "direction_changed",
        `Ledger ${flipped.map((g) => `${g.records[0].ledger} entry ${g.records[0].entryId}`).join(", ")} was linked when this transfer counted as ${view(was)}; ` +
        `it now counts as ${view(now)}, going by File A for ${short(t.to!)} at the transfer's block time${t.eventTime ? ` (${t.eventTime})` : ""}. Confirm to keep the link, or reject it.`,
        [...flipped, ...mine].map((g) => ({ recordId: latest(g.records).recordId, score: 0, reasons: [] })));
      // Until a person decides, the link stays ("linked, under review"), and this run remembers the
      // direction it was linked under, so the next run raises the same review again.
      const leg = { state: "linked" as const, links: [{ recordId: latest(flipped[0].records).recordId, ...ledgerHits.get(flipped[0])!.anyBasis.get(d)! }], reviewId: "" };
      d.legs.ledger = leg;
      pending.at(-1)!.legRef = leg;
      d.ledgerLink = flipped[0];
      flipPending.set(d, was);
    } else if (contested.length) {
      addReview(d, "ledger", "conflicting_ids", contested.map((g) => ledgerHits.get(g)!.problem).join(" "), rank(d.anchor, contested.map((g) => latest(g.records))));
    } else if (mine.length > 1) {
      addReview(d, "ledger", "multiple_candidates", `${mine.length} ledger entries carry an identifier of this payment: ${mine.map((g) => g.records[0].entryId).join(", ")}.`,
        rank(d.anchor, mine.map((g) => latest(g.records))));
    } else if (mine.length === 1 && mine[0].conflicts.length) {
      addReview(d, "ledger", "conflicting_record", `Ledger entry ${mine[0].records[0].entryId} arrived with different ${mine[0].conflicts.join(", ")}.`,
        mine[0].records.map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    } else if (mine.length === 1) {
      d.ledgerLink = mine[0];
      const b = ledgerHits.get(mine[0])!.basis.get(d)!;
      d.legs.ledger = { state: "linked", links: [{ recordId: latest(mine[0].records).recordId, ...b }] };
    } else {
      const waiting = undecidedFor(d);
      if (waiting.length) d.legs.ledger = { state: "unknown", note: undecidedNote(d, waiting) };
      else {
        d.legs.ledger = { state: "missing", suggestions: [],
          note: !d.chainLink && !d.ins && !d.prov ? "No identifier to join the ledger on." : undefined };
      }
    }
  }
  // Deposit rows on a transfer whose direction can't be told are unknown, never unlinked, even
  // when a payout row already links the payment.
  for (const d of drafts) {
    const rows = undecidedFor(d).filter((g) => g !== d.ledgerLink);
    for (const g of rows) for (const r of g.records) awaitingFileA.add(r.recordId);
    for (const g of rows) unclassifiedLedger.push({ recordId: latest(g.records).recordId, paymentId: d.paymentId, note: undecidedNote(d, [g]) });
  }
  const ledgerLinks: LedgerLink[] = drafts.filter((d) => d.ledgerLink && d.legs.ledger?.state === "linked")
    .map((d) => ({ ledgerKey: d.ledgerLink!.recordKey, paymentId: d.paymentId, direction: flipPending.get(d) ?? direction(d) }));
  // Reversal entries attach to the payment whose ledger entry they reverse.
  const byLedgerLink = new Map<string, Draft>();
  for (const d of drafts) if (d.ledgerLink) { const k = `${d.ledgerLink.records[0].ledger}:${d.ledgerLink.records[0].entryId}`; if (!byLedgerLink.has(k)) byLedgerLink.set(k, d); }
  for (const g of ledgerGroups.filter((x) => x.records.some((r) => r.reverses))) {
    const target = byLedgerLink.get(`${g.records[0].ledger}:${g.view.reverses}`);
    if (target) target.returns.push({ recordId: latest(g.records).recordId, basis: "reverses", detail: `Ledger ${g.records[0].entryId} reverses ${g.view.reverses}` });
  }

  // 6. Returns and fees: exact identifiers only. A row that relates to a provider payment attaches
  //    only where that provider leg is linked. If the payment it ties to has its provider leg
  //    unresolved, the row waits in a review on that payment instead.
  const held = new Map<Draft, { fees: ProviderRecord[]; returns: ProviderRecord[] }>();
  const isProv = (g: ProvGroup | undefined, r: ProviderRecord) => !!g && g.provider === r.provider && g.providerPaymentId === r.relatesTo;
  // Drafts a fee or return row could relate to, by provider payment; the exact tests below still apply.
  const draftPos = new Map(drafts.map((d, i) => [d, i]));
  const pk = (provider: string, id: string) => `${provider}\u0000${id}`;
  const relIndex = indexBy(drafts, (d) => [
    d.prov ? pk(d.prov.provider, d.prov.providerPaymentId) : undefined,
    ...(d.ins?.records.map((x) => (x.providerPaymentId ? pk("*", x.providerPaymentId) : undefined)) ?? []),
    ...(d.ins ? [...ties.get(d)!.byRef, ...ties.get(d)!.byId].map((g) => pk(g.provider, g.providerPaymentId)) : []),
  ]);
  const relatedTo = (r: ProviderRecord) => [...new Set([...(relIndex.get(pk(r.provider, r.relatesTo!)) ?? []), ...(relIndex.get(pk("*", r.relatesTo!)) ?? [])])]
    .sort((a, b) => draftPos.get(a)! - draftPos.get(b)!);
  for (const r of input.provider.filter((x) => x.type === "fee" || x.type === "return")) {
    const bucket = r.type === "fee" ? "fees" as const : "returns" as const;
    if (r.relatesTo) {
      const linked = relatedTo(r).filter((d) => d.legs.provider?.state === "linked" && isProv(d.prov, r));
      for (const d of linked) d[bucket].push({ recordId: r.recordId, basis: "provider_payment_id", detail: `${r.provider} ${r.type} row relates to ${r.relatesTo}` });
      if (linked.length) continue;
      const waiting = relatedTo(r).filter((d) => d.legs.provider?.state !== "linked" && (
        isProv(d.prov, r) ||
        d.ins?.records.some((x) => x.providerPaymentId === r.relatesTo) ||
        (d.ins && [...ties.get(d)!.byRef, ...ties.get(d)!.byId].some((g) => isProv(g, r)))));
      for (const d of waiting) {
        const h = held.get(d) ?? { fees: [], returns: [] };
        h[bucket].push(r);
        held.set(d, h);
      }
      continue;
    }
    // Tied only to the instruction: attach when both its instruction and provider legs are linked.
    for (const d of (r.merchantReference ? draftsByIns.get(r.merchantReference) ?? [] : []).filter((x) => x.ins && r.merchantReference === x.ins.key)) {
      if (d.legs.instruction?.state === "linked" && d.legs.provider?.state === "linked") {
        d[bucket].push({ recordId: r.recordId, basis: "merchant_reference", detail: `${r.provider} ${r.type} row carries merchant reference ${r.merchantReference}` });
      } else {
        const h = held.get(d) ?? { fees: [], returns: [] };
        h[bucket].push(r);
        held.set(d, h);
      }
    }
  }
  for (const [d, h] of held) {
    const state = d.legs.provider?.state === "needs_review" ? "needs review" : d.legs.provider?.state ?? "missing";
    for (const bucket of ["fees", "returns"] as const) {
      // A reviewer can attach a waiting row (confirm) or send it away (reject).
      const m = decided(anchorKeys(d), bucket);
      note(d, m);
      for (const r of [...h[bucket]]) {
        const x = m.get(r.recordId);
        if (!x) continue;
        if (x.action === "confirm") d[bucket].push(confirmedLink(r.recordId, x));
        h[bucket] = h[bucket].filter((y) => y !== r);
      }
      if (!h[bucket].length) continue;
      addReview(d, bucket, "provider_leg_not_linked",
        h[bucket].map((r) => r.relatesTo
          ? `${r.provider} ${r.type} row ${r.providerPaymentId} relates to ${r.provider} payment ${r.relatesTo}, but this payment's provider leg is not linked (${state}).`
          : `${r.provider} ${r.type} row ${r.providerPaymentId} carries merchant reference ${r.merchantReference}, but this payment's instruction and provider legs are not both linked (instruction ${legWord(d.legs.instruction)}, provider ${legWord(d.legs.provider)}).`).join(" "),
        h[bucket].map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    }
  }
  const bankReturns = indexBy(input.bank, (b) => [b.returnOf]);
  for (const d of drafts) {
    if (d.bankLink) {
      for (const b of bankReturns.get(d.bankLink.bankReference) ?? []) {
        d.returns.push({ recordId: b.recordId, basis: "return_of", detail: `Bank ${b.bankReference} is a return of ${b.returnOf}` });
      }
    }
  }

  // 7. Assemble.
  const all = new Map<string, PaymentRecord>([...input.instructions, ...input.provider, ...input.bank, ...input.chain, ...(input.ledger ?? [])].map((r) => [r.recordId, r]));
  const payments: CanonicalPayment[] = drafts.map((d) => {
    const legs = { instruction: d.legs.instruction!, chain: d.legs.chain!, provider: d.legs.provider!, bank: d.legs.bank!, ledger: d.legs.ledger! };
    const ids = new Set<string>();
    for (const leg of Object.values(legs)) if (leg.state === "linked") for (const l of leg.links) ids.add(l.recordId);
    // Every version of the payment's own instruction belongs to it, even while under review, and
    // so does every version of a linked provider record.
    for (const r of d.ins?.records ?? []) ids.add(r.recordId);
    if (legs.provider.state === "linked") for (const r of d.prov?.records ?? []) ids.add(r.recordId);
    if (legs.ledger.state === "linked") for (const r of d.ledgerLink?.records ?? []) ids.add(r.recordId);
    for (const l of [...d.returns, ...d.fees]) ids.add(l.recordId);
    const recs = [...ids].map((id) => all.get(id)!).filter(Boolean).sort(byEventTime);
    return {
      paymentId: d.paymentId,
      anchor: { kind: d.anchor.kind, recordId: d.anchor.recordId },
      legs, returns: d.returns, fees: d.fees,
      identifiers: recs.flatMap((r) => r.identifiers.map((i) => ({ ...i, recordId: r.recordId, kind: r.kind }))),
      timeline: recs.map((r) => ({ recordId: r.recordId, kind: r.kind, eventTime: r.eventTime, observedTime: r.observedTime, label: describe(r) })),
      duplicateRecords: recs.filter((r) => r.sources.length > 1).map((r) => r.recordId),
      decisions: d.decisions,
    };
  });

  // Suggestions for missing legs (ranking only, never a link). A record is a fair suggestion if
  // no instruction-anchored payment links it and no review holds it, including the anchor of a
  // payment that has only that one side (an orphan provider record, an unclaimed transfer).
  const insPaid = new Set<string>();
  for (const p of payments) {
    if (p.anchor.kind !== "instruction") continue;
    for (const leg of Object.values(p.legs)) if (leg.state === "linked") for (const l of leg.links) insPaid.add(l.recordId);
  }
  const linkedAnywhere = new Set<string>();
  for (const p of payments) for (const t of p.timeline) linkedAnywhere.add(t.recordId);
  const insWithoutProvider = new Set(payments.filter((p) => p.anchor.kind === "instruction" && p.legs.provider.state === "missing").map((p) => p.anchor.recordId));
  const pool: Record<"instruction" | "provider" | "chain" | "bank", PaymentRecord[]> = {
    instruction: input.instructions.filter((r) => insWithoutProvider.has(r.recordId)),
    provider: provGroups.map((g) => latest(g.records)).filter((r) => !insPaid.has(r.recordId) && !reviewed.has(r.recordId)),
    chain: input.chain.filter((r) => !insPaid.has(r.recordId) && !reviewed.has(r.recordId)),
    bank: input.bank.filter((r) => !r.returnOf && !linkedAnywhere.has(r.recordId) && !reviewed.has(r.recordId)),
  };
  const suggest = { instruction: suggester(pool.instruction), provider: suggester(pool.provider), chain: suggester(pool.chain), bank: suggester(pool.bank) };
  for (const p of payments) {
    const anchor = all.get(p.anchor.recordId);
    for (const leg of ["instruction", "provider", "chain", "bank"] as const) {
      const l = p.legs[leg];
      if (l.state === "missing") l.suggestions = suggest[leg](anchor, p.anchor.recordId);
    }
  }

  // A provider record held in a review keeps showing the payment ID it had on its own.
  const carried = new Set(drafts.map((d) => d.paymentId));
  const providerById = new Map(input.provider.map((r) => [r.recordId, r]));
  const reservedFor = (recordId: string) => {
    const r = providerById.get(recordId);
    const id = r && assigned[`provider:${r.provider}:${r.providerPaymentId}`];
    return id && !carried.has(id) ? id : undefined;
  };
  const reviews: ReviewItem[] = pending.map((p) => {
    const reviewId = `REV-${p.d.paymentId.slice(4)}-${p.leg}`;
    if (p.legRef) p.legRef.reviewId = reviewId;
    const candidates = p.candidates.map((c) => { const id = reservedFor(c.recordId); return id ? { ...c, reservedPaymentId: id } : c; });
    return { reviewId, paymentId: p.d.paymentId, leg: p.leg, reason: p.reason, message: p.message, candidates };
  });

  // Retired IDs: every ID ever assigned that no payment carries now gets a redirect to where its
  // records are, or keeps its last known one. Nothing assigned is ever dropped.
  const redirects: Record<string, PaymentRedirect> = { ...(input.redirects ?? {}) };
  // Lookups for locate(), built once (scans per retired ID were quadratic).
  const draftByInsKey = new Map<string, Draft>();
  for (const d of drafts) if (d.ins && !draftByInsKey.has(d.ins.key)) draftByInsKey.set(d.ins.key, d);
  const provGroupByKey = new Map<string, ProvGroup>();
  for (const g of provGroups) { const k = `provider:${g.provider}:${g.providerPaymentId}`; if (!provGroupByKey.has(k)) provGroupByKey.set(k, g); }
  const carrierOf = new Map<ProvGroup, Draft>();
  for (const d of drafts) if (d.prov && !carrierOf.has(d.prov) && (d.legs.provider?.state === "linked" || !d.ins)) carrierOf.set(d.prov, d);
  const reviewOfRecord = new Map<string, ReviewItem>();
  for (const rv of reviews) for (const c of rv.candidates) if (!reviewOfRecord.has(c.recordId)) reviewOfRecord.set(c.recordId, rv);
  const keysOfId = new Map<string, string[]>();
  for (const k of Object.keys(assigned)) keysOfId.set(assigned[k], [...(keysOfId.get(assigned[k]) ?? []), k]);
  const locate = (key: string): PaymentRedirect["to"] & { reason: PaymentRedirect["reason"] } | undefined => {
    const [kind, ...rest] = key.split(":");
    if (kind === "instruction") {
      const d = draftByInsKey.get(rest.join(":"));
      return d ? { kind: "payment", paymentId: d.paymentId, reason: "merged" } : undefined;
    }
    const g = provGroupByKey.get(key);
    if (!g) return undefined;
    const d = carrierOf.get(g);
    if (d) return { kind: "payment", paymentId: d.paymentId, reason: "merged" };
    // The first review (in review order) holding any of its records.
    const held = g.records.map((r) => reviewOfRecord.get(r.recordId)).filter((x): x is ReviewItem => !!x);
    const rv = held.sort((a, b) => reviews.indexOf(a) - reviews.indexOf(b))[0];
    return rv ? { kind: "review", reviewId: rv.reviewId, paymentId: rv.paymentId, reason: "held_in_review" } : undefined;
  };
  for (const id of everAssigned) {
    if (carried.has(id)) { delete redirects[id]; continue; }
    const at = (keysOfId.get(id) ?? []).map(locate).find(Boolean);
    if (at) {
      const { reason, ...to } = at;
      redirects[id] = { from: id, reason, to } as PaymentRedirect;
    } else {
      // Its records are gone. Keep where it last led only while that payment still exists.
      const last = redirects[id];
      const stillLeads = last && last.to.kind !== "none" && carried.has(last.to.paymentId);
      if (!stillLeads) redirects[id] = { from: id, reason: "unheld", to: { kind: "none" } };
    }
  }

  const used = new Set<string>([...reviewed, ...linkedAnywhere, ...awaitingFileA]);
  const duplicateRecords = [...all.values()].filter((r) => r.sources.length > 1).map((r) => ({ recordId: r.recordId, kind: r.kind, sources: r.sources }));
  const unlinked = [...all.values()].filter((r) => !used.has(r.recordId) && r.kind !== "chain_transfer").map((r) => ({ recordId: r.recordId, kind: r.kind }));
  return { payments, reviews, duplicateRecords, unlinked, paymentIds: assigned, redirects, ledgerLinks, unclassifiedLedger };
}

const legWord = (l?: Leg) => (l?.state === "needs_review" ? "needs review" : l?.state ?? "missing");

/** The one-line explanation shown wherever a retired ID is looked up. */
export function describeRedirect(r: PaymentRedirect): string {
  switch (r.reason) {
    case "merged": return `${r.from} merged into ${r.to.paymentId}`;
    case "held_in_review": return `${r.from} is held in review ${r.to.reviewId} on ${r.to.paymentId}`;
    case "unheld": return `${r.from} is no longer held: its records were cleared`;
  }
}

// Lookups by ID, built once per match result: resolving is called once per inbox item, so a linear
// scan here made the inbox sync cubic in the number of payments.
const indexes = new WeakMap<MatchResult, { payments: Map<string, CanonicalPayment>; reviews: Map<string, ReviewItem>; byPaymentLeg: Map<string, ReviewItem> }>();
function indexOf(result: MatchResult) {
  let ix = indexes.get(result);
  if (!ix) {
    ix = { payments: new Map(result.payments.map((p) => [p.paymentId, p])), reviews: new Map(result.reviews.map((r) => [r.reviewId, r])), byPaymentLeg: new Map() };
    for (const r of result.reviews) if (!ix.byPaymentLeg.has(`${r.paymentId}:${r.leg}`)) ix.byPaymentLeg.set(`${r.paymentId}:${r.leg}`, r);
    indexes.set(result, ix);
  }
  return ix;
}

/**
 * Resolve a payment ID or review ID from anywhere (a URL, an export, a review link) to the
 * payment that carries it now, following redirects. `via` lists the redirects followed.
 */
export function resolvePaymentRef(result: MatchResult, ref: string):
  { payment?: CanonicalPayment; review?: ReviewItem; via: PaymentRedirect[] } {
  const ix = indexOf(result);
  const via: PaymentRedirect[] = [];
  const seen = new Set<string>();
  let id = ref;
  let review: ReviewItem | undefined;
  // A review ID: REV-<payment>-<leg>. Current, or rebuilt from its payment part if that payment moved.
  const rev = /^REV-([0-9A-F]{10})-([a-z]+)$/.exec(ref);
  if (rev) {
    review = ix.reviews.get(ref);
    if (review) return { payment: ix.payments.get(review.paymentId), review, via };
    id = `PAY-${rev[1]}`;
  }
  while (!seen.has(id)) {
    seen.add(id);
    const payment = ix.payments.get(id);
    if (payment) {
      review ??= rev ? ix.byPaymentLeg.get(`${id}:${rev[2]}`) : undefined;
      return { payment, review, via };
    }
    const r = result.redirects?.[id];
    if (!r) break;
    via.push(r);
    if (r.to.kind === "none") break;
    if (r.to.kind === "review") review = ix.reviews.get((r.to as { reviewId: string }).reviewId);
    id = r.to.paymentId;
  }
  return { payment: undefined, review, via };
}

const latest = <T extends PaymentRecord>(rs: T[]) => rs[rs.length - 1];
const label = (d: Draft) => (d.ins ? `instruction ${d.ins.key}` : d.prov ? `${d.prov.provider} ${d.prov.providerPaymentId}` : d.paymentId);

export function describe(r: PaymentRecord): string {
  switch (r.kind) {
    case "instruction":
      return `Instruction ${r.instructionId}: ${displayAmount(r.amount)}${r.token ? ` ${r.token}` : ""}${r.chain ? ` on ${chainName(r.chain)}` : ""}`;
    case "provider":
      return `${r.provider} ${r.typeRaw ?? r.type} ${r.providerPaymentId}: status ${r.statusRaw}` +
        (r.statusMeaning === "provider_reports_complete" && r.type === "principal" ? " (provider reports complete; not proof of beneficiary credit)" :
          r.statusMeaning === "unmapped" ? " (status not in the mapping)" : "");
    case "chain_transfer":
      return r.transferIndex === undefined
        ? `${chainName(r.chain)} transaction ${short(r.txHash)}: ${r.txStatus}, no token transfer`
        : `${chainName(r.chain)} transfer ${displayAmount(r.amount ?? "")} ${r.token} to ${r.to} (${r.txStatus})`;
    case "bank":
      return `Bank ${r.direction} ${displayAmount(r.amount)} ${r.currency}, reference ${r.bankReference}${r.returnOf ? ` (return of ${r.returnOf})` : ""}`;
    case "ledger":
      return `${r.ledger === "payout" ? "Payout ledger" : "Deposit ledger"} entry ${r.entryId}: ${displayAmount(r.amount)}${r.currency ? ` ${r.currency}` : ""}, status ${r.status}` +
        (r.statusMeaning === "unmapped" ? " (status not in the mapping)" : "") + (r.reverses ? ` (reverses ${r.reverses})` : "");
  }
}
