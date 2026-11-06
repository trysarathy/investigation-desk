import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { fileLockKey, LockedStore, withLock, writeAtomic } from '../lock';
import { emptyFunding, type FundingData } from './model';
import { importCsv } from './imports';
export function validateFundingData(value: unknown): FundingData {
  const data = value as FundingData;
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.imports)) throw Error('Invalid funding store.');
  // M1 only accepts imported facts. Future state transitions need their own validated event history.
  let rebuilt = emptyFunding();
  for (const batch of data.imports) rebuilt = importCsv(rebuilt, batch.kind, batch.text, batch.mapping, batch.filename, batch.imported_at);
  rebuilt.revision = data.revision;
  if (!isDeepStrictEqual(rebuilt, data)) throw Error('Funding records do not match their retained inputs.');
  return data;
}
export class FundingStore extends LockedStore<FundingData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  override update<R>(fn: (data: FundingData) => Promise<[FundingData | undefined, R]> | [FundingData | undefined, R]): Promise<R> {
    return withLock(`funding-lease:${this.lockKey}`, async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const lease = `${this.file}.writer`;
      try { await mkdir(lease); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Another writer or an interrupted write holds this store. Stop other processes and inspect the writer lock before retrying.');
        throw e;
      }
      try { return await super.update(fn); }
      finally { await rm(lease, { recursive: true }); }
    });
  }
  override async save(_data: FundingData): Promise<void> { throw Error('Use update to preserve the current revision and input history.'); }
  protected revOf(data: FundingData) { return data.revision; }
  protected withRev(data: FundingData, revision: number) { return { ...data, revision }; }
  async load(): Promise<FundingData> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyFunding(); throw e; }
    try {
      return validateFundingData(JSON.parse(raw));
    } catch { throw Error('Funding records cannot be read. Restore a verified backup; no data was reset.'); }
  }
  protected write(data: FundingData) { return writeAtomic(this.file, JSON.stringify(validateFundingData(data))); }
}
