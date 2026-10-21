import { compareDecimal } from "../decimal";
import { normaliseHash, sameAddress } from "../normalise";
import type {
  ChainTx, DepositAddressRow, DepositChain, Facts, FreezeCheck, LedgerRow,
  PriorTransfer, Settings, Token, TokenTransfer,
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
  /** Destination registered as a deposit address on the chain the tx is on. */
  addrOnTxChain?: DepositAddressRow;
  /** Destination registered as a deposit address, but on a different chain. */
  addrOtherChain?: DepositAddressRow;
  customerAddresses: DepositAddressRow[];
  confirmations?: number;
  threshold?: number;
  tokenAccepted: boolean;
  officialContract?: string;
  impersonation: boolean;
  minimum?: string;
  belowMinimum: boolean;
  freezeHits: FreezeCheck[];
  ledgerRow?: LedgerRow;
  unhashedLedgerCandidate?: LedgerRow;
  lookalike?: { assigned: DepositAddressRow; prior?: PriorTransfer };
  pendingSec?: number;
}

const TOKENS: Token[] = ["USDT", "USDC"];

export function asDepositChain(chain: string): DepositChain | undefined {
  return (DEPOSIT_CHAINS as string[]).includes(chain) ? (chain as DepositChain) : undefined;
}

function pickTransfer(tx: ChainTx, facts: Facts): TokenTransfer | undefined {
  const { transfers } = tx;
  if (transfers.length === 0) return undefined;
  const isCustomers = (to: string) =>
    facts.depositAddresses.some((r) => sameAddress(r.address, to) && r.customerId === facts.customerId);
  const isCompany = (to: string) => facts.depositAddresses.some((r) => sameAddress(r.address, to));
  // Batch payouts carry many Transfer events; the one that concerns us is the one to our address.
  return transfers.find((t) => isCustomers(t.to)) ?? transfers.find((t) => isCompany(t.to)) ?? transfers[0];
}

/** First 4 and last 4 characters match, but the addresses differ. */
export function looksAlike(a: string, b: string): boolean {
  if (sameAddress(a, b)) return false;
  const norm = (s: string) => (s.startsWith("0x") ? s.toLowerCase().slice(2) : s);
  const x = norm(a);
  const y = norm(b);
  return x.slice(0, 4) === y.slice(0, 4) && x.slice(-4) === y.slice(-4);
}

export function buildContext(facts: Facts, settings: Settings): Ctx {
  const tx = facts.tx;
  const transfer = tx ? pickTransfer(tx, facts) : undefined;
  const depositChain = tx ? asDepositChain(tx.chain) : undefined;
  const customerAddresses = facts.depositAddresses.filter((r) => r.customerId === facts.customerId);

  const addrOnTxChain = transfer && tx
    ? facts.depositAddresses.find((r) => r.chain === tx.chain && sameAddress(r.address, transfer.to))
    : undefined;
  const addrOtherChain = transfer && tx && !addrOnTxChain
    ? facts.depositAddresses.find((r) => r.chain !== tx.chain && sameAddress(r.address, transfer.to))
    : undefined;

  const confirmations = tx && depositChain && facts.currentBlock !== undefined
    ? Math.max(0, facts.currentBlock - tx.blockNumber)
    : undefined;
  const threshold = depositChain ? settings.confirmations[depositChain] : undefined;

  const symbol = transfer && (TOKENS as string[]).includes(transfer.tokenSymbol)
    ? (transfer.tokenSymbol as Token)
    : undefined;
  const officialContract = tx && symbol ? settings.officialContracts[tx.chain]?.[symbol] : undefined;
  const impersonation = !!(transfer && officialContract && !sameAddress(transfer.tokenContract, officialContract));
  const tokenAccepted = !!(transfer && depositChain &&
    settings.acceptedTokens[depositChain].some((a) => sameAddress(a.contract, transfer.tokenContract)));

  const minimum = depositChain && symbol && tokenAccepted ? settings.minimums[depositChain][symbol] : undefined;
  const belowMinimum = !!(transfer && minimum && compareDecimal(transfer.amount, minimum) < 0);

  const freezeHits = facts.freezes.filter((f) => f.frozen);

  const hash = tx?.hash ?? (facts.input.kind === "hash" ? facts.input.value : undefined);
  // D13 and D14 are High confidence, so they only ever use an exact tx_hash join.
  const ledgerRow = hash
    ? facts.ledger.find((r) => r.txHash && normaliseHash(r.txHash) === normaliseHash(hash))
    : undefined;
  const unhashedLedgerCandidate = !ledgerRow && transfer && depositChain
    ? facts.ledger.find((r) => !r.txHash && r.chain === depositChain &&
        sameAddress(r.toAddress, transfer.to) && compareDecimal(r.amount, transfer.amount) === 0)
    : undefined;

  let lookalike: Ctx["lookalike"];
  if (transfer && tx && !addrOnTxChain && !addrOtherChain) {
    const assigned = customerAddresses.find((r) => looksAlike(r.address, transfer.to));
    if (assigned) {
      const prior = facts.senderHistory.find((p) =>
        sameAddress(p.from, transfer.to) &&
        sameAddress(p.to, transfer.from) &&
        compareDecimal(p.amount, settings.dustThreshold) <= 0 &&
        Date.parse(p.time) < Date.parse(tx.blockTime));
      lookalike = { assigned, prior };
    }
  }

  const pendingSec = facts.mempool
    ? Math.max(0, (Date.parse(facts.checkedAt) - Date.parse(facts.mempool.firstSeenAt)) / 1000)
    : undefined;

  return {
    facts, settings, tx, transfer, depositChain, addrOnTxChain, addrOtherChain, customerAddresses,
    confirmations, threshold, tokenAccepted, officialContract, impersonation, minimum, belowMinimum,
    freezeHits, ledgerRow, unhashedLedgerCandidate, lookalike, pendingSec,
  };
}
