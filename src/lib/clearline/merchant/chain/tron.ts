/**
 * TronGrid reader for TRC-20 transfers (USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`). READ-ONLY: it calls only
 * `wallet/gettransactioninfobyid`, `wallet/getnowblock` and the v1 TRC-20 listing; no broadcast, trigger or signing
 * endpoint exists here. The key (TRONGRID_API_KEY) goes in the `TRON-PRO-API-KEY` header and is redacted everywhere.
 *
 * Finality: confirmations = head − block + 1; a transfer is `finalised` only at ≥ the network's confirmationsRequired
 * AND after a second receipt read returns the same block number (else `reorged`). Only finalised results are cached.
 */
import { type ChainTransferFact, type Evidence, type IncomingOutcome, type NonMatchingTokenFact, type TransferOutcome, type UnresolvedTx, confirmationsOf, requiredConfirmations } from "./model";
import { type ReaderDeps, type ReaderOptions, TRANSFER_TOPIC, fetchJson, isObj, makeDeps } from "./reader-common";
import { tronBase58ToHex20, tronHexToBase58 } from "./base58";
import { type HttpRequest, Secrets } from "./transport";

export const TRONGRID_DEFAULT_BASE_URL = "https://api.trongrid.io";
/** [ASSUMPTION] 50 pages × 200 = 10,000 listed transfers per window before the read is reported unavailable. */
export const TRON_DEFAULT_MAX_PAGES = 50;

/** v1: `provider` labels this endpoint ("primary", "fallback"); a fallback is any TronGrid-API-compatible base URL. */
export interface TronReaderOptions extends ReaderOptions { apiKey?: string; baseUrl?: string; maxPages?: number; provider?: string }

interface Head { number: bigint; evidence: Evidence }
type HeadResult = { ok: true; head: Head } | { ok: false; reason: string; evidence: Evidence };

const TX_RE = /^(0x)?[0-9a-fA-F]{64}$/;

export class TronReader {
  readonly network = "tron" as const;
  readonly provider: string;
  private readonly d: ReaderDeps;
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly maxPages: number;

  constructor(o: TronReaderOptions) {
    this.provider = o.provider ?? "primary";
    this.d = makeDeps("trongrid", o, new Secrets([o.apiKey, ...Secrets.fromUrl(o.baseUrl)]));
    this.base = (o.baseUrl ?? TRONGRID_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.headers = { accept: "application/json", "content-type": "application/json", ...(o.apiKey ? { "TRON-PRO-API-KEY": o.apiKey } : {}) };
    this.maxPages = o.maxPages ?? TRON_DEFAULT_MAX_PAGES;
  }

  private post(path: string, body: unknown): HttpRequest {
    return { url: `${this.base}/${path}`, method: "POST", headers: { ...this.headers }, body: JSON.stringify(body) };
  }

  async head(): Promise<HeadResult> {
    const r = await fetchJson(this.d, this.post("wallet/getnowblock", {}), "wallet/getnowblock");
    if (!r.ok) return r;
    const raw = isObj(r.json) && isObj(r.json.block_header) && isObj(r.json.block_header.raw_data) ? r.json.block_header.raw_data.number : undefined;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) return { ok: false, reason: "trongrid wallet/getnowblock: no block number in response", evidence: r.evidence };
    const number = BigInt(raw);
    const blockID = isObj(r.json) && typeof r.json.blockID === "string" ? r.json.blockID : undefined;
    return { ok: true, head: { number, evidence: { ...r.evidence, blockNumber: number, ...(blockID ? { blockHash: blockID } : {}) } } };
  }

  /** v1 health check: one wallet/getnowblock read. Never throws. */
  async health(): Promise<{ ok: true; head: bigint; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const h = await this.head();
    return h.ok ? { ok: true, head: h.head.number, evidence: h.head.evidence } : h;
  }

  /** One transaction by hash: its TRC-20 Transfer logs of configured tokens (any recipient), plus look-alike facts. */
  async getTransfer(txHash: string): Promise<TransferOutcome> {
    return this.readTx(txHash);
  }

  private async readTx(txHash: string, knownHead?: Head): Promise<TransferOutcome> {
    if (!TX_RE.test(txHash)) return { status: "not_found", reason: "not a TRON transaction id (64 hex characters)", evidence: [] };
    const id = txHash.toLowerCase().replace(/^0x/, "");
    const cacheKey = `tron:tx:${id}`;
    const cached = await this.d.cache.get(cacheKey);
    if (cached) return cached as TransferOutcome;

    const first = await this.info(id);
    if (first.kind !== "found") return first.outcome;
    let head: Head;
    if (knownHead) head = knownHead;
    else {
      const h = await this.head();
      if (!h.ok) return { status: "unavailable", reason: h.reason, evidence: [first.evidence, h.evidence] };
      head = h.head;
    }

    const confirmations = confirmationsOf(head.number, first.block);
    const evidence: Evidence[] = [{ ...first.evidence, confirmationsAtFetch: confirmations }, head.evidence];
    const decoded = this.decode(id, first.info, first.block, first.timestamp, confirmations, evidence);
    const required = requiredConfirmations("tron", this.d.networks);
    if (confirmations < required) return { status: "ok", ...decoded, evidence };

    // Reorg safety: re-read the receipt and require the same block number before calling anything final.
    const second = await this.info(id);
    if (second.kind === "failed") return { status: "reorged", reason: "the transaction now reads as failed on a second receipt read", transfers: decoded.transfers, evidence: [...evidence, second.evidence] };
    if (second.kind !== "found") {
      if (second.outcome.status === "unavailable") return { status: "ok", ...decoded, evidence: [...evidence, ...second.outcome.evidence] }; // could not confirm: stays not final
      return { status: "reorged", reason: "the transaction vanished between receipt reads (reorg)", transfers: decoded.transfers, evidence: [...evidence, ...second.outcome.evidence] };
    }
    if (second.block !== first.block) {
      return { status: "reorged", reason: `the transaction moved from block ${first.block} to ${second.block} between reads (reorg)`, currentBlock: second.block, transfers: decoded.transfers, evidence: [...evidence, second.evidence] };
    }
    const allEvidence = [...evidence, { ...second.evidence, confirmationsAtFetch: confirmations }];
    const final: TransferOutcome = { status: "ok", transfers: decoded.transfers.map((t) => ({ ...t, finalised: true, evidence: allEvidence })), nonMatching: decoded.nonMatching, evidence: allEvidence };
    await this.d.cache.put(cacheKey, final);
    return final;
  }

  private async info(id: string): Promise<
    | { kind: "found"; info: Record<string, unknown>; block: bigint; timestamp: string; evidence: Evidence }
    | { kind: "failed" | "other"; outcome: TransferOutcome; evidence: Evidence }
  > {
    const r = await fetchJson(this.d, this.post("wallet/gettransactioninfobyid", { value: id }), "wallet/gettransactioninfobyid");
    if (!r.ok) return { kind: "other", outcome: { status: "unavailable", reason: r.reason, evidence: [r.evidence] }, evidence: r.evidence };
    const info = r.json;
    if (!isObj(info)) return { kind: "other", outcome: { status: "unavailable", reason: "trongrid wallet/gettransactioninfobyid: malformed response", evidence: [r.evidence] }, evidence: r.evidence };
    if (typeof info.id !== "string") return { kind: "other", outcome: { status: "not_found", reason: "TronGrid has no transaction info for this id (unknown or not yet in a block)", evidence: [r.evidence] }, evidence: r.evidence };
    const bn = info.blockNumber, ts = info.blockTimeStamp;
    if (typeof bn !== "number" || !Number.isSafeInteger(bn) || typeof ts !== "number" || !Number.isFinite(ts)) {
      return { kind: "other", outcome: { status: "unavailable", reason: "trongrid wallet/gettransactioninfobyid: missing blockNumber/blockTimeStamp", evidence: [r.evidence] }, evidence: r.evidence };
    }
    const block = BigInt(bn);
    const evidence = { ...r.evidence, blockNumber: block };
    const receiptResult = isObj(info.receipt) ? info.receipt.result : undefined;
    if (info.result === "FAILED" || receiptResult !== "SUCCESS") {
      return { kind: "failed", outcome: { status: "failed_transaction", reason: `receipt result is ${String(receiptResult ?? info.result ?? "missing")}, not SUCCESS: not a transfer`, evidence: [evidence] }, evidence };
    }
    return { kind: "found", info, block, timestamp: new Date(ts).toISOString(), evidence };
  }

  private decode(id: string, info: Record<string, unknown>, block: bigint, timestamp: string, confirmations: bigint, evidence: Evidence[]): { transfers: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[] } {
    const transfers: ChainTransferFact[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    const logs = Array.isArray(info.log) ? info.log : [];
    const tokens = this.d.tokens.filter((t) => t.network === "tron").map((t) => ({ t, hex: tronBase58ToHex20(t.contract) }));
    logs.forEach((log, logIndex) => {
      if (!isObj(log) || typeof log.address !== "string" || !Array.isArray(log.topics)) return;
      const topics = log.topics.map((x) => String(x).toLowerCase().replace(/^0x/, ""));
      if (topics[0] !== TRANSFER_TOPIC.slice(2) || topics.length < 3) return;
      const contractHex = log.address.toLowerCase().replace(/^0x/, "").replace(/^41(?=[0-9a-f]{40}$)/, "");
      let from: string, to: string, amount: bigint;
      try {
        from = tronHexToBase58(topics[1]); to = tronHexToBase58(topics[2]);
        const data = typeof log.data === "string" ? log.data.replace(/^0x/, "") : "";
        if (!/^[0-9a-fA-F]{1,64}$/.test(data)) return;
        amount = BigInt("0x" + data);
      } catch { return; }
      const token = tokens.find((x) => x.hex === contractHex);
      if (!token) {
        let contract = contractHex;
        try { contract = tronHexToBase58(contractHex); } catch { /* keep hex */ }
        nonMatching.push({ network: "tron", txHash: id, logIndex, contract, from, to, rawAmount: amount, reason: "Transfer log from a contract that is not a configured token (look-alike); ignored", evidence });
        return;
      }
      transfers.push({
        network: "tron", txHash: id, logIndex, tokenContract: token.t.contract, symbol: token.t.symbol, from, to, amountBaseUnits: amount,
        decimals: token.t.decimals, blockNumber: block, timestamp, confirmations, finalised: false, evidence,
      });
    });
    return { transfers, nonMatching };
  }

  /**
   * Incoming TRC-20 transfers of configured tokens to `depositAddress` with block time in [fromMs, toMs]. The v1
   * listing only nominates candidates; every candidate is verified by its receipt (getTransfer) before it is a fact.
   */
  async listIncoming(depositAddress: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    try { tronBase58ToHex20(depositAddress); } catch {
      return { status: "unavailable", reason: "the deposit address is not a valid TRON address", evidence: [] };
    }
    const evidence: Evidence[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    const candidates: string[] = [];
    for (const token of this.d.tokens.filter((t) => t.network === "tron")) {
      let fingerprint: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= this.maxPages) return { status: "unavailable", reason: `more than ${this.maxPages} pages of transfers in the window; narrow the window`, evidence };
        const q = new URLSearchParams({
          only_to: "true", contract_address: token.contract, min_timestamp: String(Math.floor(fromMs)), max_timestamp: String(Math.floor(toMs)),
          limit: "200", order_by: "block_timestamp,asc", ...(fingerprint ? { fingerprint } : {}),
        });
        const req: HttpRequest = { url: `${this.base}/v1/accounts/${encodeURIComponent(depositAddress)}/transactions/trc20?${q}`, method: "GET", headers: { ...this.headers } };
        const r = await fetchJson(this.d, req, "v1/accounts/transactions/trc20");
        evidence.push(r.evidence);
        if (!r.ok) return { status: "unavailable", reason: r.reason, evidence };
        const j = r.json;
        if (!isObj(j) || j.success !== true || !Array.isArray(j.data)) return { status: "unavailable", reason: "trongrid v1/accounts/transactions/trc20: malformed or unsuccessful response", evidence };
        for (const item of j.data) {
          if (!isObj(item) || typeof item.transaction_id !== "string" || item.to !== depositAddress) continue;
          const ts = typeof item.block_timestamp === "number" ? item.block_timestamp : NaN;
          if (!(ts >= fromMs && ts <= toMs)) continue;
          const ti = isObj(item.token_info) ? item.token_info : {};
          if (ti.address !== token.contract) {
            nonMatching.push({
              network: "tron", txHash: item.transaction_id, contract: String(ti.address ?? "unknown"), from: typeof item.from === "string" ? item.from : undefined, to: depositAddress,
              ...(typeof item.value === "string" && /^\d+$/.test(item.value) ? { rawAmount: BigInt(item.value) } : {}),
              ...(typeof ti.symbol === "string" ? { claimedSymbol: ti.symbol } : {}), ...(typeof ti.decimals === "number" ? { claimedDecimals: ti.decimals } : {}),
              reason: "listed under a contract that is not the configured token (look-alike); ignored", evidence: [r.evidence],
            });
            continue;
          }
          const id = item.transaction_id.toLowerCase();
          if (!candidates.includes(id)) candidates.push(id);
        }
        const meta = isObj(j.meta) ? j.meta : {};
        fingerprint = typeof meta.fingerprint === "string" && meta.fingerprint ? meta.fingerprint : undefined;
        if (!fingerprint) break;
      }
    }
    return this.verifyCandidates(candidates, depositAddress, fromMs, toMs, nonMatching, evidence);
  }

  private async verifyCandidates(ids: string[], deposit: string, fromMs: number, toMs: number, nonMatching: NonMatchingTokenFact[], evidence: Evidence[]): Promise<IncomingOutcome> {
    const transfers: ChainTransferFact[] = [];
    const unresolved: UnresolvedTx[] = [];
    if (ids.length === 0) return { status: "ok", transfers, nonMatching, unresolved, evidence };
    const h = await this.head();
    if (!h.ok) return { status: "unavailable", reason: h.reason, evidence: [...evidence, h.evidence] };
    evidence.push(h.head.evidence);
    for (const id of ids) {
      const o = await this.readTx(id, h.head);
      if (o.status === "ok") {
        const mine = o.transfers.filter((t) => t.to === deposit && Date.parse(t.timestamp) >= fromMs && Date.parse(t.timestamp) <= toMs);
        if (mine.length === 0) unresolved.push({ txHash: id, status: "not_found", reason: "listed by TronGrid, but the receipt has no configured-token transfer to this address" });
        transfers.push(...mine);
        nonMatching.push(...o.nonMatching.filter((n) => n.to === deposit));
      } else unresolved.push({ txHash: id, status: o.status, reason: o.reason });
    }
    return { status: "ok", transfers, nonMatching, unresolved, evidence };
  }
}
