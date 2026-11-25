#!/usr/bin/env node
/**
 * rc8: check a finished `next build` for the recorded-chain path (src/server/chain-verify.ts verifyClientFromEnv).
 * The marker string exists only inside that path, which the bundler drops unless the build ran with
 * CLEARLINE_TEST_BUILD=1.
 *   node scripts/build/check-chain-recording.mjs --expect absent    (CI `ci` job: a build without the flag)
 *   node scripts/build/check-chain-recording.mjs --expect present   (merchant-e2e: the test build; proves the check finds it)
 * Demo build (src/server/demo-build.ts): `--marker demo` checks for the demo paths instead (the demo recording branch
 * of verifyClientFromEnv, the demo reset route and src/server/demo-reset.ts), which the bundler drops unless the build
 * ran with CLEARLINE_DEMO_BUILD=1:
 *   node scripts/build/check-chain-recording.mjs --marker demo --expect absent    (any real build)
 *   node scripts/build/check-chain-recording.mjs --marker demo --expect present   (the `npm run demo` build)
 * v1: also --marker switcher|guide|feedback|reset|clock|seed (one per demo-only area, see DEMO_AREA_MARKERS), and
 * every check scans the client bundles (.next/static) as well as the server bundles. `npm run build:prod-check`
 * (scripts/build/prod-check.mjs) runs all of them against a plain production build.
 * Prints file counts and paths relative to .next only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MARKER = "clearline-chain-recording[test-build-only]";
export const DEMO_MARKER = "clearline-demo[demo-build-only]";
/**
 * v1: one marker per demo-only area, so a leak names what leaked. Each string exists only in that area's code (server
 * module and, for screens, a data-demo-build attribute of its client component), so it reaches a bundle only when
 * that code does:
 *   switcher  the role switcher (src/server/demo-switch.ts, src/components/merchant/DemoSwitcher.tsx)
 *   guide     the presenter guide (src/components/merchant/PresenterGuide.tsx)
 *   feedback  "Note feedback" (src/server/demo-feedback.ts, src/components/merchant/FeedbackNote.tsx)
 *   reset     the demo reset (src/server/demo-reset.ts, src/components/merchant/ResetDemoButton.tsx)
 *   clock     the demo calendar for live actions (src/server/demo-live-clock.ts)
 *   mfa       the switcher's MFA-proved session for an enrolled demo Admin/Approver (src/server/demo-switch.ts,
 *             demoSwitchMfaProof): never in a real build
 *   seed      the demo world and its seed (src/lib/clearline/demo/world.ts, src/server/demo-seed.ts): never bundled,
 *             not even in a demo build (only `npm run demo`'s scripts load it)
 */
export const DEMO_AREA_MARKERS = {
  switcher: "clearline-demo-switcher[demo-build-only]",
  guide: "clearline-demo-guide[demo-build-only]",
  feedback: "clearline-demo-feedback[demo-build-only]",
  reset: "clearline-demo-reset[demo-build-only]",
  clock: "clearline-demo-clock[demo-build-only]",
  mfa: "clearline-demo-mfa-proof[demo-build-only]",
  seed: "clearline-demo-seed[demo-build-only]",
};
export const MARKERS = { chain: MARKER, demo: DEMO_MARKER, ...DEMO_AREA_MARKERS };
/** Markers a demo build must contain (the proof that the absent-check would catch them). */
export const DEMO_BUILD_MARKERS = ["demo", "switcher", "guide", "feedback", "reset", "clock", "mfa"];
/** Markers no build of any kind may contain. */
export const NEVER_BUNDLED = ["seed"];

function scan(nextDir, sub, marker) {
  const root = path.join(nextDir, sub);
  const hits = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(name)) { scanned++; if (readFileSync(p, "utf8").includes(marker)) hits.push(path.relative(nextDir, p)); }
    }
  };
  try { statSync(root); } catch { return { scanned, hits }; }
  walk(root);
  return { scanned, hits };
}

/** The server bundles (.next/server). */
export function serverFilesWithMarker(nextDir, marker = MARKER) {
  return scan(nextDir, "server", marker);
}

/** The server bundles and the client bundles (.next/static, what browsers download). */
export function bundleFilesWithMarker(nextDir, marker = MARKER) {
  const a = scan(nextDir, "server", marker), b = scan(nextDir, "static", marker);
  return { scanned: a.scanned + b.scanned, serverScanned: a.scanned, clientScanned: b.scanned, hits: [...a.hits, ...b.hits] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--expect");
  const expect = i >= 0 ? process.argv[i + 1] : "absent";
  if (expect !== "absent" && expect !== "present") { console.error("--expect absent|present"); process.exit(2); }
  const m = process.argv.indexOf("--marker");
  const which = m >= 0 ? process.argv[m + 1] : "chain";
  if (!(which in MARKERS)) { console.error(`--marker ${Object.keys(MARKERS).join("|")}`); process.exit(2); }
  const nextDir = path.resolve(process.env.NEXT_DIST_DIR ?? ".next");
  const { scanned, serverScanned, hits } = bundleFilesWithMarker(nextDir, MARKERS[which]);
  if (serverScanned === 0) { console.error(`no server bundle under ${path.relative(process.cwd(), nextDir) || "."}/server: run next build first`); process.exit(2); }
  console.log(JSON.stringify({ marker: which, scanned, [which === "chain" ? "withRecordingPath" : "withDemoPath"]: hits.length, files: hits }));
  if (which !== "chain") {
    if (expect === "absent" && hits.length) { console.error("FAIL: this build contains the demo paths; build without CLEARLINE_DEMO_BUILD=1 for any deployment"); process.exit(1); }
    if (expect === "present" && !hits.length) { console.error("FAIL: a demo build (CLEARLINE_DEMO_BUILD=1) should contain the demo paths; the check would not catch them"); process.exit(1); }
    process.exit(0);
  }
  if (expect === "absent" && hits.length) { console.error("FAIL: this build contains the recorded-chain path; build without CLEARLINE_TEST_BUILD=1 for any deployment"); process.exit(1); }
  if (expect === "present" && !hits.length) { console.error("FAIL: a test build (CLEARLINE_TEST_BUILD=1) should contain the recorded-chain path; the check would not catch it"); process.exit(1); }
}
