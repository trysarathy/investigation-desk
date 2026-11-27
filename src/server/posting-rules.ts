import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { postingRulesCatalogue } from "@/lib/clearline/merchant/posting-rules";
import { STEP_UP_SECONDS } from "./auth-constants";
import type { SessionInfo } from "./auth";
import { can } from "./authz";
import { serverAudit } from "./control";
import * as t from "./db/schema";
import { RequestRefused } from "./errors";
import { AccessDenied, requireUnscoped, type TenantContext, withTenant } from "./tenant";

/**
 * v1 phase 4: the merchant Admin's sign-off of the posting rules (drizzle/0077, was 0066). Signing records who signed which
 * version, when, after which second-factor proof; the signed catalogue is stored with the signature (locked). It
 * approves no journal and posts nothing.
 */

/**
 * CONTRACT (used by the ledger integration before it may send anything to a ledger): true only when the newest
 * unrevoked signature of the organisation is for the CURRENT catalogue version. Fail closed: no row, a revoked
 * signature, an older version (the rules changed since: a new version needs a new signature), a missing table,
 * column or grant, or any error → false. `userId`, when given, reads as that member (row-level security); without it,
 * only the organisation is set (a background job).
 */
export async function postingRulesSigned(orgId: string, userId?: string): Promise<boolean> {
  try {
    const current = postingRulesCatalogue().version;
    const [row] = await withTenant({ userId: userId ?? "", orgId }, (tx) => tx.select({ version: t.postingRulesSignatures.version }).from(t.postingRulesSignatures)
      .where(and(eq(t.postingRulesSignatures.orgId, orgId), isNull(t.postingRulesSignatures.revokedAt))).orderBy(desc(t.postingRulesSignatures.signedAt)).limit(1), { read: true });
    return row?.version === current;
  } catch {
    return false;
  }
}

/** What the sign-off page shows: the current version, the standing signature (if any) and the history. */
export async function postingRulesStatus(ctx: TenantContext) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const cat = postingRulesCatalogue();
  const rows = await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => tx.select({
    id: t.postingRulesSignatures.id, version: t.postingRulesSignatures.version, sha256: t.postingRulesSignatures.versionSha256, signedBy: t.postingRulesSignatures.signedByName,
    signedByUserId: t.postingRulesSignatures.signedByUserId, signedAt: t.postingRulesSignatures.signedAt, revokedAt: t.postingRulesSignatures.revokedAt, revokedReason: t.postingRulesSignatures.revokedReason,
  }).from(t.postingRulesSignatures).where(eq(t.postingRulesSignatures.orgId, ctx.orgId)).orderBy(desc(t.postingRulesSignatures.signedAt)), { read: true });
  const standing = rows.find((r) => !r.revokedAt) ?? null;
  return {
    catalogue: cat,
    signed: standing?.version === cat.version,
    standing: standing ? { ...standing, signedAt: standing.signedAt.toISOString(), current: standing.version === cat.version } : null,
    history: rows.map((r) => ({ ...r, signedAt: r.signedAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null })),
  };
}

/** The signing step-up: a SECOND FACTOR proved in this session in the last 10 minutes (a password alone never counts). */
function assertFreshMfa(s: SessionInfo, now = Date.now()): Date {
  if (!s.mfaEnrolled || !s.mfaVerifiedAt || now - s.mfaVerifiedAt.getTime() > STEP_UP_SECONDS * 1000) {
    throw new RequestRefused(403, "MFA_STEP_UP_REQUIRED", "Confirm your authenticator code (or a passkey) just before you sign. A password is not enough.");
  }
  return s.mfaVerifiedAt;
}

function requireSigner(ctx: TenantContext, s: SessionInfo) {
  if (!can(ctx.role, "sign_posting_rules")) throw new AccessDenied(403, "Only an Admin of the organisation signs the posting rules.");
  if (s.principal.userId !== ctx.userId) throw new AccessDenied(403, "Session mismatch.");
  requireUnscoped(ctx);
  return assertFreshMfa(s);
}

export const SignInput = z.object({ version: z.string().regex(/^PR-[0-9a-f]{12}$/), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const RevokeInput = z.object({ signatureId: z.uuid(), reason: z.string().trim().min(1).max(500) }).strict();

/** The Admin signs the version they were shown. A version that changed since is refused (they must read the new one). */
export async function signPostingRules(ctx: TenantContext, s: SessionInfo, raw: unknown) {
  const mfaAt = requireSigner(ctx, s);
  const input = SignInput.safeParse(raw);
  if (!input.success) throw new RequestRefused(422, "BAD_SIGNATURE_INPUT", "Give the version and its SHA-256 as shown.");
  const cat = postingRulesCatalogue();
  if (input.data.version !== cat.version || input.data.sha256 !== cat.sha256) throw new RequestRefused(409, "VERSION_CHANGED", `The posting rules are now version ${cat.version}. Reload the page, read it and sign that version.`);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [dup] = await tx.select({ id: t.postingRulesSignatures.id }).from(t.postingRulesSignatures)
      .where(and(eq(t.postingRulesSignatures.orgId, ctx.orgId), eq(t.postingRulesSignatures.version, cat.version), isNull(t.postingRulesSignatures.revokedAt)));
    if (dup) throw new RequestRefused(409, "ALREADY_SIGNED", `Version ${cat.version} is already signed.`);
    const [row] = await tx.insert(t.postingRulesSignatures).values({
      orgId: ctx.orgId, version: cat.version, versionSha256: cat.sha256, catalogue: cat, signedByUserId: ctx.userId, signedByName: ctx.name, mfaVerifiedAt: mfaAt,
    }).returning({ id: t.postingRulesSignatures.id, signedAt: t.postingRulesSignatures.signedAt });
    await serverAudit(tx, ctx, "posting_rules_signed", "posting_rules", row.id, `Posting rules ${cat.version} signed by an Admin after a second-factor step-up (${cat.patterns.length} patterns)`,
      { version: cat.version, sha256: cat.sha256, signatureId: row.id });
    return { signatureId: row.id, version: cat.version, sha256: cat.sha256, signedAt: row.signedAt.toISOString(), signedBy: ctx.name };
  });
}

/** An Admin withdraws a signature (fresh second factor, a reason). Until a version is signed again, journals stay drafts. */
export async function revokePostingRulesSignature(ctx: TenantContext, s: SessionInfo, raw: unknown) {
  requireSigner(ctx, s);
  const input = RevokeInput.safeParse(raw);
  if (!input.success) throw new RequestRefused(422, "BAD_REVOKE_INPUT", "Give the signature and a reason.");
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const done = await tx.update(t.postingRulesSignatures).set({ revokedAt: new Date(), revokedByUserId: ctx.userId, revokedReason: input.data.reason })
      .where(and(eq(t.postingRulesSignatures.orgId, ctx.orgId), eq(t.postingRulesSignatures.id, input.data.signatureId), isNull(t.postingRulesSignatures.revokedAt)))
      .returning({ id: t.postingRulesSignatures.id, version: t.postingRulesSignatures.version });
    if (done.length !== 1) throw new AccessDenied(404, "Not found.");
    await serverAudit(tx, ctx, "posting_rules_signature_revoked", "posting_rules", done[0].id, `Posting rules ${done[0].version} signature revoked by an Admin`, { version: done[0].version, signatureId: done[0].id });
    return { signatureId: done[0].id, revoked: true };
  });
}

/** How a journal is labelled while the rules are, or are not, signed (never "posted": this build posts nothing). */
export function journalSignOffLabel(signed: boolean, requiresApprovalOf?: string | null): string {
  if (!signed) return "Draft: posting rules not signed";
  return requiresApprovalOf ? `Pending approval (${requiresApprovalOf}); rules signed` : "Proposal; rules signed; not posted";
}
