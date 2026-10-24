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
    try {
      return { ...emptyRequests(), ...(JSON.parse(await readFile(this.file, "utf8")) as Partial<RequestsData>) } as RequestsData;
    } catch {
      return emptyRequests();
    }
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
