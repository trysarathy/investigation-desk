import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// rc3 platform/security checks (QA L3, R2, deployment config) against the production build.
// Run `npx next build` first. Each spec starts its own `next start` on 127.0.0.1:3284 with the deployment
// environment it tests (customer preview, funding-only, Basic auth, full app), so this runs one worker.
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};
export default defineConfig({
  testDir: "./tests/platform",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/platform",
  use: { baseURL: "http://127.0.0.1:3284", trace: "off", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } },
    // The browser checks again on a phone viewport; the server-only specs run once (desktop).
    { name: "mobile", testMatch: "csp.spec.ts", use: { ...devices["iPhone 13"], browserName: "chromium", launchOptions } },
  ],
  reporter: [["line"]],
});
