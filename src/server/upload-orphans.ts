import "server-only";
import { and, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { ORPHAN_MINUTES, sweepOrphanFiles, type OrphanSweep } from "./uploads";
import { uploadStorage, type UploadStorage } from "./storage";

/**
 * v1 phase 2.1: orphan cleanup in both directions, with a dry run and an audit trail. Runs with the schema OWNER
 * connection across organisations (`control:admin -- sweep-orphans [--dry-run]`), like retention.
 *
 *  1. Stored files that no upload row names (and partial writes): removed once older than the sweep age (rc8 sweep).
 *  2. Live upload rows whose stored file is gone:
 *     - an upload not yet confirmed (stored, mapped, validated, declined) can never be completed without its file:
 *       it is closed as deleted (its validation rows removed), exactly as a person's delete would;
 *     - a confirmed or normalised upload is NEVER changed here (its data is evidence; the database allows its file to
 *       be removed only by retention): it is reported and audited for a person to look at.
 * A dry run changes nothing and reports what would happen. Every affected organisation gets one audit row with ids
 * and counts (never file contents, never names). Rows or files younger than the sweep age are left alone.
 */

export interface MissingFileSweep { checked: number; closed: number; reported: number; tooRecent: number }
export interface OrphanCleanup {
  dryRun: boolean;
  files: OrphanSweep;
  rows: MissingFileSweep;
  /** Per organisation: the ids involved (storage keys, upload ids) — never names or contents. */
  byOrg: Record<string, { orphanFiles: string[]; closedUploads: string[]; confirmedWithoutFile: string[] }>;
}

const OPEN = ["stored", "mapped", "validated", "rejected"] as const;

export async function cleanupOrphans(db: Db, now: Date, opts: { storage?: UploadStorage; olderThanMinutes?: number; dryRun?: boolean } = {}): Promise<OrphanCleanup> {
  const storage = opts.storage ?? uploadStorage({ owner: db });
  const minutes = opts.olderThanMinutes ?? ORPHAN_MINUTES;
  const dryRun = opts.dryRun === true;
  const byOrg: OrphanCleanup["byOrg"] = {};
  const org = (id: string) => (byOrg[id] ??= { orphanFiles: [], closedUploads: [], confirmedWithoutFile: [] });
  if (!storage.list) throw new Error("this upload storage cannot list its files, so orphans cannot be found");
  const listed = await storage.list();

  const files = await sweepOrphanFiles(db, now, { storage, olderThanMinutes: minutes, dryRun, files: listed, onOrphan: (f) => org(f.orgId).orphanFiles.push(f.partial ? `${f.storageKey}.tmp` : f.storageKey) });

  // Direction 2: rows that name a file the listing does not hold. Rows created after the cutoff are skipped (the
  // listing was taken before this read, so a brand-new row's file may simply be newer than the listing).
  const present = new Set(listed.filter((f) => !f.partial).map((f) => `${f.orgId}/${f.storageKey}`));
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const rows = await db.select({ orgId: t.uploads.orgId, id: t.uploads.id, status: t.uploads.status, key: t.uploads.storageKey, createdAt: t.uploads.createdAt })
    .from(t.uploads).where(and(ne(t.uploads.status, "deleted"), isNotNull(t.uploads.storageKey)));
  const missing: MissingFileSweep = { checked: rows.length, closed: 0, reported: 0, tooRecent: 0 };
  for (const u of rows) {
    if (present.has(`${u.orgId}/${u.key}`)) continue;
    if (u.createdAt > cutoff) { missing.tooRecent++; continue; }
    if ((OPEN as readonly string[]).includes(u.status)) {
      org(u.orgId).closedUploads.push(u.id);
      missing.closed++;
      if (dryRun) continue;
      await db.transaction(async (tx) => {
        // re-check under the row lock: still open, still naming the same (missing) file
        const [cur] = await tx.select({ status: t.uploads.status, key: t.uploads.storageKey }).from(t.uploads)
          .where(and(eq(t.uploads.orgId, u.orgId), eq(t.uploads.id, u.id), inArray(t.uploads.status, [...OPEN]), lte(t.uploads.createdAt, cutoff))).for("update");
        if (!cur || cur.key !== u.key) return;
        await tx.delete(t.uploadRows).where(and(eq(t.uploadRows.orgId, u.orgId), eq(t.uploadRows.uploadId, u.id)));
        await tx.update(t.uploads).set({ status: "deleted", storageKey: null, deletedAt: now }).where(and(eq(t.uploads.orgId, u.orgId), eq(t.uploads.id, u.id)));
      });
    } else {
      org(u.orgId).confirmedWithoutFile.push(u.id);
      missing.reported++;
    }
  }

  // a folder named after an organisation that does not exist (any more) has no organisation to audit under
  const known = new Set(Object.keys(byOrg).length ? (await db.select({ id: t.organizations.id }).from(t.organizations).where(inArray(t.organizations.id, Object.keys(byOrg)))).map((o) => o.id) : []);
  for (const [orgId, x] of Object.entries(byOrg)) {
    if (!known.has(orgId)) continue;
    const parts = [`${x.orphanFiles.length} stored file(s) without an upload`, `${x.closedUploads.length} open upload(s) without a file`, `${x.confirmedWithoutFile.length} confirmed upload(s) without a file (kept; review)`];
    await db.insert(t.auditEvents).values({
      orgId, source: "server", action: dryRun ? "upload_orphans_dry_run" : "upload_orphans_cleaned", entityType: "upload_storage", entityId: null, at: now,
      summary: `${dryRun ? "Orphan check (dry run, nothing changed)" : "Orphan cleanup"}: ${parts.join(", ")}`,
      details: { dryRun, olderThanMinutes: minutes, ...x },
    });
  }
  return { dryRun, files, rows: missing, byOrg };
}
