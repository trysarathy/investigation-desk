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

/**
 * Administration run with the schema OWNER connection (BYPASSRLS) from scripts/control/admin.ts — never from the web
 * app. Creates FICTIONAL organisations and users only.
 */

export async function createOrganization(db: Db, input: { slug: string; name: string; seed: "sample" | "empty" }): Promise<string> {
  const ws: Workspace = input.seed === "sample" ? pilotSeedWorkspace() : emptyWorkspace();
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(t.organizations).values({ slug: input.slug, name: input.name, timezone: ws.organization.timezone, fictional: true }).returning({ id: t.organizations.id });
    await saveWorkspaceDiff(tx, org.id, null, ws, { provenance: "seed_fictional", actorUserId: null, seedActors: ws.actors });
    await tx.insert(t.auditEvents).values({ orgId: org.id, source: "server", action: "organization_created", summary: `Organisation ${input.slug} created with ${input.seed} fictional data`, at: new Date() });
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
