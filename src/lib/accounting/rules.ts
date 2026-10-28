// The posting rules: from a payment request and the transfers that pay it, to the exact lines that
// go into the books. Pure functions (no clock, no network), so every rule is tested directly.
//
// The rules, in plain English:
//  - Exact: one payment, applied to the invoice, with the tx hash, token, network and USD value.
//  - Short: the transfer posts as a PARTIAL payment and a note goes on the invoice; the invoice stays
//    open. If a person accepted the short payment as settled, the shortfall posts as a separate
//    fee write-off line and the invoice closes.
//  - Over / duplicate: the invoice amount posts once; the excess is a separate overpayment line
//    (refund due, or customer credit). Nothing posts until a person has decided which.
//  - Duplicate delivery of the same transfer: never posts twice (one line per transfer, ever).
//  - Wrong network, counterfeit token, failed transfer: never posted.
//  - No reference: nothing posts until a person confirms which invoice the payment is for.
//  - Only USD invoices; only dollar stablecoins valued at par unless a price says otherwise, and a
//    token trading away from par blocks automatic posting.

import { createHash } from "node:crypto";
import { compareDecimal } from "../decimal";
import { add, sub } from "../payments/money";
import { deriveRequest, formatUsdc } from "../requests/lifecycle";
import type { Observation, RequestsData } from "../requests/types";
import type { AccountingData, AccountSettings, PostedLine, PostingLine, PostingPlan } from "./types";

/** USD value of one token at a moment. Dollar stablecoins default to par, and say so. */
export interface UsdRate { rate: string; source: string }
export type PriceSource = (token: string, at: string) => UsdRate;
export const parPrice: PriceSource = (token) => ({ rate: "1.00", source: `par: 1 ${token} = 1.00 USD (no price feed connected)` });

/** How far from par a dollar stablecoin may trade before posting stops for a person to check: 0.5%. */
export const DEPEG_LIMIT = "0.005";

const NETWORK: Record<string, string> = { ethereum: "Ethereum", tron: "Tron" };

/** Signed comparison of two decimal strings. */
export function cmp(a: string, b: string): -1 | 0 | 1 {
  const d = sub(a, b);
  if (/^-?0+(\.0+)?$/.test(d)) return 0;
  return d.startsWith("-") ? -1 : 1;
}
const min = (a: string, b: string) => (cmp(a, b) <= 0 ? a : b);
const positive = (a: string) => cmp(a, "0") > 0;

/** Round down to cents: a posted payment must never be more than what arrived. */
export function floorCents(a: string): string {
  const [i, f = ""] = a.replace(/^-/, "").split(".");
  const s = BigInt(i + (f + "00").slice(0, 2)).toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Round a decimal to 2 places, half up (accounting systems post cents). */
export function toCents(a: string): string {
  const neg = a.startsWith("-");
  const [i, f = ""] = a.replace(/^-/, "").split(".");
  let cents = BigInt(i + (f + "00").slice(0, 2));
  if ((f[2] ?? "0") >= "5") cents += 1n;
  const s = cents.toString().padStart(3, "0");
  const out = `${s.slice(0, -2)}.${s.slice(-2)}`;
  return neg && out !== "0.00" ? `-${out}` : out;
}

const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

/** What already went into the books for a request, from the audit log. */
export function postedFor(acct: AccountingData, requestId: string): PostedLine[] {
  return acct.audit.filter((e) => e.kind === "posted" && e.requestId === requestId).flatMap((e) => e.lines ?? []);
}

export function idempotencyKeyFor(requestId: string, lines: PostingLine[]): string {
  const canon = lines.map((l) => [l.kind, l.amount, l.observationKey ?? "", l.accountCode ?? ""].join("|")).join(";");
  return `clearline-${createHash("sha256").update(`${requestId};${canon}`).digest("hex").slice(0, 32)}`;
}

export interface PlanOptions {
  threshold: number;
  price?: PriceSource;
}

/** Apply the posting rules to one request. */
export function planPosting(data: RequestsData, acct: AccountingData, requestId: string, o: PlanOptions): PostingPlan {
  const plan = (status: PostingPlan["status"], reasons: string[], lines: PostingLine[] = [], leavesOpen = false): PostingPlan =>
    ({ requestId, status, reasons, lines, leavesOpen, idempotencyKey: idempotencyKeyFor(requestId, lines) });

  const r = data.requests[requestId];
  if (!r) return plan("blocked", ["No such request."]);
  const link = acct.links[requestId];
  if (!link) return plan("not_linked", ["This request wasn't made from an invoice in the books, so there is nothing to post it to."]);
  if (link.currency.toUpperCase() !== "USD") {
    return plan("blocked", [`Invoice ${link.invoiceNumber} is in ${link.currency}. Only USD invoices are posted automatically for now (USDC and USDT are dollar tokens). Post it by hand.`]);
  }

  const price = o.price ?? parPrice;
  const accounts: AccountSettings = acct.accounts;
  const v = deriveRequest(data, r, o.threshold);
  const already = postedFor(acct, requestId);
  const reasons: string[] = [];

  // Transfers that must never reach the books.
  const neverKinds = new Set(["counterfeit", "wrong_network", "failed", "wrong_token"]);
  const never = v.flagged.filter((f) => neverKinds.has(f.kind));
  for (const f of never) {
    const why = f.kind === "counterfeit" ? `it isn't genuine ${r.token}`
      : f.kind === "wrong_network" ? `it was sent on ${NETWORK[f.obs.chain] ?? f.obs.chain}, not Ethereum`
      : f.kind === "failed" ? "the transaction failed on-chain" : `${f.obs.tokenSymbol} isn't the token requested`;
    reasons.push(`Transfer ${shortHash(f.obs.hash)} (${formatUsdc(f.obs.amount)} ${f.obs.tokenSymbol}) is never posted: ${why}.`);
  }
  if (r.decisions.some((d) => d.kind === "accept_other_network")) {
    reasons.push("A person accepted the wrong-network payment. Clearline never posts a payment from another network automatically: post it by hand if the money really is yours.");
  }

  const confirmed = v.counted.filter((x) => x.blockNumber !== undefined && x.confirmations >= o.threshold);
  if (confirmed.length === 0) {
    if (never.length) return plan("never", reasons);
    const other = v.flagged.filter((f) => !neverKinds.has(f.kind));
    for (const f of other) reasons.push(`Transfer ${shortHash(f.obs.hash)} is flagged (${f.problem}). Nothing posts until a person resolves it.`);
    if (other.length) return plan("waiting", reasons);
    if (positive(v.pending)) reasons.push(`${formatUsdc(v.pending)} ${r.token} is still confirming. Nothing posts until it is confirmed.`);
    else if (v.ambiguous.length) reasons.push("A transfer could belong to this invoice or another one. Nothing posts until a person decides.");
    else reasons.push("No confirmed payment for this invoice yet. A payment with no reference posts only after a person confirms which invoice it pays.");
    return plan("waiting", reasons);
  }

  // Price check: dollar stablecoins at (or near) par only.
  const rates = new Map<string, ReturnType<PriceSource>>();
  for (const x of confirmed) {
    const p = price(r.token, x.blockTime ?? x.firstSeenAt);
    rates.set(x.key, p);
    const off = sub(p.rate, "1").replace(/^-/, "");
    if (cmp(off, DEPEG_LIMIT) > 0) {
      return plan("blocked", [...reasons, `${r.token} was worth ${p.rate} USD when ${shortHash(x.hash)} was paid (${p.source}). That's more than 0.5% from par, so a person must post this one by hand.`]);
    }
  }

  const has = (k: string) => r.decisions.some((d) => d.kind === k);
  const lastDecision = (k: string) => [...r.decisions].reverse().find((d) => d.kind === k);
  const lines: PostingLine[] = [];
  const net = NETWORK[r.chain] ?? r.chain;
  const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);

  // One payment line per transfer, applied until the invoice is covered; the rest is excess.
  // Cents: each payment line is the rounded-down running total minus what earlier lines posted, so the
  // lines never add up to more than arrived; when the invoice is fully covered the last line closes it exactly.
  let remaining = r.amount;
  let applied = "0";
  let postedCents = "0.00";
  const excess: { obs: Observation; amount: string }[] = [];
  for (const x of confirmed) {
    const rate = rates.get(x.key)!;
    const apply = positive(remaining) ? min(x.amount, remaining) : "0";
    if (positive(apply)) {
      applied = add(applied, apply);
      const upTo = cmp(applied, r.amount) === 0 ? toCents(r.amount) : floorCents(applied);
      const cents = toCents(sub(upTo, postedCents));
      postedCents = upTo;
      lines.push({
        kind: "payment", amount: cents, accountCode: accounts.walletAccountCode, observationKey: x.key,
        txHash: x.hash, token: r.token, network: net, tokenAmount: x.amount, usdRate: rate.rate, usdRateSource: rate.source, date: day(x),
        description: `${formatUsdc(x.amount)} ${r.token} on ${net}, tx ${x.hash}. USD value ${cents} at ${rate.rate} (${rate.source}).`,
      });
      remaining = sub(remaining, apply);
    }
    const extra = sub(x.amount, apply);
    if (positive(extra)) excess.push({ obs: x, amount: extra });
  }

  const received = v.received;
  let leavesOpen = false;
  let status: PostingPlan["status"] = "ready";
  const lastObs = confirmed[confirmed.length - 1];

  if (cmp(received, r.amount) < 0) {
    const shortfall = sub(r.amount, received);
    if (has("accept_short")) {
      const d = lastDecision("accept_short")!;
      lines.push({
        kind: "fee_writeoff", amount: toCents(shortfall), accountCode: accounts.feeAccountCode, date: day(lastObs),
        description: `Shortfall of ${formatUsdc(shortfall)} ${r.token} accepted as settled by ${d.by}${d.note ? `: ${d.note}` : ""}. Written off as fees.`,
      });
      reasons.push(`Short by ${formatUsdc(shortfall)} ${r.token}. ${d.by} accepted it as settled, so the shortfall posts as a separate fee line and the invoice closes.`);
    } else {
      leavesOpen = true;
      const asked = has("request_balance");
      lines.push({
        kind: "note", amount: "0", date: day(lastObs),
        description: `Clearline: ${formatUsdc(received)} of ${formatUsdc(r.amount)} ${r.token} received on ${net}. Short by ${formatUsdc(shortfall)}. ${asked ? "Balance requested from the customer." : "Waiting for a decision: request the balance or accept as fees."}`,
      });
      reasons.push(`Short by ${formatUsdc(shortfall)} ${r.token}: posts as a partial payment with a note. The invoice stays open for ${formatUsdc(shortfall)}.`);
    }
  } else if (excess.length) {
    const refund = has("refund_excess");
    const keep = has("accept_over");
    if (!refund && !keep) {
      status = "needs_decision";
      reasons.push(v.duplicate
        ? "Paid twice. The invoice amount posts once; first decide whether the second payment is refunded or kept as a credit."
        : "Paid more than the invoice. The invoice amount posts; first decide whether the excess is refunded or kept as a credit.");
    } else {
      reasons.push(refund ? "Overpaid: the invoice amount posts once, and the excess posts as a separate overpayment line marked for refund."
        : "Overpaid: the invoice amount posts once, and the excess posts as a separate customer credit.");
    }
    for (const e of excess) {
      const rate = rates.get(e.obs.key)!;
      lines.push({
        // The excess landed in the wallet, so it is received into the wallet's (bank) account either way;
        // whether it is refunded or kept as credit is recorded in the reference.
        kind: "overpayment", amount: floorCents(e.amount), accountCode: accounts.walletAccountCode,
        observationKey: e.obs.key, txHash: e.obs.hash, token: r.token, network: net, tokenAmount: e.amount, usdRate: rate.rate, usdRateSource: rate.source, date: day(e.obs),
        description: `${refund || !keep ? "Overpayment to refund" : "Overpayment kept as customer credit"}: ${formatUsdc(e.amount)} ${r.token}, tx ${e.obs.hash}${v.duplicate ? " (the same invoice paid twice)" : ""}.`,
      });
    }
  } else {
    reasons.push(`Paid exactly ${formatUsdc(r.amount)} ${r.token}: one payment applied to ${link.invoiceNumber}.`);
  }

  if (cmp(r.amount, link.amountDue) !== 0) {
    reasons.push(`Note: the invoice showed ${link.amountDue} due when the request was made; the request is for ${r.amount}.`);
  }

  // Never post the same thing twice: drop lines already in the books.
  const postedObs = new Set(already.filter((l) => l.observationKey).map((l) => `${l.kind}|${l.observationKey}`));
  const postedKinds = new Set(already.filter((l) => !l.observationKey).map((l) => `${l.kind}|${l.amount}`));
  const todo = lines.filter((l) => (l.observationKey ? !postedObs.has(`${l.kind}|${l.observationKey}`) : !postedKinds.has(`${l.kind}|${l.amount}`)));
  // A note alone (nothing new to post) doesn't need posting again.
  if (todo.length === 0 || todo.every((l) => l.kind === "note" && already.some((a) => a.kind === "payment"))) {
    if (already.length) return plan("posted", [...reasons, "Everything that can be posted for this invoice is in the books."], [], leavesOpen);
  }
  if (already.length) reasons.push("Some of this was posted before; only the new lines below will post.");
  return plan(status, reasons, todo, leavesOpen);
}

/** Sum of a plan's lines of one kind. */
export const totalOf = (lines: PostingLine[], kind: PostingLine["kind"]) => lines.filter((l) => l.kind === kind).reduce((s, l) => add(s, l.amount), "0");
export { compareDecimal };
