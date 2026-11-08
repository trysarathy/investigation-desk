import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "mentor-demo.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "mentor-browser-artifacts/results.json" }]],
  outputDir: "mentor-browser-artifacts/results",
  use: { browserName: "chromium", trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "node_modules/.bin/next start --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/mentor-demo",
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
