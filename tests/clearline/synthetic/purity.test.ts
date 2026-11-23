import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../src/lib/clearline/synthetic");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

describe("synthetic generator: purity", () => {
  const sources = files(ROOT).filter((f) => f.endsWith(".ts"));
  it("has sources to check", () => expect(sources.length).toBeGreaterThanOrEqual(10));
  for (const f of sources) {
    it(`${f.slice(ROOT.length + 1)} reads no randomness, clock or I/O`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/Math\.random/);
      expect(src).not.toMatch(/Date\.now/);
      expect(src).not.toMatch(/new Date\(\s*\)/);
      expect(src).not.toMatch(/performance\.now|process\.hrtime|getRandomValues|randomUUID|randomBytes/);
      expect(src).not.toMatch(/from "node:(fs|net|http|https|child_process)"|from "fs"|require\(/);
    });
  }
});
