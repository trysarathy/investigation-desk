// npm run qa: the whole QA pass, for a person or a nightly task. Exits non-zero if anything fails.
//
//   1. typecheck (tsc --noEmit)
//   2. unit tests (vitest run)
//   3. production build (next build)
//   4. a fresh data folder; a live-mode server creates one NON-demo request (to prove the demo
//      reset keeps real data), then stops
//   5. a demo-mode server on the same folder, and tests/e2e/qa_flows.mjs against it
//
// Env: QA_PORT (default 3400), QA_SKIP_BUILD=1 to reuse an existing build, SHOTS=<folder> for screenshots.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.QA_PORT || 3400);
const results = [];
const step = (name, cmd, args, env = {}) => {
  console.log(`\n=== ${name}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  results.push({ name, ok: r.status === 0 });
  return r.status === 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(env, port) {
  // Something already on the port would be tested instead of this build: refuse.
  try { await fetch(`http://localhost:${port}/`); throw new Error(`port ${port} is already in use: stop that server or set QA_PORT`); } catch (e) { if (String(e.message).startsWith("port")) throw e; }
  const child = spawn("npx", ["next", "start", "-p", String(port)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${port}/requests`)).status < 500) return { child, log: () => log }; } catch { /* not up yet */ }
    await sleep(500);
  }
  stop(child);
  throw new Error(`server on port ${port} did not start:\n${log}`);
}
function stop(child) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } }

step("typecheck", "npx", ["tsc", "--noEmit"]);
step("unit tests", "npx", ["vitest", "run"]);
if (process.env.QA_SKIP_BUILD !== "1") step("build", "npx", ["next", "build"]);

const dataDir = mkdtempSync(path.join(tmpdir(), "clearline-qa-"));
let nondemoId = "";
try {
  console.log(`\n=== non-demo record (live mode, data in ${dataDir})`);
  const live = await startServer({ DEMO_MODE: "off", DESK_DATA_DIR: dataDir, LIVE_LOOKUPS: "off" }, PORT + 1);
  const r = await fetch(`http://localhost:${PORT + 1}/api/requests`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "QA runner", customerRef: "QA real customer", invoiceRef: "INV-QA-REAL", amount: "10.00", receivingAddress: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed", token: "USDC" }),
  });
  nondemoId = (await r.json().catch(() => ({}))).id ?? "";
  stop(live.child);
  await sleep(1000);
  results.push({ name: "create a non-demo request (live mode)", ok: !!nondemoId });
  console.log(nondemoId ? `created ${nondemoId}` : `failed: HTTP ${r.status}`);

  console.log(`\n=== demo server on port ${PORT}`);
  const demo = await startServer({ DEMO_MODE: "on", DESK_DATA_DIR: dataDir }, PORT);
  try {
    step("end-to-end (tests/e2e/qa_flows.mjs)", "node", ["tests/e2e/qa_flows.mjs"], { BASE: `http://localhost:${PORT}`, NONDEMO_ID: nondemoId });
    const serverErrors = demo.log().split("\n").filter((l) => /error|unhandled/i.test(l));
    results.push({ name: "demo server log has no errors", ok: serverErrors.length === 0 });
    if (serverErrors.length) console.log(serverErrors.slice(0, 20).join("\n"));
  } finally {
    stop(demo.child);
  }
} catch (e) {
  results.push({ name: "servers", ok: false });
  console.error(e);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

console.log("\n=== QA summary");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
