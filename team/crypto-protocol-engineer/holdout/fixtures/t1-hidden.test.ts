// HOLDOUT T1 (hidden test). Copy this file and t1-router-receipt.json into tests/holdout/ of a
// worktree with the employee's branch checked out, then: npx vitest run tests/holdout/t1-hidden.test.ts
// The receipt goes through the REAL EvmFetcher decode path (only the JSON-RPC source is stubbed),
// then fetchFacts and investigate. Fails on main @ fd9b992 (verdict D06 from the counterfeit log).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvmFetcher, type EvmSource } from "@/lib/chain/evm";
import { fetchFacts } from "@/lib/chain/investigate";
import type { TronFetcher } from "@/lib/chain/tron";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS, USDC_ETHEREUM } from "@/lib/fixtures";
import type { EvmChain, RawResponse, Settings } from "@/lib/types";

const fx = JSON.parse(readFileSync(path.join(__dirname, "t1-router-receipt.json"), "utf8"));
const A = fx.addresses;

const abiString = (s: string) => {
  const h = Buffer.from(s).toString("hex");
  return "0x" + "20".padStart(64, "0") + s.length.toString(16).padStart(64, "0") + h.padEnd(64, "0");
};
const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");

// Each stubbed call leaves a RawResponse, as the real sources do (the fetcher reads fetchedAt from it).
const raw = (method: string, params: unknown[]): RawResponse => ({ source: "public-rpc", chain: "ethereum", status: 200,
  request: { method: "POST", url: "https://rpc.example.invalid", body: JSON.stringify({ method, params }) },
  fetchedAt: "2026-10-25T09:00:00.000Z", sha256: "0".repeat(64), body: "{}" });

function source(logs: unknown[]): EvmSource {
  return {
    kind: "public-rpc",
    async call(method, params, _opts, raws) {
      raws.push(raw(method, params));
      if (method === "eth_getTransactionByHash") return fx.rpc.eth_getTransactionByHash;
      if (method === "eth_getTransactionReceipt") return { ...fx.rpc.eth_getTransactionReceipt, logs };
      if (method === "eth_getBlockByNumber") return fx.rpc.eth_getBlockByNumber;
      if (method === "eth_blockNumber") return fx.rpc.eth_blockNumber;
      const { to, data } = params[0] as { to: string; data: string };
      const meta = fx.tokens[to.toLowerCase()];
      if (meta && data === "0x95d89b41") return abiString(meta.symbol);
      if (meta && data === "0x313ce567") return word(meta.decimals);
      if (to.toLowerCase() === A.usdc && data.startsWith("0xfe575a87")) return word(0); // isBlacklisted -> false
      throw new Error("execution reverted");
    },
  };
}
const empty: EvmSource = { kind: "public-rpc", async call(method, params, _o, raws) { raws.push(raw(method, params)); return null; } };

function deps(logs: unknown[]) {
  const sources: Partial<Record<EvmChain, EvmSource>> = { ethereum: source(logs), bsc: empty, polygon: empty, base: empty, arbitrum: empty, optimism: empty };
  const tron = { lookup: async () => ({ lookup: { chain: "tron", result: "not_found", fetchedAt: "", sourceUrl: "", rawBody: "" } }) } as unknown as TronFetcher;
  return { tron, evm: new EvmFetcher(sources), now: () => new Date("2026-10-25T09:00:00Z") };
}

const SETTINGS: Settings = {
  ...SAMPLE_SETTINGS,
  acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, ethereum: [...SAMPLE_SETTINGS.acceptedTokens.ethereum, { symbol: "USDC", contract: USDC_ETHEREUM }] },
  minimums: { ...SAMPLE_SETTINGS.minimums, ethereum: { ...SAMPLE_SETTINGS.minimums.ethereum, USDC: "1" } },
};

const ws = (transferIndex?: number) => ({
  customerId: "C-7781",
  depositAddresses: [{ row: 2, address: A.deposit, chain: "ethereum" as const, customerId: "C-7781", assignedAt: "2026-01-01T00:00:00Z" }],
  ledger: [{ row: 2, depositId: "DEP-55120", txHash: fx.hash, chain: "ethereum" as const, token: "USDC" as const, toAddress: A.deposit,
    amount: "4990.000000", status: "CREDITED" as const, creditedAt: "2026-10-25T08:20:00Z", customerId: "C-7781",
    ...(transferIndex === undefined ? {} : { transferIndex }) }],
  ledgerUploadedAt: "2026-10-25T08:30:00Z",
});

const LOGS = fx.rpc.eth_getTransactionReceipt.logs as { logIndex: string }[];

describe("T1: router receipt with a counterfeit log ahead of the genuine USDC transfer", () => {
  it("decodes all four Transfer logs (the Approval is ignored), with the right indexes and amounts", async () => {
    const r = await deps(LOGS).evm.lookup("ethereum", fx.hash, []);
    expect(r.tx!.transfers.map((t) => [t.logIndex, t.amount])).toEqual([[65, "5000.000000"], [66, "5000.000000"], [67, "4990.000000"], [68, "10.000000"]]);
  });

  it("judges the genuine USDC transfer to the deposit address, not the counterfeit one: D13 on the exact ledger row", async () => {
    const facts = await fetchFacts(fx.hash, ws(67), deps(LOGS), SETTINGS);
    const v = investigate(facts, SETTINGS);
    expect(v.code).toBe("D13");
    expect(v.confidence).toBe("High");
    expect(v.fill.amount).toBe("4990.000000");
    // The freeze check ran against Circle's contract (the genuine transfer), not "not_supported".
    expect(facts.freezeStatus).toBe("checked");
  });

  it("the verdict does not depend on log order", async () => {
    const reversed = [...LOGS].reverse();
    const v = investigate(await fetchFacts(fx.hash, ws(67), deps(reversed), SETTINGS), SETTINGS);
    expect(v.code).toBe("D13");
    expect(v.fill.amount).toBe("4990.000000");
  });

  it("a counterfeit-only transfer to the deposit address is still D06 (no regression)", async () => {
    const onlyFake = LOGS.filter((l) => l.logIndex === "0x41");
    const v = investigate(await fetchFacts(fx.hash, ws(), deps(onlyFake), SETTINGS), SETTINGS);
    expect(v.code).toBe("D06");
  });
});
