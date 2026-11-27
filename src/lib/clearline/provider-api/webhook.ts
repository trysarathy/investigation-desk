/**
 * v1 phase 2.2: verifying a provider's webhook delivery. Pure: no I/O, no clock of its own.
 *
 * Signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256>` (several v1= values allowed, for secret rotation on the
 * provider's side); the signed message is `<t>.<raw body bytes>`. The comparison is constant-time (timingSafeEqual on
 * equal-length digests). A delivery outside the timestamp tolerance is refused, so a captured delivery cannot be
 * replayed later; inside the window, the event id store refuses a second delivery of the same id (server side).
 *
 * Every refusal has a reason CODE for the audit trail; the HTTP answer never says which check failed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { IngestError } from "@/lib/clearline/ingest";
import { JsonNumber, parseJson, type JsonValue } from "@/lib/clearline/ingest/json";

export const SIGNATURE_HEADER = "clearline-provider-signature";
export const WEBHOOK_MAX_BYTES = 256 * 1024;
export const TIMESTAMP_TOLERANCE_SECONDS = 300;
export const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export type WebhookRefusal = "too_large" | "malformed_signature" | "stale_timestamp" | "bad_signature" | "malformed_body" | "no_event_id" | "secret_unavailable";

export type WebhookVerdict = { ok: true; eventId: string; signedAt: Date; bodySha256: string } | { ok: false; reason: WebhookRefusal };

/** The provider side (and tests): sign a body. */
export function signWebhook(secret: string, body: Uint8Array | string, unixSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${unixSeconds}.`).update(body).digest("hex");
  return `t=${unixSeconds},v1=${mac}`;
}

function parseHeader(h: string | null): { t: number; sigs: Buffer[] } | null {
  if (!h || h.length > 1024) return null;
  let t: number | undefined;
  const sigs: Buffer[] = [];
  for (const part of h.split(",")) {
    const [k, v, extra] = part.trim().split("=");
    if (extra !== undefined || !k || v === undefined) return null;
    if (k === "t") { if (!/^\d{1,12}$/.test(v) || t !== undefined) return null; t = Number(v); }
    else if (k === "v1") { if (!/^[0-9a-f]{64}$/.test(v)) return null; sigs.push(Buffer.from(v, "hex")); }
  }
  return t === undefined || !sigs.length || sigs.length > 5 ? null : { t, sigs };
}

/**
 * Verify one delivery. `secret` is null when the server secret the connection names is not set: refused.
 * Checks, in order: size, header shape, timestamp window, signature (constant time), body shape, event id.
 */
export function verifyWebhook(input: { secret: string | null; body: Uint8Array; signature: string | null; nowSeconds: number; toleranceSeconds?: number }): WebhookVerdict {
  if (input.body.byteLength > WEBHOOK_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (!input.secret) return { ok: false, reason: "secret_unavailable" };
  const h = parseHeader(input.signature);
  if (!h) return { ok: false, reason: "malformed_signature" };
  const tol = input.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(input.nowSeconds - h.t) > tol) return { ok: false, reason: "stale_timestamp" };
  const expected = createHmac("sha256", input.secret).update(`${h.t}.`).update(input.body).digest();
  let match = false;
  for (const s of h.sigs) if (s.length === expected.length && timingSafeEqual(s, expected)) match = true;
  if (!match) return { ok: false, reason: "bad_signature" };
  let body: JsonValue;
  try { body = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(input.body)); } catch (e) {
    if (e instanceof IngestError || e instanceof TypeError) return { ok: false, reason: "malformed_body" };
    throw e;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) || body instanceof JsonNumber) return { ok: false, reason: "malformed_body" };
  const id = (body as Record<string, JsonValue>).id;
  if (typeof id !== "string" || !EVENT_ID_RE.test(id)) return { ok: false, reason: "no_event_id" };
  return { ok: true, eventId: id, signedAt: new Date(h.t * 1000), bodySha256: createHash("sha256").update(input.body).digest("hex") };
}
