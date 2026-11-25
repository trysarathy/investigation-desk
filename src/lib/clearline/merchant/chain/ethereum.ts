/**
 * EVM JSON-RPC reader (v1: Ethereum, Polygon, Base, Arbitrum One; `EthereumReader` is the Ethereum default) for ERC-20 transfers (USDC `0xA0b8…eB48`, USDT `0xdAC1…1ec7`). READ-ONLY: it calls only
 * eth_getTransactionReceipt, eth_getBlockByNumber, eth_blockNumber and eth_getLogs. No eth_sendRawTransaction, no
 * eth_sendTransaction, no signing method exists here (see READ_ONLY_RPC_METHODS). ETHEREUM_RPC_URL may embed a key in
 * its path or query; it is redacted from every reason and evidence record (evidence keeps the host only).
 *
 * Finality: confirmations = head − block + 1; `finalised` only at ≥ confirmationsRequired AND after a second receipt
 * read returns the same block number AND block hash, and the canonical block at that height has that hash.
 * v1: on a network whose finality rule is "finalized_tag" (networks.ts) the block must also be at or below the node's
 * `finalized` block. Other networks report evidence source "evm-rpc" (Ethereum keeps "ethereum-rpc").
 */
import { type ChainTransferFact, type Evidence, type IncomingOutcome, type NonMatchingTokenFact, type TransferOutcome, type UnresolvedTx, confirmationsOf, hexToBigInt, requiredConfirmations } from "./model";
import { type FinalityRule, NETWORK_READ_SPECS } from "./networks";
import { type ReaderDeps, type ReaderOptions, TRANSFER_TOPIC, fetchJson, isObj, makeDeps } from "./reader-common";
import { Secrets } from "./transport";

/** The only JSON-RPC methods this reader may send. Enforced in `rpc()`. */
export const READ_ONLY_RPC_METHODS = ["eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_blockNumber", "eth_getLogs"] as const;
type RpcMethod = (typeof READ_ONLY_RPC_METHODS)[number];

export type EvmNetwork = "ethereum" | "polygon" | "base" | "arbitrum_one";

export interface EthereumReaderOptions extends ReaderOptions {
  rpcUrl: string;
  /** v1: which EVM network this endpoint serves (default "ethereum"). */
  network?: EvmNetwork;
  /** v1: the finality rule (default: the network's rule in networks.ts). */
  finality?: FinalityRule;
  /** v1: a label for this provider (e.g. "primary", "fallback"), used in health and conflict reasons. */
  provider?: string;
  /** Largest eth_getLogs block span [ASSUMPTION: 2,000 blocks; common free-tier limits are 2k–10k]. Shrinks on range errors. */
  maxLogRange?: bigint;
  /** Bound on eth_getBlockByNumber probes when mapping a time window to blocks [ASSUMPTION: 96]. */
  maxBlockLookups?: number;
  /** Bound on eth_getLogs requests per listIncoming [ASSUMPTION: 400]. */
  maxLogRequests?: number;
}

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
/** Messages providers use for an eth_getLogs span or result that is too large. */
const RANGE_ERR = /range|too many|too large|limit exceeded|exceed|query returned more than|response size|block limit/i;

type RpcResult = { ok: true; result: unknown; evidence: Evidence } | { ok: false; reason: string; rpcError?: { code?: number; message: string }; evidence: Evidence };

const toHex = (n: bigint) => "0x" + n.toString(16);
const padTopic = (addr: string) => "0x" + addr.toLowerCase().slice(2).padStart(64, "0");
const topicAddr = (t: string) => "0x" + t.toLowerCase().replace(/^0x/, "").slice(-40);

interface Receipt { status: string; blockNumber: bigint; blockHash: string; logs: unknown[] }

export class EthereumReader {
  readonly network: EvmNetwork;
  readonly provider: string;
  private readonly finality: FinalityRule;
  private readonly d: ReaderDeps;
  private readonly url: string;
  private readonly maxLogRange: bigint;
  private readonly maxBlockLookups: number;
  private readonly maxLogRequests: number;
  private nextId = 1;

  constructor(o: EthereumReaderOptions) {
    this.network = o.network ?? "ethereum";
    this.provider = o.provider ?? "primary";
    this.finality = o.finality ?? NETWORK_READ_SPECS[this.network].finality;
    this.d = makeDeps(this.network === "ethereum" ? "ethereum-rpc" : "evm-rpc", o, new Secrets(Secrets.fromUrl(o.rpcUrl)));
    this.url = o.rpcUrl;
    this.maxLogRange = o.maxLogRange ?? 2_000n;
    this.maxBlockLookups = o.maxBlockLookups ?? 96;
    this.maxLogRequests = o.maxLogRequests ?? 400;
  }

  private async rpc(method: RpcMethod, params: unknown[]): Promise<RpcResult> {
    if (!(READ_ONLY_RPC_METHODS as readonly string[]).includes(method)) throw new Error("refused: not a read-only RPC method");
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params });
    const r = await fetchJson(this.d, { url: this.url, method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body }, method);
    if (!r.ok) return r;
    const j = r.json;
    if (!isObj(j)) return { ok: false, reason: `${this.d.source} ${method} at ${r.evidence.host}: malformed JSON-RPC response`, evidence: r.evidence };
    if (isObj(j.error)) {
      const message = this.d.secrets.redact(String(j.error.message ?? "error")).slice(0, 200);
      const code = typeof j.error.code === "number" ? j.error.code : undefined;
      return { ok: false, reason: `${this.d.source} ${method} at ${r.evidence.host}: JSON-RPC error ${code ?? ""} ${message}`.replace(/\s+/g, " ").trim(), rpcError: { code, message }, evidence: r.evidence };
    }
    if (!("result" in j)) return { ok: false, reason: `${this.d.source} ${method} at ${r.evidence.host}: no result`, evidence: r.evidence };
    return { ok: true, result: j.result, evidence: r.evidence };
  }

  async headNumber(): Promise<{ ok: true; head: bigint; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const r = await this.rpc("eth_blockNumber", []);
    if (!r.ok) return r;
    try { const head = hexToBigInt(r.result, "block number"); return { ok: true, head, evidence: { ...r.evidence, blockNumber: head } }; } catch (e) {
      return { ok: false, reason: `${this.d.source} eth_blockNumber: ${(e as Error).message}`, evidence: r.evidence };
    }
  }

  /** v1 health check: one eth_blockNumber read. Never throws. */
  async health(): Promise<{ ok: true; head: bigint; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    return this.headNumber();
  }

  private async block(n: bigint | "finalized"): Promise<{ ok: true; block: { number: bigint; hash: string; timestamp: bigint } | null; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const r = await this.rpc("eth_getBlockByNumber", [n === "finalized" ? n : toHex(n), false]);
    if (!r.ok) return r;
    if (r.result === null) return { ok: true, block: null, evidence: r.evidence };
    try {
      const b = r.result as Record<string, unknown>;
      if (!isObj(b) || typeof b.hash !== "string") throw new Error("malformed block");
      const block = { number: hexToBigInt(b.number, "block number"), hash: b.hash.toLowerCase(), timestamp: hexToBigInt(b.timestamp, "block timestamp") };
      return { ok: true, block, evidence: { ...r.evidence, blockNumber: block.number, blockHash: block.hash } };
    } catch (e) { return { ok: false, reason: `${this.d.source} eth_getBlockByNumber: ${(e as Error).message}`, evidence: r.evidence }; }
  }

  private async receipt(hash: string): Promise<{ ok: true; receipt: Receipt | null; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const r = await this.rpc("eth_getTransactionReceipt", [hash]);
    if (!r.ok) return r;
    if (r.result === null) return { ok: true, receipt: null, evidence: r.evidence };
    try {
      const x = r.result;
      if (!isObj(x) || typeof x.blockHash !== "string") throw new Error("malformed receipt");
      const receipt = { status: String(x.status ?? ""), blockNumber: hexToBigInt(x.blockNumber, "receipt block number"), blockHash: x.blockHash.toLowerCase(), logs: Array.isArray(x.logs) ? x.logs : [] };
      return { ok: true, receipt, evidence: { ...r.evidence, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash } };
    } catch (e) { return { ok: false, reason: `${this.d.source} eth_getTransactionReceipt: ${(e as Error).message}`, evidence: r.evidence }; }
  }

  /** One transaction by hash: its Transfer logs of configured tokens (any recipient), plus look-alike facts. */
  async getTransfer(txHash: string): Promise<TransferOutcome> {
    return this.readTx(txHash);
  }

  private async readTx(txHash: string, knownHead?: { head: bigint; evidence: Evidence }): Promise<TransferOutcome> {
    if (!TX_RE.test(txHash)) return { status: "not_found", reason: "not an EVM transaction hash (0x + 64 hex)", evidence: [] };
    const hash = txHash.toLowerCase();
    const cacheKey = `${this.network}:tx:${hash}`;
    const cached = await this.d.cache.get(cacheKey);
    if (cached) return cached as TransferOutcome;

    const r1 = await this.receipt(hash);
    if (!r1.ok) return { status: "unavailable", reason: r1.reason, evidence: [r1.evidence] };
    if (!r1.receipt) return { status: "not_found", reason: "no receipt: the transaction is unknown or still pending", evidence: [r1.evidence] };
    if (r1.receipt.status !== "0x1") return { status: "failed_transaction", reason: `receipt status is ${r1.receipt.status || "missing"}, not 0x1: not a transfer`, evidence: [r1.evidence] };
    const { blockNumber, blockHash } = r1.receipt;

    const b = await this.block(blockNumber);
    if (!b.ok) return { status: "unavailable", reason: b.reason, evidence: [r1.evidence, b.evidence] };
    if (!b.block || b.block.hash !== blockHash) {
      return { status: "reorged", reason: `the receipt's block ${blockNumber} is no longer the canonical block at that height (reorg)`, transfers: [], evidence: [r1.evidence, b.evidence] };
    }
    const timestamp = new Date(Number(b.block.timestamp) * 1000).toISOString();

    let h: { head: bigint; evidence: Evidence };
    if (knownHead) h = knownHead;
    else {
      const x = await this.headNumber();
      if (!x.ok) return { status: "unavailable", reason: x.reason, evidence: [r1.evidence, b.evidence, x.evidence] };
      h = x;
    }
    const confirmations = confirmationsOf(h.head, blockNumber);
    const evidence: Evidence[] = [{ ...r1.evidence, confirmationsAtFetch: confirmations }, b.evidence, h.evidence];
    const decoded = this.decode(hash, r1.receipt.logs, blockNumber, blockHash, timestamp, confirmations, evidence);
    if (confirmations < requiredConfirmations(this.network, this.d.networks)) return { status: "ok", ...decoded, evidence };
    if (this.finality.kind === "finalized_tag") {
      // v1: the node's finalized block must have reached this block; until then the transfer is seen but not final
      const fin = await this.block("finalized");
      if (!fin.ok || !fin.block) return { status: "ok", ...decoded, evidence: [...evidence, fin.evidence] }; // could not confirm: stays not final
      evidence.push(fin.evidence);
      if (fin.block.number < blockNumber) return { status: "ok", ...decoded, evidence };
    }

    // Reorg safety: same block number AND same block hash on a second receipt read.
    const r2 = await this.receipt(hash);
    if (!r2.ok) return { status: "ok", ...decoded, evidence: [...evidence, r2.evidence] }; // could not confirm: stays not final
    if (!r2.receipt) return { status: "reorged", reason: "the receipt vanished between reads (reorg)", transfers: decoded.transfers, evidence: [...evidence, r2.evidence] };
    if (r2.receipt.blockNumber !== blockNumber || r2.receipt.blockHash !== blockHash || r2.receipt.status !== "0x1") {
      return {
        status: "reorged", reason: `the receipt changed between reads: block ${blockNumber} → ${r2.receipt.blockNumber}${r2.receipt.blockHash !== blockHash ? ", different block hash" : ""} (reorg)`,
        currentBlock: r2.receipt.blockNumber, transfers: decoded.transfers, evidence: [...evidence, r2.evidence],
      };
    }
    const all = [...evidence, { ...r2.evidence, confirmationsAtFetch: confirmations }];
    const final: TransferOutcome = { status: "ok", transfers: decoded.transfers.map((t) => ({ ...t, finalised: true, evidence: all })), nonMatching: decoded.nonMatching, evidence: all };
    await this.d.cache.put(cacheKey, final);
    return final;
  }

  private decode(hash: string, logs: unknown[], block: bigint, blockHash: string, timestamp: string, confirmations: bigint, evidence: Evidence[]) {
    const transfers: ChainTransferFact[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    const tokens = this.d.tokens.filter((t) => t.network === this.network);
    for (const [i, log] of logs.entries()) {
      const p = parseTransferLog(log);
      if (!p) continue;
      const logIndex = p.logIndex ?? i;
      const token = tokens.find((t) => t.contract.toLowerCase() === p.contract);
      if (!token) {
        nonMatching.push({ network: this.network, txHash: hash, logIndex, contract: p.contract, from: p.from, to: p.to, rawAmount: p.amount, reason: "Transfer log from a contract that is not a configured token (look-alike); ignored", evidence });
        continue;
      }
      transfers.push({
        network: this.network, txHash: hash, logIndex, tokenContract: token.contract, symbol: token.symbol, from: p.from, to: p.to, amountBaseUnits: p.amount,
        decimals: token.decimals, blockNumber: block, blockHash, timestamp, confirmations, finalised: false, evidence,
      });
    }
    return { transfers, nonMatching };
  }

  /** First block with timestamp ≥ t (seconds), searching [lo, hi]; hi+1 if none. Bounded probes; memoised. */
  private async lowerBound(t: bigint, lo: bigint, hi: bigint, ts: Map<bigint, bigint>, budget: { left: number }): Promise<{ ok: true; block: bigint } | { ok: false; reason: string; evidence?: Evidence }> {
    let L = lo, H = hi + 1n;
    while (L < H) {
      const mid = (L + H) / 2n;
      let v = ts.get(mid);
      if (v === undefined) {
        if (budget.left-- <= 0) return { ok: false, reason: `mapping the time window to blocks needed more than ${this.maxBlockLookups} block lookups` };
        const b = await this.block(mid);
        if (!b.ok) return { ok: false, reason: b.reason, evidence: b.evidence };
        if (!b.block) return { ok: false, reason: `${this.d.source} eth_getBlockByNumber: block ${mid} missing below head`, evidence: b.evidence };
        v = b.block.timestamp; ts.set(mid, v);
      }
      if (v >= t) H = mid; else L = mid + 1n;
    }
    return { ok: true, block: L };
  }

  /**
   * Incoming Transfer logs to `depositAddress` with block time in [fromMs, toMs]. The window is mapped to blocks by a
   * bounded binary search on block timestamps; eth_getLogs runs in ≤ maxLogRange chunks (halved on "range too large").
   * Logs from configured contracts become candidates verified by receipt; others are reported as look-alike facts.
   */
  async listIncoming(depositAddress: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    if (!ADDR_RE.test(depositAddress)) return { status: "unavailable", reason: "the deposit address is not a 0x-prefixed 20-byte EVM address", evidence: [] };
    const deposit = depositAddress.toLowerCase();
    const evidence: Evidence[] = [];
    const h = await this.headNumber();
    evidence.push(h.evidence);
    if (!h.ok) return { status: "unavailable", reason: h.reason, evidence };
    const headBlock = await this.block(h.head);
    evidence.push(headBlock.evidence);
    if (!headBlock.ok) return { status: "unavailable", reason: headBlock.reason, evidence };
    if (!headBlock.block) return { status: "unavailable", reason: `${this.d.source}: head block not returned`, evidence };
    const headTs = headBlock.block.timestamp;
    const fromS = BigInt(Math.ceil(fromMs / 1000)), toS = BigInt(Math.floor(toMs / 1000));
    const empty: IncomingOutcome = { status: "ok", transfers: [], nonMatching: [], unresolved: [], evidence };
    if (fromS > headTs || toS < fromS) return empty;

    const ts = new Map<bigint, bigint>([[h.head, headTs]]);
    const budget = { left: this.maxBlockLookups };
    // Block timestamps strictly increase, so a block at least (headTs − t) blocks below head cannot be newer than t.
    const floor = (t: bigint) => { const x = h.head - (headTs - t); return x > 0n ? x : 0n; };
    const lb = await this.lowerBound(fromS, floor(fromS), h.head, ts, budget);
    if (!lb.ok) return { status: "unavailable", reason: lb.reason, evidence: lb.evidence ? [...evidence, lb.evidence] : evidence };
    let toBlock = h.head;
    if (toS < headTs) {
      const ub = await this.lowerBound(toS + 1n, lb.block, h.head, ts, budget);
      if (!ub.ok) return { status: "unavailable", reason: ub.reason, evidence: ub.evidence ? [...evidence, ub.evidence] : evidence };
      toBlock = ub.block - 1n;
    }
    const fromBlock = lb.block;
    if (toBlock < fromBlock) return empty;

    const nonMatching: NonMatchingTokenFact[] = [];
    const candidates: string[] = [];
    const tokens = this.d.tokens.filter((t) => t.network === this.network).map((t) => t.contract.toLowerCase());
    let span = this.maxLogRange, start = fromBlock, requests = 0;
    while (start <= toBlock) {
      if (requests++ >= this.maxLogRequests) return { status: "unavailable", reason: `eth_getLogs needed more than ${this.maxLogRequests} requests for this window`, evidence };
      const end = start + span - 1n < toBlock ? start + span - 1n : toBlock;
      // No address filter on purpose: Transfer logs to the deposit from ANY contract are read so look-alikes are reported.
      const r = await this.rpc("eth_getLogs", [{ fromBlock: toHex(start), toBlock: toHex(end), topics: [TRANSFER_TOPIC, null, padTopic(deposit)] }]);
      if (!r.ok) {
        if (r.rpcError && RANGE_ERR.test(r.rpcError.message) && span > 1n) { span = span / 2n > 0n ? span / 2n : 1n; continue; }
        evidence.push(r.evidence);
        return { status: "unavailable", reason: r.reason, evidence };
      }
      evidence.push({ ...r.evidence, blockNumber: end });
      if (!Array.isArray(r.result)) return { status: "unavailable", reason: `${this.d.source} eth_getLogs: result is not an array`, evidence };
      for (const log of r.result) {
        const p = parseTransferLog(log);
        if (!p || p.removed || p.to !== deposit || !p.txHash) continue;
        if (tokens.includes(p.contract)) { if (!candidates.includes(p.txHash)) candidates.push(p.txHash); continue; }
        nonMatching.push({
          network: this.network, txHash: p.txHash, ...(p.logIndex !== undefined ? { logIndex: p.logIndex } : {}), contract: p.contract, from: p.from, to: p.to, rawAmount: p.amount,
          reason: "Transfer log from a contract that is not a configured token (look-alike); ignored", evidence: [r.evidence],
        });
      }
      start = end + 1n;
    }

    const transfers: ChainTransferFact[] = [];
    const unresolved: UnresolvedTx[] = [];
    for (const hash of candidates) {
      const o = await this.readTx(hash, { head: h.head, evidence: h.evidence });
      if (o.status !== "ok") { unresolved.push({ txHash: hash, status: o.status, reason: o.reason }); continue; }
      const mine = o.transfers.filter((t) => t.to === deposit && Date.parse(t.timestamp) >= fromMs && Date.parse(t.timestamp) <= toMs);
      if (mine.length === 0) unresolved.push({ txHash: hash, status: "not_found", reason: "eth_getLogs listed a transfer the receipt does not contain" });
      transfers.push(...mine);
    }
    return { status: "ok", transfers, nonMatching, unresolved, evidence };
  }
}

/** v1: the same reader for any EVM network (Polygon, Base, Arbitrum One); pass `network`. */
export const EvmReader = EthereumReader;
export type EvmReader = EthereumReader;
export type EvmReaderOptions = EthereumReaderOptions;

/** Decode a Transfer(address,address,uint256) log. Returns undefined for anything else (wrong topic, malformed). */
export function parseTransferLog(log: unknown): { contract: string; from: string; to: string; amount: bigint; logIndex?: number; txHash?: string; removed: boolean } | undefined {
  if (!isObj(log) || typeof log.address !== "string" || !Array.isArray(log.topics)) return undefined;
  const topics = log.topics.map((t) => String(t).toLowerCase());
  if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC) return undefined; // ERC-721 Transfer has 4 topics
  if (typeof log.data !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) return undefined;
  let logIndex: number | undefined;
  try { if (log.logIndex !== undefined) logIndex = Number(hexToBigInt(log.logIndex, "log index")); } catch { return undefined; }
  return {
    contract: log.address.toLowerCase(), from: topicAddr(topics[1]), to: topicAddr(topics[2]), amount: BigInt(log.data),
    ...(logIndex !== undefined ? { logIndex } : {}), ...(typeof log.transactionHash === "string" ? { txHash: log.transactionHash.toLowerCase() } : {}),
    removed: log.removed === true,
  };
}
