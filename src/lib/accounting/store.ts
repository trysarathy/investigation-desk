// Accounting data lives in one JSON file next to the requests, written whole and atomically inside
// its lock (like every other store). A memory store backs the tests.

import { readFile } from "node:fs/promises";
import { fileLockKey, LockedStore, writeAtomic } from "../lock";
import { emptyAccounting, type AccountingData } from "./types";

export class FileAccountingStore extends LockedStore<AccountingData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  protected revOf(d: AccountingData) { return d.rev ?? 0; }
  protected withRev(d: AccountingData, rev: number) { return { ...d, rev }; }
  async load(): Promise<AccountingData> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyAccounting();
      throw e;
    }
    return { ...emptyAccounting(), ...(JSON.parse(text) as Partial<AccountingData>) } as AccountingData;
  }
  protected async write(d: AccountingData) { await writeAtomic(this.file, JSON.stringify(d)); }
}

export class MemoryAccountingStore extends LockedStore<AccountingData> {
  protected readonly lockKey = `memory:accounting:${Math.random()}`;
  private json = JSON.stringify(emptyAccounting());
  protected revOf(d: AccountingData) { return d.rev ?? 0; }
  protected withRev(d: AccountingData, rev: number) { return { ...d, rev }; }
  async load() { return JSON.parse(this.json) as AccountingData; }
  protected async write(d: AccountingData) { this.json = JSON.stringify(d); }
}
