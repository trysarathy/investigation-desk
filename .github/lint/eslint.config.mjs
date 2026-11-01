// Lint config for the CI "lint" job. Kept out of the repo root on purpose:
// `next build` auto-runs ESLint when it finds a root config and eslint is
// installed, and main does not lint clean yet (see .github/workflows/ci.yml).
// Run: npm run lint (installs the pinned linters without saving them).
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: process.cwd() });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
