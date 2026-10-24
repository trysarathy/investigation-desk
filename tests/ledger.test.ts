import { tronAddress } from "@/lib/fixtures/gen";
// Week 4: the ledger join (D12–D18) on uploaded Files A and B, against real recorded chain data.
// The files go through the same validator and workspace store as an upload from Settings.

import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/chain/investigate";
import { validateFileA, validateFileB } from "@/lib/csv/files";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { fillReply } from "@/lib/templates";
import { applyUpload, MemoryWorkspaceStore } from "@/lib/workspace/store";
import { replayFacts } from "./fixtures/live/harness";

// Real transfer: 49,975,000 USDT, Bitfinex -> TKHuVq…fQgFs, Tron event index 0, mined 2024-11-13T00:29:36Z.
const TX = "tron-bitfinex-to-tether-treasury";
const HASH = "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064";
const DEST = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const A_HEAD = "address,chain,customer_id,assigned_at,retired_at";
const B_HEAD = "deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index,reason_code";
const enc = (s: string) => new TextEncoder().encode(s);

async function upload(fileA: string[], fileB: string[], customerId?: string): Promise<Workspace> {
  const store = new MemoryWorkspaceStore();
  const now = new Date("2026-10-22T09:00:00Z");
  await applyUpload(store, "A", "a.csv", validateFileA(enc([A_HEAD, ...fileA].join("\n"))), now);
  await applyUpload(store, "B", "b.csv", validateFileB(enc([B_HEAD, ...fileB].join("\n"))), now);
  const d = await store.load();
  return {
    customerId, depositAddresses: d.fileA!.rows, ledger: d.fileB!.rows, ledgerUploadedAt: d.fileB!.upload.uploadedAt,
    fileARejectedRows: d.fileA!.upload.rejectedRows, fileBRejectedRows: d.fileB!.upload.rejectedRows,
  };
}

const ownedByMe = `${DEST},tron,C-ME,2024-01-01T00:00:00Z,`;
const run = async (ws: Workspace, name = TX) => {
  const facts = await replayFacts(name, ws, SAMPLE_SETTINGS);
  return { facts, v: investigate(facts, SAMPLE_SETTINGS) };
};

describe("ledger join on uploaded files, real chain data", () => {
  it("D12 High: confirmed to this customer's address, no ledger row", async () => {
    const { v } = await run(await upload([ownedByMe], [], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D12", "High"]);
  });

  it("D13 High: exact match on chain + tx_hash + transfer_index + token", async () => {
    const { v } = await run(await upload([ownedByMe],
      [`DEP-1,${HASH},tron,USDT,${DEST},49975000.000000,CREDITED,2024-11-13T00:40:00Z,C-ME,0,`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D13", "High"]);
    expect(fillReply(v.code, v.fill)!.text).toBe("Your deposit of 49975000.000000 USDT was credited on 2024-11-13 08:40 SGT. You can see it under Wallet > Transaction history.");
  });

  it("a row whose transfer_index points at another event is not this credit: D12", async () => {
    const { v } = await run(await upload([ownedByMe],
      [`DEP-1,${HASH},tron,USDT,${DEST},49975000.000000,CREDITED,2024-11-13T00:40:00Z,C-ME,3,`], "C-ME"));
    expect(v.code).toBe("D12");
  });

  it("D14 High: HELD row", async () => {
    const { v } = await run(await upload([ownedByMe], [`DEP-1,${HASH},tron,USDT,${DEST},49975000.000000,HELD,,C-ME,0,`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D14", "High"]);
  });

  it("D16 High: REJECTED row, with the reason code as evidence", async () => {
    const { v } = await run(await upload([ownedByMe], [`DEP-1,${HASH},tron,USDT,${DEST},49975000.000000,REJECTED,,C-ME,0,R-207`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D16", "High"]);
    expect(v.evidence.find((e) => e.id === "ev.ledger")!.detail).toContain("Reason code R-207");
  });

  it("D17 High: the address belonged to another customer at block time", async () => {
    // The reporting customer has an address of their own (real-data test, 24 Oct: without one, D17 is Medium).
    const mine = `${tronAddress("C-ME")},tron,C-ME,2024-01-01T00:00:00Z,`;
    const { v } = await run(await upload([`${DEST},tron,C-OTHER,2024-01-01T00:00:00Z,`, mine], [], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D17", "High"]);
    expect(JSON.stringify(v.evidence)).not.toContain("C-OTHER");
  });

  it("D17 Medium when the reporting customer has no address in File A (likely a mistyped customer ID)", async () => {
    const { v } = await run(await upload([`${DEST},tron,C-OTHER,2024-01-01T00:00:00Z,`], [], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D17", "Medium"]);
  });

  it("D18 High: the address was retired before the transfer was mined", async () => {
    const { v } = await run(await upload([`${DEST},tron,C-ME,2024-01-01T00:00:00Z,2024-06-01T00:00:00Z`], [], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D18", "High"]);
  });

  it("an address-and-amount-only PENDING row for this customer caps D12 at Medium", async () => {
    const { v } = await run(await upload([ownedByMe], [`DEP-1,,tron,USDT,${DEST},49975000.000000,PENDING,,C-ME,,`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D12", "Medium"]);
  });

  it("an earlier CREDITED row with the same address and amount is not this credit", async () => {
    const { v } = await run(await upload([ownedByMe],
      [`DEP-0,,tron,USDT,${DEST},49975000.000000,CREDITED,2024-10-01T00:00:00Z,C-ME,,`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D12", "High"]);
  });
});

describe("rejected upload rows are unknown facts", () => {
  it("a rejected ledger row caps D12 at Medium and says why", async () => {
    const { v } = await run(await upload([ownedByMe], [`DEP-X,${HASH},tron,USDT,${DEST},1e3,CREDITED,,C-ME,,`], "C-ME"));
    expect([v.code, v.confidence]).toEqual(["D12", "Medium"]);
    expect(v.checks.find((c) => c.code === "D12")!.reason).toMatch(/1 ledger row\(s\) were rejected at upload/);
  });

  it("a rejected File A row caps D07 at Medium", async () => {
    const { v } = await run(await upload([ownedByMe, "not-an-address,tron,C-1,2024-01-01T00:00:00Z,"], [], "C-ME"),
      "tron-tether-treasury-to-binance");
    expect([v.code, v.confidence]).toEqual(["D07", "Medium"]);
  });
});

describe("customer for a pasted hash", () => {
  it("is taken from File A's owner at block time, and the evidence says so", async () => {
    const { facts, v } = await run(await upload([`${DEST},tron,C-55,2024-01-01T00:00:00Z,`], []));
    expect(facts.customerId).toBe("C-55");
    expect(facts.customerInferredFromRow).toBe(2);
    expect(v.code).toBe("D12");
    expect(v.evidence.find((e) => e.id === "ev.input")!.value).toBe(
      "Customer C-55, taken from File A line 2 (owner of the destination when the transfer was mined)");
  });

  it("is not inferred when nobody held the address at that time", async () => {
    const { facts, v } = await run(await upload([`${DEST},tron,C-55,2025-01-01T00:00:00Z,`], []));
    expect(facts.customerId).toBeUndefined();
    expect(v.code).not.toBe("D12");
  });
});
