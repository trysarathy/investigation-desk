import { constantTimeEqual, hmacSha256Hex } from "./sha256";

/** Maximum allowed difference between the signed timestamp and the verifier's clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Public, test-only signing secret for a sandbox provider. It protects NOTHING and must never
 * be reused outside the sandbox. A production design needs per-endpoint secrets and rotation.
 */
export const sandboxWebhookSecret = (providerId: string): string => `test_whsec_${providerId}_public_example`;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>` */
export function signSandboxWebhook(rawBody: string, secret: string, unixSeconds: number): string {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0) throw new Error("unixSeconds must be a non-negative integer");
  if (!secret.startsWith("test_")) throw new Error("Sandbox signing accepts test_ secrets only");
  return `t=${unixSeconds},v1=${hmacSha256Hex(secret, `${unixSeconds}.${rawBody}`)}`;
}

export type WebhookVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: "malformed_header" | "timestamp_outside_tolerance" | "signature_mismatch" };

export function verifySandboxWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowUnixSeconds: number,
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): WebhookVerification {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(typeof signatureHeader === "string" ? signatureHeader : "");
  if (!m) return { valid: false, reason: "malformed_header" };
  if (typeof nowUnixSeconds !== "number" || !Number.isFinite(nowUnixSeconds)) return { valid: false, reason: "timestamp_outside_tolerance" };
  const t = Number(m[1]);
  if (Math.abs(nowUnixSeconds - t) > toleranceSeconds) return { valid: false, reason: "timestamp_outside_tolerance" };
  const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
  return constantTimeEqual(expected, m[2]) ? { valid: true, timestamp: t } : { valid: false, reason: "signature_mismatch" };
}
