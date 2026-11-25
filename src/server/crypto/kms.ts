import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * v1 Phase 5.3: key management for application-level field encryption (envelope encryption).
 *
 * A key-encryption key (KEK, "master key") never leaves the KMS. Clearline asks the KMS to wrap (encrypt) and unwrap
 * (decrypt) per-organisation data keys; only wrapped data keys are stored (table org_data_keys). Every wrap is bound
 * to a context string (the organisation, purpose and version of the data key), so a wrapped key copied to another
 * organisation's row does not unwrap.
 *
 * Two implementations:
 *  - LocalKms: the local stand-in. Master keys come from CLEARLINE_KMS_KEYS ("<id>:<32 bytes base64>", comma
 *    separated, the FIRST is active; the others only unwrap, which is how a master key is rotated without downtime).
 *  - HostedKmsAdapter: the shape a hosted KMS takes (encrypt/decrypt with an encryption context, key ids). It is given
 *    a client; no hosted service is called anywhere in this repository (docs/security/ENCRYPTION_V1.md).
 *
 * Errors name key ids only, never key material, plaintext or ciphertext.
 */
export interface WrappedKey { kekId: string; wrapped: string }

export interface Kms {
  /** "local" or the hosted adapter's name; shown in status output (never a key). */
  readonly name: string;
  /** The key id new data keys are wrapped with. */
  activeKekId(): string;
  /** Whether this KMS can unwrap a key wrapped under `kekId` (false once a retired master key is removed). */
  canUnwrap(kekId: string): boolean;
  wrap(dataKey: Buffer, context: string): Promise<WrappedKey>;
  unwrap(key: WrappedKey, context: string): Promise<Buffer>;
}

export class KmsError extends Error { readonly code = "KMS_ERROR"; }

const KEK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const WRAP_PREFIX = "lk1"; // local wrap format: lk1.<base64url(iv | ciphertext | tag)>

/** CLEARLINE_KMS_KEYS → ordered [id, key] pairs (first = active), or null when unset. Never echoes a value. */
export function parseKmsKeys(value: string | undefined): [string, Buffer][] | null {
  if (!value || !value.trim()) return null;
  const out: [string, Buffer][] = [];
  for (const part of value.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    const id = i > 0 ? part.slice(0, i) : "";
    if (!KEK_ID.test(id)) throw new KmsError("CLEARLINE_KMS_KEYS: each entry is <id>:<32 random bytes, base64>; an id is 1-40 letters, digits, - or _.");
    const b64 = part.slice(i + 1).trim();
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) throw new KmsError(`CLEARLINE_KMS_KEYS: master key ${id} must be 32 random bytes, base64-encoded.`);
    if (out.some(([x]) => x === id)) throw new KmsError(`CLEARLINE_KMS_KEYS: master key id ${id} appears twice.`);
    out.push([id, key]);
  }
  return out.length ? out : null;
}

/** The local stand-in: AES-256-GCM key wrapping under master keys held in the environment. */
export class LocalKms implements Kms {
  readonly name = "local";
  private readonly keys: Map<string, Buffer>;
  private readonly active: string;
  constructor(keys: [string, Buffer][]) {
    if (!keys.length) throw new KmsError("LocalKms needs at least one master key.");
    this.keys = new Map(keys);
    this.active = keys[0][0];
  }
  activeKekId() { return this.active; }
  canUnwrap(kekId: string) { return this.keys.has(kekId); }
  async wrap(dataKey: Buffer, context: string): Promise<WrappedKey> {
    const kek = this.keys.get(this.active)!;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", kek, iv);
    c.setAAD(Buffer.from(`clearline-kms|${this.active}|${context}`));
    const body = Buffer.concat([iv, c.update(dataKey), c.final(), c.getAuthTag()]);
    return { kekId: this.active, wrapped: `${WRAP_PREFIX}.${body.toString("base64url")}` };
  }
  async unwrap(key: WrappedKey, context: string): Promise<Buffer> {
    const kek = this.keys.get(key.kekId);
    if (!kek) throw new KmsError(`Master key ${key.kekId} is not configured (CLEARLINE_KMS_KEYS); a data key wrapped under it cannot be opened.`);
    if (!key.wrapped.startsWith(`${WRAP_PREFIX}.`)) throw new KmsError(`A data key wrapped under ${key.kekId} is not in the local KMS format.`);
    const body = Buffer.from(key.wrapped.slice(WRAP_PREFIX.length + 1), "base64url");
    if (body.length < 12 + 16 + 1) throw new KmsError(`A data key wrapped under ${key.kekId} is truncated.`);
    try {
      const d = createDecipheriv("aes-256-gcm", kek, body.subarray(0, 12));
      d.setAAD(Buffer.from(`clearline-kms|${key.kekId}|${context}`));
      d.setAuthTag(body.subarray(body.length - 16));
      return Buffer.concat([d.update(body.subarray(12, body.length - 16)), d.final()]);
    } catch {
      throw new KmsError(`A data key wrapped under ${key.kekId} did not open (wrong master key, wrong organisation or altered).`);
    }
  }
}

/**
 * The adapter shape for a hosted KMS (for example a cloud provider's KMS with symmetric keys). The client is the only
 * thing that talks to the service; its calls map one to one onto the usual hosted-KMS operations:
 *   encrypt  ↔ Encrypt(KeyId, Plaintext, EncryptionContext)
 *   decrypt  ↔ Decrypt(CiphertextBlob, EncryptionContext) (the service finds the key id in the blob)
 * The encryption context carries Clearline's wrap context, so the service's own audit log records which organisation's
 * data key was opened. Rotation of the hosted key itself is the service's (it keeps old key versions to decrypt);
 * moving to a NEW hosted key id is the same re-wrap as a local master key rotation. Not wired to any service here.
 */
export interface HostedKmsClient {
  encrypt(input: { keyId: string; plaintext: Uint8Array; encryptionContext: Record<string, string> }): Promise<{ ciphertext: Uint8Array }>;
  decrypt(input: { keyId: string; ciphertext: Uint8Array; encryptionContext: Record<string, string> }): Promise<{ plaintext: Uint8Array }>;
}

export class HostedKmsAdapter implements Kms {
  constructor(readonly name: string, private readonly client: HostedKmsClient, private readonly keyIds: string[]) {
    if (!keyIds.length || keyIds.some((k) => !KEK_ID.test(k))) throw new KmsError("HostedKmsAdapter needs one or more key ids (first = active).");
  }
  activeKekId() { return this.keyIds[0]; }
  canUnwrap(kekId: string) { return this.keyIds.includes(kekId); }
  async wrap(dataKey: Buffer, context: string): Promise<WrappedKey> {
    const keyId = this.activeKekId();
    const r = await this.client.encrypt({ keyId, plaintext: dataKey, encryptionContext: { clearline: context } });
    return { kekId: keyId, wrapped: `hk1.${Buffer.from(r.ciphertext).toString("base64url")}` };
  }
  async unwrap(key: WrappedKey, context: string): Promise<Buffer> {
    if (!this.canUnwrap(key.kekId)) throw new KmsError(`Hosted key ${key.kekId} is not configured; a data key wrapped under it cannot be opened.`);
    if (!key.wrapped.startsWith("hk1.")) throw new KmsError(`A data key wrapped under ${key.kekId} is not in the hosted KMS format.`);
    try {
      const r = await this.client.decrypt({ keyId: key.kekId, ciphertext: Buffer.from(key.wrapped.slice(4), "base64url"), encryptionContext: { clearline: context } });
      return Buffer.from(r.plaintext);
    } catch {
      throw new KmsError(`The hosted KMS refused to open a data key wrapped under ${key.kekId}.`);
    }
  }
}

let override: Kms | null | undefined;
/** Tests only: use this KMS instead of the environment's (undefined restores the environment). */
export function setKmsForTests(k: Kms | null | undefined) { override = k; }

/** The configured KMS, read from the environment on every call (tests change it), or null when none is configured. */
export function kmsFromEnv(env: Record<string, string | undefined> = process.env): Kms | null {
  if (override !== undefined) return override;
  const keys = parseKmsKeys(env.CLEARLINE_KMS_KEYS);
  return keys ? new LocalKms(keys) : null;
}

/** Fresh random key material for a data key or a blind-index key (32 bytes). */
export const newKeyMaterial = () => randomBytes(32);
