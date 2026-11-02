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
import { readIssuerFreeze, type FreezeQuery } from "@/lib/requests/freeze";
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
      writeFileSync(file(name), JSON.stringify({ name, hash: "", explorer: "", recordedAt, exchanges }));
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
});
