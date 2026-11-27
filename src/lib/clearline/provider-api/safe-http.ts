/**
 * v1 phase 2.2: the only way a provider API is called. SSRF-safe by construction:
 *  - HTTPS only, to a host on the connection's allowlist (exact, lower-case host names; no wildcards);
 *  - every address the host resolves to must be public unicast (ip.ts), checked inside the socket's own DNS lookup, so
 *    the address checked is the address connected to (no DNS-rebinding window); an IP literal is checked the same way;
 *  - no proxy, no connection reuse, no automatic redirects: a redirect is followed only to the same scheme, host and
 *    port (at most 3), any other redirect is refused;
 *  - a timeout per request and a response size limit (the body is cut off, never buffered past the limit).
 * Errors carry a code only: never the URL's query, a header or the response body (an API key must never reach a log).
 *
 * `testLoopback` exists for the local stand-in provider in tests only: it additionally allows http: and LOOPBACK
 * addresses (never private or link-local ones) and is refused outright when NODE_ENV is "production".
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isLoopbackAddress, isPublicAddress } from "./ip";

export type SafeHttpErrorCode =
  | "url_invalid" | "scheme_refused" | "host_not_allowed" | "address_refused" | "dns_failed" | "redirect_refused" | "too_many_redirects"
  | "timeout" | "response_too_large" | "network_error";

export class SafeHttpError extends Error {
  constructor(readonly code: SafeHttpErrorCode) {
    super(`provider request refused or failed (${code})`);
    this.name = "SafeHttpError";
  }
}

export interface SafeRequest { url: string; headers?: Record<string, string> }
export interface SafeResponse { status: number; headers: Record<string, string>; body: Uint8Array }

export type Resolver = (host: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (host) => new Promise((resolve, reject) => dnsLookup(host, { all: true, verbatim: true }, (e, a) => (e ? reject(e) : resolve(a))));

export interface SafeHttpOptions {
  /** Exact host names the connection may call (lower case, no port, no wildcard). */
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Tests only: DNS answers to use instead of the system resolver. */
  resolver?: Resolver;
  /** Tests only (refused in production): allow http: and loopback addresses for a local stand-in provider. */
  testLoopback?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** A valid allowlist entry: an exact lower-case DNS host name (an IP literal is never an allowlist entry). */
export const isAllowlistHost = (h: string) => HOST_RE.test(h) && !isIP(h) && !/^\d+(\.\d+)*$/.test(h);

export function assertTestLoopbackAllowed(testLoopback: boolean | undefined): void {
  if (testLoopback && process.env.NODE_ENV === "production") throw new SafeHttpError("scheme_refused");
}

function parseTarget(raw: string, o: SafeHttpOptions): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SafeHttpError("url_invalid"); }
  if (u.username || u.password) throw new SafeHttpError("url_invalid");
  if (!(u.protocol === "https:" || (o.testLoopback && u.protocol === "http:"))) throw new SafeHttpError("scheme_refused");
  const host = u.hostname.toLowerCase();
  if (!o.allowedHosts.includes(host)) throw new SafeHttpError("host_not_allowed");
  return u;
}

const addressOk = (ip: string, o: SafeHttpOptions) => isPublicAddress(ip) || (!!o.testLoopback && isLoopbackAddress(ip));

/** The socket's DNS lookup: resolves, refuses the WHOLE answer if any address is not allowed, returns what was checked. */
function guardedLookup(o: SafeHttpOptions, resolver: Resolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, cb: (...a: unknown[]) => void) => {
    const all = typeof options === "object" && options !== null && options.all === true;
    resolver(hostname).then((addrs) => {
      if (!addrs.length) return cb(new SafeHttpError("dns_failed"));
      if (addrs.some((a) => !addressOk(a.address, o))) return cb(new SafeHttpError("address_refused"));
      if (all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    }, () => cb(new SafeHttpError("dns_failed")));
  };
}

function once(u: URL, headers: Record<string, string>, o: SafeHttpOptions): Promise<SafeResponse> {
  const resolver = o.resolver ?? systemResolver;
  const maxBytes = o.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const literal = isIP(u.hostname.replace(/^\[|\]$/g, ""));
  if (literal && !addressOk(u.hostname.replace(/^\[|\]$/g, ""), o)) return Promise.reject(new SafeHttpError("address_refused"));
  const mod = u.protocol === "https:" ? https : http;
  return new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const fail = (e: SafeHttpError) => { if (!settled) { settled = true; reject(e); } };
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: "GET",
      headers: { accept: "application/json", "user-agent": "clearline-provider-pull", ...headers },
      agent: false, lookup: guardedLookup(o, resolver) as never, timeout: timeoutMs, servername: literal ? undefined : u.hostname,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const declared = Number(res.headers["content-length"] ?? "0");
      if (declared > maxBytes) { res.destroy(); return fail(new SafeHttpError("response_too_large")); }
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); req.destroy(); fail(new SafeHttpError("response_too_large")); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") h[k.toLowerCase()] = v; else if (Array.isArray(v)) h[k.toLowerCase()] = v.join(", ");
        resolve({ status: res.statusCode ?? 0, headers: h, body: new Uint8Array(Buffer.concat(chunks)) });
      });
      res.on("error", () => fail(new SafeHttpError("network_error")));
    });
    const timer = setTimeout(() => { req.destroy(); fail(new SafeHttpError("timeout")); }, timeoutMs);
    timer.unref?.();
    req.on("timeout", () => { req.destroy(); fail(new SafeHttpError("timeout")); });
    req.on("error", (e) => fail(e instanceof SafeHttpError ? e : new SafeHttpError("network_error")));
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/** One GET through the guards above, following same-origin redirects only. */
export async function safeGet(req: SafeRequest, o: SafeHttpOptions): Promise<SafeResponse> {
  assertTestLoopbackAllowed(o.testLoopback);
  let u = parseTarget(req.url, o);
  for (let hop = 0; ; hop++) {
    const res = await once(u, req.headers ?? {}, o);
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
    const loc = res.headers.location;
    if (!loc) return res;
    let next: URL;
    try { next = new URL(loc, u); } catch { throw new SafeHttpError("redirect_refused"); }
    if (next.protocol !== u.protocol || next.hostname.toLowerCase() !== u.hostname.toLowerCase() || next.port !== u.port) throw new SafeHttpError("redirect_refused");
    if (hop + 1 > MAX_REDIRECTS) throw new SafeHttpError("too_many_redirects");
    u = next;
  }
}
