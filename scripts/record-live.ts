// Records the live fixtures in tests/fixtures/live/*.json from TronGrid and Etherscan V2.
//
//   NODE_USE_ENV_PROXY=1 npx vite-node scripts/record-live.ts      (proxy only needed behind one)
//
// Needs TRONGRID_API_KEY and ETHERSCAN_API_KEY in the environment. Keys are redacted from every
// recorded URL, and the script refuses to write a file that contains either key.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { etherscanClassifyBody, EvmFetcher } from "../src/lib/chain/evm";
import { ChainClient, fetchTransport, type HttpRequest, type Transport } from "../src/lib/chain/http";
import { fetchFacts } from "../src/lib/chain/investigate";
import { MemoryStore } from "../src/lib/chain/store";
import { tronClassifyBody, TronFetcher } from "../src/lib/chain/tron";
import { investigate } from "../src/lib/engine/run";
import { SAMPLE_SETTINGS } from "../src/lib/fixtures";
import { LIVE_CASES, liveWorkspace } from "../tests/fixtures/live/cases";
import { redactUrl, type Exchange } from "../tests/fixtures/live/replay";

const tronKey = process.env.TRONGRID_API_KEY ?? "";
const ethKey = process.env.ETHERSCAN_API_KEY ?? "";
if (!tronKey || !ethKey) throw new Error("Set TRONGRID_API_KEY and ETHERSCAN_API_KEY");

const only = process.argv[2];

for (const c of LIVE_CASES.filter((x) => !only || x.name === only)) {
  const exchanges: Exchange[] = [];
  const recording: Transport = async (req: HttpRequest) => {
    const res = await fetchTransport(req);
    exchanges.push({
      request: { method: req.method, url: redactUrl(req.url), body: req.body },
      response: { status: res.status, headers: res.headers["retry-after"] ? { "retry-after": res.headers["retry-after"] } : {}, body: res.body },
    });
    return res;
  };
  const store = new MemoryStore(); // fresh per case, so every response is fetched and recorded
  const deps = {
    tron: new TronFetcher(new ChainClient({ source: "trongrid", minIntervalMs: 100, store, transport: recording, classifyBody: tronClassifyBody }), tronKey),
    evm: new EvmFetcher(new ChainClient({ source: "etherscan", minIntervalMs: 400, store, transport: recording,
      secretParams: ["apikey"], classifyBody: etherscanClassifyBody }), ethKey),
  };
  const facts = await fetchFacts(c.hash, liveWorkspace(c), deps);
  const v = investigate(facts, SAMPLE_SETTINGS);
  const out = JSON.stringify({ name: c.name, hash: c.hash, explorer: c.explorer, recordedAt: facts.checkedAt, exchanges }, null, 1);
  if (out.includes(tronKey) || out.includes(ethKey)) throw new Error(`Refusing to write ${c.name}: an API key would be recorded`);
  await writeFile(path.join("tests", "fixtures", "live", `${c.name}.json`), `${out}\n`);
  const ok = v.state === c.expected.state && (c.expected.state === "paused" || (v.code === c.expected.code && v.confidence === c.expected.confidence));
  console.log(`${ok ? "OK  " : "DIFF"} ${c.name}: ${v.state} ${v.code} ${v.confidence ?? ""} (${exchanges.length} responses)`);
}
