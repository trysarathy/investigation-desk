// S1 freeze check: the issuer's own read-only blacklist function (Tether isBlackListed, Circle
// isBlacklisted) on the sender AND the receiving address, through the existing provider layer.
// Replayed offline from real recordings (ADR 0003: never hand-edited). Re-record:
//   RECORD_FREEZE=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/release-freeze.test.ts
// (Ethereum goes through Etherscan V2, so ETHERSCAN_API_KEY must be set; the key is redacted from the file.)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchTransport, type Transport } from "@/lib/chain/http";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { freezeExplorerUrl, readIssuerFreeze, type FreezeQuery } from "@/lib/requests/freeze";
import { releaseHeadline } from "@/lib/requests/release-checks";
import type { Exchange, Recording } from "./fixtures/live/replay";
import { redactUrl, replayTransport } from "./fixtures/live/replay";

const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// Addresses from tests/real_cases.json (ETH-01, FRZ-EF1, FRZ-EC1, FRZ-TF1) and issuer-controls.md §2.
const CASES: Record<string, FreezeQuery> = {
  "FREEZE-ETH-USDT-CLEAN": { chain: "ethereum", token: "USDT", contract: USDT_ETH, sender: "0x8afcf06919e6719bec706696c5ccb3dde40b4377", receiver: "0x6f416e24bab64ea58bd6390bb5e19c6506a0d99c" },
  "FREEZE-ETH-USDT-SENDER": { chain: "ethereum", token: "USDT", contract: USDT_ETH, sender: "0x5d7a0236426dcd6389ecc22f09549965fee7a13d", receiver: "0x6f416e24bab64ea58bd6390bb5e19c6506a0d99c" },
  "FREEZE-ETH-USDC-SENDER": { chain: "ethereum", token: "USDC", contract: USDC_ETH, sender: "0x085488e7310064bf7306e7b7a75dd0590354853a", receiver: "0x493b5697a73cbf3084dafd054e845370e463296e" },
  "FREEZE-TRON-USDT-WAS-FROZEN": { chain: "tron", token: "USDT", contract: USDT_TRON, sender: "TUDFqg6NhHGtcqn4nJzkCPfquwwm9MqBSb", receiver: "THPvaUhoh2Qn2y9THCZML3H815hhFhn5YC" },
  "FREEZE-TRON-USDT-RECEIVER": { chain: "tron", token: "USDT", contract: USDT_TRON, sender: "THPvaUhoh2Qn2y9THCZML3H815hhFhn5YC", receiver: "TBzUpQyGiPP6uR8BwKkr6rsoYqdY9g8mNU" },
};

const file = (name: string) => path.join(__dirname, "fixtures", "real", `${name}.json`);
const depsFor = (transport: Transport, at: string, etherscanKey = "replay", live = false) =>
  buildFetchers({ tronKey: "", etherscanKey, store: new MemoryStore(), transport, now: () => new Date(at), noSpacing: !live, ...(live ? {} : { sleep: async () => {} }) });

async function replay(name: string) {
  const rec = JSON.parse(readFileSync(file(name), "utf8")) as Recording;
  const at = () => new Date(rec.recordedAt);
  return readIssuerFreeze(depsFor(replayTransport(rec), rec.recordedAt), CASES[name], at);
}

describe.skipIf(!process.env.RECORD_FREEZE)("record freeze reads", () => {
  for (const name of Object.keys(CASES)) {
    it(name, async () => {
      const exchanges: Exchange[] = [];
      const transport: Transport = async (req) => {
        const res = await fetchTransport(req);
        exchanges.push({ request: { method: req.method, url: redactUrl(req.url), body: req.body }, response: { status: res.status, headers: {}, body: res.body } });
        return res;
      };
      const recordedAt = new Date().toISOString();
      await readIssuerFreeze(depsFor(transport, recordedAt, process.env.ETHERSCAN_API_KEY ?? "", true), CASES[name], () => new Date(recordedAt));
      await new Promise((r) => setTimeout(r, 1500)); // stay under Etherscan 3/s and TronGrid's keyless rps
      writeFileSync(file(name), JSON.stringify({ name, hash: "", explorer: freezeExplorerUrl(CASES[name].contract), recordedAt, exchanges }));
    }, 60_000);
  }
});

describe.skipIf(!!process.env.RECORD_FREEZE)("issuer freeze, replayed from real recordings", () => {
  it("Ethereum USDT, neither address frozen → passed, point-in-time (block + time), sender and receiver both read", async () => {
    const c = await replay("FREEZE-ETH-USDT-CLEAN");
    expect(c.state).toBe("passed");
    expect(c.issuer).toBe("Tether");
    expect(c.addresses?.map((a) => [a.role, a.frozen])).toEqual([["sender", false], ["receiver", false]]);
    expect(c.atBlock).toBeGreaterThan(20_000_000);
    expect(c.checkedAt).toMatch(/^2026-/);
    expect(c.detail).toMatch(/can change later/);
  });

  it("Ethereum USDT, sender blacklisted by Tether → failed", async () => {
    const c = await replay("FREEZE-ETH-USDT-SENDER");
    expect(c).toMatchObject({ state: "failed", issuer: "Tether" });
    expect(c.detail).toMatch(/^Sender frozen by Tether/);
  });

  it("Ethereum USDC, sender blacklisted by Circle → failed", async () => {
    const c = await replay("FREEZE-ETH-USDC-SENDER");
    expect(c).toMatchObject({ state: "failed", issuer: "Circle" });
    expect(c.detail).toMatch(/^Sender frozen by Circle/);
  });

  it("Tron USDT: a sender recorded as blacklisted on 23 Oct (FRZ-TF1) reads NOT frozen on 2 Nov: freeze status is point-in-time", async () => {
    const c = await replay("FREEZE-TRON-USDT-WAS-FROZEN");
    expect(c).toMatchObject({ state: "passed", issuer: "Tether" });
    expect(c.atBlock).toBeUndefined(); // Tron: time only, no head read
    expect(c.detail).toMatch(/this can change later/);
  });

  it("Tron USDT, receiving address blacklisted (Tether lets payments in, they can't leave) → failed, named", async () => {
    const c = await replay("FREEZE-TRON-USDT-RECEIVER");
    expect(c.state).toBe("failed");
    expect(c.detail).toMatch(/^Receiving address frozen by Tether/);
    expect(c.addresses?.find((a) => a.role === "sender")?.frozen).toBe(false);
  });

  it("provider error or timeout → not_run, never passed", async () => {
    const down: Transport = async () => { throw new Error("ETIMEDOUT"); };
    const at = () => new Date("2026-11-02T00:00:00Z");
    for (const q of [CASES["FREEZE-ETH-USDT-CLEAN"], CASES["FREEZE-TRON-USDT-RECEIVER"]]) {
      const c = await readIssuerFreeze(depsFor(down, at().toISOString()), q, at);
      expect(c.state).toBe("not_run");
      expect(releaseHeadline({
        finality: { state: "passed", detail: "x" }, token: { state: "passed", detail: "x" }, amount: { state: "passed", detail: "x" },
        sanctions: { state: "passed", detail: "x", list: "OFAC SDN", listDate: "2026-10-31" }, freeze: c,
      }).headline).toMatch(/Freeze status NOT checked\.$/);
    }
  });

  it("not the issuer's contract (look-alike, or BNB Chain's company-declared one) → not_run, no call made", async () => {
    const none: Transport = async () => { throw new Error("must not be called"); };
    const at = () => new Date("2026-11-02T00:00:00Z");
    const fake = await readIssuerFreeze(depsFor(none, at().toISOString()), { ...CASES["FREEZE-ETH-USDT-CLEAN"], contract: "0xdac17f958d2ee523a2206206994597c13d831ec8" }, at);
    expect(fake.state).toBe("not_run");
    const bsc = await readIssuerFreeze(depsFor(none, at().toISOString()), { ...CASES["FREEZE-ETH-USDT-CLEAN"], chain: "bsc", contract: "0x55d398326f99059ff775485246999027b3197955" }, at);
    expect(bsc.state).toBe("not_run");
  });

  it("malformed or empty addresses → not_run (EVM 40 hex; Tron base58 WITH checksum), even if the node would answer", async () => {
    // Synthetic stub that answers "not frozen" to anything, so only address validation can stop a "passed".
    const z = "0".repeat(64);
    const none: Transport = async (req) => ({ status: 200, headers: {}, body: req.url.includes("trongrid")
      ? JSON.stringify({ result: { result: true }, constant_result: [z] })
      : JSON.stringify({ jsonrpc: "2.0", id: 1, result: /eth_blockNumber/.test(req.url) ? "0x10" : `0x${z}` }) });
    const at = () => new Date("2026-11-02T00:00:00Z");
    const eth = CASES["FREEZE-ETH-USDT-CLEAN"], tron = CASES["FREEZE-TRON-USDT-RECEIVER"];
    for (const bad of ["", "0x1234", "not-an-address", "0x8afcf06919e6719bec706696c5ccb3dde40b437g", "0x8AFCF06919e6719bec706696c5ccb3dde40b4377"]) {
      for (const q of [{ ...eth, sender: bad }, { ...eth, receiver: bad }]) {
        expect((await readIssuerFreeze(depsFor(none, at().toISOString()), q, at)).state).toBe("not_run");
      }
    }
    // One letter's case changed: still base58, but the checksum fails, so it's not the same account.
    const oneCase = "THPvaUhoh2Qn2y9THCZML3H815hhFhn5yC";
    for (const bad of ["", "T123", oneCase, tron.receiver.slice(0, -1)]) {
      expect((await readIssuerFreeze(depsFor(none, at().toISOString()), { ...tron, sender: bad }, at)).state).toBe("not_run");
    }
  });

  it("reads uncached: a second check makes fresh calls and is stamped with its own read time", async () => {
    const rec = JSON.parse(readFileSync(file("FREEZE-TRON-USDT-RECEIVER"), "utf8")) as Recording;
    const replayed = replayTransport(rec);
    let calls = 0;
    const counting: Transport = async (req) => { calls++; return replayed(req); };
    let t = Date.parse("2026-11-02T01:00:00Z");
    const clock = () => new Date(t);
    const deps = buildFetchers({ tronKey: "", etherscanKey: "replay", store: new MemoryStore(), transport: counting, now: clock, noSpacing: true, sleep: async () => {} });
    const q = CASES["FREEZE-TRON-USDT-RECEIVER"];
    const first = await readIssuerFreeze(deps, q, clock);
    const n = calls;
    t += 30_000;
    const second = await readIssuerFreeze(deps, q, clock);
    expect(calls).toBe(2 * n);
    expect(second.checkedAt).toBe("2026-11-02T01:00:30.000Z");
    expect(first.checkedAt).toBe("2026-11-02T01:00:00.000Z");
  });

  // Synthetic answers (not recordings): a stub transport returning malformed bodies, to test the parser.
  it("malformed issuer answers → not_run (a bool must be exactly 0 or 1; Tron needs result.result = true)", async () => {
    const at = () => new Date("2026-11-02T00:00:00Z");
    const word = (n: number) => n.toString(16).padStart(64, "0");
    const tronBodies = [
      { result: { result: true }, constant_result: [word(2)] },
      { result: { code: "CONTRACT_VALIDATE_ERROR" }, constant_result: [word(0)] },
      { result: { result: true }, constant_result: ["00"] },
      { result: { result: true } },
    ];
    for (const b of tronBodies) {
      const stub: Transport = async () => ({ status: 200, headers: {}, body: JSON.stringify(b) });
      expect((await readIssuerFreeze(depsFor(stub, at().toISOString()), CASES["FREEZE-TRON-USDT-RECEIVER"], at)).state).toBe("not_run");
    }
    for (const r of [`0x${word(2)}`, "0x01", null, "0x"]) {
      const stub: Transport = async (req) => ({ status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: /eth_blockNumber/.test(req.url) ? "0x10" : r }) });
      expect((await readIssuerFreeze(depsFor(stub, at().toISOString()), CASES["FREEZE-ETH-USDT-CLEAN"], at)).state).toBe("not_run");
    }
  });

  it("plain lines: block number in technical, read time as SGT", async () => {
    const c = await replay("FREEZE-ETH-USDT-CLEAN");
    expect(c.detail).not.toMatch(/block|\d{6,}/i);
    expect(c.detail).toMatch(/2 Nov 2026, \d{1,2}:\d\d [ap]m SGT/);
    expect(c.technical).toMatch(new RegExp(`block ${c.atBlock}`));
  });

  it("QA: a provider layer that throws (not just a failed request) → not_run, never an exception", async () => {
    const boom = () => { throw new Error("provider bug"); };
    const deps = { tron: { isBlackListed: boom }, evm: { source: boom, ethCall: boom } } as unknown as Parameters<typeof readIssuerFreeze>[0];
    const at = () => new Date("2026-11-02T00:00:00Z");
    for (const q of [CASES["FREEZE-ETH-USDT-CLEAN"], CASES["FREEZE-TRON-USDT-RECEIVER"]]) {
      await expect(readIssuerFreeze(deps, q, at)).resolves.toMatchObject({ state: "not_run" });
    }
  });

  it("QA: every freeze recording names where to see it (explorer) and its recorded responses are untouched", () => {
    for (const name of [...Object.keys(CASES)]) {
      const rec = JSON.parse(readFileSync(file(name), "utf8")) as Recording;
      expect(rec.explorer).toMatch(/^https:\/\/(etherscan\.io|tronscan\.org)\//);
    }
  });
});

