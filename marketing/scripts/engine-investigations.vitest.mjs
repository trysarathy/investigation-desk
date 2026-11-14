// Config for engine-investigations.gen.ts. Plain object so it needs no local vitest install.
const E = process.env.ENGINE;
if (!E) throw new Error("Set ENGINE to a checkout of rc3/clearline-app");
export default {
  resolve: { alias: { "clearline-engine": E + "/src/lib/clearline/index.ts", "@": E + "/src", "server-only": E + "/tests/stubs/server-only.ts" } },
  test: { include: ["engine-investigations.gen.ts"] },
  server: { fs: { strict: false } },
};
