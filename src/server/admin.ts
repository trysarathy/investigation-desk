import "server-only";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { emptyWorkspace, type Workspace } from "@/lib/clearline";
import { pilotSeedWorkspace } from "./seed";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { saveWorkspaceDiff } from "./engine-store";
import { isAppRole, type AppRole } from "./authz";
import type { DataMode } from "@/lib/clearline/data-mode";

/**
 * Administration run with the schema OWNER connection (BYPASSRLS) from scripts/control/admin.ts — never from the web
 * app. Creates FICTIONAL organisations and users only.
 */

/**
 * `dataMode` (rc7): "sample" (the default, every seeded organisation) or "live" — an empty organisation for a
 * merchant's own uploads, labelled "Your data". A live organisation is never seeded with sample data. "demo" (demo
 * build, `npm run demo` only): empty here too, then filled with the fictional demo world by src/server/demo-seed.ts.
 */
export async function createOrganization(db: Db, input: { slug: string; name: string; seed: "sample" | "empty"; dataMode?: DataMode }): Promise<string> {
  const dataMode = input.dataMode ?? "sample";
  if ((dataMode === "live" || dataMode === "demo") && input.seed !== "empty") throw new Error(`a ${dataMode} organisation starts empty`);
  const ws: Workspace = input.seed === "sample" ? pilotSeedWorkspace() : emptyWorkspace();
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(t.organizations).values({ slug: input.slug, name: input.name, timezone: ws.organization.timezone, fictional: dataMode !== "live", dataMode }).returning({ id: t.organizations.id });
    await saveWorkspaceDiff(tx, org.id, null, ws, { provenance: "seed_fictional", actorUserId: null, seedActors: ws.actors });
    await tx.insert(t.auditEvents).values({ orgId: org.id, source: "server", action: "organization_created", summary: `Organisation ${input.slug} created with ${input.seed} ${dataMode === "live" ? "(live, for uploads)" : dataMode === "demo" ? "fictional (demo, for the demo build)" : "fictional"} data`, at: new Date() });
    return org.id;
  });
}

export async function createUser(db: Db, input: { email: string; name: string; password: string }): Promise<string> {
  if (input.password.length < 12) throw new Error("password must be at least 12 characters");
  const id = randomUUID();
  const hash = await hashPassword(input.password); // Better Auth's own scrypt hashing
  await db.transaction(async (tx) => {
    await tx.insert(t.users).values({ id, name: input.name, email: input.email.toLowerCase(), emailVerified: true });
    await tx.insert(t.accounts).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash });
  });
  return id;
}

export async function grantMembership(db: Db, input: { orgSlug: string; email: string; role: AppRole }) {
  if (!isAppRole(input.role)) throw new Error(`unknown role ${input.role}`);
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, input.orgSlug));
  const [user] = await db.select().from(t.users).where(eq(t.users.email, input.email.toLowerCase()));
  if (!org || !user) throw new Error("organisation or user not found");
  await db.transaction(async (tx) => {
    await tx.insert(t.organizationMemberships).values({ orgId: org.id, userId: user.id, role: input.role })
      .onConflictDoUpdate({ target: [t.organizationMemberships.orgId, t.organizationMemberships.userId], set: { role: input.role, revokedAt: null } });
    await tx.insert(t.auditEvents).values({ orgId: org.id, source: "server", action: "membership_granted", entityType: "user", entityId: user.id, summary: `${input.email} granted ${input.role}`, at: new Date() });
  });
}

/** Revoking a membership removes all authority in that organisation at once; the user's sessions are revoked too. */
export async function revokeMembership(db: Db, input: { orgSlug: string; email: string }) {
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, input.orgSlug));
  const [user] = await db.select().from(t.users).where(eq(t.users.email, input.email.toLowerCase()));
  if (!org || !user) throw new Error("organisation or user not found");
  await db.transaction(async (tx) => {
    await tx.update(t.organizationMemberships).set({ revokedAt: new Date() })
      .where(and(eq(t.organizationMemberships.orgId, org.id), eq(t.organizationMemberships.userId, user.id), isNull(t.organizationMemberships.revokedAt)));
    await tx.delete(t.sessions).where(eq(t.sessions.userId, user.id));
    await tx.insert(t.auditEvents).values({ orgId: org.id, source: "server", action: "membership_revoked", entityType: "user", entityId: user.id, summary: `${input.email} membership revoked; sessions revoked`, at: new Date() });
  });
}

export async function revokeSessions(db: Db, email: string): Promise<number> {
  const [user] = await db.select().from(t.users).where(eq(t.users.email, email.toLowerCase()));
  if (!user) throw new Error("user not found");
  const r = await db.delete(t.sessions).where(eq(t.sessions.userId, user.id)).returning({ id: t.sessions.id });
  return r.length;
}

export async function health(db: Db) {
  const r = await db.execute(sql`select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
  return r.rows[0];
}

/**
 * rc6 phase 8: accept a provider's invitation record (owner connection, an operator's step; no email is ever sent).
 * Creates the user if needed (password from the caller, never an argument), grants the invited merchant role and
 * marks the invitation accepted. A non-pending invitation is refused.
 */
export async function acceptInvitation(db: Db, id: string, input: { password?: string; name?: string }) {
  const [inv] = await db.select().from(t.merchantInvitations).where(eq(t.merchantInvitations.id, id));
  if (!inv) throw new Error("invitation not found");
  if (inv.status !== "pending") throw new Error(`invitation is ${inv.status}`);
  const [org] = await db.select({ slug: t.organizations.slug, kind: t.organizations.kind, providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, inv.merchantOrgId));
  if (!org || org.kind !== "merchant" || org.providerOrgId !== inv.orgId) throw new Error("the invitation's merchant is not served by the inviting provider");
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, inv.email));
  if (!user) {
    if (!input.password) throw new Error("set CLEARLINE_NEW_PASSWORD for the new user");
    await createUser(db, { email: inv.email, name: input.name ?? inv.email.split("@")[0], password: input.password });
  }
  await grantMembership(db, { orgSlug: org.slug, email: inv.email, role: inv.role as AppRole });
  await db.update(t.merchantInvitations).set({ status: "accepted", acceptedAt: new Date() }).where(eq(t.merchantInvitations.id, id));
  return { email: inv.email, role: inv.role, orgSlug: org.slug };
}
