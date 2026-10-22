import { describe, expect, it, vi } from "vitest";
import { decodeAbiString, decodeAbiUint, decodeTransferCall, decodeTransferLogs, formatUnits, TRANSFER_TOPIC } from "@/lib/chain/abi";
import { etherscanClassifyBody, EvmFetcher } from "@/lib/chain/evm";
import { ChainApiError, ChainClient, sha256Hex, type HttpRequest, type HttpResponse } from "@/lib/chain/http";
import { fetchFacts } from "@/lib/chain/investigate";
import { MemoryStore } from "@/lib/chain/store";
import { TronFetcher } from "@/lib/chain/tron";

const ok = (body: string, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, headers, body });
const status = (s: number, headers: Record<string, string> = {}): HttpResponse => ({ status: s, headers, body: "" });

function client(responses: (HttpResponse | Error)[], extra: Partial<ConstructorParameters<typeof ChainClient>[0]> = {}) {
  const calls: HttpRequest[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const store = new MemoryStore();
  let t = Date.parse("2026-10-22T05:00:00Z");
  const c = new ChainClient({
    source: "etherscan",
    minIntervalMs: 0,
    store,
    secretParams: ["apikey"],
    classifyBody: etherscanClassifyBody,
    transport: async (req) => {
      calls.push(req);
      const r = queue.shift();
      if (!r) throw new Error("no more responses");
      if (r instanceof Error) throw r;
      return r;
    },
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => new Date(t),
    ...extra,
  });
  return { c, calls, sleeps, store, advance: (sec: number) => { t += sec * 1000; } };
}

const REQ = { method: "GET" as const, url: "https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_blockNumber&apikey=SECRET123" };
const OPTS = { chain: "ethereum" as const, ttlSec: 60 };

describe("ChainClient: retries and backoff", () => {
  it("retries a 429, honouring Retry-After", async () => {
    const { c, calls, sleeps } = client([status(429, { "retry-after": "2" }), ok('{"result":"0x1"}')]);
    const r = await c.request(REQ, OPTS);
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
    expect(r.body).toBe('{"result":"0x1"}');
  });

  it("retries a 403 with exponential backoff", async () => {
    const { c, calls, sleeps } = client([status(403), status(403), ok('{"result":"0x1"}')]);
    await c.request(REQ, OPTS);
    expect(calls).toHaveLength(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it("retries Etherscan's HTTP 200 rate-limit body", async () => {
    const { c, calls } = client([ok('{"status":"0","message":"NOTOK","result":"Max calls per sec rate limit reached (3/sec)"}'), ok('{"result":"0x1"}')]);
    await c.request(REQ, OPTS);
    expect(calls).toHaveLength(2);
  });

  it("retries network errors without leaking the request in the message", async () => {
    const { c } = client([new Error("ECONNRESET apikey=SECRET123"), new Error("x"), new Error("x"), new Error("x"), new Error("x")]);
    const err = await c.request(REQ, OPTS).catch((e) => e);
    expect(err).toBeInstanceOf(ChainApiError);
    expect(err.retryable).toBe(true);
    expect(String(err.message)).not.toContain("SECRET123");
  });

  it("gives up after 4 retries with a retryable error", async () => {
    const { c, calls } = client(Array(5).fill(status(429)));
    const err = await c.request(REQ, OPTS).catch((e) => e);
    expect(calls).toHaveLength(5);
    expect(err.retryable).toBe(true);
  });

  it("does not retry a hard error, and keeps its raw response", async () => {
    const { c, calls, store } = client([ok('{"status":"0","message":"NOTOK","result":"Free API access is not supported for this chain."}')]);
    const err = await c.request(REQ, OPTS).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(err.retryable).toBe(false);
    expect(err.raw.body).toContain("Free API access");
    expect(store.raw).toHaveLength(1);
  });
});

describe("ChainClient: storage, hashing, redaction, cache", () => {
  it("stores the raw response with fetch time and SHA-256, key redacted", async () => {
    const { c, store } = client([ok('{"result":"0x10"}')]);
    const r = await c.request(REQ, OPTS);
    expect(r.sha256).toBe(sha256Hex('{"result":"0x10"}'));
    expect(r.fetchedAt).toBe("2026-10-22T05:00:00.000Z");
    expect(r.request.url).toContain("apikey=REDACTED");
    expect(JSON.stringify(store.raw)).not.toContain("SECRET123");
  });

  it("serves a cached copy inside its TTL, keeping the original fetch time and hash", async () => {
    const { c, calls, advance } = client([ok('{"result":"0x10"}'), ok('{"result":"0x11"}')]);
    const a = await c.request(REQ, OPTS);
    advance(30);
    const b = await c.request(REQ, OPTS);
    expect(calls).toHaveLength(1);
    expect(b.cached).toBe(true);
    expect(b.fetchedAt).toBe(a.fetchedAt);
    expect(b.sha256).toBe(a.sha256);
    advance(31);
    const d = await c.request(REQ, OPTS);
    expect(calls).toHaveLength(2);
    expect(d.body).toBe('{"result":"0x11"}');
  });

  it("does not cache when TTL is 0, and the TTL can depend on the response", async () => {
    const { c, calls } = client([ok('{"result":null}'), ok('{"result":null}')]);
    await c.request(REQ, { chain: "ethereum", ttlSec: 60, ttlFor: () => 0 });
    await c.request(REQ, { chain: "ethereum", ttlSec: 60, ttlFor: () => 0 });
    expect(calls).toHaveLength(2);
  });

  it("spaces requests to respect the rate limit", async () => {
    const { c, sleeps } = client([ok("{}"), ok("{}"), ok("{}")], { minIntervalMs: 350 });
    await c.request({ ...REQ, url: `${REQ.url}&a=1` }, { ...OPTS, ttlSec: 0 });
    await c.request({ ...REQ, url: `${REQ.url}&a=2` }, { ...OPTS, ttlSec: 0 });
    await c.request({ ...REQ, url: `${REQ.url}&a=3` }, { ...OPTS, ttlSec: 0 });
    expect(sleeps).toEqual([350, 700]);
  });
});

describe("fetchers", () => {
  it("refuse to start without a key from the environment", () => {
    const { c } = client([]);
    expect(() => new TronFetcher(c, "")).toThrow(/TRONGRID_API_KEY/);
    expect(() => new EvmFetcher(c, "")).toThrow(/ETHERSCAN_API_KEY/);
  });

  it("a chain that fails mid-lookup becomes an error lookup, so the case pauses", async () => {
    const tron = { lookup: vi.fn().mockRejectedValue(new ChainApiError("trongrid HTTP 403", true, 403)) } as unknown as TronFetcher;
    const evm = { lookup: vi.fn().mockResolvedValue({ lookup: { chain: "ethereum", result: "not_found", fetchedAt: "", sourceUrl: "", rawBody: "" } }) } as unknown as EvmFetcher;
    const facts = await fetchFacts("ab".repeat(32), { depositAddresses: [], ledger: [], ledgerUploadedAt: "" }, { tron, evm });
    expect(facts.lookups.find((l) => l.chain === "tron")).toMatchObject({ result: "error", error: "trongrid HTTP 403" });
  });

  it("only hashes are looked up live in week 2", async () => {
    const tron = { lookup: vi.fn() } as unknown as TronFetcher;
    const evm = { lookup: vi.fn() } as unknown as EvmFetcher;
    const facts = await fetchFacts("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", { depositAddresses: [], ledger: [], ledgerUploadedAt: "" }, { tron, evm });
    expect(facts.lookups).toEqual([]);
    expect(tron.lookup).not.toHaveBeenCalled();
  });
});

describe("ABI decoding", () => {
  it("formats token units as plain decimals", () => {
    expect(formatUnits(49975000000000n, 6)).toBe("49975000.000000");
    expect(formatUnits(5n, 6)).toBe("0.000005");
    expect(formatUnits(7n, 0)).toBe("7");
  });

  it("decodes string and bytes32 symbols, and decimals", () => {
    const str = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("USDT").toString("hex").padEnd(64, "0");
    expect(decodeAbiString(str)).toBe("USDT");
    expect(decodeAbiString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0"))).toBe("MKR");
    expect(decodeAbiUint("0x" + "6".padStart(64, "0"))).toBe(6);
  });

  it("decodes Transfer logs and transfer() call data", () => {
    const from = "e96051e8da2f0cc02c372252dfacfdb129b5d4d6";
    const to = "66426c7ac3d98b29191063833345b6bc540d7278";
    const [t] = decodeTransferLogs([{ address: "a614f803b6fd780986a42c78ec9c7f77e6ded13c", index: 0,
      topics: [TRANSFER_TOPIC, from.padStart(64, "0"), to.padStart(64, "0")], data: (49975000000000).toString(16).padStart(64, "0") }]);
    expect(t).toMatchObject({ fromHex: from, toHex: to, value: 49975000000000n, contractHex: "a614f803b6fd780986a42c78ec9c7f77e6ded13c" });
    expect(decodeTransferCall("a9059cbb" + to.padStart(64, "0") + (300n * 10n ** 6n).toString(16).padStart(64, "0")))
      .toEqual({ toHex: to, value: 300000000n });
  });

  it("ignores logs that are not Transfer events", () => {
    expect(decodeTransferLogs([{ address: "aa", index: 0, topics: ["0x1234"], data: "0x" }])).toEqual([]);
  });
});
