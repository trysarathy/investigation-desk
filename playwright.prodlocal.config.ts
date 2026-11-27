import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * v1 phase 6: the prod-local proof (docs/ops/PROD_LOCAL.md). Runs against the stack scripts/prodlocal/run.sh started
 * (a plain production build, `next start` with NODE_ENV=production and CLEARLINE_DEPLOY_ENV=local, the job worker, a
 * private PostgreSQL 16 cluster, the S3 stand-in). It starts no server of its own. Fictional data only.
 *   scripts/prodlocal/run.sh up && npx playwright test -c playwright.prodlocal.config.ts
 */
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));
const PORT = Number(process.env.PRODLOCAL_APP_PORT ?? 4440);

export default defineConfig({
  testDir: "./tests/prodlocal",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/prodlocal/global-setup.ts",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", screenshot: "only-on-failure", launchOptions: preinstalled ? { executablePath: preinstalled } : {}, acceptDownloads: true },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  reporter: [["line"]],
});
