import "server-only";
import { createHash } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, isAppRole, ROLE_LABELS } from "./authz";
import { serverAudit } from "./control";
import { csvCell, winAnsi } from "./merchant-ui";
import { AccessDenied, requireUnscoped, type TenantContext, withTenant } from "./tenant";
import { stampNow } from "./live-clock";

/**
 * v1 phase 1.4: the access review. Who has access to what in this organisation: every membership (active and revoked)
 * with its role, its entity scope, the second factor when the deployment records one, when access was granted, the
 * last sign-in and who invited the member. For a merchant's Admin (its own members) and a Provider Admin (the
 * provider's own members); a member limited to some entities does not see the organisation-wide review. Read-only;
 * each CSV or PDF export is audited with its hash and row count (never names or emails in the audit row).
 */

/** v1 1.2: users.two_factor_enabled (a verified authenticator app; the MFA gate requires it for Admins and Approvers). */
export type MfaStatus = "enabled" | "not_enabled";

export interface AccessReviewRow {
  userId: string; name: string; email: string; role: string; roleLabel: string; status: "active" | "revoked";
  /** "all" = every entity of the organisation; otherwise the entity ids (possibly none: no entity). */
  entityScope: "all" | string[];
  mfa: MfaStatus; passkeys: number; grantedAt: string; revokedAt: string | null; lastSignInAt: string | null;
  /** The inviter's name; null when an operator granted the membership with the admin command. */
  invitedBy: string | null;
}

export interface AccessReview {
  organisation: { id: string; name: string; kind: "merchant" | "provider" };
  generatedAt: string;
  entities: { id: string; name: string }[];
  rows: AccessReviewRow[];
}

function requireReviewer(ctx: TenantContext) {
  if (!can(ctx.role, "access_review")) throw new AccessDenied(403, "Only an Admin of this organisation reviews access.");
  requireUnscoped(ctx);
}

/** Passkeys per user (v1 1.2, drizzle/0050): a second way to prove the second factor, on top of the authenticator app. */
async function passkeysOf(tx: Tx, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const r = await tx.select({ userId: t.passkeys.userId, n: sql<number>`count(*)::int` }).from(t.passkeys).where(inArray(t.passkeys.userId, userIds)).groupBy(t.passkeys.userId);
  return new Map(r.map((x) => [x.userId, Number(x.n)]));
}

async function load(tx: Tx, ctx: TenantContext): Promise<AccessReview> {
  const [org] = await tx.select({ id: t.organizations.id, name: t.organizations.name, kind: t.organizations.kind }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
  if (!org) throw new AccessDenied(404, "Not found.");
  const ms = await tx.select({ m: t.organizationMemberships, name: t.users.name, email: t.users.email, lastSignInAt: t.users.lastSignInAt, mfa: t.users.twoFactorEnabled })
    .from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
    .where(eq(t.organizationMemberships.orgId, ctx.orgId)).orderBy(asc(t.users.name), asc(t.users.email));
  const scopes = await tx.select().from(t.membershipEntityScopes).where(eq(t.membershipEntityScopes.orgId, ctx.orgId)).orderBy(asc(t.membershipEntityScopes.entityId));
  const inviterIds = [...new Set(ms.map((x) => x.m.invitedBy).filter((x): x is string => !!x))];
  const inviters = new Map(inviterIds.length ? (await tx.select({ id: t.users.id, name: t.users.name }).from(t.users).where(inArray(t.users.id, inviterIds))).map((u) => [u.id, u.name]) : []);
  const ents = org.kind === "merchant" ? await tx.select({ id: t.merchantEntities.id, name: t.merchantEntities.name }).from(t.merchantEntities).where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id)) : [];
  const keys = await passkeysOf(tx, [...new Set(ms.map((x) => x.m.userId))]);
  return {
    organisation: { id: org.id, name: org.name, kind: org.kind === "provider" ? "provider" : "merchant" },
    generatedAt: stampNow().toISOString(), entities: ents,
    rows: ms.map(({ m, name, email, lastSignInAt, mfa }) => ({
      userId: m.userId, name, email, role: m.role, roleLabel: isAppRole(m.role) ? ROLE_LABELS[m.role] : m.role, status: m.revokedAt ? "revoked" : "active",
      entityScope: m.entityScoped ? scopes.filter((s) => s.userId === m.userId).map((s) => s.entityId) : "all",
      mfa: mfa ? "enabled" : "not_enabled", passkeys: keys.get(m.userId) ?? 0,
      grantedAt: m.createdAt.toISOString(), revokedAt: m.revokedAt?.toISOString() ?? null, lastSignInAt: lastSignInAt?.toISOString() ?? null,
      invitedBy: m.invitedBy ? inviters.get(m.invitedBy) ?? "A former user" : null,
    })),
  };
}

export async function accessReview(ctx: TenantContext): Promise<AccessReview> {
  requireReviewer(ctx);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => load(tx, ctx), { read: true });
}

export const MFA_LABEL: Record<MfaStatus, string> = { enabled: "On", not_enabled: "Off" };
export const scopeLabel = (s: AccessReviewRow["entityScope"]) => (s === "all" ? "All entities" : s.length ? s.join(", ") : "No entity");
export const invitedLabel = (s: string | null) => s ?? "Operator (admin command)";

const HEADER = ["name", "email", "role", "status", "entity_scope", "second_factor", "passkeys", "access_granted_at", "access_revoked_at", "last_sign_in_at", "invited_by"];
const cells = (r: AccessReviewRow) => [r.name, r.email, r.roleLabel, r.status, scopeLabel(r.entityScope), MFA_LABEL[r.mfa], String(r.passkeys), r.grantedAt, r.revokedAt ?? "", r.lastSignInAt ?? "never recorded", invitedLabel(r.invitedBy)];

export function accessReviewCsv(v: AccessReview): string {
  const meta = [["organisation", v.organisation.name], ["generated_at", v.generatedAt], ["members", String(v.rows.length)], ["second_factor", "authenticator app (users.two_factor_enabled); passkeys counted apart"]];
  return [...meta, [], HEADER, ...v.rows.map(cells)].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function accessReviewPdf(v: AccessReview): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`Access review — ${winAnsi(v.organisation.name)}`);
  doc.setProducer("Clearline");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36; // A4 landscape: the table needs the width
  let page = doc.addPage([W, H]);
  let y = H - M;
  const footer = () => page.drawText(winAnsi(`Access review of ${v.organisation.name} · generated ${v.generatedAt} · read-only · powered by Clearline`), { x: M, y: 18, size: 7, font, color: rgb(0.34, 0.32, 0.29) });
  footer();
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; footer(); };
  const text = (s: string, o: { size?: number; b?: boolean } = {}) => {
    if (y < M + 20) newPage();
    page.drawText(winAnsi(s), { x: M, y, size: o.size ?? 9, font: o.b ? bold : font, color: rgb(0.08, 0.08, 0.08) });
    y -= (o.size ?? 9) + 5;
  };
  text(`Access review — ${v.organisation.name}`, { size: 15, b: true });
  text(`Generated ${v.generatedAt}. ${v.rows.length} membership(s). Second factor: authenticator app On/Off, passkeys counted apart.`);
  y -= 6;
  // columns: name+email, role, status, scope, 2FA, granted, last sign-in, invited by
  const COLS = [{ h: "Member", w: 190 }, { h: "Role", w: 80 }, { h: "Status", w: 48 }, { h: "Entity scope", w: 120 }, { h: "2nd factor", w: 54 }, { h: "Granted", w: 74 }, { h: "Last sign-in", w: 74 }, { h: "Invited by", w: 130 }];
  // a cell longer than its column is cut and ends in "..." (the CSV has every value in full)
  const fit = (s: string, w: number, f = font, size = 8) => {
    let x = winAnsi(s);
    if (f.widthOfTextAtSize(x, size) <= w - 4) return x;
    while (x.length > 1 && f.widthOfTextAtSize(`${x}...`, size) > w - 4) x = x.slice(0, -1);
    return `${x}...`;
  };
  const row = (vals: string[], b = false) => {
    if (y < M + 24) { newPage(); row(COLS.map((c) => c.h), true); }
    let x = M;
    vals.forEach((val, i) => { page.drawText(fit(val, COLS[i].w, b ? bold : font), { x, y, size: 8, font: b ? bold : font, color: rgb(0.08, 0.08, 0.08) }); x += COLS[i].w; });
    y -= 13;
  };
  row(COLS.map((c) => c.h), true);
  for (const r of v.rows) {
    row([`${r.name} <${r.email}>`, r.roleLabel, r.status, scopeLabel(r.entityScope), `${MFA_LABEL[r.mfa]}${r.passkeys ? ` +${r.passkeys} passkey${r.passkeys === 1 ? "" : "s"}` : ""}`, r.grantedAt.slice(0, 10), r.lastSignInAt?.slice(0, 16).replace("T", " ") ?? "never recorded", invitedLabel(r.invitedBy)]);
  }
  return doc.save({ useObjectStreams: false });
}

export const ReviewFormat = z.enum(["csv", "pdf"]);
const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The review as a file for an auditor. Audited (format, hash, number of memberships; no names or emails). */
export async function accessReviewExport(ctx: TenantContext, format: z.input<typeof ReviewFormat>) {
  requireReviewer(ctx);
  const f = ReviewFormat.parse(format);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const v = await load(tx, ctx);
    const body = f === "csv" ? accessReviewCsv(v) : await accessReviewPdf(v);
    const digest = sha256(body);
    await serverAudit(tx, ctx, "access_review_exported", "organization", ctx.orgId, `Access review exported (${f}, ${v.rows.length} membership(s), sha256 ${digest.slice(0, 12)}…)`, { format: f, memberships: v.rows.length, sha256: digest });
    const day = v.generatedAt.slice(0, 10);
    return { body, sha256: digest, fileName: `clearline-access-review-${ctx.orgSlug}-${day}.${f}`, contentType: f === "csv" ? "text/csv; charset=utf-8" : "application/pdf" };
  });
}
