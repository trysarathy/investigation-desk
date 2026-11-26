/**
 * v1 phase 1.2 unit tests (no database): the trusted client address, the WebAuthn verifier, step-up freshness and the
 * e-mail sender interface. Fictional addresses (RFC 5737 / RFC 3849 documentation ranges) only.
 */
import { describe, expect, it } from "vitest";
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { clientIp, normalise } from "../src/server/client-ip";
import { decodeCbor, parseAuthData, verifyAssertion, verifyRegistration, WebAuthnError } from "../src/server/webauthn";
import { freshlyAuthenticated, STEP_UP_SECONDS } from "../src/server/auth-constants";
import { validMessage } from "../src/server/email/sender";

const H = (h: Record<string, string>) => new Headers(h);

describe("clientIp: never trusts a client-chosen header", () => {
  it("with nothing configured, X-Forwarded-For is ignored entirely", () => {
    expect(clientIp(H({ "x-forwarded-for": "192.0.2.1" }), {})).toBeNull();
    expect(clientIp(H({ "x-real-ip": "192.0.2.1" }), {})).toBeNull();
  });
  it("CLEARLINE_CLIENT_IP_HEADER: one value only; a list or garbage is unknown", () => {
    const env = { CLEARLINE_CLIENT_IP_HEADER: "x-real-ip" };
    expect(clientIp(H({ "x-real-ip": "192.0.2.1" }), env)).toBe("192.0.2.1");
    expect(clientIp(H({ "x-real-ip": "192.0.2.1, 192.0.2.2" }), env)).toBeNull();
    expect(clientIp(H({ "x-real-ip": "not-an-ip" }), env)).toBeNull();
    expect(clientIp(H({ "x-forwarded-for": "192.0.2.1" }), env)).toBeNull();
  });
  it("CLEARLINE_TRUSTED_PROXY_HOPS: counts from the right; client-written entries on the left cannot choose the bucket", () => {
    expect(clientIp(H({ "x-forwarded-for": "198.51.100.66, 192.0.2.9" }), { CLEARLINE_TRUSTED_PROXY_HOPS: "1" })).toBe("192.0.2.9");
    expect(clientIp(H({ "x-forwarded-for": "198.51.100.66, 192.0.2.9, 10.0.0.2" }), { CLEARLINE_TRUSTED_PROXY_HOPS: "2" })).toBe("192.0.2.9");
    expect(clientIp(H({ "x-forwarded-for": "192.0.2.9" }), { CLEARLINE_TRUSTED_PROXY_HOPS: "2" })).toBeNull(); // fewer entries than hops
    expect(clientIp(H({}), { CLEARLINE_TRUSTED_PROXY_HOPS: "1" })).toBeNull();
    for (const bad of ["0", "6", "-1", "1.5", "x"]) expect(clientIp(H({ "x-forwarded-for": "192.0.2.9" }), { CLEARLINE_TRUSTED_PROXY_HOPS: bad })).toBeNull();
  });
  it("CLEARLINE_TRUSTED_PROXIES: skips trusted hops from the right; all trusted, garbage or a bad list is unknown", () => {
    const env = { CLEARLINE_TRUSTED_PROXIES: "10.0.0.0/8, 2001:db8:ffff::1" };
    expect(clientIp(H({ "x-forwarded-for": "198.51.100.66, 192.0.2.9, 10.1.2.3" }), env)).toBe("192.0.2.9");
    expect(clientIp(H({ "x-forwarded-for": "192.0.2.9, 2001:db8:ffff::1" }), env)).toBe("192.0.2.9");
    expect(clientIp(H({ "x-forwarded-for": "10.1.2.3, 10.4.5.6" }), env)).toBeNull();
    expect(clientIp(H({ "x-forwarded-for": "junk, 10.1.2.3" }), env)).toBeNull();
    expect(clientIp(H({ "x-forwarded-for": "192.0.2.9" }), { CLEARLINE_TRUSTED_PROXIES: "10.0.0.0/33" })).toBeNull();
    // the stricter list wins over a hop count
    expect(clientIp(H({ "x-forwarded-for": "10.1.2.3" }), { ...env, CLEARLINE_TRUSTED_PROXY_HOPS: "1" })).toBeNull();
  });
  it("normalises: IPv4-mapped IPv6 to IPv4, IPv6 to its /64", () => {
    expect(normalise("::ffff:192.0.2.5")).toBe("192.0.2.5");
    expect(normalise("2001:db8:1:2:3:4:5:6")).toBe("2001:0db8:0001:0002::/64");
    expect(normalise("2001:db8:1:2::9")).toBe(normalise("2001:db8:1:2:ffff::1"));
    expect(normalise("[2001:db8::1]")).toBe("2001:0db8:0000:0000::/64");
    expect(normalise("999.1.1.1")).toBeNull();
  });
});

describe("step-up freshness", () => {
  const now = Date.now();
  const ago = (s: number) => new Date(now - s * 1000);
  it("a user with MFA counts only a second factor; a password-only user counts the sign-in or a password step-up", () => {
    expect(freshlyAuthenticated({ mfaEnrolled: true, createdAt: ago(5), mfaVerifiedAt: null, reauthenticatedAt: null }, now)).toBe(false);
    expect(freshlyAuthenticated({ mfaEnrolled: true, createdAt: ago(5000), mfaVerifiedAt: ago(30), reauthenticatedAt: null }, now)).toBe(true);
    expect(freshlyAuthenticated({ mfaEnrolled: true, createdAt: ago(5), mfaVerifiedAt: ago(STEP_UP_SECONDS + 1), reauthenticatedAt: null }, now)).toBe(false);
    expect(freshlyAuthenticated({ mfaEnrolled: false, createdAt: ago(30), mfaVerifiedAt: null, reauthenticatedAt: null }, now)).toBe(true);
    expect(freshlyAuthenticated({ mfaEnrolled: false, createdAt: ago(STEP_UP_SECONDS + 5), mfaVerifiedAt: null, reauthenticatedAt: ago(10) }, now)).toBe(true);
    expect(freshlyAuthenticated({ mfaEnrolled: false, createdAt: ago(STEP_UP_SECONDS + 5), mfaVerifiedAt: null, reauthenticatedAt: null }, now)).toBe(false);
  });
});

describe("EmailSender messages", () => {
  it("refuses header injection, several recipients and oversized bodies", () => {
    expect(validMessage({ to: "ops@lumen.example", subject: "Hello", text: "x" })).toBe(true);
    expect(validMessage({ to: "ops@lumen.example", subject: "Hello\r\nBcc: a@b.example", text: "x" })).toBe(false);
    expect(validMessage({ to: "a@lumen.example, b@lumen.example", subject: "Hello", text: "x" })).toBe(false);
    expect(validMessage({ to: "ops@lumen.example", subject: "Hello", text: "x".repeat(20_001) })).toBe(false);
  });
});

// ---- WebAuthn verifier -----------------------------------------------------------------------------------------
const ORIGIN = "https://control.clearline.example";
const RP = "control.clearline.example";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
function cbor(v: unknown): Buffer {
  const head = (m: number, n: number) => n < 24 ? Buffer.from([(m << 5) | n]) : n < 256 ? Buffer.from([(m << 5) | 24, n]) : Buffer.from([(m << 5) | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("unsupported");
}
function make(flags = 0x45, origin = ORIGIN, rp = RP, alg = -7) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const credId = randomBytes(20);
  const cose = new Map<number, number | Buffer>([[1, 2], [3, alg], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  const len = Buffer.from([0, credId.length]);
  const authData = Buffer.concat([sha(rp), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cbor(cose)]);
  const challenge = randomBytes(32).toString("base64url");
  const cdj = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin }));
  const id = credId.toString("base64url");
  const reg = { id, rawId: id, type: "public-key", response: { clientDataJSON: cdj.toString("base64url"), attestationObject: cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])).toString("base64url") } };
  return { reg, challenge, privateKey, id };
}
function assert(priv: KeyObject, id: string, challenge: string, counter: number, o: { origin?: string; flags?: number; type?: string; rp?: string } = {}) {
  const c = Buffer.alloc(4); c.writeUInt32BE(counter);
  const ad = Buffer.concat([sha(o.rp ?? RP), Buffer.from([o.flags ?? 0x05]), c]);
  const cdj = Buffer.from(JSON.stringify({ type: o.type ?? "webauthn.get", challenge, origin: o.origin ?? ORIGIN }));
  const sig = createSign("sha256").update(Buffer.concat([ad, sha(cdj)])).sign(priv);
  return { id, rawId: id, type: "public-key", response: { clientDataJSON: cdj.toString("base64url"), authenticatorData: ad.toString("base64url"), signature: sig.toString("base64url"), userHandle: Buffer.from("user-1").toString("base64url") } };
}

describe("WebAuthn verifier (ES256, attestation none)", () => {
  it("accepts a good registration and assertion", () => {
    const m = make();
    const cred = verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP });
    expect(cred).toMatchObject({ credentialId: m.id, alg: -7, signCount: 0 });
    const ch = randomBytes(32).toString("base64url");
    expect(verifyAssertion(assert(m.privateKey, m.id, ch, 1), { ...cred, signCount: 0 }, { challenge: ch, origin: ORIGIN, rpId: RP, userHandle: "user-1" })).toEqual({ signCount: 1 });
  });
  it.each([
    ["wrong challenge", () => { const m = make(); return () => verifyRegistration(m.reg, { challenge: "x".repeat(43), origin: ORIGIN, rpId: RP }); }],
    ["wrong origin", () => { const m = make(0x45, "https://evil.example"); return () => verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
    ["wrong RP ID", () => { const m = make(0x45, ORIGIN, "evil.example"); return () => verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
    ["no user verification", () => { const m = make(0x41); return () => verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
    ["no user presence", () => { const m = make(0x44); return () => verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
    ["unsupported algorithm", () => { const m = make(0x45, ORIGIN, RP, -8); return () => verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
    ["id mismatch", () => { const m = make(); return () => verifyRegistration({ ...m.reg, id: "AAAA", rawId: "AAAA" }, { challenge: m.challenge, origin: ORIGIN, rpId: RP }); }],
  ])("refuses a registration with %s", (_n, build) => {
    expect(build()).toThrow(WebAuthnError);
  });
  it("refuses assertions: bad signature, wrong type, wrong origin, no UV, replayed counter, other credential, wrong user handle", () => {
    const m = make();
    const cred = { ...verifyRegistration(m.reg, { challenge: m.challenge, origin: ORIGIN, rpId: RP }), signCount: 5 };
    const ch = randomBytes(32).toString("base64url");
    const exp = { challenge: ch, origin: ORIGIN, rpId: RP, userHandle: "user-1" };
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(() => verifyAssertion(assert(other, m.id, ch, 6), cred, exp)).toThrow(/signature/);
    expect(() => verifyAssertion(assert(m.privateKey, m.id, ch, 6, { type: "webauthn.create" }), cred, exp)).toThrow(/type/);
    expect(() => verifyAssertion(assert(m.privateKey, m.id, ch, 6, { origin: "https://evil.example" }), cred, exp)).toThrow(/origin/);
    expect(() => verifyAssertion(assert(m.privateKey, m.id, ch, 6, { flags: 0x01 }), cred, exp)).toThrow(/verification/);
    expect(() => verifyAssertion(assert(m.privateKey, m.id, ch, 5), cred, exp)).toThrow(/counter/);
    expect(() => verifyAssertion(assert(m.privateKey, "b3RoZXI", ch, 6), cred, exp)).toThrow(/credential/);
    expect(() => verifyAssertion(assert(m.privateKey, m.id, ch, 6), cred, { ...exp, userHandle: "user-2" })).toThrow(/handle/);
    expect(verifyAssertion(assert(m.privateKey, m.id, ch, 6), cred, exp)).toEqual({ signCount: 6 });
  });
  it("the CBOR and authenticator-data parsers refuse truncation, trailing bytes, tags and deep nesting", () => {
    expect(() => decodeCbor(Buffer.from([0x5a, 0, 0, 0, 9]))).toThrow(WebAuthnError);
    expect(() => decodeCbor(Buffer.from([0xc0, 0x00]))).toThrow(/tags/);
    expect(() => decodeCbor(Buffer.from(Array(20).fill(0x81).concat([0])))).toThrow(/deeply/);
    expect(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(/duplicate/);
    expect(() => parseAuthData(Buffer.alloc(36))).toThrow(/short/);
    expect(() => parseAuthData(Buffer.concat([Buffer.alloc(32), Buffer.from([0x05, 0, 0, 0, 1, 0xff])]))).toThrow(/trailing/);
  });
});
