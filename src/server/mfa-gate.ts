import "server-only";
import { eq } from "drizzle-orm";
import { freshlyAuthenticated } from "./auth-constants";
import type { SessionInfo } from "./auth";
import { orgSecuritySettings } from "./db/schema";
import { RequestRefused } from "./errors";
import type { AppRole } from "./authz";
import { withTenant, type TenantContext } from "./tenant";

/**
 * The MFA gate (v1 phase 1.2, security control — strengthens). Runs on every /control page and /api/control request
 * after the organisation is resolved (src/server/control-page.ts, src/server/control-http.ts), so no route can skip it:
 *
 * - An Admin or an Approver must have MFA (a verified authenticator app; passkeys are added on top). Until then
 *   every page sends them to /control/security to set it up and every API answers 403 MFA_ENROLLMENT_REQUIRED.
 * - An organisation may require MFA for every member (org_security_settings.require_mfa_all, set by an Admin).
 * - A user who HAS MFA must have proved it in this session; a session without that proof (it could only come from a
 *   path that did not ask for it) answers 403 MFA_VERIFICATION_REQUIRED until a step-up.
 */
export const MFA_REQUIRED_ROLES: readonly AppRole[] = ["admin", "approver"];

export class MfaRequired extends RequestRefused {}

export async function orgRequiresMfaForAll(ctx: { userId: string; orgId: string }): Promise<boolean> {
  const rows = await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) =>
    tx.select({ all: orgSecuritySettings.requireMfaAll }).from(orgSecuritySettings).where(eq(orgSecuritySettings.orgId, ctx.orgId)), { read: true });
  return rows[0]?.all === true;
}

/** Whether this member must have MFA in this organisation. */
export async function mfaRequiredFor(ctx: TenantContext): Promise<boolean> {
  return MFA_REQUIRED_ROLES.includes(ctx.role) || (await orgRequiresMfaForAll(ctx));
}

export async function assertMfaGate(s: SessionInfo, ctx: TenantContext): Promise<void> {
  if (s.mfaEnrolled) {
    if (!s.mfaVerifiedAt) throw new MfaRequired(403, "MFA_VERIFICATION_REQUIRED", "Confirm your second factor to continue (Security page).");
    return;
  }
  if (await mfaRequiredFor(ctx)) throw new MfaRequired(403, "MFA_ENROLLMENT_REQUIRED", "Your role requires multi-factor authentication. Set it up on the Security page to continue.");
}

/** Step-up for a sensitive action: the session must have re-authenticated in the last 10 minutes. */
export function assertRecentAuth(s: SessionInfo): void {
  if (!freshlyAuthenticated(s)) throw new RequestRefused(403, "REAUTHENTICATION_REQUIRED", "Confirm it is you before this change (re-enter your code or password).");
}
