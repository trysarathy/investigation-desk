import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * v1 Phase 5.3: the field cipher of one organisation (pure: no database, no KMS).
 *
 * - seal/open: AES-256-GCM under the organisation's data key of a given version. The additional authenticated data
 *   binds the value to organisation + table + column + row id, so a ciphertext copied to another row, column, table
 *   or organisation does not open. Stored as text: `ce1.<data key version>.<base64url(12-byte IV | ciphertext | tag)>`.
 * - blindIndex: HMAC-SHA256 under the organisation's (separate) index key over a domain and the EXACT value, as 64
 *   lowercase hex characters. Equal values give equal indexes within an organisation, so equality, uniqueness and
 *   joins keep working on the index exactly as they did on the plaintext (no normalisation is added or removed).
 *
 * Errors name the table and column only: never the value, the ciphertext, a key or a row id.
 */
export const SEALED = /^ce1\.([1-9][0-9]{0,8})\.([A-Za-z0-9_-]+)$/;

export class FieldCryptoError extends Error { readonly code = "FIELD_CRYPTO"; }

/** Index domains: every column whose values are compared with each other shares one domain (all addresses). */
export type IndexDomain = "address" | "order_ref";

export const aadOf = (orgId: string, table: string, column: string, rowId: string) => Buffer.from(`clearline/field/v1|${orgId}|${table}|${column}|${rowId}`);

/** The data key version a sealed value was written with, or null when it is not a sealed value. */
export function sealedVersion(sealed: string): number | null {
  const m = SEALED.exec(sealed);
  return m ? Number(m[1]) : null;
}

export class OrgCipher {
  constructor(
    readonly orgId: string,
    private readonly dataKeys: ReadonlyMap<number, Buffer>,
    readonly activeVersion: number,
    private readonly indexKey: Buffer,
  ) {
    if (!dataKeys.has(activeVersion)) throw new FieldCryptoError("The active data key is not loaded.");
  }

  /** Versions this cipher can open. */
  versions(): number[] { return [...this.dataKeys.keys()].sort((a, b) => a - b); }

  seal(table: string, column: string, rowId: string, plaintext: string): string {
    const key = this.dataKeys.get(this.activeVersion)!;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(aadOf(this.orgId, table, column, rowId));
    const body = Buffer.concat([iv, c.update(plaintext, "utf8"), c.final(), c.getAuthTag()]);
    return `ce1.${this.activeVersion}.${body.toString("base64url")}`;
  }

  open(table: string, column: string, rowId: string, sealed: string): string {
    const m = SEALED.exec(sealed);
    if (!m) throw new FieldCryptoError(`${table}.${column}: a stored value is not in the sealed format.`);
    const key = this.dataKeys.get(Number(m[1]));
    if (!key) throw new FieldCryptoError(`${table}.${column}: the data key version a value was sealed with is not available.`);
    const body = Buffer.from(m[2], "base64url");
    if (body.length < 12 + 16) throw new FieldCryptoError(`${table}.${column}: a sealed value is truncated.`);
    try {
      const d = createDecipheriv("aes-256-gcm", key, body.subarray(0, 12));
      d.setAAD(aadOf(this.orgId, table, column, rowId));
      d.setAuthTag(body.subarray(body.length - 16));
      return Buffer.concat([d.update(body.subarray(12, body.length - 16)), d.final()]).toString("utf8");
    } catch {
      throw new FieldCryptoError(`${table}.${column}: a sealed value did not open (altered, moved to another row, or the wrong key).`);
    }
  }

  blindIndex(domain: IndexDomain, value: string): string {
    return createHmac("sha256", this.indexKey).update(`clearline/bidx/v1|${domain}|`).update(value, "utf8").digest("hex");
  }
}
