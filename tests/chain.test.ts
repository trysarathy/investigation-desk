import { describe, expect, it, vi } from "vitest";
import { decodeAbiString, decodeAbiUint, decodeTransferCall, decodeTransferLogs, formatUnits, TRANSFER_TOPIC } from "@/lib/chain/abi";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { EtherscanSource, etherscanClassifyBody, EvmFetcher, JsonRpcSource, jsonRpcClassifyBody } from "@/lib/chain/evm";
import { FREEZE_SELECTOR } from "@/lib/chain/investigate";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { lookAlike, tronAddress } from "@/lib/fixtures/gen";
import type { ChainTx, Facts } from "@/lib/types";
import { ChainApiError, ChainClient, sha256Hex, type HttpRequest, type HttpResponse } from "@/lib/chain/http";
import { fetchFacts } from "@/lib/chain/investigate";
import { MemoryStore } from "@/lib/chain/store";
import { TronFetcher } from "@/lib/chain/tron";
import { planFor } from "@/lib/chain/sources";

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
  it("without keys: Tron is asked keyless (no key header); Etherscan still refuses; buildFetchers routes the Etherscan chains to public RPCs", async () => {
    const { c, calls } = client([ok("{}")]);
    const tron = new TronFetcher(c, "");
    expect((await tron.lookup("ab".repeat(32), [])).lookup.result).toBe("not_found");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toMatch(/TRON-PRO-API-KEY/);
    const eth = new EtherscanSource(c, "", "ethereum");
    await expect(eth.call("eth_getTransactionByHash", ["0x" + "ab".repeat(32)], { ttlSec: 0 }, [])).rejects.toThrow(/chain lookup unavailable: key not set \(ETHERSCAN_API_KEY\)/);
    expect(planFor("ethereum", "")).toMatchObject({ kind: "public-rpc", url: "https://eth.drpc.org" });
    expect(planFor("polygon", "")).toMatchObject({ kind: "public-rpc" });
    expect(planFor("arbitrum", "")).toMatchObject({ kind: "public-rpc" });
    expect(planFor("ethereum", "k")).toEqual({ kind: "etherscan" });
  });

  it("a chain that fails mid-lookup becomes an error lookup, so the case pauses", async () => {
    const tron = { lookup: vi.fn().mockRejectedValue(new ChainApiError("trongrid HTTP 403", true, 403)) } as unknown as TronFetcher;
    const evm = { lookup: vi.fn().mockResolvedValue({ lookup: { chain: "ethereum", result: "not_found", fetchedAt: "", sourceUrl: "", rawBody: "" } }) } as unknown as EvmFetcher;
    const facts = await fetchFacts("ab".repeat(32), { depositAddresses: [], ledger: [], ledgerUploadedAt: "" }, { tron, evm }, SAMPLE_SETTINGS);
    expect(facts.lookups.find((l) => l.chain === "tron")).toMatchObject({ result: "error", error: "trongrid HTTP 403" });
  });

  it("only hashes are looked up live", async () => {
    const tron = { lookup: vi.fn() } as unknown as TronFetcher;
    const evm = { lookup: vi.fn() } as unknown as EvmFetcher;
    const facts = await fetchFacts("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", { depositAddresses: [], ledger: [], ledgerUploadedAt: "" }, { tron, evm }, SAMPLE_SETTINGS);
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

// ---- Week 3 ----

const sel = (sig: string) => `0x${bytesToHex(keccak_256(new TextEncoder().encode(sig))).slice(0, 8)}`;

describe("selectors are computed, not recalled", () => {
  it("freeze calls match keccak256 of their signatures", () => {
    expect(FREEZE_SELECTOR.USDT).toEqual({ fn: "isBlackListed", selector: sel("isBlackListed(address)") });
    expect(FREEZE_SELECTOR.USDC).toEqual({ fn: "isBlacklisted", selector: sel("isBlacklisted(address)") });
  });

  it("Transfer topic, transfer(), symbol() and decimals() match too", () => {
    expect(TRANSFER_TOPIC).toBe(bytesToHex(keccak_256(new TextEncoder().encode("Transfer(address,address,uint256)"))));
    expect(sel("transfer(address,uint256)")).toBe("0xa9059cbb");
    expect(sel("symbol()")).toBe("0x95d89b41");
    expect(sel("decimals()")).toBe("0x313ce567");
  });
});

describe("public JSON-RPC", () => {
  it("retries rate limits and treats a revert as final", () => {
    expect(jsonRpcClassifyBody('{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"limit exceeded"}}')?.retryable).toBe(true);
    expect(jsonRpcClassifyBody('{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted"}}')).toEqual({ retryable: false, message: "execution reverted" });
    expect(jsonRpcClassifyBody('{"jsonrpc":"2.0","id":1,"result":"0x1"}')).toBeUndefined();
  });

  it("sends a POST with a fixed id, so identical calls cache and replay", async () => {
    const { c, calls } = client([ok('{"jsonrpc":"2.0","id":1,"result":"0x10"}')], { classifyBody: jsonRpcClassifyBody });
    const src = new JsonRpcSource(c, "https://bsc-dataseed.bnbchain.org", "bsc");
    expect(await src.call("eth_blockNumber", [], { ttlSec: 0 }, [])).toBe("0x10");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://bsc-dataseed.bnbchain.org" });
    expect(JSON.parse(calls[0].body!)).toEqual({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  });

  it("a reverted eth_call (no such function) reads as unknown, not as a crash", async () => {
    const { c } = client([ok('{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted"}}')], { classifyBody: jsonRpcClassifyBody });
    const evm = new EvmFetcher({ bsc: new JsonRpcSource(c, "https://bsc-dataseed.bnbchain.org", "bsc") });
    const raws: Parameters<typeof evm.ethCall>[4] = [];
    expect(await evm.ethCall("bsc", "0x55d398326f99059ff775485246999027b3197955", "0xe47d6060", 60, raws)).toBeUndefined();
    expect(raws).toHaveLength(1);
  });
});

// D07b live history and freeze-failure paths, with stubbed fetchers.
describe("D07b sender history and freeze status from live facts", () => {
  const customerAddr = tronAddress("victim");
  const poison = lookAlike(customerAddr, "poisoner");
  const sender = tronAddress("victim-wallet");
  const usdtTron = SAMPLE_SETTINGS.officialContracts.tron!.USDT!;
  const workspace = {
    customerId: "C-9",
    depositAddresses: [{ row: 2, address: customerAddr, chain: "tron" as const, customerId: "C-9", assignedAt: "2024-01-01T00:00:00Z" }],
    ledger: [], ledgerUploadedAt: "2026-10-22T00:00:00Z",
  };
  const tx = (chain: ChainTx["chain"], to: string, from = sender, contract = usdtTron): ChainTx => ({
    chain, hash: "ab".repeat(32), status: "success", blockNumber: 100, blockTime: "2026-10-20T00:00:00Z", isBatch: false,
    transfers: [{ logIndex: 0, tokenContract: contract, tokenSymbol: "USDT", from, to, amount: "5000.000000" }],
  });
  const notFound = (chain: string) => ({ lookup: { chain, result: "not_found", fetchedAt: "", sourceUrl: "", rawBody: "" } });

  function deps(found: ChainTx, opts: { history?: unknown[] | Error; frozen?: boolean | undefined } = {}) {
    const tron = {
      lookup: vi.fn().mockResolvedValue(found.chain === "tron"
        ? { lookup: { chain: "tron", result: "found", fetchedAt: "", sourceUrl: "", rawBody: "" }, tx: found, currentBlock: 200 }
        : notFound("tron")),
      isBlackListed: vi.fn().mockResolvedValue("frozen" in opts ? opts.frozen : false),
      trc20From: opts.history instanceof Error ? vi.fn().mockRejectedValue(opts.history) : vi.fn().mockResolvedValue(opts.history ?? []),
    } as unknown as TronFetcher;
    const evm = {
      lookup: vi.fn().mockImplementation(async (chain: string) => (chain === found.chain
        ? { lookup: { chain, result: "found", fetchedAt: "", sourceUrl: "", rawBody: "" }, tx: found, currentBlock: 200 }
        : notFound(chain))),
      ethCall: vi.fn().mockResolvedValue(undefined),
      source: vi.fn().mockReturnValue(undefined),
    } as unknown as EvmFetcher;
    return { tron, evm };
  }

  const dust = { transaction_id: "cd".repeat(32), from: poison, to: sender, value: "0", block_timestamp: Date.parse("2026-10-19T00:00:00Z"),
    token_info: { symbol: "USDT", decimals: 6 } };

  it("on Tron, a dust transfer from the look-alike gives D07 with a D07b finding", async () => {
    const d = deps(tx("tron", poison), { history: [dust] });
    const facts = await fetchFacts("ab".repeat(32), workspace, d, SAMPLE_SETTINGS);
    expect(facts.senderHistoryStatus).toBe("checked");
    expect(d.tron.trc20From).toHaveBeenCalledWith(poison, Date.parse("2026-10-20T00:00:00Z"), expect.any(Array));
    const v = investigate(facts, SAMPLE_SETTINGS);
    expect(v.code).toBe("D07");
    expect(v.findings.map((f) => f.code)).toEqual(["D07b"]);
  });

  it("history is only fetched when the look-alike pattern could match", async () => {
    const d = deps(tx("tron", tronAddress("stranger")), { history: [dust] });
    await fetchFacts("ab".repeat(32), workspace, d, SAMPLE_SETTINGS);
    expect(d.tron.trc20From).not.toHaveBeenCalled();
  });

  it("on a public-RPC chain D07b is off and says so", async () => {
    const evmCustomer = "0x1111aaaabbbbccccddddeeeeffff000011112222";
    const evmPoison = lookAlike(evmCustomer, "p");
    const ws = { ...workspace, depositAddresses: [{ ...workspace.depositAddresses[0], address: evmCustomer, chain: "bsc" as const }] };
    const d = deps(tx("bsc", evmPoison, "0x" + "9".repeat(40), "0x" + "5".repeat(40)));
    // No BNB Chain contract declared, so the made-up token here isn't a D06 fake and D07 stands.
    const noBsc = { ...SAMPLE_SETTINGS, acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, bsc: [] } };
    const facts = await fetchFacts("ab".repeat(32), ws, d, noBsc);
    expect(facts.senderHistoryStatus).toBe("not_supported");
    const v = investigate(facts, noBsc);
    expect(v.code).toBe("D07");
    expect(v.checks.find((c) => c.code === "D07b")!.reason).toMatch(/public RPC/);
  });

  it("a failed history lookup is unknown, never 'no dust found'", async () => {
    const d = deps(tx("tron", poison), { history: new Error("503") });
    const facts = await fetchFacts("ab".repeat(32), workspace, d, SAMPLE_SETTINGS);
    expect(facts.senderHistoryStatus).toBe("failed");
    expect(investigate(facts, SAMPLE_SETTINGS).checks.find((c) => c.code === "D07b")!.reason).toMatch(/failed/);
  });

  it("a failed freeze call never lets D12 through", async () => {
    const d = deps(tx("tron", customerAddr), { frozen: undefined });
    const facts: Facts = await fetchFacts("ab".repeat(32), workspace, d, SAMPLE_SETTINGS);
    expect(facts.freezeStatus).toBe("failed");
    const v = investigate(facts, SAMPLE_SETTINGS);
    expect(v.code).not.toBe("D12");
    expect(v.checks.find((c) => c.code === "D12")!.reason).toMatch(/freeze/i);
  });

  it("a successful freeze check with no hits allows D12", async () => {
    const d = deps(tx("tron", customerAddr), { frozen: false });
    const v = investigate(await fetchFacts("ab".repeat(32), workspace, d, SAMPLE_SETTINGS), SAMPLE_SETTINGS);
    expect(v.code).toBe("D12");
  });
});
