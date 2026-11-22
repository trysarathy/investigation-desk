// Lint config for the CI "lint" job. Kept out of the repo root on purpose:
// `next build` auto-runs ESLint when it finds a root config and eslint is
// installed, and main does not lint clean yet (see .github/workflows/ci.yml).
// Run: npm run lint (installs the pinned linters without saving them).
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: process.cwd() });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // CommonJS scripts (role tooling under team/**) must use require(); the TypeScript rule is for ES modules.
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // `let { ws, id } = f()` where only `ws` is reassigned cannot be split without churning hundreds of
  // financial-correctness tests; ESLint's documented option flags a destructuring only when every name could be const.
  { rules: { "prefer-const": ["error", { destructuring: "all" }] } },
];

export default config;
