// Weeks 2–3 "done when": real public USDT transfers return the correct verdict. The recorded
// TronGrid, Etherscan V2 and public-RPC responses replay through the real fetchers, offline and keyless.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/chain/http";
import { fetchFacts } from "@/lib/chain/investigate";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { LIVE_CASES, liveSettings, liveWorkspace } from "./fixtures/live/cases";
import { replayTransport, type Recording } from "./fixtures/live/replay";

const load = (name: string): Recording =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", "live", `${name}.json`), "utf8"));

async function replay(name: string) {
  const c = LIVE_CASES.find((x) => x.name === name)!;
  const rec = load(name);
  const transport = replayTransport(rec);
  const store = new MemoryStore();
  const now = () => new Date(rec.recordedAt);
  const deps = buildFetchers({ tronKey: "test-key", etherscanKey: "test-key", store, transport, now, sleep: async () => {}, noSpacing: true });
  const settings = liveSettings(c);
  const facts = await fetchFacts(c.hash, liveWorkspace(c), deps, settings);
  return { c, rec, facts, store, settings, v: investigate(facts, settings) };
}

describe.each(LIVE_CASES.map((c) => c.name))("live fixture %s", (name) => {
  it("returns the expected verdict", async () => {
    const { c, v } = await replay(name);
    expect(v.state).toBe(c.expected.state);
    if (c.expected.code) {
      expect(v.code).toBe(c.expected.code);
      expect(v.confidence).toBe(c.expected.confidence);
    }
  });

  it("keeps every raw response with fetch time and SHA-256, and stores it", async () => {
    const { rec, facts, store } = await replay(name);
    // A rate-limited reply is retried, not kept as a fact; every other exchange is.
    const facts_ = rec.exchanges.filter((e) => !/rate limit/i.test(e.response.body));
    expect(facts.rawResponses).toHaveLength(facts_.length);
    for (const r of facts.rawResponses!) {
      expect(r.sha256).toBe(sha256Hex(r.body));
      expect(r.fetchedAt).toBe(new Date(rec.recordedAt).toISOString());
      expect(r.request.url).not.toContain("test-key");
    }
    expect(store.raw).toHaveLength(facts_.length);
  });

  it("links to the explorer for the transaction", async () => {
    const { c, rec } = await replay(name);
    expect(rec.explorer).toBe(c.explorer);
    expect(c.explorer).toMatch(/^https:\/\/(tronscan\.org\/#\/transaction\/|(etherscan\.io|bscscan\.com|polygonscan\.com)\/tx\/0x)[0-9a-f]{64}$/);
  });
});

describe.each(LIVE_CASES.filter((c) => c.transfer.to).map((c) => c.name))("live facts %s", (name) => {
  it("decodes the real transfer exactly as the explorer shows it", async () => {
    const { c, facts, settings } = await replay(name);
    expect(facts.tx!.chain).toBe(c.transfer.chain);
    expect(facts.tx!.status).toBe("success");
    const t = facts.tx!.transfers.find((x) => x.to.toLowerCase() === c.transfer.to.toLowerCase())!;
    expect(t).toBeDefined();
    expect(t.from.toLowerCase()).toBe(c.transfer.from.toLowerCase());
    expect(t.amount).toBe(c.transfer.amount);
    expect(t.tokenContract.toLowerCase()).toBe(c.transfer.contract.toLowerCase());
    expect(t.tokenSymbol).toBe(c.transfer.symbol ?? "USDT");
    const threshold = (settings.confirmations as Record<string, number>)[c.transfer.chain];
    if (threshold !== undefined) expect(facts.currentBlock! - facts.tx!.blockNumber).toBeGreaterThan(threshold);
  });

  it("checks every rule D01–D07 on live data without a missing fact", async () => {
    const { v } = await replay(name);
    for (const code of ["D01", "D02", "D03", "D05", "D06"]) {
      expect(v.checks.find((x) => x.code === code)!.matched, code).toBe(false);
    }
    expect(v.checks.every((x) => !/unknown/i.test(x.reason))).toBe(true);
  });
});

const hostOf = (url: string) => new URL(url).host;

describe("data source per chain (week 3)", () => {
  it("Tron on TronGrid; Ethereum, Polygon, Arbitrum on Etherscan; BNB Chain, Base, Optimism on public RPCs", async () => {
    const { facts } = await replay("unknown-hash-not-found");
    const byChain = new Map<string, Set<string>>();
    for (const r of facts.rawResponses!) byChain.set(r.chain, new Set([...(byChain.get(r.chain) ?? []), hostOf(r.request.url)]));
    expect([...byChain.get("tron")!]).toEqual(["api.trongrid.io"]);
    for (const c of ["ethereum", "polygon", "arbitrum"]) expect([...byChain.get(c)!]).toEqual(["api.etherscan.io"]);
    expect([...byChain.get("bsc")!]).toEqual(["bsc-dataseed.bnbchain.org"]);
    expect([...byChain.get("base")!]).toEqual(["mainnet.base.org"]);
    expect([...byChain.get("optimism")!]).toEqual(["mainnet.optimism.io"]);
  });
});

describe("real Etherscan rate limit, recorded", () => {
  it("was retried with backoff and the lookup still succeeded", async () => {
    const rec = load("tron-frozen-sender");
    const limited = rec.exchanges.filter((e) => /Max calls per sec rate limit reached/.test(e.response.body));
    expect(limited.length).toBeGreaterThan(0);
    const { facts } = await replay("tron-frozen-sender");
    expect(facts.lookups.find((l) => l.chain === "ethereum")!.result).toBe("not_found");
  });
});

describe("D01 with every chain answering", () => {
  it("fires for a hash found nowhere", async () => {
    const { facts, v } = await replay("unknown-hash-not-found");
    expect(facts.lookups.every((l) => l.result === "not_found")).toBe(true);
    expect(facts.lookups).toHaveLength(7);
    expect(v.code).toBe("D01");
    expect(v.confidence).toBe("High");
  });

  it.each(["bsc-dataseed.bnbchain.org", "mainnet.optimism.io", "api.etherscan.io", "api.trongrid.io"])(
    "still pauses if %s errors", async (host) => {
      const c = LIVE_CASES.find((x) => x.name === "unknown-hash-not-found")!;
      const rec = load(c.name);
      const inner = replayTransport(rec);
      const transport = async (req: Parameters<typeof inner>[0]) =>
        hostOf(req.url) === host ? { status: 503, headers: {}, body: "" } : inner(req);
      const deps = buildFetchers({ tronKey: "k", etherscanKey: "k", store: new MemoryStore(), transport,
        now: () => new Date(rec.recordedAt), sleep: async () => {}, noSpacing: true });
      const facts = await fetchFacts(c.hash, liveWorkspace(c), deps, liveSettings(c));
      const v = investigate(facts, liveSettings(c));
      expect(facts.lookups.some((l) => l.result === "error")).toBe(true);
      expect(v.state).toBe("paused");
    });
});

describe("week 3 rules on live data", () => {
  it("D09: Tron USDT isBlackListed(sender) is true, read-only", async () => {
    const { facts, v } = await replay("tron-frozen-sender");
    expect(facts.freezeStatus).toBe("checked");
    expect(facts.freezes).toEqual([
      expect.objectContaining({ role: "sender", address: "TLGgXMMm2qMDQHXrt5pnGEBHCoK5QG5n9T", method: "isBlackListed", frozen: true }),
      expect.objectContaining({ role: "deposit", frozen: false }),
    ]);
    expect(v.code).toBe("D09");
    const calls = facts.rawResponses!.filter((r) => r.request.body?.includes("isBlackListed"));
    expect(calls).toHaveLength(2);
  });

  it("D09 checks run on Ethereum USDT too, and find no freeze on Binance 14", async () => {
    const { facts } = await replay("eth-binance14-to-tether-treasury");
    expect(facts.freezeStatus).toBe("checked");
    expect(facts.freezes.map((f) => f.frozen)).toEqual([false, false]);
  });

  it("BNB Chain: D09 is a known gap that does not block D12, and the case shows it", async () => {
    const { facts, v } = await replay("bsc-binance-hot16-withdrawal");
    expect(facts.freezeStatus).toBe("not_supported");
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("High");
    expect(v.checks.find((c) => c.code === "D09")!.reason).toMatch(/no issuer freeze function \(known gap/);
    expect(v.evidence.find((e) => e.id === "ev.freeze")!.value).toMatch(/Not available on BNB Chain/);
    // No freeze call is even attempted against the Binance-bridged token.
    expect(facts.rawResponses!.some((r) => r.request.body?.includes("0xe47d6060"))).toBe(false);
  });

  it("BNB Chain: the token row labels the company-accepted contract", async () => {
    const { v } = await replay("bsc-binance-hot16-withdrawal");
    const token = v.evidence.find((e) => e.id === "ev.token")!;
    expect(token.value).toBe("USDT at the company-accepted contract (bridged by Binance, not issued by Tether or Circle)");
    expect(token.mono!.map((m) => m.label)).toEqual(["Received", "Company-accepted"]);
  });

  it("BNB Chain: D06 compares against the company-declared contract", async () => {
    const { facts, settings } = await replay("bsc-binance-hot16-withdrawal");
    const fake = { ...facts, tx: { ...facts.tx!, transfers: facts.tx!.transfers.map((t) => ({ ...t, tokenContract: "0x" + "1".repeat(40) })) } };
    const v = investigate(fake, settings);
    expect(v.code).toBe("D06");
    expect(v.checks.find((c) => c.code === "D06")!.reason).toMatch(/company-accepted contract \(bridged by Binance/);
    expect(v.evidence.find((e) => e.id === "ev.token")!.value).toMatch(/not the company-accepted contract/);
  });

  it("BNB Chain: with no declared contract, D06 can't run and the token is unsupported (D05)", async () => {
    const { facts } = await replay("bsc-binance-hot16-withdrawal");
    const noBsc = { ...SAMPLE_SETTINGS, acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, bsc: [] } };
    const v = investigate(facts, noBsc);
    expect(v.code).toBe("D05");
    expect(v.checks.find((c) => c.code === "D06")!.reason).toMatch(/No company-declared USDT contract/);
  });

  it("BNB Chain: the sample settings declare BSC-USD, labelled as a sample setting", async () => {
    const { facts } = await replay("bsc-binance-hot16-withdrawal");
    const v = investigate(facts, SAMPLE_SETTINGS);
    expect(v.code).not.toBe("D05");
    expect(v.evidence.find((e) => e.id === "ev.token")!.value)
      .toBe("USDT at the company-accepted contract (bridged by Binance, not issued by Tether or Circle) (sample setting)");
  });

  it("BNB Chain: an officialContracts entry is ignored; only the company's Settings count", async () => {
    const { facts } = await replay("bsc-binance-hot16-withdrawal");
    const hardCoded = { ...SAMPLE_SETTINGS, acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, bsc: [] },
      officialContracts: { ...SAMPLE_SETTINGS.officialContracts, bsc: { USDT: "0x55d398326f99059ff775485246999027b3197955" } } };
    expect(investigate(facts, hardCoded).code).toBe("D05");
  });

  it("D08: a real 14.49 USDT BNB Chain transfer under a 20 USDT minimum", async () => {
    const { v } = await replay("bsc-binance-hot11-below-minimum");
    expect(v.code).toBe("D08");
    expect(v.evidence.find((e) => e.id === "ev.amount")!.value).toContain("minimum 20");
  });

  it("D04: same 0x address, found on Polygon, registered only on Ethereum", async () => {
    const { facts, v } = await replay("polygon-usdt0-to-binance-hot20");
    expect(facts.tx!.chain).toBe("polygon");
    expect(v.code).toBe("D04");
    expect(v.evidence.find((e) => e.id === "ev.address")!.value).toMatch(/on Ethereum, but funds arrived on Polygon/);
  });
});
