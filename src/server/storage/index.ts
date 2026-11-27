import "server-only";
import path from "node:path";
import { LocalDiskStorage, StorageRefused, uploadKeyFromEnv } from "./local";
import { S3Storage, s3ConfigFromEnv } from "./s3";

export { StorageRefused };

/**
 * Upload storage: where uploaded files live (and nowhere else). Files are addressed by a random storage key, never
 * by their original name, under a per-organisation folder. With CLEARLINE_UPLOAD_KEY (32 bytes, base64) set, every
 * file is encrypted with AES-256-GCM; in production a missing key refuses to store anything.
 *
 * v1 phase 6: CLEARLINE_UPLOAD_STORE picks the backend: "local" (default: CLEARLINE_UPLOAD_DIR on disk) or "s3"
 * (S3-compatible object storage, src/server/storage/s3.ts; the same sealed bytes, the same refusals). Any other value
 * refuses every upload, so a typo never silently falls back to local disk.
 */
export interface UploadStorage {
  /** Store bytes for an organisation; returns the new random key and whether the file is encrypted at rest. */
  put(orgId: string, bytes: Uint8Array): Promise<{ storageKey: string; encrypted: boolean }>;
  get(orgId: string, storageKey: string): Promise<Uint8Array>;
  /** Remove a file; true when it existed. */
  delete(orgId: string, storageKey: string): Promise<boolean>;
  /** rc7 phase 3b: remove every file of an organisation (merchant deletion); the number of files removed. */
  deleteOrganisation?(orgId: string): Promise<number>;
  /**
   * rc8: every stored file (and every partial write left by a failed put), with its last-modified time, for the
   * orphan sweep. Addresses only; never file contents.
   */
  list?(): Promise<StoredFile[]>;
  /** rc8: remove a partial write (the temporary file a failed put left behind); true when it existed. */
  deletePartial?(orgId: string, storageKey: string): Promise<boolean>;
}

export interface StoredFile { orgId: string; storageKey: string; partial: boolean; modifiedAt: Date }

export const DEFAULT_UPLOAD_DIR = ".data/uploads";

/** The configured storage, read from the environment on every call (tests change it). Never prints the key. */
export function uploadStorage(): UploadStorage {
  const dir = path.resolve(process.env.CLEARLINE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR);
  const key = uploadKeyFromEnv(process.env.CLEARLINE_UPLOAD_KEY);
  const noKey = !key && process.env.NODE_ENV === "production"
    ? "Uploads are refused: CLEARLINE_UPLOAD_KEY is not set, and files are never stored unencrypted in production." : undefined;
  const store = process.env.CLEARLINE_UPLOAD_STORE || "local";
  if (store === "s3") {
    const cfg = s3ConfigFromEnv(process.env);
    if ("problem" in cfg) return new RefusingStorage(cfg.problem);
    return new S3Storage(cfg, noKey ? null : key, noKey);
  }
  if (store !== "local") return new RefusingStorage('Uploads are refused: CLEARLINE_UPLOAD_STORE must be "local" or "s3".');
  return new LocalDiskStorage(dir, noKey ? null : key, noKey);
}

/** A misconfigured store: every call refuses with the same reason (names variables, never values). */
export class RefusingStorage implements UploadStorage {
  constructor(private readonly reason: string) {}
  private no(): never { throw new StorageRefused(this.reason); }
  async put(): Promise<{ storageKey: string; encrypted: boolean }> { return this.no(); }
  async get(): Promise<Uint8Array> { return this.no(); }
  async delete(): Promise<boolean> { return this.no(); }
  async deleteOrganisation(): Promise<number> { return this.no(); }
  async list(): Promise<StoredFile[]> { return this.no(); }
  async deletePartial(): Promise<boolean> { return this.no(); }
}
