/**
 * Test-only configuration for the rc6 merchant reconciliation browser suite: its own database and port so it never
 * shares state with the rc5 Control suite or another worktree. Every value is a fictional, test-only string.
 */
import path from "node:path";
import { testDeployEnv } from "../deploy-env";
const PORT = Number(process.env.CLEARLINE_MERCHANT_E2E_PORT ?? 3207);
export const MERCHANT_E2E = {
  port: PORT,
  origin: `http://127.0.0.1:${PORT}`,
  ownerUrl: process.env.CLEARLINE_MERCHANT_E2E_OWNER_URL ?? "postgres://clearline_owner:devowner_pw@127.0.0.1:54329/clearline_e2e_rc6u",
  runtimeUrl: process.env.CLEARLINE_MERCHANT_E2E_RUNTIME_URL ?? "postgres://clearline_runtime:devruntime_pw@127.0.0.1:54329/clearline_e2e_rc6u",
  /** Test-only Better Auth secret (40 characters). Never use it outside this suite. */
  authSecret: "test-only-e2e-secret-not-for-deploy-0001",
  password: process.env.CLEARLINE_E2E_PASSWORD ?? "fictional-e2e-pass-01",
  /** rc7 upload storage for this suite: its own folder, and a test-only key (32 bytes) so files are encrypted as in production. */
  uploadDir: process.env.CLEARLINE_MERCHANT_E2E_UPLOAD_DIR ?? `.data/e2e-merchant-uploads-${PORT}`,
  uploadKey: Buffer.from("test-only-e2e-upload-key-0000001", "utf8").toString("base64"),
  /** rc7 phase 2: the recorded chain data the server's verify step reads (written by the live seed from the synthetic world). */
  chainRecording: path.resolve(process.env.CLEARLINE_MERCHANT_E2E_CHAIN_RECORDING ?? `.data/e2e-merchant-chain-${PORT}.json`),
} as const;

export function merchantServerEnv(): Record<string, string> {
  return {
    CLEARLINE_CONTROL_PILOT: "1",
    DATABASE_URL: MERCHANT_E2E.runtimeUrl,
    BETTER_AUTH_SECRET: MERCHANT_E2E.authSecret,
    CLEARLINE_ORIGIN: MERCHANT_E2E.origin,
    NEXT_TELEMETRY_DISABLED: "1",
    CLEARLINE_UPLOAD_DIR: MERCHANT_E2E.uploadDir,
    CLEARLINE_UPLOAD_KEY: MERCHANT_E2E.uploadKey,
    CLEARLINE_CHAIN_RECORDING: MERCHANT_E2E.chainRecording,
    // v1 #165: a production server refuses to start without it
    CLEARLINE_DEPLOY_ENV: testDeployEnv(),
  };
}
