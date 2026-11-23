/**
 * Shape D is reserved for a blind mapping test, so no file other than src/lib/clearline/synthetic/blind.ts may name
 * its distinctive fields. This test derives those names at RUN TIME from the writer's output (it never spells them),
 * then scans the repository's own sources for them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { generateWorld, SMALL_PRESET_PARAMS } from "@/lib/clearline/synthetic";
import { blindProviderExport } from "@/lib/clearline/synthetic/blind";

const REPO = join(__dirname, "../../..");
const SKIP = new Set(["node_modules", ".git", ".next", "synthetic-data", "reconstruction-data", "test-results", "playwright-report"]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    const s = statSync(p);
    return s.isDirectory() ? walk(p) : s.size < 2_000_000 && /\.(ts|tsx|js|mjs|cjs|json|md|csv|sql|yml|yaml|txt)$/.test(n) ? [p] : [];
  });
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};

describe("shape D (blind) isolation", () => {
  const out = JSON.parse(new TextDecoder().decode(blindProviderExport(generateWorld(SMALL_PRESET_PARAMS()))));
  const distinctive = [...keysOf(out)].filter((k) => /^[a-z]+_[a-z]+$/.test(k));

  it("has distinctive field names, and settlement totals only (no per-payment settlement lines)", () => {
    expect(distinctive.length).toBeGreaterThanOrEqual(6);
    expect(out._note).toBe("Synthetic · fictional data");
  });

  it("no other file in the repository names them", () => {
    const hits: string[] = [];
    for (const f of walk(REPO)) {
      const rel = relative(REPO, f);
      if (rel === join("src", "lib", "clearline", "synthetic", "blind.ts")) continue;
      const src = readFileSync(f, "utf8");
      for (const k of distinctive) if (new RegExp(`\\b${k}\\b`).test(src)) hits.push(`${rel}: ${k}`);
    }
    expect(hits).toEqual([]);
  });
});
