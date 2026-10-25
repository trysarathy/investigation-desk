// Payment requests live in one JSON file, written whole and atomically inside its lock (like the
// payments store). A memory store backs the tests.

import { readFile } from "node:fs/promises";
import { fileLockKey, LockedStore, writeAtomic } from "../lock";
import { emptyRequests, type RequestsData } from "./types";

export class FileRequestsStore extends LockedStore<RequestsData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  protected revOf(d: RequestsData) { return d.rev ?? 0; }
  protected withRev(d: RequestsData, rev: number) { return { ...d, rev }; }
  async load(): Promise<RequestsData> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      // Only a file that doesn't exist yet is an empty store. Any other read error must stop the
      // write that follows, or it would replace every request with an empty store.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyRequests();
      throw e;
    }
    // A corrupt file throws here too, for the same reason.
    return { ...emptyRequests(), ...(JSON.parse(text) as Partial<RequestsData>) } as RequestsData;
  }
  protected async write(d: RequestsData) { await writeAtomic(this.file, JSON.stringify(d)); }
}

export class MemoryRequestsStore extends LockedStore<RequestsData> {
  protected readonly lockKey = `memory:requests:${Math.random()}`;
  private json = JSON.stringify(emptyRequests());
  protected revOf(d: RequestsData) { return d.rev ?? 0; }
  protected withRev(d: RequestsData, rev: number) { return { ...d, rev }; }
  async load() { return JSON.parse(this.json) as RequestsData; }
  protected async write(d: RequestsData) { this.json = JSON.stringify(d); }
}
