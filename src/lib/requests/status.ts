// One plain-English status sentence per payment, for the request page and the requests list.
// Pure: the same records always give the same words.
//
// No countdown. Clearline doesn't re-check payments on its own yet: a live transfer updates only when
// someone looks it up again, and a demo transfer only when someone clicks. So `etaMinutes` stays
// null until automatic re-checking exists (a separate roadmap item). Where a network's pace is
// documented, the sentence states it as a pace ("Ethereum usually takes about 2 minutes for 12
// confirmations"), never as a promise, and not at all while any transfer isn't in a block yet.
// The code waits for a confirmation count (12 on Ethereum), NOT Ethereum "finalized" (POSTING_RULES
// R5, plan D5.5), so the words say "confirmed", never "final".

import { formatDuration } from "../format";
import { REQUEST_SETTINGS } from "./check";
import { AUTO_RULE, formatUsdc, walletOf, type RequestView } from "./lifecycle";
import { lookalikeChecks, reusesOldAddress, suggestedForRequest } from "./present";
import { sub } from "../payments/money";
import type { RequestsData } from "./types";

/**
 * Networks whose block time in REQUEST_SETTINGS.blockTimeSec matches their own docs (opened 2026-11-01):
 * Ethereum 12-second slots (github.com/ethereum/ethereum-org-website, dev,
 * public/content/developers/docs/consensus-mechanisms/pos/index.md) and Tron 3-second slots
 * (github.com/tronprotocol/documentation-en, docs/mechanism-algorithm/dpos.md). BNB Chain is left out:
 * BEP-619 (Enabled) says 0.45 s blocks but the setting says 3 s, so no pace until they're reconciled.
 */
const DOCUMENTED_PACE = ["ethereum", "tron"];

/** What the code waits for on each network today (lifecycle.ts: Tron 20, Ethereum CONFIRMATIONS). */
const CONFIRMATIONS_FOR = (chain: string) => REQUEST_SETTINGS.confirmations[chain as keyof typeof REQUEST_SETTINGS.confirmations] ?? Infinity;

/** "about 2 minutes": the usual time for the confirmations the code waits for, from the same block times and rounding as the next step. Null when undocumented. */
export function confirmPace(chain: string): string | null {
  const sec = REQUEST_SETTINGS.blockTimeSec[chain as keyof typeof REQUEST_SETTINGS.blockTimeSec];
  if (!DOCUMENTED_PACE.includes(chain) || !sec) return null;
  return formatDuration(CONFIRMATIONS_FOR(chain) * sec);
}

export type PaymentStatusKey =
  | "waiting" | "waiting_balance" | "seen" | "confirming" | "ready" | "paid" | "unchecked"
  | "short" | "over" | "duplicate" | "wrong_token" | "counterfeit" | "wrong_network" | "lookalike"
  | "failed" | "wrong_address" | "ambiguous" | "suggested" | "timing" | "review";

export interface PaymentStatus {
  key: PaymentStatusKey;
  /** One sentence: what happened and what to do. */
  sentence: string;
  /** Always null today: no countdown until Clearline re-checks payments on its own. */
  etaMinutes: null;
  nextAction: string;
}

const NET: Record<string, string> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };

export function paymentStatus(data: RequestsData, v: RequestView): PaymentStatus {
  const r = v.request, t = r.token;
  const amt = (a: string) => `${formatUsdc(a.replace(/^-/, ""))} ${t}`;
  const s = (key: PaymentStatusKey, sentence: string, nextAction: string): PaymentStatus => ({ key, sentence, nextAction, etaMinutes: null });

  if (v.state === "completed") {
    const a = v.acknowledgedBy!;
    if (a.by === AUTO_RULE) return s("paid", "Paid: the demo's matching rule marked it paid, so there's nothing to do.", "Nothing to do.");
    const did = a.kind === "accept_short" ? "accepted it as settled short" : a.kind === "accept_over" ? "kept the extra as credit"
      : a.kind === "refund_excess" ? "recorded a refund of the extra" : a.kind === "accept_other_network" ? "counted it from another network" : "marked it paid";
    return s("paid", `Paid: ${a.by} ${did}, so there's nothing to do.`, "Nothing to do.");
  }
  // A chain that didn't answer: nothing is concluded, and no time is promised.
  if ([...v.counted, ...v.flagged.map((f) => f.obs)].some((x) => x.checks.at(-1)?.label === "Check paused")) {
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
  const seen = "Payment seen, waiting for the network to pick it up: nothing to do yet.";
  if (v.state === "transfer_detected") return s("seen", seen, "Nothing to do yet.");
  if (v.state === "confirming") {
    // Any counted transfer not in a block yet: its timing isn't predictable, so no pace at all.
    if (v.counted.some((x) => x.blockNumber === undefined)) return s("seen", seen, "Nothing to do yet.");
    const c = v.counted.filter((x) => x.confirmations < CONFIRMATIONS_FOR(x.chain));
    const x = c.reduce((a, b) => (b.confirmations < a.confirmations ? b : a), c[0]);
    const need = CONFIRMATIONS_FOR(x.chain), net = NET[x.chain] ?? x.chain, pace = confirmPace(x.chain);
    const usual = pace ? `${net} usually takes ${pace}` : "we can't say how long it will take";
    return x.source === "live"
      ? s("confirming", `Confirming (${x.confirmations} of ${need} at the last check): ${usual}; look the payment up again to update it.`, "Look the transaction up again.")
      : s("confirming", `Confirming (${x.confirmations} of ${need}): ${usual}; in the demo, it moves on when you click.`, "Nothing to do yet.");
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
  if (reusesOldAddress(r)) {
    return s("waiting", `Waiting for payment, and ${r.customerRef} says they'll reuse an old address: make sure they check it on the payment page before sending.`, "Ask the customer to check the address on the payment page.");
  }
  return s("waiting", "Waiting for payment: nothing has arrived yet, so there's nothing to do until the customer pays.", "Share the payment link if the customer hasn't got it.");
}
