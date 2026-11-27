import "server-only";
import { and, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { uploadStorage, type UploadStorage } from "../storage";
import { purgeExpiredUploads, sweepOrphanFiles } from "../uploads";
import { AUDIT_RETENTION_YEARS, retainUntil } from "./retained";

/**
 * v1 phase 5.6: the retention job (owner connection: `npm run control:admin -- retention [--dry-run]`, or the
 * long-running `npm run jobs:retention`). One pass:
 *  1. uploads past their delete_after (90 days by default, set per merchant by its Admin: merchant_data_settings,
 *     fixed on each upload when it arrives) — the file, its validation rows and the data derived only from it
 *     (purgeExpiredUploads; one audit event per upload), then stored files no upload names (the orphan sweep);
 *  2. audit events older than AUDIT_RETENTION_YEARS ([ASSUMPTION — founder to confirm with a lawyer] 7) — one audit
 *     event per organisation records how many were removed;
 *  3. approvals (request and decision) closed more than 7 years ago, unless a write-off still names the request
 *     (counted as kept);
 *  4. a deleted merchant's minimal retained records past their retain_until, then receipts older than 7 years with
 *     no record left.
 * Idempotent (a second pass removes nothing) and safe when two run at once (each upload is re-checked under a row lock;
 * the other deletes are plain deletes). `dryRun` counts what would go and changes nothing. Every pass — dry runs
 * included, and failures — is recorded in retention_runs with counts only.
 */

export interface RetentionOptions { now: Date; dryRun?: boolean; storage?: UploadStorage; auditYears?: number }
export interface RetentionResult { runId: string; dryRun: boolean; counts: Record<string, number> }

const cutoffOf = (now: Date, years: number) => retainUntil(now, -years);

async function count(db: Db, q: ReturnType<typeof sql>): Promise<number> { return Number((await db.execute(q)).rows[0].n); }

/** Approvals old enough to go: closed before the cut-off, and no write-off names the request. */
const oldApprovals = (cutoff: Date) => sql`select r.org_id, r.id from approval_requests r where r.status <> 'pending' and coalesce(r.closed_at, r.created_at) < ${cutoff}
  and not exists (select 1 from approval_decisions d where d.org_id = r.org_id and d.request_id = r.id and d.created_at >= ${cutoff})`;
const referenced = sql`exists (select 1 from writeoff_proposals w where w.org_id = r.org_id and w.approval_request_id = r.id)`;

async function plan(db: Db, now: Date, cutoff: Date, storage: UploadStorage): Promise<Record<string, number>> {
  const due = await db.select({ id: t.uploads.id, key: t.uploads.storageKey }).from(t.uploads).where(and(ne(t.uploads.status, "deleted"), lte(t.uploads.deleteAfter, now)));
  const orphans = await sweepOrphanFiles(db, now, { storage, dryRun: true });
  return {
    uploads: due.length, files: due.filter((u) => u.key).length,
    orphanFiles: orphans.removed + orphans.partialRemoved,
    auditEvents: await count(db, sql`select count(*)::int as n from audit_events where at < ${cutoff}`),
    approvalRequests: await count(db, sql`select count(*)::int as n from (${oldApprovals(cutoff)}) r where not ${referenced}`),
    approvalsKeptReferenced: await count(db, sql`select count(*)::int as n from (${oldApprovals(cutoff)}) r where ${referenced}`),
    retainedRecords: await count(db, sql`select count(*)::int as n from retained_records where retain_until <= ${now}`),
  };
}

export async function runRetention(db: Db, o: RetentionOptions): Promise<RetentionResult> {
  const startedAt = new Date();
  const now = o.now, dryRun = o.dryRun ?? false;
  const years = o.auditYears ?? AUDIT_RETENTION_YEARS;
  if (!Number.isInteger(years) || years < 1) throw new Error("audit retention is at least one whole year");
  const cutoff = cutoffOf(now, years);
  const storage = o.storage ?? uploadStorage({ owner: db });
  let counts: Record<string, number> = {};
  const record = async (status: "done" | "failed", errorCode: string | null) => {
    const [r] = await db.insert(t.retentionRuns).values({ startedAt, finishedAt: new Date(), asOf: now, dryRun, status, counts, errorCode }).returning({ id: t.retentionRuns.id });
    return r.id;
  };
  try {
    if (dryRun) {
      counts = await plan(db, now, cutoff, storage);
    } else {
      const up = await purgeExpiredUploads(db, now, { storage });
      const orphans = await sweepOrphanFiles(db, now, { storage });
      counts = { uploads: up.uploads ?? 0, files: up.files ?? 0, validationRows: up.rows ?? 0, orphanFiles: orphans.removed + orphans.partialRemoved };
      Object.assign(counts, await purgeOld(db, now, cutoff, years));
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    await record("failed", typeof code === "string" && /^[A-Z0-9_]{2,64}$/.test(code) ? code : "RETENTION_FAILED");
    throw e;
  }
  return { runId: await record("done", null), dryRun, counts };
}

/** Steps 2–4, in one short transaction (append-only triggers are disabled inside it only, and on again before commit). */
async function purgeOld(db: Db, now: Date, cutoff: Date, years: number): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
    const out = { auditEvents: 0, approvalRequests: 0, approvalDecisions: 0, approvalsKeptReferenced: 0, retainedRecords: 0, deletionReceipts: 0 };
    // audit events: count per organisation first, so each organisation's log records its own purge
    const perOrg = (await tx.execute(sql`select org_id, count(*)::int as n from audit_events where at < ${cutoff} group by org_id`)).rows.map((r) => ({ org: String(r.org_id), n: Number(r.n) }));
    const old = (await tx.execute(sql`select r.org_id, r.id, ${referenced} as kept from (${oldApprovals(cutoff)}) r`)).rows.map((r) => ({ org: String(r.org_id), id: String(r.id), kept: Boolean(r.kept) }));
    const gone = old.filter((r) => !r.kept);
    out.approvalsKeptReferenced = old.length - gone.length;
    if (perOrg.length || gone.length) {
      for (const tb of ["audit_events", "approval_requests", "approval_decisions"]) await tx.execute(sql`alter table ${sql.identifier(tb)} disable trigger user`);
      if (perOrg.length) out.auditEvents = (await tx.execute(sql`delete from audit_events where at < ${cutoff}`)).rowCount ?? 0;
      for (let i = 0; i < gone.length; i += 500) {
        const keys = sql.join(gone.slice(i, i + 500).map((r) => sql`(${r.org}::uuid, ${r.id}::uuid)`), sql`, `);
        out.approvalDecisions += (await tx.execute(sql`delete from approval_decisions where (org_id, request_id) in (${keys})`)).rowCount ?? 0;
        out.approvalRequests += (await tx.execute(sql`delete from approval_requests where (org_id, id) in (${keys})`)).rowCount ?? 0;
      }
      for (const tb of ["audit_events", "approval_requests", "approval_decisions"]) await tx.execute(sql`alter table ${sql.identifier(tb)} enable trigger user`);
      const approvalsBy = new Map<string, number>();
      for (const r of gone) approvalsBy.set(r.org, (approvalsBy.get(r.org) ?? 0) + 1);
      for (const org of new Set([...perOrg.map((p) => p.org), ...approvalsBy.keys()])) {
        const auditEvents = perOrg.find((p) => p.org === org)?.n ?? 0, approvals = approvalsBy.get(org) ?? 0;
        await tx.insert(t.auditEvents).values({ orgId: org, source: "server", action: "retention_purged", entityType: "organization", entityId: org, at: now,
          summary: `Retention: ${auditEvents} audit event(s) and ${approvals} approval(s) older than ${years} years deleted`, details: { auditEvents, approvals, years } });
      }
    }
    // a deleted merchant's minimal records past their retention period (the table's trigger refuses any younger one)
    out.retainedRecords = (await tx.delete(t.retainedRecords).where(lte(t.retainedRecords.retainUntil, now)).returning({ k: t.retainedRecords.kind })).length;
    out.deletionReceipts = (await tx.execute(sql`delete from merchant_deletions d where d.deleted_at < ${cutoff}
      and not exists (select 1 from retained_records r where r.deletion_id = d.id)`)).rowCount ?? 0;
    return out;
  });
}
