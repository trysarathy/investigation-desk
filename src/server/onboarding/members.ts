import "server-only";
import { z } from "zod";
import { can, ROLE_LABELS } from "../authz";
import { accessReview, type AccessReviewRow } from "../access-review";
import { withProvisioning } from "../db/provisioning";
import { invitationSender } from "../email";
import { RequestRefused } from "../errors";
import { AccessDenied, requireUnscoped, type TenantContext } from "../tenant";
import { Email, invitationEmail, inviteAndDeliver } from "./invitations";
import { MEMBER_ROLES } from "./wizard";

/**
 * Overnight (invite links): the merchant Admin's members page (/control/merchant/admin), after setup as well as during
 * it. Who has access (the access review's rows: role, status, second factor, last sign-in), pending invitations,
 * invite by link with a role, revoke an invitation, deactivate a member. Only an UNSCOPED Admin (w1-31): checked here
 * and again in the database (prov_member_* through prov_admin_org(), drizzle/0088), which also audits every write and
 * refuses deactivating yourself or the last Admin. MFA for Admins and Approvers is untouched: the tenant routes'
 * MFA gate runs before any of this, and an invited Admin or Approver must enrol before their first use.
 */
export function requireMemberAdmin(ctx: TenantContext) {
  if (!can(ctx.role, "manage_members")) throw new AccessDenied(403, "Only an Admin manages members.");
  requireUnscoped(ctx);
}

const prov = <T>(ctx: TenantContext, fn: Parameters<typeof withProvisioning<T>>[1]) => withProvisioning({ userId: ctx.userId, orgId: ctx.orgId }, fn);

export interface PendingInvitation { id: string; email: string; role: string; expiresAt: string; expired: boolean }
export interface MembersView {
  members: AccessReviewRow[];
  /** null: this deployment has no provisioning connection, so invitations and deactivation are not available here. */
  invitations: PendingInvitation[] | null;
}

export async function membersView(ctx: TenantContext): Promise<MembersView> {
  requireMemberAdmin(ctx);
  const review = await accessReview(ctx);
  let invitations: PendingInvitation[] | null = null;
  try {
    const [state] = await prov(ctx, (tx) => tx.call("prov_setup_state", []));
    invitations = (state.prov_setup_state as { invitations: PendingInvitation[] }).invitations;
  } catch (e) { if (!(e instanceof RequestRefused && e.code === "PROVISIONING_NOT_CONFIGURED")) throw e; }
  return { members: review.rows, invitations };
}

export const MemberInviteInput = z.object({ email: Email, role: z.enum(MEMBER_ROLES) }).strict();
/** Invite a member with a role: by email when a sender exists, otherwise the one-time link is returned once. */
export async function inviteMemberByLink(ctx: TenantContext, input: z.input<typeof MemberInviteInput>) {
  requireMemberAdmin(ctx);
  const v = MemberInviteInput.parse(input);
  return prov(ctx, async (tx) => inviteAndDeliver(
    async (tk) => ({ invitationId: String((await tx.call("prov_member_invite", [v.email, v.role, tk.sha256, tk.expiresAt]))[0].prov_member_invite), role: v.role, roleLabel: ROLE_LABELS[v.role] }),
    (tk) => invitationEmail({ to: v.email, orgName: ctx.orgName, role: v.role, token: tk.token, expiresAt: tk.expiresAt }),
    invitationSender({ prov: tx })));
}

export const MemberRevokeInvitationInput = z.object({ invitationId: z.uuid() }).strict();
export async function revokeMemberInvitation(ctx: TenantContext, input: z.input<typeof MemberRevokeInvitationInput>) {
  requireMemberAdmin(ctx);
  const v = MemberRevokeInvitationInput.parse(input);
  await prov(ctx, (tx) => tx.call("prov_member_revoke_invitation", [v.invitationId]));
  return { status: "revoked" as const, invitationId: v.invitationId };
}

export const DeactivateInput = z.object({ userId: z.string().min(1).max(64) }).strict();
/** End a member's access: the membership is revoked and their sessions end. Not yourself; never the last Admin. */
export async function deactivateMember(ctx: TenantContext, input: z.input<typeof DeactivateInput>) {
  requireMemberAdmin(ctx);
  const v = DeactivateInput.parse(input);
  if (v.userId === ctx.userId) throw new RequestRefused(409, "OWN_MEMBERSHIP", "You cannot deactivate yourself; another Admin can.");
  const [r] = await prov(ctx, (tx) => tx.call("prov_member_deactivate", [v.userId]));
  return { status: "deactivated" as const, userId: v.userId, sessionsRevoked: Number(r.prov_member_deactivate) };
}

/** The members page's actions by URL segment (/api/control/merchant/admin/members/actions/<action>). */
export const MEMBER_ACTIONS = { invite: inviteMemberByLink, "revoke-invitation": revokeMemberInvitation, deactivate: deactivateMember } as const satisfies Record<string, (ctx: TenantContext, input: never) => Promise<unknown>>;
export const isMemberAction = (a: string): a is keyof typeof MEMBER_ACTIONS => Object.hasOwn(MEMBER_ACTIONS, a);
