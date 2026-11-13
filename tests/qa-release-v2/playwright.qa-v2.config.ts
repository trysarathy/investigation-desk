import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// QA v2 browser checks. Run from the repo root after `npx next build`:
//   npx playwright test -c tests/qa-release-v2/playwright.qa-v2.config.ts --retries=0
// Port 3485 (3184 is often taken by other agents); set QA_V2_PORT to change it.
const port = Number(process.env.QA_V2_PORT ?? 3485);
const preinstalled = [process.env.CLEARLINE_PW_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60000,
  retries: 0,
  workers: 2,
  use: { baseURL: `http://127.0.0.1:${port}`, launchOptions: preinstalled ? { executablePath: preinstalled } : {} },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${port}`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/clearline`,
    timeout: 120000,
    reuseExistingServer: false,
    env: { CLEARLINE_CUSTOMER_PREVIEW: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
  outputDir: "../../test-results/qa-release-v2",
  reporter: [["line"]],
});
