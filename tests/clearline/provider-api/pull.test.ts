/**
 * v1 phase 2.2: the generic REST pull against the local stand-in provider (fictional): cursor and page paging, exact
 * numbers, rate limits with backoff and jitter, retries, the key in one header only, budgets, configuration checks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PullConfig, PullError, backoffMs, pullRecords, recordsFile, retryAfterMs, stringifyExact } from "@/lib/clearline/provider-api";
import { STANDIN_KEY, standinConfig, standinGet, startStandIn, type StandIn } from "./standin";

let s: StandIn;
const waits: number[] = [];
const deps = () => ({ get: standinGet, sleep: async (ms: number) => { waits.push(ms); }, random: () => 0.5 });
const rec = (i: number) => `{"id":"PAY-FICT-${i}","amount":"1234.5678901234567891","fee":0.10000000000000000001,"nested":{"n":${i}}}`;

beforeAll(async () => { s = await startStandIn([1, 2, 3, 4, 5].map(rec)); });
afterAll(async () => { await s.close(); });
afterEach(() => { waits.length = 0; s.requests.length = 0; s.rateLimitNext = 0; s.failNext = 0; });

async function pullCode(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof PullError) return e.code; throw e; }
  return "ok";
}

describe("paging", () => {
  it("cursor paging reads every page in order and keeps numbers exactly as sent", async () => {
    const r = await pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, deps());
    expect(r).toMatchObject({ pages: 3, requests: 3, retries: 0, nextCursor: "c_4" });
    expect(r.records.map(stringifyExact)).toEqual([1, 2, 3, 4, 5].map(rec));
    expect(new TextDecoder().decode(recordsFile(r.records))).toContain('"fee":0.10000000000000000001');
    expect(s.requests.map((q) => q.path)).toEqual(["/v1/payments?limit=2", "/v1/payments?limit=2&cursor=c_2", "/v1/payments?limit=2&cursor=c_4"]);
  });

  it("resumes from a cursor (the last page is read again, never skipped)", async () => {
    const r = await pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, "c_4", deps());
    expect(r.records.length).toBe(1);
    expect(r.nextCursor).toBe("c_4");
  });

  it("page paging stops at the first short page", async () => {
    const r = await pullRecords(PullConfig.parse(standinConfig(s, "page")), STANDIN_KEY, null, deps());
    expect(r).toMatchObject({ pages: 3, nextCursor: null });
    expect(r.records.length).toBe(5);
    expect(s.requests.map((q) => q.path)).toEqual(["/v1/payouts?page=1&per_page=2", "/v1/payouts?page=2&per_page=2", "/v1/payouts?page=3&per_page=2"]);
  });
});

describe("rate limits, retries and failures", () => {
  it("a 429 waits at least Retry-After, a 503 backs off with jitter, then the pull completes", async () => {
    s.rateLimitNext = 1; s.failNext = 1;
    const r = await pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, deps());
    expect(r).toMatchObject({ pages: 3, retries: 2, requests: 5 });
    expect(waits).toEqual([1000, 500]); // max(Retry-After 1 s, jitter 0.5·500) then jitter 0.5·1000
  });

  it("gives up after maxRetries with a code (rate_limited / provider_error)", async () => {
    s.rateLimitNext = 10;
    expect(await pullCode(pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, deps()))).toBe("rate_limited");
    s.rateLimitNext = 0; s.failNext = 10;
    expect(await pullCode(pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, deps()))).toBe("provider_error");
  });

  it("a wrong key is unauthorised and never retried; the key travels in the Authorization header only", async () => {
    expect(await pullCode(pullRecords(PullConfig.parse(standinConfig(s)), "fictional-wrong-key-000000", null, deps()))).toBe("unauthorised");
    expect(s.requests.length).toBe(1);
    expect(s.requests[0].path).not.toContain("key");
    const err = await pullRecords(PullConfig.parse(standinConfig(s)), "fictional-wrong-key-000000", null, deps()).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("fictional-wrong-key");
  });

  it("budgets: pages, records and the deadline", async () => {
    expect(await pullCode(pullRecords(PullConfig.parse({ ...standinConfig(s), maxPages: 2 }), STANDIN_KEY, null, deps()))).toBe("too_many_pages");
    expect(await pullCode(pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, { ...deps(), maxRecords: 3 }))).toBe("too_many_records");
    let t = 0;
    expect(await pullCode(pullRecords(PullConfig.parse(standinConfig(s)), STANDIN_KEY, null, { ...deps(), now: () => (t += 60_000), deadlineMs: 100_000 }))).toBe("deadline");
  });

  it("an SSRF refusal is not retried and surfaces as its code", async () => {
    const bad = { get: standinGet, sleep: deps().sleep, random: () => 0.5 };
    const cfg = PullConfig.parse(standinConfig(s));
    expect(await pullCode(pullRecords(cfg, STANDIN_KEY, null, { ...bad, http: { resolver: async () => [{ address: "169.254.169.254", family: 4 }] } }))).toBe("http_address_refused");
  });

  it("backoff is bounded full jitter; Retry-After is read as seconds or a date and capped", () => {
    expect(backoffMs(0, () => 0.999)).toBeLessThan(500);
    expect(backoffMs(20, () => 0.999)).toBeLessThan(30_000);
    expect(retryAfterMs("2", 0)).toBe(2000);
    expect(retryAfterMs("99999", 0)).toBe(60_000);
    expect(retryAfterMs(new Date(5000).toUTCString(), 0)).toBe(5000);
    expect(retryAfterMs("soon", 0)).toBeUndefined();
  });
});

describe("configuration", () => {
  const base = () => standinConfig(s);
  it("refuses http, a base URL off the allowlist, an IP or wildcard allowlist entry, a key in the query, and forbidden key headers", () => {
    expect(PullConfig.safeParse(base()).success).toBe(true);
    expect(PullConfig.safeParse({ ...base(), baseUrl: base().baseUrl.replace("https", "http") }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), allowedHosts: ["other.example"] }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), baseUrl: "https://10.0.0.1", allowedHosts: ["10.0.0.1"] }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), allowedHosts: ["*.standin-provider.test"] }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), baseUrl: `${base().baseUrl}/?api_key=x` }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), path: "/v1/../admin" }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), auth: { scheme: "header", header: "Host" } }).success).toBe(false);
    expect(PullConfig.safeParse({ ...base(), auth: { scheme: "header", header: "X-Api-Key" } }).success).toBe(true);
    expect(PullConfig.safeParse({ ...base(), query: { limit: "5" } }).success).toBe(false); // paging parameter
    expect(PullConfig.safeParse({ ...base(), extra: 1 }).success).toBe(false);
  });
});
