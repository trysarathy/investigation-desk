import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { ROLE_LABELS, type AppRole } from "../authz";
import { emailSender, type EmailSender } from "../email";
import { withProvisioning } from "../db/provisioning";
import { RequestRefused } from "../errors";

/**
 * v1 phase 1.1 invitations: invite-only onboarding. An invitation is a one-time token (32 random bytes) whose
 * SHA-256 alone is stored; the token travels only in the email, inside the link's #fragment (a fragment is never
 * sent to a server, so it does not reach access logs). It expires after INVITATION_HOURS and is single-use.
 */
export const INVITATION_HOURS = 72; // [ASSUMPTION] three days; the database caps any invitation at 7 days

export const Email = z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "not an email address");

export interface NewToken { token: string; sha256: string; expiresAt: Date }
export const tokenSha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
export function newInvitationToken(now = new Date()): NewToken {
  const token = randomBytes(32).toString("base64url");
  return { token, sha256: tokenSha256(token), expiresAt: new Date(now.getTime() + INVITATION_HOURS * 3600_000) };
}

export function invitationLink(token: string, origin = process.env.CLEARLINE_ORIGIN): string {
  if (!origin) throw new RequestRefused(409, "ORIGIN_NOT_CONFIGURED", "CLEARLINE_ORIGIN is not set, so no invitation link can be made.");
  return `${origin.replace(/\/$/, "")}/control/invite#token=${token}`;
}

/** The invitation email: plain text, no tracking, the organisation's name and the role only. */
export function invitationEmail(input: { to: string; orgName: string; role: AppRole; token: string; expiresAt: Date }) {
  return {
    to: input.to,
    kind: "invitation",
    subject: `You are invited to ${input.orgName} on Clearline`,
    text: [
      `You have been invited to join ${input.orgName} on Clearline as ${ROLE_LABELS[input.role]}.`,
      "",
      "Open this link to choose your password and accept the invitation:",
      invitationLink(input.token),
      "",
      `The link works once and expires on ${input.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      "If you did not expect this invitation, ignore this email: nothing happens unless the link is opened and accepted.",
    ].join("\n"),
  };
}

/**
 * Create an invitation (through `create`, inside a transaction) and send its email in the same transaction: if the
 * sender refuses, the invitation is rolled back, so an invitation never exists that nobody was told about.
 */
export async function inviteAndSend<T>(create: (t: NewToken) => Promise<T>, mail: (t: NewToken) => ReturnType<typeof invitationEmail>, sender: EmailSender = emailSender({ required: true })): Promise<T> {
  const t = newInvitationToken();
  const out = await create(t);
  await sender.send(mail(t));
  return out;
}

export const AcceptInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This invitation link is not complete. Open the link from the email again."),
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(12, "Choose a password of at least 12 characters.").max(128).optional(),
}).strict();

/**
 * Accept an invitation (the invitee is not signed in). A new person chooses a name and a password (Better Auth's own
 * hashing); a person who already has an account just joins and keeps their password.
 */
export async function acceptInvitation(input: z.input<typeof AcceptInput>) {
  const v = AcceptInput.parse(input);
  const hash = v.password ? await hashPassword(v.password) : null;
  const rows = await withProvisioning({}, (tx) => tx.call("prov_accept_invitation", [tokenSha256(v.token), randomUUID(), v.name ?? null, hash]));
  const r = rows[0] as { org_slug: string; role: string; existing_user: boolean };
  return { orgSlug: r.org_slug, role: r.role, existingUser: r.existing_user };
}
