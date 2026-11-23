/**
 * Ethereum JSON-RPC reader over SYNTHETIC recordings (tests/fixtures/chain-recordings/ethereum.json): identity by
 * contract, failed receipts, finality, block-hash reorg checks, time-window → block mapping and eth_getLogs chunking.
 * No network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { USDC_ETHEREUM } from "@/lib/clearline/merchant";
import { READ_ONLY_RPC_METHODS, USDT_ETHEREUM, parseTransferLog } from "@/lib/clearline/merchant/chain";
import { ethReader, guardRealFetch, scenario, txOf } from "./chain-helpers";

guardRealFetch();

const rpcMethods = (calls: { body?: string }[]) => calls.map((c) => JSON.parse(c.body!).method);

describe("EthereumReader.getTransfer", () => {
  it("decodes a USDC Transfer, counts confirmations, and finalises only after same number AND hash on re-read", async () => {
    const { reader, transport, cache } = ethReader("ethereum", "normal_transfer");
    const o = await reader.getTransfer(txOf("ethereum", "normal_transfer"));
    if (o.status !== "ok") throw new Error(o.status);
    const t = o.transfers[0];
    expect(o.transfers).toHaveLength(1);
    expect(t).toMatchObject({ network: "ethereum", tokenContract: USDC_ETHEREUM, symbol: "USDC", decimals: 6, logIndex: 3, finalised: true, timestamp: "2026-01-15T09:00:00.000Z" });
    expect(t.amountBaseUnits).toBe(250_000_000n);
    expect(t.blockNumber).toBe(21_000_000n);
    expect(t.confirmations).toBe(57n);
    expect(t.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(t.from).toMatch(/^0x[0-9a-f]{40}$/);
    expect(rpcMethods(transport.calls)).toEqual(["eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_blockNumber", "eth_getTransactionReceipt"]);
    for (const e of t.evidence) expect(e).toMatchObject({ source: "ethereum-rpc", host: "rpc.example.invalid", fetchedAt: "2026-01-15T10:00:00.000Z" });
    expect(t.evidence[0]).toMatchObject({ blockNumber: 21_000_000n, blockHash: t.blockHash, confirmationsAtFetch: 57n });
    expect(cache.map.has(`ethereum:tx:${t.txHash}`)).toBe(true);
    await reader.getTransfer(t.txHash);
    expect(transport.calls).toHaveLength(4); // served from cache
  });

  it("ignores look-alike contracts (reported as facts) and 4-topic Transfer logs", async () => {
    const { reader } = ethReader("ethereum", "lookalike_contract");
    const o = await reader.getTransfer(txOf("ethereum", "lookalike_contract"));
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers).toEqual([]);
    expect(o.nonMatching).toHaveLength(1);
    expect(o.nonMatching[0]).toMatchObject({ rawAmount: 250_000_000n, logIndex: 0 });
    expect(o.nonMatching[0].contract).not.toBe(USDC_ETHEREUM.toLowerCase());
  });

  it("never treats receipt status 0x0 as a transfer", async () => {
    const { reader, transport } = ethReader("ethereum", "failed_transaction");
    const o = await reader.getTransfer(txOf("ethereum", "failed_transaction"));
    expect(o.status).toBe("failed_transaction");
    expect(transport.calls).toHaveLength(1);
  });

  it("is not final below 12 confirmations and is not cached", async () => {
    const { reader, cache, transport } = ethReader("ethereum", "not_yet_final");
    const o = await reader.getTransfer(txOf("ethereum", "not_yet_final"));
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].confirmations).toBe(6n);
    expect(o.transfers[0].finalised).toBe(false);
    expect(cache.map.size).toBe(0);
    expect(rpcMethods(transport.calls)).not.toContain("eth_getLogs");
  });

  it("reports reorged when the re-read has the same block number but a different block hash", async () => {
    const { reader, cache } = ethReader("ethereum", "reorg_between_reads");
    const o = await reader.getTransfer(txOf("ethereum", "reorg_between_reads"));
    expect(o.status).toBe("reorged");
    if (o.status === "reorged") { expect(o.reason).toMatch(/different block hash/); expect(o.currentBlock).toBe(21_000_010n); }
    expect(cache.map.size).toBe(0);
  });

  it("returns not_found for a null receipt", async () => {
    const { reader } = ethReader("ethereum", "unknown_transaction");
    expect((await reader.getTransfer(txOf("ethereum", "unknown_transaction"))).status).toBe("not_found");
  });
});

describe("EthereumReader.listIncoming", () => {
  const head = 21_000_100;
  const headTsMs = (1768467600 + 100 * 12) * 1000; // fictional block 21,000,000 at 2026-01-15T09:00Z, 12 s blocks

  it("maps the window to blocks, chunks eth_getLogs (shrinking on range errors), verifies candidates by receipt", async () => {
    const { reader, transport } = ethReader("ethereum", "listing", { maxLogRange: 64n });
    const deposit = "0x" + (scenario("ethereum", "listing").exchanges.find((e) => e.match.rpcMethod === "eth_getLogs")!.match.rpcParam0 as { topics: string[] }).topics[2].slice(-40);
    const o = await reader.listIncoming(deposit, headTsMs - 600_000, headTsMs);
    if (o.status !== "ok") throw new Error(o.reason);
    expect(o.transfers.map((t) => [t.tokenContract, t.amountBaseUnits, t.confirmations, t.finalised])).toEqual([
      [USDC_ETHEREUM, 250_000_000n, 41n, true],
      [USDT_ETHEREUM, 99_500_000n, 4n, false],
    ]);
    expect(o.nonMatching).toHaveLength(1);
    expect(o.nonMatching[0].rawAmount).toBe(1_000_000_000n);
    expect(o.unresolved).toEqual([]);
    const logs = transport.calls.filter((c) => JSON.parse(c.body!).method === "eth_getLogs").map((c) => JSON.parse(c.body!).params[0]);
    const spans = logs.map((f) => Number(BigInt(f.toBlock) - BigInt(f.fromBlock) + 1n));
    expect(spans[0]).toBe(51); // the window is 50 blocks of 12 s plus its first block
    expect(spans.slice(0, 3)).toEqual([51, 32, 16]); // refused twice, then 16-block chunks
    expect(Math.max(...spans.slice(2))).toBeLessThanOrEqual(16);
    expect(BigInt(logs.at(-1).toBlock)).toBe(BigInt(head));
    // Topic filter only (no address filter), so look-alike tokens are seen; topic2 is the padded deposit.
    expect(logs[0].address).toBeUndefined();
    expect(logs[0].topics[2]).toBe("0x" + "0".repeat(24) + deposit.slice(2));
    // Bounded: the binary search used at most log2(span)+1 block lookups.
    expect(rpcMethods(transport.calls).filter((m) => m === "eth_getBlockByNumber").length).toBeLessThanOrEqual(14);
    expect(transport.unmatched).toEqual([]);
  });

  it("is unavailable when the block-lookup budget is exhausted, and empty for a future window", async () => {
    const { reader } = ethReader("ethereum", "listing", { maxBlockLookups: 2 });
    const deposit = "0x" + "11".repeat(20);
    expect((await reader.listIncoming(deposit, headTsMs - 600_000, headTsMs)).status).toBe("unavailable");
    const { reader: r2 } = ethReader("ethereum", "listing");
    const o = await r2.listIncoming(deposit, headTsMs + 60_000, headTsMs + 120_000);
    expect(o).toMatchObject({ status: "ok", transfers: [] });
    expect((await r2.listIncoming("0xnot", 0, 1)).status).toBe("unavailable");
  });
});

describe("read-only", () => {
  it("sends only read methods; no signing or broadcast method appears anywhere in the readers", () => {
    expect([...READ_ONLY_RPC_METHODS].sort()).toEqual(["eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"]);
    const dir = path.resolve(__dirname, "../../../src/lib/clearline/merchant/chain");
    for (const f of ["ethereum.ts", "tron.ts", "transport.ts", "resilience.ts", "client.ts", "reader-common.ts"]) {
      const src = readFileSync(path.join(dir, f), "utf8").replace(/^\s*(\*|\/\/).*$/gm, ""); // code, not comments
      expect(src).not.toMatch(/eth_send|eth_sign|personal_sign|broadcasttransaction|triggersmartcontract|createtransaction|privateKey|signTransaction/i);
    }
  });

  it("decodes only well-formed Transfer logs", () => {
    expect(parseTransferLog({ address: "0x" + "aa".repeat(20), topics: ["0x00"], data: "0x01" })).toBeUndefined();
    expect(parseTransferLog(null)).toBeUndefined();
  });
});
