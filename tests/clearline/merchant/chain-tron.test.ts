/**
 * TronGrid reader over SYNTHETIC recordings (tests/fixtures/chain-recordings/tron.json): decoding, identity by
 * contract, failed transactions, finality, reorg re-checks, pagination and the finalised-only cache. No network.
 */
import { describe, expect, it } from "vitest";
import { USDT_TRON } from "@/lib/clearline/merchant";
import { isTronAddress, stringifyFacts } from "@/lib/clearline/merchant/chain";
import { guardRealFetch, scenario, tronReader, txOf } from "./chain-helpers";

guardRealFetch();

const depositFromListing = () => decodeURIComponent(scenario("tron", "pagination").exchanges[0].match.path!.split("/")[3]);

describe("TronReader.getTransfer", () => {
  it("decodes a TRC-20 Transfer log, counts confirmations and finalises after an unchanged re-read", async () => {
    const { reader, transport, cache } = tronReader("normal_transfer");
    const o = await reader.getTransfer(txOf("tron", "normal_transfer"));
    expect(o.status).toBe("ok");
    if (o.status !== "ok") return;
    expect(o.transfers).toHaveLength(1);
    const t = o.transfers[0];
    expect(t).toMatchObject({ network: "tron", tokenContract: USDT_TRON, symbol: "USDT", decimals: 6, logIndex: 0, timestamp: "2026-01-15T09:00:00.000Z", finalised: true });
    expect(t.amountBaseUnits).toBe(125_000_000n);
    expect(typeof t.amountBaseUnits).toBe("bigint");
    expect(t.blockNumber).toBe(60_000_000n);
    expect(t.confirmations).toBe(51n); // 60,000,050 − 60,000,000 + 1
    expect(isTronAddress(t.from) && isTronAddress(t.to)).toBe(true);
    expect(t.to).toBe(depositFromListing());
    // Evidence: host only, endpoint names, clock time, block and confirmations.
    expect(t.evidence.map((e) => e.method)).toEqual(["wallet/gettransactioninfobyid", "wallet/getnowblock", "wallet/gettransactioninfobyid"]);
    for (const e of t.evidence) expect(e).toMatchObject({ source: "trongrid", host: "api.trongrid.io", fetchedAt: "2026-01-15T10:00:00.000Z" });
    expect(t.evidence[0]).toMatchObject({ blockNumber: 60_000_000n, confirmationsAtFetch: 51n });
    // The key went in the header only, never into evidence.
    expect(transport.calls[0].headers["TRON-PRO-API-KEY"]).toBe("test-placeholder-key");
    expect(stringifyFacts(o)).not.toContain("test-placeholder-key");
    expect(transport.calls.map((c) => c.method + " " + new URL(c.url).pathname)).toEqual([
      "POST /wallet/gettransactioninfobyid", "POST /wallet/getnowblock", "POST /wallet/gettransactioninfobyid",
    ]);
    expect(transport.unmatched).toEqual([]);
    // Finalised → cached → a second read makes no request.
    expect(cache.map.size).toBe(1);
    const again = await reader.getTransfer(txOf("tron", "normal_transfer"));
    expect(again).toEqual(o);
    expect(transport.calls).toHaveLength(3);
  });

  it("ignores a Transfer log from a look-alike contract and reports it as a non-matching fact", async () => {
    const { reader } = tronReader("lookalike_contract");
    const o = await reader.getTransfer(txOf("tron", "lookalike_contract"));
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers.map((t) => [t.tokenContract, t.amountBaseUnits, t.logIndex])).toEqual([[USDT_TRON, 1_000_000n, 1]]);
    expect(o.nonMatching).toHaveLength(1);
    expect(o.nonMatching[0]).toMatchObject({ network: "tron", logIndex: 0, rawAmount: 500_000_000n });
    expect(o.nonMatching[0].contract).not.toBe(USDT_TRON);
    expect(isTronAddress(o.nonMatching[0].contract)).toBe(true);
  });

  it("never treats a failed transaction (receipt REVERT) as a transfer", async () => {
    const { reader, cache } = tronReader("failed_transaction");
    const o = await reader.getTransfer(txOf("tron", "failed_transaction"));
    expect(o.status).toBe("failed_transaction");
    expect("transfers" in o).toBe(false);
    expect(cache.map.size).toBe(0);
  });

  it("reports a transfer below 19 confirmations as not final, without a re-check, and does not cache it", async () => {
    const { reader, transport, cache } = tronReader("not_yet_final");
    const id = txOf("tron", "not_yet_final");
    const o = await reader.getTransfer(id);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].confirmations).toBe(11n);
    expect(o.transfers[0].finalised).toBe(false);
    expect(transport.calls).toHaveLength(2);
    expect(cache.map.size).toBe(0);
  });

  it("reports reorged (not final) when the re-check finds the transaction in a different block", async () => {
    const { reader, cache } = tronReader("reorg_between_reads");
    const o = await reader.getTransfer(txOf("tron", "reorg_between_reads"));
    expect(o.status).toBe("reorged");
    if (o.status !== "reorged") return;
    expect(o.currentBlock).toBe(60_000_003n);
    expect(o.transfers.every((t) => !t.finalised)).toBe(true);
    expect(cache.map.size).toBe(0);
  });

  it("reports reorged when the transaction vanishes between reads", async () => {
    const { reader } = tronReader("reorg_vanished");
    const o = await reader.getTransfer(txOf("tron", "reorg_vanished"));
    expect(o.status).toBe("reorged");
    if (o.status === "reorged") expect(o.currentBlock).toBeUndefined();
  });

  it("returns not_found for an unknown id and for a malformed one (no request)", async () => {
    const { reader, transport } = tronReader("unknown_transaction");
    expect((await reader.getTransfer(txOf("tron", "unknown_transaction"))).status).toBe("not_found");
    expect((await reader.getTransfer("xyz")).status).toBe("not_found");
    expect(transport.calls).toHaveLength(1);
  });
});

describe("TronReader.listIncoming", () => {
  it("follows the fingerprint across pages, verifies each candidate by receipt, and reports the look-alike", async () => {
    const { reader, transport } = tronReader("pagination");
    const from = Date.UTC(2026, 0, 15, 9), to = Date.UTC(2026, 0, 15, 10);
    const o = await reader.listIncoming(depositFromListing(), from, to);
    if (o.status !== "ok") throw new Error(o.reason);
    expect(o.transfers.map((t) => [t.amountBaseUnits, t.confirmations, t.finalised])).toEqual([
      [10_000_000n, 45n, true], [20_000_000n, 44n, true], [30_000_000n, 16n, false],
    ]);
    expect(o.unresolved).toEqual([]);
    expect(o.nonMatching).toHaveLength(1);
    expect(o.nonMatching[0]).toMatchObject({ claimedSymbol: "USDT", claimedDecimals: 6, rawAmount: 500_000_000n });
    expect(o.nonMatching[0].contract).not.toBe(USDT_TRON);
    const lists = transport.calls.filter((c) => c.method === "GET").map((c) => new URL(c.url));
    expect(lists).toHaveLength(2);
    expect(lists[0].searchParams.get("only_to")).toBe("true");
    expect(lists[0].searchParams.get("contract_address")).toBe(USDT_TRON);
    expect(lists[0].searchParams.get("min_timestamp")).toBe(String(from));
    expect(lists[0].searchParams.get("max_timestamp")).toBe(String(to));
    expect(lists[0].searchParams.get("limit")).toBe("200");
    expect(lists[0].searchParams.get("order_by")).toBe("block_timestamp,asc");
    expect(lists[0].searchParams.has("fingerprint")).toBe(false);
    expect(lists[1].searchParams.get("fingerprint")).toBe("fp-fictional-page-2");
    expect(transport.unmatched).toEqual([]);
  });

  it("is unavailable (not empty) when the page limit is hit or the address is invalid", async () => {
    const { reader } = tronReader("pagination", { maxPages: 1 });
    const o = await reader.listIncoming(depositFromListing(), Date.UTC(2026, 0, 15, 9), Date.UTC(2026, 0, 15, 10));
    expect(o.status).toBe("unavailable");
    expect((await reader.listIncoming("T-not-valid", 0, 1)).status).toBe("unavailable");
  });
});
