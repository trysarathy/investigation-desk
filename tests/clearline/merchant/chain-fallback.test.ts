/**
 * v1 phase 2.4: the ChainReader interface and FallbackChainReader (primary + fallback per network): health checks,
 * deadlines, the deterministic order and circuit, corroborated finality, "chain data conflicting" and "chain data
 * unavailable" (both fail), and caching only of corroborated final facts. Stub readers, fictional values, no network.
 */
import { describe, expect, it } from "vitest";
import {
  ChainDataConflictingError, ChainDataUnavailableError, type ChainReader, type ChainTransferFact, type Evidence, FallbackChainReader, type IncomingOutcome,
  MemoryChainFactCache, RealChainClient, type TransferOutcome, consumeChainOutcome, fakeRuntime, liveReadersFromEnv, recordedTransport,
} from "@/lib/clearline/merchant/chain";
import { guardRealFetch } from "./chain-helpers";

guardRealFetch();

const ev = (host: string): Evidence => ({ source: "recording", host, method: "stub", fetchedAt: "2026-01-15T10:00:00.000Z" });
const TX = "a".repeat(64), TX2 = "b".repeat(64);
const fact = (o: Partial<ChainTransferFact> = {}): ChainTransferFact => ({
  network: "tron", txHash: TX, logIndex: 0, tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", from: "TFromFictional", to: "TToFictional",
  amountBaseUnits: 100_000_000n, decimals: 6, blockNumber: 70_000_000n, timestamp: "2026-01-15T09:00:00.000Z", confirmations: 50n, finalised: true, evidence: [ev("p")], ...o,
});
type Answer<T> = T | (() => Promise<T>);
/** A stub reader: answers from tables, counts calls. */
function stub(provider: string, tx: Record<string, Answer<TransferOutcome>>, list?: Answer<IncomingOutcome>, health = true) {
  const calls: string[] = [];
  const get = async <T,>(a: Answer<T>): Promise<T> => (typeof a === "function" ? (a as () => Promise<T>)() : a);
  const r: ChainReader = {
    network: "tron", provider,
    health: async () => { calls.push("health"); return health ? { ok: true, head: 70_000_100n, evidence: ev(provider) } : { ok: false, reason: `${provider} down`, evidence: ev(provider) }; },
    getTransfer: async (h) => { calls.push(`tx:${h.slice(0, 4)}`); return get(tx[h] ?? { status: "not_found", reason: "unknown", evidence: [ev(provider)] }); },
    listIncoming: async () => { calls.push("list"); return get(list ?? { status: "unavailable", reason: `${provider} has no listing`, evidence: [] }); },
  };
  return { r, calls };
}
const ok = (transfers: ChainTransferFact[], host = "p"): TransferOutcome => ({ status: "ok", transfers, nonMatching: [], evidence: [ev(host)] });
const down = (why: string): TransferOutcome => ({ status: "unavailable", reason: why, evidence: [] });
const listing = (transfers: ChainTransferFact[], unresolved: Extract<IncomingOutcome, { status: "ok" }>["unresolved"] = []): IncomingOutcome => ({ status: "ok", transfers, nonMatching: [], unresolved, evidence: [] });
const pair = (p: ChainReader, f?: ChainReader, o: Partial<ConstructorParameters<typeof FallbackChainReader>[0]> = {}) => new FallbackChainReader({ primary: p, fallback: f, runtime: fakeRuntime({ startMs: Date.UTC(2026, 0, 15, 10) }), ...o });

describe("FallbackChainReader: getTransfer", () => {
  it("a final answer is corroborated by the other provider: agreed → final, evidence from both, cached; the next read calls nobody", async () => {
    const p = stub("primary", { [TX]: ok([fact()]) }), f = stub("fallback", { [TX]: ok([fact({ confirmations: 48n, evidence: [ev("f")] })], "f") });
    const fb = pair(p.r, f.r);
    const o = await fb.getTransfer(TX);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0]).toMatchObject({ finalised: true, confirmations: 48n });
    expect(o.transfers[0].evidence.map((e) => e.host)).toEqual(["p", "f"]);
    await fb.getTransfer(TX);
    expect([p.calls, f.calls]).toEqual([["tx:aaaa"], ["tx:aaaa"]]);
  });

  it("a non-final answer needs no second opinion (one call) and is never cached", async () => {
    const p = stub("primary", { [TX]: ok([fact({ finalised: false, confirmations: 3n })]) }), f = stub("fallback", {});
    const cache = new MemoryChainFactCache();
    const fb = pair(p.r, f.r, { cache });
    expect((await fb.getTransfer(TX)).status).toBe("ok");
    expect(f.calls).toEqual([]);
    expect(cache.map.size).toBe(0);
  });

  it.each([
    ["amount", { amountBaseUnits: 99_000_000n }],
    ["recipient", { to: "TOtherFictional" }],
    ["token contract", { tokenContract: "TLookAlikeFictional" }],
    ["block", { blockNumber: 70_000_001n }],
    ["block hash", { blockHash: "0xdifferent" }],
  ])("the providers disagree on the %s → chain data conflicting (never matched), not cached", async (_what, diff) => {
    const cache = new MemoryChainFactCache();
    const p = stub("primary", { [TX]: ok([fact({ blockHash: "0xsame" })]) }), f = stub("fallback", { [TX]: ok([fact({ blockHash: "0xsame", ...diff })], "f") });
    const o = await pair(p.r, f.r, { cache }).getTransfer(TX);
    expect(o.status).toBe("conflicting");
    expect(o.status === "conflicting" && o.reason).toMatch(/^chain data conflicting: /);
    expect(consumeChainOutcome(o, TX)).toMatchObject({ kind: "chain_data_conflicting", mayMatch: false });
    expect(cache.map.size).toBe(0);
  });

  it("the other provider says the transaction failed or does not exist → conflicting; says reorged → reorged (not final)", async () => {
    for (const [other, want] of [[{ status: "failed_transaction", reason: "failed", evidence: [] }, "conflicting"], [{ status: "not_found", reason: "none", evidence: [] }, "conflicting"],
      [{ status: "reorged", reason: "moved", transfers: [], evidence: [] }, "reorged"]] as const) {
      const p = stub("primary", { [TX]: ok([fact()]) }), f = stub("fallback", { [TX]: other as unknown as TransferOutcome });
      expect((await pair(p.r, f.r).getTransfer(TX)).status).toBe(want);
    }
  });

  it("the other provider is unavailable → the facts are kept but NOT final (never matched on one source)", async () => {
    const p = stub("primary", { [TX]: ok([fact()]) }), f = stub("fallback", { [TX]: down("fallback HTTP 503") });
    const o = await pair(p.r, f.r).getTransfer(TX);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].finalised).toBe(false);
  });

  it("primary unavailable → the fallback answers, but alone it cannot make anything final", async () => {
    const p = stub("primary", { [TX]: down("primary HTTP 503") }), f = stub("fallback", { [TX]: ok([fact()], "f") });
    const o = await pair(p.r, f.r).getTransfer(TX);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].finalised).toBe(false);
    expect([p.calls, f.calls]).toEqual([["tx:aaaa"], ["tx:aaaa"]]);
  });

  it("BOTH unavailable → chain data unavailable, naming both reasons (never zero, never 'no transfer')", async () => {
    const p = stub("primary", { [TX]: down("primary HTTP 503") }), f = stub("fallback", { [TX]: down("fallback timed out") });
    const o = await pair(p.r, f.r).getTransfer(TX);
    expect(o).toMatchObject({ status: "unavailable", reason: "both providers failed (primary: primary HTTP 503; fallback: fallback timed out)" });
    expect(consumeChainOutcome(o, TX)).toMatchObject({ kind: "chain_data_unavailable", mayMatch: false });
  });

  it("a provider past the deadline is unavailable for that call; a throwing provider too (generic reason, no detail leaked)", async () => {
    const hang = () => new Promise<TransferOutcome>(() => undefined);
    const p = stub("primary", { [TX]: hang }), f = stub("fallback", { [TX]: async () => { throw new Error("https://secret.example/key-123 exploded"); } });
    const o = await pair(p.r, f.r, { timeoutMs: 5 }).getTransfer(TX);
    expect(o).toMatchObject({ status: "unavailable", reason: "both providers failed (primary: primary provider timed out after 5 ms; fallback: fallback provider error)" });
    expect(JSON.stringify(o)).not.toContain("key-123");
  });

  it("with no fallback configured the single provider's answer is used unchanged (rc7 behaviour)", async () => {
    const p = stub("primary", { [TX]: ok([fact()]) });
    const o = await pair(p.r).getTransfer(TX);
    expect(o.status === "ok" && o.transfers[0].finalised).toBe(true);
  });
});

describe("FallbackChainReader: deterministic order, circuit and health", () => {
  it("opens the primary's circuit after 3 consecutive failures (fallback first), and closes it after the cooldown on the injected clock", async () => {
    const rt = fakeRuntime({ startMs: Date.UTC(2026, 0, 15, 10) });
    const p = stub("primary", { [TX]: down("p down"), [TX2]: down("p down") }), f = stub("fallback", { [TX]: ok([fact({ finalised: false })], "f"), [TX2]: ok([fact({ txHash: TX2, finalised: false })], "f") });
    const fb = new FallbackChainReader({ primary: p.r, fallback: f.r, runtime: rt, failuresToOpen: 3, cooldownMs: 60_000 });
    for (let i = 0; i < 3; i++) await fb.getTransfer(TX);
    expect(fb.primaryCircuitOpen()).toBe(true);
    p.calls.length = 0; f.calls.length = 0;
    await fb.getTransfer(TX2);
    expect([f.calls, p.calls]).toEqual([["tx:bbbb"], []]); // fallback answered first; a non-final answer needs no second call
    await rt.sleep(60_000);
    expect(fb.primaryCircuitOpen()).toBe(false);
  });

  it("healthReport checks both providers and feeds the circuit; health() is ok while either is up", async () => {
    const p = stub("primary", {}, undefined, false), f = stub("fallback", {});
    const fb = pair(p.r, f.r, { failuresToOpen: 1 });
    const h = await fb.healthReport();
    expect([h.primary.ok, h.fallback?.ok, h.primaryCircuitOpen]).toEqual([false, true, true]);
    expect((await fb.health()).ok).toBe(true);
    const both = pair(stub("primary", {}, undefined, false).r, stub("fallback", {}, undefined, false).r);
    expect(await both.health()).toMatchObject({ ok: false, reason: "both providers failed (primary: primary down; fallback: fallback down)" });
  });

  it("refuses a fallback for another network", () => {
    const other: ChainReader = { ...stub("fallback", {}).r, network: "ethereum" };
    expect(() => pair(stub("primary", {}).r, other)).toThrow(/same network/);
  });
});

describe("FallbackChainReader: listIncoming", () => {
  it("compares per transaction: agreed finals stay final, a disagreeing one becomes 'conflicting' (unresolved), pending facts are unioned", async () => {
    const pending = fact({ txHash: "c".repeat(64), finalised: false, confirmations: 2n });
    const p = stub("primary", {}, listing([fact(), fact({ txHash: TX2 }), pending]));
    const f = stub("fallback", {}, listing([fact({ evidence: [ev("f")] }), fact({ txHash: TX2, amountBaseUnits: 1n })]));
    const o = await pair(p.r, f.r).listIncoming("TToFictional", 0, Date.UTC(2026, 1, 1));
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers.map((t) => [t.txHash.slice(0, 2), t.finalised])).toEqual([["aa", true], ["cc", false]]);
    expect(o.unresolved).toEqual([{ txHash: TX2, status: "conflicting", reason: expect.stringMatching(/^chain data conflicting: primary and fallback disagree/) }]);
    expect(consumeChainOutcome(o)).toMatchObject({ kind: "facts", conflictingTx: [{ txHash: TX2 }] });
  });

  it("a final transfer the other provider did not list is read there by id; agreement keeps it final", async () => {
    const p = stub("primary", {}, listing([fact()]));
    const f = stub("fallback", { [TX]: ok([fact()], "f") }, listing([]));
    const o = await pair(p.r, f.r).listIncoming("TToFictional", 0, Date.UTC(2026, 1, 1));
    expect(o.status === "ok" && o.transfers.map((t) => t.finalised)).toEqual([true]);
    expect(f.calls).toEqual(["list", "tx:aaaa"]);
  });

  it("the other listing is unavailable → facts kept, nothing final; both unavailable → chain data unavailable", async () => {
    const p = stub("primary", {}, listing([fact()])), f = stub("fallback", {});
    const o = await pair(p.r, f.r).listIncoming("TToFictional", 0, 1);
    expect(o.status === "ok" && o.transfers.map((t) => t.finalised)).toEqual([false]);
    const both = await pair(stub("primary", {}).r, stub("fallback", {}).r).listIncoming("TToFictional", 0, 1);
    expect(both).toMatchObject({ status: "unavailable", reason: "both providers failed (primary: primary has no listing; fallback: fallback has no listing)" });
  });
});

describe("RealChainClient over ChainReaders", () => {
  it("conflicting data throws ChainDataConflictingError from the rc6 adapter; unavailable throws ChainDataUnavailableError", async () => {
    const p = stub("primary", { [TX]: ok([fact()]) }, listing([fact()])), f = stub("fallback", { [TX]: ok([fact({ amountBaseUnits: 5n })]) }, listing([fact({ amountBaseUnits: 5n })]));
    const c = new RealChainClient({ byNetwork: { tron: pair(p.r, f.r) }, runtime: fakeRuntime({ startMs: Date.UTC(2026, 0, 20) }) });
    await expect(c.transfersTo("tron", "TToFictional", "2026-01-01T00:00:00Z")).rejects.toBeInstanceOf(ChainDataConflictingError);
    await expect(c.confirmations("tron", TX)).rejects.toBeInstanceOf(ChainDataConflictingError);
    await expect(c.confirmations("polygon", TX)).rejects.toBeInstanceOf(ChainDataUnavailableError);
    expect(await c.incoming("polygon", "0x" + "1".repeat(40), 0, 1)).toMatchObject({ status: "unavailable", reason: "no Polygon reader configured" });
  });

  it("liveReadersFromEnv: flagged networks are off by default; on only with the flag and an endpoint; a fallback endpoint makes a FallbackChainReader", () => {
    const base = { CLEARLINE_CHAIN_LIVE: "1", TRONGRID_API_KEY: "test-placeholder", ETHEREUM_RPC_URL: "https://eth.example.invalid/k", ETHEREUM_FALLBACK_RPC_URL: "https://eth2.example.invalid/k" };
    const transport = recordedTransport([]);
    const off = liveReadersFromEnv({ ...base, POLYGON_RPC_URL: "https://polygon.example.invalid/k" }, { transport });
    expect(off.missing).toMatchObject({ polygon: "Polygon chain reads are off (CLEARLINE_CHAIN_POLYGON is not 1)", base: expect.stringMatching(/off/), arbitrum_one: expect.stringMatching(/off/), solana: expect.stringMatching(/off/) });
    expect(off.byNetwork?.polygon).toBeUndefined();
    expect(off.byNetwork?.ethereum).toBeInstanceOf(FallbackChainReader);
    expect(off.byNetwork?.tron).not.toBeInstanceOf(FallbackChainReader); // no TRON fallback configured
    const on = liveReadersFromEnv({ ...base, CLEARLINE_CHAIN_POLYGON: "1", POLYGON_RPC_URL: "https://polygon.example.invalid/k", CLEARLINE_CHAIN_SOLANA: "1", CLEARLINE_CHAIN_BASE: "1" }, { transport });
    expect(on.byNetwork?.polygon?.network).toBe("polygon");
    expect(on.byNetwork?.solana).toBeUndefined();
    expect(on.missing).toMatchObject({ solana: "SOLANA_RPC_URL is not set", base: "BASE_RPC_URL is not set" });
    expect(() => liveReadersFromEnv({ ...base, VITEST: "true" })).toThrow(/refused in tests and CI/);
    expect(transport.calls).toEqual([]);
  });
});
