// Unit tests for the rules changed by the real-data test (24 Oct 2026).

import { describe, expect, it } from "vitest";
import { BlockscoutHistory } from "@/lib/chain/evm";
import { ChainClient } from "@/lib/chain/http";
import { MemoryStore } from "@/lib/chain/store";
import { claimedSymbol, isPoisoning, looksAlike } from "@/lib/engine/context";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";

describe("claimedSymbol", () => {
  it("folds Cyrillic, accents and fullwidth into the claimed ticker", () => {
    expect(claimedSymbol("ÚЅDТ")).toBe("USDT");
    expect(claimedSymbol("ＵＳＤＴ")).toBe("USDT");
    expect(claimedSymbol("USDC")).toBe("USDC");
    expect(claimedSymbol("USDD")).toBe("USDD");
    expect(claimedSymbol("fUSDT")).toBe("FUSDT");
  });
});

describe("looksAlike (first 3 + last 4)", () => {
  it("matches the real Dec 2025 poisoning pair, not unrelated addresses", () => {
    expect(looksAlike("0xbaf4b1af7e3b560d937da0458514552b6495f8b5", "0xbaff2f13638c04b10f8119760b2d2ae86b08f8b5")).toBe(true);
    expect(looksAlike("0xbaf4b1af7e3b560d937da0458514552b6495f8b5", "0xbaf4b1af7e3b560d937da0458514552b6495f8b5")).toBe(false);
    expect(looksAlike("0xbaf4b1af7e3b560d937da0458514552b6495f8b5", "0xbb04b1af7e3b560d937da0458514552b6495f8b5")).toBe(false);
  });
});

describe("isPoisoning", () => {
  const payment = { logIndex: 0, tokenContract: "0xdac17f958d2ee523a2206206994597c13d831ec7", tokenSymbol: "USDT",
    from: "0xvictim", to: "0xlookalike", amount: "1000" };
  const p = (o: object) => ({ chain: "ethereum" as const, hash: "0x1", tokenSymbol: "USDT", time: "2026-01-01T00:00:00Z", ...o }) as never;
  it("dust in from the look-alike counts; a large amount doesn't", () => {
    expect(isPoisoning(p({ from: "0xlookalike", to: "0xvictim", amount: "0.005" }), payment, SAMPLE_SETTINGS)).toBe(true);
    expect(isPoisoning(p({ from: "0xlookalike", to: "0xvictim", amount: "5" }), payment, SAMPLE_SETTINGS)).toBe(false);
  });
  it("a forged transfer out counts when zero-value or in another token contract", () => {
    expect(isPoisoning(p({ from: "0xvictim", to: "0xlookalike", amount: "0", tokenContract: payment.tokenContract }), payment, SAMPLE_SETTINGS)).toBe(true);
    expect(isPoisoning(p({ from: "0xvictim", to: "0xlookalike", amount: "115.147641", tokenContract: "0x647a" }), payment, SAMPLE_SETTINGS)).toBe(true);
    expect(isPoisoning(p({ from: "0xvictim", to: "0xlookalike", amount: "50", tokenContract: payment.tokenContract }), payment, SAMPLE_SETTINGS)).toBe(false);
  });
});

describe("BlockscoutHistory", () => {
  const page = (time: string, next: boolean) => JSON.stringify({ items: [{ transaction_hash: "0x1", timestamp: time, from: { hash: "0xa" }, to: { hash: "0xb" },
    total: { decimals: "6", value: "5000" }, token: { symbol: "USDT", address_hash: "0xdac" } }], next_page_params: next ? { block_number: 1 } : null });
  const client = (bodies: string[]) => new ChainClient({ source: "blockscout", minIntervalMs: 0, store: new MemoryStore(), sleep: async () => {},
    transport: async () => ({ status: 200, headers: {}, body: bodies.shift()! }) });
  const before = Date.parse("2026-06-01T00:00:00Z");
  it("returns transfers before the payment when it reaches far enough back", async () => {
    const h = new BlockscoutHistory(client([page("2026-07-01T00:00:00Z", true), page("2026-04-01T00:00:00Z", true)]));
    expect(await h.transfersOf("0xb", before, [])).toHaveLength(1);
  });
  it("throws (unknown) when 3 pages never reach before the payment", async () => {
    const later = page("2026-07-01T00:00:00Z", true);
    const h = new BlockscoutHistory(client([later, later, later]));
    await expect(h.transfersOf("0xb", before, [])).rejects.toThrow(/not fully read/);
  });
});
