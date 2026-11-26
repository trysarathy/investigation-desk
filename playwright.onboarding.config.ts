import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { ONBOARDING_E2E, onboardingServerEnv } from "./tests/e2e-onboarding/env";

/**
 * v1 phase 1.1 onboarding browser suite: the platform console creates a merchant and invites its first admin (email
 * through the local outbox), the admin accepts and runs the setup wizard, a non-admin is refused; desktop and mobile,
 * axe-core with 0 violations on every screen. Real sign-in, real PostgreSQL 16, the provisioning role.
 * Build the pilot first (the same build as the merchant suite):
 *   CLEARLINE_TEST_BUILD=1 CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=... BETTER_AUTH_SECRET=... CLEARLINE_ORIGIN=... npx next build
 * then: npx playwright test -c playwright.onboarding.config.ts
 */
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: "./tests/e2e-onboarding",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/e2e-onboarding/global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/onboarding",
  use: { baseURL: ONBOARDING_E2E.origin, trace: "off", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${ONBOARDING_E2E.port}`,
    url: `${ONBOARDING_E2E.origin}/control/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: onboardingServerEnv(),
  },
  reporter: [["line"]],
});
