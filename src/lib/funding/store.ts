import {
  applyFundingEvent as applyLegacyEvent,
  type FundingEvent as LegacyEvent,
} from "./review-v2";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { fileLockKey, withLock } from "../lock";
import { emptyFunding, type FundingData } from "./model";
import { applyFundingEvent, type FundingEvent } from "./review";
import { importCsv } from "./imports";
import {
  readPrivateFile,
  writePrivateAtomic,
  assertPrivateDirectory,
} from "./private";
import {
  appendAudit,
  verifyAudit,
  type AuditEntry,
  type AuditInput,
  type AuditAnchor,
  type AuditActor,
} from "./audit";
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
    const input = { ...event };
    delete (input as Partial<FundingEvent>).id;
    delete (input as Partial<FundingEvent>).review;
    rebuilt =
      event.engine_version === undefined
        ? applyLegacyEvent(rebuilt, input as Omit<LegacyEvent, "id" | "review">)
        : applyFundingEvent(rebuilt, input);
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

export interface FundingEnvelope {
  format: "clearline-funding/v2";
  data: FundingData;
  audit: AuditEntry[];
}
const localActor: AuditActor = { kind: "local_admin", id: "local-process" };
export class FundingStore {
  private readonly lockKey: string;
  constructor(private readonly file: string) {
    this.lockKey = fileLockKey(file);
  }
  private async locked<R>(job: () => Promise<R>) {
    return withLock(`funding-lease:${this.lockKey}`, async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(path.dirname(this.file));
      const lease = `${this.file}.writer`;
      try {
        await mkdir(lease, { mode: 0o700 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          throw Error(
            "Another writer or an interrupted write holds this store. Stop other processes and inspect the writer lock before retrying.",
          );
        throw e;
      }
      try {
        return await job();
      } finally {
        await rm(lease, { recursive: true });
      }
    });
  }
  private async readEnvelope(): Promise<FundingEnvelope> {
    try {
      const value = JSON.parse(await readPrivateFile(this.file));
      if (value?.format === "clearline-funding/v2") {
        if (Object.keys(value).sort().join(",") !== "audit,data,format")
          throw Error("Unexpected envelope fields.");
        const data = validateFundingData(value.data);
        verifyAudit(value.audit, data);
        return { format: "clearline-funding/v2", data, audit: value.audit };
      }
      const data = validateFundingData(value);
      return {
        format: "clearline-funding/v2",
        data,
        audit: appendAudit(
          [],
          {
            actor: localActor,
            action: "legacy_migration",
            details: {
              legacy_revision: data.revision,
              note: "Existing source records validated; prior actions were not retrospectively authenticated.",
            },
          },
          data,
        ),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        const data = emptyFunding();
        return {
          format: "clearline-funding/v2",
          data,
          audit: appendAudit(
            [],
            { actor: localActor, action: "store_created", details: {} },
            data,
          ),
        };
      }
      throw Error(
        "Funding records or audit cannot be read. Restore a verified backup; no data was reset.",
        { cause: e },
      );
    }
  }
  async load() {
    return (await this.readEnvelope()).data;
  }
  async inspectAudit(anchor?: AuditAnchor) {
    return this.locked(async () => {
      const envelope = await this.readEnvelope();
      const current = verifyAudit(envelope.audit, envelope.data, anchor);
      await writePrivateAtomic(this.file, JSON.stringify(envelope));
      return { entries: envelope.audit, anchor: current, data: envelope.data };
    });
  }
  async save(data: FundingData): Promise<void> {
    void data;
    throw Error(
      "Use update to preserve the current revision and input history.",
    );
  }
  async update<R>(
    fn: (
      data: FundingData,
    ) => Promise<[FundingData | undefined, R]> | [FundingData | undefined, R],
    context: AuditInput = {
      actor: localActor,
      action: "local_update",
      details: {},
    },
  ): Promise<R> {
    return this.locked(async () => {
      const envelope = await this.readEnvelope(),
        before = structuredClone(envelope.data),
        [next, result] = await fn(envelope.data);
      if (next !== undefined) {
        if (
          !isDeepStrictEqual(
            next.imports.slice(0, before.imports.length),
            before.imports,
          ) ||
          next.imports.length < before.imports.length ||
          !isDeepStrictEqual(
            next.events.slice(0, before.events.length),
            before.events,
          ) ||
          next.events.length < before.events.length
        )
          throw Error("Input and workflow histories are append-only.");
        const data = validateFundingData({
          ...next,
          revision: before.revision + 1,
        });
        const details = {
          ...context.details,
          from_revision: before.revision,
          to_revision: data.revision,
          imports: data.imports.slice(before.imports.length).map((b) => ({
            id: b.id,
            kind: b.kind,
            sha256: b.sha256,
            accepted: b.accepted,
            duplicates: b.duplicates,
          })),
          events: data.events.slice(before.events.length).map((e) => ({
            id: e.id,
            action: e.action,
            actor_id: e.actor_id,
            at: e.at,
            review: e.review,
          })),
        };
        const audit = appendAudit(
          envelope.audit,
          { ...context, details },
          data,
        );
        verifyAudit(audit, data);
        await writePrivateAtomic(
          this.file,
          JSON.stringify({ format: "clearline-funding/v2", data, audit }),
        );
      }
      return result;
    });
  }
  // Keep the displayed snapshot and its audit entry under the same writer lease.
  // A concurrent preparation must never turn a legitimate refresh into a 500.
  async observe<R>(
    fn: (
      data: FundingData,
    ) =>
      | { result: R; audit: AuditInput }
      | Promise<{ result: R; audit: AuditInput }>,
  ): Promise<R> {
    return this.locked(async () => {
      const envelope = await this.readEnvelope();
      const before = structuredClone(envelope.data);
      const { result, audit } = await fn(envelope.data);
      if (!isDeepStrictEqual(before, envelope.data))
        throw Error("A review cannot modify funding records.");
      envelope.audit = appendAudit(envelope.audit, audit, envelope.data);
      verifyAudit(envelope.audit, envelope.data);
      await writePrivateAtomic(this.file, JSON.stringify(envelope));
      return result;
    });
  }
  async recordAudit(input: AuditInput, expectedRevision?: number) {
    return this.locked(async () => {
      const envelope = await this.readEnvelope();
      if (
        expectedRevision !== undefined &&
        envelope.data.revision !== expectedRevision
      )
        throw Error("Records changed. Reload before generating this output.");
      envelope.audit = appendAudit(envelope.audit, input, envelope.data);
      verifyAudit(envelope.audit, envelope.data);
      await writePrivateAtomic(this.file, JSON.stringify(envelope));
      return envelope.audit.at(-1)!;
    });
  }
  act(
    input: Omit<
      FundingEvent,
      "id" | "review" | "import_count" | "base_revision"
    >,
    expectedRevision: number,
    actor: AuditActor = localActor,
  ) {
    return this.update(
      (data) => {
        if (data.revision !== expectedRevision)
          throw Error("Records changed. Reload the advance before deciding.");
        const next = applyFundingEvent(data, {
          ...input,
          import_count: data.imports.length,
          base_revision: data.revision,
        });
        return [next, next.events[next.events.length - 1]];
      },
      {
        actor,
        action: "decision_recorded",
        details: {
          requested_action: input.action,
          advance_id: input.advance_id,
        },
      },
    );
  }
}
