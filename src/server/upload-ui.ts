import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { DEFAULT_RETENTION_DAYS, listUploads, uploadPreview } from "./uploads";
import { dataModeOf } from "./mapping-templates";

/**
 * rc7 read models behind the upload screens (/control/merchant/uploads/**): the uploads with their uploaders' names,
 * the entities and their active bank accounts, the retention setting, and one upload's preview. Reads only, through the same RLS-scoped services;
 * no cell value is stored or logged here (the preview is served to the merchant's own members only).
 */

const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });

async function names(tx: Tx, orgId: string): Promise<Map<string, string>> {
  const rows = await tx.select({ userId: t.users.id, name: t.users.name }).from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
    .where(and(eq(t.organizationMemberships.orgId, orgId), isNull(t.organizationMemberships.revokedAt))).orderBy(asc(t.users.name));
  return new Map(rows.map((r) => [r.userId, r.name]));
}

export async function uploadsOverview(ctx: TenantContext) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, "Not allowed.");
  const { uploads } = await listUploads(ctx);
  return tenantRead(ctx, async (tx) => {
    const who = await names(tx, ctx.orgId);
    const [s] = await tx.select({ d: t.merchantDataSettings.retentionDays }).from(t.merchantDataSettings).where(eq(t.merchantDataSettings.orgId, ctx.orgId));
    const ents = await tx.select({ id: t.merchantEntities.id, name: t.merchantEntities.name, currency: t.merchantEntities.functionalCurrency }).from(t.merchantEntities)
      .where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id));
    const accounts = await tx.select({ id: t.bankAccounts.id, entityId: t.bankAccounts.entityId, displayName: t.bankAccounts.displayName, accountLast4: t.bankAccounts.accountLast4, currency: t.bankAccounts.currency })
      .from(t.bankAccounts).where(and(eq(t.bankAccounts.orgId, ctx.orgId), eq(t.bankAccounts.status, "active"))).orderBy(asc(t.bankAccounts.entityId), asc(t.bankAccounts.displayName));
    return {
      ...(await dataModeOf(tx, ctx.orgId)), entities: ents, bankAccounts: accounts, retentionDays: s?.d ?? DEFAULT_RETENTION_DAYS,
      uploads: uploads.slice().reverse().map((u) => ({ ...u, uploadedByName: who.get(u.uploadedBy) ?? "A former member", confirmedByName: u.confirmedBy ? who.get(u.confirmedBy) ?? "A former member" : null })),
    };
  });
}

/** One upload with its preview and mapping suggestions, the entity and the people involved. */
export async function uploadWorkspace(ctx: TenantContext, id: string) {
  const p = await uploadPreview(ctx, id);
  return tenantRead(ctx, async (tx) => {
    const who = await names(tx, ctx.orgId);
    const [ent] = await tx.select({ id: t.merchantEntities.id, name: t.merchantEntities.name, currency: t.merchantEntities.functionalCurrency }).from(t.merchantEntities)
      .where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, p.upload.entityId)));
    const [acct] = p.upload.bankAccountId ? await tx.select({ id: t.bankAccounts.id, displayName: t.bankAccounts.displayName, accountLast4: t.bankAccounts.accountLast4, currency: t.bankAccounts.currency, status: t.bankAccounts.status })
      .from(t.bankAccounts).where(and(eq(t.bankAccounts.orgId, ctx.orgId), eq(t.bankAccounts.id, p.upload.bankAccountId))) : [];
    const tpl = p.upload.templateId ? (await tx.select({ name: t.mappingTemplates.name }).from(t.mappingTemplates).where(and(eq(t.mappingTemplates.orgId, ctx.orgId), eq(t.mappingTemplates.id, p.upload.templateId))))[0] : undefined;
    return {
      ...p, entity: ent ?? { id: p.upload.entityId, name: p.upload.entityId, currency: "" }, templateName: tpl?.name ?? null, bankAccount: acct ?? null,
      uploadedByName: who.get(p.upload.uploadedBy) ?? "A former member", confirmedByName: p.upload.confirmedBy ? who.get(p.upload.confirmedBy) ?? "A former member" : null,
    };
  });
}
