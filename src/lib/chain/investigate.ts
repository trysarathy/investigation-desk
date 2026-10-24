// Live fact gathering for one case (spec 6, steps 1–2): normalise the input, look the hash up on
// every supported chain in parallel, then read the extra facts week 3 rules need:
//   D09: issuer freeze calls on the official USDT/USDC contract (sender and destination)
//   D07b: the look-alike address's earlier transfers to the sender, on Tron and Ethereum only
// No rule runs here; the pure engine decides.

import { sameAddress } from "../address";
import { explorerTxUrl } from "../catalogue";
import { officialContractFor } from "../contracts";
import { compareDecimal, isDecimal } from "../decimal";
import { isPoisoning, looksAlike, pickTransfer } from "../engine/context";
import { normaliseInput } from "../normalise";
import type {
  Chain, ChainTx, DepositAddressRow, EvmChain, Facts, FreezeCheck, LedgerRow, PriorTransfer, RawResponse, Settings, Token,
} from "../types";
import { ALL_CHAINS } from "../types";
import { formatUnits } from "./abi";
import { type BlockscoutHistory, EtherscanSource, type EvmFetcher } from "./evm";
import { ChainApiError } from "./http";
import type { TronFetcher } from "./tron";
import type { ChainLookupResult } from "./types";

export interface Workspace {
  customerId?: string;
  depositAddresses: DepositAddressRow[];
  ledger: LedgerRow[];
  ledgerUploadedAt: string;
  fileARejectedRows?: number;
  fileBRejectedRows?: number;
}

export interface LiveDeps {
  tron: TronFetcher;
  evm: EvmFetcher;
  /** Keyless Ethereum token history for D07b when no Etherscan key is set. */
  history?: BlockscoutHistory;
  now?: () => Date;
}

// Verified by computing keccak256 of the signature (tests/chain.test.ts), not recalled.
export const FREEZE_SELECTOR: Record<Token, { fn: "isBlackListed" | "isBlacklisted"; selector: string }> = {
  USDT: { fn: "isBlackListed", selector: "0xe47d6060" },
  USDC: { fn: "isBlacklisted", selector: "0xfe575a87" },
};

export async function fetchFacts(rawInput: string, ws: Workspace, deps: LiveDeps, settings: Settings): Promise<Facts> {
  const input = normaliseInput(rawInput);
  const now = deps.now ?? (() => new Date());
  const base: Facts = {
    input,
    customerId: ws.customerId,
    checkedAt: now().toISOString(),
    lookups: [],
    freezes: [],
    senderHistory: [],
    depositAddresses: ws.depositAddresses,
    ledger: ws.ledger,
    ledgerUploadedAt: ws.ledgerUploadedAt,
    fileARejectedRows: ws.fileARejectedRows,
    fileBRejectedRows: ws.fileBRejectedRows,
    rawResponses: [],
  };
  // Live lookup is by transaction hash. Address and customer-reference search come later.
  if (input.kind !== "hash") return base;

  // Each chain records its own raw responses so concurrent lookups keep a stable order.
  const perChain = new Map<Chain, RawResponse[]>(ALL_CHAINS.map((c) => [c, []]));
  const results = await Promise.all(ALL_CHAINS.map((chain) => lookupOne(chain, input.value, deps, perChain.get(chain)!)));
  const found = results.find((r) => r.tx);
  const facts: Facts = {
    ...base,
    lookups: results.map((r) => r.lookup),
    tx: found?.tx,
    currentBlock: found?.currentBlock,
  };
  const extra: RawResponse[] = [];
  if (found?.tx && !facts.customerId) Object.assign(facts, inferCustomer(found.tx, facts));
  if (found?.tx) {
    Object.assign(facts, await freezeFacts(found.tx, facts, settings, deps, extra));
    Object.assign(facts, await historyFacts(found.tx, facts, settings, deps, extra));
  }
  facts.rawResponses = [...ALL_CHAINS.flatMap((c) => perChain.get(c)!), ...extra];
  return facts;
}

/** One chain's answer for one hash. A failure is an error lookup, never "not found". */
export async function lookupOne(chain: Chain, hash: string, deps: LiveDeps, raws: RawResponse[]): Promise<ChainLookupResult> {
  try {
    return chain === "tron" ? await deps.tron.lookup(hash, raws) : await deps.evm.lookup(chain as EvmChain, hash, raws);
  } catch (e) {
    // Any failure part-way through is an unknown, never "not found": the engine pauses on it.
    const err = e instanceof ChainApiError ? e : undefined;
    if (err?.raw) raws.push(err.raw);
    return {
      lookup: {
        chain, result: "error", error: err?.message ?? "lookup failed",
        fetchedAt: err?.raw?.fetchedAt ?? new Date().toISOString(),
        sourceUrl: explorerTxUrl(chain, hash), rawBody: err?.raw?.body ?? "",
      },
    };
  }
}

/**
 * A pasted hash has no customer. File A says who held the destination when the transfer was
 * mined; that company record names the case's customer. No owner at that time, no inference.
 */
function inferCustomer(tx: ChainTx, facts: Facts): Pick<Facts, "customerId" | "customerInferredFromRow"> | object {
  const transfer = pickTransfer(tx, facts);
  if (!transfer) return {};
  const t = Date.parse(tx.blockTime);
  const owner = facts.depositAddresses.find((r) => r.chain === tx.chain && sameAddress(r.address, transfer.to) &&
    Date.parse(r.assignedAt) <= t && (!r.retiredAt || t < Date.parse(r.retiredAt)));
  return owner ? { customerId: owner.customerId, customerInferredFromRow: owner.row } : {};
}

/** D09: ask the issuer's own contract whether sender or destination is frozen, read-only. */
async function freezeFacts(tx: ChainTx, facts: Facts, settings: Settings, deps: LiveDeps, raws: RawResponse[]):
  Promise<Pick<Facts, "freezes" | "freezeStatus">> {
  const transfer = pickTransfer(tx, facts);
  const token = transfer?.tokenSymbol as Token | undefined;
  const resolved = token && token in FREEZE_SELECTOR ? officialContractFor(tx.chain, token, settings) : undefined;
  // Only the genuine issuer contract can say an address is frozen. On BNB Chain the official
  // contract is the company's declared one, which has no issuer freeze function: a known gap.
  const official = resolved?.source === "issuer" ? resolved.contract : undefined;
  if (!transfer || !token || !official || !sameAddress(official, transfer.tokenContract)) {
    return { freezes: [], freezeStatus: "not_supported" };
  }
  const { fn, selector } = FREEZE_SELECTOR[token];
  const freezes: FreezeCheck[] = [];
  for (const [role, address] of [["sender", transfer.from], ["deposit", transfer.to]] as const) {
    let frozen: boolean | undefined;
    if (tx.chain === "tron") {
      frozen = await deps.tron.isBlackListed(official, address, raws);
    } else {
      const word = address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
      const out = await deps.evm.ethCall(tx.chain as EvmChain, official, `${selector}${word}`, 60, raws);
      frozen = out && /^0x[0-9a-f]{64}$/i.test(out) ? BigInt(out) !== 0n : undefined;
    }
    if (frozen === undefined) return { freezes: [], freezeStatus: "failed" };
    freezes.push({ chain: tx.chain, token, address, role, method: fn, frozen, blockNumber: facts.currentBlock ?? tx.blockNumber });
  }
  return { freezes, freezeStatus: "checked" };
}

/**
 * D07b: only when the pattern could match (destination isn't a company address but looks like
 * this customer's), fetch the destination's earlier transfers to the sender. Tron uses TronGrid,
 * Ethereum uses Etherscan's account module; public-RPC chains can't list history, so D07b is off there.
 */
async function historyFacts(tx: ChainTx, facts: Facts, settings: Settings, deps: LiveDeps, raws: RawResponse[]):
  Promise<Pick<Facts, "senderHistory" | "senderHistoryStatus">> {
  const transfer = pickTransfer(tx, facts);
  if (!transfer) return { senderHistory: [] };
  const isCompany = facts.depositAddresses.some((r) => sameAddress(r.address, transfer.to));
  const mine = facts.depositAddresses.filter((r) => r.customerId === facts.customerId);
  if (isCompany || !mine.some((r) => looksAlike(r.address, transfer.to))) return { senderHistory: [] };

  try {
    let history: PriorTransfer[] = [];
    if (tx.chain === "tron") {
      const rows = await deps.tron.trc20From(transfer.to, Date.parse(tx.blockTime), raws);
      history = rows.map((r) => ({
        chain: "tron" as const, hash: r.transaction_id, from: r.from, to: r.to, tokenSymbol: r.token_info?.symbol ?? "UNKNOWN", tokenContract: r.token_info?.address,
        amount: r.token_info?.decimals !== undefined && /^\d+$/.test(r.value) ? formatUnits(BigInt(r.value), r.token_info.decimals) : "",
        time: new Date(r.block_timestamp).toISOString(),
      }));
    } else if (tx.chain === "ethereum") {
      const src = deps.evm.source("ethereum");
      if (src instanceof EtherscanSource) {
        const rows = await src.tokenTransfersFrom(transfer.to, tx.blockNumber, raws);
        history = rows.map((r) => ({
          chain: "ethereum" as const, hash: r.hash, from: r.from, to: r.to, tokenSymbol: r.tokenSymbol, tokenContract: r.contractAddress,
          amount: /^\d+$/.test(r.value) && /^\d+$/.test(r.tokenDecimal) ? formatUnits(BigInt(r.value), Number(r.tokenDecimal)) : "",
          time: new Date(Number(r.timeStamp) * 1000).toISOString(),
        }));
      } else if (deps.history) {
        const rows = await deps.history.transfersOf(transfer.to, Date.parse(tx.blockTime), raws);
        history = rows.map((r) => ({ chain: "ethereum" as const, hash: r.hash, from: r.from, to: r.to, tokenSymbol: r.symbol,
          tokenContract: r.contract, amount: r.amount, time: r.time }));
      } else {
        return { senderHistory: [], senderHistoryStatus: "not_supported" };
      }
    } else {
      return { senderHistory: [], senderHistoryStatus: "not_supported" };
    }
    // Keep only what D07b reads: dust from the look-alike to this sender, or a forged transfer the other way.
    const relevant = history.filter((p) => isPoisoning(p, transfer, settings));
    return { senderHistory: relevant, senderHistoryStatus: "checked" };
  } catch {
    return { senderHistory: [], senderHistoryStatus: "failed" };
  }
}
