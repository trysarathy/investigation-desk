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
 * Prints file counts and paths relative to .next only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MARKER = "clearline-chain-recording[test-build-only]";
export const DEMO_MARKER = "clearline-demo[demo-build-only]";
export const MARKERS = { chain: MARKER, demo: DEMO_MARKER };

export function serverFilesWithMarker(nextDir, marker = MARKER) {
  const root = path.join(nextDir, "server");
  const hits = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(name)) { scanned++; if (readFileSync(p, "utf8").includes(marker)) hits.push(path.relative(nextDir, p)); }
    }
  };
  walk(root);
  return { scanned, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--expect");
  const expect = i >= 0 ? process.argv[i + 1] : "absent";
  if (expect !== "absent" && expect !== "present") { console.error("--expect absent|present"); process.exit(2); }
  const m = process.argv.indexOf("--marker");
  const which = m >= 0 ? process.argv[m + 1] : "chain";
  if (!(which in MARKERS)) { console.error("--marker chain|demo"); process.exit(2); }
  const nextDir = path.resolve(process.env.NEXT_DIST_DIR ?? ".next");
  const { scanned, hits } = serverFilesWithMarker(nextDir, MARKERS[which]);
  if (scanned === 0) { console.error(`no server bundle under ${path.relative(process.cwd(), nextDir) || "."}/server: run next build first`); process.exit(2); }
  console.log(JSON.stringify({ marker: which, scanned, [which === "demo" ? "withDemoPath" : "withRecordingPath"]: hits.length, files: hits }));
  if (which === "demo") {
    if (expect === "absent" && hits.length) { console.error("FAIL: this build contains the demo paths; build without CLEARLINE_DEMO_BUILD=1 for any deployment"); process.exit(1); }
    if (expect === "present" && !hits.length) { console.error("FAIL: a demo build (CLEARLINE_DEMO_BUILD=1) should contain the demo paths; the check would not catch them"); process.exit(1); }
    process.exit(0);
  }
  if (expect === "absent" && hits.length) { console.error("FAIL: this build contains the recorded-chain path; build without CLEARLINE_TEST_BUILD=1 for any deployment"); process.exit(1); }
  if (expect === "present" && !hits.length) { console.error("FAIL: a test build (CLEARLINE_TEST_BUILD=1) should contain the recorded-chain path; the check would not catch it"); process.exit(1); }
}
