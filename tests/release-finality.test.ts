// S1 (c) finality (gap G1): "final" only when the transaction is, right now, canonical at or below the
// chain's own finality signal. Tron: solidified head, then the solidity node's view of the transaction.
// EVM: the `finalized` head, then the receipt re-read uncached and checked canonical by block hash.
// Error, timeout, malformed answer, moved or missing transaction → never passed.
// Real recordings replayed offline (ADR 0003, never hand-edited, key redacted). Re-record:
//   RECORD_FINALITY=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/release-finality.test.ts
// (ETHERSCAN_API_KEY set, so Ethereum goes through Etherscan V2 as in production.)
// Tests marked "synthetic" use a stub transport to exercise the parser and the canonical-block
// comparison; they are not recordings and don't stand for real chain answers.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchTransport, type HttpRequest, type Transport } from "@/lib/chain/http";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import type { Recording } from "@/lib/demo/recordings";
import { readFinality, readFinalityFromRecordings, type FinalityQuery } from "@/lib/requests/finality";
import { releaseHeadline, sgtTime, type ReleaseChecks } from "@/lib/requests/release-checks";
import { redactUrl, replayTransport, type Exchange } from "./fixtures/live/replay";

const TRN01 = "5296e24018c9197bbf4e7e844c7152ca494067400a5a06f351c66aad7d3873cb"; // tests/real_cases.json TRN-01, block 87,393,445
const ETH01 = "0xf70dab272206053e0e44c35db3891e5d72c3410fc26fcdfc9949193d4ce605da";
const NO_SUCH_TX = "0".repeat(63) + "1";
const CASES: Record<string, FinalityQuery> = {
  "FINALITY-TRON": { chain: "tron", hash: TRN01, blockNumber: 87_393_445 },
  "FINALITY-TRON-NOT-SOLID": { chain: "tron", hash: NO_SUCH_TX, blockNumber: 87_393_445 },
  "FINALITY-ETH-ETHERSCAN": { chain: "ethereum", hash: ETH01, blockNumber: 23_650_000 },
  // tests/real_cases.json FRZ-TF1: a USDT transfer from a blacklisted sender that hit REVERT, block 87,366,298.
  "FINALITY-TRON-REVERTED": { chain: "tron", hash: "f6973c9c864818871aa63eceb9ab9098e1cd3588abdaa37d044c764852478abd", blockNumber: 87_366_298 },
};
const file = (name: string) => path.join(__dirname, "fixtures", "real", `${name}.json`);
const load = (name: string) => JSON.parse(readFileSync(file(name), "utf8")) as Recording;
const depsFor = (transport: Transport, etherscanKey = "replay", live = false) =>
  buildFetchers({ tronKey: "", etherscanKey, store: new MemoryStore(), transport, noSpacing: !live, ...(live ? {} : { sleep: async () => {} }) });
/** The solidified head as the recording's raw body says (read independently of the code under test). */
const recordedSolid = () => JSON.parse(load("FINALITY-TRON").exchanges[0].response.body).block_header.raw_data.number as number;
const others: Omit<ReleaseChecks, "finality"> = {
  token: { state: "passed", detail: "Tether's USDT contract on Tron." }, amount: { state: "passed", detail: "Exactly 100 USDT." },
  sanctions: { state: "not_run", list: "OFAC SDN", detail: "No copy of the OFAC sanctions list is loaded, so the sender wasn't checked." },
  freeze: { state: "passed", issuer: "Tether", detail: "Neither the sender nor the receiving address is frozen by Tether; this can change later." },
};
const replay = (name: string, q: Partial<FinalityQuery> = {}) => {
  const rec = load(name);
  return readFinality(depsFor(replayTransport(rec as never)), { ...CASES[name], ...q }, () => new Date(rec.recordedAt));
};

describe.skipIf(!process.env.RECORD_FINALITY)("record finality reads", () => {
  for (const name of Object.keys(CASES)) {
    it(name, async () => {
      const exchanges: Exchange[] = [];
      const transport: Transport = async (req) => {
        const res = await fetchTransport(req);
        exchanges.push({ request: { method: req.method, url: redactUrl(req.url), body: req.body }, response: { status: res.status, headers: {}, body: res.body } });
        return res;
      };
      const recordedAt = new Date().toISOString();
      await readFinality(depsFor(transport, process.env.ETHERSCAN_API_KEY ?? "", true), CASES[name], () => new Date(recordedAt));
      await new Promise((r) => setTimeout(r, 1500));
      writeFileSync(file(name), JSON.stringify({ name, hash: CASES[name].hash, explorer: CASES[name].chain === "tron" ? `https://tronscan.org/#/transaction/${CASES[name].hash}` : `https://etherscan.io/tx/${CASES[name].hash}`, ...(name === "FINALITY-TRON-NOT-SOLID" ? { label: "lookup of a made-up hash, not a real payment" } : {}), recordedAt, exchanges }));
    }, 60_000);
  }
});

describe.skipIf(!!process.env.RECORD_FINALITY)("finality, replayed from real recordings", () => {
  it("Tron TRN-01: on the solidity node, at/below the solidified head → passed, plain words, numbers in technical", async () => {
    const c = await replay("FINALITY-TRON");
    expect(c).toMatchObject({ state: "passed", blockNumber: 87_393_445, finalizedBlock: recordedSolid(), checkedAt: load("FINALITY-TRON").recordedAt });
    expect(c.detail).toBe("Tron reports this payment as final.");
    expect(c.technical).toMatch(/In block 87393445; the network had finalized up to block \d+/);
    expect(c.source).toMatch(/walletsolidity/);
    expect(releaseHeadline({ ...others, finality: c }).headline).toBe("Paid and final. Right token and amount. Sender NOT checked. Not frozen.");
  });

  it("the re-read finds the transaction in a DIFFERENT block from the earlier lookup → not_run, look it up again", async () => {
    const c = await replay("FINALITY-TRON", { blockNumber: 87_393_444 });
    expect(c.state).toBe("not_run");
    expect(c.detail).toMatch(/look it up again/);
    expect(c.technical).toMatch(/Earlier lookup saw block 87393444, now in block 87393445/);
  });

  it("Tron: a REVERTed transaction (FRZ-TF1, real) is never final-and-paid → not_run, look it up again", async () => {
    const rec = load("FINALITY-TRON-REVERTED");
    expect(rec.exchanges.at(-1)!.response.body).toMatch(/"REVERT"/);
    const c = await replay("FINALITY-TRON-REVERTED");
    expect(c.state).toBe("not_run");
    expect(c.detail).toMatch(/look it up again/);
  });

  it("Tron: a transaction the solidity node doesn't have (dropped, replaced or not yet irreversible) → pending, never passed", async () => {
    const rec = load("FINALITY-TRON-NOT-SOLID");
    expect(rec.exchanges.at(-1)!.response.body.trim()).toBe("{}");
    const c = await replay("FINALITY-TRON-NOT-SOLID");
    expect(c.state).toBe("pending");
    expect(releaseHeadline({ ...others, finality: c })).toMatchObject({ tone: "not_yet", headline: "Not final yet." });
  });

  it("Ethereum through Etherscan V2: its proxy refuses the `finalized` tag (recorded) → not_run, and no transaction read is attempted", async () => {
    const rec = load("FINALITY-ETH-ETHERSCAN");
    expect(rec.exchanges).toHaveLength(1);
    expect(rec.exchanges[0].response.body).toMatch(/invalid hex string/);
    const c = await replay("FINALITY-ETH-ETHERSCAN");
    expect(c.state).toBe("not_run");
    expect(releaseHeadline({ ...others, finality: c })).toMatchObject({ tone: "not_yet", headline: "Finality NOT checked." });
  });

  it("provider error or timeout → not_run on both chains", async () => {
    const down: Transport = async () => { throw new Error("ETIMEDOUT"); };
    for (const chain of ["tron", "ethereum"] as const) {
      expect((await readFinality(depsFor(down), { chain, hash: TRN01, blockNumber: 5 })).state).toBe("not_run");
    }
  });

  it("not in a block yet → pending, and no call is made", async () => {
    const none: Transport = async () => { throw new Error("must not be called"); };
    expect((await readFinality(depsFor(none), { chain: "tron", hash: TRN01 })).state).toBe("pending");
  });
});

describe.skipIf(!!process.env.RECORD_FINALITY)("QA #68 (2 Nov)", () => {
  it("a provider layer that throws (not just a failed request) → not_run, never an exception", async () => {
    const boom = () => { throw new Error("provider bug"); };
    const deps = { tron: { solidifiedBlock: boom, solidTxBlock: boom }, evm: { finalizedBlock: boom, canonicalBlock: boom } } as unknown as Parameters<typeof readFinality>[0];
    for (const chain of ["tron", "ethereum"] as const) {
      await expect(readFinality(deps, { chain, hash: TRN01, blockNumber: 5 })).resolves.toMatchObject({ state: "not_run" });
    }
  });

  it("every finality recording names its explorer page; the made-up-hash one says so", () => {
    for (const name of Object.keys(CASES)) expect(load(name).explorer).toMatch(/^https:\/\/(etherscan\.io|tronscan\.org)\//);
    expect((load("FINALITY-TRON-NOT-SOLID") as Recording & { label?: string }).label).toBe("lookup of a made-up hash, not a real payment");
  });

  it("an unreadable recording time is left out of the line, never \"NaN\"", async () => {
    const rec = { ...load("FINALITY-TRON"), recordedAt: "not a time" };
    const c = await readFinalityFromRecordings([rec], CASES["FINALITY-TRON"]);
    expect(c.detail).not.toMatch(/NaN/);
  });
});

describe("synthetic: malformed answers and reorgs are never passed", () => {
  const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  /** Keyless JSON-RPC (no Etherscan key), answering by method. */
  const rpc = (answers: Record<string, unknown | ((params: unknown[]) => unknown)>): Transport => async (req: HttpRequest) => {
    const { method, params } = JSON.parse(req.body ?? "{}");
    const a = answers[method];
    return { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: typeof a === "function" ? (a as (p: unknown[]) => unknown)(params) : a }) };
  };
  const eth = (t: Transport) => readFinality(depsFor(t, ""), { chain: "ethereum", hash: ETH01, blockNumber: 100 });
  const finalized = { number: "0x100", hash: H(0xf) };

  it("EVM: receipt block ≤ finalized and its hash is the canonical block's → passed", async () => {
    const c = await eth(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? finalized : { hash: H(1) }), eth_getTransactionReceipt: { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x1" } }));
    expect(c).toMatchObject({ state: "passed", blockNumber: 100, finalizedBlock: 256 });
  });
  it("EVM: reorged — the canonical block at that height has another hash → not_run", async () => {
    const c = await eth(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? finalized : { hash: H(2) }), eth_getTransactionReceipt: { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x1" } }));
    expect(c.state).toBe("not_run");
  });
  it("EVM: receipt status 0x0 (reverted) → not_run", async () => {
    const c = await eth(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? finalized : { hash: H(1) }), eth_getTransactionReceipt: { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x0" } }));
    expect(c.state).toBe("not_run");
  });
  it("EVM: a receipt for a different transaction hash, a missing status, or an unsafe block number → not_run", async () => {
    for (const r of [
      { transactionHash: H(9), blockNumber: "0x64", blockHash: H(1), status: "0x1" },
      { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1) },
      { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x2" },
      { transactionHash: ETH01, blockNumber: "0xffffffffffffffffff", blockHash: H(1), status: "0x1" },
    ]) {
      expect((await eth(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? finalized : { hash: H(1) }), eth_getTransactionReceipt: r }))).state).toBe("not_run");
    }
  });
  it("EVM: ONE store shared by two checks; the second re-read finds no receipt → not_run (nothing is served from cache)", async () => {
    let receipt: unknown = { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x1" };
    const deps = depsFor(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? finalized : { hash: H(1) }), eth_getTransactionReceipt: () => receipt }), "");
    const q: FinalityQuery = { chain: "ethereum", hash: ETH01, blockNumber: 100 };
    expect((await readFinality(deps, q)).state).toBe("passed");
    receipt = null;
    expect((await readFinality(deps, q)).state).toBe("not_run");
  });
  it("EVM: reorged out — no receipt any more → not_run", async () => {
    expect((await eth(rpc({ eth_getBlockByNumber: finalized, eth_getTransactionReceipt: null }))).state).toBe("not_run");
  });
  it("EVM: malformed finalized answers → not_run", async () => {
    for (const bad of [null, {}, { number: "256" }, { number: "0x100" }, { number: "0x100", hash: "0x12" }, "0x100"]) {
      const c = await eth(rpc({ eth_getBlockByNumber: (p: unknown[]) => (p[0] === "finalized" ? bad : { hash: H(1) }), eth_getTransactionReceipt: { transactionHash: ETH01, blockNumber: "0x64", blockHash: H(1), status: "0x1" } }));
      expect(c.state).toBe("not_run");
    }
  });
  it("Tron: malformed solidified-head answers → not_run (number must match the blockID's first 8 bytes)", async () => {
    const good = JSON.parse(load("FINALITY-TRON").exchanges[0].response.body);
    const n = good.block_header.raw_data.number as number;
    const bodies = [
      { ...good, block_header: { raw_data: { number: n + 1 } } },
      { ...good, blockID: undefined },
      { blockID: good.blockID, block_header: { raw_data: { number: String(n) } } },
      { block_header: { raw_data: { number: 0 } }, blockID: "0".repeat(64) },
      { Error: "something" },
    ];
    for (const b of bodies) {
      const t: Transport = async (req) => ({ status: 200, headers: {}, body: req.url.endsWith("getnowblock") ? JSON.stringify(b) : JSON.stringify({ id: TRN01, blockNumber: 87_393_445, receipt: { result: "SUCCESS" } }) });
      expect((await readFinality(depsFor(t), CASES["FINALITY-TRON"])).state).toBe("not_run");
    }
  });
  it("Tron: a solidity answer for a different transaction id → not_run", async () => {
    const head = load("FINALITY-TRON").exchanges[0].response.body;
    const t: Transport = async (req) => ({ status: 200, headers: {}, body: req.url.endsWith("getnowblock") ? head : JSON.stringify({ id: NO_SUCH_TX, blockNumber: 87_393_445, receipt: { result: "SUCCESS" } }) });
    expect((await readFinality(depsFor(t), CASES["FINALITY-TRON"])).state).toBe("not_run");
  });
});

describe.skipIf(!!process.env.RECORD_FINALITY)("demo: finality fed from one recording, labelled with that recording's time", () => {
  it("the recording that read finality AND this transaction answers, in plain words, labelled with its own SGT time", async () => {
    const rec = load("FINALITY-TRON");
    const c = await readFinalityFromRecordings([rec, load("FINALITY-TRON-NOT-SOLID"), load("ETH-01")], CASES["FINALITY-TRON"]);
    expect(c).toMatchObject({ state: "passed", checkedAt: rec.recordedAt });
    expect(c.detail).toBe(`Tron reports this payment as final. (recorded ${sgtTime(rec.recordedAt)}, not a live read)`);
  });

  it("a newer recording on another chain, or one without this transaction, doesn't change the label", async () => {
    const tron = load("FINALITY-TRON"), eth = load("FINALITY-ETH-ETHERSCAN");
    expect(Date.parse(eth.recordedAt)).toBeGreaterThan(Date.parse(tron.recordedAt));
    const c = await readFinalityFromRecordings([eth, tron], CASES["FINALITY-TRON"]);
    expect(c.checkedAt).toBe(tron.recordedAt);
  });

  it("today's demo recordings hold only the latest head, never a finality read → not_run (no guessing from confirmations)", async () => {
    const c = await readFinalityFromRecordings([load("ETH-01"), load("TRN-01")], { chain: "tron", hash: TRN01, blockNumber: 87_393_445 });
    expect(c.state).toBe("not_run");
    expect(c.detail).toMatch(/no finality read/i);
  });
});
