import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next compiles JSX itself (tsconfig "preserve"); tests that render a component need the automatic runtime.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: { include: ["tests/**/*.test.ts"] },
});
