/**
 * Test-only configuration for the v1 phase 1.1 onboarding browser suite (platform console, invitation, setup wizard):
 * its own database and port; invitation emails go to the local outbox table (read by the suite as the owner). Every value is a fictional, test-only string.
 */
const PORT = Number(process.env.CLEARLINE_ONBOARDING_E2E_PORT ?? 4061);
const DB = process.env.CLEARLINE_ONBOARDING_E2E_DB ?? "clearline_xb1_e2e";
export const ONBOARDING_E2E = {
  port: PORT,
  origin: `http://127.0.0.1:${PORT}`,
  ownerUrl: process.env.CLEARLINE_ONBOARDING_E2E_OWNER_URL ?? `postgres://clearline_owner:devowner_pw@127.0.0.1:54329/${DB}`,
  runtimeUrl: process.env.CLEARLINE_ONBOARDING_E2E_RUNTIME_URL ?? `postgres://clearline_runtime:devruntime_pw@127.0.0.1:54329/${DB}`,
  provisioningUrl: process.env.CLEARLINE_ONBOARDING_E2E_PROVISIONING_URL ?? `postgres://clearline_provisioning:devprov_pw@127.0.0.1:54329/${DB}`,
  /** Test-only Better Auth secret (40 characters). Never use it outside this suite. */
  authSecret: "test-only-e2e-secret-not-for-deploy-0001",
  password: "fictional-e2e-pass-01",
} as const;

export function onboardingServerEnv(): Record<string, string> {
  return {
    CLEARLINE_CONTROL_PILOT: "1",
    DATABASE_URL: ONBOARDING_E2E.runtimeUrl,
    DATABASE_PROVISIONING_URL: ONBOARDING_E2E.provisioningUrl,
    BETTER_AUTH_SECRET: ONBOARDING_E2E.authSecret,
    CLEARLINE_ORIGIN: ONBOARDING_E2E.origin,
    CLEARLINE_PLATFORM_CONSOLE: "1",
    CLEARLINE_EMAIL_SENDER: "outbox",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
