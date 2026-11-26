import "server-only";
import { z } from "zod";
import { emptyWorkspace } from "@/lib/clearline";
import { engineStateOf } from "../engine-store";
import { withProvisioning } from "../db/provisioning";
import { AccessDenied, type Principal } from "../tenant";
import { Email, invitationEmail, inviteAndSend } from "./invitations";

/**
 * v1 phase 1.1: the PLATFORM CONSOLE (/control/platform). Clearline had no platform-operator concept; this defines
 * the narrowest one:
 *   - the console exists only when the deployment sets CLEARLINE_PLATFORM_CONSOLE=1 (otherwise every route is a 404);
 *   - and only for a signed-in user listed in platform_operators, granted and revoked with the admin CLI
 *     (`grant-platform-operator <email>`, schema owner); there is no screen that grants it;
 *   - an operator can create an empty LIVE merchant or provider organisation and invite its FIRST admin, and see
 *     organisations' ids, names, kinds and counts. Nothing else: no organisation's data, no member list, no roles.
 * Every write goes through the provisioning role (prov_platform_* functions, which re-check the operator).
 */
export const platformConsoleEnabled = () => process.env.CLEARLINE_PLATFORM_CONSOLE === "1";

/** The operator, or the not-found answer (the console's existence is not disclosed). */
export async function requirePlatformOperator(p: Principal): Promise<Principal> {
  if (!platformConsoleEnabled()) throw new AccessDenied(404, "Not found.");
  const rows = await withProvisioning({ userId: p.userId }, (tx) => tx.call("prov_is_platform_operator", []));
  if (rows[0]?.prov_is_platform_operator !== true) throw new AccessDenied(404, "Not found.");
  return p;
}

export interface PlatformOrg { id: string; slug: string; name: string; kind: "merchant" | "provider"; createdAt: string; admins: number; pendingInvitations: number; setupFinished: boolean }

export async function platformOrgs(p: Principal): Promise<PlatformOrg[]> {
  await requirePlatformOperator(p);
  const rows = await withProvisioning({ userId: p.userId }, (tx) => tx.call("prov_platform_orgs", []));
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), kind: r.kind as PlatformOrg["kind"], createdAt: new Date(r.created_at as string).toISOString(),
    admins: Number(r.admins), pendingInvitations: Number(r.pending_invitations), setupFinished: r.setup_finished === true }));
}

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "a slug is 2–63 lower-case letters, digits or dashes");
const TimeZone = z.string().refine((tz) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; } }, "not an IANA time zone (e.g. Asia/Singapore)");
export const CreateOrgInput = z.object({
  kind: z.enum(["merchant", "provider"]),
  slug: Slug,
  name: z.string().trim().min(1).max(200),
  timezone: TimeZone,
  providerSlug: z.union([Slug, z.literal("")]).optional(),
  adminEmail: Email,
}).strict();

/** Create the organisation and invite its first admin, in one provisioning transaction (the email is sent inside it). */
export async function createOrganizationAndInvite(p: Principal, input: z.input<typeof CreateOrgInput>) {
  const v = CreateOrgInput.parse(input);
  await requirePlatformOperator(p);
  return withProvisioning({ userId: p.userId }, async (tx) => {
    const [o] = await tx.call("prov_platform_create_org", [v.kind, v.slug, v.name, v.timezone, v.providerSlug || null, engineStateOf(emptyWorkspace())]);
    const orgId = String(o.prov_platform_create_org);
    const invitationId = await inviteAndSend(
      async (t) => String((await tx.call("prov_platform_invite_admin", [orgId, v.adminEmail, t.sha256, t.expiresAt]))[0].prov_platform_invite_admin),
      (t) => invitationEmail({ to: v.adminEmail, orgName: v.name, role: v.kind === "provider" ? "provider_admin" : "admin", token: t.token, expiresAt: t.expiresAt }));
    return { orgId, slug: v.slug, kind: v.kind, invitationId };
  });
}

export const ReinviteInput = z.object({ orgId: z.uuid(), adminEmail: Email }).strict();

/** A new first-admin invitation (the earlier pending one, e.g. expired, is revoked). Refused once the organisation has an admin. */
export async function reinviteFirstAdmin(p: Principal, input: z.input<typeof ReinviteInput>) {
  const v = ReinviteInput.parse(input);
  const org = (await platformOrgs(p)).find((o) => o.id === v.orgId);
  if (!org) throw new AccessDenied(404, "Not found.");
  return withProvisioning({ userId: p.userId }, async (tx) => ({
    invitationId: await inviteAndSend(
      async (t) => String((await tx.call("prov_platform_invite_admin", [v.orgId, v.adminEmail, t.sha256, t.expiresAt]))[0].prov_platform_invite_admin),
      (t) => invitationEmail({ to: v.adminEmail, orgName: org.name, role: org.kind === "provider" ? "provider_admin" : "admin", token: t.token, expiresAt: t.expiresAt })),
  }));
}
