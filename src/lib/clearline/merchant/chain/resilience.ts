/**
 * Robustness for the read-only chain readers: a per-host token-bucket rate limiter, bounded retries with exponential
 * backoff and full jitter, and a cache that only ever holds finalised facts. Clock, sleep and randomness are injected
 * so tests are deterministic. `resilientRequest` NEVER throws: it returns a response or a redacted failure reason.
 */
import { type HttpRequest, type HttpResponse, type HttpTransport, Secrets, TransportError, hostOf } from "./transport";

export interface Runtime {
  /** Milliseconds since the epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Uniform in [0, 1). */
  random(): number;
}

export const systemRuntime: Runtime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: () => Math.random(),
};

/** A deterministic runtime for tests: sleep advances the clock; random is a seeded LCG. */
export function fakeRuntime(opts: { startMs?: number; seed?: number } = {}): Runtime & { slept: number[] } {
  let t = opts.startMs ?? Date.UTC(2026, 0, 1);
  let s = (opts.seed ?? 1) >>> 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    random: () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; },
  };
}

export interface RateLimit { /** Bucket size (burst). */ capacity: number; /** Tokens added per second. */ refillPerSec: number }

/**
 * Default limits sized for free tiers.
 * [ASSUMPTION] TronGrid with an API key: stay at or under 10 requests/s (burst 10). TronGrid documents per-key QPS and
 * daily request caps that vary by plan; 10/s stays below the free-key limit we have seen published, and daily caps are
 * not enforced here.
 * [ASSUMPTION] Ethereum JSON-RPC on a free hosted plan (Infura / Alchemy / public endpoints): 5 requests/s (burst 5).
 * Compute-unit pricing makes eth_getLogs heavier than other calls; the limiter counts requests, not compute units.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimit> = {
  trongrid: { capacity: 10, refillPerSec: 10 },
  "ethereum-rpc": { capacity: 5, refillPerSec: 5 },
  // [ASSUMPTION] v1: the same free-tier budget for other EVM JSON-RPC endpoints and for Solana JSON-RPC.
  "evm-rpc": { capacity: 5, refillPerSec: 5 },
  "solana-rpc": { capacity: 5, refillPerSec: 5 },
};

/** Token bucket per host. `acquire` waits (via the injected sleep) until a token is available. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly limit: RateLimit, private readonly rt: Runtime) {
    if (!(limit.capacity >= 1) || !(limit.refillPerSec > 0)) throw new Error("rate limit needs capacity >= 1 and refillPerSec > 0");
  }
  async acquire(host: string): Promise<void> {
    for (let guard = 0; guard < 10_000; guard++) {
      const now = this.rt.now();
      const b = this.buckets.get(host) ?? { tokens: this.limit.capacity, at: now };
      b.tokens = Math.min(this.limit.capacity, b.tokens + ((now - b.at) / 1000) * this.limit.refillPerSec);
      b.at = now;
      if (b.tokens >= 1) { b.tokens -= 1; this.buckets.set(host, b); return; }
      this.buckets.set(host, b);
      await this.rt.sleep(Math.ceil(((1 - b.tokens) / this.limit.refillPerSec) * 1000));
    }
  }
}

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** A Retry-After longer than this is not waited for: the read is reported unavailable instead. */
  maxRetryAfterMs: number;
}
/** [ASSUMPTION] 5 attempts, 500 ms base, 8 s cap, honour Retry-After up to 30 s. */
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 8_000, maxRetryAfterMs: 30_000 };

/** Full jitter: uniform in [0, min(cap, base * 2^attempt)). `attempt` is 0 for the first retry. */
export function backoffDelay(policy: RetryPolicy, attempt: number, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; undefined if absent or unparseable. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, d - nowMs) : undefined;
}

export type RequestResult =
  | { ok: true; response: HttpResponse; attempts: number }
  | { ok: false; reason: string; attempts: number; status?: number; retryable: boolean };

export interface RequestContext {
  transport: HttpTransport;
  limiter: RateLimiter;
  retry: RetryPolicy;
  rt: Runtime;
  secrets: Secrets;
  /** Label used in reasons ("trongrid", "ethereum-rpc"). */
  source: string;
}

const retryableStatus = (s: number) => s === 429 || s >= 500;

/**
 * One logical request: rate-limited, retried on network errors, timeouts, 429 and 5xx (Retry-After honoured), not
 * retried on other 4xx, bounded attempts. Never throws; every reason is redacted and carries the host only.
 */
export async function resilientRequest(ctx: RequestContext, req: HttpRequest, what: string): Promise<RequestResult> {
  const host = hostOf(req.url, ctx.secrets);
  let last: { reason: string; status?: number } = { reason: "no attempt made" };
  for (let attempt = 1; attempt <= ctx.retry.maxAttempts; attempt++) {
    await ctx.limiter.acquire(host);
    let res: HttpResponse;
    try {
      res = await ctx.transport(req);
    } catch (e) {
      const kind = e instanceof TransportError ? e.kind : (e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError" ? "timeout" : "network";
      last = { reason: kind === "timeout" ? "request timed out" : "network error" };
      if (attempt < ctx.retry.maxAttempts) await ctx.rt.sleep(backoffDelay(ctx.retry, attempt - 1, ctx.rt.random));
      continue;
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, response: res, attempts: attempt };
    if (!retryableStatus(res.status)) {
      return { ok: false, retryable: false, attempts: attempt, status: res.status, reason: ctx.secrets.redact(`${ctx.source} ${what} at ${host}: HTTP ${res.status} (not retried)`) };
    }
    last = { reason: `HTTP ${res.status}`, status: res.status };
    if (attempt >= ctx.retry.maxAttempts) break;
    const ra = parseRetryAfter(res.headers["retry-after"], ctx.rt.now());
    if (ra !== undefined && ra > ctx.retry.maxRetryAfterMs) {
      return { ok: false, retryable: true, attempts: attempt, status: res.status, reason: ctx.secrets.redact(`${ctx.source} ${what} at ${host}: HTTP ${res.status}, Retry-After ${Math.round(ra / 1000)} s exceeds the wait limit`) };
    }
    await ctx.rt.sleep(ra ?? backoffDelay(ctx.retry, attempt - 1, ctx.rt.random));
  }
  return { ok: false, retryable: true, attempts: ctx.retry.maxAttempts, ...(last.status ? { status: last.status } : {}), reason: ctx.secrets.redact(`${ctx.source} ${what} at ${host}: ${last.reason} after ${ctx.retry.maxAttempts} attempts`) };
}

/** Cache of chain facts. Implementations MUST only be handed finalised results (the readers enforce this). */
export interface ChainFactCache {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

/** In-memory ChainFactCache (per process). */
export class MemoryChainFactCache implements ChainFactCache {
  readonly map = new Map<string, unknown>();
  async get(key: string) { return this.map.get(key); }
  async put(key: string, value: unknown) { this.map.set(key, value); }
}
