// Read-only HTTP client for chain APIs. Every response is kept as a RawResponse with its fetch
// time and SHA-256 (spec 6.2). Rate limits (429, 403, Etherscan's "rate limit" bodies) are retried
// with exponential backoff. Responses are cached so repeat lookups don't spend API quota.
// API keys come from the environment only and never appear in a stored URL, log or error.

import { createHash } from "node:crypto";
import type { Chain, RawResponse } from "../types";
import type { ResponseStore } from "./store";

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export const fetchTransport: Transport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(15_000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, body: await res.text() };
};

export class ChainApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly raw?: RawResponse,
  ) {
    super(message);
  }
}

export const sha256Hex = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export interface ClientOptions {
  source: RawResponse["source"];
  /** Minimum spacing between requests to this API, in ms. */
  minIntervalMs: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  transport?: Transport;
  store: ResponseStore;
  /** Query-string parameters and headers that carry secrets; stripped before storing. */
  secretParams?: string[];
  /** Classify a 200 body as a rate limit or a hard error (Etherscan reports both with HTTP 200). */
  classifyBody?: (
    body: string,
  ) => { retryable: boolean; message: string } | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface RequestOptions {
  chain: Chain;
  /** Cache lifetime in seconds. 0 = do not cache. Infinity = immutable (confirmed data). */
  ttlSec: number;
  /** Decides the TTL from the response, e.g. "not found yet" is cached briefly. */
  ttlFor?: (raw: RawResponse) => number;
}

export class ChainClient {
  private nextSlot = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly o: ClientOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? (() => new Date());
  }

  redact(url: string): string {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    if (this.o.source === "public-rpc") {
      u.pathname = "/";
      u.search = "";
    }
    for (const p of this.o.secretParams ?? [])
      if (u.searchParams.has(p)) u.searchParams.set(p, "REDACTED");
    return u.toString();
  }

  async request(req: HttpRequest, opts: RequestOptions): Promise<RawResponse> {
    const redacted = {
      method: req.method,
      url: this.redact(req.url),
      body: req.body,
    };
    const cacheKey = sha256Hex(
      JSON.stringify([redacted, opts.chain, sha256Hex(req.url)]),
    );
    const hit =
      opts.ttlSec > 0
        ? await this.o.store.getCached(cacheKey, this.now())
        : undefined;
    if (hit) return { ...hit, cached: true };

    const transport = this.o.transport ?? fetchTransport;
    const maxRetries = this.o.maxRetries ?? 4;
    const base = this.o.baseBackoffMs ?? 500;
    let lastError: ChainApiError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.throttle();
      let res: HttpResponse;
      try {
        res = await transport(req);
      } catch (e) {
        // Network failure or timeout: retryable, but never echo the request (it may hold a key).
        lastError = new ChainApiError(
          `${this.o.source} request failed: ${(e as Error).name}`,
          true,
        );
        await this.sleep(backoff(base, attempt));
        continue;
      }
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        lastError = new ChainApiError(
          `${this.o.source} HTTP ${res.status}`,
          true,
          res.status,
        );
        const retryAfter = Number(res.headers["retry-after"]);
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoff(base, attempt),
        );
        continue;
      }
      const verdict = this.o.classifyBody?.(res.body);
      if (verdict?.retryable) {
        lastError = new ChainApiError(
          `${this.o.source}: ${verdict.message}`,
          true,
          res.status,
        );
        await this.sleep(backoff(base, attempt));
        continue;
      }
      const raw: RawResponse = {
        source: this.o.source,
        chain: opts.chain,
        request: redacted,
        status: res.status,
        fetchedAt: this.now().toISOString(),
        sha256: sha256Hex(res.body),
        body: res.body,
      };
      await this.o.store.saveRaw(raw);
      if (verdict)
        throw new ChainApiError(
          `${this.o.source}: ${verdict.message}`,
          false,
          res.status,
          raw,
        );
      if (res.status >= 400)
        throw new ChainApiError(
          `${this.o.source} HTTP ${res.status}`,
          false,
          res.status,
          raw,
        );
      const ttl = opts.ttlFor ? opts.ttlFor(raw) : opts.ttlSec;
      if (ttl > 0) await this.o.store.putCached(cacheKey, raw, ttl, this.now());
      return raw;
    }
    throw (
      lastError ??
      new ChainApiError(`${this.o.source}: retries exhausted`, true)
    );
  }

  private async throttle() {
    const t = this.now().getTime();
    const wait = Math.max(0, this.nextSlot - t);
    this.nextSlot = Math.max(t, this.nextSlot) + this.o.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }
}

/** Exponential backoff with jitter: ~0.5s, 1s, 2s, 4s. */
function backoff(base: number, attempt: number): number {
  return base * 2 ** attempt * (0.75 + Math.random() * 0.5);
}
