/**
 * A minimal WebAuthn (Level 2) relying-party verifier for passkeys used as a SECOND factor (v1 phase 1.2).
 *
 * Why hand-written: no WebAuthn library is installed (no @simplewebauthn, no Better Auth passkey plugin) and packages
 * cannot be added in this build. The scope is kept small on purpose, and everything outside it is REFUSED:
 * - algorithms: ES256 (COSE -7, P-256) and RS256 (COSE -257) only, verified with node:crypto;
 * - attestation: "none" is requested; the attestation statement is not verified (Clearline does not need to know the
 *   authenticator's make), so a credential proves possession of a key, nothing about the device;
 * - checks on every ceremony: type, challenge (single-use, issued by the server), exact origin, not cross-origin, RP ID
 *   hash, user-present AND user-verified flags; on assertion the signature over authData || SHA-256(clientDataJSON),
 *   the credential belonging to the expected user, and a strictly increasing signature counter when either is non-zero.
 * Pure (no I/O). Independent review requested before production (APPROVAL-ONLY item in the phase 1.2 report).
 */
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify, type KeyObject } from "node:crypto";

export class WebAuthnError extends Error {}
const fail = (m: string): never => { throw new WebAuthnError(m); };

export const b64url = {
  encode: (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) fail("not base64url");
    return Buffer.from(s, "base64url");
  },
};
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

// ---- CBOR (RFC 8949): the subset WebAuthn uses — unsigned/negative ints, byte/text strings, arrays, maps, simple. --
type Cbor = number | bigint | Buffer | string | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;
export function decodeCbor(buf: Buffer, start = 0): { value: Cbor; end: number } {
  let p = start;
  const need = (n: number) => { if (p + n > buf.length) fail("CBOR truncated"); };
  const len = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[p++]; }
    if (info === 25) { need(2); const v = buf.readUInt16BE(p); p += 2; return v; }
    if (info === 26) { need(4); const v = buf.readUInt32BE(p); p += 4; return v; }
    if (info === 27) { need(8); const v = buf.readBigUInt64BE(p); p += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) fail("CBOR integer too large"); return Number(v); }
    return fail("CBOR indefinite length not supported");
  };
  let depth = 0;
  const item = (): Cbor => {
    if (++depth > 16) fail("CBOR nested too deeply");
    need(1);
    const b = buf[p++];
    const major = b >> 5, info = b & 31;
    let out: Cbor;
    switch (major) {
      case 0: out = len(info); break;
      case 1: out = -1 - len(info); break;
      case 2: { const n = len(info); need(n); out = Buffer.from(buf.subarray(p, p + n)); p += n; break; }
      case 3: { const n = len(info); need(n); out = buf.subarray(p, p + n).toString("utf8"); p += n; break; }
      case 4: { const n = len(info); if (n > 1000) fail("CBOR array too long"); const a: Cbor[] = []; for (let i = 0; i < n; i++) a.push(item()); out = a; break; }
      case 5: { const n = len(info); if (n > 100) fail("CBOR map too long"); const m = new Map<Cbor, Cbor>(); for (let i = 0; i < n; i++) { const k = item(); if (m.has(k)) fail("CBOR duplicate key"); m.set(k, item()); } out = m; break; }
      case 7: out = info === 20 ? false : info === 21 ? true : info === 22 ? null : info === 23 ? undefined : fail("CBOR simple/float not supported"); break;
      default: out = fail("CBOR tags not supported");
    }
    depth--;
    return out;
  };
  const value = item();
  return { value, end: p };
}

// ---- authenticator data ------------------------------------------------------------------------------------------
export const FLAG = { UP: 0x01, UV: 0x04, AT: 0x40, ED: 0x80 } as const;
export interface AuthData { rpIdHash: Buffer; flags: number; signCount: number; credentialId?: Buffer; cosePublicKey?: Map<Cbor, Cbor> }
export function parseAuthData(ad: Buffer): AuthData {
  if (ad.length < 37) fail("authenticator data too short");
  const rpIdHash = ad.subarray(0, 32), flags = ad[32], signCount = ad.readUInt32BE(33);
  let p = 37;
  const out: AuthData = { rpIdHash: Buffer.from(rpIdHash), flags, signCount };
  if (flags & FLAG.AT) {
    if (ad.length < p + 18) fail("attested credential data truncated");
    p += 16; // AAGUID (not used: attestation is not verified)
    const n = ad.readUInt16BE(p); p += 2;
    if (n < 16 || n > 1023 || ad.length < p + n) fail("credential id length invalid");
    out.credentialId = Buffer.from(ad.subarray(p, p + n)); p += n;
    const { value, end } = decodeCbor(ad, p);
    if (!(value instanceof Map)) fail("credential public key is not a COSE map");
    out.cosePublicKey = value as Map<Cbor, Cbor>;
    p = end;
  }
  if (flags & FLAG.ED) { p = decodeCbor(ad, p).end; }
  if (p !== ad.length) fail("authenticator data has trailing bytes");
  return out;
}

/** COSE_Key → a node public key. ES256 (EC2/P-256) and RS256 only. */
export function coseToPublicKey(k: Map<Cbor, Cbor>): { alg: -7 | -257; key: KeyObject } {
  const kty = k.get(1), alg = k.get(3);
  if (kty === 2 && alg === -7) {
    const crv = k.get(-1), x = k.get(-2), y = k.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) fail("unsupported EC2 key");
    return { alg: -7, key: createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url.encode(x as Buffer), y: b64url.encode(y as Buffer) }, format: "jwk" }) };
  }
  if (kty === 3 && alg === -257) {
    const n = k.get(-1), e = k.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) fail("unsupported RSA key (2048 bits or more required)");
    return { alg: -257, key: createPublicKey({ key: { kty: "RSA", n: b64url.encode(n as Buffer), e: b64url.encode(e as Buffer) }, format: "jwk" }) };
  }
  return fail("unsupported credential algorithm (ES256 or RS256 only)");
}

export interface Expected { challenge: string; origin: string; rpId: string }

function checkClientData(raw: Buffer, type: "webauthn.create" | "webauthn.get", exp: Expected): void {
  let c: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try { c = JSON.parse(raw.toString("utf8")); } catch { return fail("client data is not JSON"); }
  if (c.type !== type) fail("wrong ceremony type");
  if (typeof c.challenge !== "string" || !safeEqual(c.challenge, exp.challenge)) fail("challenge mismatch");
  if (c.origin !== exp.origin) fail("origin mismatch");
  if (c.crossOrigin === true) fail("cross-origin ceremony refused");
}
function checkFlagsAndRp(ad: AuthData, exp: Expected): void {
  if (!ad.rpIdHash.equals(sha256(exp.rpId))) fail("RP ID mismatch");
  if (!(ad.flags & FLAG.UP)) fail("user presence required");
  if (!(ad.flags & FLAG.UV)) fail("user verification required");
}
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface RegistrationResponse { id: string; rawId: string; type: string; response: { clientDataJSON: string; attestationObject: string; transports?: string[] } }
export interface NewCredential { credentialId: string; publicKeySpki: string; alg: -7 | -257; signCount: number; transports: string | null }

/** Verify a navigator.credentials.create() result. */
export function verifyRegistration(r: RegistrationResponse, exp: Expected): NewCredential {
  if (!r || r.type !== "public-key" || typeof r.id !== "string" || r.id !== r.rawId) fail("not a public-key credential");
  checkClientData(b64url.decode(r.response?.clientDataJSON), "webauthn.create", exp);
  const att = decodeCbor(b64url.decode(r.response.attestationObject));
  if (!(att.value instanceof Map)) fail("attestation object is not a map");
  const authData = (att.value as Map<Cbor, Cbor>).get("authData");
  if (!Buffer.isBuffer(authData)) fail("attestation object has no authData");
  const ad = parseAuthData(authData as Buffer);
  checkFlagsAndRp(ad, exp);
  if (!(ad.flags & FLAG.AT) || !ad.credentialId || !ad.cosePublicKey) fail("no attested credential");
  if (b64url.encode(ad.credentialId!) !== r.id) fail("credential id mismatch");
  const { alg, key } = coseToPublicKey(ad.cosePublicKey!);
  const transports = Array.isArray(r.response.transports) ? r.response.transports.filter((t) => typeof t === "string" && /^[a-z-]{2,20}$/.test(t)).slice(0, 6).join(",") : "";
  return { credentialId: r.id, publicKeySpki: key.export({ type: "spki", format: "der" }).toString("base64"), alg, signCount: ad.signCount, transports: transports || null };
}

export interface AssertionResponse { id: string; rawId: string; type: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null } }
export interface StoredCredential { credentialId: string; publicKeySpki: string; alg: number; signCount: number }

/** Verify a navigator.credentials.get() result against the user's stored credential. Returns the new counter. */
export function verifyAssertion(r: AssertionResponse, cred: StoredCredential, exp: Expected & { userHandle: string }): { signCount: number } {
  if (!r || r.type !== "public-key" || r.id !== r.rawId || r.id !== cred.credentialId) fail("unknown credential");
  const cdj = b64url.decode(r.response?.clientDataJSON);
  checkClientData(cdj, "webauthn.get", exp);
  const adRaw = b64url.decode(r.response.authenticatorData);
  const ad = parseAuthData(adRaw);
  checkFlagsAndRp(ad, exp);
  if (r.response.userHandle && b64url.decode(r.response.userHandle).toString("utf8") !== exp.userHandle) fail("user handle mismatch");
  const key = createPublicKey({ key: Buffer.from(cred.publicKeySpki, "base64"), format: "der", type: "spki" });
  const data = Buffer.concat([adRaw, sha256(cdj)]);
  const sig = b64url.decode(r.response.signature);
  const ok = cred.alg === -7 ? cryptoVerify("sha256", data, { key, dsaEncoding: "der" }, sig)
    : cred.alg === -257 ? cryptoVerify("sha256", data, key, sig) : false;
  if (!ok) fail("signature invalid");
  if ((ad.signCount !== 0 || cred.signCount !== 0) && ad.signCount <= cred.signCount) fail("signature counter did not increase (possible cloned authenticator)");
  return { signCount: ad.signCount };
}
