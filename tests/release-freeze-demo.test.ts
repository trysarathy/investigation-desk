// Issuer freeze reads for every demo transfer (the demo-scenarios recordings + TRN-01), so the demo
// shows a real freeze answer instead of "Freeze status NOT checked." Sender and receiver come from the
// transfer recording itself (its Transfer log on the issuer contract), not from a hand-typed list.
// Real responses, recorded once, replayed offline (ADR 0003): never hand-edited, key redacted.
// A read that failed is not written, so that transfer stays "NOT checked". Re-record:
//   RECORD_FREEZE_DEMO=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/release-freeze-demo.test.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tronHexToBase58 } from "@/lib/address";
import { TRANSFER_TOPIC } from "@/lib/chain/abi";
import { fetchTransport, type Transport } from "@/lib/chain/http";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { readIssuerFreeze, type FreezeQuery } from "@/lib/requests/freeze";
import type { Token } from "@/lib/types";
import { redactUrl, replayTransport, type Exchange, type Recording } from "./fixtures/live/replay";

const REAL = path.join(__dirname, "fixtures", "real");
const INDEX = path.join(REAL, "freeze-demo-index.json");
/** Every transfer the demo shows (catalogue.json on data/demo-scenarios, plus TRN-01 as demo TRON-01). */
const DEMO_RECORDINGS = ["ETH-01", "ETH-02", "ETH-03", "ETH-04", "ETH-05", "ETH-06", "ETH-07", "ETH-08", "FAKE-06", "FAKE-HG",
  "TRN-01", "BSC-01", "POISON-1", "POISON-2"];
const ISSUER: Record<string, { chain: "ethereum" | "tron"; token: Token; contract: string }> = {
  dac17f958d2ee523a2206206994597c13d831ec7: { chain: "ethereum", token: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48: { chain: "ethereum", token: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  a614f803b6fd780986a42c78ec9c7f77e6ded13c: { chain: "tron", token: "USDT", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
};

/** The one Transfer log on an issuer contract in a recorded transfer, or why there isn't one. */
function transferOf(name: string): FreezeQuery | string {
  const rec = JSON.parse(readFileSync(path.join(REAL, `${name}.json`), "utf8")) as Recording;
  const found: FreezeQuery[] = [];
  for (const e of rec.exchanges) {
    let j: { result?: { logs?: { address: string; topics: string[] }[] }; log?: { address: string; topics: string[] }[] };
    try { j = JSON.parse(e.response.body); } catch { continue; }
    const evm = /eth_getTransactionReceipt/.test(`${e.request.url} ${e.request.body}`) ? j.result?.logs ?? [] : [];
    const tron = /gettransactioninfobyid/.test(e.request.url) ? (j.log ?? []).map((l) => ({ ...l, tron: true })) : [];
    for (const l of [...evm, ...tron] as { address: string; topics: string[]; tron?: boolean }[]) {
      const t0 = l.topics[0]?.replace(/^0x/, "");
      const issuer = ISSUER[l.address.replace(/^0x/, "").toLowerCase().slice(-40)];
      if (t0 !== TRANSFER_TOPIC.replace(/^0x/, "") || l.topics.length !== 3 || !issuer || (issuer.chain === "tron") !== !!l.tron) continue;
      const addr = (topic: string) => (l.tron ? tronHexToBase58(`41${topic.slice(-40)}`) : `0x${topic.slice(-40)}`);
      found.push({ ...issuer, sender: addr(l.topics[1]), receiver: addr(l.topics[2]) });
    }
  }
  const unique = [...new Map(found.map((f) => [`${f.sender}:${f.receiver}:${f.contract}`, f])).values()];
  return unique.length === 1 ? unique[0] : unique.length ? "more than one issuer transfer" : "no transfer on an issuer contract (counterfeit, bridged or failed): freeze can't be asked";
}

const depsFor = (transport: Transport, etherscanKey = "replay", live = false) =>
  buildFetchers({ tronKey: "", etherscanKey, store: new MemoryStore(), transport, noSpacing: !live, ...(live ? {} : { sleep: async () => {} }) });

interface IndexRow { recording: string; fixture?: string; recordedAt?: string; query?: FreezeQuery; skipped?: string }

describe.skipIf(!process.env.RECORD_FREEZE_DEMO)("record freeze reads for the demo transfers", () => {
  it("records each, writes the index", async () => {
    const rows: IndexRow[] = [];
    for (const name of DEMO_RECORDINGS) {
      const q = transferOf(name);
      if (typeof q === "string") { rows.push({ recording: `${name}.json`, skipped: q }); continue; }
      const exchanges: Exchange[] = [];
      const transport: Transport = async (req) => {
        const res = await fetchTransport(req);
        exchanges.push({ request: { method: req.method, url: redactUrl(req.url), body: req.body }, response: { status: res.status, headers: {}, body: res.body } });
        return res;
      };
      const recordedAt = new Date().toISOString();
      const c = await readIssuerFreeze(depsFor(transport, process.env.ETHERSCAN_API_KEY ?? "", true), q, () => new Date(recordedAt));
      await new Promise((r) => setTimeout(r, 1500));
      if (c.state === "not_run") { rows.push({ recording: `${name}.json`, query: q, skipped: `read failed at ${recordedAt}: ${c.detail}` }); continue; }
      const fixture = `FREEZE-DEMO-${name}.json`;
      writeFileSync(path.join(REAL, fixture), JSON.stringify({ name: fixture.replace(/\.json$/, ""), hash: "", explorer: "", recordedAt, exchanges }));
      rows.push({ recording: `${name}.json`, fixture, recordedAt, query: q });
    }
    writeFileSync(INDEX, `${JSON.stringify({ about: "Issuer freeze reads (sender and receiver) for the demo transfers, recorded by tests/release-freeze-demo.test.ts. Sender/receiver taken from each recording's Transfer log on the issuer contract.", rows }, null, 1)}\n`);
  }, 180_000);
});

describe.skipIf(!!process.env.RECORD_FREEZE_DEMO)("demo freeze reads replay offline", () => {
  const rows = (): IndexRow[] => JSON.parse(readFileSync(INDEX, "utf8")).rows;

  it("every demo transfer is in the index: recorded, or skipped with the reason", () => {
    expect(rows().map((r) => r.recording).sort()).toEqual(DEMO_RECORDINGS.map((n) => `${n}.json`).sort());
    for (const r of rows()) expect(!!r.fixture !== !!r.skipped).toBe(true);
  });

  it("sender/receiver in the index are what the transfer recording says (re-derived now)", () => {
    for (const r of rows()) {
      const q = transferOf(r.recording.replace(/\.json$/, ""));
      if (r.query) expect(r.query).toEqual(q);
      else expect(typeof q).toBe("string");
    }
  });

  it("each recorded read replays to a real answer (passed or failed), with both addresses asked", async () => {
    for (const r of rows().filter((x) => x.fixture)) {
      expect(existsSync(path.join(REAL, r.fixture!))).toBe(true);
      const rec = JSON.parse(readFileSync(path.join(REAL, r.fixture!), "utf8")) as Recording;
      expect(JSON.stringify(rec)).not.toMatch(/apikey=(?!REDACTED)[A-Za-z0-9]/);
      const c = await readIssuerFreeze(depsFor(replayTransport(rec)), r.query!, () => new Date(rec.recordedAt));
      expect(["passed", "failed"]).toContain(c.state);
      expect(c.addresses?.map((a) => a.role)).toEqual(["sender", "receiver"]);
    }
  });
});
