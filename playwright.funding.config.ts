import { defineConfig } from '@playwright/test';

const password = process.env.CLEARLINE_BROWSER_PASSWORD;
if (!password || password.length < 12) throw Error('Set CLEARLINE_BROWSER_PASSWORD for disposable synthetic browser fixtures.');

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['funding.spec.ts', 'mentor-demo.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: 'funding-browser-artifacts/results',
  reporter: [['list'], ['json', { outputFile: 'funding-browser-artifacts/results.json' }]],
  use: { browserName: 'chromium', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { baseURL: 'http://127.0.0.1:3001', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [3000, 3001].map(port => ({
    command: `node tests/browser/start-funding-server.mjs ${port}`,
    url: `http://127.0.0.1:${port}/`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  })),
});
