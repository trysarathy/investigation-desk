import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { SetupRefused } from "../merchant-setup";
import type { EmailSender } from "../email";
import { Email, invitationEmail, inviteAndSend } from "./invitations";

/**
 * v1 phase 1.1, the operator's admin CLI (schema OWNER connection, `openOwnerDb`): invite an organisation's first
 * admin, and grant or revoke the platform-operator flag. Output and audit rows hold ids and roles only.
 *   npm run control:admin -- invite-admin <org-slug> <email>
 *   npm run control:admin -- grant-platform-operator <email> | revoke-platform-operator <email>
 */
const audit = (db: Pick<Db, "insert">, orgId: string, action: string, entityType: string, entityId: string, summary: string, details: Record<string, unknown>) =>
  db.insert(t.auditEvents).values({ orgId, source: "server", actorUserId: null, action, entityType, entityId, summary: `${summary} (operator, admin CLI)`, at: new Date(), details });

/** The first admin of an organisation (Admin of a merchant, Provider Admin of a provider); refused once it has one. */
export async function inviteFirstAdmin(db: Db, input: { orgSlug: string; email: string }, sender?: EmailSender) {
  const r = Email.safeParse(input.email);
  if (!r.success) throw new SetupRefused("email: not an email address");
  const email = r.data;
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, input.orgSlug));
  if (!org) throw new SetupRefused("No organisation has that slug.");
  const role = org.kind === "provider" ? "provider_admin" as const : "admin" as const;
  const [has] = await db.select({ id: t.organizationMemberships.id }).from(t.organizationMemberships)
    .where(and(eq(t.organizationMemberships.orgId, org.id), eq(t.organizationMemberships.role, role), isNull(t.organizationMemberships.revokedAt))).limit(1);
  if (has) throw new SetupRefused("This organisation already has an admin; its admin invites everyone else.");
  return db.transaction(async (tx) => inviteAndSend(async (tk) => {
    const prior = await tx.update(t.orgInvitations).set({ status: "revoked", closedAt: new Date() })
      .where(and(eq(t.orgInvitations.orgId, org.id), eq(t.orgInvitations.email, email), eq(t.orgInvitations.status, "pending"))).returning({ id: t.orgInvitations.id });
    const [inv] = await tx.insert(t.orgInvitations).values({ orgId: org.id, email, role, tokenSha256: tk.sha256, invitedVia: "cli", expiresAt: tk.expiresAt }).returning({ id: t.orgInvitations.id });
    await audit(tx, org.id, "invitation_created", "invitation", inv.id, `Invitation ${inv.id} created for the ${role} role`, { invitationId: inv.id, role, via: "cli", replaced: prior.length });
    return { status: "invited" as const, orgId: org.id, invitationId: inv.id, role };
  }, (tk) => invitationEmail({ to: email, orgName: org.name, role, token: tk.token, expiresAt: tk.expiresAt }), sender));
}

async function userIdOf(db: Db, email: string) {
  const [u] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email.trim().toLowerCase()));
  if (!u) throw new SetupRefused("No user has that email (the person accepts an invitation or is created with create-user first).");
  return u.id;
}

export async function grantPlatformOperator(db: Db, email: string) {
  const userId = await userIdOf(db, email);
  const r = await db.execute(sql`insert into platform_operators (user_id) values (${userId})
    on conflict (user_id) do update set revoked_at = null, granted_at = case when platform_operators.revoked_at is null then platform_operators.granted_at else now() end
    returning (xmax = 0) as inserted`);
  return { status: r.rows[0]?.inserted ? "granted" as const : "exists" as const, userId };
}

export async function revokePlatformOperator(db: Db, email: string) {
  const userId = await userIdOf(db, email);
  const r = await db.update(t.platformOperators).set({ revokedAt: new Date() }).where(and(eq(t.platformOperators.userId, userId), isNull(t.platformOperators.revokedAt))).returning({ u: t.platformOperators.userId });
  // their sessions end too, so an open console stops at once
  if (r.length) await db.delete(t.sessions).where(eq(t.sessions.userId, userId));
  return { status: r.length ? "revoked" as const : "not_an_operator" as const, userId };
}
