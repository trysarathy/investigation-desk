// Where raw chain responses and the response cache live. In v1 (no database yet) that is a
// git-ignored directory on disk; Postgres replaces it in week 5. Tests use the in-memory store.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawResponse } from "../types";

export interface ResponseStore {
  /** Keep every raw response, keyed by its body hash, for the audit record. */
  saveRaw(raw: RawResponse): Promise<void>;
  getCached(key: string, now: Date): Promise<RawResponse | undefined>;
  /** ttlSec = Infinity for immutable data (confirmed transactions, token metadata). */
  putCached(key: string, raw: RawResponse, ttlSec: number, now: Date): Promise<void>;
}

interface CacheEntry { expiresAt: number | null; raw: RawResponse }

const expiry = (ttlSec: number, now: Date) => (Number.isFinite(ttlSec) ? now.getTime() + ttlSec * 1000 : null);
const live = (e: CacheEntry | undefined, now: Date) => !!e && (e.expiresAt === null || e.expiresAt > now.getTime());

export class MemoryStore implements ResponseStore {
  readonly raw: RawResponse[] = [];
  private readonly cache = new Map<string, CacheEntry>();

  async saveRaw(raw: RawResponse) { this.raw.push(raw); }
  async getCached(key: string, now: Date) {
    const e = this.cache.get(key);
    return live(e, now) ? e!.raw : undefined;
  }
  async putCached(key: string, raw: RawResponse, ttlSec: number, now: Date) {
    this.cache.set(key, { expiresAt: expiry(ttlSec, now), raw });
  }
}

export class FileStore implements ResponseStore {
  constructor(private readonly dir: string) {}

  async saveRaw(raw: RawResponse) {
    const d = path.join(this.dir, "raw");
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, `${raw.sha256}.json`), JSON.stringify(raw));
  }

  async getCached(key: string, now: Date) {
    try {
      const e = JSON.parse(await readFile(path.join(this.dir, "cache", `${key}.json`), "utf8")) as CacheEntry;
      return live(e, now) ? e.raw : undefined;
    } catch {
      return undefined;
    }
  }

  async putCached(key: string, raw: RawResponse, ttlSec: number, now: Date) {
    const d = path.join(this.dir, "cache");
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, `${key}.json`), JSON.stringify({ expiresAt: expiry(ttlSec, now), raw }));
  }
}
