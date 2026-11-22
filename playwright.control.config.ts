import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { E2E, serverEnv } from "./tests/e2e-control/env";

/**
 * Clearline Control browser suite (rc5 private staging): real sign-in, real PostgreSQL, the pilot deployment gate.
 *
 * Build with the SAME pilot environment first (the deployment gate and the root layout read it):
 *   CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=postgres://clearline_runtime:devruntime_pw@127.0.0.1:54329/clearline_e2e \
 *   BETTER_AUTH_SECRET=test-only-e2e-secret-not-for-deploy-0001 CLEARLINE_ORIGIN=http://127.0.0.1:3197 npx next build
 * then run: npm run e2e:control   (or npx playwright test -c playwright.control.config.ts)
 *
 * The global setup drops and recreates the e2e database's schema from the committed migrations and seeds the
 * fictional demo through scripts/control/admin.ts, so every run starts from the same state. One worker: the specs
 * share that database and the journey changes it.
 */
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: "./tests/e2e-control",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/e2e-control/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: E2E.origin, trace: "off", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${E2E.port}`,
    url: `${E2E.origin}/control/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: serverEnv(),
  },
  reporter: [["line"]],
});
