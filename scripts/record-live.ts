// Records the live fixtures in tests/fixtures/live/*.json from TronGrid, Etherscan V2 and the
// official public RPCs (BNB Chain, Base, Optimism).
//
//   NODE_USE_ENV_PROXY=1 npx vite-node scripts/record-live.ts      (proxy only needed behind one)
//
// Needs TRONGRID_API_KEY and ETHERSCAN_API_KEY in the environment. Keys are redacted from every
// recorded URL, and the script refuses to write a file that contains either key.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchTransport, type HttpRequest, type Transport } from "../src/lib/chain/http";
import { fetchFacts } from "../src/lib/chain/investigate";
import { buildFetchers } from "../src/lib/chain/sources";
import { MemoryStore } from "../src/lib/chain/store";
import { investigate } from "../src/lib/engine/run";
import { LIVE_CASES, liveSettings, liveWorkspace } from "../tests/fixtures/live/cases";
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
  // A fresh store per case, so every response is fetched and recorded.
  const deps = buildFetchers({ tronKey, etherscanKey: ethKey, store: new MemoryStore(), transport: recording });
  const settings = liveSettings(c);
  const facts = await fetchFacts(c.hash, liveWorkspace(c), deps, settings);
  const v = investigate(facts, settings);
  const out = JSON.stringify({ name: c.name, hash: c.hash, explorer: c.explorer, recordedAt: facts.checkedAt, exchanges }, null, 1);
  if (out.includes(tronKey) || out.includes(ethKey)) throw new Error(`Refusing to write ${c.name}: an API key would be recorded`);
  await writeFile(path.join("tests", "fixtures", "live", `${c.name}.json`), `${out}\n`);
  const ok = v.state === c.expected.state && (c.expected.state === "paused" || (v.code === c.expected.code && v.confidence === c.expected.confidence));
  console.log(`${ok ? "OK  " : "DIFF"} ${c.name}: ${v.state} ${v.code} ${v.confidence ?? ""} (${exchanges.length} responses)`);
}
