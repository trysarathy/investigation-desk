import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import * as t from "./db/schema";
import { can } from "./authz";
import { inEntityScope, withTenant, type TenantContext } from "./tenant";

/** At most this many results per kind. */
export const PALETTE_LIMIT = 8;

const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * v1 design-fluid command palette search: payment references (order ids), exception ids and settlement batch ids that
 * contain the query, for the signed-in member's own organisation only. It runs in the same RLS-scoped read transaction
 * as every merchant read (withTenant, read) with the organisation filter as well, applies the member's entity scope,
 * and needs the "read" permission; an Auditor (one page of its own) gets nothing.
 */
export async function paletteSearch(ctx: TenantContext, query: string): Promise<{ payments: string[]; exceptions: string[]; batches: string[] }> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2 || !can(ctx.role, "read") || can(ctx.role, "audit_download")) return { payments: [], exceptions: [], batches: [] };
  const pattern = `%${likeEscape(q)}%`;
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const inv = await tx.select({ id: t.invoices.orderId, entityId: t.invoices.entityId }).from(t.invoices)
      .where(and(eq(t.invoices.orgId, ctx.orgId), sql`${t.invoices.orderId} ilike ${pattern}`)).orderBy(asc(t.invoices.orderId)).limit(PALETTE_LIMIT * 4);
    const ex = await tx.select({ id: t.reconExceptions.id, entityId: t.reconExceptions.entityId }).from(t.reconExceptions)
      .where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.id} ilike ${pattern}`)).orderBy(asc(t.reconExceptions.id)).limit(PALETTE_LIMIT * 4);
    const bt = await tx.select({ id: t.settlementBatches.batchId, entityId: t.settlementBatches.entityId }).from(t.settlementBatches)
      .where(and(eq(t.settlementBatches.orgId, ctx.orgId), sql`${t.settlementBatches.batchId} ilike ${pattern}`)).orderBy(asc(t.settlementBatches.batchId)).limit(PALETTE_LIMIT * 4);
    const pick = (rows: { id: string; entityId: string | null }[], needEntity: boolean) =>
      rows.filter((r) => (needEntity && !r.entityId ? false : inEntityScope(ctx, r.entityId))).map((r) => r.id).slice(0, PALETTE_LIMIT);
    return { payments: pick(inv, true), exceptions: pick(ex, false), batches: pick(bt, true) };
  }, { read: true });
}
