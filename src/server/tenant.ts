import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { database, type Tx } from "./db/client";
import { organizationMemberships, organizations } from "./db/schema";
import { type AppRole, isAppRole } from "./authz";

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
}

export class AccessDenied extends Error {
  constructor(readonly status: 401 | 403 | 404, message: string) { super(message); }
}

/**
 * Runs `fn` in one transaction whose row-level-security context is this user (and, once known, this organisation).
 * set_config(..., true) is transaction-local, so a pooled connection never carries a tenant context into the next
 * transaction (tests/control/tenancy.test.ts proves it).
 */
export async function withTenant<T>(ctx: { userId: string; orgId?: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return database().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true), set_config('app.org_id', ${ctx.orgId ?? ""}, true)`);
    return fn(tx);
  });
}

/** The organisations this user may act in (active memberships only). */
export async function membershipsFor(p: Principal) {
  return withTenant({ userId: p.userId }, (tx) =>
    tx.select({ orgId: organizations.id, slug: organizations.slug, name: organizations.name, role: organizationMemberships.role })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.orgId))
      .where(and(eq(organizationMemberships.userId, p.userId), isNull(organizationMemberships.revokedAt)))
      .orderBy(organizations.name));
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
  return { ...p, orgId: m.orgId, orgSlug: m.slug, orgName: m.name, role: m.role };
}
