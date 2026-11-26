/**
 * v1 release gate (scripts/build/prod-check.mjs, `npm run build:prod-check`): every demo-only area has its own bundle
 * marker; the check fails a production build that contains any of them (server OR client bundles), and the demo proof
 * mode fails a demo build that lacks one. Synthetic build folders only; the real builds are run by the npm script
 * (CI `ci` job). Demo · fictional data.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error plain .mjs script without types
const gate = (): Promise<any> => import("../../scripts/build/prod-check.mjs");
// @ts-expect-error plain .mjs script without types
const markers = (): Promise<any> => import("../../scripts/build/check-chain-recording.mjs");

function fakeBuild(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "clearline-prod-check-"));
  for (const sub of ["server/app", "static/chunks"]) mkdirSync(path.join(dir, sub), { recursive: true });
  writeFileSync(path.join(dir, "server", "app", "page.js"), "export const page = 1;");
  for (const [f, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), body); }
  return dir;
}

describe("the markers", () => {
  it("one per demo-only area, distinct, none a substring of another", async () => {
    const { MARKERS } = await markers();
    expect(Object.keys(MARKERS)).toEqual(["chain", "demo", "switcher", "guide", "feedback", "reset", "clock", "mfa", "seed"]);
    const v = Object.values(MARKERS) as string[];
    for (const a of v) for (const b of v) if (a !== b) expect(a.includes(b)).toBe(false);
  });
  it("each lives in its area's code: the server module and, for a screen, its client component", async () => {
    const { DEMO_AREA_MARKERS: m } = await markers();
    expect(src("src/server/demo-switch.ts")).toContain(m.switcher);
    expect(src("src/components/merchant/DemoSwitcher.tsx")).toContain(m.switcher);
    expect(src("src/components/merchant/PresenterGuide.tsx")).toContain(m.guide);
    expect(src("src/server/demo-feedback.ts")).toContain(m.feedback);
    expect(src("src/components/merchant/FeedbackNote.tsx")).toContain(m.feedback);
    expect(src("src/server/demo-reset.ts")).toContain(m.reset);
    expect(src("src/components/merchant/ResetDemoButton.tsx")).toContain(m.reset);
    expect(src("src/server/demo-live-clock.ts")).toContain(m.clock);
    // v1 wave 1: the switcher's MFA-proved session (demo build only); a demo build must carry it, a real build never
    expect(src("src/server/demo-switch.ts")).toContain(m.mfa);
    const { DEMO_BUILD_MARKERS, NEVER_BUNDLED } = await markers();
    expect(DEMO_BUILD_MARKERS).toContain("mfa");
    expect(NEVER_BUNDLED).not.toContain("mfa");
    const { DEMO_CLOCK_MARKER } = await import("@/server/demo-live-clock");
    expect(DEMO_CLOCK_MARKER).toBe(m.clock);
    expect(src("src/lib/clearline/demo/world.ts")).toContain(m.seed);
    expect(src("src/server/demo-seed.ts")).toContain("DEMO_SEED_MARKER");
  });
});

describe("checkBuild", () => {
  it("a production build: passes when clean, fails for each marker found in the server or the client bundles", async () => {
    const { checkBuild } = await gate();
    const { MARKERS } = await markers();
    expect(checkBuild(fakeBuild({}), "absent").ok).toBe(true);
    for (const [name, marker] of Object.entries(MARKERS as Record<string, string>)) {
      for (const where of ["server/chunks/1.js", "static/chunks/app/x.js"]) {
        const r = checkBuild(fakeBuild({ [where]: `x(${JSON.stringify(marker)})` }), "absent");
        expect(r.ok, `${name} in ${where}`).toBe(false);
        expect(r.problems.join("\n")).toContain(`${name}: found in 1 file(s)`);
      }
    }
  });
  it("the demo proof: every demo marker must be present, and the demo seed absent even there", async () => {
    const { checkBuild } = await gate();
    const { MARKERS, DEMO_BUILD_MARKERS } = await markers();
    const all = Object.fromEntries((DEMO_BUILD_MARKERS as string[]).map((n, i) => [`static/chunks/${i}.js`, `x("${(MARKERS as Record<string, string>)[n]}")`]));
    expect(checkBuild(fakeBuild(all), "demo").ok).toBe(true);
    const missing = { ...all }; delete missing["static/chunks/2.js"];
    expect(checkBuild(fakeBuild(missing), "demo").problems.join("\n")).toMatch(/NOT found in this demo build/);
    expect(checkBuild(fakeBuild({ ...all, "server/chunks/seed.js": `x("${(MARKERS as Record<string, string>).seed}")` }), "demo").problems.join("\n")).toMatch(/^seed: found/m);
  });
  it("an unfinished build (no server bundle) never passes", async () => {
    const { checkBuild } = await gate();
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-prod-check-empty-"));
    expect(checkBuild(dir, "absent").ok).toBe(false);
  });
});

describe("the build environments", () => {
  it("the production build strips every demo/test switch from the caller's environment", async () => {
    const { plainBuildEnv } = await gate();
    const e = plainBuildEnv({ CLEARLINE_DEMO_BUILD: "1", CLEARLINE_TEST_BUILD: "1", CLEARLINE_DIST_DIR: ".next-demo", NEXT_DIST_DIR: ".x", CLEARLINE_CHAIN_RECORDING: "/r.json", PATH: "/bin" });
    expect(e.CLEARLINE_DEMO_BUILD).toBeUndefined();
    expect(e.CLEARLINE_TEST_BUILD).toBeUndefined();
    expect(e.CLEARLINE_DIST_DIR).toBeUndefined();
    expect(e.NEXT_DIST_DIR).toBeUndefined();
    expect(e.CLEARLINE_CHAIN_RECORDING).toBeUndefined();
    expect(e).toMatchObject({ NODE_ENV: "production", PATH: "/bin" });
  });
  it("the proof build is a demo build into .next-demo, never into .next", async () => {
    const { demoBuildEnv } = await gate();
    expect(demoBuildEnv({})).toMatchObject({ CLEARLINE_DEMO_BUILD: "1", CLEARLINE_CONTROL_PILOT: "1", CLEARLINE_DIST_DIR: ".next-demo" });
  });
  it("is an npm script and a step of the required `ci` job", () => {
    const pkg = JSON.parse(src("package.json"));
    expect(pkg.scripts["build:prod-check"]).toBe("node scripts/build/prod-check.mjs");
    const ci = src(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("\n  ci:"), ci.indexOf("\n  control-db:"));
    expect(job).toContain("npm run build:prod-check");
    expect(job).toContain("check-chain-recording.mjs --expect absent");
  });
});
