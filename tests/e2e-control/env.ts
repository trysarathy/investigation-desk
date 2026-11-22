/**
 * Test-only configuration for the Clearline Control browser suite. Every value here is a fictional, test-only string
 * for a local or CI database; none is a deployment secret. Override with the CLEARLINE_E2E_* variables.
 */
export const E2E = {
  port: 3197,
  origin: "http://127.0.0.1:3197",
  ownerUrl: process.env.CLEARLINE_E2E_OWNER_URL ?? "postgres://clearline_owner:devowner_pw@127.0.0.1:54329/clearline_e2e",
  runtimeUrl: process.env.CLEARLINE_E2E_RUNTIME_URL ?? "postgres://clearline_runtime:devruntime_pw@127.0.0.1:54329/clearline_e2e",
  /** Test-only Better Auth secret (40 characters). Never use it outside this suite. */
  authSecret: "test-only-e2e-secret-not-for-deploy-0001",
  /** The fictional demo users' password for this suite. */
  password: process.env.CLEARLINE_E2E_PASSWORD ?? "fictional-e2e-pass-01",
} as const;

/** The environment `next build` and `next start` need for the pilot (the build must use the same pilot flag). */
export function serverEnv(port: number = E2E.port): Record<string, string> {
  return {
    CLEARLINE_CONTROL_PILOT: "1",
    DATABASE_URL: E2E.runtimeUrl,
    BETTER_AUTH_SECRET: E2E.authSecret,
    CLEARLINE_ORIGIN: `http://127.0.0.1:${port}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
