import { defineConfig } from "vitest/config";
import path from "node:path";

// Clearline Control integration tests against a REAL PostgreSQL 16 (no mocks). They never skip: without
// CLEARLINE_TEST_OWNER_URL / CLEARLINE_TEST_RUNTIME_URL the suite fails with "BLOCKED". Run: npm run test:control
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: { include: ["tests/control/**/*.test.ts"], fileParallelism: false, testTimeout: 60_000, hookTimeout: 120_000, globalSetup: ["tests/control/global-setup.ts"] },
});
