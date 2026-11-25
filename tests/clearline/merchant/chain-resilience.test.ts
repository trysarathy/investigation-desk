/**
 * Rate limiting, retries (seeded, deterministic full-jitter backoff), Retry-After, timeouts, no retry on other 4xx,
 * and the finalised-only cache. Recorded transports only (tests/fixtures/chain-recordings/resilience.json).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY, RateLimiter, Secrets, TransportError, backoffDelay, fakeRuntime, fetchTransport, parseRetryAfter, recordedTransport, resilientRequest,
} from "@/lib/clearline/merchant/chain";
import { ethReader, guardRealFetch, scenario, txOf } from "./chain-helpers";
import { EthereumReader, MemoryChainFactCache } from "@/lib/clearline/merchant/chain";

guardRealFetch();
const TX = txOf("ethereum", "normal_transfer");

describe("backoff", () => {
  it("is full jitter in [0, min(cap, base·2^n)) and identical for the same seed", () => {
    const a = fakeRuntime({ seed: 42 }), b = fakeRuntime({ seed: 42 }), c = fakeRuntime({ seed: 43 });
    const seq = (rt: { random(): number }) => [0, 1, 2, 3, 4, 5].map((n) => backoffDelay(DEFAULT_RETRY, n, rt.random));
    const sa = seq(a);
    expect(sa).toEqual(seq(b));
    expect(sa).not.toEqual(seq(c));
    sa.forEach((d, n) => { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(Math.min(8_000, 500 * 2 ** n)); });
  });

  it("parses Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("Thu, 15 Jan 2026 10:00:05 GMT", Date.UTC(2026, 0, 15, 10))).toBe(5000);
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
  });
});

describe("retries through the reader", () => {
  it("429 then success: honours Retry-After and the read completes", async () => {
    const { reader, transport, rt } = ethReader("resilience", "rate_limited_then_success");
    const o = await reader.getTransfer(TX);
    expect(o.status).toBe("ok");
    if (o.status === "ok") expect(o.transfers[0].finalised).toBe(true);
    expect(rt.slept).toContain(2000);
    expect(transport.calls).toHaveLength(5);
  });

  it("5xx on every attempt → unavailable after exactly maxAttempts, with seeded deterministic delays", async () => {
    const run = async (seed: number) => {
      const transport = recordedTransport(scenario("resilience", "server_error_exhaustion").exchanges);
      const rt = fakeRuntime({ seed });
      const o = await new EthereumReader({ transport, runtime: rt, rpcUrl: "https://rpc.example.invalid/" }).getTransfer(TX);
      return { o, calls: transport.calls.length, slept: rt.slept };
    };
    const a = await run(5), b = await run(5);
    expect(a.o.status).toBe("unavailable");
    if (a.o.status === "unavailable") expect(a.o.reason).toMatch(/HTTP 502 after 5 attempts/);
    expect(a.calls).toBe(5);
    expect(a.slept).toHaveLength(4); // no wait after the last attempt; the limiter's burst covers 5 calls
    expect(a.slept).toEqual(b.slept);
  });

  it("timeouts on every attempt → unavailable; one timeout then success → ok", async () => {
    const t = ethReader("resilience", "timeout");
    const o = await t.reader.getTransfer(TX);
    expect(o.status).toBe("unavailable");
    if (o.status === "unavailable") expect(o.reason).toMatch(/timed out after 5 attempts/);
    const s = ethReader("resilience", "timeout_then_success");
    expect((await s.reader.getTransfer(TX)).status).toBe("ok");
  });

  it("does not retry other 4xx", async () => {
    const { reader, transport, rt } = ethReader("resilience", "client_error_not_retried");
    const o = await reader.getTransfer(TX);
    expect(o.status).toBe("unavailable");
    if (o.status === "unavailable") expect(o.reason).toMatch(/HTTP 401 \(not retried\)/);
    expect(transport.calls).toHaveLength(1);
    expect(rt.slept).toEqual([]);
  });

  it("gives up rather than wait for a Retry-After beyond the limit", async () => {
    const rt = fakeRuntime();
    const r = await resilientRequest(
      { transport: async () => ({ status: 429, headers: { "retry-after": "3600" }, body: "" }), limiter: new RateLimiter({ capacity: 10, refillPerSec: 10 }, rt), retry: DEFAULT_RETRY, rt, secrets: new Secrets([]), source: "test" },
      { url: "https://h.example.invalid/x", method: "GET", headers: {} }, "x",
    );
    expect(r).toMatchObject({ ok: false, attempts: 1 });
    expect(rt.slept).toEqual([]);
  });
});

describe("rate limiter", () => {
  it("token bucket per host: a burst of capacity, then waits at the refill rate; hosts are independent", async () => {
    const rt = fakeRuntime({ startMs: 0 });
    const lim = new RateLimiter({ capacity: 2, refillPerSec: 1 }, rt);
    for (let i = 0; i < 5; i++) await lim.acquire("a.example.invalid");
    expect(rt.now()).toBe(3000); // 2 free, then 3 more at 1/s
    await lim.acquire("b.example.invalid");
    expect(rt.now()).toBe(3000);
    expect(() => new RateLimiter({ capacity: 0, refillPerSec: 1 }, rt)).toThrow();
  });
});

describe("cache", () => {
  it("caches only finalised results: a non-final read is fetched again every time", async () => {
    const exchanges = scenario("ethereum", "not_yet_final").exchanges.map((e) => ({ ...e, repeat: true }));
    const transport = recordedTransport(exchanges);
    const cache = new MemoryChainFactCache();
    const reader = new EthereumReader({ transport, runtime: fakeRuntime(), cache, rpcUrl: "https://rpc.example.invalid/" });
    const tx = txOf("ethereum", "not_yet_final");
    await reader.getTransfer(tx); await reader.getTransfer(tx);
    expect(transport.calls).toHaveLength(6);
    expect(cache.map.size).toBe(0);
  });
});

// v1 E1: the transport runs through the SSRF-safe client; these tests allow the fictional hosts and answer DNS with a
// public documentation-free address, so only the injected fetch is ever called.
const SAFE = { policy: { name: "test", hosts: ["secret.example.invalid", "x.example.invalid"] }, lookup: async () => [{ address: "93.184.216.34", family: 4 }] };
describe("fetchTransport (injected fetch only)", () => {
  it("times out via AbortController and never echoes the URL in errors", async () => {
    const hanging: typeof fetch = (_u, init) => new Promise((_r, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted https://secret.example.invalid/KEY"), { name: "AbortError" }))));
    const t = fetchTransport({ ...SAFE, timeoutMs: 10, fetchImpl: hanging });
    const err = await t({ url: "https://secret.example.invalid/KEY", method: "GET", headers: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect(err.kind).toBe("timeout");
    expect(String(err.message)).not.toContain("KEY");
    const failing: typeof fetch = async () => { throw new TypeError("fetch failed for https://secret.example.invalid/KEY"); };
    const e2 = await fetchTransport({ ...SAFE, fetchImpl: failing })({ url: "https://secret.example.invalid/KEY", method: "GET", headers: {} }).catch((e) => e);
    expect(e2.kind).toBe("network");
    expect(String(e2.message)).not.toContain("KEY");
  });

  it("returns status, lower-cased headers and body", async () => {
    const ok: typeof fetch = async () => new Response('{"a":1}', { status: 200, headers: { "Retry-After": "1" } });
    const r = await fetchTransport({ ...SAFE, fetchImpl: ok })({ url: "https://x.example.invalid/", method: "POST", headers: {}, body: "{}" });
    expect(r).toEqual({ status: 200, headers: expect.objectContaining({ "retry-after": "1" }), body: '{"a":1}' });
  });

  it("v1 E1: refuses a host outside the policy, a private address and a redirect, without calling fetch for the first two", async () => {
    let calls = 0;
    const ok: typeof fetch = async () => { calls++; return new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }); };
    const off = await fetchTransport({ ...SAFE, fetchImpl: ok })({ url: "https://other.example.invalid/KEY", method: "GET", headers: {} }).catch((e) => e);
    expect(off).toBeInstanceOf(TransportError);
    expect(off.message).toBe("outbound request refused (HOST_NOT_ALLOWED)");
    const priv = await fetchTransport({ ...SAFE, lookup: async () => [{ address: "10.0.0.5", family: 4 }], fetchImpl: ok })({ url: "https://x.example.invalid/", method: "GET", headers: {} }).catch((e) => e);
    expect(priv.message).toBe("outbound request refused (PRIVATE_ADDRESS)");
    expect(calls).toBe(0);
    const redir = await fetchTransport({ ...SAFE, fetchImpl: ok })({ url: "https://x.example.invalid/", method: "GET", headers: {} }).catch((e) => e);
    expect(redir.message).toBe("outbound request refused (REDIRECT_REFUSED)");
    expect(calls).toBe(1);
  });
});
