// Words and links built from a request's records: the payment URI for the QR code, the verdict in
// plain English, the one next action, the reply to the customer, and what the sender's page says.
// Every value comes from the records; nothing here promises an outcome the records don't show.
// Where the product infers something (a likely cause), it says it is an inference.

import { formatDuration } from "../format";
import { CONFIRMATIONS, OFFICIAL, REQUEST_SETTINGS } from "./check";
import { sub } from "../payments/money";
import {
  AUTO_RULE, formatUsdc, senderLabel, shortfallCause, suggestMatches, toBaseUnits, unattributed, walletOf,
  type MatchSuggestion, type RequestView,
} from "./lifecycle";
import type { DecisionKind, Observation, PaymentRequest, RequestsData } from "./types";
import { ISSUER } from "./types";

/**
 * EIP-681 (https://eips.ethereum.org/EIPS/eip-681): call `transfer(address,uint256)` on the token
 * contract on chain 1, in base units. It is the standard Ethereum payment-request format, but
 * wallet support for token transfers varies, so the page always shows the details beside it.
 */
export function eip681(r: PaymentRequest, amount: string = r.amount): string {
  return `ethereum:${r.tokenContract}@1/transfer?address=${r.receivingAddress}&uint256=${toBaseUnits(amount)}`;
}

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
export const shortAddr = (a: string) => a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 5)}…${a.slice(-4)}`;
const confirmTime = () => formatDuration(CONFIRMATIONS * REQUEST_SETTINGS.blockTimeSec.ethereum);
const amt = (a: string, t: string) => `${formatUsdc(a)} ${t}`;

/** The colour every status uses: paid green, in progress blue, waiting grey, needs attention amber, blocked red. */
export type Tone = "paid" | "progress" | "waiting" | "attention" | "blocked";

export interface Verdict {
  tone: Tone;
  /** The status in two or three words, for pills and lists. */
  status: string;
  /** What the product concluded, one line. */
  title: string;
  /** Why, in plain English: two or three sentences a finance person can repeat to a customer. */
  summary: string;
  /** The facts behind it, one per line. */
  points: string[];
  /** An inference, shown as one. */
  cause?: { text: string; basis: string[] };
  /** For money sent somewhere it shouldn't have gone: can the business get it? */
  recoverable?: { answer: "Yes" | "No"; text: string };
}

/** An unidentified payment whose best suggested match is this request, if any. */
export function suggestedForRequest(data: RequestsData, r: PaymentRequest): { obs: Observation; s: MatchSuggestion } | undefined {
  for (const obs of unattributed(data).filter((o) => o.demo === r.demo)) {
    const top = suggestMatches(data, obs, CONFIRMATIONS)[0];
    if (top && top.request.id === r.id && top.confidence !== "Low") return { obs, s: top };
  }
  return undefined;
}

export const lookalikeChecks = (r: PaymentRequest) => (r.addressChecks ?? []).filter((c) => c.result === "lookalike");

export function verdict(data: RequestsData, v: RequestView): Verdict {
  const r = v.request, t = r.token;
  const issuerContract = `${ISSUER[t]}'s ${t} contract (${shortAddr(OFFICIAL[t])})`;
  const poisoned = lookalikeChecks(r);
  switch (v.state) {
    case "completed": {
      const a = v.acknowledgedBy!;
      if (a.by === AUTO_RULE) {
        return { tone: "paid", status: "Paid", title: "Paid. Matched and marked paid automatically",
          summary: `Exactly ${amt(r.amount, t)} from ${issuerContract} arrived at this invoice's own address and reached ${CONFIRMATIONS} confirmations. The matching rule marked it paid. No one had to touch it.`,
          points: [`Requested ${amt(r.amount, t)}, received ${amt(v.received, t)}`, `Genuine ${t}: from ${issuerContract}`, `Paid to ${r.id}'s own address, so no guesswork about which invoice`, `${CONFIRMATIONS} confirmations: final for practical purposes`] };
      }
      const what = a.kind === "refund_excess" ? "Paid; the extra is being refunded" : a.kind === "accept_other_network" ? "Paid on another network, counted by a person"
        : a.kind === "accept_short" ? "Settled short, accepted by a person" : a.kind === "accept_over" ? "Paid; the extra is kept as credit" : "Paid. Marked by a person";
      return { tone: "paid", status: "Paid", title: what, summary: `${a.by} decided: ${a.note || "marked paid."}`, points: v.reasons };
    }
    case "transfer_detected":
    case "confirming":
      return { tone: "progress", status: v.state === "confirming" ? "Confirming" : "Payment seen", title: `${amt(v.pending, t)} on its way`,
        summary: v.state === "confirming"
          ? `The transfer is in a block and has ${v.maxConfirmations} of the ${CONFIRMATIONS} confirmations required. ${r.autoMarkPaid ? "It will be marked paid automatically when it gets there." : "Then someone marks it paid."}`
          : "The transfer has been broadcast and is waiting to be included in a block.",
        points: v.reasons };
    case "matched":
      return { tone: "progress", status: "Matched", title: "Matched: waiting to be marked paid", summary: v.reasons[0], points: v.reasons };
    case "awaiting_payment": {
      if (poisoned.length) {
        const c = poisoned.at(-1)!;
        return { tone: "attention", status: "Scam stopped", title: "A look-alike address was stopped before the customer sent",
          summary: `${r.customerRef}'s sender pasted ${shortAddr(c.address)} into the payment page. It starts and ends like this invoice's address (${shortAddr(r.receivingAddress)}) but is a different address. That is the pattern of an address-poisoning scam. The page told them not to send. Nothing was lost.`,
          points: [`This invoice's address: ${r.receivingAddress}`, `Pasted address: ${c.address}`, "Same first and last characters, different in between: made to fool a quick check", "Nothing has been sent yet"] };
      }
      const sug = suggestedForRequest(data, r);
      if (sug) {
        return { tone: "attention", status: "Possible match", title: `A payment that's probably this one arrived at another address`,
          summary: `Nothing has reached ${r.id}'s own address. But ${amt(sug.obs.amount, sug.obs.tokenSymbol)} with no reference arrived at ${walletOf(data, sug.obs.chain, sug.obs.to, sug.obs.demo)?.label ?? "another Northwind address"}, and the evidence points to this invoice (score ${sug.s.score}/100). A person needs to confirm it.`,
          points: sug.s.signals.filter((x) => x.ok).map((x) => x.label) };
      }
      if (v.review === "short") {
        return { tone: "waiting", status: "Waiting for balance", title: `Waiting for the remaining ${amt(v.outstanding, t)}`, summary: v.reasons.join(" "), points: v.reasons };
      }
      return { tone: "waiting", status: "Awaiting payment", title: "Waiting for the customer to pay", summary: `Nothing has arrived at ${r.id}'s address yet.`, points: v.reasons };
    }
    case "needs_review": {
      if (v.review === "flagged") {
        const f = v.flagged.at(-1)!;
        if (f.kind === "counterfeit") {
          return { tone: "blocked", status: "Blocked", title: `Blocked: this isn't real ${t}`,
            summary: `${amt(f.obs.amount, f.obs.tokenSymbol)} arrived, but from a contract ${ISSUER[t]} doesn't control. Anyone can create a token and call it ${t}; only the contract address proves it's real. This one has no value, so it can't pay the invoice, and the invoice can't be marked paid with it.`,
            points: [`Real ${t} on Ethereum comes only from ${ISSUER[t]}'s contract: ${OFFICIAL[t]}`, `This token came from: ${f.obs.tokenContract}`, `Same name, different contract: a counterfeit`, `${r.invoiceRef} is still unpaid: ${amt(r.amount, t)} due`] };
        }
        if (f.kind === "wrong_network") {
          const w = walletOf(data, f.obs.chain, f.obs.to, f.obs.demo);
          const net = f.obs.chain === "tron" ? "Tron" : f.obs.chain;
          return { tone: "attention", status: "Wrong network", title: `Paid on the wrong network (${net})`,
            summary: `${r.customerRef} sent ${amt(f.obs.amount, f.obs.tokenSymbol)} on ${net}. This request is Ethereum only, so nothing arrived at its address. Ethereum and ${net} are separate networks: money sent on one never shows up on the other.`,
            points: [`Requested: ${amt(r.amount, t)} on Ethereum`, `Sent: ${amt(f.obs.amount, f.obs.tokenSymbol)} on ${net}, to ${f.obs.to}`, f.obs.tokenSymbol === t ? `Genuine ${t} on ${net} (${ISSUER[t]}'s ${net} contract)` : `Token: ${f.obs.tokenSymbol}`, w ? `That address is ${w.label}` : "That address is not one of the business's wallets"],
            recoverable: w
              ? { answer: "Yes", text: `It went to ${w.label}. The business controls that wallet, so the money isn't lost: it's in the business's own wallet, on ${net}. Treasury can confirm it and either count it for this invoice or refund it.` }
              : { answer: "No", text: `The address isn't one of the business's wallets, so the business can't move it. Only whoever controls ${shortAddr(f.obs.to)} can. The customer should contact the platform they sent from.` } };
        }
        if (f.kind === "failed") return { tone: "blocked", status: "Blocked", title: "The transaction failed: no money moved", summary: f.problem, points: v.reasons };
        if (f.kind === "timing") return { tone: "attention", status: "Needs attention", title: "An earlier transfer might be this payment", summary: f.problem, points: v.reasons };
        return { tone: "blocked", status: "Blocked", title: "A transfer doesn't count", summary: f.problem, points: v.reasons };
      }
      if (v.review === "short") {
        const cause = shortfallCause(data, v);
        return { tone: "attention", status: "Short payment", title: `Short by ${amt(v.outstanding, t)}`,
          summary: `${r.customerRef} sent ${amt(v.received, t)} of the ${amt(r.amount, t)} due. The invoice stays open until the rest arrives, or someone accepts it as settled.`,
          points: [`Requested ${amt(r.amount, t)}`, `Received ${amt(v.received, t)}, genuine ${t}, ${CONFIRMATIONS} confirmations`, `Short by ${amt(v.outstanding, t)}`],
          cause: cause ? { text: cause.cause, basis: cause.basis } : undefined };
      }
      if (v.review === "over") {
        const extra = sub(v.received, r.amount);
        const from = v.counted.map((o) => o.from);
        const sameSender = from.every((f) => f === from[0]);
        const gap = v.counted.length > 1 ? Math.round((Date.parse(v.counted[1].firstSeenAt) - Date.parse(v.counted[0].firstSeenAt)) / 60_000) : 0;
        return v.duplicate
          ? { tone: "attention", status: "Paid twice", title: `Paid twice: ${amt(extra, t)} extra`,
            summary: `${v.counted.length} separate transfers of exactly ${amt(r.amount, t)}${sameSender ? ", from the same address" : ""}${gap ? `, ${gap} minutes apart` : ""}. The invoice is paid once; the second payment is extra. This looks like a duplicate payment run, not a deliberate prepayment.`,
            points: v.counted.map((o, i) => `Payment ${i + 1}: ${amt(o.amount, o.tokenSymbol)} · ${shortHash(o.hash)} · from ${shortAddr(o.from)}`) }
          : { tone: "attention", status: "Overpaid", title: `Overpaid by ${amt(extra, t)}`, summary: v.reasons.join(" "), points: v.reasons };
      }
      return { tone: "attention", status: "Needs attention", title: "Which invoice does this pay?", summary: v.reasons.join(" "), points: v.reasons };
    }
  }
}

export interface NextAction { title: string; detail: string; owner: string; primary?: DecisionKind }

/** The one thing to do next, and who does it. */
export function nextAction(v: RequestView, data?: RequestsData): NextAction {
  const r = v.request, t = r.token;
  const ops = r.owner ?? "Finance ops";
  switch (v.state) {
    case "awaiting_payment": {
      if (lookalikeChecks(r).length) return { title: `Warn ${r.customerRef} that their wallet history may be poisoned`, detail: "Send the security note below, so they copy the address from the payment page next time, never from their history.", owner: ops };
      const sug = data && suggestedForRequest(data, r);
      if (sug) return { title: "Confirm the suggested match", detail: `Open the unidentified payment, check the evidence and confirm it pays ${r.invoiceRef}.`, owner: ops };
      return v.review === "short"
        ? { title: `Wait for the remaining ${amt(v.outstanding, t)}`, detail: "The customer was asked for the balance. It's marked paid when the rest arrives, or you can accept the short payment.", owner: ops }
        : { title: "Nothing to do: waiting for the customer", detail: r.autoMarkPaid ? "When an exact payment arrives it's matched and marked paid automatically." : "Share the payment link if they haven't got it.", owner: "Customer" };
    }
    case "transfer_detected":
    case "confirming":
      // Live transfers don't update on their own yet: their confirmations move only when looked up again.
      if (v.counted.some((o) => o.source === "live" && o.confirmations < CONFIRMATIONS)) {
        return { title: "Look the transaction up again", detail: `Confirmations were ${v.maxConfirmations} of ${CONFIRMATIONS} at the last lookup. Paste the same hash under "Record a real transaction" to update them.`, owner: ops };
      }
      return { title: "Nothing to do yet", detail: `Waiting for ${CONFIRMATIONS} confirmations (about ${confirmTime()} on Ethereum).`, owner: "No one" };
    case "matched":
      return { title: "Mark it paid", detail: `Credit ${amt(r.amount, t)} to ${r.customerRef} for ${r.invoiceRef} in your accounting system, then mark it paid here.`, owner: ops, primary: "acknowledge" };
    case "needs_review":
      if (v.review === "flagged") {
        const f = v.flagged.at(-1)!;
        if (f.kind === "timing") return { title: "Decide whether an earlier transfer is this payment", detail: "It was mined before the request existed. Count it if you know it's a prepayment for this invoice; otherwise mark it as not a payment.", owner: ops, primary: "count_transfer" };
        if (f.kind === "wrong_network") {
          const w = data && walletOf(data, f.obs.chain, f.obs.to, f.obs.demo);
          return w
            ? { title: `Ask treasury to confirm the ${amt(f.obs.amount, f.obs.tokenSymbol)} in ${w.label.replace(/ \(.*\)$/, "")}, then count it`, detail: "Once treasury confirms it's there, count it as payment for this invoice. Then send the customer the reply below so they use Ethereum next time.", owner: ops, primary: "accept_other_network" }
            : { title: "Tell the customer the business can't recover it", detail: "Send the reply below. The invoice stays unpaid until they pay on Ethereum.", owner: ops, primary: "dismiss_transfer" };
        }
        return { title: "Send the customer the reply, then close this transfer", detail: `It can't count toward the invoice. Mark it as not a payment (it stays on file with its evidence) and tell ${r.customerRef} what happened.`, owner: ops, primary: "dismiss_transfer" };
      }
      if (v.review === "ambiguous") return { title: "Confirm which request the transfer pays", detail: "Other requests use this address (open or already paid), so the address and amount alone can't decide it.", owner: ops, primary: "assign_transfer" };
      if (v.review === "short") return { title: `Ask ${r.customerRef} for the remaining ${amt(v.outstanding, t)}`, detail: "Send the reply below, then record that you asked. Or accept the short payment as settled if you'll absorb the difference.", owner: ops, primary: "request_balance" };
      return v.duplicate
        ? { title: `Refund the duplicate ${amt(sub(v.received, r.amount), t)}`, detail: "Confirm the refund address with the customer (reply below), give treasury the refund instruction, and record it. Or keep it as credit if they prefer.", owner: ops, primary: "refund_excess" }
        : { title: `Decide on the ${amt(sub(v.received, r.amount), t)} overpayment`, detail: "Refund it, or keep it as credit with the customer.", owner: ops, primary: "refund_excess" };
    case "completed":
      return { title: "Nothing to do", detail: v.acknowledgedBy?.by === AUTO_RULE ? "Marked paid automatically. In production this would also mark the invoice paid in your accounting system (not connected in this demo)." : "Marked paid.", owner: "No one" };
  }
}

/** "Priya Nair, Accounts, Brightline Studio" → "Hi Priya,"; a team address → "Hi Kite Analytics team,". */
function greeting(r: PaymentRequest): string {
  const from = r.messages?.at(-1)?.from ?? "";
  const first = from.split(",")[0].trim();
  return /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(first) ? `Hi ${first.split(" ")[0]},` : `Hi ${r.customerRef} team,`;
}
const signoff = (r: PaymentRequest, business: string) => r.demo ? `\n\nBest regards,\nMei Tan\nFinance, ${business}` : "\n\nBest regards,";

/** A reply the team can send as is. Facts only from the records; no promise of timing or credit. */
export function replyDraft(v: RequestView, data: RequestsData, o: { business: string; link?: string }): string | undefined {
  const r = v.request, t = r.token;
  const hi = greeting(r), bye = signoff(r, o.business);
  const tx = v.counted.at(-1) ?? v.flagged.at(-1)?.obs;
  const ref = tx ? ` (transaction ${shortHash(tx.hash)})` : "";
  const link = o.link ? `\n\nYour payment page shows what's due and updates by itself: ${o.link}` : "";
  const body = (() => {
    switch (v.state) {
      case "awaiting_payment": {
        const c = lookalikeChecks(r).at(-1);
        if (c) return `A quick security note about ${r.invoiceRef}. When you went to pay, our payment page stopped an address that looks like ours but isn't:\n\nYou pasted: ${c.address}\nOur address: ${r.receivingAddress}\n\nThey start and end the same, which is how "address poisoning" scams work: a scammer sends a tiny transfer from a look-alike address so it shows up in your wallet history, hoping you'll copy it next time. Nothing was sent, so nothing is lost.\n\nPlease always copy our address from the payment page, never from your wallet's history, and check the whole address before you confirm.${link}`;
        const sug = suggestedForRequest(data, r);
        if (sug) return `Thank you for your payment for ${r.invoiceRef}. We can see ${amt(sug.obs.amount, sug.obs.tokenSymbol)} arrived on ${new Date(sug.obs.blockTime ?? sug.obs.firstSeenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at our main address rather than the address on this invoice, with no reference. We're confirming it's yours and will apply it to ${r.invoiceRef} shortly.\n\nFor future invoices, please use the address on each invoice's payment page: it lets us match your payment straight away.`;
        if (v.review === "short") return `Thank you. We've received ${amt(v.received, t)} for ${r.invoiceRef}${ref}. ${amt(v.outstanding, t)} is still due. Please send it in ${t} on Ethereum to the same address.${link}`;
        return undefined;
      }
      case "transfer_detected":
      case "confirming":
        return `We can see your payment of ${amt(v.pending, t)} for ${r.invoiceRef}${ref}. Ethereum needs ${CONFIRMATIONS} confirmations, which usually takes about ${confirmTime()}. We'll confirm once it's complete.`;
      case "matched":
        return `Your payment of ${amt(r.amount, t)} for ${r.invoiceRef} has arrived${ref}. We're applying it to your account now.`;
      case "completed":
        return `Your payment of ${amt(r.amount, t)} for ${r.invoiceRef} has been received and applied${ref}. Thank you.`;
      case "needs_review": {
        if (v.review === "short") {
          const cause = shortfallCause(data, v);
          const fees = cause && /Fees/.test(cause.cause) ? " This often happens when the sending exchange or wallet deducts a withdrawal fee from the amount sent." : "";
          return `Thank you for your payment for ${r.invoiceRef}. We received ${amt(v.received, t)} of the ${amt(r.amount, t)} due${ref}, so ${amt(v.outstanding, t)} is still outstanding.${fees}\n\nCould you send the remaining ${amt(v.outstanding, t)}? Please use ${t} on Ethereum, to the same address as before. Once it arrives, the invoice is marked paid automatically.${link}`;
        }
        if (v.review === "over") {
          const extra = sub(v.received, r.amount);
          const from = v.counted.at(-1)!.from;
          return v.duplicate
            ? `You're right: we received the payment for ${r.invoiceRef} twice, ${amt(r.amount, t)} each time, so ${amt(extra, t)} is extra.\n\nWe'll refund ${amt(extra, t)} in ${t} on Ethereum to the address it came from (${from}), unless you'd prefer it sent to another address or kept as credit for your next invoice. Please reply to confirm which you'd like; we'll send the refund once you do.`
            : `Thank you. We've received ${amt(v.received, t)} for ${r.invoiceRef}${ref}, ${amt(extra, t)} more than due. Would you like the difference refunded or kept as credit? Please reply and we'll arrange it.`;
        }
        if (v.review === "flagged") {
          const f = v.flagged.at(-1)!;
          if (f.kind === "failed") return `Your transaction ${shortHash(f.obs.hash)} failed on Ethereum, so no ${t} moved and ${r.invoiceRef} is still unpaid. You can send the payment again.${link}`;
          if (f.kind === "counterfeit") return `Thank you for letting us know about your payment for ${r.invoiceRef}. We've looked into it: the ${amt(f.obs.amount, f.obs.tokenSymbol)} that arrived${ref} didn't come from ${ISSUER[t]}'s official ${t} contract, so it isn't real ${t} and we can't apply it to the invoice. Tokens like this copy the name "${t}" but have no value.\n\nIt may be worth checking with whoever sent you these tokens, as this is a common scam. ${r.invoiceRef} is still open for ${amt(r.amount, t)}. When you pay, please use genuine ${t} on Ethereum (${ISSUER[t]}'s contract ${OFFICIAL[t]}).${link}`;
          if (f.kind === "wrong_network") {
            const w = walletOf(data, f.obs.chain, f.obs.to, f.obs.demo);
            const net = f.obs.chain === "tron" ? "Tron" : f.obs.chain;
            return w
              ? `Thank you. We've found your payment of ${amt(f.obs.amount, f.obs.tokenSymbol)}: it was sent on the ${net} network, to an old ${net} wallet of ours from a previous invoice, rather than on Ethereum as ${r.invoiceRef} asked. The good news is that the wallet is ours, so the money isn't lost. Our treasury team is confirming it now, and we'll apply it to ${r.invoiceRef} once they have.\n\nFor future invoices, please pay on Ethereum to the address on each invoice's payment page, as we're retiring the old ${net} wallet.`
              : `Thank you. We've traced your payment of ${amt(f.obs.amount, f.obs.tokenSymbol)}: it was sent on the ${net} network to ${f.obs.to}, which isn't one of our wallets, so we haven't received it and can't move it. Please contact the platform you sent from about recovering it. ${r.invoiceRef} is still open for ${amt(r.amount, t)} in ${t} on Ethereum.${link}`;
          }
          return `We've received a transfer${ref} that can't be applied to ${r.invoiceRef}: ${f.problem} ${r.invoiceRef} is still unpaid.${link}`;
        }
        return `We've received a payment to the address for ${r.invoiceRef}${ref} and are confirming which invoice it belongs to. We'll update you shortly.`;
      }
    }
  })();
  return body ? `${hi}\n\n${body}${bye}` : undefined;
}

/** Refund instruction for treasury, for an over or duplicate payment. Nothing is sent by this app. */
export function refundInstruction(v: RequestView): string | undefined {
  if (v.review !== "over" || v.state === "completed") return undefined;
  const r = v.request, o = v.counted.at(-1)!;
  return `Refund ${amt(sub(v.received, r.amount), r.token)} on Ethereum\nTo: ${o.from} (the address the ${v.duplicate ? "duplicate " : ""}payment came from)\nToken: ${r.token}, ${ISSUER[r.token]}'s contract ${r.tokenContract}\nReason: ${v.duplicate ? "duplicate payment" : "overpayment"} of ${r.invoiceRef} (${r.customerRef}), transaction ${o.hash}\nBefore sending: confirm the address with the customer in writing.`;
}

/** What the sender's page shows. Plain words; never more than the records say. */
export function senderStatus(v: RequestView): { title: string; detail: string; tone: "wait" | "progress" | "done" | "attention" } {
  const t = v.request.token;
  switch (v.state) {
    case "awaiting_payment":
      return v.review === "short"
        ? { title: `${amt(v.outstanding, t)} still due`, detail: `${amt(v.received, t)} of ${amt(v.request.amount, t)} received.`, tone: "attention" }
        : { title: "Waiting for your payment", detail: v.request.demo ? "This page updates by itself when a transfer is seen." : "This page updates once the business records your transfer.", tone: "wait" };
    case "transfer_detected":
      return { title: "Payment seen", detail: "Your transfer is waiting to be included in a block.", tone: "progress" };
    case "confirming":
      return { title: "Confirming", detail: `${Math.min(v.maxConfirmations, CONFIRMATIONS)} of ${CONFIRMATIONS} confirmations.`, tone: "progress" };
    case "matched":
      return { title: "Received", detail: `${amt(v.received, t)} arrived. The business is applying it.`, tone: "progress" };
    case "completed":
      return { title: "Paid", detail: "The business has confirmed this payment. Thank you.", tone: "done" };
    case "needs_review":
      if (v.review === "short") return { title: `${amt(v.outstanding, t)} still due`, detail: `${amt(v.received, t)} of ${amt(v.request.amount, t)} received. The business is reviewing it.`, tone: "attention" };
      if (v.review === "over") return { title: "Received, more than requested", detail: "The business will contact you about the difference.", tone: "attention" };
      if (v.review === "flagged") {
        const f = v.flagged.at(-1)!;
        if (f.kind === "wrong_network") return { title: "Sent on the wrong network", detail: `A payment was sent on ${f.obs.chain === "tron" ? "Tron" : f.obs.chain}, not Ethereum, so it didn't arrive here. The business is looking into it: please don't send again until they reply.`, tone: "attention" };
        return { title: "A transfer didn't count", detail: `A transfer arrived that isn't genuine ${t}, or that failed. It doesn't count toward this payment. Contact the business before sending again.`, tone: "attention" };
      }
      return { title: "Being checked", detail: "The business is confirming which request your payment belongs to.", tone: "progress" };
  }
}

/** Plain words for a sender label, or nothing. */
export const senderName = (data: RequestsData, address: string) => senderLabel(data, address)?.label;
