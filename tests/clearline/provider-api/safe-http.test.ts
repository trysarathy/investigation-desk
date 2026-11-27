/**
 * v1 phase 2.2: the SSRF-safe client, against a local stand-in HTTP server (fictional host names resolved by an
 * injected resolver; loopback is allowed only through the test-only option). No external network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isLoopbackAddress, isPublicAddress } from "@/lib/clearline/provider-api/ip";
import { safeGet, SafeHttpError, isAllowlistHost, type Resolver } from "@/lib/clearline/provider-api/safe-http";

const HOST = "api.standin-provider.test";
let server: http.Server;
let port = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/ok") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); return; }
    if (req.url === "/same-host-redirect") { res.writeHead(302, { location: "/ok" }); res.end(); return; }
    if (req.url === "/other-host-redirect") { res.writeHead(302, { location: `http://other.standin-provider.test:${port}/ok` }); res.end(); return; }
    if (req.url === "/metadata-redirect") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); return; }
    if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
    if (req.url === "/big") { res.writeHead(200); res.end("x".repeat(4096)); return; }
    if (req.url === "/slow") { setTimeout(() => { res.writeHead(200); res.end("late"); }, 2000); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });

const resolver = (map: Record<string, string[]>): Resolver => async (h) => {
  const a = map[h];
  if (!a) throw new Error("ENOTFOUND");
  return a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
const local = resolver({ [HOST]: ["127.0.0.1"], "other.standin-provider.test": ["127.0.0.1"] });
const opts = { allowedHosts: [HOST], testLoopback: true, resolver: local };
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof SafeHttpError) return e.code; throw e; }
  return "ok";
}

describe("address classification", () => {
  it("refuses every non-public range, IPv4 and IPv6, including IPv4 inside IPv6", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "198.18.0.1", "192.0.2.10", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "2001::1", "2001:db8::1", "::127.0.0.1", "not-an-ip", "1.2.3"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.215.14", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });

  it("an allowlist entry is an exact host name, never an IP address or a pattern", () => {
    expect(isAllowlistHost("api.provider.example")).toBe(true);
    for (const h of ["127.0.0.1", "*.provider.example", "API.provider.example", "provider.example:443", "", "a..b", "[::1]"]) expect(isAllowlistHost(h), h).toBe(false);
  });
});

describe("safeGet", () => {
  it("reads an allowlisted host through the stand-in", async () => {
    const r = await safeGet({ url: `http://${HOST}:${port}/ok` }, opts);
    expect(r.status).toBe(200);
    expect(new TextDecoder().decode(r.body)).toBe('{"ok":true}');
  });

  it("refuses a host off the allowlist, a non-https scheme without the test option, and credentials in the URL", async () => {
    expect(await code(safeGet({ url: `http://other.standin-provider.test:${port}/ok` }, opts))).toBe("host_not_allowed");
    expect(await code(safeGet({ url: `http://${HOST}:${port}/ok` }, { allowedHosts: [HOST], resolver: local }))).toBe("scheme_refused");
    expect(await code(safeGet({ url: `file:///etc/passwd` }, opts))).toBe("scheme_refused");
    expect(await code(safeGet({ url: `http://user:pw@${HOST}:${port}/ok` }, opts))).toBe("url_invalid");
  });

  it("refuses an allowlisted host that resolves to a private, link-local or loopback address (DNS rebinding included)", async () => {
    for (const ip of ["10.0.0.5", "169.254.169.254", "192.168.0.10", "::ffff:10.0.0.5", "fd00::1"]) {
      expect(await code(safeGet({ url: `http://${HOST}:${port}/ok` }, { ...opts, resolver: resolver({ [HOST]: [ip] }) })), ip).toBe("address_refused");
    }
    // one bad address in the answer refuses the whole answer
    expect(await code(safeGet({ url: `http://${HOST}:${port}/ok` }, { ...opts, resolver: resolver({ [HOST]: ["127.0.0.1", "10.0.0.5"] }) }))).toBe("address_refused");
    // without the test option, even loopback is refused (https with a loopback answer)
    expect(await code(safeGet({ url: `https://${HOST}:${port}/ok` }, { allowedHosts: [HOST], resolver: local }))).toBe("address_refused");
    expect(await code(safeGet({ url: `https://unknown.standin-provider.test/ok` }, { allowedHosts: ["unknown.standin-provider.test"], resolver: local }))).toBe("dns_failed");
  });

  it("follows a same-origin redirect only; a redirect to another host or to the metadata address is refused", async () => {
    expect((await safeGet({ url: `http://${HOST}:${port}/same-host-redirect` }, opts)).status).toBe(200);
    const before = hits.length;
    expect(await code(safeGet({ url: `http://${HOST}:${port}/other-host-redirect` }, { ...opts, allowedHosts: [HOST, "other.standin-provider.test"] }))).toBe("redirect_refused");
    expect(await code(safeGet({ url: `http://${HOST}:${port}/metadata-redirect` }, opts))).toBe("redirect_refused");
    expect(hits.slice(before)).toEqual(["/other-host-redirect", "/metadata-redirect"]); // the other host was never called
    expect(await code(safeGet({ url: `http://${HOST}:${port}/loop` }, opts))).toBe("too_many_redirects");
  });

  it("cuts off an oversized response and times out a slow one", async () => {
    expect(await code(safeGet({ url: `http://${HOST}:${port}/big` }, { ...opts, maxResponseBytes: 1024 }))).toBe("response_too_large");
    expect(await code(safeGet({ url: `http://${HOST}:${port}/slow` }, { ...opts, timeoutMs: 200 }))).toBe("timeout");
  });

  it("the test-only loopback option is refused in production", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try { expect(await code(safeGet({ url: `http://${HOST}:${port}/ok` }, opts))).toBe("scheme_refused"); } finally { (process.env as Record<string, string | undefined>).NODE_ENV = prev; }
  });
});
