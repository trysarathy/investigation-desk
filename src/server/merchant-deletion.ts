import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import { uploadStorage, type UploadStorage } from "./storage";
import { LIMITS, keyHash, type Scope } from "./rate-limit";
import { minimiseApprovalDecision, minimiseApprovalRequest, minimiseAudit, orgRef, retainUntil, type AuditRow } from "./privacy/retained";
import type { RetainedKind } from "./db/privacy-schema";

/**
 * rc7 phase 3b, v1 phase 5.6: delete ONE merchant organisation and everything it holds (an owner-only command:
 * `npm run control:admin -- delete-merchant <org-slug> --confirm <org-slug>`). Runs with the schema OWNER connection,
 * in one transaction:
 *  - every row of every table that has an org_id or merchant_org_id column equal to the merchant (the tables are read
 *    from information_schema, so a table added later is included without a code change), in an order the foreign
 *    keys accept (each delete is retried until none is left);
 *  - the organisation row; and the users who were members of this merchant only (never a platform operator) with
 *    everything held about them as people: sessions, accounts, authenticators, passkeys, e-mail tokens, verification
 *    rows, sign-in failure and rate-limit counters, and the local e-mail outbox rows addressed to them or naming the
 *    merchant;
 *  - v1 5.6: the merchant's audit events and approvals (and any other organisation's audit event that names the
 *    merchant or a deleted member) are NOT kept as they were: they are kept for the retention period only in the
 *    minimal form of src/server/privacy/retained.ts (no names, e-mails, free text, references or ids), under a
 *    receipt (merchant_deletions) that holds counts and a digest of the organisation id;
 *  - append-only and immutability triggers are disabled for the delete inside this transaction only (the owner
 *    owns the tables; the runtime role cannot do this) and enabled again before it commits;
 *  - then every uploaded file of the merchant is removed from upload storage, and every table and the storage are
 *    scanned for any trace left (`residue`: table names and counts, never contents).
 * Provider organisations are refused. Output: counts per table and a hash of the organisation id, never names or
 * contents.
 */

export class DeletionRefused extends Error {}

export interface DeletionPlan { orgId: string; slug: string; tables: Record<string, number>; users: number; files: number; retained: number }

const ident = (s: string) => sql.identifier(s);
const ORG_COLUMNS = ["org_id", "merchant_org_id"] as const;

/**
 * Tables (and columns) that can hold a merchant's rows. A partition is reached through its partitioned table (v1:
 * chain_reads by month), so partitions are left out: counted and deleted once, through the parent.
 */
export async function orgScopedTables(db: Db | Tx): Promise<{ table: string; column: string }[]> {
  const r = await db.execute(sql`select c.table_name as t, c.column_name as c from information_schema.columns c join information_schema.tables x
    on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('org_id', 'merchant_org_id')
      and not (select k.relispartition from pg_class k where k.oid = format('%I.%I', c.table_schema, c.table_name)::regclass)
    order by c.table_name, c.column_name`);
  return r.rows.map((x) => ({ table: String(x.t), column: String(x.c) })).filter((x) => (ORG_COLUMNS as readonly string[]).includes(x.column));
}

/** Every base table of the public schema except partitions (a partition's rows are read through its parent). */
export async function allTables(db: Db | Tx): Promise<string[]> {
  const r = await db.execute(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
    and not (select relispartition from pg_class where oid = format('public.%I', table_name)::regclass) order by 1`);
  return r.rows.map((x) => String(x.t));
}

async function merchantOf(db: Db, slug: string) {
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, slug));
  if (!org) throw new DeletionRefused("No organisation has that slug.");
  if (org.kind !== "merchant") throw new DeletionRefused("Only a merchant organisation can be deleted with this command.");
  const [served] = await db.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.providerOrgId, org.id)).limit(1);
  if (served) throw new DeletionRefused("Other organisations depend on this one; it is not deleted.");
  return org;
}

/**
 * Members of this organisation who belong to no other organisation (their user records go with it). A platform
 * operator is never deleted with a merchant (their account is the platform's, not the merchant's).
 */
async function onlyHere(db: Db | Tx, orgId: string): Promise<string[]> {
  const r = await db.execute(sql`select m.user_id as id from organization_memberships m where m.org_id = ${orgId}
    and not exists (select 1 from organization_memberships o where o.user_id = m.user_id and o.org_id <> ${orgId})
    and not exists (select 1 from platform_operators p where p.user_id = m.user_id)`);
  return [...new Set(r.rows.map((x) => String(x.id)))];
}

/** What identifies the merchant and its deleted members: what no table may hold afterwards. */
export interface MerchantNeedles { orgId: string; slug: string; name: string; userIds: string[]; emails: string[] }

async function needlesOf(db: Db | Tx, org: { id: string; slug: string; name: string }, userIds: string[]): Promise<MerchantNeedles> {
  const emails = userIds.length ? (await db.select({ e: t.users.email }).from(t.users).where(inArray(t.users.id, userIds))).map((x) => x.e.toLowerCase()) : [];
  return { orgId: org.id, slug: org.slug, name: org.name, userIds, emails };
}

/** Text needles: the ids, slug, name and e-mails, and the SHA-256 of each e-mail (as sign-in failures store it). */
const textNeedles = (n: MerchantNeedles) => [n.orgId, n.slug, n.name, ...n.userIds, ...n.emails, ...n.emails.map(emailSha256)].filter((x) => x.length >= 6);
const emailSha256 = (e: string) => createHash("sha256").update(e.trim().toLowerCase()).digest("hex");
const mentionsAny = (needles: string[]) => sql.join(needles.map((n) => sql`strpos(x::text, ${n}) > 0`), sql` or `);

async function retainedCount(db: Db | Tx, orgId: string): Promise<number> {
  const r = await db.execute(sql`select (select count(*) from audit_events where org_id = ${orgId}) + (select count(*) from approval_requests where org_id = ${orgId})
    + (select count(*) from approval_decisions where org_id = ${orgId}) as n`);
  return Number(r.rows[0].n);
}

/** What a deletion would remove (row counts per table, users, files) and keep in minimal form. Changes nothing. */
export async function planMerchantDeletion(db: Db, slug: string): Promise<DeletionPlan> {
  const org = await merchantOf(db, slug);
  const tables: Record<string, number> = {};
  for (const x of await orgScopedTables(db)) {
    const n = Number((await db.execute(sql`select count(*)::int as n from ${ident(x.table)} where ${ident(x.column)} = ${org.id}`)).rows[0].n);
    if (n) tables[x.table] = (tables[x.table] ?? 0) + n;
  }
  const files = (await db.select({ k: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, org.id), isNotNull(t.uploads.storageKey)))).length;
  return { orgId: org.id, slug, tables: { ...tables, organizations: 1 }, users: (await onlyHere(db, org.id)).length, files, retained: await retainedCount(db, org.id) };
}

export interface DeletionResult {
  /** The receipt (merchant_deletions.id) under which the minimal records are kept. */
  deletionId: string; orgIdSha256: string; tables: Record<string, number>; users: number; files: number; retained: number;
  /** v1 5.6: tables (and "storage") where a trace of the merchant was still found after the deletion; {} = none. */
  residue: Record<string, number>;
}

/** The minimal records of what the deletion removes (src/server/privacy/retained.ts), in their original order. */
async function retainedRows(tx: Tx, orgId: string, needles: MerchantNeedles, now: Date) {
  const own = await tx.select().from(t.auditEvents).where(eq(t.auditEvents.orgId, orgId)).orderBy(asc(t.auditEvents.seq));
  // another organisation's audit event that names this merchant or a deleted member (a provider's invitation, say)
  const others = (await tx.execute(sql`select org_id, seq from audit_events x where org_id <> ${orgId} and (${mentionsAny(textNeedles(needles))}) order by org_id, seq`)).rows
    .map((r) => ({ orgId: String(r.org_id), seq: Number(r.seq) }));
  const otherRows = others.length ? await tx.select().from(t.auditEvents).where(sql`(${t.auditEvents.orgId}, ${t.auditEvents.seq}) in (${sql.join(others.map((o) => sql`(${o.orgId}::uuid, ${o.seq}::bigint)`), sql`, `)})`).orderBy(asc(t.auditEvents.seq)) : [];
  const requests = await tx.select().from(t.approvalRequests).where(eq(t.approvalRequests.orgId, orgId)).orderBy(asc(t.approvalRequests.createdAt), asc(t.approvalRequests.id));
  const decisions = await tx.select().from(t.approvalDecisions).where(eq(t.approvalDecisions.orgId, orgId)).orderBy(asc(t.approvalDecisions.createdAt), asc(t.approvalDecisions.id));
  const rows: { kind: RetainedKind; position: number; occurredAt: Date; retainUntil: Date; record: Record<string, unknown> }[] = [];
  const next: Record<string, number> = {};
  const push = (kind: RetainedKind, at: Date, record: Record<string, unknown>) => {
    // an event dated in the future (a clock error) is kept from now
    const from = at.getTime() > now.getTime() ? now : at;
    next[kind] = (next[kind] ?? -1) + 1;
    rows.push({ kind, position: next[kind], occurredAt: from, retainUntil: retainUntil(from), record });
  };
  for (const e of [...own, ...otherRows]) push("audit_event", e.at, minimiseAudit(orgId, e as AuditRow));
  for (const r of requests) push("approval_request", r.createdAt, minimiseApprovalRequest(orgId, r));
  for (const d of decisions) push("approval_decision", d.createdAt, minimiseApprovalDecision(orgId, d));
  return { rows, others };
}

/** Everything held about deleted people outside the organisation's own tables. Returns counts per table. */
async function deletePeople(tx: Tx, needles: MerchantNeedles): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const add = (k: string, n: number | null | undefined) => { if (n) out[k] = (out[k] ?? 0) + n; };
  const ids = needles.userIds, emails = needles.emails;
  if (ids.length) {
    add("sessions", (await tx.delete(t.sessions).where(inArray(t.sessions.userId, ids)).returning({ id: t.sessions.id })).length);
    add("accounts", (await tx.delete(t.accounts).where(inArray(t.accounts.userId, ids)).returning({ id: t.accounts.id })).length);
    add("two_factors", (await tx.delete(t.twoFactors).where(inArray(t.twoFactors.userId, ids)).returning({ id: t.twoFactors.id })).length);
    add("passkeys", (await tx.delete(t.passkeys).where(inArray(t.passkeys.userId, ids)).returning({ id: t.passkeys.id })).length);
    add("auth_tokens", (await tx.delete(t.authTokens).where(inArray(t.authTokens.userId, ids)).returning({ id: t.authTokens.id })).length);
  }
  const people = [...ids, ...emails];
  if (people.length) {
    add("verifications", (await tx.execute(sql`delete from verifications x where ${mentionsAny(people)} returning 1`)).rowCount);
  }
  if (emails.length) {
    add("login_failures", (await tx.delete(t.loginFailures).where(inArray(t.loginFailures.emailSha256, emails.map(emailSha256))).returning({ id: t.loginFailures.id })).length);
  }
  // rate-limit counters are keyed with the server secret; without it they cannot be matched (they expire within a day)
  if (people.length && process.env.BETTER_AUTH_SECRET) {
    const hashes = (Object.keys(LIMITS) as Scope[]).flatMap((s) => people.map((p) => keyHash(s, p)));
    add("auth_rate_events", (await tx.delete(t.authRateEvents).where(inArray(t.authRateEvents.keyHash, hashes)).returning({ id: t.authRateEvents.id })).length);
  }
  // the local stand-in e-mail outbox: mail to a deleted person, or naming the merchant
  const mail = [needles.orgId, needles.slug, needles.name, ...emails].filter((x) => x.length >= 6);
  add("email_outbox", (await tx.execute(sql`delete from email_outbox x where lower(to_address) in (${sql.join((emails.length ? emails : [""]).map((e) => sql`${e}`), sql`, `)}) or ${mentionsAny(mail)} returning 1`)).rowCount);
  if (ids.length) add("users", (await tx.delete(t.users).where(inArray(t.users.id, ids)).returning({ id: t.users.id })).length);
  return out;
}

/**
 * Delete the merchant. `confirm` must repeat the slug exactly. Storage is cleaned after the database commit (a file
 * without its row is unreachable; a row without its file never exists), then everything is scanned for residue.
 */
export async function deleteMerchant(db: Db, slug: string, confirm: string, opts: { storage?: UploadStorage; now?: Date } = {}): Promise<DeletionResult> {
  if (confirm !== slug) throw new DeletionRefused("Confirmation does not match: repeat the organisation's slug exactly to delete it.");
  const org = await merchantOf(db, slug);
  const now = opts.now ?? new Date();
  const storage = opts.storage ?? uploadStorage({ owner: db });
  const keys = (await db.select({ k: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, org.id), isNotNull(t.uploads.storageKey)))).map((x) => x.k!);
  const scoped = await orgScopedTables(db);
  const tables: Record<string, number> = {};
  const deletionId = randomUUID();
  let users = 0, retained = 0;
  let needles: MerchantNeedles | undefined;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delete-merchant|${org.id}`}))`);
    const names = [...new Set(scoped.map((x) => x.table)), "organizations", "users", "sessions", "accounts"];
    for (const n of names) await tx.execute(sql`alter table ${ident(n)} disable trigger user`);
    const userIds = await onlyHere(tx, org.id);
    needles = await needlesOf(tx, org, userIds);
    const keep = await retainedRows(tx, org.id, needles, now);
    for (const o of keep.others) {
      const r = await tx.execute(sql`delete from audit_events where org_id = ${o.orgId} and seq = ${o.seq}`);
      if (r.rowCount) tables.audit_events = (tables.audit_events ?? 0) + r.rowCount;
    }
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
    const people = await deletePeople(tx, needles);
    users = people.users ?? 0;
    delete people.users;
    for (const [k, n] of Object.entries(people)) tables[k] = (tables[k] ?? 0) + n;
    // the receipt, then the minimal records under it
    retained = keep.rows.length;
    await tx.insert(t.merchantDeletions).values({ id: deletionId, orgRef: orgRef(org.id), deletedAt: now, counts: { ...tables, users }, retained });
    for (let i = 0; i < keep.rows.length; i += 500) await tx.insert(t.retainedRecords).values(keep.rows.slice(i, i + 500).map((r) => ({ deletionId, ...r })));
    for (const n of names) await tx.execute(sql`alter table ${ident(n)} enable trigger user`);
  });
  let files = 0;
  for (const k of keys) if (await storage.delete(org.id, k)) files++;
  files += (await storage.deleteOrganisation?.(org.id)) ?? 0;
  const residue = await findMerchantTraces(db, needles!, { storage });
  return { deletionId, orgIdSha256: createHash("sha256").update(org.id).digest("hex"), tables, users, files, retained, residue };
}

/**
 * v1 5.6: every table of the schema (read from information_schema, so a table added later is scanned too; a
 * partition through its parent) and the upload storage, searched for the merchant's id, slug and name and its deleted
 * members' ids and e-mail addresses (and their SHA-256). Returns table names (and "storage") with counts; never
 * contents. Read-only.
 */
export async function findMerchantTraces(db: Db, needles: MerchantNeedles, opts: { storage?: UploadStorage } = {}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const words = textNeedles(needles);
  for (const tb of await allTables(db)) {
    const n = Number((await db.execute(sql`select count(*)::int as n from ${ident(tb)} x where ${mentionsAny(words)}`)).rows[0].n);
    if (n) out[tb] = n;
  }
  const storage = opts.storage ?? uploadStorage({ owner: db });
  const files = storage.list ? (await storage.list()).filter((f) => f.orgId === needles.orgId).length : 0;
  if (files) out.storage = files;
  return out;
}
