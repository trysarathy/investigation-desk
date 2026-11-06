// Check builders for the "paid" wording (Aashmiin, 2 Nov 2026): finality, token contract, amount,
// network and receiving address. Pure (no network, no clock) but SERVER SIDE: it uses the settings
// and the address helpers (node:crypto). UI code imports types and releaseHeadline() from
// ./release-headline instead; everything there is re-exported here for server callers.
// Sources and limits: team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md.

import { sameAddress } from "../address";
import { COMPANY_CONTRACT_LABEL, officialContractFor } from "../contracts";
import { compareDecimal, isDecimal } from "../decimal";
import { sub } from "../payments/money";
import type { Chain, Token } from "../types";
import { REQUEST_SETTINGS } from "./check";
import { formatUsdc } from "./lifecycle";
import { ISSUER, type CheckResult, type FinalityCheck } from "./release-headline";

export * from "./release-headline";

const NET: Partial<Record<Chain, string>> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain", polygon: "Polygon", base: "Base", arbitrum: "Arbitrum", optimism: "OP Mainnet" };
const net = (c: Chain) => NET[c] ?? c;
/** Finality: the payment's block is at or below the chain's own finality signal (Ethereum `finalized`, Tron solidified). */
export function finalityCheck(o: { chain: Chain; blockNumber?: number; finalizedBlock?: number; source?: string; checkedAt?: string; eta?: string }): FinalityCheck {
  const base = { blockNumber: o.blockNumber, finalizedBlock: o.finalizedBlock, source: o.source, checkedAt: o.checkedAt, eta: o.eta };
  if (o.blockNumber === undefined) return { ...base, state: "pending", detail: "Not on the chain yet: waiting for the network to pick it up." };
  const ok = (n: number | undefined) => n === undefined || (Number.isSafeInteger(n) && n > 0);
  if (!ok(o.blockNumber) || !ok(o.finalizedBlock)) {
    // A block number that isn't a positive whole number is an unreadable answer: unknown, never shown.
    return { source: o.source, checkedAt: o.checkedAt, eta: o.eta, state: "not_run", detail: `We couldn't read whether ${net(o.chain)} has made this payment final.`, technical: "A block number in the answer couldn't be read." };
  }
  // Unknown head is unknown, never "final" and never "not final" (attack-patterns A7/A8).
  if (o.finalizedBlock === undefined) {
    return { ...base, state: "not_run", detail: `We couldn't read whether ${net(o.chain)} has made this payment final.`, technical: `In block ${o.blockNumber}; finality signal not read.` };
  }
  const technical = `In block ${o.blockNumber}; the network had finalized up to block ${o.finalizedBlock}.`;
  if (o.blockNumber <= o.finalizedBlock) return { ...base, state: "passed", detail: `${net(o.chain)} reports this payment as final.`, technical };
  return { ...base, state: "pending", detail: "Not final yet. Check again before release.", technical };
}

/**
 * Token: the transfer's contract is the official one for this token on this chain (never the symbol).
 * Issuer chains: the issuer's contract. BNB Chain: the company-declared contract (bridged, not issued
 * by Tether/Circle); a different contract there is a look-alike too.
 */
export function tokenCheck(o: { chain: Chain; token: Token; contract: string }, settings = REQUEST_SETTINGS): CheckResult {
  const official = officialContractFor(o.chain, o.token, settings);
  if (!official) return { state: "not_run", detail: `There's no ${o.token} contract on record for ${net(o.chain)}, so the token wasn't checked.` };
  const whose = official.source === "issuer" ? `${ISSUER[o.token]}'s ${o.token} contract` : `the ${o.token} contract your company accepts`;
  const technical = official.source === "issuer" ? `Official contract ${official.contract}.` : `Declared contract ${official.contract}: ${COMPANY_CONTRACT_LABEL}.`;
  // EVM addresses compare case-insensitively; Tron base58 exactly (sameAddress).
  return sameAddress(official.contract, o.contract)
    ? { state: "passed", detail: `${whose[0].toUpperCase()}${whose.slice(1)} on ${net(o.chain)}.`, technical, source: official.contract }
    : { state: "failed", detail: `Wrong token: this is not ${whose} on ${net(o.chain)}, it's a look-alike.`, technical: `${technical} Paid with ${o.contract}.`, source: official.contract };
}

/** Amount: exact decimal equality. Short blocks release; over goes to a person (POSTING_RULES C5: refund or keep as credit). */
export function amountCheck(o: { expected: string; received: string; token: Token }): CheckResult {
  if (!isDecimal(o.expected) || !isDecimal(o.received)) return { state: "not_run", detail: "The amount couldn't be read, so it wasn't checked." };
  const c = compareDecimal(o.received, o.expected);
  // For reading: thousands separators, at least 2 decimals, no digit dropped (formatUsdc). Exact values in `technical`.
  const f = formatUsdc;
  if (c === 0) return { state: "passed", detail: `Exactly ${f(o.expected)} ${o.token}.` };
  const technical = `Received ${o.received}, invoice ${o.expected}.`;
  if (c < 0) return { state: "failed", detail: `Short by ${f(sub(o.expected, o.received))} ${o.token} (received ${f(o.received)}, asked ${f(o.expected)}).`, technical };
  return { state: "failed", blocking: false, detail: `Paid ${f(sub(o.received, o.expected))} ${o.token} more than the invoice. Check with finance before refunding.`, technical };
}

/** Network: the transfer is on the network the invoice asks for. */
export function networkCheck(o: { paidOn: Chain; invoiceOn: Chain }): CheckResult {
  return o.paidOn === o.invoiceOn
    ? { state: "passed", detail: `Sent on ${net(o.paidOn)}, the network on the invoice.` }
    : { state: "failed", detail: `Sent on ${net(o.paidOn)}, not ${net(o.invoiceOn)}, the network on the invoice.` };
}

/**
 * Both addresses shortened the same way. Normally first 4 + last 4 characters (after 0x / T); when that
 * would print them identically (address poisoning copies exactly those), the nearer end is widened on
 * both to one character past the first difference, so the two never read the same. EVM compares
 * case-insensitively, Tron exactly; the displayed case is the address's own.
 */
function shortPair(a: string, b: string): [string, string] {
  const evm = a.startsWith("0x");
  const x = evm ? a.toLowerCase() : a, y = evm ? b.toLowerCase() : b;
  let head = evm ? 6 : 5, tail = 4;
  const cut = (s: string) => `${s.slice(0, head)}…${s.slice(-tail)}`;
  if (x.length === y.length && cut(x) === cut(y) && x !== y) {
    let i = 0; while (x[i] === y[i]) i++;
    let j = 0; while (x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
    if (i - head <= j - tail) head = Math.min(i + 2, x.length); else tail = Math.min(j + 2, x.length);
  }
  return [cut(a), cut(b)];
}
/** Receiving address: exactly the invoice's (EVM case-insensitive, Tron exact). A look-alike shares the first or last 4 characters (requests/lifecycle.ts compareAddress). */
export function receivingAddressCheck(o: { paidTo: string; invoiceAddress: string }): CheckResult {
  if (sameAddress(o.paidTo, o.invoiceAddress)) return { state: "passed", detail: "Sent to the invoice's own address." };
  const x = o.paidTo.replace(/^0x/i, "").toLowerCase(), y = o.invoiceAddress.replace(/^0x/i, "").toLowerCase();
  const kind = x.slice(0, 4) === y.slice(0, 4) || x.slice(-4) === y.slice(-4) ? "a look-alike" : "a different";
  const [paid, invoice] = shortPair(o.paidTo, o.invoiceAddress);
  return { state: "failed", detail: `Sent to ${kind} address (${paid}), not the invoice's address (${invoice}).`, technical: `Paid to ${o.paidTo}; invoice ${o.invoiceAddress}.` };
}
