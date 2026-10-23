// Exception rules (spec 23 Oct), computed from the matched payments. Pure: the same records,
// settings and clock give the same exceptions. Every exception carries its evidence (with the
// source of each fact), a confidence level and a next step.
//
//   missing_leg            an expected leg is missing: High when a later stage is already there
//                          (or the provider reports complete with no transfer), Medium once the
//                          route's grace has passed since the previous stage; none while in flight.
//   duplicate_record       the same record arrived more than once. v1 never reports a second
//                          payment: nothing in it proves one, so the wording never claims one.
//   amount_mismatch        linked legs in the same asset disagree, exactly, and no linked fee
//                          record or configured fee rule accounts for the difference.
//   fee_mismatch           fee records and the route's configured fee rule disagree.
//   overdue                the agreed deadline (the instruction's due_by, else the route's) has
//                          passed and an expected leg is still not linked.
//   unmatched_settlement   a provider record no instruction carries, or a bank, fee or return row
//                          no identifier ties to any payment.
//   unmatched_ledger_entry a payout-ledger entry no identifier ties to any payment (Medium).
//   contradiction          after the provider reported complete, a later return, cancellation or
//                          reversal arrived; or the transfer failed; or the ledger reversed a posting.
//   D01–D18                deposit investigations, one more family, from the case queue.

import { createHash } from "node:crypto";
import { nextStep as depositNextStep } from "../catalogue";
import { SAMPLE_SETTINGS } from "../fixtures";
import type { Code, Confidence } from "../types";
import { describe } from "./match";
import { abs, add, eq, isAmount, mulBps, sub, sum } from "./money";
import { routeFor, type ExceptionSettings, type RouteSetting } from "./settings";
import type { PaymentsData } from "./store";
import type {
  BankRecord, CanonicalPayment, ChainTransferRecord, InstructionRecord, LedgerEntryRecord, LegName, MatchResult, PaymentRecord,
  ProviderRecord, SourceRef,
} from "./types";

export type PaymentExceptionCode =
  | "missing_leg" | "duplicate_record" | "amount_mismatch" | "fee_mismatch" | "overdue" | "unmatched_settlement" | "unmatched_ledger_entry"
  | "contradiction";

export const EXCEPTION_LABELS: Record<PaymentExceptionCode, string> = {
  missing_leg: "Missing leg",
  duplicate_record: "Duplicate record",
  amount_mismatch: "Amount mismatch",
  fee_mismatch: "Fee mismatch",
  overdue: "Overdue",
  unmatched_settlement: "Unmatched settlement",
  unmatched_ledger_entry: "Unmatched ledger entry",
  contradiction: "Contradiction",
};

export interface ExceptionEvidence {
  label: string;
  value: string;
  recordId?: string;
  /** Where the fact comes from: "file.csv line 4 · mapping v1", or an explorer URL. */
  source?: string;
}

export type ExceptionSubject =
  | { kind: "payment"; paymentId: string }
  | { kind: "record"; recordId: string }
  | { kind: "case"; caseId: string; href: string };

export interface PaymentException {
  exceptionId: string;
  family: "payment" | "deposit";
  code: PaymentExceptionCode | Code;
  title: string;
  subject: ExceptionSubject;
  confidence: Confidence;
  evidence: ExceptionEvidence[];
  nextStep: string;
  /** What the condition is, without clocks: a change here is new evidence. */
  fingerprint: string;
  /** When the condition arose by its sources' own clocks, where known. */
  occurredAt?: string;
  /** Built from the prototype's sample cases, not company data. */
  sample?: boolean;
}

/** The deposit queue's rows, as the inbox needs them. */
export interface DepositCaseRow {
  id: string;
  customerId: string;
  chain: string | null;
  token: string | null;
  amount: string | null;
  code: Code;
  label: string;
  confidence: Confidence | null;
  paused: boolean;
  bucket: "needs_action" | "waiting" | "resolved" | "unknown";
  href?: string;
  live?: boolean;
}

export interface ExceptionInput {
  data: PaymentsData;
  settings: ExceptionSettings;
  now: Date;
  cases?: DepositCaseRow[];
}

const sha8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10).toUpperCase();
const minutes = (from: string, to: Date) => Math.floor((to.getTime() - Date.parse(from)) / 60_000);
const plusMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

export function sourceText(s: SourceRef): string {
  switch (s.kind) {
    case "file": return `${s.fileName} line ${s.line} · ${s.mappingId} v${s.mappingVersion}`;
    case "chain": return s.url;
    case "deposit_ledger": return `File B line ${s.line}`;
  }
}

/** Every record the payments were matched on, File B ledger rows included. */
export function recordsOf(data: PaymentsData): Map<string, PaymentRecord> {
  return new Map([
    ...data.records.instruction, ...data.records.provider, ...data.records.bank, ...(data.records.ledger ?? []),
    ...data.chain.transfers, ...(data.match?.depositLedger ?? []),
  ].map((r) => [r.recordId, r]));
}

const LEG_NOUN: Record<LegName, string> = {
  instruction: "instruction", provider: "provider record", chain: "on-chain transfer", ledger: "ledger entry", bank: "bank record",
};
const STAGES: LegName[] = ["instruction", "provider", "chain", "ledger"];
const MISSING_NEXT: Record<LegName, string> = {
  instruction: "Find the instruction this belongs to.",
  provider: "Ask the provider for its record of this payment, and check the instruction was submitted to it.",
  chain: "Ask the provider for the on-chain transaction hash, and check its payout queue.",
  ledger: "Book the payout in the ledger, or find out why it wasn't booked.",
  bank: "Find the bank movement for this payment, or confirm none is expected on this route.",
};

export function computeExceptions(input: ExceptionInput): PaymentException[] {
  const { data, settings, now } = input;
  const out: PaymentException[] = [];
  const result = data.match?.result;
  if (result) {
    const recs = recordsOf(data);
    for (const p of result.payments) out.push(...paymentExceptions(p, recs, settings, now));
    out.push(...duplicateExceptions(result, recs));
    out.push(...unlinkedExceptions(result, recs));
  }
  out.push(...depositExceptions(input.cases ?? []));
  return out.sort((a, b) => (a.exceptionId < b.exceptionId ? -1 : 1));
}

// ---- Per payment ----

interface View {
  p: CanonicalPayment;
  ins?: InstructionRecord;
  providerHistory: ProviderRecord[];
  provider?: ProviderRecord;
  transfer?: ChainTransferRecord;
  ledger?: LedgerEntryRecord;
  ledgerHistory: LedgerEntryRecord[];
  bank?: BankRecord;
  fees: ProviderRecord[];
  returns: PaymentRecord[];
  route: RouteSetting;
}

function viewOf(p: CanonicalPayment, recs: Map<string, PaymentRecord>, settings: ExceptionSettings): View {
  const linked = (leg: LegName) => (p.legs[leg].state === "linked" ? p.legs[leg].links.map((l) => recs.get(l.recordId)).filter(Boolean) as PaymentRecord[] : []);
  const anchor = recs.get(p.anchor.recordId);
  const ins = (linked("instruction")[0] ?? (anchor?.kind === "instruction" ? anchor : undefined)) as InstructionRecord | undefined;
  const timeline = p.timeline.map((t) => recs.get(t.recordId)).filter(Boolean) as PaymentRecord[];
  const providerHistory = timeline.filter((r): r is ProviderRecord => r.kind === "provider" && r.type === "principal");
  const ledger = linked("ledger")[0] as LedgerEntryRecord | undefined;
  const ledgerHistory = ledger ? timeline.filter((r): r is LedgerEntryRecord => r.kind === "ledger" && r.entryId === ledger.entryId && !r.reverses) : [];
  const provider = providerHistory.at(-1);
  const transfer = linked("chain")[0] as ChainTransferRecord | undefined;
  return {
    p, ins, providerHistory, provider, transfer, ledger, ledgerHistory,
    bank: linked("bank")[0] as BankRecord | undefined,
    fees: p.fees.map((l) => recs.get(l.recordId)).filter((r): r is ProviderRecord => r?.kind === "provider"),
    returns: p.returns.map((l) => recs.get(l.recordId)).filter(Boolean) as PaymentRecord[],
    route: routeFor(settings, { provider: provider?.provider, chain: ins?.chain ?? transfer?.chain, token: ins?.token ?? provider?.currency }),
  };
}

const ev = (label: string, r: PaymentRecord | undefined, value?: string): ExceptionEvidence =>
  r ? { label, value: value ?? describe(r), recordId: r.recordId, source: r.sources.map(sourceText).join("; ") } : { label, value: value ?? "—" };

function paymentExceptions(p: CanonicalPayment, recs: Map<string, PaymentRecord>, settings: ExceptionSettings, now: Date): PaymentException[] {
  const v = viewOf(p, recs, settings);
  const base = (code: PaymentExceptionCode, detail?: string) => ({
    exceptionId: `EXC-${p.paymentId.slice(4)}-${code}${detail ? `-${detail}` : ""}`, family: "payment" as const, code,
    subject: { kind: "payment" as const, paymentId: p.paymentId },
  });
  const routeEv: ExceptionEvidence = { label: "Route", value: `${v.route.name} (${v.route.routeId}${v.route.sample ? ", sample setting" : ""})` };
  const out: PaymentException[] = [];

  if (p.anchor.kind === "provider") {
    out.push(unmatchedProviderPayment(v, recs, base("unmatched_settlement")));
  }
  out.push(...missingLegs(v, recs, now, base, routeEv));
  const amount = amountRules(v, base, routeEv);
  out.push(...amount);
  const overdue = overdueRule(v, now, base, routeEv);
  if (overdue) out.push(overdue);
  const contradiction = contradictionRule(v, base);
  if (contradiction) out.push(contradiction);
  return out;
}

function timeOfStage(v: View, leg: LegName): string | undefined {
  switch (leg) {
    case "instruction": return v.ins?.eventTime;
    case "provider": {
      const done = v.providerHistory.find((r) => r.statusMeaning === "provider_reports_complete");
      return done?.eventTime ?? v.provider?.eventTime;
    }
    case "chain": return v.transfer?.eventTime;
    case "ledger": return v.ledger?.eventTime;
    case "bank": return v.bank?.eventTime;
  }
}

function missingLegs(v: View, recs: Map<string, PaymentRecord>, now: Date, base: (c: PaymentExceptionCode, d?: string) => object,
  routeEv: ExceptionEvidence): PaymentException[] {
  const { p, route } = v;
  const out: PaymentException[] = [];
  const providerComplete = v.providerHistory.some((r) => r.statusMeaning === "provider_reports_complete");
  for (const leg of route.expectedLegs) {
    const l = p.legs[leg];
    if (l.state !== "missing") continue;
    // A provider record with no instruction is an unmatched settlement, reported once as that.
    if (leg === "instruction" && p.anchor.kind === "provider") continue;
    const idx = STAGES.indexOf(leg);
    const laterLinked = idx < 0 ? [] : STAGES.slice(idx + 1).filter((x) => p.legs[x].state === "linked");
    const before = idx < 0 ? ["instruction" as LegName] : STAGES.slice(0, idx);
    const prevStage = [...before].reverse().find((x) => timeOfStage(v, x));
    const prevAt = prevStage ? timeOfStage(v, prevStage) : undefined;
    let title: string | undefined;
    let confidence: Confidence = "High";
    let why: string;
    if (leg === "chain" && providerComplete) {
      // A hash the chains all said they don't have is a fact; no hash at all is only an absence.
      const hashReported = !!v.ins?.txHash || v.providerHistory.some((r) => r.txHash);
      if (hashReported) {
        title = "Missing leg: provider reports complete, but its transaction is on no supported chain";
        why = "provider says complete; hash not on chain";
      } else {
        title = "Missing leg: provider reports complete, but no transaction hash was reported";
        confidence = "Medium";
        why = "provider says complete; no hash reported";
      }
    } else if (laterLinked.length) {
      title = `Missing leg: no ${LEG_NOUN[leg]}, though the ${laterLinked.map((x) => LEG_NOUN[x]).join(" and ")} ${laterLinked.length > 1 ? "are" : "is"} linked`;
      why = `later stage ${laterLinked.join(",")}`;
    } else if (idx >= 0 && STAGES.slice(0, idx).some((x) => route.expectedLegs.includes(x) && p.legs[x].state === "missing")) {
      // Stuck at an earlier stage: that stage is the exception, not every stage after it.
      continue;
    } else if (prevAt && minutes(prevAt, now) > route.graceMinutes) {
      title = `Missing leg: no ${LEG_NOUN[leg]} ${minutes(prevAt, now)} minutes after the ${LEG_NOUN[prevStage!]}`;
      confidence = "Medium";
      why = `grace ${route.graceMinutes} after ${prevStage} ${prevAt}`;
    } else {
      continue;
    }
    const stage = idx < 0 ? "outside the payout stages" : `stage ${idx + 1} of ${STAGES.length} (${STAGES.map((x) => LEG_NOUN[x]).join(" → ")})`;
    const evidence: ExceptionEvidence[] = [
      { label: "Missing", value: `${LEG_NOUN[leg]}, ${stage}` },
      ...(l.note ? [{ label: "Why it's missing", value: l.note }] : []),
      ...linkedEvidence(v),
      ...(prevAt ? [{ label: "Previous stage", value: `${LEG_NOUN[prevStage!]} at ${prevAt}` }] : []),
      routeEv,
      ...l.suggestions.map((s) => ev("Similar record, not linked (ranking only)", recs.get(s.recordId), `${recs.get(s.recordId) ? describe(recs.get(s.recordId)!) : s.recordId} · ${s.reasons.join(", ")}`)),
    ];
    out.push({
      ...(base("missing_leg", leg) as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
      title, confidence, evidence,
      nextStep: why.endsWith("no hash reported") ? "Ask the provider for the on-chain transaction hash; until then the transfer can't be checked." : MISSING_NEXT[leg],
      fingerprint: `missing ${leg}: ${why}`, occurredAt: prevAt,
    });
  }
  return out;
}

function linkedEvidence(v: View): ExceptionEvidence[] {
  return [
    ...(v.ins ? [ev("Instruction", v.ins)] : []),
    ...(v.provider ? [ev("Provider (latest status)", v.provider)] : []),
    ...(v.transfer ? [ev("On-chain transfer", v.transfer)] : []),
    ...(v.ledger ? [ev("Ledger", v.ledger)] : []),
    ...(v.bank ? [ev("Bank", v.bank)] : []),
  ];
}

// ---- Amounts and fees ----

interface Amount { leg: string; amount: string; asset?: string; record: PaymentRecord }

function amountsOf(v: View): Amount[] {
  const out: Amount[] = [];
  if (v.ins && v.p.legs.instruction.state === "linked") out.push({ leg: "Instruction", amount: v.ins.amount, asset: v.ins.token, record: v.ins });
  if (v.provider && v.p.legs.provider.state === "linked") out.push({ leg: "Provider", amount: abs(v.provider.amount), asset: v.provider.currency, record: v.provider });
  if (v.transfer?.amount) out.push({ leg: "On-chain", amount: v.transfer.amount, asset: v.transfer.token, record: v.transfer });
  if (v.ledger) out.push({ leg: "Ledger", amount: abs(v.ledger.amount), asset: v.ledger.currency, record: v.ledger });
  if (v.bank) out.push({ leg: "Bank", amount: v.bank.amount, asset: v.bank.currency, record: v.bank });
  return out.filter((a) => isAmount(a.amount));
}

function expectedFee(route: RouteSetting, reference: string): string | undefined {
  if (route.fee.kind === "fixed") return route.fee.amount;
  if (route.fee.kind === "percent_bps") return mulBps(reference, route.fee.bps);
  return undefined;
}

function amountRules(v: View, base: (c: PaymentExceptionCode, d?: string) => object, routeEv: ExceptionEvidence): PaymentException[] {
  // Compare within each asset: the instruction (when it names a token), provider, transfer, ledger
  // and bank amounts that share an asset. A leg with no asset, or alone in its asset, isn't compared.
  const amounts = amountsOf(v);
  const groups = new Map<string, Amount[]>();
  for (const a of amounts) if (a.asset) groups.set(a.asset.toUpperCase(), [...(groups.get(a.asset.toUpperCase()) ?? []), a]);
  const evidence: ExceptionEvidence[] = amounts.filter((a) => !a.asset).map((a) => ev(`${a.leg} (not compared: no asset)`, a.record, a.amount));
  const titles: string[] = [];
  const prints: string[] = [];
  const out: PaymentException[] = [];
  const feeNotes: ExceptionEvidence[] = [];
  for (const [asset, members] of groups) {
    const [ref, ...rest] = members;
    if (!rest.length) {
      evidence.push(ev(`${ref.leg} (not compared: no other ${ref.asset} amount)`, ref.record, `${ref.amount} ${ref.asset}`));
      continue;
    }
    const feeRows = v.fees.filter((f) => isAmount(f.amount) && (!f.currency || f.currency.toUpperCase() === asset));
    const feeSum = feeRows.length ? sum(feeRows.map((f) => abs(f.amount))) : undefined;
    const ruleFee = expectedFee(v.route, ref.amount);
    const mismatches: string[] = [];
    const mismatchValues: string[] = [];
    evidence.push(ev(`${ref.leg} (reference for ${ref.asset})`, ref.record, `${ref.amount} ${ref.asset}`));
    for (const a of rest) {
      const diff = sub(ref.amount, a.amount);
      if (eq(diff, "0")) { evidence.push(ev(`${a.leg} (matches)`, a.record, `${a.amount} ${a.asset}`)); continue; }
      const byRecord = feeSum !== undefined && eq(abs(diff), feeSum);
      const byRule = !byRecord && ruleFee !== undefined && eq(abs(diff), ruleFee);
      if (byRecord || byRule) {
        evidence.push(ev(`${a.leg} (differs by ${abs(diff)}, explained by ${byRecord ? "the fee record" : "the route's fee rule"})`, a.record, `${a.amount} ${a.asset}`));
        continue;
      }
      mismatches.push(`${a.leg} ${a.amount}`);
      mismatchValues.push(a.amount);
      evidence.push(ev(`${a.leg} (differs by ${diff})`, a.record, `${a.amount} ${a.asset}`));
    }
    feeNotes.push(
      { label: `Fee records linked (${ref.asset})`, value: feeSum !== undefined ? `${feeSum} ${ref.asset} (${feeRows.map((f) => f.providerPaymentId).join(", ")})` : "none" },
      { label: "Configured fee rule", value: ruleFee !== undefined ? `${ruleFee} ${ref.asset} (${v.route.fee.kind})` : "none" },
    );
    if (mismatches.length) {
      titles.push(`${ref.leg.toLowerCase()} ${ref.amount} ${ref.asset} vs ${mismatches.join(", ")}`);
      // The facts, not the wording: which leg happens to be the reference (instruction before a
      // merge, provider after it) must not change the key, or a person's close would be reopened.
      const values = [...new Set([ref.amount, ...mismatchValues].map((x) => add(x, "0")))].sort();
      prints.push(`${asset}: ${values.join(" ")} fees=${feeSum ?? "-"} rule=${ruleFee ?? "-"}`);
    }
    if (feeSum !== undefined && ruleFee !== undefined && !eq(feeSum, ruleFee)) {
      out.push({
        ...(base("fee_mismatch") as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
        title: `Fee mismatch: provider charged ${feeSum} ${ref.asset}, the route's rule gives ${ruleFee}`,
        confidence: "High",
        evidence: [
          ...feeRows.map((f) => ev("Fee record", f)),
          { label: "Configured fee rule", value: `${v.route.fee.kind === "fixed" ? `fixed ${v.route.fee.amount}` : `${(v.route.fee as { bps: number }).bps} bps of ${ref.amount}`} = ${ruleFee} ${ref.asset}` },
          { label: "Difference", value: sub(feeSum, ruleFee) }, routeEv,
        ],
        nextStep: "Check the fee against the provider's agreed pricing; correct the route's fee rule or raise the overcharge with the provider.",
        fingerprint: `fees ${feeSum} vs rule ${ruleFee}`,
      });
    }
  }
  if (titles.length) {
    out.unshift({
      ...(base("amount_mismatch") as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
      title: `Amount mismatch: ${titles.join("; ")}`,
      confidence: "High",
      evidence: [...evidence, ...feeNotes, routeEv],
      nextStep: "Compare with the provider's statement. A difference no fee record or configured fee rule explains needs a correction or a recorded explanation.",
      fingerprint: `amounts ${prints.join(" | ")}`,
    });
  }
  return out;
}

// ---- Deadlines ----

function overdueRule(v: View, now: Date, base: (c: PaymentExceptionCode, d?: string) => object, routeEv: ExceptionEvidence): PaymentException | undefined {
  if (v.p.anchor.kind !== "instruction" || !v.ins?.eventTime) return undefined;
  const deadline = v.ins.dueBy ?? plusMinutes(v.ins.eventTime, v.route.deadlineMinutes);
  // A leg with no records of its kind imported can't be judged either way: it's noted, not counted.
  const outstanding = v.route.expectedLegs.filter((l) => v.p.legs[l].state !== "linked" && v.p.legs[l].state !== "not_applicable");
  const unchecked = v.route.expectedLegs.filter((l) => v.p.legs[l].state === "not_applicable");
  if (!outstanding.length || now.getTime() <= Date.parse(deadline)) return undefined;
  // A leg whose lookup failed is unknown, not missing: it may already be there.
  const waiting = outstanding.filter((l) => v.p.legs[l].state !== "unknown");
  const unknown = outstanding.filter((l) => v.p.legs[l].state === "unknown");
  // Why each is unknown: a lookup that failed, or the transfer's direction can't be told (File A not
  // loaded, or no block time to check File A's dates), so deposit ledger rows can't be classified.
  const direction = (l: LegName) => { const leg = v.p.legs[l]; return leg.state === "unknown" ? /^(File A not loaded|No block time)/.exec(leg.note)?.[1] : undefined; };
  const noFileA = (l: LegName) => direction(l) === "File A not loaded";
  const why = (l: LegName) => direction(l) === "File A not loaded" ? "File A not loaded"
    : direction(l) ? "the transfer has no block time to check against File A" : `the ${l === "chain" ? "on-chain" : LEG_NOUN[l]} lookup failed`;
  const failed = [...new Set(unknown.map(why))].join(" and ");
  const reached = [...STAGES].reverse().find((l) => v.p.legs[l].state === "linked");
  return {
    ...(base("overdue") as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
    title: waiting.length
      ? `Overdue: due ${deadline}, still waiting for the ${waiting.map((l) => LEG_NOUN[l]).join(", ")}${unknown.length ? ` (${failed})` : ""}`
      : `Overdue: due ${deadline}; not confirmed complete because ${failed}`,
    confidence: waiting.length ? "High" : "Medium",
    evidence: [
      ev("Instruction", v.ins),
      { label: "Deadline", value: v.ins.dueBy ? `${deadline} (the instruction's due_by)` : `${deadline} (created ${v.ins.eventTime} + ${v.route.deadlineMinutes} minutes, route ${v.route.routeId})` },
      { label: "Checked at", value: now.toISOString() },
      { label: "Stage reached", value: reached ? LEG_NOUN[reached] : "none" },
      ...waiting.map((l) => ({ label: `Not linked: ${LEG_NOUN[l]}`, value: v.p.legs[l].state.replace("_", " ") })),
      ...unknown.map((l) => { const leg = v.p.legs[l]; return { label: `Unknown: ${LEG_NOUN[l]}`, value: leg.state === "unknown" ? leg.note : "lookup failed" }; }),
      ...unchecked.map((l) => ({ label: `Not checked: ${LEG_NOUN[l]}`, value: `no ${l} records imported` })),
      routeEv,
    ],
    nextStep: waiting.length
      ? `Chase the ${LEG_NOUN[waiting[0]]}${v.provider ? ` with ${v.provider.provider}` : ""}: the agreed deadline has passed.`
      : unknown.some(noFileA) ? "Load File A so deposit ledger rows can be matched: the payment may already be complete."
      : "Re-run matching once the chain answers: the payment may already be complete.",
    // The deadline and what's outstanding define it; the clock doesn't.
    fingerprint: `overdue ${deadline} outstanding=${outstanding.join(",")}`,
    occurredAt: deadline,
  };
}

// ---- Contradictions ----

const REVERSING = new Set(["cancelled", "expired", "returned"]);

function contradictionRule(v: View, base: (c: PaymentExceptionCode, d?: string) => object): PaymentException | undefined {
  const completed = v.providerHistory.find((r) => r.statusMeaning === "provider_reports_complete");
  const facts: { label: string; what: string; record: PaymentRecord; at?: string }[] = [];
  if (completed?.eventTime) {
    const t = Date.parse(completed.eventTime);
    for (const r of v.providerHistory) {
      if (r.eventTime && Date.parse(r.eventTime) > t && REVERSING.has(r.statusMeaning)) {
        facts.push({ label: "Later status", what: `${r.provider} later reported ${r.statusRaw}`, record: r, at: r.eventTime });
      }
    }
    for (const r of v.returns) {
      if (r.eventTime && Date.parse(r.eventTime) > t) facts.push({ label: "Later return", what: `A return arrived later: ${describe(r)}`, record: r, at: r.eventTime });
    }
    if (v.transfer?.txStatus === "failed") facts.push({ label: "Transaction failed", what: "The on-chain transaction failed", record: v.transfer, at: v.transfer.eventTime });
  }
  const posted = v.ledgerHistory.find((r) => r.statusMeaning === "posted");
  if (posted?.eventTime) {
    for (const r of v.ledgerHistory) {
      if (r.eventTime && Date.parse(r.eventTime) > Date.parse(posted.eventTime) && (r.statusMeaning === "reversed" || r.statusMeaning === "failed")) {
        facts.push({ label: "Ledger reversal", what: `The ledger later marked entry ${r.entryId} ${r.status}`, record: r, at: r.eventTime });
      }
    }
  }
  if (!facts.length) return undefined;
  // Earliest by instant, not by text: offsets differ between sources.
  const first = facts.filter((f) => f.at).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))[0]?.at;
  return {
    ...(base("contradiction") as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
    title: completed
      ? `Contradiction: ${completed.provider} reported ${completed.statusRaw} at ${completed.eventTime}, then ${facts[0].what.charAt(0).toLowerCase()}${facts[0].what.slice(1)}`
      : `Contradiction: ${facts[0].what}`,
    confidence: "High",
    evidence: [
      ...(completed ? [ev("Reported complete", completed)] : []),
      ...(posted ? [ev("Ledger posted", posted)] : []),
      ...facts.map((f) => ev(f.label, f.record)),
    ],
    nextStep: "Treat the payment as not completed: confirm with the provider whether the beneficiary was credited, and rebook or reverse in the ledger to match.",
    fingerprint: `contradiction ${facts.map((f) => f.record.recordId).sort().join(" ")}`,
    occurredAt: first,
  };
}

// ---- Settlements no instruction or identifier explains ----

function unmatchedProviderPayment(v: View, recs: Map<string, PaymentRecord>, base: object): PaymentException {
  const r = v.provider ?? (recs.get(v.p.anchor.recordId) as ProviderRecord);
  const l = v.p.legs.instruction;
  return {
    ...(base as Pick<PaymentException, "exceptionId" | "family" | "code" | "subject">),
    title: `Unmatched settlement: ${r.provider} ${r.providerPaymentId} (${r.statusRaw}) has no instruction`,
    confidence: "High",
    evidence: [
      ev("Provider record", r),
      ...(l.state === "missing" && l.note ? [{ label: "Why no instruction", value: l.note }] : []),
      ...(l.state === "missing" ? l.suggestions.map((s) => ev("Similar instruction, not linked (ranking only)", recs.get(s.recordId), `${recs.get(s.recordId) ? describe(recs.get(s.recordId)!) : s.recordId} · ${s.reasons.join(", ")}`)) : []),
    ],
    nextStep: "Find the instruction this settlement belongs to (its merchant reference must match), or ask the provider what it was for.",
    fingerprint: `unmatched provider ${r.provider}:${r.providerPaymentId} ref=${r.merchantReference ?? "-"}`,
    occurredAt: r.eventTime,
  };
}

function unlinkedExceptions(result: MatchResult, recs: Map<string, PaymentRecord>): PaymentException[] {
  const ledger = result.unlinked
    .map((u) => recs.get(u.recordId))
    .filter((r): r is LedgerEntryRecord => r?.kind === "ledger" && r.ledger === "payout")
    .map((r) => ({
      exceptionId: `EXC-R${sha8(r.recordId)}-unmatched_ledger_entry`, family: "payment" as const, code: "unmatched_ledger_entry" as const,
      subject: { kind: "record" as const, recordId: r.recordId },
      title: `Unmatched ledger entry: ${describe(r)}`,
      // A booking with nothing to tie it may just be missing its identifier: Medium.
      confidence: "Medium" as const,
      evidence: [
        ev("Ledger entry", r),
        { label: "Why unmatched", value: r.reverses ? `It reverses ${r.reverses}, which no payment's ledger leg carries.`
          : "No instruction ID, provider payment ID or transfer on it matches an outbound payment." },
      ],
      nextStep: "Find the payment this booking belongs to and add its instruction ID or provider payment ID to the ledger export.",
      fingerprint: `unlinked ledger ${r.recordId}`,
      occurredAt: r.eventTime,
    }));
  return [...ledger, ...result.unlinked
    .map((u) => recs.get(u.recordId))
    .filter((r): r is BankRecord | ProviderRecord => r?.kind === "bank" || r?.kind === "provider")
    .map((r) => ({
      exceptionId: `EXC-R${sha8(r.recordId)}-unmatched_settlement`, family: "payment" as const, code: "unmatched_settlement" as const,
      subject: { kind: "record" as const, recordId: r.recordId },
      title: `Unmatched settlement: ${describe(r)}`,
      confidence: "High" as const,
      evidence: [
        ev(r.kind === "bank" ? "Bank record" : "Provider record", r),
        { label: "Why unmatched", value: r.kind === "bank"
          ? "No instruction ID or provider payment ID column ties it to a payment. Free text is never read as a link."
          : r.relatesTo ? `It relates to ${r.relatesTo}, which no payment carries.` : "No identifier ties it to a payment." },
      ],
      nextStep: r.kind === "bank" ? "Find the payment this bank movement belongs to and add its identifier to the bank export." : "Ask the provider which payment this row belongs to.",
      fingerprint: `unlinked ${r.recordId}`,
      occurredAt: r.eventTime,
    }))];
}

function duplicateExceptions(result: MatchResult, recs: Map<string, PaymentRecord>): PaymentException[] {
  return result.duplicateRecords.map((d) => {
    const r = recs.get(d.recordId);
    const payment = result.payments.find((p) => p.timeline.some((t) => t.recordId === d.recordId));
    return {
      exceptionId: payment ? `EXC-${payment.paymentId.slice(4)}-duplicate_record-${sha8(d.recordId)}` : `EXC-R${sha8(d.recordId)}-duplicate_record`,
      family: "payment" as const, code: "duplicate_record" as const,
      subject: payment ? { kind: "payment" as const, paymentId: payment.paymentId } : { kind: "record" as const, recordId: d.recordId },
      title: `Duplicate record: ${r ? describe(r) : d.recordId} arrived ${d.sources.length} times`,
      confidence: "High" as const,
      evidence: [
        ...(r ? [ev("Record", r)] : []),
        ...d.sources.map((s, i) => ({ label: `Copy ${i + 1}`, value: sourceText(s) })),
        { label: "One record, not two payments", value: "Every copy has the same identifier and the same content: one record, seen more than once. Nothing here shows a second payment." },
      ],
      nextStep: "Check whether the source repeats the row (for example overlapping exports). It is kept as one record.",
      fingerprint: `duplicate ${d.recordId} x${d.sources.length}`,
      occurredAt: r?.eventTime,
    };
  });
}

// ---- Deposit investigations ----

function depositExceptions(cases: DepositCaseRow[]): PaymentException[] {
  return cases.filter((c) => !c.paused && (c.bucket === "needs_action" || c.bucket === "unknown")).map((c) => ({
    exceptionId: `EXC-${c.id}-${c.code}`, family: "deposit" as const, code: c.code,
    subject: { kind: "case" as const, caseId: c.id, href: c.href ?? `/cases/${c.id}` },
    title: `${c.code} ${c.label}`,
    confidence: c.confidence ?? "Medium",
    evidence: [
      { label: "Customer", value: c.customerId },
      { label: "Transfer", value: [c.amount, c.token, c.chain].filter(Boolean).join(" ") || "—" },
      { label: "Investigation", value: c.live ? "Live case from a bulk run" : "Sample case (prototype data)" },
    ],
    nextStep: depositNextStep(c.code, SAMPLE_SETTINGS),
    fingerprint: `deposit ${c.code} ${c.confidence ?? "-"}`,
    sample: !c.live,
  }));
}

