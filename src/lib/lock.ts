// One writer at a time per store file, and writes that are all-or-nothing. Until the database
// lands, stores are JSON files: a read-modify-write runs inside the file's lock, and a write goes
// to a uniquely named temp file that is then renamed over the old one. The locks live on
// globalThis, so every route bundle in the server process shares them. They don't span processes:
// run one server process per data directory.

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const g = globalThis as { __deskLocks?: Map<string, Promise<unknown>> };
const locks = (g.__deskLocks ??= new Map());

/** Run `job` after every earlier job on the same key has finished, success or not. */
export function withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  const tail = next.then(() => undefined, () => undefined);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return next;
}

export const fileLockKey = (file: string) => `file:${path.resolve(file)}`;

let counter = 0;

/** Write the whole file, or nothing: a unique temp file, then an atomic rename. */
export async function writeAtomic(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${(counter++).toString(36)}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, body);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * `update` is the only safe way to change a store: it loads, applies `fn` and saves, all inside the
 * store's lock, so concurrent changes queue instead of overwriting each other. `fn` returns the
 * data to save (undefined: save nothing) and a result. `save` replaces the whole store (setup, tests).
 */
export interface Store<T> {
  load(): Promise<T>;
  save(data: T): Promise<void>;
  update<R>(fn: (data: T) => Promise<[T | undefined, R]> | [T | undefined, R]): Promise<R>;
}

/** The lock and update logic shared by the memory and file stores. */
export abstract class LockedStore<T> implements Store<T> {
  protected abstract readonly lockKey: string;
  abstract load(): Promise<T>;
  protected abstract write(data: T): Promise<void>;
  /** A store with a revision number reads it here, and sets the next one on the data it saves. */
  protected revOf(_d: T): number | undefined { return undefined; }
  protected withRev(d: T, _rev: number): T { return d; }
  private stamped(next: T, before: number | undefined) {
    return before === undefined && this.revOf(next) === undefined ? next : this.withRev(next, (before ?? this.revOf(next) ?? 0) + 1);
  }
  save(data: T) { return withLock(this.lockKey, async () => this.write(this.stamped(data, this.revOf(await this.load())))); }
  update<R>(fn: (data: T) => Promise<[T | undefined, R]> | [T | undefined, R]): Promise<R> {
    return withLock(this.lockKey, async () => {
      const before = await this.load(); // a fresh copy: fn may change it in place
      const rev = this.revOf(before);
      const [next, result] = await fn(before);
      if (next !== undefined) await this.write(this.stamped(next, rev));
      return result;
    });
  }
}

