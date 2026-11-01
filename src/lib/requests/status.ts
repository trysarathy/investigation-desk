// One plain-English status sentence and an honest ETA per payment, for the request page and the
// requests list. Pure: the same records always give the same words.
//
// The ETA is computed only from documented block timing and what the code waits for today, which is
// a confirmation count (12 on Ethereum, CONFIRMATIONS), NOT Ethereum "finalized" (POSTING_RULES R5,
// to be built in plan D5.5). So the words say "confirmed", never "final". Where a time can't be
// computed (not yet in a block, a live transfer that only updates when looked up again, BNB Chain,
// a network we have no timing for), there is no ETA.

import { REQUEST_SETTINGS } from "./check";
import { AUTO_RULE, formatUsdc, walletOf, type RequestView } from "./lifecycle";
import { lookalikeChecks, suggestedForRequest } from "./present";
import { sub } from "../payments/money";
import type { RequestsData } from "./types";

/**
 * Seconds per block, from each network's own docs (opened 2026-11-01). BNB Chain is left out on
 * purpose: BEP-619 (Enabled) says 0.45 s blocks, but the settings in src/lib/fixtures say 3 s, so
 * until crypto-protocol-engineer reconciles them no BNB Chain ETA is shown.
 */
const BLOCK_TIME: Record<string, { sec: number; source: string }> = {
  ethereum: { sec: 12, source: "12-second slots, https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/" },
  tron: { sec: 3, source: "3-second slots, https://github.com/tronprotocol/documentation-en/blob/master/docs/mechanism-algorithm/dpos.md" },
};

/** Time until `required` confirmations, rounded up to whole minutes; null when it can't be computed or is already reached. */
export function confirmEta(chain: string, confirmations: number, required: number): { seconds: number; minutes: number; basis: string } | null {
  const t = BLOCK_TIME[chain];
  const left = required - confirmations;
  if (!t || left <= 0) return null;
  const seconds = left * t.sec;
  return { seconds, minutes: Math.max(1, Math.ceil(seconds / 60)), basis: `${left} more confirmations × ${t.source} (a missed slot adds time)` };
}

export type PaymentStatusKey =
  | "waiting" | "waiting_balance" | "seen" | "confirming" | "ready" | "paid" | "unchecked"
  | "short" | "over" | "duplicate" | "wrong_token" | "counterfeit" | "wrong_network" | "lookalike"
  | "failed" | "wrong_address" | "ambiguous" | "suggested" | "timing" | "review";

export interface PaymentStatus {
  key: PaymentStatusKey;
  /** One sentence: what happened and what to do. */
  sentence: string;
  etaMinutes: number | null;
  /** Where the ETA comes from; null when there is none. */
  etaBasis: string | null;
  nextAction: string;
}

/** What the code waits for on each network today (lifecycle.ts: Tron 20, Ethereum CONFIRMATIONS). */
const CONFIRMATIONS_FOR = (chain: string) => REQUEST_SETTINGS.confirmations[chain as keyof typeof REQUEST_SETTINGS.confirmations] ?? Infinity;
const minutes = (n: number) => (n === 1 ? "about a minute" : `about ${n} minutes`);
const NET: Record<string, string> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };

export function paymentStatus(data: RequestsData, v: RequestView, o: { chainUnreadable?: boolean } = {}): PaymentStatus {
  const r = v.request, t = r.token;
  const amt = (a: string) => `${formatUsdc(a.replace(/^-/, ""))} ${t}`;
  const s = (key: PaymentStatusKey, sentence: string, nextAction: string, eta?: { minutes: number; basis: string } | null): PaymentStatus =>
    ({ key, sentence, nextAction, etaMinutes: eta?.minutes ?? null, etaBasis: eta?.basis ?? null });

  if (v.state === "completed") {
    const a = v.acknowledgedBy!;
    if (a.by === AUTO_RULE) return s("paid", "Paid: the demo's matching rule marked it paid, so there's nothing to do.", "Nothing to do.");
    const did = a.kind === "accept_short" ? "accepted it as settled short" : a.kind === "accept_over" ? "kept the extra as credit"
      : a.kind === "refund_excess" ? "recorded a refund of the extra" : a.kind === "accept_other_network" ? "counted it from another network" : "marked it paid";
    return s("paid", `Paid: ${a.by} ${did}, so there's nothing to do.`, "Nothing to do.");
  }
  // A chain that didn't answer: nothing is concluded, and no time is promised.
  if (o.chainUnreadable || [...v.counted, ...v.flagged.map((f) => f.obs)].some((x) => x.checks.at(-1)?.label === "Check paused")) {
    return s("unchecked", "We couldn't check this payment because the network didn't answer, so nothing is decided yet: look it up again later.", "Look the payment up again later.");
  }
  if (v.review === "flagged") {
    const f = v.flagged.at(-1)!;
    const lookalike = f.obs.checks.at(-1)?.code === "D07b";
    switch (lookalike ? "lookalike" : f.kind) {
      case "lookalike": return s("lookalike", "Sent to a look-alike of this invoice's address, not the real one: tell the customer and don't mark it paid.", "Send the customer the reply.");
      case "counterfeit": return s("counterfeit", `Not real ${t}, so it can't pay this invoice: tell the customer and close the payment.`, "Send the reply, then mark it as not a payment.");
      case "wrong_token": return s("wrong_token", `Paid in ${f.obs.tokenSymbol}, not ${t}, so it can't pay this invoice: tell the customer and close the payment.`, "Send the reply, then mark it as not a payment.");
      case "failed": return s("failed", "The payment failed and no money moved: ask the customer to send it again.", "Send the customer the reply.");
      case "timing": return s("timing", "A payment made before this invoice existed was found: decide whether it pays this invoice.", "Count it or mark it as not a payment.");
      case "wrong_network": {
        const net = NET[f.obs.chain] ?? f.obs.chain;
        return walletOf(data, f.obs.chain, f.obs.to, f.obs.demo)
          ? s("wrong_network", `Sent on ${net}, not Ethereum, to the business's own ${net} address: ask treasury to confirm it arrived, then count it.`, "Ask treasury to confirm, then count it.")
          : s("wrong_network", `Sent on ${net}, not Ethereum, to an address the business doesn't control: tell the customer it can't be recovered here.`, "Send the customer the reply.");
      }
      case "wrong_address": return s("wrong_address", "Sent to a different address from this invoice's: check with the customer before doing anything.", "Check with the customer.");
      default: return s("review", "This payment needs a look before it can count: open it to see why.", "Open the request.");
    }
  }
  if (v.review === "ambiguous") return s("ambiguous", "A payment could be for this invoice or another one: confirm which invoice it pays.", "Confirm which request it pays.");
  if (v.state === "transfer_detected") return s("seen", "Payment seen and confirming: we can't estimate how long yet, and there's nothing to do.", "Nothing to do yet.");
  if (v.state === "confirming") {
    const c = v.counted.filter((x) => x.blockNumber !== undefined && x.confirmations < CONFIRMATIONS_FOR(x.chain));
    // Live transfers don't refresh on their own yet, so a clock time would be a guess.
    if (c.some((x) => x.source === "live")) return s("confirming", "Confirming: look the payment up again to see whether it's confirmed.", "Look the transaction up again.");
    const etas = c.map((x) => confirmEta(x.chain, x.confirmations, CONFIRMATIONS_FOR(x.chain)));
    if (!etas.length || etas.some((e) => !e)) return s("confirming", "Confirming: we can't estimate how long yet, and there's nothing to do.", "Nothing to do yet.");
    const slowest = etas.reduce((a, b) => (b!.seconds > a!.seconds ? b : a))!;
    return s("confirming", `Confirming: ${minutes(slowest.minutes)} until it's confirmed, and there's nothing to do yet.`, "Nothing to do yet.", slowest);
  }
  if (v.state === "matched") return s("ready", "Confirmed and checked for the exact amount: mark it paid.", "Mark it paid.");
  if (v.review === "short") {
    return v.state === "awaiting_payment"
      ? s("waiting_balance", `Waiting for the remaining ${amt(v.outstanding)}, which the customer was asked for.`, "Nothing to do until it arrives.")
      : s("short", `Short by ${amt(v.outstanding)}: ask the customer for the rest, or accept it as settled.`, "Ask for the balance, or accept it.");
  }
  if (v.review === "over") {
    const extra = amt(sub(v.received, r.amount));
    return v.duplicate
      ? s("duplicate", `Paid twice, ${extra} extra: refund the duplicate or keep it as credit.`, "Refund it or keep it as credit.")
      : s("over", `Overpaid by ${extra}: refund the extra or keep it as credit.`, "Refund it or keep it as credit.");
  }
  if (lookalikeChecks(r).length) return s("lookalike", "A look-alike address was stopped before the customer paid: warn them to copy the address from the payment page.", "Send the customer the security note.");
  if (suggestedForRequest(data, r)) return s("suggested", "A payment that's probably this one arrived at another address: confirm the match.", "Confirm the suggested match.");
  return s("waiting", "Waiting for payment: nothing has arrived yet.", "Share the payment link if the customer hasn't got it.");
}
