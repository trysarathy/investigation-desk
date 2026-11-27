/**
 * v1 design-fluid: the --cl-* design tokens meet WCAG 2.2 AA in BOTH themes, recomputed from the real hex values in
 * src/app/globals.css (4.5:1 for text, 3:1 for UI), and docs/design/TOKENS.md records exactly these ratios.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrast } from "../src/lib/clearline/merchant/theme";
import { TOKEN_PAIRS } from "../src/components/ui/token-pairs";

const css = readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
const block = (tag: string) => {
  const start = css.indexOf(`/* cl-tokens:${tag}`);
  const end = css.indexOf("/* cl-tokens:", start + 5);
  expect(start, tag).toBeGreaterThanOrEqual(0);
  return Object.fromEntries([...css.slice(start, end).matchAll(/--cl-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
};
const THEMES = { light: block("light"), dark: block("dark") } as const;
const doc = readFileSync(path.join(__dirname, "../docs/design/TOKENS.md"), "utf8");

describe("design tokens", () => {
  it("light and dark define the same tokens, and the system-preference block repeats dark exactly", () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
    expect(block("dark-media")).toEqual(THEMES.dark);
    expect(Object.keys(THEMES.light).length).toBeGreaterThanOrEqual(32);
  });
  for (const [theme, v] of Object.entries(THEMES)) {
    it(`${theme}: every text pair is at least 4.5:1 and every UI pair at least 3:1`, () => {
      const failing = TOKEN_PAIRS.map((p) => ({ ...p, r: contrast(v[p.fg], v[p.bg]) })).filter((p) => !(p.r >= p.min));
      expect(failing).toEqual([]);
    });
    it(`${theme}: docs/design/TOKENS.md records every pair with its ratio`, () => {
      for (const p of TOKEN_PAIRS) {
        const line = `| ${theme} | \`--cl-${p.fg}\` ${v[p.fg]} | \`--cl-${p.bg}\` ${v[p.bg]} | ${contrast(v[p.fg], v[p.bg]).toFixed(2)}:1 | ${p.min}:1 |`;
        expect(doc, line).toContain(line);
      }
    });
  }
});
