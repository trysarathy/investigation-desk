// v1 phase 2.3: ledger OAuth tokens encrypted at rest (AES-256-GCM), and the random values of the OAuth flow.
//
// The key comes from CLEARLINE_LEDGER_TOKEN_KEY (32 bytes, base64), never from the repository or the database. A sealed
// value is bound to where it is stored (organisation, connection, field) through the GCM additional data, so a
// ciphertext copied to another organisation's row, or from the refresh-token column to the access-token column, does
// not open. Without the key nothing is connected: sealing and opening both refuse (fail closed).
//
// Format: "v1.<key id>.<iv b64url>.<tag b64url>.<ciphertext b64url>". The key id is the first 8 hex characters of the
// key's SHA-256 (it names the key, it does not reveal it), so a rotated key is detected instead of failing as garbage.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_KEY_ENV = "CLEARLINE_LEDGER_TOKEN_KEY";

export class TokenKeyMissing extends Error {
  constructor() { super(`${TOKEN_KEY_ENV} is not set (32 bytes, base64): ledger connections are off until it is.`); }
}
export class SealBroken extends Error {}

const b64u = (b: Buffer) => b.toString("base64url");

export function tokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env[TOKEN_KEY_ENV];
  if (!raw) throw new TokenKeyMissing();
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new TokenKeyMissing();
  return k;
}
export const tokenKeyConfigured = (env: Record<string, string | undefined> = process.env) => {
  try { tokenKey(env); return true; } catch { return false; }
};
const keyId = (k: Buffer) => createHash("sha256").update(k).digest("hex").slice(0, 8);

/** Where a sealed value lives; changing any part makes it unopenable. */
export interface SealContext { orgId: string; connectionId: string; field: "access_token" | "refresh_token" | "pending_tokens" | "pkce_verifier" }
const aad = (c: SealContext) => Buffer.from(`clearline-ledger|${c.orgId}|${c.connectionId}|${c.field}`, "utf8");

export function seal(plain: string, ctx: SealContext, key: Buffer = tokenKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(ctx));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", keyId(key), b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join(".");
}

export function open(sealed: string, ctx: SealContext, key: Buffer = tokenKey()): string {
  const p = sealed.split(".");
  if (p.length !== 5 || p[0] !== "v1") throw new SealBroken("not a sealed ledger token");
  if (p[1] !== keyId(key)) throw new SealBroken("sealed with another key (rotated?): reconnect the ledger");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(p[2], "base64url"));
    d.setAAD(aad(ctx));
    d.setAuthTag(Buffer.from(p[3], "base64url"));
    return Buffer.concat([d.update(Buffer.from(p[4], "base64url")), d.final()]).toString("utf8");
  } catch { throw new SealBroken("a sealed ledger token did not open (wrong row, field or key)"); }
}

/** 32 random bytes, base64url: an OAuth state, a nonce, or a PKCE code verifier (43 characters, RFC 7636). */
export const randomToken = () => b64u(randomBytes(32));
/** PKCE S256 challenge of a verifier. */
export const pkceChallenge = (verifier: string) => b64u(createHash("sha256").update(verifier, "ascii").digest());
/** What is stored of a state: its hash only (a database reader cannot complete someone's connection). */
export const stateHash = (state: string) => createHash("sha256").update(`clearline-ledger-state|${state}`).digest("hex");
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
