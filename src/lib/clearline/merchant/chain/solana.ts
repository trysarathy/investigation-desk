/**
 * v1: Solana JSON-RPC reader for SPL-token transfers (USDC mint, see networks.ts). READ-ONLY: it calls only getSlot,
 * getTransaction, getSignaturesForAddress and getTokenAccountsByOwner (SOLANA_READ_ONLY_METHODS, enforced in `rpc()`);
 * no sendTransaction, simulateTransaction, requestAirdrop or signing method exists here. SOLANA_RPC_URL may embed a key;
 * it is redacted from every reason and evidence record (evidence keeps the host only).
 *
 * Identity: a token is its mint (never a symbol). A deposit address is the owner wallet; payments land in token accounts
 * the wallet owns, so the listing enumerates those (getTokenAccountsByOwner, classic SPL Token program) and their
 * signatures. Transfers are the `transfer` / `transferChecked` instructions (outer and inner) of the SPL Token programs;
 * the receiving and sending wallets are the owners of the destination and source token accounts (token balances).
 * `logIndex` is deterministic: outer instruction index × 1000 + (inner position + 1, or 0 for an outer instruction).
 *
 * Finality ("commitment" rule): the transaction is returned under commitment "finalized", confirmations
 * (confirmed slot − slot + 1) ≥ the network's confirmationsRequired, and a second finalized read returns the same slot.
 * A transaction seen only under "confirmed" is a pending fact. Only final results are cached.
 */
import { type ChainTransferFact, type Evidence, type IncomingOutcome, type NonMatchingTokenFact, type TransferOutcome, type UnresolvedTx, confirmationsOf, requiredConfirmations } from "./model";
import { type ReaderDeps, type ReaderOptions, fetchJson, isObj, makeDeps } from "./reader-common";
import { Secrets } from "./transport";

export const SOLANA_READ_ONLY_METHODS = ["getSlot", "getTransaction", "getSignaturesForAddress", "getTokenAccountsByOwner"] as const;
type SolMethod = (typeof SOLANA_READ_ONLY_METHODS)[number];

/** Public program ids of the SPL Token program and Token-2022 (https://spl.solana.com/token, https://spl.solana.com/token-2022). */
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface SolanaReaderOptions extends ReaderOptions {
  rpcUrl: string;
  provider?: string;
  /** [ASSUMPTION] 20 pages × 1000 signatures per token account per window before the read is reported unavailable. */
  maxSignaturePages?: number;
  /** [ASSUMPTION] at most 400 transactions read per listIncoming. */
  maxTransactions?: number;
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export const isSolanaAddress = (s: string) => B58.test(s) && s.length >= 32 && s.length <= 44;
export const isSolanaSignature = (s: string) => B58.test(s) && s.length >= 64 && s.length <= 88;

type RpcResult = { ok: true; result: unknown; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence };
interface ParsedTx { slot: bigint; blockTime: number; err: unknown; tx: Record<string, unknown> }

export class SolanaReader {
  readonly network = "solana" as const;
  readonly provider: string;
  private readonly d: ReaderDeps;
  private readonly url: string;
  private readonly maxPages: number;
  private readonly maxTx: number;
  private nextId = 1;

  constructor(o: SolanaReaderOptions) {
    this.provider = o.provider ?? "primary";
    this.d = makeDeps("solana-rpc", o, new Secrets(Secrets.fromUrl(o.rpcUrl)));
    this.url = o.rpcUrl;
    this.maxPages = o.maxSignaturePages ?? 20;
    this.maxTx = o.maxTransactions ?? 400;
  }

  private async rpc(method: SolMethod, params: unknown[]): Promise<RpcResult> {
    if (!(SOLANA_READ_ONLY_METHODS as readonly string[]).includes(method)) throw new Error("refused: not a read-only RPC method");
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params });
    const r = await fetchJson(this.d, { url: this.url, method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body }, method);
    if (!r.ok) return r;
    const j = r.json;
    if (!isObj(j)) return { ok: false, reason: `solana-rpc ${method} at ${r.evidence.host}: malformed JSON-RPC response`, evidence: r.evidence };
    if (isObj(j.error)) {
      const message = this.d.secrets.redact(String(j.error.message ?? "error")).slice(0, 200);
      return { ok: false, reason: `solana-rpc ${method} at ${r.evidence.host}: JSON-RPC error ${typeof j.error.code === "number" ? j.error.code : ""} ${message}`.replace(/\s+/g, " ").trim(), evidence: r.evidence };
    }
    if (!("result" in j)) return { ok: false, reason: `solana-rpc ${method} at ${r.evidence.host}: no result`, evidence: r.evidence };
    return { ok: true, result: j.result, evidence: r.evidence };
  }

  /** The confirmed slot (the "head" confirmations are counted against). */
  async headSlot(): Promise<{ ok: true; head: bigint; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const r = await this.rpc("getSlot", [{ commitment: "confirmed" }]);
    if (!r.ok) return r;
    if (typeof r.result !== "number" || !Number.isSafeInteger(r.result) || r.result < 0) return { ok: false, reason: "solana-rpc getSlot: not a slot number", evidence: r.evidence };
    const head = BigInt(r.result);
    return { ok: true, head, evidence: { ...r.evidence, blockNumber: head } };
  }

  /** v1 health check: one getSlot read. Never throws. */
  async health() { return this.headSlot(); }

  private async tx(sig: string, commitment: "finalized" | "confirmed"): Promise<{ ok: true; tx: ParsedTx | null; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence }> {
    const r = await this.rpc("getTransaction", [sig, { commitment, encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    if (!r.ok) return r;
    if (r.result === null) return { ok: true, tx: null, evidence: r.evidence };
    const x = r.result;
    if (!isObj(x) || typeof x.slot !== "number" || !Number.isSafeInteger(x.slot) || !isObj(x.meta) || !isObj(x.transaction)) {
      return { ok: false, reason: "solana-rpc getTransaction: malformed transaction", evidence: r.evidence };
    }
    if (typeof x.blockTime !== "number" || !Number.isFinite(x.blockTime)) return { ok: false, reason: "solana-rpc getTransaction: no blockTime", evidence: r.evidence };
    const slot = BigInt(x.slot);
    return { ok: true, tx: { slot, blockTime: x.blockTime, err: x.meta.err ?? null, tx: x }, evidence: { ...r.evidence, blockNumber: slot } };
  }

  /** One transaction by signature: its SPL transfers of configured mints (any recipient), plus look-alike facts. */
  async getTransfer(signature: string): Promise<TransferOutcome> {
    return this.readTx(signature);
  }

  private async readTx(sig: string, knownHead?: { head: bigint; evidence: Evidence }): Promise<TransferOutcome> {
    if (!isSolanaSignature(sig)) return { status: "not_found", reason: "not a Solana transaction signature (base58, 64 bytes)", evidence: [] };
    const cacheKey = `solana:tx:${sig}`;
    const cached = await this.d.cache.get(cacheKey);
    if (cached) return cached as TransferOutcome;

    let r1 = await this.tx(sig, "finalized");
    if (!r1.ok) return { status: "unavailable", reason: r1.reason, evidence: [r1.evidence] };
    let underFinalized = true;
    const ev1 = r1.evidence;
    if (!r1.tx) {
      underFinalized = false;
      r1 = await this.tx(sig, "confirmed");
      if (!r1.ok) return { status: "unavailable", reason: r1.reason, evidence: [ev1, r1.evidence] };
      if (!r1.tx) return { status: "not_found", reason: "no transaction under commitment finalized or confirmed: unknown or still processing", evidence: [ev1, r1.evidence] };
    }
    const first = r1.tx;
    if (first.err !== null) return { status: "failed_transaction", reason: "the transaction's meta.err is set: it failed, not a transfer", evidence: [r1.evidence] };

    let h: { head: bigint; evidence: Evidence };
    if (knownHead) h = knownHead;
    else {
      const x = await this.headSlot();
      if (!x.ok) return { status: "unavailable", reason: x.reason, evidence: [r1.evidence, x.evidence] };
      h = x;
    }
    const confirmations = confirmationsOf(h.head, first.slot);
    const timestamp = new Date(first.blockTime * 1000).toISOString();
    const evidence: Evidence[] = [{ ...r1.evidence, confirmationsAtFetch: confirmations }, h.evidence];
    const decoded = this.decode(sig, first.tx, first.slot, timestamp, confirmations, evidence);
    if (!underFinalized || confirmations < requiredConfirmations("solana", this.d.networks)) return { status: "ok", ...decoded, evidence };

    // Reorg safety: a second finalized read must return the same slot.
    const r2 = await this.tx(sig, "finalized");
    if (!r2.ok) return { status: "ok", ...decoded, evidence: [...evidence, r2.evidence] }; // could not confirm: stays not final
    if (!r2.tx) return { status: "reorged", reason: "the finalized transaction vanished between reads", transfers: decoded.transfers, evidence: [...evidence, r2.evidence] };
    if (r2.tx.slot !== first.slot || r2.tx.err !== null) {
      return { status: "reorged", reason: `the transaction changed between finalized reads: slot ${first.slot} → ${r2.tx.slot}`, currentBlock: r2.tx.slot, transfers: decoded.transfers, evidence: [...evidence, r2.evidence] };
    }
    const all = [...evidence, { ...r2.evidence, confirmationsAtFetch: confirmations }];
    const final: TransferOutcome = { status: "ok", transfers: decoded.transfers.map((t) => ({ ...t, finalised: true, evidence: all })), nonMatching: decoded.nonMatching, evidence: all };
    await this.d.cache.put(cacheKey, final);
    return final;
  }

  private decode(sig: string, x: Record<string, unknown>, slot: bigint, timestamp: string, confirmations: bigint, evidence: Evidence[]): { transfers: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[] } {
    const transfers: ChainTransferFact[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    const tx = x.transaction as Record<string, unknown>;
    const meta = x.meta as Record<string, unknown>;
    const message = isObj(tx.message) ? tx.message : {};
    const keys = (Array.isArray(message.accountKeys) ? message.accountKeys : []).map((k) => (isObj(k) ? String(k.pubkey ?? "") : String(k)));
    // token account → (mint, owner), from both balance lists (a closed account appears only in pre)
    const acct = new Map<string, { mint: string; owner?: string }>();
    for (const list of [meta.preTokenBalances, meta.postTokenBalances]) {
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        if (!isObj(b) || typeof b.accountIndex !== "number" || typeof b.mint !== "string") continue;
        const k = keys[b.accountIndex];
        if (k) acct.set(k, { mint: b.mint, ...(typeof b.owner === "string" ? { owner: b.owner } : {}) });
      }
    }
    const tokens = this.d.tokens.filter((t) => t.network === "solana");
    const flat: { ix: unknown; logIndex: number }[] = [];
    (Array.isArray(message.instructions) ? message.instructions : []).forEach((ix, i) => flat.push({ ix, logIndex: i * 1000 }));
    for (const inner of Array.isArray(meta.innerInstructions) ? meta.innerInstructions : []) {
      if (!isObj(inner) || typeof inner.index !== "number" || !Array.isArray(inner.instructions)) continue;
      const outer = inner.index;
      inner.instructions.forEach((ix, j) => flat.push({ ix, logIndex: outer * 1000 + j + 1 }));
    }
    flat.sort((a, b) => a.logIndex - b.logIndex);
    for (const { ix, logIndex } of flat) {
      if (!isObj(ix) || (ix.programId !== SPL_TOKEN_PROGRAM && ix.programId !== SPL_TOKEN_2022_PROGRAM) || !isObj(ix.parsed)) continue;
      const type = ix.parsed.type, info = ix.parsed.info;
      if ((type !== "transfer" && type !== "transferChecked") || !isObj(info) || typeof info.destination !== "string" || typeof info.source !== "string") continue;
      const raw = type === "transferChecked" ? (isObj(info.tokenAmount) ? info.tokenAmount.amount : undefined) : info.amount;
      if (typeof raw !== "string" || !/^\d+$/.test(raw)) continue;
      const amount = BigInt(raw);
      const dest = acct.get(info.destination), src = acct.get(info.source);
      const mint = typeof info.mint === "string" ? info.mint : dest?.mint ?? src?.mint;
      const to = dest?.owner, from = src?.owner ?? (typeof info.authority === "string" ? info.authority : undefined);
      const token = mint ? tokens.find((t) => t.contract === mint) : undefined;
      const claimedDecimals = type === "transferChecked" && isObj(info.tokenAmount) && typeof info.tokenAmount.decimals === "number" ? info.tokenAmount.decimals : undefined;
      if (!token || !to || !from || (claimedDecimals !== undefined && claimedDecimals !== token.decimals)) {
        nonMatching.push({
          network: "solana", txHash: sig, logIndex, contract: mint ?? "unknown", ...(from ? { from } : {}), ...(to ? { to } : {}), rawAmount: amount,
          ...(claimedDecimals !== undefined ? { claimedDecimals } : {}),
          reason: !token ? "SPL transfer of a mint that is not a configured token (look-alike); ignored" : "SPL transfer whose token accounts or decimals could not be tied to the configured mint; ignored", evidence,
        });
        continue;
      }
      transfers.push({
        network: "solana", txHash: sig, logIndex, tokenContract: token.contract, symbol: token.symbol, from, to, amountBaseUnits: amount, decimals: token.decimals,
        blockNumber: slot, timestamp, confirmations, finalised: false, evidence,
      });
    }
    return { transfers, nonMatching };
  }

  /**
   * Incoming SPL transfers of configured mints to wallet `depositAddress` with block time in [fromMs, toMs]: its token
   * accounts' signatures nominate candidates, and every candidate is read and decoded before it is a fact. Token
   * accounts of other mints are reported as look-alike facts (by signature, unread).
   */
  async listIncoming(depositAddress: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    if (!isSolanaAddress(depositAddress)) return { status: "unavailable", reason: "the deposit address is not a base58 Solana address", evidence: [] };
    const evidence: Evidence[] = [];
    const ta = await this.rpc("getTokenAccountsByOwner", [depositAddress, { programId: SPL_TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    evidence.push(ta.evidence);
    if (!ta.ok) return { status: "unavailable", reason: ta.reason, evidence };
    const value = isObj(ta.result) && Array.isArray(ta.result.value) ? ta.result.value : undefined;
    if (!value) return { status: "unavailable", reason: "solana-rpc getTokenAccountsByOwner: malformed response", evidence };
    const tokens = this.d.tokens.filter((t) => t.network === "solana");
    const fromS = Math.ceil(fromMs / 1000), toS = Math.floor(toMs / 1000);
    const candidates: string[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    for (const a of value) {
      const pubkey = isObj(a) && typeof a.pubkey === "string" ? a.pubkey : undefined;
      const info = isObj(a) && isObj(a.account) && isObj(a.account.data) && isObj(a.account.data.parsed) && isObj(a.account.data.parsed.info) ? a.account.data.parsed.info : undefined;
      if (!pubkey || !info || typeof info.mint !== "string") return { status: "unavailable", reason: "solana-rpc getTokenAccountsByOwner: a token account without pubkey or mint", evidence };
      if (info.owner !== depositAddress) continue;
      const configured = tokens.some((t) => t.contract === info.mint);
      let before: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= this.maxPages) return { status: "unavailable", reason: `more than ${this.maxPages} pages of signatures in the window; narrow the window`, evidence };
        const r = await this.rpc("getSignaturesForAddress", [pubkey, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) }]);
        evidence.push(r.evidence);
        if (!r.ok) return { status: "unavailable", reason: r.reason, evidence };
        if (!Array.isArray(r.result)) return { status: "unavailable", reason: "solana-rpc getSignaturesForAddress: result is not an array", evidence };
        let older = false;
        for (const s of r.result) {
          if (!isObj(s) || typeof s.signature !== "string") continue;
          const bt = typeof s.blockTime === "number" ? s.blockTime : NaN;
          if (!Number.isFinite(bt)) return { status: "unavailable", reason: "solana-rpc getSignaturesForAddress: a signature without blockTime", evidence };
          if (bt < fromS) { older = true; continue; }
          if (bt > toS) continue;
          if (configured) { if (!candidates.includes(s.signature)) candidates.push(s.signature); }
          else nonMatching.push({ network: "solana", txHash: s.signature, contract: info.mint, to: depositAddress, reason: "activity on a token account of a mint that is not a configured token (look-alike); ignored", evidence: [r.evidence] });
        }
        if (older || r.result.length < 1000) break;
        const last = r.result[r.result.length - 1];
        before = isObj(last) && typeof last.signature === "string" ? last.signature : undefined;
        if (!before) break;
      }
    }
    if (candidates.length > this.maxTx) return { status: "unavailable", reason: `more than ${this.maxTx} transactions in the window; narrow the window`, evidence };
    const transfers: ChainTransferFact[] = [];
    const unresolved: UnresolvedTx[] = [];
    if (candidates.length === 0) return { status: "ok", transfers, nonMatching, unresolved, evidence };
    const h = await this.headSlot();
    evidence.push(h.evidence);
    if (!h.ok) return { status: "unavailable", reason: h.reason, evidence };
    for (const sig of candidates) {
      const o = await this.readTx(sig, { head: h.head, evidence: h.evidence });
      if (o.status !== "ok") { unresolved.push({ txHash: sig, status: o.status, reason: o.reason }); continue; }
      const mine = o.transfers.filter((t) => t.to === depositAddress && Date.parse(t.timestamp) >= fromMs && Date.parse(t.timestamp) <= toMs);
      transfers.push(...mine);
      nonMatching.push(...o.nonMatching.filter((n) => n.to === depositAddress));
    }
    return { status: "ok", transfers, nonMatching, unresolved, evidence };
  }
}
