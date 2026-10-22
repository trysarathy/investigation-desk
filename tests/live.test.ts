// Week 2 "done when": real public USDT transfers return the correct verdict. The recorded
// TronGrid and Etherscan V2 responses replay through the real fetchers, offline and keyless.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { etherscanClassifyBody, EvmFetcher } from "@/lib/chain/evm";
import { ChainClient, sha256Hex } from "@/lib/chain/http";
import { fetchFacts } from "@/lib/chain/investigate";
import { MemoryStore } from "@/lib/chain/store";
import { tronClassifyBody, TronFetcher } from "@/lib/chain/tron";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { LIVE_CASES, liveWorkspace } from "./fixtures/live/cases";
import { replayTransport, type Recording } from "./fixtures/live/replay";

const load = (name: string): Recording =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", "live", `${name}.json`), "utf8"));

async function replay(name: string) {
  const c = LIVE_CASES.find((x) => x.name === name)!;
  const rec = load(name);
  const transport = replayTransport(rec);
  const store = new MemoryStore();
  const now = () => new Date(rec.recordedAt);
  const sleep = async () => {};
  const deps = {
    tron: new TronFetcher(new ChainClient({ source: "trongrid", minIntervalMs: 0, store, transport, now, sleep, classifyBody: tronClassifyBody }), "test-key"),
    evm: new EvmFetcher(new ChainClient({ source: "etherscan", minIntervalMs: 0, store, transport, now, sleep,
      secretParams: ["apikey"], classifyBody: etherscanClassifyBody }), "test-key"),
    now,
  };
  const facts = await fetchFacts(c.hash, liveWorkspace(c), deps);
  return { c, rec, facts, store, v: investigate(facts, SAMPLE_SETTINGS) };
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
    expect(facts.rawResponses).toHaveLength(rec.exchanges.length);
    for (const r of facts.rawResponses!) {
      expect(r.sha256).toBe(sha256Hex(r.body));
      expect(r.fetchedAt).toBe(new Date(rec.recordedAt).toISOString());
      expect(r.request.url).not.toContain("test-key");
    }
    expect(store.raw).toHaveLength(rec.exchanges.length);
  });

  it("links to the explorer for the transaction", async () => {
    const { c, rec } = await replay(name);
    expect(rec.explorer).toBe(c.explorer);
    expect(c.explorer).toMatch(/^https:\/\/(tronscan\.org\/#\/transaction\/|etherscan\.io\/tx\/0x)[0-9a-f]{64}$/);
  });
});

describe.each(LIVE_CASES.filter((c) => c.expected.state === "verdict").map((c) => c.name))("live facts %s", (name) => {
  it("decodes the real transfer exactly as the explorer shows it", async () => {
    const { c, facts } = await replay(name);
    expect(facts.tx!.chain).toBe(c.transfer.chain);
    expect(facts.tx!.status).toBe("success");
    const t = facts.tx!.transfers.find((x) => x.to.toLowerCase() === c.transfer.to.toLowerCase())!;
    expect(t).toBeDefined();
    expect(t.from.toLowerCase()).toBe(c.transfer.from.toLowerCase());
    expect(t.amount).toBe(c.transfer.amount);
    expect(t.tokenContract.toLowerCase()).toBe(c.transfer.contract.toLowerCase());
    expect(t.tokenSymbol).toBe("USDT");
    expect(facts.currentBlock! - facts.tx!.blockNumber).toBeGreaterThan(SAMPLE_SETTINGS.confirmations[c.transfer.chain]);
  });

  it("checks every rule D01–D07 on live data without a missing fact", async () => {
    const { v } = await replay(name);
    for (const code of ["D01", "D02", "D03", "D05", "D06"]) {
      expect(v.checks.find((x) => x.code === code)!.matched, code).toBe(false);
    }
    expect(v.checks.every((x) => !/unknown/i.test(x.reason))).toBe(true);
  });
});

describe("free-plan chains", () => {
  it("BNB Chain, Base and Optimism lookups are errors, so absence is never claimed", async () => {
    const { facts, v } = await replay("unknown-hash-free-plan");
    const errors = facts.lookups.filter((l) => l.result === "error").map((l) => l.chain).sort();
    expect(errors).toEqual(["base", "bsc", "optimism"]);
    expect(facts.lookups.filter((l) => l.result === "not_found").map((l) => l.chain).sort()).toEqual(["arbitrum", "ethereum", "polygon", "tron"]);
    expect(v.state).toBe("paused");
    expect(v.checks.find((c) => c.code === "D01")).toBeUndefined();
  });
});
