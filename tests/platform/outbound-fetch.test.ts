/**
 * v1 E1 (phase 5.2): SSRF protection on every outbound fetch.
 *  1. A source scan: no server file in src/ calls or references the global fetch, or opens raw sockets / HTTP
 *     clients, outside src/lib/net/safe-fetch.ts. Browser code ("use client" files) is exempt: it runs in the
 *     visitor's browser, where the CSP's connect-src 'self' confines it to our own origin.
 *  2. Every https host literal in the outbound modules is on an outbound policy (or listed below with why it isn't).
 *  3. The safe client itself: exact host allow-list, https only, private/reserved addresses refused (IP literals and
 *     DNS answers, IPv4-mapped IPv6 included), redirects refused, errors never carrying the URL.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { checkOutbound, isPrivateAddress, loopbackFetch, OutboundRefused, policyWithUrls, safeFetch, safeFetcher, type OutboundPolicy } from "@/lib/net/safe-fetch";
import { aiPolicy, CHAIN_LEGACY_POLICY, LEDGER_CONNECT_POLICY, LEDGER_POLICY, merchantChainPolicy } from "@/lib/net/outbound-hosts";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const SAFE_CLIENT = "src/lib/net/safe-fetch.ts";
/**
 * Wave 2 integration: the two other files that may open a connection, each reviewed, with why. Neither takes a URL from
 * a request. Listing a file here is a reviewed change (approval-only).
 */
const OTHER_CLIENTS: Record<string, string> = {
  // stricter than safeFetch: the address checked is the address connected to (DNS answer checked inside the socket's
  // own lookup, no rebinding window), exact host allow-list per connection, same-origin redirects only, size limit
  "src/lib/clearline/provider-api/safe-http.ts": "the provider API's DNS-pinned SSRF-safe client (v1 phase 2.2)",
  // INSTREAM to the operator's own ClamAV daemon (a unix socket, or CLEARLINE_CLAMD_HOST/PORT); never an HTTP request
  "src/server/malware.ts": "the optional local malware scanner (v1 phase 2.1)",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs|cjs)$/.test(n) && !/\.test\.|\.spec\./.test(n) ? [p] : [];
  });
}

/** Source text without comment lines (block-comment bodies and // lines), so prose about "a live fetch" is not flagged. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join("\n");
}

const isClientFile = (text: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text);

/** Patterns that reach the network without the safe client. */
const FORBIDDEN: [RegExp, string][] = [
  [/(?<![\w.$])fetch\s*\(/, "a call to the global fetch"],
  [/globalThis\s*\.\s*fetch\b|window\s*\.\s*fetch\b|self\s*\.\s*fetch\b/, "a reference to the global fetch"],
  [/(?<![\w.$])fetch\s+as\b|[=?:,(]\s*fetch\s*[;,)]/, "the global fetch passed as a value"],
  // node:net is allowed ONLY for its address helpers (import { isIP } from "node:net"): they open nothing.
  [/^(?!\s*import\s*\{\s*(?:isIP|isIPv4|isIPv6)(?:\s*,\s*(?:isIP|isIPv4|isIPv6))*\s*\}\s*from\s*["']node:net["']).*(?:from\s+["'](?:node:)?(?:http|https|http2|net|tls|dgram)["']|require\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram)["']\s*\))/, "a raw socket / HTTP module"],
  [/from\s+["'](?:undici|axios|got|node-fetch|ky|superagent)["']/, "a third-party HTTP client"],
  [/new\s+(?:WebSocket|XMLHttpRequest|EventSource)\s*\(/, "a raw WebSocket / XHR / EventSource"],
];

describe("v1 E1: no outbound request bypasses the SSRF-safe client", () => {
  const files = walk(SRC);
  it("scans a real tree (sanity)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => path.relative(ROOT, f))).toContain(SAFE_CLIENT);
  });
  it("no server file calls or references the global fetch, a raw socket or an HTTP library outside src/lib/net/safe-fetch.ts", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      if (rel === SAFE_CLIENT || OTHER_CLIENTS[rel]) continue;
      const text = readFileSync(f, "utf8");
      if (isClientFile(text)) continue;
      const src = code(text);
      for (const [re, what] of FORBIDDEN) for (const l of src.split("\n")) if (re.test(l)) offenders.push(`${rel}: ${what}: ${l.trim().slice(0, 120)}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the scanner itself flags each forbidden shape (a scanner that matches nothing would pass vacuously)", () => {
    const samples = [
      'const r = await fetch("https://x")', "const f = globalThis.fetch;", "const g = deps.f ?? (fetch as unknown as F);", "use(fetch);",
      'import http from "node:http";', 'import { request } from "https";', 'import axios from "axios";', "new WebSocket(u)", 'import net from "node:net";', 'import { isIP, connect } from "node:net";',
    ];
    for (const s of samples) expect(FORBIDDEN.some(([re]) => re.test(code(s))), s).toBe(true);
    for (const s of ["const fetchFn = deps.fetchFn;", "await this.fetchFn(url, init)", "prefetch(x)", "// a live fetch( here", " * fetch(x) in a doc", "safeFetch(u, i, p)", 'import { isIP } from "node:net";']) {
      expect(FORBIDDEN.some(([re]) => re.test(code(s))), s).toBe(false);
    }
  });
});

describe("v1 E1: every API host the outbound modules name is on a policy", () => {
  const hostsIn = (rel: string) => [...readFileSync(path.join(ROOT, rel), "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'`?:]|$)/gi)].map((m) => m[1].toLowerCase());
  // Hosts that appear in these files but are never fetched by the server, with why.
  const NOT_FETCHED: Record<string, string> = {
    "login.xero.com": "the OAuth authorize page: the BROWSER is redirected there; the server never fetches it",
    "appcenter.intuit.com": "the QuickBooks OAuth authorize page: the BROWSER is redirected there; the server never fetches it",
    "quickbooks.api.intuit.com": "production QuickBooks: deliberately NOT allowed (QuickBooks is not offered; QBO_ENV=production is refused)",
    "developer.xero.com": "documentation link in a comment",
    "developer.intuit.com": "documentation link in a comment",
    "docs.base.org": "documentation link in a comment",
    "docs.optimism.io": "documentation link in a comment",
    "docs.etherscan.io": "documentation link in a comment",
    "developers.tron.network": "documentation link in a comment",
  };
  const cases: [string[], OutboundPolicy][] = [
    [["src/lib/chain/tron.ts", "src/lib/chain/evm.ts", "src/lib/chain/sources.ts"], CHAIN_LEGACY_POLICY],
    [["src/lib/clearline/merchant/chain/tron.ts"], merchantChainPolicy({})],
    [["src/lib/accounting/providers/xero.ts", "src/lib/accounting/providers/xero-auth.ts", "src/lib/accounting/providers/quickbooks.ts", "src/lib/accounting/ledger-pull.ts"], LEDGER_POLICY],
    [["src/lib/accounting/connect/providers.ts", "src/lib/accounting/connect/api.ts"], LEDGER_CONNECT_POLICY],
  ];
  it.each(cases.map(([f, p]) => [p.name, f, p] as const))("%s", (_n, files, policy) => {
    const missing = files.flatMap(hostsIn).filter((h) => !policy.hosts.includes(h) && !NOT_FETCHED[h]);
    expect(missing).toEqual([]);
  });
  it("the production QuickBooks host is refused even if the adapter were pointed at it", async () => {
    await expect(checkOutbound("https://quickbooks.api.intuit.com/v3/company/1/query", LEDGER_POLICY, async () => [{ address: "8.8.8.8", family: 4 }]))
      .rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
  it("wave 2: the ledger connection policy adds only Intuit's OAuth hosts; production QuickBooks stays refused", () => {
    expect(LEDGER_CONNECT_POLICY.hosts.filter((h) => !LEDGER_POLICY.hosts.includes(h))).toEqual(["oauth.platform.intuit.com", "developer.api.intuit.com"]);
    expect(LEDGER_CONNECT_POLICY.hosts).not.toContain("quickbooks.api.intuit.com");
  });
  it("operator-configured endpoints add exactly their own host", () => {
    expect(merchantChainPolicy({ ETHEREUM_RPC_URL: "https://rpc.example.org:8545/v2/KEYKEYKEY", TRONGRID_BASE_URL: "https://Tron.Example.org/" }).hosts)
      .toEqual(["api.trongrid.io", "tron.example.org", "rpc.example.org:8545"]);
    expect(aiPolicy({}).hosts).toEqual(["api.anthropic.com"]);
    expect(aiPolicy({ ANTHROPIC_BASE_URL: "not a url" }).hosts).toEqual(["api.anthropic.com"]);
  });
});

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];
const P: OutboundPolicy = { name: "t", hosts: ["api.example.org", "rpc.example.org:8545"] };

describe("v1 E1: the safe client", () => {
  it("allows only exact https hosts on the policy", async () => {
    await expect(checkOutbound("https://api.example.org/v1?x=1", P, PUBLIC)).resolves.toBeInstanceOf(URL);
    await expect(checkOutbound("https://API.example.org./v1", P, PUBLIC)).resolves.toBeInstanceOf(URL);
    await expect(checkOutbound("https://api.example.org:443/", P, PUBLIC)).resolves.toBeInstanceOf(URL);
    await expect(checkOutbound("https://rpc.example.org:8545/", P, PUBLIC)).resolves.toBeInstanceOf(URL);
    for (const [u, code] of [
      ["http://api.example.org/", "NOT_HTTPS"], ["ftp://api.example.org/", "NOT_HTTPS"], ["file:///etc/passwd", "NOT_HTTPS"],
      ["https://evil.api.example.org/", "HOST_NOT_ALLOWED"], ["https://api.example.org.evil.test/", "HOST_NOT_ALLOWED"],
      ["https://api.example.org:8443/", "HOST_NOT_ALLOWED"], ["https://rpc.example.org/", "HOST_NOT_ALLOWED"],
      ["https://user:pw@api.example.org/", "CREDENTIALS_IN_URL"], ["https://api.example.org@169.254.169.254/", "CREDENTIALS_IN_URL"],
      ["not a url", "BAD_URL"], ["https://169.254.169.254/latest/meta-data/", "HOST_NOT_ALLOWED"],
    ] as const) {
      const e = await checkOutbound(u, P, PUBLIC).catch((x) => x);
      expect(e, u).toBeInstanceOf(OutboundRefused);
      expect(e.code, u).toBe(code);
      expect(e.message, u).not.toContain("example");
    }
  });
  it("refuses an allowed name that resolves to any private or reserved address (one bad answer is enough)", async () => {
    for (const bad of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::10.0.0.1", "2001:db8::1", "ff02::1"]) {
      const e = await checkOutbound("https://api.example.org/", P, async () => [{ address: "93.184.216.34", family: 4 }, { address: bad, family: bad.includes(":") ? 6 : 4 }]).catch((x) => x);
      expect(e?.code, bad).toBe("PRIVATE_ADDRESS");
    }
    expect((await checkOutbound("https://api.example.org/", P, async () => []).catch((x) => x)).code).toBe("DNS_FAILED");
    expect((await checkOutbound("https://api.example.org/", P, async () => { throw new Error("ENOTFOUND api.example.org"); }).catch((x) => x)).code).toBe("DNS_FAILED");
  });
  it("classifies addresses (fail closed on anything unrecognised)", () => {
    for (const a of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001::200e", "172.32.0.1", "192.169.0.1", "100.128.0.1"]) expect(isPrivateAddress(a), a).toBe(false);
    for (const a of ["", "localhost", "999.1.1.1", "1.2.3", "[::1]", "fe80::1%eth0"]) expect(isPrivateAddress(a), a).toBe(true);
  });
  it("refuses IP-literal hosts in private ranges even when listed", async () => {
    const p = { name: "t", hosts: ["127.0.0.1", "[::1]", "8.8.8.8"] };
    expect((await checkOutbound("https://127.0.0.1/", p).catch((x) => x)).code).toBe("PRIVATE_ADDRESS");
    expect((await checkOutbound("https://[::1]/", p).catch((x) => x)).code).toBe("PRIVATE_ADDRESS");
    await expect(checkOutbound("https://8.8.8.8/", p)).resolves.toBeInstanceOf(URL);
  });
  it("never follows a redirect, and never calls fetch for a refused request", async () => {
    const seen: RequestInit[] = [];
    const redirecting: typeof fetch = async (_u, init) => { seen.push(init!); return new Response(null, { status: 301, headers: { location: "https://169.254.169.254/" } }); };
    const e = await safeFetch("https://api.example.org/KEY123", {}, P, { fetchImpl: redirecting, lookup: PUBLIC }).catch((x) => x);
    expect(e.code).toBe("REDIRECT_REFUSED");
    expect(String(e.message)).not.toContain("KEY123");
    expect(seen[0].redirect).toBe("manual");
    await safeFetch("https://elsewhere.example.org/", {}, P, { fetchImpl: redirecting, lookup: PUBLIC }).catch(() => undefined);
    expect(seen).toHaveLength(1);
  });
  it("a caller cannot turn redirects back on", async () => {
    const seen: RequestInit[] = [];
    const ok: typeof fetch = async (_u, init) => { seen.push(init!); return new Response("{}", { status: 200 }); };
    await safeFetch("https://api.example.org/", { redirect: "follow" }, P, { fetchImpl: ok, lookup: PUBLIC });
    expect(seen[0].redirect).toBe("manual");
  });
  it("safeFetcher accepts a string, a URL or a Request (the SDK shapes) and checks each", async () => {
    const urls: string[] = [];
    const ok: typeof fetch = async (u) => { urls.push(String(u)); return new Response("{}", { status: 200 }); };
    const f = safeFetcher(P, { fetchImpl: ok, lookup: PUBLIC });
    await f("https://api.example.org/a");
    await f(new URL("https://api.example.org/b"));
    await f(new Request("https://api.example.org/c", { method: "POST", body: "{}" }));
    expect(urls).toEqual(["https://api.example.org/a", "https://api.example.org/b", "https://api.example.org/c"]);
    await expect(f(new Request("https://169.254.169.254/"))).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
  it("policyWithUrls ignores unset and unparsable URLs", () => {
    expect(policyWithUrls("x", ["A.example.org"], [undefined, "", "::bad::"]).hosts).toEqual(["a.example.org"]);
  });
});

describe("wave 2: the loopback-only client for local stand-ins", () => {
  const ok: typeof fetch = async () => new Response("{}", { status: 200 });
  it("reaches exactly 127.0.0.1, [::1] and localhost, over http or https", async () => {
    for (const u of ["http://127.0.0.1:9000/b", "http://[::1]:9000/b", "http://localhost:9000/b", "https://127.0.0.1/b"]) {
      expect((await loopbackFetch(u, {}, { fetchImpl: ok })).status, u).toBe(200);
    }
  });
  it("refuses every other host, credentials in the URL, other schemes and redirects", async () => {
    for (const u of ["http://127.0.0.2/", "http://10.0.0.1/", "http://169.254.169.254/", "http://localhost.example.org/", "http://api.example.org/", "file:///etc/passwd", "http://u:p@127.0.0.1/"]) {
      await expect(loopbackFetch(u, {}, { fetchImpl: ok }), u).rejects.toBeInstanceOf(OutboundRefused);
    }
    const redirecting: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await expect(loopbackFetch("http://127.0.0.1/", {}, { fetchImpl: redirecting })).rejects.toMatchObject({ code: "REDIRECT_REFUSED" });
  });
});
