import "server-only";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import { auth, type SessionInfo } from "./auth";
import { freshlyAuthenticated } from "./auth-constants";
import { can } from "./authz";
import { serverAudit } from "./control";
import { database } from "./db/client";
import * as t from "./db/schema";
import { RequestRefused } from "./errors";
import { assertRecentAuth, MFA_REQUIRED_ROLES } from "./mfa-gate";
import { recordSignInResult, signInAllowed } from "./signin-limit";
import { AccessDenied, membershipsFor, withTenant, type TenantContext } from "./tenant";

/**
 * A signed-in user's own sign-in security (v1 phase 1.2): their sessions, second factors, password step-up, and an
 * Admin's organisation-wide MFA policy. Every function takes the SessionInfo of the request (never an id from input
 * for "who"); ids from input only ever select among the caller's own rows.
 */

export interface SessionRow { id: string; createdAt: Date; lastActiveAt: Date; expiresAt: Date; device: string; current: boolean; mfa: boolean }

/** A short, non-identifying label for a user agent ("Chrome on macOS"); never the raw string. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "an unknown system";
  return `${browser} on ${os}`;
}

export async function listMySessions(s: SessionInfo): Promise<SessionRow[]> {
  const rows = await database().select({ id: t.sessions.id, createdAt: t.sessions.createdAt, updatedAt: t.sessions.updatedAt, expiresAt: t.sessions.expiresAt, ua: t.sessions.userAgent, mfa: t.sessions.mfaVerifiedAt })
    .from(t.sessions).where(and(eq(t.sessions.userId, s.principal.userId), gt(t.sessions.expiresAt, new Date()))).orderBy(desc(t.sessions.createdAt));
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, lastActiveAt: r.updatedAt, expiresAt: r.expiresAt, device: deviceLabel(r.ua), current: r.id === s.sessionId, mfa: !!r.mfa }));
}

const SessionId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Revoke one of the caller's OTHER sessions (their current one: use Sign out). Someone else's id is "not found". */
export async function revokeMySession(s: SessionInfo, id: unknown): Promise<void> {
  const sid = SessionId.safeParse(id);
  if (!sid.success) throw new AccessDenied(404, "Not found.");
  if (sid.data === s.sessionId) throw new RequestRefused(409, "CURRENT_SESSION", "Use Sign out for this session.");
  const gone = await database().delete(t.sessions).where(and(eq(t.sessions.id, sid.data), eq(t.sessions.userId, s.principal.userId))).returning({ id: t.sessions.id });
  if (gone.length !== 1) throw new AccessDenied(404, "Not found.");
}

/** Revoke every session of the caller except this one. Returns how many. */
export async function revokeMyOtherSessions(s: SessionInfo): Promise<number> {
  const gone = await database().delete(t.sessions).where(and(eq(t.sessions.userId, s.principal.userId), ne(t.sessions.id, s.sessionId))).returning({ id: t.sessions.id });
  return gone.length;
}

export interface SecurityStatus {
  email: string; emailVerified: boolean;
  mfaEnrolled: boolean; mfaVerifiedThisSession: boolean; fresh: boolean;
  /** Organisations where this user must have MFA (by role, or the organisation requires it for everyone). */
  requiredIn: { slug: string; name: string; reason: "role" | "organisation" }[];
  passkeys: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[];
}

export async function requiredIn(s: SessionInfo): Promise<SecurityStatus["requiredIn"]> {
  const ms = await membershipsFor(s.principal);
  const out: SecurityStatus["requiredIn"] = [];
  for (const m of ms) {
    if ((MFA_REQUIRED_ROLES as readonly string[]).includes(m.role)) { out.push({ slug: m.slug, name: m.name, reason: "role" }); continue; }
    const rows = await withTenant({ userId: s.principal.userId, orgId: m.orgId }, (tx) => tx.select({ all: t.orgSecuritySettings.requireMfaAll }).from(t.orgSecuritySettings).where(eq(t.orgSecuritySettings.orgId, m.orgId)), { read: true });
    if (rows[0]?.all) out.push({ slug: m.slug, name: m.name, reason: "organisation" });
  }
  return out;
}

export async function securityStatus(s: SessionInfo): Promise<SecurityStatus> {
  const [u] = await database().select({ email: t.users.email, verified: t.users.emailVerified }).from(t.users).where(eq(t.users.id, s.principal.userId));
  const pk = await database().select({ id: t.passkeys.id, name: t.passkeys.name, createdAt: t.passkeys.createdAt, lastUsedAt: t.passkeys.lastUsedAt }).from(t.passkeys).where(eq(t.passkeys.userId, s.principal.userId)).orderBy(t.passkeys.createdAt);
  return {
    email: u?.email ?? s.principal.email, emailVerified: !!u?.verified,
    mfaEnrolled: s.mfaEnrolled, mfaVerifiedThisSession: !!s.mfaVerifiedAt, fresh: freshlyAuthenticated(s),
    requiredIn: await requiredIn(s), passkeys: pk,
  };
}

/**
 * Step-up with the PASSWORD — only for a user without MFA (a user with MFA steps up with a second factor, through
 * /api/auth: TOTP, a recovery code or a passkey). Wrong passwords count toward the per-account sign-in limit.
 */
export async function passwordStepUp(s: SessionInfo, password: unknown): Promise<void> {
  if (s.mfaEnrolled) throw new RequestRefused(409, "USE_SECOND_FACTOR", "Confirm with your authenticator app or a passkey.");
  if (!(await signInAllowed(s.principal.email))) throw new RequestRefused(429, "TOO_MANY_ATTEMPTS", "Too many wrong passwords for this account. Try again in 15 minutes.");
  const [acct] = await database().select({ hash: t.accounts.password }).from(t.accounts).where(and(eq(t.accounts.userId, s.principal.userId), eq(t.accounts.providerId, "credential")));
  const ok = typeof password === "string" && password.length <= 128 && !!acct?.hash && (await (await auth().$context).password.verify({ hash: acct.hash, password }));
  if (!ok) {
    await recordSignInResult(s.principal.email, false);
    throw new RequestRefused(400, "INVALID_PASSWORD", "That password is not right.");
  }
  await database().update(t.sessions).set({ reauthenticatedAt: new Date() }).where(eq(t.sessions.id, s.sessionId));
}

/**
 * Turn MFA off (authenticator app, recovery codes and passkeys together). Needs a fresh step-up, and is refused while
 * any of the user's organisations requires MFA of them. Every other session is signed out.
 */
export async function disableMfa(s: SessionInfo): Promise<void> {
  if (!s.mfaEnrolled) throw new RequestRefused(409, "MFA_NOT_ENABLED", "Multi-factor authentication is not on.");
  assertRecentAuth(s);
  const req = await requiredIn(s);
  if (req.length > 0) throw new RequestRefused(409, "MFA_REQUIRED", `Multi-factor authentication is required for you in ${req.map((r) => r.name).join(", ")}; it cannot be turned off.`);
  await database().transaction(async (tx) => {
    await tx.delete(t.passkeys).where(eq(t.passkeys.userId, s.principal.userId));
    await tx.delete(t.twoFactors).where(eq(t.twoFactors.userId, s.principal.userId));
    await tx.update(t.users).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(t.users.id, s.principal.userId));
    await tx.delete(t.sessions).where(and(eq(t.sessions.userId, s.principal.userId), ne(t.sessions.id, s.sessionId)));
  });
}

/** Remove one of the caller's passkeys (fresh step-up). */
export async function removePasskey(s: SessionInfo, id: unknown): Promise<void> {
  assertRecentAuth(s);
  const pid = z.uuid().safeParse(id);
  if (!pid.success) throw new AccessDenied(404, "Not found.");
  const gone = await database().delete(t.passkeys).where(and(eq(t.passkeys.id, pid.data), eq(t.passkeys.userId, s.principal.userId))).returning({ id: t.passkeys.id });
  if (gone.length !== 1) throw new AccessDenied(404, "Not found.");
}

export const OrgMfaPolicy = z.object({ requireMfaAll: z.boolean() }).strict();

/** An Admin sets "require MFA for every member" for their organisation (fresh step-up; audited). */
export async function setOrgMfaPolicy(ctx: TenantContext, s: SessionInfo, body: unknown): Promise<{ requireMfaAll: boolean }> {
  if (!can(ctx.role, "manage_members")) throw new AccessDenied(403, "Only an Admin can change the organisation's sign-in policy.");
  assertRecentAuth(s);
  const { requireMfaAll } = OrgMfaPolicy.parse(body);
  await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    await tx.insert(t.orgSecuritySettings).values({ orgId: ctx.orgId, requireMfaAll, updatedBy: ctx.userId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: t.orgSecuritySettings.orgId, set: { requireMfaAll, updatedBy: ctx.userId, updatedAt: new Date() } });
    await serverAudit(tx, ctx, requireMfaAll ? "org_mfa_required_for_all" : "org_mfa_required_by_role_only", "organization", ctx.orgId,
      requireMfaAll ? "An Admin required multi-factor sign-in for every member" : "An Admin set multi-factor sign-in to be required for Admins and Approvers only", { requireMfaAll });
  });
  return { requireMfaAll };
}

