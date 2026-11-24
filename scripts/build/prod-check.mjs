#!/usr/bin/env node
/**
 * v1 release gate: a production build contains no demo code, no recorded-chain path, no role switcher, presenter guide,
 * feedback note, demo reset, demo calendar or demo seed. Required in CI (`ci` job).
 *
 *   npm run build:prod-check                 a plain production `next build` into .next, then every marker must be
 *                                            ABSENT from the server and client bundles
 *   npm run build:prod-check -- --no-build   check an existing .next only
 *   npm run build:demo-check                 (= --demo) a DEMO build into .next-demo, then every demo marker must be
 *                                            PRESENT: the proof that the absent-check would catch each one. The demo
 *                                            seed must stay absent even there; the recorded-chain marker is proved by
 *                                            the merchant-e2e test build (check-chain-recording.mjs --expect present).
 *
 * The plain build runs with the demo, test and dist-dir switches removed from the environment, whatever the caller's
 * shell holds. Markers: scripts/build/check-chain-recording.mjs. Prints counts and paths relative to the build only.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_BUILD_MARKERS, MARKERS, NEVER_BUNDLED, bundleFilesWithMarker } from "./check-chain-recording.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STRIP = ["CLEARLINE_DEMO_BUILD", "CLEARLINE_TEST_BUILD", "CLEARLINE_DIST_DIR", "NEXT_DIST_DIR", "CLEARLINE_CHAIN_RECORDING", "CLEARLINE_DEPLOY_ENV"];

/** The environment of the plain production build: the caller's, without any demo/test switch. */
export function plainBuildEnv(env = process.env) {
  const out = { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
  for (const k of STRIP) delete out[k];
  return out;
}

/** The environment of the proof build: a demo build (settings are build-only placeholders; nothing connects). */
export function demoBuildEnv(env = process.env) {
  return {
    ...plainBuildEnv(env),
    CLEARLINE_DEMO_BUILD: "1", CLEARLINE_CONTROL_PILOT: "1", CLEARLINE_DIST_DIR: ".next-demo",
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32 ? env.BETTER_AUTH_SECRET : randomBytes(32).toString("base64url"),
    CLEARLINE_ORIGIN: "http://127.0.0.1:3100",
    DATABASE_URL: "postgres://clearline_runtime:build-only@127.0.0.1:1/clearline_demo_build_check",
    CLEARLINE_CUSTOMER_PREVIEW: "", CLEARLINE_FUNDING_ONLY: "", PREVIEW_USER: "", PREVIEW_PASSWORD: "", CLEARLINE_CHAIN_LIVE: "", CLEARLINE_LEDGER_PULL: "",
  };
}

/**
 * Check a finished build. mode "absent": no marker at all. mode "demo": every DEMO_BUILD_MARKERS present, NEVER_BUNDLED
 * absent. Returns { ok, rows, problems }.
 */
export function checkBuild(nextDir, mode) {
  const rows = [];
  const problems = [];
  for (const [name, marker] of Object.entries(MARKERS)) {
    const r = bundleFilesWithMarker(nextDir, marker);
    const want = mode === "absent" || NEVER_BUNDLED.includes(name) ? "absent" : DEMO_BUILD_MARKERS.includes(name) ? "present" : "any";
    rows.push({ marker: name, want, files: r.hits.length, server: r.hits.filter((h) => h.startsWith(`server${path.sep}`)).length, client: r.hits.filter((h) => h.startsWith(`static${path.sep}`)).length, scanned: r.scanned });
    if (r.serverScanned === 0) problems.push(`no server bundle under ${nextDir}/server: the build did not finish`);
    if (want === "absent" && r.hits.length) problems.push(`${name}: found in ${r.hits.length} file(s): ${r.hits.slice(0, 5).join(", ")}${r.hits.length > 5 ? ", …" : ""}`);
    if (want === "present" && !r.hits.length) problems.push(`${name}: NOT found in this demo build, so the absent-check could not catch it`);
  }
  return { ok: problems.length === 0, rows, problems: [...new Set(problems)] };
}

function build(env) {
  const next = path.join(ROOT, "node_modules/.bin/next");
  const r = spawnSync(next, ["build"], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) { console.error(`FAIL: next build exited with ${r.status ?? r.signal}`); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = process.argv.includes("--demo");
  const noBuild = process.argv.includes("--no-build");
  const dist = demo ? ".next-demo" : ".next";
  if (!noBuild) build(demo ? demoBuildEnv() : plainBuildEnv());
  const nextDir = path.join(ROOT, dist);
  if (!existsSync(path.join(nextDir, "BUILD_ID"))) { console.error(`FAIL: no finished build in ${dist} (run without --no-build)`); process.exit(2); }
  const { ok, rows, problems } = checkBuild(nextDir, demo ? "demo" : "absent");
  console.log(`${demo ? "demo" : "production"} build in ${dist}: ${rows[0]?.scanned ?? 0} bundle files scanned (server and client)`);
  for (const r of rows) console.log(`  ${r.marker.padEnd(9)} want ${r.want.padEnd(7)} found in ${r.files} file(s) (server ${r.server}, client ${r.client})`);
  if (!ok) {
    console.error(`FAIL (${demo ? "demo build proof" : "production build"}):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    if (!demo) console.error("A production build must be made without CLEARLINE_DEMO_BUILD=1 or CLEARLINE_TEST_BUILD=1, and demo-only code must be imported only inside the inlined demo-build branch.");
    process.exit(1);
  }
  console.log(demo ? "OK: the demo build contains every demo marker (the production check would catch each) and no demo seed." : "OK: the production build contains no demo, recorded-chain, switcher, guide, feedback, reset, demo-calendar or demo-seed code.");
}
