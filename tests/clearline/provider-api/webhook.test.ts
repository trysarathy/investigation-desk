/** v1 phase 2.2: webhook verification (fictional secret and events). */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolveSecret, signWebhook, verifyWebhook, WEBHOOK_MAX_BYTES } from "@/lib/clearline/provider-api";

const SECRET = "fictional-webhook-secret-000000001";
const NOW = 1_795_000_000;
const body = new TextEncoder().encode('{"id":"evt_fict_1","type":"payment.updated","data":{"id":"PAY-FICT-1"}}');
const v = (o: Partial<Parameters<typeof verifyWebhook>[0]> = {}) => verifyWebhook({ secret: SECRET, body, signature: signWebhook(SECRET, body, NOW), nowSeconds: NOW, ...o });

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh delivery and names its event id and body hash", () => {
    expect(v()).toEqual({ ok: true, eventId: "evt_fict_1", signedAt: new Date(NOW * 1000), bodySha256: createHash("sha256").update(body).digest("hex") });
    // several v1 signatures (rotation): one match is enough
    const sig = `${signWebhook("fictional-old-secret-0000000000", body, NOW)},v1=${signWebhook(SECRET, body, NOW).split("v1=")[1]}`;
    expect(v({ signature: sig }).ok).toBe(true);
  });

  it("refuses a wrong secret, a changed body, a changed timestamp, and a malformed header", () => {
    expect(v({ signature: signWebhook("fictional-other-secret-00000000", body, NOW) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(v({ body: new TextEncoder().encode('{"id":"evt_fict_1","type":"payment.updated","data":{"id":"PAY-FICT-2"}}') })).toEqual({ ok: false, reason: "bad_signature" });
    const [, mac] = signWebhook(SECRET, body, NOW).split(",");
    expect(v({ signature: `t=${NOW + 1},${mac}` })).toEqual({ ok: false, reason: "bad_signature" });
    for (const h of [null, "", "v1=abc", `t=${NOW}`, `t=${NOW},v1=zz`, `t=x,v1=${"0".repeat(64)}`, `t=${NOW},t=${NOW},v1=${"0".repeat(64)}`]) {
      expect(v({ signature: h }), String(h)).toEqual({ ok: false, reason: "malformed_signature" });
    }
  });

  it("refuses a delivery outside the timestamp tolerance (a captured delivery cannot be replayed later)", () => {
    expect(v({ nowSeconds: NOW + 301 })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(v({ nowSeconds: NOW - 301 })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(v({ nowSeconds: NOW + 300 }).ok).toBe(true);
  });

  it("refuses an oversized body, a missing secret, a non-object body and a missing or unsafe event id", () => {
    const big = new Uint8Array(WEBHOOK_MAX_BYTES + 1);
    expect(v({ body: big, signature: signWebhook(SECRET, big, NOW) })).toEqual({ ok: false, reason: "too_large" });
    expect(v({ secret: null })).toEqual({ ok: false, reason: "secret_unavailable" });
    for (const [text, reason] of [["[1]", "malformed_body"], ["{", "malformed_body"], ['{"type":"x"}', "no_event_id"], ['{"id":"evt 1"}', "no_event_id"], ['{"id":7}', "no_event_id"]] as const) {
      const b = new TextEncoder().encode(text);
      expect(v({ body: b, signature: signWebhook(SECRET, b, NOW) }), text).toEqual({ ok: false, reason });
    }
  });
});

describe("secret references", () => {
  it("resolve only inside the reserved namespace, from the server's environment", () => {
    const env = { CLEARLINE_PROVIDER_KEY_STANDIN: "fictional-standin-api-key-0001", DATABASE_URL: "postgres://fictional", CLEARLINE_PROVIDER_KEY_SHORT: "short" };
    expect(resolveSecret("api_key", "CLEARLINE_PROVIDER_KEY_STANDIN", env)).toBe("fictional-standin-api-key-0001");
    expect(resolveSecret("api_key", "DATABASE_URL", env)).toBeNull();
    expect(resolveSecret("webhook_secret", "CLEARLINE_PROVIDER_KEY_STANDIN", env)).toBeNull();
    expect(resolveSecret("api_key", "CLEARLINE_PROVIDER_KEY_SHORT", env)).toBeNull();
    expect(resolveSecret("api_key", "CLEARLINE_PROVIDER_KEY_MISSING", env)).toBeNull();
  });
});
