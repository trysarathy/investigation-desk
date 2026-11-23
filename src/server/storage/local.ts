import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadStorage } from "./index";

export class StorageRefused extends Error {}

const PLAIN = Buffer.from("CLU0");
const MAGIC = Buffer.from("CLU1");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f]{32}$/;

/** CLEARLINE_UPLOAD_KEY → 32-byte key, or null when unset. A malformed key is an error (its value is never echoed). */
export function uploadKeyFromEnv(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.trim().replace(/=+$/, "")) {
    throw new StorageRefused("CLEARLINE_UPLOAD_KEY must be 32 random bytes, base64-encoded.");
  }
  return key;
}

/**
 * Files on local disk: <dir>/<org id>/<random key>. Encrypted files are "CLU1" | 12-byte IV | ciphertext | 16-byte
 * GCM tag, with the organisation and key as additional data (a file moved to another organisation fails to open).
 * Unencrypted files (development only) are "CLU0" | bytes.
 */
export class LocalDiskStorage implements UploadStorage {
  constructor(private readonly dir: string, private readonly key: Buffer | null, private readonly refusal?: string) {}

  private where(orgId: string, storageKey: string): string {
    if (!UUID.test(orgId) || !KEY.test(storageKey)) throw new StorageRefused("Invalid storage address.");
    return path.join(this.dir, orgId, storageKey);
  }

  async put(orgId: string, bytes: Uint8Array) {
    if (this.refusal) throw new StorageRefused(this.refusal);
    const storageKey = randomBytes(16).toString("hex");
    const file = this.where(orgId, storageKey);
    let body: Buffer = Buffer.concat([PLAIN, Buffer.from(bytes)]);
    if (this.key) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", this.key, iv);
      c.setAAD(Buffer.from(`${orgId}/${storageKey}`));
      body = Buffer.concat([MAGIC, iv, c.update(Buffer.from(bytes)), c.final(), c.getAuthTag()]);
    }
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
    await rename(tmp, file);
    return { storageKey, encrypted: this.key !== null };
  }

  async get(orgId: string, storageKey: string): Promise<Uint8Array> {
    const body = await readFile(this.where(orgId, storageKey));
    if (body.subarray(0, 4).equals(PLAIN)) return new Uint8Array(body.subarray(4));
    if (!body.subarray(0, 4).equals(MAGIC)) throw new StorageRefused("Not an upload file.");
    if (!this.key) throw new StorageRefused("This file is encrypted and CLEARLINE_UPLOAD_KEY is not set.");
    const d = createDecipheriv("aes-256-gcm", this.key, body.subarray(4, 16));
    d.setAAD(Buffer.from(`${orgId}/${storageKey}`));
    d.setAuthTag(body.subarray(body.length - 16));
    return new Uint8Array(Buffer.concat([d.update(body.subarray(16, body.length - 16)), d.final()]));
  }

  async delete(orgId: string, storageKey: string): Promise<boolean> {
    const file = this.where(orgId, storageKey);
    try { await stat(file); } catch { return false; }
    await rm(file, { force: true });
    return true;
  }
}
