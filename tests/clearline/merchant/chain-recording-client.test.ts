/**
 * rc7 phase 2: the recorded chain client the verify step uses by default. It serves recorded transfers through the
 * live readers' outcome shapes (incoming / transfer), with evidence naming the recording, finality from the
 * network's confirmations rule, look-alike contracts as facts (never transfers), and injectable outages.
 */
import { describe, expect, it } from "vitest";
import { NoChainClient, RECORDING_HOST, RecordingChainClient, recordingOf } from "@/lib/clearline/merchant/chain";
import { USDC_ETHEREUM, USDT_TRON } from "@/lib/clearline/merchant/config";
import type { ChainTransfer } from "@/lib/clearline/merchant/types";

const NOW = "2026-11-20T00:00:00.000Z";
const DEP = "TJFz1aHgM1mrcDbbRrxAK38hDjSAtdZgv8";
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const t = (over: Partial<ChainTransfer>): ChainTransfer => ({
  network: "tron", txHash: "a".repeat(64), logIndex: 0, tokenContract: USDT_TRON, claimedSymbol: "USDT", from: "TXyzFromWallet111111111111111111111", to: DEP,
  amountBaseUnits: 100_000_000n, decimals: 6, block: 70_000_000, timestamp: "2026-11-10T03:00:00.000Z", confirmations: 500, ...over,
});

describe("RecordingChainClient", () => {
  const rec = recordingOf([
    t({}),
    t({ txHash: "b".repeat(64), confirmations: 3 }), // seen, not final (TRON needs 19)
    t({ txHash: "c".repeat(64), tokenContract: "TLookAlikeContract1111111111111111", claimedSymbol: "USDT" }), // look-alike
    t({ txHash: "d".repeat(64), to: "TOtherAddress111111111111111111111" }),
    t({ network: "ethereum", txHash: `0x${"e".repeat(64)}`, logIndex: 37, tokenContract: USDT_ETH, to: "0x1111111111111111111111111111111111111111", from: "0x2222222222222222222222222222222222222222", confirmations: 40 }),
    t({ network: "ethereum", txHash: `0x${"f".repeat(64)}`, logIndex: 5, tokenContract: USDC_ETHEREUM, to: "0x1111111111111111111111111111111111111111", from: "0x2222222222222222222222222222222222222222", confirmations: 40 }),
  ]);
  const client = new RecordingChainClient(rec, { now: NOW, unavailable: [{ network: "tron", address: "TDownAddress11111111111111111111111", reason: "recorded outage" }, { network: "tron", txHash: "9".repeat(64), reason: "recorded timeout" }] });

  it("lists incoming transfers to one address in the window, with finality from the network's confirmations rule", async () => {
    const o = await client.incoming("tron", DEP, Date.parse("2026-11-01T00:00:00Z"), Date.parse(NOW));
    expect(o.status).toBe("ok");
    if (o.status !== "ok") return;
    expect(o.transfers.map((x) => [x.txHash[0], x.finalised, x.confirmations])).toEqual([["a", true, 500n], ["b", false, 3n]]);
    expect(o.nonMatching.map((x) => [x.txHash[0], x.contract, x.claimedSymbol])).toEqual([["c", "TLookAlikeContract1111111111111111", "USDT"]]);
    expect(o.transfers[0].evidence[0]).toMatchObject({ source: "recording", host: RECORDING_HOST, method: "recording/incoming", fetchedAt: NOW, blockNumber: 70_000_000n });
    // outside the window: nothing
    const before = await client.incoming("tron", DEP, Date.parse("2026-11-11T00:00:00Z"), Date.parse(NOW));
    expect(before.status === "ok" && before.transfers.length).toBe(0);
  });

  it("USDT on Ethereum is a configured token (founder decision): its transfer is a fact with its own log index", async () => {
    const o = await client.transfer("ethereum", `0x${"E".repeat(64)}`);
    expect(o.status === "ok" && o.transfers.map((x) => [x.symbol, x.logIndex, x.finalised])).toEqual([["USDT", 37, true]]);
  });

  it("a transaction that is not in the recording is not_found (a fact), an injected outage is unavailable (never 'nothing arrived')", async () => {
    expect((await client.transfer("tron", "1".repeat(64))).status).toBe("not_found");
    expect(await client.transfer("tron", "9".repeat(64))).toMatchObject({ status: "unavailable", reason: "recorded timeout" });
    expect(await client.incoming("tron", "TDownAddress11111111111111111111111", 0, Date.parse(NOW))).toMatchObject({ status: "unavailable", reason: "recorded outage" });
  });

  it("refuses anything that is not a test-mode recording; NoChainClient makes every read unavailable", async () => {
    expect(() => new RecordingChainClient({ label: "real", transfers: [] }, { now: NOW })).toThrow(/not a chain recording/);
    expect(() => new RecordingChainClient({ ...rec, transfers: [{ ...rec.transfers[0], amountBaseUnits: "-1" }] }, { now: NOW })).toThrow();
    const none = new NoChainClient();
    expect(await none.incoming()).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/No chain client is configured/) });
    expect((await none.transfer()).status).toBe("unavailable");
  });
});
