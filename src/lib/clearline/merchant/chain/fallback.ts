/**
 * v1 phase 2.4: one `ChainReader` interface for every network's reader, and `FallbackChainReader`, which puts a primary
 * and a fallback provider of the same network behind it.
 *
 * Deterministic policy (same inputs, same clock → same calls and same answer):
 * 1. Order: primary first, unless its circuit is open (`failuresToOpen` consecutive unavailable answers, for
 *    `cooldownMs` on the injected clock); then fallback first. A health check counts like a read.
 * 2. Every call has a deadline (`timeoutMs`); a call past it, or one that throws, is "unavailable" for that provider.
 * 3. If the first provider is unavailable, the second is asked. If BOTH are unavailable the result is "chain data
 *    unavailable" (never zero, never "no transfer").
 * 4. Corroboration: whenever an answer would make a transfer FINAL, the other provider must agree on that transaction
 *    (same transfers: log index, token contract, from, to, amount, decimals, block, and block hash where both give one).
 *    - they agree → final only if both say final (confirmations: the smaller count); evidence from both is kept;
 *    - they disagree, or one says the transaction failed / does not exist → "chain data conflicting" (never matched);
 *    - the other provider says reorged → reorged (not final);
 *    - the other provider is unavailable → the facts are kept but NOT final (seen, never matched; re-checked next run).
 *    With no fallback configured the single provider's answer is used as before (rc7 behaviour).
 * 5. Cache: only corroborated, final, agreed transaction answers are cached; never pending, unavailable or conflicting.
 */
import type { ChainNetwork, ChainTransferFact, Evidence, IncomingOutcome, NonMatchingTokenFact, TransferOutcome, UnresolvedTx } from "./model";
import type { NetworkId } from "../types";
import type { VerifyChainClient } from "./recording";
import { type ChainFactCache, MemoryChainFactCache, type Runtime, systemRuntime } from "./resilience";

export type HealthResult = { ok: true; head: bigint; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence };

/** What every chain reader offers: a health check, one transaction by id, and incoming transfers to an address. */
export interface ChainReader {
  readonly network: ChainNetwork;
  /** Provider label ("primary", "fallback", or "primary+fallback" for a FallbackChainReader). */
  readonly provider: string;
  health(): Promise<HealthResult>;
  getTransfer(txHash: string): Promise<TransferOutcome>;
  listIncoming(address: string, fromMs: number, toMs: number): Promise<IncomingOutcome>;
}

export interface FallbackOptions {
  primary: ChainReader;
  fallback?: ChainReader;
  runtime?: Runtime;
  /** [ASSUMPTION] 60 s per reader call (a listing may page and verify many receipts; each request has its own 15 s timeout). */
  timeoutMs?: number;
  /** Resolves after `ms`; injected in tests. Default: a real timer. */
  timer?: (ms: number) => Promise<void>;
  /** [ASSUMPTION] open the primary's circuit after 3 consecutive unavailable answers, for 60 s. */
  failuresToOpen?: number;
  cooldownMs?: number;
  cache?: ChainFactCache;
}

export const DEFAULT_FALLBACK_TIMEOUT_MS = 60_000;
const realTimer = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); });

type Side = "primary" | "fallback";
const TIMEOUT = Symbol("timeout");

/** A provider's view of one transaction, for comparison. */
type View = { kind: "transfers"; list: ChainTransferFact[]; evidence: Evidence[] } | { kind: "unresolved"; status: UnresolvedTx["status"]; reason: string };

const factKey = (t: ChainTransferFact) => `${t.txHash}|${t.logIndex}`;
const sameFact = (a: ChainTransferFact, b: ChainTransferFact) =>
  a.txHash === b.txHash && a.logIndex === b.logIndex && a.tokenContract.toLowerCase() === b.tokenContract.toLowerCase() && a.from === b.from && a.to === b.to
  && a.amountBaseUnits === b.amountBaseUnits && a.decimals === b.decimals && a.blockNumber === b.blockNumber
  && (a.blockHash === undefined || b.blockHash === undefined || a.blockHash.toLowerCase() === b.blockHash.toLowerCase());

type Verdict = { kind: "agree"; merged: ChainTransferFact[] } | { kind: "conflict"; reason: string } | { kind: "reorged"; reason: string } | { kind: "uncorroborated"; reason: string };

/** Compare two providers' views of one transaction whose facts one of them calls final. Labels name the sides. */
export function compareViews(a: View, b: View, la: string, lb: string): Verdict {
  for (const [v, other, l] of [[a, b, la], [b, a, lb]] as const) {
    if (v.kind !== "unresolved") continue;
    if (v.status === "unavailable") return { kind: "uncorroborated", reason: `${l} could not be read: ${v.reason}` };
    if (v.status === "reorged") return { kind: "reorged", reason: `${l}: ${v.reason}` };
    if (v.status === "conflicting") return { kind: "conflict", reason: `${l}: ${v.reason}` };
    if (other.kind === "transfers" && other.list.length > 0) return { kind: "conflict", reason: `${l} reports ${v.status.replace("_", " ")} where the other provider reports a transfer` };
  }
  if (a.kind !== "transfers" || b.kind !== "transfers") return { kind: "agree", merged: [] };
  const bm = new Map(b.list.map((t) => [factKey(t), t]));
  if (a.list.length !== b.list.length || a.list.some((t) => !bm.has(factKey(t)))) {
    return { kind: "conflict", reason: `${la} reports ${a.list.length} transfer(s), ${lb} reports ${b.list.length}, not the same log entries` };
  }
  const merged: ChainTransferFact[] = [];
  for (const x of a.list) {
    const y = bm.get(factKey(x))!;
    if (!sameFact(x, y)) return { kind: "conflict", reason: `${la} and ${lb} disagree on log ${x.logIndex} (token, sender, recipient, amount, decimals or block)` };
    merged.push({ ...x, finalised: x.finalised && y.finalised, confirmations: x.confirmations < y.confirmations ? x.confirmations : y.confirmations, evidence: [...x.evidence, ...y.evidence] });
  }
  return { kind: "agree", merged };
}

export class FallbackChainReader implements ChainReader {
  readonly network: ChainNetwork;
  readonly provider: string;
  private readonly rt: Runtime;
  private readonly timeoutMs: number;
  private readonly timer: (ms: number) => Promise<void>;
  private readonly failuresToOpen: number;
  private readonly cooldownMs: number;
  private readonly cache: ChainFactCache;
  private failures = 0;
  private openedAt: number | undefined;

  constructor(private readonly o: FallbackOptions) {
    if (o.fallback && o.fallback.network !== o.primary.network) throw new Error("primary and fallback must read the same network");
    this.network = o.primary.network;
    this.provider = o.fallback ? "primary+fallback" : "primary";
    this.rt = o.runtime ?? systemRuntime;
    this.timeoutMs = o.timeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS;
    this.timer = o.timer ?? realTimer;
    this.failuresToOpen = o.failuresToOpen ?? 3;
    this.cooldownMs = o.cooldownMs ?? 60_000;
    this.cache = o.cache ?? new MemoryChainFactCache();
  }

  get primaryReader(): ChainReader { return this.o.primary; }
  get fallbackReader(): ChainReader | undefined { return this.o.fallback; }

  /** Whether the primary's circuit is open now (it is then asked second). */
  primaryCircuitOpen(): boolean {
    if (this.openedAt === undefined) return false;
    if (this.rt.now() - this.openedAt >= this.cooldownMs) { this.openedAt = undefined; this.failures = 0; return false; }
    return true;
  }

  private order(): Side[] {
    if (!this.o.fallback) return ["primary"];
    return this.primaryCircuitOpen() ? ["fallback", "primary"] : ["primary", "fallback"];
  }

  private reader(s: Side): ChainReader { return s === "primary" ? this.o.primary : this.o.fallback!; }

  private record(s: Side, ok: boolean) {
    if (s !== "primary") return;
    if (ok) { this.failures = 0; this.openedAt = undefined; return; }
    if (++this.failures >= this.failuresToOpen && this.openedAt === undefined) this.openedAt = this.rt.now();
  }

  /** Run one provider call under the deadline. Never throws. */
  private async call<T extends { status: string }>(s: Side, f: (r: ChainReader) => Promise<T>): Promise<T | { status: "unavailable"; reason: string; evidence: Evidence[] }> {
    let out: T | typeof TIMEOUT;
    try {
      out = await Promise.race([f(this.reader(s)), this.timer(this.timeoutMs).then((): typeof TIMEOUT => TIMEOUT)]);
    } catch {
      out = { status: "unavailable", reason: `${s} provider error`, evidence: [] } as unknown as T;
    }
    const r = out === TIMEOUT ? { status: "unavailable" as const, reason: `${s} provider timed out after ${this.timeoutMs} ms`, evidence: [] as Evidence[] } : out;
    this.record(s, r.status !== "unavailable");
    return r;
  }

  /** Both providers' health (primary first). Updates the circuit. */
  async healthReport(): Promise<{ primary: HealthResult; fallback?: HealthResult; primaryCircuitOpen: boolean }> {
    const one = async (s: Side): Promise<HealthResult> => {
      let h: HealthResult | typeof TIMEOUT;
      try { h = await Promise.race([this.reader(s).health(), this.timer(this.timeoutMs).then((): typeof TIMEOUT => TIMEOUT)]); } catch { h = { ok: false, reason: `${s} provider error`, evidence: { source: "recording", host: "unknown", method: "health", fetchedAt: new Date(this.rt.now()).toISOString() } }; }
      if (h === TIMEOUT) h = { ok: false, reason: `${s} health check timed out after ${this.timeoutMs} ms`, evidence: { source: "recording", host: "unknown", method: "health", fetchedAt: new Date(this.rt.now()).toISOString() } };
      this.record(s, h.ok);
      return h;
    };
    const primary = await one("primary");
    const fallback = this.o.fallback ? await one("fallback") : undefined;
    return { primary, ...(fallback ? { fallback } : {}), primaryCircuitOpen: this.primaryCircuitOpen() };
  }

  async health(): Promise<HealthResult> {
    const r = await this.healthReport();
    if (r.primary.ok || !r.fallback) return r.primary;
    return r.fallback.ok ? r.fallback : { ok: false, reason: `both providers failed (primary: ${r.primary.reason}; fallback: ${r.fallback.reason})`, evidence: r.primary.evidence };
  }

  async getTransfer(txHash: string): Promise<TransferOutcome> {
    const key = `${this.network}:fallback:tx:${txHash.toLowerCase()}`;
    const cached = await this.cache.get(key);
    if (cached) return cached as TransferOutcome;
    const [first, second] = this.order();
    const a = await this.call(first, (r) => r.getTransfer(txHash));
    if (!second) return a;
    if (a.status === "unavailable") {
      const b = await this.call(second, (r) => r.getTransfer(txHash));
      if (b.status === "unavailable") return { status: "unavailable", reason: `both providers failed (${first}: ${a.reason}; ${second}: ${b.reason})`, evidence: [...a.evidence, ...b.evidence] };
      // only one provider answered: nothing it says can be final
      return b.status === "ok" ? { ...b, transfers: b.transfers.map((t) => ({ ...t, finalised: false })) } : b;
    }
    if (!(a.status === "ok" && a.transfers.some((t) => t.finalised))) return a;
    const b = await this.call(second, (r) => r.getTransfer(txHash));
    const v = compareViews(viewOfTx(a), viewOfTx(b), first, second);
    switch (v.kind) {
      case "conflict": return { status: "conflicting", reason: `chain data conflicting: ${v.reason}`, evidence: [...a.evidence, ...b.evidence] };
      case "reorged": return { status: "reorged", reason: v.reason, transfers: a.transfers.map((t) => ({ ...t, finalised: false })), evidence: [...a.evidence, ...b.evidence] };
      case "uncorroborated": return { ...a, transfers: a.transfers.map((t) => ({ ...t, finalised: false })), evidence: [...a.evidence, ...b.evidence] };
      case "agree": {
        const out: TransferOutcome = { status: "ok", transfers: v.merged, nonMatching: a.nonMatching, evidence: [...a.evidence, ...b.evidence] };
        if (v.merged.length > 0 && v.merged.every((t) => t.finalised)) await this.cache.put(key, out);
        return out;
      }
    }
  }

  async listIncoming(address: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    const [first, second] = this.order();
    const a = await this.call(first, (r) => r.listIncoming(address, fromMs, toMs));
    if (!second) return a;
    if (a.status === "unavailable") {
      const b = await this.call(second, (r) => r.listIncoming(address, fromMs, toMs));
      if (b.status === "unavailable") return { status: "unavailable", reason: `both providers failed (${first}: ${a.reason}; ${second}: ${b.reason})`, evidence: [...a.evidence, ...b.evidence] };
      return { ...b, transfers: b.transfers.map((t) => ({ ...t, finalised: false })) };
    }
    if (!a.transfers.some((t) => t.finalised)) return a;
    const b = await this.call(second, (r) => r.listIncoming(address, fromMs, toMs));
    if (b.status === "unavailable") return { ...a, transfers: a.transfers.map((t) => ({ ...t, finalised: false })), evidence: [...a.evidence, ...b.evidence] };

    // Per transaction: every tx with a final transfer on either side is compared; the rest stay as pending facts.
    const sides = { [first]: a, [second]: b } as Record<Side, Extract<IncomingOutcome, { status: "ok" }>>;
    const finalTx = [...new Set([...a.transfers, ...b.transfers].filter((t) => t.finalised).map((t) => t.txHash))].sort();
    const transfers: ChainTransferFact[] = [];
    const unresolved: UnresolvedTx[] = [];
    const decided = new Set<string>();
    const inWindow = (t: ChainTransferFact) => t.to === address && Date.parse(t.timestamp) >= fromMs && Date.parse(t.timestamp) <= toMs;
    const view = async (s: Side, tx: string): Promise<View> => {
      const o = sides[s];
      const list = o.transfers.filter((t) => t.txHash === tx);
      if (list.length) return { kind: "transfers", list, evidence: o.evidence };
      const u = o.unresolved.find((x) => x.txHash === tx);
      if (u) return { kind: "unresolved", status: u.status, reason: u.reason };
      // not listed by this provider: read it by id there
      const r = await this.call(s, (rd) => rd.getTransfer(tx));
      if (r.status === "ok") return { kind: "transfers", list: r.transfers.filter(inWindow), evidence: r.evidence };
      return { kind: "unresolved", status: r.status, reason: r.reason };
    };
    for (const tx of finalTx) {
      decided.add(tx);
      const v = compareViews(await view(first, tx), await view(second, tx), first, second);
      if (v.kind === "agree") transfers.push(...v.merged);
      else if (v.kind === "uncorroborated") {
        const own = new Map<string, ChainTransferFact>();
        for (const t of [...sides[first].transfers, ...sides[second].transfers]) if (t.txHash === tx && !own.has(factKey(t))) own.set(factKey(t), { ...t, finalised: false });
        transfers.push(...own.values());
      }
      else unresolved.push({ txHash: tx, status: v.kind === "conflict" ? "conflicting" : "reorged", reason: v.kind === "conflict" ? `chain data conflicting: ${v.reason}` : v.reason });
    }
    // Not-final facts: union by log entry (first provider's copy wins), never final.
    const seen = new Set(transfers.map(factKey));
    for (const t of [...a.transfers, ...b.transfers]) {
      if (decided.has(t.txHash) || seen.has(factKey(t))) continue;
      seen.add(factKey(t));
      transfers.push({ ...t, finalised: false });
    }
    const uSeen = new Set(unresolved.map((u) => u.txHash));
    for (const u of [...a.unresolved, ...b.unresolved]) if (!decided.has(u.txHash) && !uSeen.has(u.txHash)) { uSeen.add(u.txHash); unresolved.push(u); }
    const nm = new Map<string, NonMatchingTokenFact>();
    for (const n of [...a.nonMatching, ...b.nonMatching]) { const k = `${n.txHash}|${n.logIndex ?? ""}|${n.contract}`; if (!nm.has(k)) nm.set(k, n); }
    return { status: "ok", transfers, nonMatching: [...nm.values()], unresolved, evidence: [...a.evidence, ...b.evidence] };
  }
}

function viewOfTx(o: TransferOutcome | { status: "unavailable"; reason: string; evidence: Evidence[] }): View {
  if (o.status === "ok") return { kind: "transfers", list: o.transfers, evidence: o.evidence };
  return { kind: "unresolved", status: o.status, reason: o.reason };
}

/** A ChainReader over one network of a VerifyChainClient (e.g. a recorded client in tests and the demo). */
export function readerOfClient(c: Pick<VerifyChainClient, "incoming" | "transfer">, network: ChainNetwork, provider: string): ChainReader {
  const fetchedAt = new Date(0).toISOString();
  return {
    network, provider,
    health: async () => ({ ok: true, head: 0n, evidence: { source: "recording", host: provider, method: "health", fetchedAt } }),
    getTransfer: (h) => c.transfer(network, h),
    listIncoming: (a, f, t) => c.incoming(network, a, f, t),
  };
}

/** A VerifyChainClient over per-network ChainReaders (each may be a FallbackChainReader). Unknown networks are unavailable. */
export class ReadersChainClient implements VerifyChainClient {
  constructor(private readonly readers: Partial<Record<ChainNetwork, ChainReader>>, readonly mode: VerifyChainClient["mode"] = "recorded") {}
  async incoming(network: NetworkId, address: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    const r = this.readers[network as ChainNetwork];
    return r ? r.listIncoming(address, fromMs, toMs) : { status: "unavailable", reason: `no ${network} reader configured`, evidence: [] };
  }
  async transfer(network: NetworkId, txHash: string): Promise<TransferOutcome> {
    const r = this.readers[network as ChainNetwork];
    return r ? r.getTransfer(txHash) : { status: "unavailable", reason: `no ${network} reader configured`, evidence: [] };
  }
}
