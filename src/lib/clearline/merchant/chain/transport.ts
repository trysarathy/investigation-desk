/**
 * HTTP transport for the read-only chain readers. A transport performs ONE request and returns the raw response; it
 * never retries, caches or interprets (resilience.ts does that). Production uses the SSRF-safe client
 * (src/lib/net/safe-fetch.ts, policy "chain-merchant": TronGrid plus the configured TRONGRID_BASE_URL and
 * ETHEREUM_RPC_URL hosts, public addresses only, no redirects) with an AbortController timeout; tests inject a recorded transport (recorded.ts). Nothing here signs, sends or holds keys:
 * the only secrets are read-API credentials (a TronGrid key header, an RPC URL that may embed a key), and they are
 * redacted from every error, log line and evidence record via `redact()`.
 */

import { safeFetch, OutboundRefused, type Lookup, type OutboundPolicy } from "../../../net/safe-fetch";
import { merchantChainPolicy } from "../../../net/outbound-hosts";

export interface HttpRequest { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string }
export interface HttpResponse { status: number; headers: Record<string, string>; body: string }
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

/** A transport failure with no response (network error, timeout). Its message never contains a URL or header. */
export class TransportError extends Error {
  constructor(readonly kind: "timeout" | "network", message: string) {
    super(message);
    this.name = kind === "timeout" ? "TimeoutError" : "NetworkError";
  }
}

/** Default per-request timeout [ASSUMPTION: 15 s; TronGrid and hosted RPCs normally answer reads in well under 2 s]. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Production transport over the SSRF-safe client. Timeout via AbortController. Errors are rethrown as TransportError
 * with a generic message only (the underlying error may echo the URL, so its text is dropped). A request the outbound
 * policy refuses (host not allowed, private address, redirect) is a "network" TransportError naming the refusal code.
 */
export function fetchTransport(opts: { timeoutMs?: number; fetchImpl?: typeof fetch; policy?: OutboundPolicy; lookup?: Lookup } = {}): HttpTransport {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy = opts.policy ?? merchantChainPolicy(process.env);
  return async (req) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await safeFetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctl.signal }, policy, { fetchImpl: opts.fetchImpl, lookup: opts.lookup });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      return { status: res.status, headers, body: await res.text() };
    } catch (e) {
      if (ctl.signal.aborted) throw new TransportError("timeout", `request timed out after ${timeoutMs} ms`);
      if (e instanceof OutboundRefused) throw new TransportError("network", `outbound request refused (${e.code})`);
      throw new TransportError("network", `network error (${(e as Error)?.name ?? "Error"})`);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The secret strings to scrub. Built from env values; values shorter than 4 characters are ignored (too noisy). */
export class Secrets {
  private readonly values: string[];
  constructor(values: readonly (string | undefined)[]) {
    const v = values.filter((x): x is string => typeof x === "string" && x.length >= 4);
    // Longest first so a whole URL is replaced before a fragment of it.
    this.values = [...new Set(v)].sort((a, b) => b.length - a.length);
  }
  /** Secrets carried by an RPC URL: the URL itself, credentials, long path segments and query values. */
  static fromUrl(url: string | undefined): string[] {
    if (!url) return [];
    const out = [url];
    try {
      const u = new URL(url);
      if (u.username) out.push(u.username, decodeURIComponent(u.username));
      if (u.password) out.push(u.password, decodeURIComponent(u.password));
      for (const seg of u.pathname.split("/")) if (seg.length >= 8) out.push(seg, decodeURIComponent(seg));
      for (const [, v] of u.searchParams) if (v.length >= 4) out.push(v, encodeURIComponent(v));
      if (u.search.length > 1) out.push(u.search.slice(1));
      if (u.pathname.length > 1) out.push(u.origin + u.pathname);
    } catch { /* not a URL: the raw value is still scrubbed */ }
    return out;
  }
  merge(other: Secrets): Secrets { return new Secrets([...this.values, ...other.values]); }
  /** Replace every secret occurrence with [REDACTED]. */
  redact(text: string): string {
    let out = text;
    for (const s of this.values) out = out.split(s).join("[REDACTED]");
    return out;
  }
  contains(text: string): boolean { return this.values.some((s) => text.includes(s)); }
}

/** Redact `text` against the given secrets. */
export const redact = (text: string, secrets: Secrets): string => secrets.redact(text);

/**
 * Host only (no scheme, path, query, credentials). Evidence records this and nothing more. If a provider ever put a
 * key in the hostname, the secret scrub still applies.
 */
export function hostOf(url: string, secrets?: Secrets): string {
  let host: string;
  try { host = new URL(url).host; } catch { host = "invalid-url"; }
  return secrets ? secrets.redact(host) : host;
}
