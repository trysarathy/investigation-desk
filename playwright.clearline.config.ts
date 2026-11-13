import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Use a preinstalled Chromium when Playwright's own pinned build is absent (no download in CI sandboxes).
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
const launchOptions = preinstalled ? { executablePath: preinstalled } : {};
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "clearline-*.spec.ts",
  timeout: 60000,
  retries: 1,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:3184", trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: "npx next start -H 127.0.0.1 -p 3184",
    url: "http://127.0.0.1:3184/clearline",
    timeout: 120000,
    reuseExistingServer: false,
    env: { CLEARLINE_CUSTOMER_PREVIEW: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
  reporter: [["line"]],
});
