import { readFileSync } from "node:fs";
import { investigate } from "../src/lib/engine/run";
import type { Facts, Settings, Code } from "../src/lib/types";
const file = process.argv[2];
if (!file)
  throw Error("Usage: vite-node scripts/evaluate-regressions.ts export.json");
const data = JSON.parse(readFileSync(file, "utf8")) as {
  candidates: {
    caseId: string;
    facts: Facts;
    settings: Settings;
    expected: Code;
    label: { adjudicated: boolean };
  }[];
};
let tested = 0,
  failed = 0;
for (const c of data.candidates) {
  if (!c.label.adjudicated) continue;
  tested++;
  const actual = investigate(c.facts, c.settings).code;
  if (actual !== c.expected) {
    failed++;
    console.log(
      JSON.stringify({ caseId: c.caseId, expected: c.expected, actual }),
    );
  }
}
console.log(
  JSON.stringify({ tested, failed, skipped: data.candidates.length - tested }),
);
if (failed) process.exitCode = 1;
