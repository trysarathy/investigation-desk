import { defineConfig } from "vitest/config";
import path from "node:path";

// Clearline Control integration tests against a REAL PostgreSQL 16 (no mocks). They never skip: without
// CLEARLINE_TEST_OWNER_URL / CLEARLINE_TEST_RUNTIME_URL / CLEARLINE_TEST_JOBS_URL the suite fails with "BLOCKED". Run: npm run test:control
// v1 Phase 5.3: CLEARLINE_TEST_ENCRYPTION=on runs the whole suite with field encryption on (a fictional, test-only
// master key), to prove every result is the same with and without it. Off by default (no key: plaintext only, as local).
const encryption = process.env.CLEARLINE_TEST_ENCRYPTION === "on" ? { CLEARLINE_KMS_KEYS: `ctest:${Buffer.from("fictional-test-master-key-000001").toString("base64")}` } : {};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: { include: ["tests/control/**/*.test.ts"], fileParallelism: false, testTimeout: 60_000, hookTimeout: 120_000, globalSetup: ["tests/control/global-setup.ts"], env: encryption },
});
