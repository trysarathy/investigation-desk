/**
 * RealChainClient (the rc6 ChainClient interface over the real readers), the live gate, key redaction, and how the
 * engine consumes `unavailable`. Recorded transports only; the real fetch is never called.
 */
import { describe, expect, it } from "vitest";
import { LiveChainClient, readChainTransfers } from "@/lib/clearline/merchant/adapters";
import {
  ChainDataUnavailableError, EthereumReader, RealChainClient, Secrets, TronReader, consumeChainOutcome, fakeRuntime, liveChainClientFromEnv,
  liveReadersFromEnv, recordedTransport, stringifyFacts, type HttpTransport,
} from "@/lib/clearline/merchant/chain";
import { ethReader, guardRealFetch, scenario, tronReader, txOf } from "./chain-helpers";

guardRealFetch();

const headTsMs = (1768467600 + 100 * 12) * 1000;
const listingDeposit = () => "0x" + (scenario("ethereum", "listing").exchanges.find((e) => e.match.rpcMethod === "eth_getLogs")!.match.rpcParam0 as { topics: string[] }).topics[2].slice(-40);

describe("RealChainClient as a ChainClient", () => {
  it("feeds readChainTransfers with verified transfers; an unavailable address fails alone and others still reconcile", async () => {
    const eth = ethReader("ethereum", "listing", { maxLogRange: 64n });
    const tronDown = new TronReader({ transport: recordedTransport(scenario("resilience", "server_error_exhaustion").exchanges.map((e) => ({ ...e, match: {} }))), runtime: fakeRuntime(), apiKey: "x-placeholder" });
    const client = new RealChainClient({ ethereum: eth.reader, tron: tronDown, runtime: eth.rt });
    const since = new Date(headTsMs - 600_000).toISOString();
    const tronAddr = decodeURIComponent(scenario("tron", "pagination").exchanges[0].match.path!.split("/")[3]);
    const r = await readChainTransfers(client, [{ network: "tron", address: tronAddr }, { network: "ethereum", address: listingDeposit() }], { since });
    expect(r.accepted.map((t) => [t.network, t.amountBaseUnits, t.confirmations, t.finalised])).toEqual([
      ["ethereum", 250_000_000n, 41, true], ["ethereum", 99_500_000n, 4, false],
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "source_failed", source: `tron:${tronAddr}` });
    expect(r.errors[0].reason).toMatch(/chain data unavailable/);
  });

  it("confirmations(): ok, reorged (moved), not found, and unavailable (thrown, never null)", async () => {
    const c = (file: "ethereum" | "resilience", name: string) => new RealChainClient({ ethereum: ethReader(file, name).reader, runtime: fakeRuntime() });
    expect(await c("ethereum", "normal_transfer").confirmations("ethereum", txOf("ethereum", "normal_transfer"))).toEqual({ confirmations: 57, block: 21_000_000 });
    expect(await c("ethereum", "reorg_between_reads").confirmations("ethereum", txOf("ethereum", "reorg_between_reads"))).toEqual({ confirmations: 0, block: 21_000_010 });
    expect(await c("ethereum", "unknown_transaction").confirmations("ethereum", txOf("ethereum", "unknown_transaction"))).toBeNull();
    await expect(c("resilience", "timeout").confirmations("ethereum", txOf("ethereum", "normal_transfer"))).rejects.toBeInstanceOf(ChainDataUnavailableError);
  });

  it("a network without a reader is unavailable, not empty", async () => {
    const client = new RealChainClient({ missing: { tron: "TRONGRID_API_KEY is not set" } });
    expect(await client.incoming("tron", "T", 0, 1)).toMatchObject({ status: "unavailable", reason: "TRONGRID_API_KEY is not set" });
    expect(await client.transfer("polygon", "0x")).toMatchObject({ status: "unavailable" });
    await expect(client.transfersTo("tron", "T", "2026-01-01T00:00:00Z")).rejects.toThrow(/chain data unavailable: TRONGRID_API_KEY is not set/);
  });
});

describe("live gate", () => {
  it("is off without CLEARLINE_CHAIN_LIVE=1 and refused under tests / CI, as in rc6", () => {
    expect(() => liveReadersFromEnv({})).toThrow(/off/);
    expect(() => liveReadersFromEnv({ CLEARLINE_CHAIN_LIVE: "1", VITEST: "true", TRONGRID_API_KEY: "k" })).toThrow(/refused in tests/);
    expect(() => liveReadersFromEnv({ CLEARLINE_CHAIN_LIVE: "1", CI: "true" })).toThrow(/refused in tests/);
    expect(() => liveChainClientFromEnv()).toThrow(); // this process is a test runner
    expect(() => new LiveChainClient({ CLEARLINE_CHAIN_LIVE: "1", NODE_ENV: "test" })).toThrow(/refused in tests/);
  });
});

describe("redaction", () => {
  const TRON_KEY = "tg-FAKE-KEY-0123456789abcdef";
  const ETH_KEY = "eth-FAKE-KEY-fedcba9876543210";
  const ETH_URL = `https://alice:pw-FAKE-SECRET@rpc.example.invalid/v3/${ETH_KEY}?apikey=q-FAKE-KEY-999`;
  const secrets = [TRON_KEY, ETH_KEY, "pw-FAKE-SECRET", "q-FAKE-KEY-999", ETH_URL];
  const echo = (mode: "throw" | "500" | "rpcError" | "403"): HttpTransport => async (req) => {
    const leak = `${req.url} ${JSON.stringify(req.headers)}`;
    if (mode === "throw") throw new Error(`boom ${leak}`);
    if (mode === "rpcError") return { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: `bad request to ${leak}` } }) };
    return { status: mode === "500" ? 500 : 403, headers: {}, body: `error for ${leak}` };
  };

  it("errors, reasons and evidence never contain a key or a keyed URL", async () => {
    const outputs: string[] = [];
    for (const mode of ["throw", "500", "rpcError", "403"] as const) {
      const tron = new TronReader({ transport: echo(mode), runtime: fakeRuntime(), apiKey: TRON_KEY });
      const eth = new EthereumReader({ transport: echo(mode), runtime: fakeRuntime(), rpcUrl: ETH_URL });
      outputs.push(stringifyFacts(await tron.getTransfer("ab".repeat(32))));
      outputs.push(stringifyFacts(await tron.listIncoming("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 0, 1)));
      outputs.push(stringifyFacts(await eth.getTransfer("0x" + "ab".repeat(32))));
      outputs.push(stringifyFacts(await eth.listIncoming("0x" + "11".repeat(20), 0, 1)));
      const client = new RealChainClient({ tron, ethereum: eth, runtime: fakeRuntime() });
      for (const p of [client.transfersTo("ethereum", "0x" + "11".repeat(20), "2026-01-01T00:00:00Z"), client.confirmations("tron", "ab".repeat(32))]) {
        const e = await p.catch((x: Error) => x);
        outputs.push(e instanceof Error ? `${e.name} ${e.message} ${e.stack ?? ""}` : JSON.stringify(e));
      }
    }
    const all = outputs.join("\n");
    for (const s of secrets) expect(all).not.toContain(s);
    expect(all).toContain("rpc.example.invalid"); // the host is kept
    expect(all).toContain("chain data unavailable");
  });

  it("Secrets.redact scrubs a URL's path, query and credentials", () => {
    const s = new Secrets([TRON_KEY, ...Secrets.fromUrl(ETH_URL)]);
    const out = s.redact(`x ${ETH_URL} y ${TRON_KEY} z ${encodeURIComponent("q-FAKE-KEY-999")}`);
    for (const x of secrets) expect(out).not.toContain(x);
    expect(s.contains(ETH_KEY)).toBe(true);
  });
});

describe("consumeChainOutcome (how the engine reads outcomes)", () => {
  it("unavailable → chain_data_unavailable, never matchable", () => {
    expect(consumeChainOutcome({ status: "unavailable", reason: "down", evidence: [] })).toEqual({ kind: "chain_data_unavailable", reason: "down", mayMatch: false, evidence: [] });
  });

  it("splits final from pending, and maps reorged / failed to their buckets", async () => {
    const l = await ethReader("ethereum", "listing", { maxLogRange: 64n }).reader.listIncoming(listingDeposit(), headTsMs - 600_000, headTsMs);
    const c = consumeChainOutcome(l);
    if (c.kind !== "facts") throw new Error("expected facts");
    expect(c.final.map((t) => t.symbol)).toEqual(["USDC"]);
    expect(c.pending.map((t) => t.symbol)).toEqual(["USDT"]);
    expect(c.nonMatching).toHaveLength(1);
    const tx = txOf("tron", "reorg_between_reads");
    const reorged = consumeChainOutcome(await tronReader("reorg_between_reads").reader.getTransfer(tx), tx);
    expect(reorged).toMatchObject({ kind: "facts", final: [], reorged: [{ txHash: tx, status: "reorged" }] });
    const failed = consumeChainOutcome(await tronReader("failed_transaction").reader.getTransfer(txOf("tron", "failed_transaction")));
    expect(failed).toMatchObject({ kind: "facts", final: [], pending: [], noTransfer: [{ status: "failed_transaction" }] });
  });
});
