/**
 * v1 E1 (phase 5.2): the ONE outbound HTTP client for server code. Every request Clearline's server makes to another
 * host goes through `safeFetch` with a named policy (an exact host allow-list). A test
 * (tests/platform/outbound-fetch.test.ts) fails if any server file in src/ calls or references the global `fetch`
 * outside this file.
 *
 * What it enforces, before a byte is sent:
 *   - https only; no credentials in the URL's user-info (keys go in headers or the path).
 *   - the URL's host (with port, when not 443) is EXACTLY one of the policy's hosts (no suffix or wildcard matching).
 *   - the host is not an IP literal in a private, loopback, link-local, CGNAT, multicast or reserved range, and every
 *     address the host name resolves to is public (SSRF to internal services, cloud metadata at 169.254.169.254, ...).
 *   - redirects are never followed (`redirect: "manual"`); a 3xx answer is refused, so an allowed host cannot bounce
 *     the request to a disallowed one.
 * Errors name the policy and a code only, never the URL (it may carry an API key) or the resolved address.
 *
 * Residual risk [ASSUMPTION, documented in docs/security/ASVS_L2.md]: the DNS check and the connection resolve the
 * name separately (time-of-check/time-of-use), so a hostile DNS server for an ALLOWED host could rebind between the
 * two. Hosts are exact, operator-chosen API hosts, which narrows this to a compromised provider's DNS. Pinning the
 * connection to the checked address needs an undici dispatcher, which is not a dependency of this build.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface OutboundPolicy {
  /** What the requests are for, e.g. "chain-legacy" (errors and logs name it). */
  readonly name: string;
  /** Exact hosts, lowercase, as `URL.host` spells them ("api.example.com", or "rpc.example.com:8545" for a non-443 port). */
  readonly hosts: readonly string[];
}

export type OutboundRefusal = "BAD_URL" | "NOT_HTTPS" | "CREDENTIALS_IN_URL" | "HOST_NOT_ALLOWED" | "PRIVATE_ADDRESS" | "DNS_FAILED" | "REDIRECT_REFUSED";

export class OutboundRefused extends Error {
  constructor(readonly policy: string, readonly code: OutboundRefusal) {
    super(`outbound request refused (${policy}): ${code}`);
    this.name = "OutboundRefused";
  }
}

export type Lookup = (host: string) => Promise<readonly { address: string; family: number }[]>;
export interface SafeFetchDeps {
  /** Resolves a host name to every address (tests inject a fixed answer). */
  lookup?: Lookup;
  /** The underlying fetch (tests inject a recorded one). */
  fetchImpl?: typeof fetch;
}

const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Normalise a policy host: lowercase, no trailing dot, default https port dropped. */
export function normaliseHost(h: string): string {
  let s = h.trim().toLowerCase();
  if (s.endsWith(":443")) s = s.slice(0, -4);
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

/** A policy whose hosts are the given hosts plus the host of each configured URL (operator settings such as an RPC URL). */
export function policyWithUrls(name: string, hosts: readonly string[], urls: readonly (string | undefined)[]): OutboundPolicy {
  const extra: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    try { extra.push(new URL(u).host); } catch { /* an unparsable URL adds nothing; the request itself is refused as BAD_URL */ }
  }
  return { name, hosts: [...new Set([...hosts, ...extra].map(normaliseHost))] };
}

function v4Parts(a: string): number[] | undefined {
  const p = a.split(".");
  if (p.length !== 4) return undefined;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : undefined;
}

/** True for any address that is not a globally routable unicast address. Unknown shapes count as private (fail closed). */
export function isPrivateAddress(address: string): boolean {
  let a = address.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const fam = isIP(a);
  if (fam === 4) {
    const [x, y, z] = v4Parts(a)!;
    return x === 0 || x === 10 || x === 127 || x >= 224 // this network, private, loopback, multicast + reserved + broadcast
      || (x === 100 && y >= 64 && y <= 127) // CGNAT
      || (x === 169 && y === 254) // link-local, cloud metadata
      || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) // private
      || (x === 192 && y === 0 && (z === 0 || z === 2)) // IETF protocol assignments, TEST-NET-1
      || (x === 192 && y === 88 && z === 99) // 6to4 relay anycast (deprecated)
      || (x === 198 && (y === 18 || y === 19)) // benchmarking
      || (x === 198 && y === 51 && z === 100) || (x === 203 && y === 0 && z === 113); // TEST-NET-2/3
  }
  if (fam === 6) {
    if (a === "::" || a === "::1") return true;
    // IPv4-mapped / -compatible / NAT64 forms: judge the embedded IPv4 address.
    const m = /^(?:::ffff:(?:0:)?|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (m) return isPrivateAddress(m[1]);
    const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(a.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 // unique local fc00::/7
      || (first & 0xffc0) === 0xfe80 // link-local fe80::/10
      || (first & 0xffc0) === 0xfec0 // site-local (deprecated)
      || (first & 0xff00) === 0xff00 // multicast
      || first === 0x2001 && parseInt(a.split(":")[1] || "0", 16) === 0x0db8 // documentation
      || first === 0x0100 // discard-only 100::/64 [conservative: whole /16]
      || first === 0; // any other ::/16 form (e.g. deprecated IPv4-compatible in hex)
  }
  return true;
}

/** Checks a URL against a policy and DNS. Resolves to the parsed URL, or throws OutboundRefused. Exported for tests. */
export async function checkOutbound(rawUrl: string, policy: OutboundPolicy, lookup: Lookup = defaultLookup): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new OutboundRefused(policy.name, "BAD_URL"); }
  if (u.protocol !== "https:") throw new OutboundRefused(policy.name, "NOT_HTTPS");
  if (u.username || u.password) throw new OutboundRefused(policy.name, "CREDENTIALS_IN_URL");
  const host = normaliseHost(u.host);
  if (!policy.hosts.map(normaliseHost).includes(host)) throw new OutboundRefused(policy.name, "HOST_NOT_ALLOWED");
  const hostname = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new OutboundRefused(policy.name, "PRIVATE_ADDRESS");
    return u;
  }
  let addrs: readonly { address: string }[];
  try { addrs = await lookup(hostname); } catch { throw new OutboundRefused(policy.name, "DNS_FAILED"); }
  if (!addrs.length) throw new OutboundRefused(policy.name, "DNS_FAILED");
  if (addrs.some((x) => isPrivateAddress(x.address))) throw new OutboundRefused(policy.name, "PRIVATE_ADDRESS");
  return u;
}

/** One outbound request under a policy. Same shape as fetch; redirects are refused, never followed. */
export async function safeFetch(url: string, init: RequestInit, policy: OutboundPolicy, deps: SafeFetchDeps = {}): Promise<Response> {
  const u = await checkOutbound(url, policy, deps.lookup ?? defaultLookup);
  const f = deps.fetchImpl ?? globalThis.fetch;
  const res = await f(u.toString(), { ...init, redirect: "manual" });
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
    try { await res.body?.cancel(); } catch { /* nothing to drain */ }
    throw new OutboundRefused(policy.name, "REDIRECT_REFUSED");
  }
  return res;
}

/** A fetch-shaped function bound to one policy (for code and SDKs that take a `fetch`). */
export function safeFetcher(policy: OutboundPolicy, deps: SafeFetchDeps = {}): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === "string" || input instanceof URL) return safeFetch(input.toString(), init ?? {}, policy, deps);
    // A Request object (some SDKs build one): its URL is checked the same way; its method, headers and body carry over.
    const req = input as Request;
    return safeFetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal, ...(req.body ? { duplex: "half" } : {}), ...init } as RequestInit, policy, deps);
  }) as typeof fetch;
}

/**
 * Wave 2 integration: the ONLY way server code calls a LOCAL stand-in (the S3 stand-in of prod-local, the Xero and
 * QuickBooks stand-ins): the URL's host must be exactly 127.0.0.1, [::1] or localhost, no credentials in the URL, and
 * redirects are refused. Nothing else is reachable through it, so a stand-in setting can never point a request at
 * another host. Callers choose it only for an operator setting that was already checked to be loopback (s3ConfigFromEnv,
 * the ledger stand-in URLs); every other request goes through safeFetch and a policy.
 */
export async function loopbackFetch(url: string, init: RequestInit, deps: Pick<SafeFetchDeps, "fetchImpl"> = {}): Promise<Response> {
  let u: URL;
  try { u = new URL(url); } catch { throw new OutboundRefused("loopback", "BAD_URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new OutboundRefused("loopback", "BAD_URL");
  if (u.username || u.password) throw new OutboundRefused("loopback", "CREDENTIALS_IN_URL");
  if (!isLoopbackHost(u.hostname)) throw new OutboundRefused("loopback", "HOST_NOT_ALLOWED");
  const f = deps.fetchImpl ?? globalThis.fetch;
  const res = await f(u.toString(), { ...init, redirect: "manual" });
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
    try { await res.body?.cancel(); } catch { /* nothing to drain */ }
    throw new OutboundRefused("loopback", "REDIRECT_REFUSED");
  }
  return res;
}

/** Exactly 127.0.0.1, ::1 or localhost (no other loopback spelling, no suffix). */
export const isLoopbackHost = (hostname: string): boolean => ["127.0.0.1", "[::1]", "::1", "localhost"].includes(hostname.toLowerCase());

/** A fetch-shaped function for loopbackFetch (string or URL inputs only). */
export function loopbackFetcher(deps: Pick<SafeFetchDeps, "fetchImpl"> = {}): typeof fetch {
  return ((input: string | URL, init?: RequestInit) => loopbackFetch(input.toString(), init ?? {}, deps)) as typeof fetch;
}
