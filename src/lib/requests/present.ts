// Words and links built from a request's records: the payment URI for the QR code, the one next
// action, the reply to the customer, and what the sender's page says. Every value comes from the
// records; nothing here promises an outcome the records don't show.

import { formatDuration } from "../format";
import { CONFIRMATIONS, REQUEST_SETTINGS } from "./check";
import { formatUsdc, toBaseUnits, type RequestView } from "./lifecycle";
import type { PaymentRequest } from "./types";

/**
 * EIP-681 (https://eips.ethereum.org/EIPS/eip-681): call `transfer(address,uint256)` on the token
 * contract on chain 1, in base units. It is the standard Ethereum payment-request format, but
 * wallet support for token transfers varies, so the page always shows the details beside it.
 */
export function eip681(r: PaymentRequest, amount: string = r.amount): string {
  return `ethereum:${r.tokenContract}@1/transfer?address=${r.receivingAddress}&uint256=${toBaseUnits(amount)}`;
}

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const confirmTime = () => formatDuration(CONFIRMATIONS * REQUEST_SETTINGS.blockTimeSec.ethereum);

export interface NextAction { title: string; detail: string; owner: string }

/** The one thing to do next, and who does it. */
export function nextAction(v: RequestView): NextAction {
  const r = v.request;
  switch (v.state) {
    case "awaiting_payment":
      return v.review === "short"
        ? { title: `Wait for the remaining ${formatUsdc(v.outstanding)} USDC`, detail: "The customer was asked for the balance. It completes when the rest arrives, or you can accept the short payment.", owner: r.owner ?? "Finance ops" }
        : { title: "Wait for the customer to pay", detail: "Share the payment link if they haven't got it.", owner: "Customer" };
    case "transfer_detected":
    case "confirming":
      return { title: "Nothing to do yet", detail: `Waiting for ${CONFIRMATIONS} confirmations (${confirmTime()} on Ethereum).`, owner: "No one" };
    case "matched":
      return { title: "Acknowledge the payment", detail: `Credit ${formatUsdc(r.amount)} USDC to ${r.customerRef} for ${r.invoiceRef} in your own system, then acknowledge it here. Until then it isn't completed.`, owner: r.owner ?? "Finance ops" };
    case "needs_review":
      if (v.review === "flagged") return { title: "Review the flagged transfer", detail: "It doesn't count toward the request. Confirm it isn't a payment, and reply to the customer.", owner: r.owner ?? "Finance ops" };
      if (v.review === "ambiguous") return { title: "Assign the transfer to the right request", detail: "Several open requests share this address, so the amount alone can't decide it.", owner: r.owner ?? "Finance ops" };
      if (v.review === "short") return { title: `Decide on the ${formatUsdc(v.outstanding)} USDC shortfall`, detail: "Ask for the balance, or accept the payment as settled.", owner: r.owner ?? "Finance ops" };
      return { title: `Decide on the ${formatUsdc(v.outstanding.replace(/^-/, ""))} USDC overpayment`, detail: "Accept it and handle the difference with the customer outside this app.", owner: r.owner ?? "Finance ops" };
    case "completed":
      return { title: "Done", detail: "Acknowledged by the business.", owner: "No one" };
  }
}

/** A reply the support team can send as is. Facts only from the records; no promise of timing or credit. */
export function replyDraft(v: RequestView): string | undefined {
  const r = v.request;
  const tx = v.counted.at(-1) ?? v.flagged.at(-1)?.obs;
  const ref = tx ? ` (transaction ${shortHash(tx.hash)})` : "";
  switch (v.state) {
    case "awaiting_payment":
      if (v.review === "short") return `Thank you. We've received ${formatUsdc(v.received)} USDC for ${r.invoiceRef}${ref}. ${formatUsdc(v.outstanding)} USDC is still due. Please send it in USDC on Ethereum to the same address; it will be added to this invoice.`;
      return undefined;
    case "transfer_detected":
    case "confirming":
      return `We can see your payment of ${formatUsdc(v.pending)} USDC for ${r.invoiceRef}${ref}. Ethereum needs ${CONFIRMATIONS} confirmations, which usually takes ${confirmTime()}. We'll confirm once it's complete.`;
    case "matched":
      return `Your payment of ${formatUsdc(r.amount)} USDC for ${r.invoiceRef} has arrived${ref}. We're applying it to your account now.`;
    case "completed":
      return `Your payment of ${formatUsdc(r.amount)} USDC for ${r.invoiceRef} has been received and applied${ref}. Thank you.`;
    case "needs_review":
      if (v.review === "short") return `Thank you. We've received ${formatUsdc(v.received)} USDC for ${r.invoiceRef}${ref}, which is ${formatUsdc(v.outstanding)} USDC less than the ${formatUsdc(r.amount)} USDC due. Please send the remaining ${formatUsdc(v.outstanding)} USDC in USDC on Ethereum to the same address, or reply if you think this is wrong.`;
      if (v.review === "over") return `Thank you. We've received ${formatUsdc(v.received)} USDC for ${r.invoiceRef}${ref}, ${formatUsdc(v.outstanding.replace(/^-/, ""))} USDC more than due. Our team will contact you about the difference.`;
      if (v.review === "flagged") {
        const f = v.flagged.at(-1)!;
        if (f.obs.status === "failed") return `Your transaction ${shortHash(f.obs.hash)} failed on Ethereum, so no USDC moved and ${r.invoiceRef} is still unpaid. You can send the payment again.`;
        return `We've received a transfer${ref} labelled ${f.obs.tokenSymbol}, but it doesn't come from Circle's USDC contract, so it isn't genuine USDC and can't be applied to ${r.invoiceRef}. ${r.invoiceRef} is still unpaid. Please check where these tokens came from before sending again, and use USDC on Ethereum (contract ${r.tokenContract}).`;
      }
      return `We've received a payment to the address for ${r.invoiceRef}${ref} and are confirming which invoice it belongs to. We'll update you shortly.`;
  }
}

/** What the sender's page shows. Plain words; never more than the records say. */
export function senderStatus(v: RequestView): { title: string; detail: string; tone: "wait" | "progress" | "done" | "attention" } {
  switch (v.state) {
    case "awaiting_payment":
      return v.review === "short"
        ? { title: `${formatUsdc(v.outstanding)} USDC still due`, detail: `${formatUsdc(v.received)} of ${formatUsdc(v.request.amount)} USDC received.`, tone: "attention" }
        : { title: "Waiting for your payment", detail: "This page updates by itself when a transfer is seen.", tone: "wait" };
    case "transfer_detected":
      return { title: "Payment seen", detail: "Your transfer is waiting to be included in a block.", tone: "progress" };
    case "confirming":
      return { title: "Confirming", detail: `${Math.min(v.maxConfirmations, CONFIRMATIONS)} of ${CONFIRMATIONS} confirmations.`, tone: "progress" };
    case "matched":
      return { title: "Received", detail: `${formatUsdc(v.received)} USDC arrived. The business is applying it.`, tone: "progress" };
    case "completed":
      return { title: "Paid", detail: "The business has confirmed this payment.", tone: "done" };
    case "needs_review":
      if (v.review === "short") return { title: `${formatUsdc(v.outstanding)} USDC still due`, detail: `${formatUsdc(v.received)} of ${formatUsdc(v.request.amount)} USDC received. The business is reviewing it.`, tone: "attention" };
      if (v.review === "over") return { title: "Received, more than requested", detail: "The business will contact you about the difference.", tone: "attention" };
      if (v.review === "flagged") return { title: "A transfer didn't count", detail: "A transfer arrived that isn't genuine USDC, or that failed. It doesn't count toward this payment. Contact the business before sending again.", tone: "attention" };
      return { title: "Being checked", detail: "The business is confirming which request your payment belongs to.", tone: "progress" };
  }
}
