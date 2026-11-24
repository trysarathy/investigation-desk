import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { MERCHANT_E2E, merchantServerEnv } from "./tests/e2e-merchant/env";

/**
 * rc6 merchant reconciliation and provider console browser suite: real sign-in, real PostgreSQL 16 (its own
 * database), the pilot deployment gate, the fictional provider and merchants seeded through the admin CLI.
 *
 * Build with the pilot environment first, as a TEST build (rc8: CLEARLINE_TEST_BUILD=1 at build is what lets the
 * server honour the recorded chain data the suite and the blind test (npm run e2e:blind) use; a build without it
 * refuses to start with CLEARLINE_CHAIN_RECORDING set):
 *   CLEARLINE_TEST_BUILD=1 CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=postgres://clearline_runtime:devruntime_pw@127.0.0.1:54329/clearline_e2e_rc6u \
 *   BETTER_AUTH_SECRET=test-only-e2e-secret-not-for-deploy-0001 CLEARLINE_ORIGIN=http://127.0.0.1:3207 npx next build
 * then: npx playwright test -c playwright.merchant.config.ts
 * Set MERCHANT_SCREENSHOT_DIR=docs/product/screenshots-rc6 to save screenshots. One worker: the specs share the
 * database and each journey starts from a freshly migrated and seeded one.
 */
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: "./tests/e2e-merchant",
  testMatch: "*.spec.ts",
  // rc7 Phase 5: the blind test (a month through the UI, about 2,000 payments) runs on its own: npm run e2e:blind
  testIgnore: process.env.CLEARLINE_BLIND ? [] : ["blind.spec.ts"],
  globalSetup: "./tests/e2e-merchant/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: MERCHANT_E2E.origin, trace: "off", screenshot: "only-on-failure", launchOptions, acceptDownloads: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${MERCHANT_E2E.port}`,
    url: `${MERCHANT_E2E.origin}/control/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: merchantServerEnv(),
  },
  reporter: [["line"]],
});
