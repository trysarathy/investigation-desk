import type { Code, Confidence, LedgerMatch, RuleResult } from "../types";
import { COMPANY_DECLARED_CHAINS } from "../contracts";
import type { Ctx } from "./context";
import { EV } from "./evidence";

/**
 * One pure function per catalogue code: (ctx) -> result. No network, no clock.
 *
 * Rule precedence signed off in the spec (22 Oct, second pass) is carried by guards inside rules:
 *  1. D02 only matches a deposit that would otherwise be credited.
 *  2. D05 skips a token only when it claims USDT or USDC and its contract is not the official
 *     one (that is D06). Genuine but unaccepted USDT or USDC is D05.
 *  3. D07 always stands; D07b is attached beside it as a finding (see run.ts).
 *  4. A REJECTED ledger row is D16, not D99.
 *  5. D12, D13, D14 and D16 are High only on an exact ledger match; otherwise Medium.
 *  6. D12 and D16 need the destination assigned to this customer at block time; another
 *     customer's address is D17, a retired address is D18.
 */
type Rule = (ctx: Ctx) => RuleResult;

const hit = (code: Code, confidence: Confidence, evidenceIds: string[], reason: string): RuleResult =>
  ({ code, matched: true, confidence, evidenceIds, reason });
const miss = (code: Code, reason: string): RuleResult =>
  ({ code, matched: false, evidenceIds: [], reason });

/**
 * Confirmed or not, would this transfer be credited by policy? Every fact it rests on must be
 * known: an unknown block height or amount never yields D02 or D12.
 */
function creditable(ctx: Ctx): boolean {
  return !!(ctx.tx?.status === "success" && ctx.depositChain && ctx.addrStatus === "this_customer" &&
    ctx.amountKnown && ctx.confirmations !== undefined && ctx.threshold !== undefined &&
    ctx.tokenAccepted && !ctx.impersonation && !ctx.belowMinimum && ctx.freezeHits.length === 0 &&
    ctx.facts.freezeStatus !== "failed");
}

/** Why a fact the confirmation rules need is missing, or undefined when all are known. */
function missingFact(ctx: Ctx): string | undefined {
  if (!ctx.tx || ctx.tx.status !== "success" || !ctx.depositChain) return undefined;
  if (ctx.confirmations === undefined || ctx.threshold === undefined) return "Current block height unknown, so confirmations are unknown.";
  if (!ctx.amountKnown) return "Amount from chain data is not a plain decimal, so it is unknown.";
  if (ctx.facts.freezeStatus === "failed") return "Issuer freeze call failed, so freeze status is unknown.";
  return undefined;
}

const ledgerConfidence = (m: LedgerMatch): Confidence => (m.quality === "exact" ? "High" : "Medium");
const ledgerQualityNote = (m: LedgerMatch) =>
  m.quality === "exact" ? "" : m.quality === "ambiguous" ? " (no transfer index; several company transfers)" : " (address and amount only)";

export const RULES: Record<Exclude<Code, "D99">, Rule> = {
  D01: (ctx) => {
    const { facts } = ctx;
    if (facts.input.kind !== "hash") return miss("D01", "Input is not a transaction hash.");
    if (ctx.tx) return miss("D01", "Hash was found.");
    if (facts.mempool && ctx.settings.mempoolChecksEnabled) return miss("D01", "Hash is pending in the mempool; see D10.");
    if (facts.lookups.some((l) => l.result === "error")) return miss("D01", "At least one chain lookup failed, so absence is not proven.");
    if (facts.lookups.length === 0) return miss("D01", "No chains were checked.");
    const pending = facts.lookups.filter((l) => l.result === "pending").length;
    return hit("D01", "High", [EV.lookup], pending
      ? `Not mined on any of ${facts.lookups.length} chains (seen pending on ${pending}; D10 is disabled).`
      : `Not found on any of ${facts.lookups.length} chains.`);
  },

  D02: (ctx) => {
    const missing = missingFact(ctx);
    if (missing) return miss("D02", missing);
    if (!creditable(ctx)) return miss("D02", "Not a creditable deposit, so confirmations are not the blocker.");
    if (ctx.confirmations! >= ctx.threshold!) return miss("D02", `${ctx.confirmations} of ${ctx.threshold} confirmations reached.`);
    return hit("D02", "High", [EV.tx, EV.confirmations, EV.address, EV.token],
      `${ctx.confirmations} of ${ctx.threshold} confirmations.`);
  },

  D03: (ctx) => {
    if (!ctx.tx) return miss("D03", "No mined transaction.");
    if (ctx.tx.status !== "failed") return miss("D03", "Receipt status is success.");
    return hit("D03", "High", [EV.tx], `Receipt status failed (${ctx.tx.errorCode ?? "reverted"}).`);
  },

  D04: (ctx) => {
    if (!ctx.tx || !ctx.transfer) return miss("D04", "No token transfer found.");
    if (ctx.tx.chain === "tron") return miss("D04", "Tron addresses cannot land on an EVM chain by mistake.");
    if (ctx.addrOnTxChain) return miss("D04", "Destination is a deposit address on the chain the funds arrived on.");
    if (!ctx.addrOtherChain) return miss("D04", "Destination is not a company deposit address on any chain.");
    return hit("D04", "High", [EV.lookup, EV.tx, EV.address],
      `Sent on ${ctx.tx.chain}; address is registered on ${ctx.addrOtherChain.chain}.`);
  },

  D05: (ctx) => {
    if (!ctx.transfer || !ctx.addrOnTxChain) return miss("D05", "Not a transfer to a company address on this chain.");
    if (ctx.tokenAccepted) return miss("D05", "Token contract is on the allowlist.");
    if (ctx.impersonation) return miss("D05", "Claims to be USDT or USDC with a non-official contract; left to D06.");
    return hit("D05", "High", [EV.token, EV.address], `Contract ${ctx.transfer.tokenContract} is not on the allowlist.`);
  },

  D06: (ctx) => {
    if (!ctx.transfer) return miss("D06", "No token transfer found.");
    if (!["USDT", "USDC"].includes(ctx.transfer.tokenSymbol)) return miss("D06", "Token does not claim to be USDT or USDC.");
    const company = ctx.officialSource === "company";
    if (!ctx.officialContract) {
      return miss("D06", company || COMPANY_DECLARED_CHAINS.has(ctx.tx!.chain)
        ? `No company-declared ${ctx.transfer.tokenSymbol} contract in Settings for this chain.`
        : `No confirmed official ${ctx.transfer.tokenSymbol} contract in settings for this chain.`);
    }
    const which = company ? "the company-accepted contract (bridged by Binance, not issued by Tether or Circle)" : "the official one";
    if (!ctx.impersonation) return miss("D06", `Contract matches ${which}.`);
    return hit("D06", "High", [EV.token], `Symbol ${ctx.transfer.tokenSymbol}, contract differs from ${which}.`);
  },

  D07: (ctx) => {
    if (!ctx.transfer || !ctx.tx) return miss("D07", "No token transfer found.");
    if (ctx.addrOnTxChain || ctx.addrOtherChain) return miss("D07", "Destination is a company deposit address.");
    return hit("D07", "High", [EV.address], "Destination is not in the deposit-address list.");
  },

  D07b: (ctx) => {
    if (!ctx.lookalike) return miss("D07b", "Destination does not resemble the customer's address.");
    const hs = ctx.facts.senderHistoryStatus;
    if (!ctx.lookalike.prior && hs === "not_supported") {
      return miss("D07b", "Sender history isn't available on this chain (public RPC), so D07b is off here.");
    }
    if (!ctx.lookalike.prior && hs === "failed") return miss("D07b", "Sender history lookup failed, so the pattern is unknown.");
    if (!ctx.lookalike.prior) return miss("D07b", "No earlier zero-value or dust transfer from the look-alike address.");
    return hit("D07b", "Medium", [EV.address, EV.history],
      "First 4 and last 4 characters match the customer's address, after a dust transfer from it.");
  },

  D17: (ctx) => {
    if (ctx.addrStatus !== "other_customer") return miss("D17", "Destination is not assigned to a different customer.");
    return hit("D17", "High", [EV.tx, EV.address], `Destination is assigned to another customer (File A row ${ctx.addrOnTxChain!.row}).`);
  },

  D18: (ctx) => {
    if (ctx.addrStatus !== "retired") return miss("D18", "Destination is not a retired address.");
    return hit("D18", "High", [EV.tx, EV.address], `Mined after the address was retired (File A row ${ctx.addrOnTxChain!.row}).`);
  },

  D08: (ctx) => {
    if (!ctx.transfer || !ctx.addrOnTxChain || !ctx.tokenAccepted) return miss("D08", "Not an accepted token to a company address.");
    if (!ctx.minimum) return miss("D08", "No minimum configured.");
    if (!ctx.belowMinimum) return miss("D08", `Amount is at or above ${ctx.minimum}.`);
    return hit("D08", "High", [EV.amount], `${ctx.transfer.amount} is below ${ctx.minimum}.`);
  },

  D09: (ctx) => {
    if (ctx.facts.freezeStatus === "not_supported") {
      return miss("D09", ctx.tx && COMPANY_DECLARED_CHAINS.has(ctx.tx.chain)
        ? "Not available on this chain: the token has no issuer freeze function (known gap, not a missing fact)."
        : "No confirmed issuer contract to ask on this chain and token.");
    }
    if (ctx.facts.freezeStatus === "failed") return miss("D09", "Issuer freeze call failed, so freeze status is unknown.");
    if (ctx.facts.freezes.length === 0) return miss("D09", "No freeze calls made.");
    if (ctx.freezeHits.length === 0) return miss("D09", "Issuer freeze calls returned false.");
    return hit("D09", "High", [EV.freeze], `${ctx.freezeHits.map((h) => h.role).join(" and ")} frozen by the issuer.`);
  },

  D10: (ctx) => {
    if (!ctx.settings.mempoolChecksEnabled) {
      return miss("D10", "Disabled: TronGrid and Etherscan V2 give no reliable pending-since time (week 2 finding).");
    }
    const m = ctx.facts.mempool;
    if (!m || ctx.tx) return miss("D10", "Not a pending mempool transaction.");
    const window = ctx.settings.pendingWindowSec[m.chain];
    if (ctx.pendingSec! <= window) return miss("D10", "Still inside the chain's normal pending window.");
    return hit("D10", "Medium", [EV.mempool], `Pending for longer than the normal ${Math.round(window / 60)}-minute window.`);
  },

  D11: (ctx) => {
    if (ctx.tx?.isBatch) return miss("D11", "Batch call decoded into Transfer events; not a failure.");
    if (ctx.facts.input.kind !== "unrecognised") return miss("D11", "Input is a hash, address or customer reference.");
    return hit("D11", "Medium", [EV.input], "Input looks like an exchange withdrawal ID, not an on-chain hash.");
  },

  D12: (ctx) => {
    const missing = missingFact(ctx);
    if (missing) return miss("D12", missing);
    if (!creditable(ctx)) return miss("D12", "Not a creditable deposit.");
    if (ctx.confirmations! < ctx.threshold!) return miss("D12", "Not yet confirmed.");
    const m = ctx.ledgerMatch;
    const cites = [EV.tx, EV.confirmations, EV.token, EV.address, EV.amount, EV.ledger];
    if (!m) return hit("D12", "High", cites, "Confirmed on-chain; no ledger row for this transfer.");
    if (m.row.status !== "PENDING") return miss("D12", `Ledger row exists with status ${m.row.status}.`);
    return hit("D12", ledgerConfidence(m), cites, `Confirmed on-chain; ledger row is still PENDING${ledgerQualityNote(m)}.`);
  },

  D13: (ctx) => {
    const m = ctx.ledgerMatch;
    if (m?.row.status !== "CREDITED") return miss("D13", "No CREDITED ledger row for this transfer.");
    if (m.row.customerId !== ctx.facts.customerId) return miss("D13", "The CREDITED row belongs to a different customer.");
    return hit("D13", ledgerConfidence(m), [EV.ledger], `Credited as ${m.row.depositId}${ledgerQualityNote(m)}.`);
  },

  D14: (ctx) => {
    const m = ctx.ledgerMatch;
    const s = m?.row.status;
    if (!m || (s !== "HELD" && s !== "REVIEW")) return miss("D14", "Ledger row is not HELD or REVIEW.");
    return hit("D14", ledgerConfidence(m), [EV.ledger], `Ledger status ${s}${ledgerQualityNote(m)}.`);
  },

  D16: (ctx) => {
    const m = ctx.ledgerMatch;
    if (m?.row.status !== "REJECTED") return miss("D16", "Ledger row is not REJECTED.");
    if (ctx.tx?.status !== "success" || ctx.addrStatus !== "this_customer" || !ctx.tokenAccepted || ctx.impersonation) {
      return miss("D16", "Not a valid deposit to a company address in an accepted token.");
    }
    const missing = missingFact(ctx);
    if (missing) return miss("D16", missing);
    if (ctx.confirmations! < ctx.threshold!) return miss("D16", "Not yet confirmed.");
    return hit("D16", ledgerConfidence(m), [EV.tx, EV.confirmations, EV.token, EV.address, EV.ledger],
      `Rejected by the company as ${m.row.depositId}${ledgerQualityNote(m)}.`);
  },
};
