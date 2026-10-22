// Read-only EVM fetcher on Etherscan API V2 (spec section 3): one key, chain picked by chainid.
// Uses the proxy module (JSON-RPC passthrough): eth_getTransactionByHash, eth_getTransactionReceipt,
// eth_getBlockByNumber, eth_blockNumber and eth_call for symbol()/decimals(). The key travels in
// the `apikey` query parameter and is redacted before anything is stored.
// Week 2 finding: the free plan refuses BNB Chain (56), Base (8453) and Optimism (10). Those
// lookups come back as "error", so the engine pauses instead of claiming "not found".

import { explorerTxUrl } from "../catalogue";
import type { ChainTx, EvmChain, RawResponse, TokenTransfer } from "../types";
import { EVM_CHAIN_IDS } from "../types";
import { decodeAbiString, decodeAbiUint, decodeTransferCall, decodeTransferLogs, formatUnits, hexToBigInt } from "./abi";
import { ChainApiError, type ChainClient } from "./http";
import type { ChainLookupResult, TokenMeta } from "./types";

const BASE = "https://api.etherscan.io/v2/api";
const NATIVE: Record<EvmChain, string> = { ethereum: "ETH", bsc: "BNB", polygon: "POL", base: "ETH", arbitrum: "ETH", optimism: "ETH" };

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

const hex = (n: number) => `0x${n.toString(16)}`;

export class EvmFetcher {
  constructor(private readonly client: ChainClient, private readonly apiKey: string) {
    if (!apiKey) throw new ChainApiError("ETHERSCAN_API_KEY is not set", false);
  }

  private async rpc(chain: EvmChain, params: Record<string, string>, ttlSec: number, raws: RawResponse[],
    ttlFor?: (r: RawResponse) => number) {
    const q = new URLSearchParams({ chainid: String(EVM_CHAIN_IDS[chain]), module: "proxy", ...params, apikey: this.apiKey });
    const r = await this.client.request({ method: "GET", url: `${BASE}?${q}` }, { chain, ttlSec, ttlFor });
    raws.push(r);
    return JSON.parse(r.body).result;
  }

  async lookup(chain: EvmChain, hash: string, raws: RawResponse[]): Promise<ChainLookupResult> {
    const txhash = `0x${hash.replace(/^0x/i, "").toLowerCase()}`;
    const sourceUrl = explorerTxUrl(chain, txhash);
    const fetchedAt = () => raws[raws.length - 1]?.fetchedAt ?? new Date().toISOString();
    let tx: Record<string, string> | null;
    try {
      tx = await this.rpc(chain, { action: "eth_getTransactionByHash", txhash }, 30, raws,
        (r) => (JSON.parse(r.body).result?.blockNumber ? Infinity : 15));
    } catch (e) {
      const err = e instanceof ChainApiError ? e : undefined;
      if (err?.raw) raws.push(err.raw);
      return { lookup: { chain, result: "error", error: err?.message ?? "lookup failed",
        fetchedAt: err?.raw?.fetchedAt ?? new Date().toISOString(), sourceUrl, rawBody: err?.raw?.body ?? "" } };
    }
    const base = { chain, fetchedAt: fetchedAt(), sourceUrl, rawBody: raws[raws.length - 1].body };
    if (!tx) return { lookup: { ...base, result: "not_found" } };
    if (!tx.blockNumber) return { lookup: { ...base, result: "pending" } };

    const receipt = await this.rpc(chain, { action: "eth_getTransactionReceipt", txhash }, Infinity, raws);
    const blockNumber = Number(BigInt(tx.blockNumber));
    const block = await this.rpc(chain, { action: "eth_getBlockByNumber", tag: hex(blockNumber), boolean: "false" }, Infinity, raws);
    const head = await this.rpc(chain, { action: "eth_blockNumber" }, 5, raws);

    const failed = receipt?.status !== "0x1";
    const fee = (hexToBigInt(receipt?.gasUsed ?? "0") ?? 0n) * (hexToBigInt(receipt?.effectiveGasPrice ?? tx.gasPrice ?? "0") ?? 0n);
    const transfers: TokenTransfer[] = [];
    const logs = (receipt?.logs ?? []).map((l: { address: string; topics: string[]; data: string; logIndex: string }) =>
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
    const call = async (data: string) => {
      try {
        return (await this.rpc(chain, { action: "eth_call", to: contract, data, tag: "latest" }, Infinity, raws)) as string | undefined;
      } catch {
        return undefined;
      }
    };
    const sym = await call("0x95d89b41"); // symbol()
    const dec = await call("0x313ce567"); // decimals()
    return { symbol: sym ? decodeAbiString(sym) : undefined, decimals: dec ? decodeAbiUint(dec) : undefined };
  }
}
