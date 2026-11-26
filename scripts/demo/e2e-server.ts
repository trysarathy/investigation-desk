/**
 * The demo browser suite's web server (playwright.demo.config.ts): makes sure the demo is set up, seeded and built
 * (`npm run demo -- --no-start`, which skips what is already done and rebuilds a changed tree), then starts the demo
 * build on CLEARLINE_DEMO_PORT with the same environment as `npm run demo`. It never seeds over a running demo's data
 * by itself; the suite resets to the seeded state before each journey (src/server/demo-reset.ts). Demo · fictional data.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { APP_PORT, DemoStop, ROOT, appEnv, readState } from "./lib";

function main() {
  execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), ["--conditions=react-server", path.join(ROOT, "scripts/demo/run.ts"), "--no-start"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: process.env });
  const s = readState();
  if (!s?.steps.build) throw new DemoStop("the demo was not built");
  const child = spawn(path.join(ROOT, "node_modules/.bin/next"), ["start", "-H", "127.0.0.1", "-p", String(APP_PORT)], { cwd: ROOT, env: appEnv(s), stdio: ["ignore", "inherit", "inherit"] });
  const stop = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
}

try { main(); } catch (e) {
  process.stderr.write(`demo e2e server: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
