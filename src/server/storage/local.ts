import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredFile, UploadStorage } from "./index";

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

/** A storage address: an organisation id (UUID) and a random 32-hex key. */
export function validAddress(orgId: string, storageKey: string): boolean {
  return UUID.test(orgId) && KEY.test(storageKey);
}

/**
 * The stored form of an upload (any backend): "CLU1" | 12-byte IV | AES-256-GCM ciphertext | 16-byte tag, with
 * "<org id>/<storage key>" as additional data, so a file moved to another organisation or key fails to open.
 * Without a key (development only) "CLU0" | bytes.
 */
export function sealUpload(key: Buffer | null, orgId: string, storageKey: string, bytes: Uint8Array): Buffer {
  if (!key) return Buffer.concat([PLAIN, Buffer.from(bytes)]);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`${orgId}/${storageKey}`));
  return Buffer.concat([MAGIC, iv, c.update(Buffer.from(bytes)), c.final(), c.getAuthTag()]);
}

/** The inverse of sealUpload; refuses a file that is not an upload, or an encrypted one without the key. */
export function openUpload(key: Buffer | null, orgId: string, storageKey: string, body: Buffer): Uint8Array {
  if (body.subarray(0, 4).equals(PLAIN)) return new Uint8Array(body.subarray(4));
  if (!body.subarray(0, 4).equals(MAGIC)) throw new StorageRefused("Not an upload file.");
  if (!key) throw new StorageRefused("This file is encrypted and CLEARLINE_UPLOAD_KEY is not set.");
  const d = createDecipheriv("aes-256-gcm", key, body.subarray(4, 16));
  d.setAAD(Buffer.from(`${orgId}/${storageKey}`));
  d.setAuthTag(body.subarray(body.length - 16));
  return new Uint8Array(Buffer.concat([d.update(body.subarray(16, body.length - 16)), d.final()]));
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
    const body = sealUpload(this.key, orgId, storageKey, bytes);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    try {
      await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined); // never leave a partial write behind
      throw e;
    }
    return { storageKey, encrypted: this.key !== null };
  }

  async get(orgId: string, storageKey: string): Promise<Uint8Array> {
    return openUpload(this.key, orgId, storageKey, await readFile(this.where(orgId, storageKey)));
  }

  async delete(orgId: string, storageKey: string): Promise<boolean> {
    const file = this.where(orgId, storageKey);
    try { await stat(file); } catch { return false; }
    await rm(file, { force: true });
    return true;
  }

  /** rc8: every file and partial write under <dir>/<org id>/ whose name is a storage address; other names are ignored. */
  async list(): Promise<StoredFile[]> {
    let orgs: string[];
    try { orgs = await readdir(this.dir); } catch { return []; }
    const out: StoredFile[] = [];
    for (const orgId of orgs.filter((o) => UUID.test(o))) {
      let names: string[];
      try { names = await readdir(path.join(this.dir, orgId)); } catch { continue; }
      for (const name of names) {
        const partial = name.endsWith(".tmp");
        const storageKey = partial ? name.slice(0, -4) : name;
        if (!KEY.test(storageKey)) continue;
        try { out.push({ orgId, storageKey, partial, modifiedAt: (await stat(path.join(this.dir, orgId, name))).mtime }); } catch { /* removed meanwhile */ }
      }
    }
    return out;
  }

  async deletePartial(orgId: string, storageKey: string): Promise<boolean> {
    const file = `${this.where(orgId, storageKey)}.tmp`;
    try { await stat(file); } catch { return false; }
    await rm(file, { force: true });
    return true;
  }

  /** Every file under the organisation's folder, then the folder itself. */
  async deleteOrganisation(orgId: string): Promise<number> {
    if (!UUID.test(orgId)) throw new StorageRefused("Invalid storage address.");
    const folder = path.join(this.dir, orgId);
    let names: string[];
    try { names = await readdir(folder); } catch { return 0; }
    await rm(folder, { recursive: true, force: true });
    return names.length;
  }
}
