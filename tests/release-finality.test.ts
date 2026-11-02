// S1 finality (gap G1): "final" only when the payment's block is at or below the chain's own finality
// signal, read through the provider layer. Tron: solidified block (TronGrid /walletsolidity/getnowblock).
// Ethereum: the `finalized` block tag (eth_getBlockByNumber). Error/timeout/odd answer → not_run.
// Replayed offline from real recordings (ADR 0003, never hand-edited). Re-record:
//   RECORD_FINALITY=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/release-finality.test.ts
// (ETHERSCAN_API_KEY set, so Ethereum goes through Etherscan V2 as in production; the key is redacted.)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchTransport, type Transport } from "@/lib/chain/http";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import type { Recording } from "@/lib/demo/recordings";
import { readFinality, readFinalityFromRecordings } from "@/lib/requests/finality";
import { releaseHeadline, type ReleaseChecks } from "@/lib/requests/release-checks";
import { confirmPace } from "@/lib/requests/status";
import { redactUrl, replayTransport, type Exchange } from "./fixtures/live/replay";

const NAMES = { tron: "FINALITY-TRON", ethereum: "FINALITY-ETH-ETHERSCAN" } as const;
const file = (name: string) => path.join(__dirname, "fixtures", "real", `${name}.json`);
const load = (name: string) => JSON.parse(readFileSync(file(name), "utf8")) as Recording;
const depsFor = (transport: Transport, etherscanKey = "replay", live = false) =>
  buildFetchers({ tronKey: "", etherscanKey, store: new MemoryStore(), transport, noSpacing: !live, ...(live ? {} : { sleep: async () => {} }) });
/** The solidified head as the recording itself says, read from the raw body (not from the code under test). */
const recordedSolid = () => JSON.parse(load(NAMES.tron).exchanges[0].response.body).block_header.raw_data.number as number;
const ETA = `Confirming (5 of 20 at the last check): Tron usually takes ${confirmPace("tron")}; look the payment up again to update it.`;
const others: Omit<ReleaseChecks, "finality"> = {
  token: { state: "passed", detail: "Tether's USDT contract on Tron." }, amount: { state: "passed", detail: "Exactly 100 USDT." },
  sanctions: { state: "not_run", list: "OFAC SDN", detail: "No copy of the OFAC sanctions list is loaded, so the sender wasn't checked." },
  freeze: { state: "passed", issuer: "Tether", detail: "Neither the sender nor the receiving address is frozen by Tether; this can change later." },
};

describe.skipIf(!process.env.RECORD_FINALITY)("record finality heads", () => {
  for (const chain of ["tron", "ethereum"] as const) {
    it(chain, async () => {
      const exchanges: Exchange[] = [];
      const transport: Transport = async (req) => {
        const res = await fetchTransport(req);
        exchanges.push({ request: { method: req.method, url: redactUrl(req.url), body: req.body }, response: { status: res.status, headers: {}, body: res.body } });
        return res;
      };
      const recordedAt = new Date().toISOString();
      await readFinality(depsFor(transport, process.env.ETHERSCAN_API_KEY ?? "", true), { chain, blockNumber: 1 }, () => new Date(recordedAt));
      writeFileSync(file(NAMES[chain]), JSON.stringify({ name: NAMES[chain], hash: "", explorer: "", recordedAt, exchanges }));
    }, 60_000);
  }
});

describe.skipIf(!!process.env.RECORD_FINALITY)("finality from the chain's own signal, replayed", () => {
  const replay = (chain: "tron" | "ethereum", blockNumber: number | undefined, eta?: string) => {
    const rec = load(NAMES[chain]);
    return readFinality(depsFor(replayTransport(rec as never)), { chain, blockNumber, eta }, () => new Date(rec.recordedAt));
  };

  it("Tron: block at the solidified head → passed, with the head, source and time", async () => {
    const solid = recordedSolid();
    const c = await replay("tron", solid);
    expect(c).toMatchObject({ state: "passed", blockNumber: solid, finalizedBlock: solid, checkedAt: load(NAMES.tron).recordedAt });
    expect(c.source).toMatch(/walletsolidity\/getnowblock/);
    expect(releaseHeadline({ ...others, finality: c }).headline).toBe("Paid and final. Right token and amount. Sender NOT checked. Not frozen.");
  });

  it("Tron: one block above the solidified head → pending, \"Not final yet.\" with the 6a ETA", async () => {
    const c = await replay("tron", recordedSolid() + 1, ETA);
    expect(c.state).toBe("pending");
    const h = releaseHeadline({ ...others, finality: c });
    expect(h).toMatchObject({ tone: "not_yet", headline: "Not final yet." });
    expect(h.lines[0]).toBe(ETA);
  });

  it("Ethereum through Etherscan V2: its proxy refuses the `finalized` tag (recorded) → not_run, never passed", async () => {
    expect(load(NAMES.ethereum).exchanges.at(-1)!.response.body).toMatch(/invalid hex string/);
    const c = await replay("ethereum", 20_000_000);
    expect(c.state).toBe("not_run");
    expect(releaseHeadline({ ...others, finality: c })).toMatchObject({ tone: "not_yet", headline: "Finality NOT checked." });
  });

  it("provider error or timeout → not_run on both chains", async () => {
    const down: Transport = async () => { throw new Error("ETIMEDOUT"); };
    for (const chain of ["tron", "ethereum"] as const) {
      expect((await readFinality(depsFor(down), { chain, blockNumber: 5 })).state).toBe("not_run");
    }
  });

  it("not in a block yet → pending, and no call is made", async () => {
    const none: Transport = async () => { throw new Error("must not be called"); };
    expect((await readFinality(depsFor(none), { chain: "tron", eta: ETA })).state).toBe("pending");
  });
});

describe.skipIf(!!process.env.RECORD_FINALITY)("demo: finality fed from recordings, labelled as recorded", () => {
  it("recordings with a finality read → passed, and the line says it's from a recording made at <time>", async () => {
    const rec = load(NAMES.tron);
    const c = await readFinalityFromRecordings([rec, load("ETH-01")], { chain: "tron", blockNumber: recordedSolid() - 100 });
    expect(c).toMatchObject({ state: "passed", checkedAt: rec.recordedAt });
    expect(c.detail).toContain(`from a recording made at ${rec.recordedAt}, not a live read`);
    expect(releaseHeadline({ ...others, finality: c }).lines.join(" ")).toContain("not a live read");
  });

  it("today's demo recordings hold only the latest head, never a finalized one → not_run (no guessing from confirmations)", async () => {
    const c = await readFinalityFromRecordings([load("ETH-01"), load("TRN-01")], { chain: "ethereum", blockNumber: 1 });
    expect(c.state).toBe("not_run");
    expect(c.detail).toMatch(/no finality read/i);
  });
});
