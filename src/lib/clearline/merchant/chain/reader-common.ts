/** Shared plumbing for the TRON and Ethereum readers: dependencies, JSON fetches that never throw, evidence. */
import { NETWORKS } from "../config";
import type { NetworkConfig, TokenConfig } from "../types";
import { CHAIN_TOKENS, type Evidence, type EvidenceSource } from "./model";
import {
  type ChainFactCache, DEFAULT_RATE_LIMITS, DEFAULT_RETRY, MemoryChainFactCache, type RateLimit, RateLimiter, type RequestContext,
  type RetryPolicy, type Runtime, resilientRequest, systemRuntime,
} from "./resilience";
import { type HttpRequest, type HttpTransport, Secrets, hostOf } from "./transport";

export interface ReaderOptions {
  /** Required: the HTTP transport (fetchTransport() in production, a recorded transport in tests). */
  transport: HttpTransport;
  runtime?: Runtime;
  rateLimit?: RateLimit;
  /** Share one limiter between readers that hit the same host. */
  limiter?: RateLimiter;
  retry?: Partial<RetryPolicy>;
  cache?: ChainFactCache;
  networks?: readonly NetworkConfig[];
  tokens?: readonly TokenConfig[];
}

export interface ReaderDeps {
  ctx: RequestContext;
  rt: Runtime;
  cache: ChainFactCache;
  networks: readonly NetworkConfig[];
  tokens: readonly TokenConfig[];
  secrets: Secrets;
  source: EvidenceSource;
}

export function makeDeps(source: EvidenceSource, o: ReaderOptions, secrets: Secrets): ReaderDeps {
  const rt = o.runtime ?? systemRuntime;
  const limiter = o.limiter ?? new RateLimiter(o.rateLimit ?? DEFAULT_RATE_LIMITS[source], rt);
  const retry = { ...DEFAULT_RETRY, ...(o.retry ?? {}) };
  return {
    ctx: { transport: o.transport, limiter, retry, rt, secrets, source },
    rt, secrets, source,
    cache: o.cache ?? new MemoryChainFactCache(),
    networks: o.networks ?? NETWORKS,
    tokens: o.tokens ?? CHAIN_TOKENS,
  };
}

export type JsonResult = { ok: true; json: unknown; evidence: Evidence } | { ok: false; reason: string; evidence: Evidence };

/** Rate-limited, retried request whose body is parsed as JSON. Never throws; reasons are redacted. */
export async function fetchJson(d: ReaderDeps, req: HttpRequest, method: string): Promise<JsonResult> {
  const r = await resilientRequest(d.ctx, req, method);
  const evidence = evidenceFor(d, req.url, method);
  if (!r.ok) return { ok: false, reason: r.reason, evidence };
  try {
    return { ok: true, json: JSON.parse(r.response.body), evidence };
  } catch {
    return { ok: false, reason: d.secrets.redact(`${d.source} ${method} at ${evidence.host}: response is not JSON`), evidence };
  }
}

export function evidenceFor(d: ReaderDeps, url: string, method: string, extra: Partial<Evidence> = {}): Evidence {
  return { source: d.source, host: hostOf(url, d.secrets), method, fetchedAt: new Date(d.rt.now()).toISOString(), ...extra };
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** ERC-20 / TRC-20 Transfer(address,address,uint256) topic. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
