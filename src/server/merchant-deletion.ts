import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { uploadStorage, type UploadStorage } from "./storage";

/**
 * rc7 phase 3b: delete ONE merchant organisation and everything it holds (an owner-only command:
 * `npm run control:admin -- delete-merchant <org-slug> --confirm <org-slug>`). Runs with the schema OWNER connection,
 * in one transaction:
 *  - every row of every table that has an org_id or merchant_org_id column equal to the merchant (the tables are read
 *    from information_schema, so a table added later is included without a code change), in an order the foreign
 *    keys accept (each delete is retried until none is left);
 *  - the organisation row; and the users who were members of this merchant only (with their sessions and accounts);
 *  - append-only and immutability triggers are disabled for the delete inside this transaction only (the owner
 *    owns the tables; the runtime role cannot do this) and enabled again before it commits;
 *  - then every uploaded file of the merchant is removed from upload storage.
 * Provider organisations are refused. Output: counts per table and a hash of the
 * organisation id, never names or contents.
 */

export class DeletionRefused extends Error {}

export interface DeletionPlan { orgId: string; slug: string; tables: Record<string, number>; users: number; files: number }

const ident = (s: string) => sql.identifier(s);
const ORG_COLUMNS = ["org_id", "merchant_org_id"] as const;

/**
 * Tables (and columns) that can hold a merchant's rows. A partition is reached through its partitioned table (v1:
 * chain_reads by month), so partitions are left out: counted and deleted once, through the parent.
 */
export async function orgScopedTables(db: Db): Promise<{ table: string; column: string }[]> {
  const r = await db.execute(sql`select c.table_name as t, c.column_name as c from information_schema.columns c join information_schema.tables x
    on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('org_id', 'merchant_org_id')
      and not (select k.relispartition from pg_class k where k.oid = format('%I.%I', c.table_schema, c.table_name)::regclass)
    order by c.table_name, c.column_name`);
  return r.rows.map((x) => ({ table: String(x.t), column: String(x.c) })).filter((x) => (ORG_COLUMNS as readonly string[]).includes(x.column));
}

async function merchantOf(db: Db, slug: string) {
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, slug));
  if (!org) throw new DeletionRefused("No organisation has that slug.");
  if (org.kind !== "merchant") throw new DeletionRefused("Only a merchant organisation can be deleted with this command.");
  const [served] = await db.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.providerOrgId, org.id)).limit(1);
  if (served) throw new DeletionRefused("Other organisations depend on this one; it is not deleted.");
  return org;
}

/** Members of this organisation who belong to no other organisation (their user records go with it). */
async function onlyHere(db: Db, orgId: string): Promise<string[]> {
  const r = await db.execute(sql`select m.user_id as id from organization_memberships m where m.org_id = ${orgId}
    and not exists (select 1 from organization_memberships o where o.user_id = m.user_id and o.org_id <> ${orgId})`);
  return [...new Set(r.rows.map((x) => String(x.id)))];
}

/** What a deletion would remove (row counts per table, users, files). Changes nothing. */
export async function planMerchantDeletion(db: Db, slug: string): Promise<DeletionPlan> {
  const org = await merchantOf(db, slug);
  const tables: Record<string, number> = {};
  for (const x of await orgScopedTables(db)) {
    const n = Number((await db.execute(sql`select count(*)::int as n from ${ident(x.table)} where ${ident(x.column)} = ${org.id}`)).rows[0].n);
    if (n) tables[x.table] = (tables[x.table] ?? 0) + n;
  }
  const files = (await db.select({ k: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, org.id), isNotNull(t.uploads.storageKey)))).length;
  return { orgId: org.id, slug, tables: { ...tables, organizations: 1 }, users: (await onlyHere(db, org.id)).length, files };
}

export interface DeletionResult { orgIdSha256: string; tables: Record<string, number>; users: number; files: number }

/**
 * Delete the merchant. `confirm` must repeat the slug exactly. Storage is cleaned after the database commit (a file
 * without its row is unreachable; a row without its file never exists).
 */
export async function deleteMerchant(db: Db, slug: string, confirm: string, opts: { storage?: UploadStorage } = {}): Promise<DeletionResult> {
  if (confirm !== slug) throw new DeletionRefused("Confirmation does not match: repeat the organisation's slug exactly to delete it.");
  const org = await merchantOf(db, slug);
  const storage = opts.storage ?? uploadStorage();
  const keys = (await db.select({ k: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, org.id), isNotNull(t.uploads.storageKey)))).map((x) => x.k!);
  const scoped = await orgScopedTables(db);
  const tables: Record<string, number> = {};
  let users = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delete-merchant|${org.id}`}))`);
    const names = [...new Set(scoped.map((x) => x.table)), "organizations", "users", "sessions", "accounts"];
    for (const n of names) await tx.execute(sql`alter table ${ident(n)} disable trigger user`);
    const userIds = await onlyHere(tx as unknown as Db, org.id);
    // Delete child rows before parents: retry each table until it is empty or no table makes progress.
    let pending = [...scoped];
    for (let round = 0; pending.length && round < 50; round++) {
      const next: typeof pending = [];
      for (const x of pending) {
        try {
          const r = await tx.transaction(async (sp) => sp.execute(sql`delete from ${ident(x.table)} where ${ident(x.column)} = ${org.id}`));
          if (r.rowCount) tables[x.table] = (tables[x.table] ?? 0) + r.rowCount;
        } catch (e) {
          if ((e as { cause?: { code?: string }; code?: string }).cause?.code !== "23503" && (e as { code?: string }).code !== "23503") throw e;
          next.push(x);
        }
      }
      if (next.length === pending.length) throw new Error(`deletion blocked by foreign keys on ${next.map((x) => x.table).join(", ")}`);
      pending = next;
    }
    await tx.delete(t.organizations).where(eq(t.organizations.id, org.id));
    tables.organizations = 1;
    if (userIds.length) {
      const ss = await tx.delete(t.sessions).where(inArray(t.sessions.userId, userIds)).returning({ id: t.sessions.id });
      const as = await tx.delete(t.accounts).where(inArray(t.accounts.userId, userIds)).returning({ id: t.accounts.id });
      if (ss.length) tables.sessions = ss.length;
      if (as.length) tables.accounts = as.length;
      users = (await tx.delete(t.users).where(inArray(t.users.id, userIds)).returning({ id: t.users.id })).length;
    }
    for (const n of names) await tx.execute(sql`alter table ${ident(n)} enable trigger user`);
  });
  let files = 0;
  for (const k of keys) if (await storage.delete(org.id, k)) files++;
  files += (await storage.deleteOrganisation?.(org.id)) ?? 0;
  return { orgIdSha256: createHash("sha256").update(org.id).digest("hex"), tables, users, files };
}
