// Records the real-case chain responses for tests/real-cases.test.ts. Network; skipped unless asked:
//   RECORD_REAL=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/real-record.test.ts
// Records keyless (no TronGrid or Etherscan key), exactly as the app runs without keys.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { fetchFacts } from "@/lib/chain/investigate";
import { fetchTransport, type Transport } from "@/lib/chain/http";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { redactUrl, type Exchange } from "./fixtures/live/replay";
import { realCases, sampleWorkspace } from "./fixtures/real/workspace";

describe.skipIf(!process.env.RECORD_REAL)("record real cases", () => {
  for (const c of realCases().filter((x) => !x.dynamic)) {
    it(c.id, async () => {
      const exchanges: Exchange[] = [];
      const transport: Transport = async (req) => {
        const res = await fetchTransport(req);
        exchanges.push({ request: { method: req.method, url: redactUrl(req.url), body: req.body }, response: { status: res.status, headers: {}, body: res.body } });
        return res;
      };
      const recordedAt = new Date().toISOString();
      const deps = buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport, now: () => new Date(recordedAt) });
      await fetchFacts(c.input!, sampleWorkspace(c.customer_id ?? undefined), deps, SAMPLE_SETTINGS);
      writeFileSync(path.join(__dirname, "fixtures", "real", `${c.id}.json`),
        JSON.stringify({ name: c.id, hash: c.tx_hash, explorer: "", recordedAt, exchanges }));
    }, 120_000);
  }
});
