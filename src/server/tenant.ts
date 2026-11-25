import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { database, type Tx } from "./db/client";
import { auditorGrants, membershipEntityScopes, organizationMemberships, organizations } from "./db/schema";
import { type AppRole, isAppRole } from "./authz";
import { runWithLiveClock } from "./live-clock";

/** The authenticated principal for one request: always derived on the server from the session, never from input. */
export interface Principal {
  userId: string;
  name: string;
  email: string;
}

export interface TenantContext extends Principal {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: AppRole;
  /**
   * v1 phase 1.3: the entities this membership may read and act on; null = every entity of the organisation (an
   * unscoped membership, the default). The database enforces the same scope (drizzle/0053, RESTRICTIVE policies).
   */
  entityScope: readonly string[] | null;
  /** v1 phase 4: an Auditor's active grant (whole months, inclusive), set only for the auditor role. */
  audit?: AuditGrant;
}

export interface AuditGrant { grantId: string; periodStart: string; periodEnd: string; expiresAt: string; months: readonly string[] }

export class AccessDenied extends Error {
  constructor(readonly status: 401 | 403 | 404, message: string) { super(message); }
}

/**
 * Runs `fn` in one transaction whose row-level-security context is this user (and, once known, this organisation).
 * set_config(..., true) is transaction-local, so a pooled connection never carries a tenant context into the next
 * transaction (tests/control/workflow.test.ts, "the tenant context never leaks", proves it on one connection).
 */
export async function withTenant<T>(ctx: { userId: string; orgId?: string }, fn: (tx: Tx) => Promise<T>, opts: { read?: boolean } = {}): Promise<T> {
  await assertRuntimeRole();
  // Reads run in one REPEATABLE READ, read-only snapshot, so a page never sees half of a concurrent action.
  return database().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true), set_config('app.org_id', ${ctx.orgId ?? ""}, true)`);
    // Demo build only (inlined constant; any other build drops this branch and the import): a write for a DEMO
    // organisation is stamped on the demo calendar, app side and database side (src/server/demo-live-clock.ts).
    if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {
      if (ctx.orgId && !opts.read) {
        const { enterDemoClock } = await import("./demo-live-clock");
        const clock = await enterDemoClock(tx, ctx.orgId);
        if (clock) return runWithLiveClock(clock, () => fn(tx));
      }
    }
    return fn(tx);
  }, opts.read ? { isolationLevel: "repeatable read", accessMode: "read only" } : undefined);
}

let roleCheck: Promise<void> | undefined;
/**
 * Refuse to serve when the runtime connection could bypass row-level security (superuser or BYPASSRLS), whatever
 * the role is called. Checked once per process, before the first tenant transaction.
 */
export function assertRuntimeRole(): Promise<void> {
  return (roleCheck ??= checkRuntimeRole(database()).catch((e) => { roleCheck = undefined; throw e; }));
}
export async function checkRuntimeRole(db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<void> {
  const r = await db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
  const row = r.rows[0] ?? {};
  if (row.rolsuper || row.rolbypassrls) throw new Error("refusing to serve: DATABASE_URL's role can bypass row-level security (use the clearline_runtime login)");
}

/** The organisations this user may act in (active memberships only). */
export async function membershipsFor(p: Principal) {
  return withTenant({ userId: p.userId }, (tx) =>
    tx.select({ orgId: organizations.id, slug: organizations.slug, name: organizations.name, role: organizationMemberships.role, entityScoped: organizationMemberships.entityScoped })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.orgId))
      .where(and(eq(organizationMemberships.userId, p.userId), isNull(organizationMemberships.revokedAt)))
      .orderBy(organizations.name));
}

/** The entity scope of this user's membership in `orgId`: null when unscoped; the scoped entity ids otherwise. */
async function entityScopeOf(p: Principal, orgId: string, scoped: boolean): Promise<readonly string[] | null> {
  if (!scoped) return null;
  const rows = await withTenant({ userId: p.userId }, (tx) => tx.select({ entityId: membershipEntityScopes.entityId }).from(membershipEntityScopes)
    .where(and(eq(membershipEntityScopes.orgId, orgId), eq(membershipEntityScopes.userId, p.userId))).orderBy(membershipEntityScopes.entityId), { read: true });
  return Object.freeze(rows.map((r) => r.entityId));
}

/** Whether this context may see and act on `entityId` (an unscoped membership: every entity). */
export const inEntityScope = (ctx: Pick<TenantContext, "entityScope">, entityId: string | null | undefined): boolean =>
  ctx.entityScope === null || (!!entityId && ctx.entityScope.includes(entityId));

/**
 * Organisation-wide changes (a provider's access to every entity, the retention of every upload, the access review
 * of every member) need an unscoped membership: a member limited to some entities cannot act for the others.
 */
export function requireUnscoped(ctx: Pick<TenantContext, "entityScope">): void {
  if (ctx.entityScope !== null) throw new AccessDenied(403, "This applies to every entity; your access is limited to some entities.");
}

/**
 * Refuse an entity outside the membership's scope as "not found", exactly like an entity that does not exist, so a
 * scoped member learns nothing about the organisation's other entities. Call before any read or write of the entity.
 */
export function requireEntity(ctx: Pick<TenantContext, "entityScope">, entityId: string | null | undefined): void {
  if (!inEntityScope(ctx, entityId)) throw new AccessDenied(404, "Not found.");
}

/**
 * Resolve the organisation for a request. `requestedSlug` (a cookie or path) only *selects* among the user's own
 * active memberships: it is never proof of access. Unknown or foreign organisations are a 404, so their existence is
 * not disclosed.
 */
export async function resolveTenant(p: Principal, requestedSlug: string | undefined): Promise<TenantContext> {
  const ms = await membershipsFor(p);
  if (ms.length === 0) throw new AccessDenied(403, "You are not a member of any organisation.");
  const m = requestedSlug ? ms.find((x) => x.slug === requestedSlug) : ms[0];
  if (!m) throw new AccessDenied(404, "Not found.");
  if (!isAppRole(m.role)) throw new AccessDenied(403, "Unknown role.");
  const ctx: TenantContext = { ...p, orgId: m.orgId, orgSlug: m.slug, orgName: m.name, role: m.role, entityScope: await entityScopeOf(p, m.orgId, m.entityScoped) };
  if (m.role === "auditor") ctx.audit = await activeAuditGrant(p, m.orgId);
  return ctx;
}

/**
 * v1 phase 4: an Auditor acts only through an active grant (not revoked, not expired); none → 403. The database
 * applies the same period (drizzle/0067), so this is the server's half of the check, not the only one.
 */
async function activeAuditGrant(p: Principal, orgId: string): Promise<AuditGrant> {
  const [g] = await withTenant({ userId: p.userId, orgId }, (tx) => tx.select().from(auditorGrants)
    .where(and(eq(auditorGrants.orgId, orgId), eq(auditorGrants.userId, p.userId), isNull(auditorGrants.revokedAt), gt(auditorGrants.expiresAt, sql`now()`)))
    .orderBy(desc(auditorGrants.createdAt)).limit(1), { read: true });
  if (!g) throw new AccessDenied(403, "Your auditor access has ended or has not been granted.");
  const months: string[] = [];
  for (let d = new Date(`${g.periodStart}T00:00:00Z`); d.toISOString().slice(0, 10) <= g.periodEnd; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  return Object.freeze({ grantId: g.id, periodStart: g.periodStart, periodEnd: g.periodEnd, expiresAt: g.expiresAt.toISOString(), months: Object.freeze(months) });
}
