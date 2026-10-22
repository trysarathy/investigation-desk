// Spec 5.3 bulk investigation, replayed against real recorded chain data.

import { describe, expect, it } from "vitest";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { csvCell, isNonCredited, resultsCsv } from "@/lib/bulk/export";
import { investigateRow, runBulk } from "@/lib/bulk/run";
import { validateBulk } from "@/lib/csv/files";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import type { LiveDeps, Workspace } from "@/lib/chain/investigate";
import { loadRecording } from "./fixtures/live/harness";
import { replayTransport } from "./fixtures/live/replay";

const enc = (s: string) => new TextEncoder().encode(s);
const NAMES = ["tron-bitfinex-to-tether-treasury", "tron-tether-treasury-to-binance", "unknown-hash-not-found", "bsc-binance-hot16-withdrawal"];

function deps(): LiveDeps {
  const recs = NAMES.map(loadRecording);
  const merged = { name: "bulk", hash: "", explorer: "", recordedAt: recs[0].recordedAt, exchanges: recs.flatMap((r) => r.exchanges) };
  return buildFetchers({ tronKey: "k", etherscanKey: "k", store: new MemoryStore(), transport: replayTransport(merged),
    now: () => new Date(merged.recordedAt), sleep: async () => {}, noSpacing: true });
}

const ws: Workspace = {
  depositAddresses: [{ row: 2, address: "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs", chain: "tron", customerId: "C-1", assignedAt: "2024-01-01T00:00:00Z" }],
  ledger: [], ledgerUploadedAt: "2026-10-22T09:00:00Z", fileARejectedRows: 0, fileBRejectedRows: 0,
};

const csv = [
  "tx_hash,chain,customer_id",
  "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064,,",
  "e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1,tron,C-2",
  "4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d,,",
  "0x71a78d3bef17cf469a2296074d9569c57c2b288e394a379b12e6a7108de87c72,tron,",
  "not-a-hash,,",
].join("\n");

describe("bulk run on real data", () => {
  it("investigates every valid row, skips the bad one, and never guesses", async () => {
    const v = validateBulk(enc(csv));
    expect(v.rowErrors.map((e) => e.line)).toEqual([6]);
    const seen: number[] = [];
    const results = await runBulk(v.rows, ws, deps(), SAMPLE_SETTINGS, (r) => seen.push(r.line), 1);
    expect(seen).toEqual([2, 3, 4, 5]);
    const byLine = Object.fromEntries(results.map((r) => [r.line, r]));

    // No customer given: File A's owner at block time, and the row says so.
    expect(byLine[2]).toMatchObject({ code: "D12", confidence: "High", customerId: "C-1", customerInferred: true, foundChain: "tron", amount: "49975000.000000", token: "USDT" });
    expect(byLine[3]).toMatchObject({ code: "D07", customerId: "C-2", customerInferred: false });
    expect(byLine[4]).toMatchObject({ code: "D01", confidence: "High" });
    // The row said Tron; it is on BNB Chain, to an address not in File A.
    expect(byLine[5]).toMatchObject({ code: "D07", foundChain: "bsc", note: "Found on BNB Chain, not on Tron as the row says." });
  });

  it("'non-credited' is every row not shown as credited (D13)", () => {
    const base = { line: 1, txHash: "x", customerInferred: false, label: "", confidence: null };
    expect(isNonCredited({ ...base, state: "verdict", code: "D13" })).toBe(false);
    expect(isNonCredited({ ...base, state: "verdict", code: "D12" })).toBe(true);
    expect(isNonCredited({ ...base, state: "paused" })).toBe(true);
  });

  it("a lookup that throws becomes 'Lookup failed', not a verdict", async () => {
    const broken = { tron: { lookup: () => { throw new Error("boom"); } }, evm: {} } as unknown as LiveDeps;
    const r = await investigateRow({ line: 9, txHash: "ab".repeat(32) }, { ...ws, depositAddresses: [] }, broken, SAMPLE_SETTINGS);
    // fetchFacts turns per-chain failures into error lookups; anything escaping that is caught here.
    expect(["paused", "error"]).toContain(r.state);
    expect(r.code).toBeUndefined();
  });
});

describe("export CSV", () => {
  it("neutralises cells a spreadsheet would execute", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("0x71a7")).toBe("0x71a7");
    expect(csvCell("D12")).toBe("D12");
  });

  it("has a header and one line per result", () => {
    const out = resultsCsv([{ line: 2, txHash: "ab", customerInferred: true, customerId: "C-1", state: "verdict", code: "D12",
      label: "Arrived on-chain, not credited", confidence: "High", foundChain: "tron", token: "USDT", amount: "1.00" }]);
    expect(out).toBe("line,tx_hash,stated_chain,found_chain,customer_id,customer_from_file_a,state,verdict_code,verdict,confidence,token,amount,note\n" +
      "2,ab,,tron,C-1,yes,verdict,D12,\"Arrived on-chain, not credited\",High,USDT,1.00,\n");
  });
});
