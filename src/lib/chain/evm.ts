// Read-only EVM fetcher. The lookup logic is the same on every EVM chain; only the data source
// differs (spec section 3, revised 22 Oct):
//   Etherscan API V2 (free key):  Ethereum (1), Polygon (137), Arbitrum (42161)
//   Official public JSON-RPC:     BNB Chain (56), Base (8453), Optimism (10)
// Both speak the same JSON-RPC methods, by transaction hash only: eth_getTransactionByHash,
// eth_getTransactionReceipt (Transfer events come from its logs, so no eth_getLogs),
// eth_getBlockByNumber (block time), eth_blockNumber, and eth_call for token metadata and
// issuer freeze checks. Etherscan's key travels in `apikey` and is redacted before storage.

import { explorerTxUrl } from "../catalogue";
import type { ChainTx, EvmChain, RawResponse, TokenTransfer } from "../types";
import { EVM_CHAIN_IDS } from "../types";
import { decodeAbiString, decodeAbiUint, decodeTransferCall, decodeTransferLogs, formatUnits, hexToBigInt } from "./abi";
import { ChainApiError, KEY_NOT_SET, type ChainClient } from "./http";
import type { ChainLookupResult, TokenMeta } from "./types";

const ETHERSCAN = "https://api.etherscan.io/v2/api";
const NATIVE: Record<EvmChain, string> = { ethereum: "ETH", bsc: "BNB", polygon: "POL", base: "ETH", arbitrum: "ETH", optimism: "ETH" };

type RpcMethod = "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getBlockByNumber" | "eth_blockNumber" | "eth_call";
interface CallOpts { ttlSec: number; ttlFor?: (r: RawResponse) => number }

/** One chain's JSON-RPC answers, from wherever they come. Every raw response lands in `raws`. */
export interface EvmSource {
  readonly kind: "etherscan" | "public-rpc";
  call(method: RpcMethod, params: unknown[], opts: CallOpts, raws: RawResponse[]): Promise<unknown>;
}

async function recorded(raws: RawResponse[], p: Promise<RawResponse>): Promise<RawResponse> {
  try {
    const r = await p;
    raws.push(r);
    return r;
  } catch (e) {
    if (e instanceof ChainApiError && e.raw) raws.push(e.raw);
    throw e;
  }
}

export function etherscanClassifyBody(body: string): { retryable: boolean; message: string } | undefined {
  let j: { status?: string; message?: string; result?: unknown; error?: { message?: string } };
  try {
    j = JSON.parse(body);
  } catch {
    return { retryable: false, message: "Etherscan returned non-JSON" };
  }
  const text = j.error?.message ?? (j.status === "0" && typeof j.result === "string" ? j.result : undefined);
  if (!text) return undefined;
  return { retryable: /rate limit|max calls|too many/i.test(text), message: text };
}

/** Public JSON-RPC errors: rate limits are retried, anything else (e.g. a revert) is final. */
export function jsonRpcClassifyBody(body: string): { retryable: boolean; message: string } | undefined {
  let j: { error?: { code?: number; message?: string } };
  try {
    j = JSON.parse(body);
  } catch {
    return { retryable: false, message: "RPC returned non-JSON" };
  }
  if (!j.error) return undefined;
  const message = j.error.message ?? `RPC error ${j.error.code}`;
  return { retryable: j.error.code === -32005 || j.error.code === -32029 || /rate|limit|too many|capacity|busy/i.test(message), message };
}

export class EtherscanSource implements EvmSource {
  readonly kind = "etherscan" as const;

  // Checked per request, not here (see TronFetcher): a missing key makes the lookup unknown.
  constructor(private readonly client: ChainClient, private readonly apiKey: string, private readonly chain: EvmChain) {}

  private key() {
    if (!this.apiKey) throw new ChainApiError(KEY_NOT_SET("ETHERSCAN_API_KEY"), false);
    return this.apiKey;
  }

  /** Etherscan's proxy module takes JSON-RPC calls as query parameters. */
  async call(method: RpcMethod, params: unknown[], opts: CallOpts, raws: RawResponse[]) {
    const p: Record<string, string> = { action: method };
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") p.txhash = String(params[0]);
    if (method === "eth_getBlockByNumber") Object.assign(p, { tag: String(params[0]), boolean: String(params[1]) });
    if (method === "eth_call") {
      const c = params[0] as { to: string; data: string };
      Object.assign(p, { to: c.to, data: c.data, tag: String(params[1] ?? "latest") });
    }
    const q = new URLSearchParams({ chainid: String(EVM_CHAIN_IDS[this.chain]), module: "proxy", ...p, apikey: this.key() });
    const r = await recorded(raws, this.client.request({ method: "GET", url: `${ETHERSCAN}?${q}` }, { chain: this.chain, ...opts }));
    return JSON.parse(r.body).result;
  }

  /** ERC-20 transfers out of `address` before `beforeBlock` (Etherscan account module; D07b history). */
  async tokenTransfersFrom(address: string, beforeBlock: number, raws: RawResponse[]) {
    const q = new URLSearchParams({ chainid: String(EVM_CHAIN_IDS[this.chain]), module: "account", action: "tokentx",
      address, startblock: "0", endblock: String(beforeBlock - 1), page: "1", offset: "100", sort: "desc", apikey: this.key() });
    const r = await recorded(raws, this.client.request({ method: "GET", url: `${ETHERSCAN}?${q}` }, { chain: this.chain, ttlSec: Infinity }));
    const j = JSON.parse(r.body);
    return (Array.isArray(j.result) ? j.result : []) as {
      hash: string; from: string; to: string; value: string; tokenSymbol: string; tokenDecimal: string; timeStamp: string; contractAddress?: string;
    }[];
  }
}

/**
 * Keyless ERC-20 history on Ethereum for D07b, from Blockscout's public API v2 (eth.blockscout.com).
 * Used when no Etherscan key is set. Newest first; up to three pages of 50.
 */
export class BlockscoutHistory {
  constructor(private readonly client: ChainClient, private readonly base = "https://eth.blockscout.com/api/v2") {}

  async transfersOf(address: string, beforeMs: number, raws: RawResponse[]) {
    const out: { hash: string; from: string; to: string; symbol: string; contract: string; amount: string; time: string }[] = [];
    let next: Record<string, string> | undefined;
    for (let page = 0; page < 3; page++) {
      const q = new URLSearchParams({ type: "ERC-20", ...(next ?? {}) });
      const r = await recorded(raws, this.client.request({ method: "GET", url: `${this.base}/addresses/${address}/token-transfers?${q}` },
        { chain: "ethereum", ttlSec: 60 }));
      type Item = { transaction_hash?: string; timestamp?: string; from?: { hash?: string }; to?: { hash?: string };
        total?: { decimals?: string; value?: string }; token?: { symbol?: string; decimals?: string; address_hash?: string; address?: string } };
      const j = JSON.parse(r.body) as { items?: Item[]; next_page_params?: Record<string, unknown> | null };
      for (const t of j.items ?? []) {
        const dec = Number(t.total?.decimals ?? t.token?.decimals);
        const value = String(t.total?.value ?? "");
        const time = String(t.timestamp ?? "");
        out.push({
          hash: String(t.transaction_hash), from: String(t.from?.hash ?? "").toLowerCase(), to: String(t.to?.hash ?? "").toLowerCase(),
          symbol: String(t.token?.symbol ?? "UNKNOWN"), contract: String(t.token?.address_hash ?? t.token?.address ?? "").toLowerCase(),
          amount: /^\d+$/.test(value) && Number.isInteger(dec) ? formatUnits(BigInt(value), dec) : "", time,
        });
      }
      const oldest = out.length ? Date.parse(out[out.length - 1].time) : NaN;
      if (!j.next_page_params || (Number.isFinite(oldest) && oldest < beforeMs - 30 * 86400_000)) break;
      next = Object.fromEntries(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)]));
    }
    return out.filter((t) => Date.parse(t.time) < beforeMs);
  }
}

export function blockscoutClassifyBody(body: string): { retryable: boolean; message: string } | undefined {
  try {
    const j = JSON.parse(body);
    if (j && typeof j.message === "string" && !Array.isArray(j.items)) return { retryable: /too many|rate/i.test(j.message), message: j.message };
  } catch {
    return { retryable: false, message: "Blockscout returned non-JSON" };
  }
  return undefined;
}

export class JsonRpcSource implements EvmSource {
  readonly kind = "public-rpc" as const;

  constructor(private readonly client: ChainClient, private readonly url: string, private readonly chain: EvmChain) {}

  async call(method: RpcMethod, params: unknown[], opts: CallOpts, raws: RawResponse[]) {
    // A fixed id keeps identical requests identical, so they cache and replay.
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const r = await recorded(raws, this.client.request(
      { method: "POST", url: this.url, body, headers: { "content-type": "application/json" } }, { chain: this.chain, ...opts }));
    return JSON.parse(r.body).result;
  }
}

const hex = (n: number) => `0x${n.toString(16)}`;

export class EvmFetcher {
  constructor(private readonly sources: Partial<Record<EvmChain, EvmSource>>) {}

  source(chain: EvmChain): EvmSource | undefined {
    return this.sources[chain];
  }

  async lookup(chain: EvmChain, hash: string, raws: RawResponse[]): Promise<ChainLookupResult> {
    const txhash = `0x${hash.replace(/^0x/i, "").toLowerCase()}`;
    const sourceUrl = explorerTxUrl(chain, txhash);
    const src = this.sources[chain];
    if (!src) {
      return { lookup: { chain, result: "error", error: "No data source configured", fetchedAt: new Date().toISOString(), sourceUrl, rawBody: "" } };
    }
    let tx: Record<string, string> | null;
    try {
      tx = (await src.call("eth_getTransactionByHash", [txhash], { ttlSec: 30,
        ttlFor: (r) => (JSON.parse(r.body).result?.blockNumber ? Infinity : 15) }, raws)) as Record<string, string> | null;
    } catch (e) {
      const err = e instanceof ChainApiError ? e : undefined;
      return { lookup: { chain, result: "error", error: err?.message ?? "lookup failed",
        fetchedAt: err?.raw?.fetchedAt ?? new Date().toISOString(), sourceUrl, rawBody: err?.raw?.body ?? "" } };
    }
    const first = raws[raws.length - 1];
    const base = { chain, fetchedAt: first.fetchedAt, sourceUrl, rawBody: first.body };
    if (!tx) return { lookup: { ...base, result: "not_found" } };
    if (!tx.blockNumber) return { lookup: { ...base, result: "pending" } };

    const receipt = (await src.call("eth_getTransactionReceipt", [txhash], { ttlSec: 30,
      ttlFor: (r) => (JSON.parse(r.body).result?.status ? Infinity : 0) }, raws)) as Record<string, unknown> & {
      status?: string; gasUsed?: string; effectiveGasPrice?: string; logs?: { address: string; topics: string[]; data: string; logIndex: string }[];
    };
    // Some public nodes return null for receipts they no longer hold. A mined transaction always
    // has a receipt, so a missing one is an unknown, never "failed" (real-data test, 24 Oct 2026:
    // publicnode returned null for months-old Ethereum receipts and successful payments showed D03).
    if (!receipt || typeof receipt.status !== "string") {
      throw new ChainApiError(`${src.kind}: receipt not available from this node`, false);
    }
    const blockNumber = Number(BigInt(tx.blockNumber));
    const block = (await src.call("eth_getBlockByNumber", [hex(blockNumber), false], { ttlSec: Infinity }, raws)) as { timestamp: string };
    const head = (await src.call("eth_blockNumber", [], { ttlSec: 5 }, raws)) as string | undefined;

    const failed = receipt.status === "0x0";
    const fee = (hexToBigInt(receipt?.gasUsed ?? "0") ?? 0n) * (hexToBigInt(receipt?.effectiveGasPrice ?? tx.gasPrice ?? "0") ?? 0n);
    const transfers: TokenTransfer[] = [];
    const logs = (receipt?.logs ?? []).map((l) =>
      ({ address: l.address, topics: l.topics ?? [], data: l.data ?? "", index: Number(BigInt(l.logIndex)) }));
    for (const t of decodeTransferLogs(logs)) {
      transfers.push(await this.transfer(chain, `0x${t.contractHex}`, t.index, `0x${t.fromHex}`, `0x${t.toHex}`, t.value, raws));
    }
    if (failed && transfers.length === 0 && tx.to && tx.input) {
      const call = decodeTransferCall(tx.input);
      if (call) transfers.push(await this.transfer(chain, tx.to.toLowerCase(), 0, tx.from.toLowerCase(), `0x${call.toHex}`, call.value, raws));
    }

    const chainTx: ChainTx = {
      chain,
      hash: txhash,
      status: failed ? "failed" : "success",
      errorCode: failed ? "REVERTED (receipt status 0)" : undefined,
      feeBurned: fee > 0n ? formatUnits(fee, 18) : undefined,
      feeToken: fee > 0n ? NATIVE[chain] : undefined,
      blockNumber,
      blockTime: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
      isBatch: transfers.length > 1,
      transfers,
    };
    const current = head ? Number(BigInt(head)) : NaN;
    return { lookup: { ...base, result: "found" }, tx: chainTx, currentBlock: Number.isFinite(current) ? current : undefined };
  }

  /** Read-only eth_call at the latest block; undefined on any error (a revert means "no such function"). */
  async ethCall(chain: EvmChain, to: string, data: string, ttlSec: number, raws: RawResponse[]): Promise<string | undefined> {
    const src = this.sources[chain];
    if (!src) return undefined;
    try {
      const r = (await src.call("eth_call", [{ to, data }, "latest"], { ttlSec }, raws)) as string | undefined;
      return r && r !== "0x" ? r : undefined;
    } catch {
      return undefined;
    }
  }

  private async transfer(chain: EvmChain, contract: string, index: number, from: string, to: string,
    value: bigint | undefined, raws: RawResponse[]): Promise<TokenTransfer> {
    const m = await this.tokenMeta(chain, contract, raws);
    return {
      logIndex: index,
      tokenContract: contract,
      tokenSymbol: m.symbol ?? "UNKNOWN",
      from,
      to,
      amount: value !== undefined && m.decimals !== undefined ? formatUnits(value, m.decimals) : "",
    };
  }

  private async tokenMeta(chain: EvmChain, contract: string, raws: RawResponse[]): Promise<TokenMeta> {
    const sym = await this.ethCall(chain, contract, "0x95d89b41", Infinity, raws); // symbol()
    const dec = await this.ethCall(chain, contract, "0x313ce567", Infinity, raws); // decimals()
    return { symbol: sym ? decodeAbiString(sym) : undefined, decimals: dec ? decodeAbiUint(dec) : undefined };
  }
}
