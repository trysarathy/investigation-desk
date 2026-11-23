import "server-only";
import path from "node:path";
import { LocalDiskStorage, StorageRefused, uploadKeyFromEnv } from "./local";

export { StorageRefused };

/**
 * Upload storage: where uploaded files live (and nowhere else). Files are addressed by a random storage key, never
 * by their original name, under a per-organisation folder. With CLEARLINE_UPLOAD_KEY (32 bytes, base64) set, every
 * file is encrypted with AES-256-GCM; in production a missing key refuses to store anything.
 */
export interface UploadStorage {
  /** Store bytes for an organisation; returns the new random key and whether the file is encrypted at rest. */
  put(orgId: string, bytes: Uint8Array): Promise<{ storageKey: string; encrypted: boolean }>;
  get(orgId: string, storageKey: string): Promise<Uint8Array>;
  /** Remove a file; true when it existed. */
  delete(orgId: string, storageKey: string): Promise<boolean>;
}

export const DEFAULT_UPLOAD_DIR = ".data/uploads";

/** The configured storage, read from the environment on every call (tests change it). Never prints the key. */
export function uploadStorage(): UploadStorage {
  const dir = path.resolve(process.env.CLEARLINE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR);
  const key = uploadKeyFromEnv(process.env.CLEARLINE_UPLOAD_KEY);
  if (!key && process.env.NODE_ENV === "production") {
    return new LocalDiskStorage(dir, null, "Uploads are refused: CLEARLINE_UPLOAD_KEY is not set, and files are never stored unencrypted in production.");
  }
  return new LocalDiskStorage(dir, key);
}
