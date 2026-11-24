import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { DEMO_E2E } from "./tests/e2e-demo/env";

/**
 * The demo build's browser suite: the 13-step demo journey (tests/e2e-demo/journey.spec.ts) and the page timings
 * (perf.spec.ts), against a DEMO build (CLEARLINE_DEMO_BUILD=1, `.next-demo`) with the seeded demo world.
 *
 * The web server (scripts/demo/e2e-server.ts) runs `npm run demo -- --no-start` first, which sets up, seeds and builds
 * what is missing (it reuses .demo/state.json of this checkout), then starts the demo build on CLEARLINE_DEMO_PORT
 * (default 3402 here, so a presenter's `npm run demo` on 3100 can keep running; both use the same demo database, and
 * every journey resets it to the seeded state first). PostgreSQL: whatever `npm run demo` uses (CLEARLINE_DEMO_PG_URL,
 * or the saved server, or Docker).
 *   CLEARLINE_DEMO_PG_URL=postgres://postgres@127.0.0.1:5432/postgres npx playwright test -c playwright.demo.config.ts
 * One worker: the specs share the demo database. Demo · fictional data.
 */
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: "./tests/e2e-demo",
  testMatch: "*.spec.ts",
  timeout: 600_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: DEMO_E2E.origin, trace: "off", screenshot: "only-on-failure", launchOptions, acceptDownloads: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: "node_modules/.bin/tsx --conditions=react-server scripts/demo/e2e-server.ts",
    url: `${DEMO_E2E.origin}/control/sign-in`,
    // a first run seeds (about a minute) and builds (about a minute and a half)
    timeout: 900_000,
    reuseExistingServer: false,
    env: { CLEARLINE_DEMO_PORT: String(DEMO_E2E.port) },
    stdout: "ignore",
    stderr: "pipe",
  },
  reporter: [["line"]],
});
