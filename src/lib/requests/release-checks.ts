// The "paid" wording says only what was checked (Aashmiin, 2 Nov 2026). Five checks: finality on the
// chain, the issuer's token contract, the exact amount, the sender against the OFAC SDN digital-currency
// addresses, and the issuer's freeze list (sender and receiving address). A check that couldn't run is
// said to be NOT checked; one that failed is a problem headline naming it. Pure: no network, no clock,
// no Node imports, so the UI can import it. The word "safe" is never produced.
// Sources and limits: team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md.

import { sameAddress } from "../address";
import { officialContractFor } from "../contracts";
import { compareDecimal, isDecimal } from "../decimal";
import { sub } from "../payments/money";
import type { Chain, Token } from "../types";
import { REQUEST_SETTINGS } from "./check";

export type CheckState = "passed" | "failed" | "not_run";

export interface CheckResult {
  state: CheckState;
  /** One plain sentence: what was found, or why it couldn't be checked. */
  detail: string;
  /** Where the answer came from (URL, contract + method, list file). */
  source?: string;
  /** ISO time the answer was read. */
  checkedAt?: string;
}

/** "pending": in a block, but not yet at or below the chain's finalized (Tron: solidified) block. */
export interface FinalityCheck extends Omit<CheckResult, "state"> {
  state: CheckState | "pending";
  blockNumber?: number;
  finalizedBlock?: number;
  /** The 6a status sentence (paymentStatus().sentence), shown while not final. */
  eta?: string;
}

export interface SanctionsCheck extends CheckResult {
  list: "OFAC SDN";
  /** The list's own publish date, from the recorded snapshot. Absent when no snapshot. */
  listDate?: string;
}

export interface FreezeCheck extends CheckResult {
  issuer?: "Tether" | "Circle";
  /** Block the call was answered at (latest at checkedAt), when known. Freeze status can change after it. */
  atBlock?: number;
  addresses?: { role: "sender" | "receiver"; address: string; frozen: boolean }[];
}

export interface ReleaseChecks {
  finality: FinalityCheck;
  token: CheckResult;
  amount: CheckResult;
  sanctions: SanctionsCheck;
  freeze: FreezeCheck;
}

export interface ReleaseHeadline {
  tone: "paid" | "not_yet" | "problem";
  headline: string;
  lines: string[];
  /** True only when all five checks passed. */
  allChecked: boolean;
}

export const ISSUER: Record<Token, "Tether" | "Circle"> = { USDT: "Tether", USDC: "Circle" };
const NET: Partial<Record<Chain, string>> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };
export const SANCTIONS_SCOPE = "UN, EU, UK, Singapore (MAS), Hong Kong, UAE and other countries' lists are not checked, nor are owners of sanctioned people's companies.";

/** Finality: the payment's block is at or below the chain's finalized head (Ethereum `finalized` tag, Tron solidified block). */
export function finalityCheck(o: { chain: Chain; blockNumber?: number; finalizedBlock?: number; source?: string; checkedAt?: string; eta?: string }): FinalityCheck {
  const base = { blockNumber: o.blockNumber, finalizedBlock: o.finalizedBlock, source: o.source, checkedAt: o.checkedAt, eta: o.eta };
  if (o.blockNumber === undefined) return { ...base, state: "pending", detail: "Not in a block yet." };
  // Unknown head is unknown, never "final" and never "not final" (attack-patterns A7/A8).
  if (o.finalizedBlock === undefined) return { ...base, state: "not_run", detail: "The network's finalized block wasn't read, so finality is unknown." };
  return o.blockNumber <= o.finalizedBlock
    ? { ...base, state: "passed", detail: `In block ${o.blockNumber}; the network had finalized up to block ${o.finalizedBlock}.` }
    : { ...base, state: "pending", detail: `In block ${o.blockNumber}; the network has finalized up to block ${o.finalizedBlock} so far.` };
}

/** Token: the transfer's contract is the issuer's own contract for this token on this chain (never the symbol). */
export function tokenCheck(o: { chain: Chain; token: Token; contract: string }, settings = REQUEST_SETTINGS): CheckResult {
  const official = officialContractFor(o.chain, o.token, settings);
  const net = NET[o.chain] ?? o.chain;
  if (official?.source !== "issuer") {
    return { state: "not_run", detail: `There's no ${ISSUER[o.token]} ${o.token} contract on record for ${net}, so the token wasn't checked.` };
  }
  // EVM addresses compare case-insensitively; Tron base58 exactly (sameAddress).
  return sameAddress(official.contract, o.contract)
    ? { state: "passed", detail: `${ISSUER[o.token]}'s ${o.token} contract on ${net}.`, source: official.contract }
    : { state: "failed", detail: `Wrong token: this is not ${ISSUER[o.token]}'s ${o.token} contract on ${net}, it's a look-alike.`, source: official.contract };
}

/** Amount: exact decimal equality with what was asked. Over or short is not "right amount". */
export function amountCheck(o: { expected: string; received: string; token: Token }): CheckResult {
  if (!isDecimal(o.expected) || !isDecimal(o.received)) return { state: "not_run", detail: "The amount couldn't be read, so it wasn't checked." };
  const c = compareDecimal(o.received, o.expected);
  if (c === 0) return { state: "passed", detail: `Exactly ${o.expected} ${o.token}.` };
  const diff = sub(c < 0 ? o.expected : o.received, c < 0 ? o.received : o.expected);
  return { state: "failed", detail: `${c < 0 ? "Short" : "Overpaid"} by ${diff} ${o.token} (received ${o.received}, asked ${o.expected}).` };
}

// Belt and braces: no sentence that says "safe" leaves this module, even one a caller passed in.
const clean = (s: string | undefined) => (s && !/safe/i.test(s) ? s : undefined);

export function releaseHeadline(c: ReleaseChecks): ReleaseHeadline {
  const all = [c.finality, c.token, c.amount, c.sanctions, c.freeze];
  const allChecked = all.every((x) => x.state === "passed");
  const lines = all.map((x) => clean(x.detail)).filter((x): x is string => !!x);
  if (c.sanctions.state === "passed") lines.push(`Sanctions: OFAC SDN list only, dated ${c.sanctions.listDate}. ${SANCTIONS_SCOPE}`);

  const failed = all.filter((x) => x.state === "failed").map((x) => clean(x.detail) ?? "A check failed.");
  if (failed.length) return { tone: "problem", headline: `Don't release: ${failed.join(" ")}`, lines, allChecked };
  if (c.finality.state === "pending") {
    return { tone: "not_yet", headline: "Not final yet.", lines: [clean(c.finality.eta) ?? "Look the payment up again later.", ...lines], allChecked };
  }

  const parts: string[] = [c.finality.state === "passed" ? "Paid and final." : "Finality NOT checked."];
  const tok = c.token.state === "passed", amt = c.amount.state === "passed";
  parts.push(tok && amt ? "Right token and amount." : tok ? "Right token. Amount NOT checked." : amt ? "Right amount. Token NOT checked." : "Token and amount NOT checked.");
  parts.push(c.sanctions.state === "passed" ? "Sender not on public sanctions lists." : "Sender NOT checked.");
  parts.push(c.freeze.state === "passed" ? "Not frozen." : "Freeze status NOT checked.");
  // Only a finalized payment can be called paid; with finality unknown the rest is shown, but not as paid.
  if (c.finality.state !== "passed") return { tone: "not_yet", headline: parts[0], lines: [parts.slice(1).join(" "), ...lines], allChecked };
  return { tone: "paid", headline: parts.join(" "), lines, allChecked };
}
