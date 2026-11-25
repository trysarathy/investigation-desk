/**
 * v1 phase 2.4 conformance suites for the networks read behind a flag: Polygon, Base and Arbitrum One (EVM JSON-RPC)
 * and Solana (JSON-RPC, SPL). Fictional transfers in each network's real response shapes (tests/fixtures/chain-networks).
 * Every network must: recognise only its allowlisted contract/mint, report look-alikes as facts, never treat a failed
 * transaction as a transfer, finalise only by its finality rule (and cache only final results), detect a reorg between
 * reads, list incoming transfers to a deposit address, and stay read-only. No network: a real fetch fails the file.
 */
import { describe, expect, it } from "vitest";
import {
  type HttpRequest, type HttpResponse, EvmReader, FLAGGED_NETWORKS, MemoryChainFactCache, NETWORK_READ_SPECS, READ_ONLY_RPC_METHODS, SOLANA_READ_ONLY_METHODS,
  SolanaReader, USDC_ARBITRUM_ONE, USDC_BASE, USDC_POLYGON, USDC_SOLANA_MINT, fakeRuntime, isEip55Checksummed, networkFlagOn, recordedTransport,
} from "@/lib/clearline/merchant/chain";
import { keccak_256 } from "@noble/hashes/sha3";
import { AMOUNT, DEPOSIT, EVM_NETWORKS, HEAD_OFFSET, LOOKALIKE, NET, PAYER, TX_TIME_S, blockBody, evmScenarios, receiptBody, transferLog, txh, usdcOf, type L2 } from "../../fixtures/chain-networks/evm";
import * as sol from "../../fixtures/chain-networks/solana";
import { guardRealFetch } from "./chain-helpers";

guardRealFetch();

const RPC = "https://rpc.example.invalid/v3/test-placeholder-key-000";
const rt = () => fakeRuntime({ startMs: Date.UTC(2026, 0, 15, 10), seed: 7 });
const methods = (calls: { body?: string }[]) => calls.map((c) => JSON.parse(c.body!).method);
const keccakHex = (s: string) => Buffer.from(keccak_256(new TextEncoder().encode(s))).toString("hex");

describe("token allowlists (real public contracts only, verified and cited in networks.ts)", () => {
  it("lists exactly the USDC published by Circle on each flagged network, nothing else; USDT stays empty where unverified", () => {
    expect(NETWORK_READ_SPECS.polygon.tokens).toEqual([{ network: "polygon", contract: USDC_POLYGON, symbol: "USDC", decimals: 6 }]);
    expect(NETWORK_READ_SPECS.base.tokens).toEqual([{ network: "base", contract: USDC_BASE, symbol: "USDC", decimals: 6 }]);
    expect(NETWORK_READ_SPECS.arbitrum_one.tokens).toEqual([{ network: "arbitrum_one", contract: USDC_ARBITRUM_ONE, symbol: "USDC", decimals: 6 }]);
    expect(NETWORK_READ_SPECS.solana.tokens).toEqual([{ network: "solana", contract: USDC_SOLANA_MINT, symbol: "USDC", decimals: 6 }]);
    for (const n of FLAGGED_NETWORKS) expect(NETWORK_READ_SPECS[n].tokens.some((t) => t.symbol === "USDT")).toBe(false);
  });
  it("every EVM contract carries a valid EIP-55 checksum (catches a typo in a copied address)", () => {
    for (const a of [USDC_POLYGON, USDC_BASE, USDC_ARBITRUM_ONE]) expect(isEip55Checksummed(a, keccakHex)).toBe(true);
    expect(isEip55Checksummed(USDC_BASE.replace("C", "c"), keccakHex)).toBe(false);
  });
  it("the Solana mint is 32 bytes of base58", () => {
    expect(USDC_SOLANA_MINT).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });
  it("each flagged network is OFF by default and on only with its flag exactly '1'", () => {
    for (const n of FLAGGED_NETWORKS) {
      expect(networkFlagOn(n, {})).toBe(false);
      expect(networkFlagOn(n, { [NETWORK_READ_SPECS[n].flag!]: "true" })).toBe(false);
      expect(networkFlagOn(n, { [NETWORK_READ_SPECS[n].flag!]: "1" })).toBe(true);
    }
    expect(networkFlagOn("tron", {})).toBe(true); // rc7 behaviour: on when its key is set
  });
});

/** A synthetic EVM node for listings: blocks every `blockSeconds`, logs in range, receipts by hash. */
function evmNode(n: L2, txs: { tx: string; block: bigint; contract: string; to: string }[], head: bigint, finalized: bigint) {
  const calls: HttpRequest[] = [];
  const transport = async (req: HttpRequest): Promise<HttpResponse> => {
    calls.push(req);
    const { method, params } = JSON.parse(req.body!) as { method: string; params: unknown[] };
    const ok = (result: unknown) => ({ status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
    const logOf = (t: (typeof txs)[number]) => transferLog(n, { contract: t.contract, from: PAYER, to: t.to, amount: AMOUNT, logIndex: 0, tx: t.tx, block: t.block, blockHash: blockBody(n, t.block).hash });
    if (method === "eth_blockNumber") return ok("0x" + head.toString(16));
    if (method === "eth_getBlockByNumber") return ok(params[0] === "finalized" ? blockBody(n, finalized) : BigInt(params[0] as string) <= head ? blockBody(n, BigInt(params[0] as string)) : null);
    if (method === "eth_getLogs") {
      const f = params[0] as { fromBlock: string; toBlock: string; topics: (string | null)[] };
      return ok(txs.filter((t) => t.block >= BigInt(f.fromBlock) && t.block <= BigInt(f.toBlock) && f.topics[2]!.endsWith(t.to.slice(2))).map(logOf));
    }
    if (method === "eth_getTransactionReceipt") {
      const t = txs.find((x) => x.tx === params[0]);
      return ok(t ? receiptBody(n, { tx: t.tx, block: t.block, blockHash: blockBody(n, t.block).hash, logs: [logOf(t)] }) : null);
    }
    return { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } }) };
  };
  return { transport, calls };
}

describe.each(EVM_NETWORKS)("EVM conformance: %s", (n) => {
  const S = evmScenarios(n);
  const reader = (name: keyof typeof S) => {
    const transport = recordedTransport(S[name].exchanges);
    const cache = new MemoryChainFactCache();
    return { r: new EvmReader({ transport, runtime: rt(), cache, rpcUrl: RPC, network: n }), transport, cache };
  };

  it("decodes an allowlisted USDC transfer and finalises it only by depth AND the finalized tag AND an unchanged re-read; caches only then", async () => {
    const { r, transport, cache } = reader("normal");
    const o = await r.getTransfer(S.normal.tx);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers).toHaveLength(1);
    const t = o.transfers[0];
    expect(t).toMatchObject({ network: n, tokenContract: usdcOf(n), symbol: "USDC", decimals: 6, to: DEPOSIT, from: PAYER, finalised: true, logIndex: 0 });
    expect(t.amountBaseUnits).toBe(AMOUNT);
    expect(t.confirmations).toBe(HEAD_OFFSET + 1n);
    expect(t.timestamp).toBe(new Date(TX_TIME_S * 1000).toISOString());
    expect(methods(transport.calls)).toEqual(["eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionReceipt"]);
    expect(JSON.parse(transport.calls[3].body!).params[0]).toBe("finalized");
    for (const e of t.evidence) expect(e).toMatchObject({ source: "evm-rpc", host: "rpc.example.invalid" });
    expect(cache.map.has(`${n}:tx:${S.normal.tx}`)).toBe(true);
    await r.getTransfer(S.normal.tx);
    expect(transport.calls).toHaveLength(5); // served from the cache
    if (n === "polygon") expect(o.nonMatching).toEqual([]); // the LogFeeTransfer system log is not a Transfer and not a look-alike
  });

  it("is NOT final while above the node's finalized block, even at full depth; not cached", async () => {
    const { r, cache } = reader("not_finalized_tag");
    const o = await r.getTransfer(S.not_finalized_tag.tx);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].finalised).toBe(false);
    expect(o.transfers[0].confirmations).toBe(HEAD_OFFSET + 1n); // deep enough by count; the finalized tag decides
    expect(cache.map.size).toBe(0);
  });

  it("reports a same-symbol transfer from a non-allowlisted contract as a look-alike fact, never a transfer", async () => {
    const { r } = reader("lookalike");
    const o = await r.getTransfer(S.lookalike.tx);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers).toEqual([]);
    expect(o.nonMatching).toHaveLength(1);
    expect(o.nonMatching[0]).toMatchObject({ network: n, contract: LOOKALIKE, to: DEPOSIT, rawAmount: AMOUNT });
  });

  it("never treats a failed receipt (status 0x0) as a transfer", async () => {
    const { r, transport } = reader("failed");
    expect((await r.getTransfer(S.failed.tx)).status).toBe("failed_transaction");
    expect(transport.calls).toHaveLength(1);
  });

  it("detects a reorg between receipt reads (another block hash) and caches nothing", async () => {
    const { r, cache } = reader("reorg");
    const o = await r.getTransfer(S.reorg.tx);
    expect(o.status).toBe("reorged");
    expect(cache.map.size).toBe(0);
  });

  it("lists incoming transfers to a deposit address in a window: final below the finalized block, pending above it, look-alikes as facts", async () => {
    const base = NET[n].block;
    const head = base + 1_000n;
    const txs = [
      { tx: txh(`${n}:list-final`), block: base + 100n, contract: usdcOf(n), to: DEPOSIT },
      { tx: txh(`${n}:list-recent`), block: base + 990n, contract: usdcOf(n), to: DEPOSIT }, // 11 confirmations: below every depth rule
      { tx: txh(`${n}:list-lookalike`), block: base + 200n, contract: LOOKALIKE, to: DEPOSIT },
      { tx: txh(`${n}:list-other`), block: base + 300n, contract: usdcOf(n), to: PAYER }, // not to the deposit
    ];
    const node = evmNode(n, txs, head, base + 900n);
    const r = new EvmReader({ transport: node.transport, runtime: rt(), rpcUrl: RPC, network: n, maxLogRange: 5_000n });
    const s = NET[n].blockSeconds;
    const o = await r.listIncoming(DEPOSIT, (TX_TIME_S - 10) * 1000, (TX_TIME_S + 1_000 * s + 10) * 1000);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers.map((t) => [t.txHash, t.finalised])).toEqual([[txs[0].tx, true], [txs[1].tx, false]]);
    expect(o.nonMatching.map((x) => x.txHash)).toEqual([txs[2].tx]);
    expect(o.unresolved).toEqual([]);
    expect(new Set(methods(node.calls))).toEqual(new Set(["eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"]));
  });

  it("an endpoint outage is 'unavailable' (never zero), with the key redacted from the reason and evidence", async () => {
    const r = new EvmReader({ transport: async () => ({ status: 503, headers: {}, body: "down" }), runtime: rt(), rpcUrl: RPC, network: n, retry: { maxAttempts: 2 } });
    const o = await r.listIncoming(DEPOSIT, 0, Date.UTC(2026, 0, 15, 10));
    expect(o.status).toBe("unavailable");
    expect(JSON.stringify(o)).not.toContain("test-placeholder-key-000");
  });
});

describe("EVM readers stay read-only", () => {
  it("only the four read methods exist", () => {
    expect([...READ_ONLY_RPC_METHODS]).toEqual(["eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_blockNumber", "eth_getLogs"]);
  });
});

describe("Solana conformance", () => {
  const confirmedSlot = sol.SLOT + 100, finalizedSlot = sol.SLOT + 60;
  const base = { sig: sol.signature("normal"), slot: sol.SLOT, blockTime: sol.TX_TIME_S };
  const reader = (node: ReturnType<typeof sol.solanaNode>, cache = new MemoryChainFactCache()) => ({ r: new SolanaReader({ transport: node.transport, runtime: rt(), cache, rpcUrl: RPC, retry: { maxAttempts: 2 } }), cache });

  it("decodes a transferChecked of the USDC mint to the deposit wallet (owner of the destination token account) and finalises it under commitment finalized + an unchanged re-read", async () => {
    const node = sol.solanaNode({ txs: [base], confirmedSlot, finalizedSlot });
    const { r, cache } = reader(node);
    const o = await r.getTransfer(base.sig);
    if (o.status !== "ok") throw new Error(`${o.status}`);
    expect(o.transfers).toHaveLength(1);
    expect(o.transfers[0]).toMatchObject({ network: "solana", tokenContract: USDC_SOLANA_MINT, symbol: "USDC", decimals: 6, from: sol.PAYER, to: sol.WALLET, finalised: true, logIndex: 1000 });
    expect(o.transfers[0].amountBaseUnits).toBe(sol.AMOUNT);
    expect(o.transfers[0].blockNumber).toBe(BigInt(sol.SLOT));
    expect(o.transfers[0].confirmations).toBe(101n);
    expect(o.transfers[0].evidence[0]).toMatchObject({ source: "solana-rpc", host: "rpc.example.invalid" });
    expect(node.calls.map((c) => c.method)).toEqual(["getTransaction", "getSlot", "getTransaction"]);
    expect(cache.map.has(`solana:tx:${base.sig}`)).toBe(true);
  });

  it("decodes an unchecked `transfer` inside inner instructions (mint from the token balances); logIndex = outer × 1000 + inner + 1", async () => {
    const t = { ...base, sig: sol.signature("inner"), checked: false, inner: true };
    const { r } = reader(sol.solanaNode({ txs: [t], confirmedSlot, finalizedSlot }));
    const o = await r.getTransfer(t.sig);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers.map((x) => [x.logIndex, x.tokenContract, x.to])).toEqual([[1001, USDC_SOLANA_MINT, sol.WALLET]]);
  });

  it("a transaction seen only under 'confirmed' is a pending fact, not cached", async () => {
    const t = { ...base, sig: sol.signature("recent"), slot: finalizedSlot + 10 };
    const { r, cache } = reader(sol.solanaNode({ txs: [t], confirmedSlot, finalizedSlot }));
    const o = await r.getTransfer(t.sig);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers[0].finalised).toBe(false);
    expect(cache.map.size).toBe(0);
  });

  it("a mint that is not allowlisted is a look-alike fact; a failed transaction is never a transfer; an unknown one is not_found", async () => {
    const look = { ...base, sig: sol.signature("look"), mint: sol.LOOKALIKE_MINT };
    const failed = { ...base, sig: sol.signature("failed"), err: { InstructionError: [1, { Custom: 1 }] } };
    const { r } = reader(sol.solanaNode({ txs: [look, failed], confirmedSlot, finalizedSlot }));
    const o = await r.getTransfer(look.sig);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers).toEqual([]);
    expect(o.nonMatching[0]).toMatchObject({ contract: sol.LOOKALIKE_MINT, to: sol.WALLET, rawAmount: sol.AMOUNT });
    expect((await r.getTransfer(failed.sig)).status).toBe("failed_transaction");
    expect((await r.getTransfer(sol.signature("unknown"))).status).toBe("not_found");
  });

  it("a slot that changes between finalized reads is a reorg; nothing is cached", async () => {
    const { r, cache } = reader(sol.solanaNode({ txs: [base], confirmedSlot, finalizedSlot, secondFinalizedSlotShift: 1 }));
    const o = await r.getTransfer(base.sig);
    expect(o.status).toBe("reorged");
    expect(cache.map.size).toBe(0);
  });

  it("lists incoming transfers via the wallet's token accounts, in the window; other mints' accounts are look-alike facts", async () => {
    const final = base;
    const pending = { ...base, sig: sol.signature("pending"), slot: finalizedSlot + 20, blockTime: sol.TX_TIME_S + 30 };
    const old = { ...base, sig: sol.signature("old"), slot: sol.SLOT - 1_000, blockTime: sol.TX_TIME_S - 86_400 * 3 };
    const look = { ...base, sig: sol.signature("look2"), mint: sol.LOOKALIKE_MINT, blockTime: sol.TX_TIME_S + 5 };
    const node = sol.solanaNode({ txs: [final, pending, old, look], confirmedSlot, finalizedSlot, lookalikeAccount: true });
    const { r } = reader(node);
    const o = await r.listIncoming(sol.WALLET, (sol.TX_TIME_S - 3600) * 1000, (sol.TX_TIME_S + 3600) * 1000);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.transfers.map((t) => [t.txHash, t.finalised]).sort()).toEqual([[final.sig, true], [pending.sig, false]].sort());
    expect(o.nonMatching.map((x) => [x.txHash, x.contract])).toEqual([[look.sig, sol.LOOKALIKE_MINT]]);
    expect(new Set(node.calls.map((c) => c.method))).toEqual(new Set(["getTokenAccountsByOwner", "getSignaturesForAddress", "getSlot", "getTransaction"]));
  });

  it("an outage is 'unavailable' (never zero) and the key in the URL is redacted; only read-only methods exist", async () => {
    const { r } = reader(sol.solanaNode({ txs: [], confirmedSlot, finalizedSlot, down: true }));
    const o = await r.listIncoming(sol.WALLET, 0, 1);
    expect(o.status).toBe("unavailable");
    expect(JSON.stringify(o)).not.toContain("test-placeholder-key-000");
    expect([...SOLANA_READ_ONLY_METHODS]).toEqual(["getSlot", "getTransaction", "getSignaturesForAddress", "getTokenAccountsByOwner"]);
    expect((await r.listIncoming("0xnot-a-solana-address", 0, 1)).status).toBe("unavailable");
  });
});
