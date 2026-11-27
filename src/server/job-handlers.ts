import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { FILE_TYPES, type FileType } from "@/lib/clearline/mapping";
import type { Db } from "./db/client";
import { periodEndRevaluation } from "./fx-revaluation";
import { principalOf, reconcileHandler, type Conn, type JobHandler } from "./jobs";
import { createUpload, purgeExpiredUploads } from "./uploads";

/**
 * v1 phase 3: the worker's handlers besides reconciliation. Each acts as the job's member (principalOf: the member's
 * access is checked again for every job) through the same services the web app uses, so every permission, entity
 * scope, idempotency key and audit applies unchanged. Nothing here holds, sends or converts money.
 */

/** Period-end revaluation PROPOSALS (read-only, fx-revaluation.ts) from the parameters given at enqueue. */
export function revaluationHandler(queue: Conn): JobHandler {
  return async (job, run) => {
    const ctx = await principalOf(queue, job);
    if (ctx === "schedule_changed") return { runId: null, status: "cancelled", code: "SCHEDULE_CHANGED" };
    await run.stage("revaluation");
    const result = await periodEndRevaluation(ctx, { ...(job.params as object), entityId: job.entityId });
    const proposals = Array.isArray((result as { proposals?: unknown[] }).proposals) ? (result as { proposals: unknown[] }).proposals.length : 0;
    return { runId: null, status: "done", result, counts: { proposals } };
  };
}

/**
 * Where picked-up files come from. Pluggable: the stand-in is a local folder (no paid or network service); an SFTP or
 * bucket source would implement the same two calls.
 */
export interface PickupFile { name: string; fileType: FileType; bankAccountId?: string; bytes: Uint8Array; ref: string }
export interface PickupSource {
  /** Files waiting for this organisation's entity. */
  list(orgSlug: string, entityId: string): Promise<PickupFile[]>;
  /** The file became an upload: never offer it again. */
  done(file: PickupFile): Promise<void>;
}

const SAFE = /^[A-Za-z0-9._-]{1,128}$/;
/**
 * The local stand-in: `<dir>/<org slug>/<entity id>/<file type>/<file>` (a bank statement under
 * `bank_statement/<bank account id>/<file>`). A picked file moves to a `done` folder beside it.
 */
export class FolderPickup implements PickupSource {
  constructor(private readonly dir: string) {}
  async list(orgSlug: string, entityId: string): Promise<PickupFile[]> {
    if (!SAFE.test(orgSlug) || !SAFE.test(entityId)) return [];
    const base = path.join(this.dir, orgSlug, entityId);
    const out: PickupFile[] = [];
    const files = async (folder: string) => (await readdir(folder).catch(() => [] as string[])).filter((f) => SAFE.test(f) && f !== "done").sort();
    for (const fileType of FILE_TYPES) {
      const folders = fileType === "bank_statement" ? (await files(path.join(base, fileType))).map((acct) => ({ dir: path.join(base, fileType, acct), acct })) : [{ dir: path.join(base, fileType), acct: undefined }];
      for (const f of folders) {
        for (const name of await files(f.dir)) {
          const p = path.join(f.dir, name);
          if (!(await stat(p)).isFile()) continue;
          out.push({ name, fileType, ...(f.acct ? { bankAccountId: f.acct } : {}), bytes: new Uint8Array(await readFile(p)), ref: p });
        }
      }
    }
    return out;
  }
  async done(file: PickupFile) {
    const done = path.join(path.dirname(file.ref), "done");
    await mkdir(done, { recursive: true });
    await rename(file.ref, path.join(done, path.basename(file.ref)));
  }
}

/**
 * Pick up the entity's waiting files as uploads (stored, waiting for a person to map, validate and confirm exactly as
 * a browser upload; nothing is normalised or reconciled here). The idempotency key is the job and the file's hash, so
 * a retried job never uploads a file twice.
 */
export function pickupHandler(queue: Conn, source: PickupSource): JobHandler {
  return async (job, run) => {
    const ctx = await principalOf(queue, job);
    if (ctx === "schedule_changed") return { runId: null, status: "cancelled", code: "SCHEDULE_CHANGED" };
    await run.stage("pickup");
    let uploads = 0;
    for (const f of await source.list(ctx.orgSlug, job.entityId!)) {
      const sha = createHash("sha256").update(f.bytes).digest("hex").slice(0, 32);
      await createUpload(ctx, { entityId: job.entityId!, fileType: f.fileType, fileName: f.name, bytes: f.bytes, ...(f.bankAccountId ? { bankAccountId: f.bankAccountId } : {}) }, `pickup-${job.id}-${sha}`);
      await source.done(f);
      uploads++;
    }
    return { runId: null, status: "done", counts: { uploads } };
  };
}

/**
 * Retention for one organisation (founder decision 6: uploads past their date, with what was derived only from them).
 * It needs the schema owner's rights (two tables refuse deletes to everyone else), so it runs only on a worker started
 * with the retention login (DATABASE_RETENTION_URL), used for this handler only; the queue stays on the jobs login.
 */
export function retentionHandler(retention: Db, now: () => Date = () => new Date()): JobHandler {
  return async (job, run) => {
    await run.stage("retention");
    const counts = await purgeExpiredUploads(retention, now(), { orgId: job.orgId });
    return { runId: null, status: "done", counts };
  };
}

/** Every handler the worker runs (retention only with the retention login; pickup only with a pickup source). */
export function workerHandlers(queue: Conn, o: { retention?: Db; pickup?: PickupSource; now?: () => Date } = {}): Partial<Record<"reconcile" | "revaluation" | "pickup" | "retention", JobHandler>> {
  return {
    reconcile: reconcileHandler(queue), revaluation: revaluationHandler(queue),
    ...(o.pickup ? { pickup: pickupHandler(queue, o.pickup) } : {}), ...(o.retention ? { retention: retentionHandler(o.retention, o.now) } : {}),
  };
}
