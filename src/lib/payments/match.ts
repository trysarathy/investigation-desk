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
import { sameAddress } from "../address";
import { compareDecimal, isDecimal } from "../decimal";
import { CHAIN_NAMES } from "../types";
import type {
  BankRecord, Candidate, CanonicalPayment, ChainLookupSummary, ChainTransferRecord, InstructionRecord, Leg, LegName, Link,
  LedgerEntryRecord, MatchResult, PaymentRecord, ProviderRecord, ReviewItem, ReviewReason,
} from "./types";

export interface MatchInput {
  instructions: InstructionRecord[];
  provider: ProviderRecord[];
  bank: BankRecord[];
  chain: ChainTransferRecord[];
  lookups: ChainLookupSummary[];
  ledger?: LedgerEntryRecord[];
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
      const vals = new Set(sorted.map((r) => JSON.stringify(r[f] ?? null)));
      if (vals.size === 1) view[f] = sorted[0][f];
      else conflicts.push(String(f));
    }
    return { key: k, records: sorted, view, conflicts };
  });
}

const byEventTime = (a: PaymentRecord, b: PaymentRecord) =>
  (a.eventTime ? Date.parse(a.eventTime) : Infinity) - (b.eventTime ? Date.parse(b.eventTime) : Infinity) || (a.recordId < b.recordId ? -1 : 1);

const INSTRUCTION_FIELDS: (keyof InstructionRecord)[] = ["chain", "token", "toAddress", "amount", "txHash", "transferIndex", "providerPaymentId", "dueBy"];
// Status and event time may change between reports (a status history); these may not.
const PROVIDER_FIELDS: (keyof ProviderRecord)[] = ["merchantReference", "txHash", "chain", "transferIndex", "amount", "currency"];

type InsGroup = Group<InstructionRecord>;
type ProvGroup = Group<ProviderRecord> & { provider: string; providerPaymentId: string };

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
    score += 3; reasons.push(`same amount (${a.amount})`);
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

// ---- Chain references ----

interface ChainRef { txHash: string; chain?: string; transferIndex?: number; from: string }

type ChainResolution =
  | { kind: "link"; record: ChainTransferRecord; basis: "chain_tx_index" | "chain_tx_single_transfer" }
  | { kind: "missing"; note: string }
  | { kind: "unknown"; note: string }
  | { kind: "review"; reason: ReviewReason; message: string; candidates: ChainTransferRecord[] };

function resolveChain(ref: ChainRef, chain: ChainTransferRecord[], lookups: ChainLookupSummary[]): ChainResolution {
  const lookup = lookups.find((l) => l.txHash === ref.txHash);
  if (!lookup) return { kind: "unknown", note: `Transaction ${short(ref.txHash)} has not been checked on chain yet.` };
  if (lookup.result === "not_found") return { kind: "missing", note: `Transaction ${short(ref.txHash)} (from ${ref.from}) was not found on any supported chain.` };
  if (lookup.result === "pending") return { kind: "unknown", note: `Transaction ${short(ref.txHash)} is known to a node but not mined yet.` };
  if (lookup.result === "error") return { kind: "unknown", note: `Couldn't check transaction ${short(ref.txHash)}: ${lookup.error ?? "lookup failed"}` };
  const inTx = chain.filter((c) => c.txHash === ref.txHash);
  if (ref.chain && lookup.chain !== ref.chain) {
    return { kind: "review", reason: "chain_mismatch", candidates: inTx,
      message: `The ${ref.from} says ${chainName(ref.chain)}, but transaction ${short(ref.txHash)} is on ${chainName(lookup.chain)}.` };
  }
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
  returns: Link[];
  fees: Link[];
  linked: Set<string>;
}

export function matchPayments(input: MatchInput): MatchResult {
  const reviews: ReviewItem[] = [];
  const reviewed = new Set<string>();
  const addReview = (d: Draft, leg: LegName, reason: ReviewReason, message: string, candidates: Candidate[]) => {
    const reviewId = `REV-${d.paymentId.slice(4)}-${leg}`;
    reviews.push({ reviewId, paymentId: d.paymentId, leg, reason, message, candidates });
    for (const c of candidates) reviewed.add(c.recordId);
    d.legs[leg] = { state: "needs_review", reviewId };
  };

  const insGroups: InsGroup[] = groupBy(input.instructions, (r) => r.instructionId, INSTRUCTION_FIELDS);
  const principal = input.provider.filter((r) => r.type === "principal");
  const provGroups: ProvGroup[] = groupBy(principal, (r) => `${r.provider}\u0000${r.providerPaymentId}`, PROVIDER_FIELDS)
    .map((g) => ({ ...g, provider: g.records[0].provider, providerPaymentId: g.records[0].providerPaymentId }));
  const provRecs = (gs: ProvGroup[]) => gs.map((g) => latest(g.records));

  // 1. Instruction <-> provider. First every exact tie, then decide: a provider payment tied to
  //    two instructions (by either identifier) is contested, and both go to review.
  const drafts: Draft[] = insGroups.map((g) => ({
    paymentId: paymentIdFor(`instruction:${g.key}`), anchor: g.records[0], ins: g, legs: {}, returns: [], fees: [], linked: new Set(),
  }));
  const ties = new Map<Draft, { byRef: ProvGroup[]; byId: ProvGroup[]; namedIds: string[] }>();
  for (const d of drafts) {
    const g = d.ins!;
    const namedIds = [...new Set(g.records.map((r) => r.providerPaymentId).filter((x): x is string => !!x))];
    ties.set(d, {
      namedIds,
      byRef: provGroups.filter((p) => p.records.some((r) => r.merchantReference === g.key)),
      byId: provGroups.filter((p) => namedIds.includes(p.providerPaymentId)),
    });
  }
  const claimants = (p: ProvGroup) => drafts.filter((d) => ties.get(d)!.byRef.includes(p) || ties.get(d)!.byId.includes(p));

  for (const d of drafts) {
    const g = d.ins!;
    if (g.conflicts.length) {
      addReview(d, "instruction", "conflicting_record",
        `Instruction ${g.key} arrived ${g.records.length} times with different ${g.conflicts.join(", ")}.`,
        g.records.map((r) => ({ recordId: r.recordId, score: 0, reasons: [] })));
    } else {
      d.legs.instruction = { state: "linked", links: [{ recordId: g.records[0].recordId, basis: "anchor", detail: `Instruction ${g.key}` }] };
    }
    const { byRef, byId, namedIds } = ties.get(d)!;
    const union = [...new Set([...byRef, ...byId])];
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
    const d: Draft = { paymentId: paymentIdFor(`provider:${p.provider}:${p.providerPaymentId}`), anchor: latest(p.records), prov: p,
      legs: {}, returns: [], fees: [], linked: new Set() };
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

  // 3. On-chain leg, from the instruction's and the provider record's exact references.
  const chainProposals = new Map<Draft, { record: ChainTransferRecord; links: Link[] }>();
  for (const d of drafts) {
    const refs: ChainRef[] = [];
    if (d.ins) {
      if (d.ins.conflicts.some((f) => ["txHash", "chain", "transferIndex"].includes(f))) {
        addReview(d, "chain", "conflicting_record", `Versions of instruction ${d.ins.key} give different on-chain references.`,
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
    const res = resolveChain(merged, input.chain, input.lookups);
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
    if (claimants.length > 1) {
      addReview(d, "chain", "conflicting_ids",
        `${chainName(prop.record.chain)} transaction ${short(prop.record.txHash)} transfer ${prop.record.transferIndex ?? "(none)"} is named by ${claimants.length} payments (${claimants.map(label).join(", ")}).`,
        rank(d.anchor, [prop.record]));
    } else {
      d.chainLink = prop;
      d.legs.chain = { state: "linked", links: prop.links };
    }
  }

  // 4. Bank leg: an exact instruction ID or provider payment ID column. Free text is never parsed.
  const bankPrincipal = input.bank.filter((b) => !b.returnOf);
  const bankHits = new Map<BankRecord, Draft[]>();
  for (const b of bankPrincipal) {
    const hits = drafts.filter((d) => (b.instructionId && d.ins?.key === b.instructionId) ||
      (b.providerPaymentId && (d.prov?.providerPaymentId === b.providerPaymentId || d.ins?.view.providerPaymentId === b.providerPaymentId)));
    bankHits.set(b, hits);
  }
  for (const d of drafts) {
    const mine = bankPrincipal.filter((b) => bankHits.get(b)!.includes(d));
    const contested = mine.filter((b) => bankHits.get(b)!.length > 1);
    if (contested.length) {
      addReview(d, "bank", "conflicting_ids",
        `Bank record ${contested.map((b) => b.bankReference).join(", ")} carries identifiers of more than one payment.`, rank(d.anchor, contested));
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

  // 5. Ledger leg: the linked transfer's chain + hash + index.
  const ledger = input.ledger ?? [];
  for (const d of drafts) {
    if (!ledger.length) { d.legs.ledger = { state: "not_applicable" }; continue; }
    const t = d.chainLink?.record;
    if (!t) { d.legs.ledger = { state: "missing", suggestions: [], note: "No linked on-chain transfer to join the ledger on." }; continue; }
    const hits = ledger.filter((l) => l.chain === t.chain && l.txHash === t.txHash &&
      (l.transferIndex === t.transferIndex || (l.transferIndex === undefined && t.transfersInTx <= 1)));
    if (hits.length === 1) {
      d.legs.ledger = { state: "linked", links: [{ recordId: hits[0].recordId, basis: l2basis(hits[0]),
        detail: `Ledger ${hits[0].entryId} carries ${chainName(t.chain)} transaction ${short(t.txHash)}${hits[0].transferIndex !== undefined ? `, index ${hits[0].transferIndex}` : ""}` }] };
    } else if (hits.length > 1) {
      addReview(d, "ledger", "multiple_candidates", `${hits.length} ledger entries carry this transfer: ${hits.map((h) => h.entryId).join(", ")}.`, rank(d.anchor, hits));
    } else {
      d.legs.ledger = { state: "missing", suggestions: [] };
    }
  }

  // 6. Returns and fees: exact identifiers only.
  const others = input.provider.filter((r) => r.type !== "principal");
  for (const d of drafts) {
    const provIds = [d.prov?.providerPaymentId, d.ins?.view.providerPaymentId].filter(Boolean);
    for (const r of others) {
      const basis = r.relatesTo && provIds.includes(r.relatesTo) ? "provider_payment_id" as const
        : d.ins && r.merchantReference === d.ins.key ? "merchant_reference" as const : undefined;
      if (!basis || r.type === "other") continue;
      const link = { recordId: r.recordId, basis, detail: basis === "provider_payment_id" ? `${r.provider} ${r.type} row relates to ${r.relatesTo}` : `${r.provider} ${r.type} row carries merchant reference ${r.merchantReference}` };
      (r.type === "fee" ? d.fees : d.returns).push(link);
    }
    if (d.bankLink) {
      for (const b of input.bank.filter((x) => x.returnOf === d.bankLink!.bankReference)) {
        d.returns.push({ recordId: b.recordId, basis: "return_of", detail: `Bank ${b.bankReference} is a return of ${b.returnOf}` });
      }
    }
  }

  // 7. Assemble.
  const all = new Map<string, PaymentRecord>([...input.instructions, ...input.provider, ...input.bank, ...input.chain, ...ledger].map((r) => [r.recordId, r]));
  const payments: CanonicalPayment[] = drafts.map((d) => {
    const legs = { instruction: d.legs.instruction!, chain: d.legs.chain!, provider: d.legs.provider!, bank: d.legs.bank!, ledger: d.legs.ledger! };
    const ids = new Set<string>();
    for (const leg of Object.values(legs)) if (leg.state === "linked") for (const l of leg.links) ids.add(l.recordId);
    // Every version of a linked instruction or provider record belongs to the timeline.
    if (legs.instruction.state === "linked") for (const r of d.ins?.records ?? []) ids.add(r.recordId);
    if (legs.provider.state === "linked") for (const r of d.prov?.records ?? []) ids.add(r.recordId);
    for (const l of [...d.returns, ...d.fees]) ids.add(l.recordId);
    const recs = [...ids].map((id) => all.get(id)!).filter(Boolean).sort(byEventTime);
    return {
      paymentId: d.paymentId,
      anchor: { kind: d.anchor.kind, recordId: d.anchor.recordId },
      legs, returns: d.returns, fees: d.fees,
      identifiers: recs.flatMap((r) => r.identifiers.map((i) => ({ ...i, recordId: r.recordId, kind: r.kind }))),
      timeline: recs.map((r) => ({ recordId: r.recordId, kind: r.kind, eventTime: r.eventTime, observedTime: r.observedTime, label: describe(r) })),
      duplicateRecords: recs.filter((r) => r.sources.length > 1).map((r) => r.recordId),
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
  for (const p of payments) {
    const anchor = all.get(p.anchor.recordId);
    for (const leg of ["instruction", "provider", "chain", "bank"] as const) {
      const l = p.legs[leg];
      if (l.state === "missing") l.suggestions = suggestionsFrom(anchor, pool[leg].filter((r) => r.recordId !== p.anchor.recordId));
    }
  }

  const used = new Set<string>([...reviewed, ...linkedAnywhere]);
  const duplicateRecords = [...all.values()].filter((r) => r.sources.length > 1).map((r) => ({ recordId: r.recordId, kind: r.kind, sources: r.sources }));
  const unlinked = [...all.values()].filter((r) => !used.has(r.recordId) && r.kind !== "chain_transfer").map((r) => ({ recordId: r.recordId, kind: r.kind }));
  return { payments, reviews, duplicateRecords, unlinked };
}

const l2basis = (l: LedgerEntryRecord) => (l.transferIndex === undefined ? "chain_tx_single_transfer" as const : "chain_tx_index" as const);
const latest = <T extends PaymentRecord>(rs: T[]) => rs[rs.length - 1];
const label = (d: Draft) => (d.ins ? `instruction ${d.ins.key}` : d.prov ? `${d.prov.provider} ${d.prov.providerPaymentId}` : d.paymentId);

export function describe(r: PaymentRecord): string {
  switch (r.kind) {
    case "instruction":
      return `Instruction ${r.instructionId}: ${r.amount}${r.token ? ` ${r.token}` : ""}${r.chain ? ` on ${chainName(r.chain)}` : ""}`;
    case "provider":
      return `${r.provider} ${r.typeRaw ?? r.type} ${r.providerPaymentId}: status ${r.statusRaw}` +
        (r.statusMeaning === "provider_reports_complete" ? " (provider reports complete; not proof of beneficiary credit)" :
          r.statusMeaning === "unmapped" ? " (status not in the mapping)" : "");
    case "chain_transfer":
      return r.transferIndex === undefined
        ? `${chainName(r.chain)} transaction ${short(r.txHash)}: ${r.txStatus}, no token transfer`
        : `${chainName(r.chain)} transfer ${r.amount} ${r.token} to ${r.to} (${r.txStatus})`;
    case "bank":
      return `Bank ${r.direction} ${r.amount} ${r.currency}, reference ${r.bankReference}${r.returnOf ? ` (return of ${r.returnOf})` : ""}`;
    case "ledger":
      return `Ledger entry ${r.entryId}: ${r.amount}, status ${r.status}`;
  }
}
