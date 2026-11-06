import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import { fileLockKey, LockedStore, withLock, writeAtomic } from "../lock";
import { emptyFunding, type FundingData } from "./model";
import { applyFundingEvent, type FundingEvent } from "./review";
import { importCsv } from "./imports";
export function validateFundingData(value: unknown): FundingData {
  let data = value as FundingData;
  if (
    data &&
    !Object.hasOwn(data, "events") &&
    Array.isArray(data.users) &&
    !data.users.length &&
    Array.isArray(data.decisions) &&
    !data.decisions.length &&
    Array.isArray(data.advances) &&
    data.advances.every((a) => a.state === "proposed")
  )
    data = { ...data, events: [] };
  if (
    !data ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !Array.isArray(data.imports)
  )
    throw Error("Invalid funding store.");
  if (!Array.isArray(data.events)) throw Error("Invalid workflow history.");
  let rebuilt = emptyFunding();
  let imported = 0;
  for (const event of data.events) {
    if (
      !Number.isSafeInteger(event.import_count) ||
      event.import_count < imported ||
      event.import_count > data.imports.length ||
      !Number.isSafeInteger(event.base_revision) ||
      event.base_revision < rebuilt.revision
    )
      throw Error("Invalid event position.");
    while (imported < event.import_count) {
      const b = data.imports[imported++];
      rebuilt = importCsv(
        rebuilt,
        b.kind,
        b.text,
        b.mapping,
        b.filename,
        b.imported_at,
      );
    }
    rebuilt.revision = event.base_revision;
    const { id: _id, review: _review, ...input } = event;
    rebuilt = applyFundingEvent(rebuilt, input);
  }
  while (imported < data.imports.length) {
    const b = data.imports[imported++];
    rebuilt = importCsv(
      rebuilt,
      b.kind,
      b.text,
      b.mapping,
      b.filename,
      b.imported_at,
    );
  }
  if (data.revision < rebuilt.revision) throw Error("Invalid stored revision.");
  rebuilt.revision = data.revision;
  if (!isDeepStrictEqual(rebuilt, data))
    throw Error("Funding records do not match their retained inputs.");
  return data;
}
export class FundingStore extends LockedStore<FundingData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) {
    super();
    this.lockKey = fileLockKey(file);
  }
  override update<R>(
    fn: (
      data: FundingData,
    ) => Promise<[FundingData | undefined, R]> | [FundingData | undefined, R],
  ): Promise<R> {
    return withLock(`funding-lease:${this.lockKey}`, async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const lease = `${this.file}.writer`;
      try {
        await mkdir(lease);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          throw Error(
            "Another writer or an interrupted write holds this store. Stop other processes and inspect the writer lock before retrying.",
          );
        throw e;
      }
      try {
        return await super.update(async (before) => {
          const imports = structuredClone(before.imports),
            events = structuredClone(before.events);
          const [next, result] = await fn(before);
          if (
            next &&
            (!isDeepStrictEqual(
              next.imports.slice(0, imports.length),
              imports,
            ) ||
              next.imports.length < imports.length ||
              !isDeepStrictEqual(next.events.slice(0, events.length), events) ||
              next.events.length < events.length)
          )
            throw Error("Input and workflow histories are append-only.");
          return [next, result];
        });
      } finally {
        await rm(lease, { recursive: true });
      }
    });
  }
  override async save(_data: FundingData): Promise<void> {
    throw Error(
      "Use update to preserve the current revision and input history.",
    );
  }
  act(
    input: Omit<
      FundingEvent,
      "id" | "review" | "import_count" | "base_revision"
    >,
    expectedRevision: number,
  ) {
    return this.update((data) => {
      if (data.revision !== expectedRevision)
        throw Error("Records changed. Reload the advance before deciding.");
      const next = applyFundingEvent(data, {
        ...input,
        import_count: data.imports.length,
        base_revision: data.revision,
      });
      return [next, next.events[next.events.length - 1]];
    });
  }
  protected revOf(data: FundingData) {
    return data.revision;
  }
  protected withRev(data: FundingData, revision: number) {
    return { ...data, revision };
  }
  async load(): Promise<FundingData> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyFunding();
      throw e;
    }
    try {
      return validateFundingData(JSON.parse(raw));
    } catch {
      throw Error(
        "Funding records cannot be read. Restore a verified backup; no data was reset.",
      );
    }
  }
  protected write(data: FundingData) {
    return writeAtomic(this.file, JSON.stringify(validateFundingData(data)));
  }
}
