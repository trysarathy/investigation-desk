/**
 * rc4 Connect — pluggable webhook verification on the RAW body.
 *
 * - Every scheme verifies the exact bytes received (the raw body string), never a re-serialised parse.
 * - Several active secrets per provider (key rotation); each key has an optional validity window.
 * - Replay window: the signed timestamp must be within the scheme's tolerance of the verifier's clock.
 * - Signature comparison is constant-time and does not stop at the first matching key.
 * - A provider with no signing scheme, or one this sandbox does not implement, is "unverified":
 *   its webhook is a hint to poll, never a fact.
 * - Sandbox secrets are fictional `test_` strings and protect nothing.
 */
import { constantTimeEqual, hmacSha256Hex } from "../sha256";
import { verifySandboxWebhook } from "../webhooks";
import type { ConnectVerification, SigningKey, VerificationScheme, VerificationSchemeId } from "./types";

export const IMPLEMENTED_SCHEMES: readonly VerificationSchemeId[] = ["clearline_sandbox_v1", "hex_hmac_sha256_ts", "multi_sig_hmac_sha256_ts"];

const BUNDLE_PREFIX = "headers-v1:";
const MAX_BUNDLE = 4096;

/** Refuses any key that is not a fictional `test_` secret (sandbox rule). */
export function assertSandboxKeyring(keys: readonly SigningKey[]): void {
  for (const k of keys) if (typeof k.secret !== "string" || !k.secret.startsWith("test_")) throw new Error(`Sandbox keyring accepts test_ secrets only (key ${k.keyId})`);
}

/**
 * The v1 WebhookDelivery has one `signatureHeader` string. For Connect providers it carries the
 * provider's signature headers as a canonical bundle: `headers-v1:` + JSON of the lower-cased
 * header names (sorted) and their values.
 */
export function encodeHeaderBundle(headers: Record<string, string>): string {
  const entries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return BUNDLE_PREFIX + JSON.stringify(Object.fromEntries(entries));
}

export function decodeHeaderBundle(bundle: unknown): Record<string, string> | undefined {
  if (typeof bundle !== "string" || bundle.length > MAX_BUNDLE || !bundle.startsWith(BUNDLE_PREFIX)) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(bundle.slice(BUNDLE_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 16 || entries.some(([k, x]) => !/^[a-z0-9-]{1,64}$/.test(k) || typeof x !== "string" || x.length > 1024)) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

const activeKeys = (keys: readonly SigningKey[], now: number) =>
  keys.filter((k) => k.secret.startsWith("test_") && (k.activeFrom === undefined || now >= k.activeFrom) && (k.activeUntil === undefined || now <= k.activeUntil));

/** Constant-time over every (key, signature) pair; returns the first matching key id, if any. */
function matchAny(keys: readonly SigningKey[], signedPayload: string, signatures: readonly string[]): string | undefined {
  let found: string | undefined;
  for (const k of keys) {
    const expected = hmacSha256Hex(k.secret, signedPayload);
    let hit = false;
    for (const s of signatures) hit = constantTimeEqual(expected, s) || hit;
    if (hit && found === undefined) found = k.keyId;
  }
  return found;
}

function verifyOne(scheme: VerificationScheme, rawBody: string, h: Record<string, string>, keys: readonly SigningKey[], now: number): ConnectVerification {
  const invalid = (reason: Extract<ConnectVerification, { status: "invalid" }>["reason"]): ConnectVerification => ({ status: "invalid", scheme: scheme.id, reason });
  if (!Number.isFinite(now)) return invalid("timestamp_outside_tolerance");
  const sigHeader = scheme.signatureHeader ? h[scheme.signatureHeader] : undefined;
  if (sigHeader === undefined) return invalid("missing_signature");
  const usable = activeKeys(keys, now);
  if (!usable.length) return invalid("no_active_key");

  if (scheme.id === "clearline_sandbox_v1") {
    // The existing scheme: `t=<unix>,v1=<hex>`; tried against every active key.
    let last: ConnectVerification = invalid("signature_mismatch");
    let ok: ConnectVerification | undefined;
    for (const k of usable) {
      const v = verifySandboxWebhook(rawBody, sigHeader, k.secret, now, scheme.toleranceSeconds);
      if (v.valid && !ok) ok = { status: "verified", scheme: scheme.id, keyId: k.keyId, timestamp: v.timestamp };
      else if (!v.valid) last = invalid(v.reason === "unverified_scheme" ? "malformed_header" : v.reason);
    }
    return ok ?? last;
  }

  const tsRaw = scheme.timestampHeader ? h[scheme.timestampHeader] : undefined;
  if (tsRaw === undefined || !/^\d{1,12}$/.test(tsRaw)) return invalid("malformed_header");
  const ts = Number(tsRaw);
  if (Math.abs(now - ts) > scheme.toleranceSeconds) return invalid("timestamp_outside_tolerance");
  const signed = `${ts}.${rawBody}`;

  let signatures: string[];
  if (scheme.id === "hex_hmac_sha256_ts") {
    if (!/^[0-9a-f]{64}$/.test(sigHeader)) return invalid("malformed_header");
    signatures = [sigHeader];
  } else {
    // multi_sig_hmac_sha256_ts: `v1=<hex>,v1=<hex>` — one per secret the provider signed with.
    const parts = sigHeader.split(",").map((p) => p.trim());
    if (parts.length < 1 || parts.length > 8 || parts.some((p) => !/^v1=[0-9a-f]{64}$/.test(p))) return invalid("malformed_header");
    signatures = parts.map((p) => p.slice(3));
  }
  const keyId = matchAny(usable, signed, signatures);
  return keyId ? { status: "verified", scheme: scheme.id, keyId, timestamp: ts } : invalid("signature_mismatch");
}

/**
 * Re-review RR-3: the canonical form of a declared header value, used by BOTH the pre-check and the bundle the
 * engine verifies, so they can never disagree: surrounding whitespace trimmed; a multi-signature list with the
 * whitespace around each comma removed. Canonical values of a valid delivery always fit the bundle decoder's
 * limits (≤ 8 × 67 characters for a signature list).
 */
export function canonicalHeaderValue(schemes: readonly VerificationScheme[], name: string, value: string): string {
  const n = name.toLowerCase();
  const multi = schemes.some((s) => s.id === "multi_sig_hmac_sha256_ts" && s.signatureHeader === n);
  return multi ? value.split(",").map((p) => p.trim()).join(",") : value.trim();
}

/**
 * Verify a webhook against a provider's declared scheme(s).
 * - No implemented scheme declared → `unverified` (poll to confirm).
 * - An implemented scheme is declared → that scheme decides; missing or bad headers are `invalid`.
 */
export function verifyDelivery(
  schemes: readonly VerificationScheme[],
  rawBody: string,
  headers: Record<string, string>,
  keys: readonly SigningKey[],
  nowUnixSeconds: number,
): ConnectVerification {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) if (typeof v === "string") h[k.toLowerCase()] = canonicalHeaderValue(schemes, k, v);
  const implemented = schemes.filter((s) => IMPLEMENTED_SCHEMES.includes(s.id));
  if (!implemented.length) {
    if (!schemes.length || schemes.every((s) => s.id === "none")) return { status: "unverified", scheme: "none", reason: "no_signature_scheme" };
    const declared = schemes.find((s) => s.id !== "none")!;
    return declared.id === "asymmetric_rsa_sha256_ts"
      ? { status: "unverified", scheme: declared.id, reason: "scheme_not_implemented" }
      : { status: "unverified", scheme: "unknown", reason: "unknown_scheme" };
  }
  if (typeof rawBody !== "string") return { status: "invalid", scheme: implemented[0].id, reason: "malformed_header" };
  // Several declared schemes (a provider migrating schemes): the first whose signature header is present decides.
  const present = implemented.find((s) => s.signatureHeader && h[s.signatureHeader] !== undefined) ?? implemented[0];
  return verifyOne(present, rawBody, h, keys, nowUnixSeconds);
}

/** Sandbox signing, so tests and the simulator can produce what the fictional provider would send. */
export function signDelivery(scheme: VerificationScheme, rawBody: string, keys: readonly SigningKey[], unixSeconds: number): Record<string, string> {
  assertSandboxKeyring(keys);
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0) throw new Error("unixSeconds must be a non-negative integer");
  const signed = `${unixSeconds}.${rawBody}`;
  switch (scheme.id) {
    case "clearline_sandbox_v1":
      return { [scheme.signatureHeader!]: `t=${unixSeconds},v1=${hmacSha256Hex(keys[0].secret, signed)}` };
    case "hex_hmac_sha256_ts":
      return { [scheme.timestampHeader!]: String(unixSeconds), [scheme.signatureHeader!]: hmacSha256Hex(keys[0].secret, signed) };
    case "multi_sig_hmac_sha256_ts":
      return { [scheme.timestampHeader!]: String(unixSeconds), [scheme.signatureHeader!]: keys.map((k) => `v1=${hmacSha256Hex(k.secret, signed)}`).join(",") };
    case "asymmetric_rsa_sha256_ts":
      // Not implemented in the sandbox: the fictional provider's signature cannot be checked here.
      return { ...(scheme.timestampHeader ? { [scheme.timestampHeader]: String(unixSeconds) } : {}), ...(scheme.signatureHeader ? { [scheme.signatureHeader]: "unsupported-in-sandbox" } : {}) };
    case "none":
      return {};
  }
}
