import { compareDecimal, isDecimal } from "../decimal";
import { canonicalAddress, sameAddress } from "../address";
import { officialContractFor } from "../contracts";
import { normaliseHash } from "../normalise";
import type {
  ChainTx, DepositAddressRow, DepositChain, Facts, FreezeCheck, LedgerMatch,
  LedgerRow, PriorTransfer, Settings, Token, TokenTransfer,
} from "../types";
import { DEPOSIT_CHAINS } from "../types";

/**
 * Derived values every rule reads. Computed once, deterministically, from facts
 * and settings. No network access and no clock other than facts.checkedAt.
 */
export interface Ctx {
  facts: Facts;
  settings: Settings;
  tx?: ChainTx;
  transfer?: TokenTransfer;
  depositChain?: DepositChain;
  /**
   * File A row for the destination on the tx's chain: the row active at block time, else the
   * row retired most recently before it, else the first row for that address.
   */
  addrOnTxChain?: DepositAddressRow;
  /** Who held the destination address when the tx was mined. */
  addrStatus?: AddressStatus;
  /** Destination registered as a deposit address, but on a different chain. */
  addrOtherChain?: DepositAddressRow;
  customerAddresses: DepositAddressRow[];
  /** Undefined when the current block height is unknown: no rule may treat it as a number. */
  confirmations?: number;
  threshold?: number;
  /** False when the chain gave an amount that is not a plain decimal string (e.g. "1e3"). */
  amountKnown: boolean;
  tokenAccepted: boolean;
  officialContract?: string;
  /** "company" on BNB Chain: the company's declared contract stands in for an issuer contract. */
  officialSource?: "issuer" | "company";
  officialNote?: string;
  impersonation: boolean;
  /** USDT or USDC when the symbol claims to be one, look-alike characters included. */
  claimedToken?: Token;
  /** The symbol uses look-alike characters to pass as claimedToken (e.g. "ÚЅDТ"). */
  lookalikeSymbol: boolean;
  minimum?: string;
  belowMinimum: boolean;
  freezeHits: FreezeCheck[];
  /** Transfers in this tx that go to company deposit addresses on the tx's chain. */
  companyTransferCount: number;
  ledgerMatch?: LedgerMatch;
  lookalike?: { assigned: DepositAddressRow; prior?: PriorTransfer };
  pendingSec?: number;
}

const TOKENS: Token[] = ["USDT", "USDC"];

// Cyrillic and Greek letters that render like Latin capitals. Counterfeit USDT on Ethereum uses
// "ÚЅDТ" (U+0055 U+0301, Cyrillic Dze, D, Cyrillic Te) to pass as USDT (Bitquery, real-data test 24 Oct 2026).
const CONFUSABLE: Record<string, string> = {
  "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S",
  "Т": "T", "Х": "X", "У": "Y", "Ԁ": "D", "Ꭰ": "D", "Ꮪ": "S", "Ꭲ": "T", "Ꮯ": "C", "Ꮜ": "U", "Ս": "U", "Ц": "U",
  "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Υ": "Y",
};

/**
 * The token a symbol claims to be once look-alike characters are folded away: compatibility
 * forms (fullwidth letters), accents and Cyrillic/Greek look-alikes. "ÚЅDТ" claims USDT.
 */
export function claimedSymbol(symbol: string): string {
  const folded = symbol.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase();
  return [...folded].map((ch) => CONFUSABLE[ch] ?? ch).join("").replace(/[\s\u200b-\u200d\ufeff]/g, "");
}

export function asDepositChain(chain: string): DepositChain | undefined {
  return (DEPOSIT_CHAINS as string[]).includes(chain) ? (chain as DepositChain) : undefined;
}

export function pickTransfer(tx: ChainTx, facts: Facts): TokenTransfer | undefined {
  const { transfers } = tx;
  if (transfers.length === 0) return undefined;
  const isCustomers = (to: string) =>
    facts.depositAddresses.some((r) => sameAddress(r.address, to) && r.customerId === facts.customerId);
  const isCompany = (to: string) => facts.depositAddresses.some((r) => sameAddress(r.address, to));
  // Batch payouts carry many Transfer events; the one that concerns us is the one to our address.
  // Within those, a stablecoin (or a token claiming to be one) beats e.g. WETH routed through the
  // same address in a swap (real-data test: an MEV-style tx sent WETH, USDC and USDT to one address).
  const exact = (t: TokenTransfer) => ["USDT", "USDC"].includes(t.tokenSymbol);
  const stable = (t: TokenTransfer) => ["USDT", "USDC"].includes(claimedSymbol(t.tokenSymbol));
  const pick = (ok: (to: string) => boolean) =>
    transfers.find((t) => ok(t.to) && exact(t)) ?? transfers.find((t) => ok(t.to) && stable(t)) ?? transfers.find((t) => ok(t.to));
  return pick(isCustomers) ?? pick(isCompany) ?? transfers.find(stable) ?? transfers[0];
}

/**
 * Same first 3 and last 4 significant characters, but different addresses. EVM compares hex after
 * "0x"; Tron compares after the fixed leading "T". The spec's first-4 rule missed the largest
 * real USDT poisoning in the test set (0xbaf4…f8b5 vs 0xbaff…f8b5, 49,999,950 USDT, Dec 2025).
 * Two unrelated addresses agree on 7 hex characters by chance about once in 268 million pairs.
 */
export function looksAlike(a: string, b: string): boolean {
  if (sameAddress(a, b)) return false;
  const norm = (s: string) => {
    const c = canonicalAddress(s);
    return /^0x/i.test(c) ? c.slice(2).toLowerCase() : c.replace(/^T/, "");
  };
  const x = norm(a);
  const y = norm(b);
  return x.slice(0, 3) === y.slice(0, 3) && x.slice(-4) === y.slice(-4);
}

/**
 * this_customer   assigned to the case's customer at block time
 * other_customer  assigned to a different customer at block time (D17)
 * retired         retired before block time and not reassigned (D18)
 * unattributed    company address, but ownership at block time can't be tied to this case
 *                 (no customer on the case, or the tx predates the assignment)
 */
export type AddressStatus = "this_customer" | "other_customer" | "retired" | "unattributed";

export function addressAtTime(rows: DepositAddressRow[], at: string, customerId?: string):
  { row?: DepositAddressRow; status?: AddressStatus } {
  if (rows.length === 0) return {};
  const t = Date.parse(at);
  const active = rows.find((r) => Date.parse(r.assignedAt) <= t && (!r.retiredAt || t < Date.parse(r.retiredAt)));
  if (active) {
    if (!customerId) return { row: active, status: "unattributed" };
    return { row: active, status: active.customerId === customerId ? "this_customer" : "other_customer" };
  }
  const retired = rows
    .filter((r) => r.retiredAt && Date.parse(r.retiredAt) <= t)
    .sort((a, b) => Date.parse(b.retiredAt!) - Date.parse(a.retiredAt!))[0];
  if (retired) return { row: retired, status: "retired" };
  return { row: rows[0], status: "unattributed" };
}

/**
 * The two poisoning shapes seen in real cases, both before the payment:
 *   dust in:     the look-alike sends the sender a zero-value or dust transfer (any token)
 *   forged out:  a transfer "from the sender to the look-alike" that the sender didn't really make:
 *                zero value, or in a different token contract than the payment (counterfeit)
 */
export function isPoisoning(p: PriorTransfer, payment: TokenTransfer, settings: Settings): boolean {
  const dust = isDecimal(p.amount) && compareDecimal(p.amount, settings.dustThreshold) <= 0;
  if (sameAddress(p.from, payment.to) && sameAddress(p.to, payment.from)) return dust;
  if (sameAddress(p.from, payment.from) && sameAddress(p.to, payment.to)) {
    const zero = isDecimal(p.amount) && compareDecimal(p.amount, "0") === 0;
    const otherToken = !!p.tokenContract && !sameAddress(p.tokenContract, payment.tokenContract);
    return zero || otherToken;
  }
  return false;
}

export function buildContext(facts: Facts, settings: Settings): Ctx {
  const tx = facts.tx;
  const transfer = tx ? pickTransfer(tx, facts) : undefined;
  const depositChain = tx ? asDepositChain(tx.chain) : undefined;
  const customerAddresses = facts.depositAddresses.filter((r) => r.customerId === facts.customerId);

  const { row: addrOnTxChain, status: addrStatus } = transfer && tx
    ? addressAtTime(facts.depositAddresses.filter((r) => r.chain === tx.chain && sameAddress(r.address, transfer.to)), tx.blockTime, facts.customerId)
    : {};
  const addrOtherChain = transfer && tx && !addrOnTxChain
    ? facts.depositAddresses.find((r) => r.chain !== tx.chain && sameAddress(r.address, transfer.to))
    : undefined;

  const confirmations = tx && depositChain && facts.currentBlock !== undefined
    ? Math.max(0, facts.currentBlock - tx.blockNumber)
    : undefined;
  const threshold = depositChain ? settings.confirmations[depositChain] : undefined;

  const claimed = transfer ? claimedSymbol(transfer.tokenSymbol) : undefined;
  const symbol = claimed && (TOKENS as string[]).includes(claimed) ? (claimed as Token) : undefined;
  const official = tx && symbol ? officialContractFor(tx.chain, symbol, settings) : undefined;
  const officialContract = official?.contract;
  const officialSource = official?.source;
  const officialNote = official?.note;
  const impersonation = !!(transfer && officialContract && !sameAddress(transfer.tokenContract, officialContract));
  const tokenAccepted = !!(transfer && depositChain &&
    settings.acceptedTokens[depositChain].some((a) => sameAddress(a.contract, transfer.tokenContract)));

  // An amount that isn't a plain decimal is an unknown fact, never a crash.
  const amountKnown = !!transfer && isDecimal(transfer.amount);
  const lookalikeSymbol = !!(transfer && symbol && transfer.tokenSymbol !== symbol);
  const minimum = depositChain && symbol && tokenAccepted ? settings.minimums[depositChain][symbol] : undefined;
  const belowMinimum = !!(amountKnown && minimum && compareDecimal(transfer!.amount, minimum) < 0);

  const freezeHits = facts.freezes.filter((f) => f.frozen);

  const companyTransferCount = tx && depositChain
    ? tx.transfers.filter((t) => facts.depositAddresses.some((r) => r.chain === depositChain && sameAddress(r.address, t.to))).length
    : 0;
  const ledgerMatch = tx && transfer && depositChain
    ? matchLedger(facts.ledger, tx, transfer, depositChain, companyTransferCount, settings, facts.customerId)
    : undefined;

  let lookalike: Ctx["lookalike"];
  if (transfer && tx && !addrOnTxChain && !addrOtherChain) {
    const assigned = customerAddresses.find((r) => looksAlike(r.address, transfer.to));
    if (assigned) {
      const prior = facts.senderHistory.find((p) => Date.parse(p.time) < Date.parse(tx.blockTime) && isPoisoning(p, transfer, settings));
      lookalike = { assigned, prior };
    }
  }

  const pendingSec = facts.mempool
    ? Math.max(0, (Date.parse(facts.checkedAt) - Date.parse(facts.mempool.firstSeenAt)) / 1000)
    : undefined;

  return {
    facts, settings, tx, transfer, depositChain, addrOnTxChain, addrStatus, addrOtherChain, customerAddresses,
    confirmations, threshold, amountKnown, tokenAccepted, officialContract, officialSource, officialNote, impersonation,
    claimedToken: symbol, lookalikeSymbol, minimum, belowMinimum,
    freezeHits, companyTransferCount, ledgerMatch, lookalike, pendingSec,
  };
}

/**
 * Spec rule precedence 5: a ledger row decides a High verdict only on chain + tx_hash +
 * transfer index + token contract. File B carries a token symbol, so the row's contract is the
 * accepted contract for that symbol on that chain.
 */
export function matchLedger(
  ledger: LedgerRow[], tx: ChainTx, transfer: TokenTransfer, chain: DepositChain,
  companyTransferCount: number, settings: Settings, customerId?: string,
): LedgerMatch | undefined {
  const contractOf = (r: LedgerRow) => settings.acceptedTokens[r.chain].find((a) => a.symbol === r.token)?.contract;
  let ambiguous: LedgerRow | undefined;
  for (const r of ledger) {
    if (!r.txHash || r.chain !== chain || normaliseHash(r.txHash) !== normaliseHash(tx.hash)) continue;
    const contract = contractOf(r);
    if (!contract || !sameAddress(contract, transfer.tokenContract)) continue;
    if (r.transferIndex !== undefined) {
      if (r.transferIndex === transfer.logIndex) return { row: r, quality: "exact" };
      continue; // A row for a different transfer in the same tx.
    }
    if (companyTransferCount <= 1) return { row: r, quality: "exact" };
    ambiguous ??= r;
  }
  if (ambiguous) return { row: ambiguous, quality: "ambiguous" };
  // Fallback without a hash: only this customer's rows, not dated before the transfer (an
  // earlier deposit of the same amount must not stand in for this one). A row with no
  // credited_at can't be placed in time, so it stays a candidate; it caps at Medium anyway.
  if (!customerId || !isDecimal(transfer.amount)) return undefined;
  const minedAt = Date.parse(tx.blockTime);
  const byAmount = ledger.find((r) => !r.txHash && r.chain === chain && r.customerId === customerId &&
    (!r.creditedAt || Date.parse(r.creditedAt) >= minedAt) &&
    sameAddress(r.toAddress, transfer.to) && isDecimal(r.amount) && compareDecimal(r.amount, transfer.amount) === 0);
  return byAmount ? { row: byAmount, quality: "address_amount" } : undefined;
}
