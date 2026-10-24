// Every real case in tests/real_cases.json, replayed offline from its recorded chain responses.
// Expected answers come from tests/real_cases.json, where each is proven by a source independent of
// this product. A failing case here is a product miss; never change the expectation to pass it.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchFacts } from "@/lib/chain/investigate";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { replayTransport, type Recording } from "./fixtures/live/replay";
import { realCases, sampleWorkspace } from "./fixtures/real/workspace";

const cases = realCases().filter((c) => !c.dynamic && existsSync(path.join(__dirname, "fixtures", "real", `${c.id}.json`)));

describe("real cases (recorded, keyless)", () => {
  it("has a recording for at least 50 real cases", () => expect(cases.length).toBeGreaterThanOrEqual(50));
  for (const c of cases) {
    it(`${c.id} ${c.category}: ${c.expected}`, async () => {
      const rec: Recording = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "real", `${c.id}.json`), "utf8"));
      const deps = buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport: replayTransport(rec),
        now: () => new Date(rec.recordedAt), sleep: async () => {}, noSpacing: true });
      const facts = await fetchFacts(c.input!, sampleWorkspace(c.customer_id ?? undefined), deps, SAMPLE_SETTINGS);
      const v = investigate(facts, SAMPLE_SETTINGS);
      const matched = v.checks.filter((x) => x.matched).map((x) => x.code);
      if (c.scoring?.startsWith("correct if the verdict is D07b")) {
        expect(v.code === "D07b" || (v.code === "D07" && matched.includes("D07b")), `got ${v.code}, matched ${matched}`).toBe(true);
      } else {
        expect(v.state).toBe("verdict");
        expect(v.code).toBe(c.expected);
      }
      for (const f of c.expected_findings) expect(matched, `finding ${f}`).toContain(f);
    });
  }
});
