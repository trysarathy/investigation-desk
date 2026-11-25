import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { BANK_EVIDENCE_SHORT, localDate, type BankEvidenceLevel } from "@/lib/clearline/merchant";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { packData, partsOf, renderPack, type PackFormat, type PackScope } from "./merchant-ui";
import { AccessDenied, requireEntity, type AuditGrant, type TenantContext, withTenant } from "./tenant";

/**
 * v1 phase 4: the Auditor. Read-only; one granted period of whole months (and optionally some entities: the membership's
 * entity scope); until the grant expires. It lists the period's payments and downloads evidence packs per payment and
 * per entity-month of the period, nothing else: every other service refuses the role (it holds no "read" permission),
 * and the database refuses every write and every row outside the period (drizzle/0067). Each listing and download is
 * audited with ids, the grant, the format and the file's SHA-256.
 */
function grantOf(ctx: TenantContext): AuditGrant {
  if (!can(ctx.role, "audit_download") || !ctx.audit) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  if (Date.parse(ctx.audit.expiresAt) <= Date.now()) throw new AccessDenied(403, "Your auditor access has ended.");
  return ctx.audit;
}

/** The months of an order as the evidence pack counts them: its transfers' local dates, else its invoice's issue date. */
function monthsOf(m: typeof t.matchRecords.$inferSelect, issuedAt: Date, utcOffsetMinutes: number): string[] {
  const ts = partsOf(m).chain.transfers.map((x) => localDate(x.timestamp, utcOffsetMinutes).slice(0, 7));
  return ts.length ? [...new Set(ts)] : [issuedAt.toISOString().slice(0, 7)];
}

async function periodPayments(tx: Tx, ctx: TenantContext, g: AuditGrant) {
  const ents = await tx.select().from(t.merchantEntities).where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id));
  const off = new Map(ents.map((e) => [e.id, e.utcOffsetMinutes]));
  const rows = await tx.select({ m: t.matchRecords, inv: t.invoices }).from(t.matchRecords)
    .innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
    .where(eq(t.matchRecords.orgId, ctx.orgId)).orderBy(asc(t.matchRecords.orderId));
  const payments = rows.map(({ m, inv }) => ({ orderId: m.orderId, entityId: inv.entityId, months: monthsOf(m, inv.issuedAt, off.get(inv.entityId) ?? 0), decision: m.decision,
    bankEvidence: BANK_EVIDENCE_SHORT[m.bankEvidence as BankEvidenceLevel] ?? m.bankEvidence, settled: m.settled }))
    .filter((p) => p.months.some((x) => g.months.includes(x)));
  return { entities: ents.map((e) => ({ id: e.id, name: e.name, currency: e.functionalCurrency })), payments };
}

/** The Auditor's page: the grant, the entities it may see and the period's payments (audited). */
export async function auditorView(ctx: TenantContext) {
  const g = grantOf(ctx);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const v = await periodPayments(tx, ctx, g);
    await serverAudit(tx, ctx, "auditor_period_viewed", "auditor_grant", g.grantId, `Auditor listed the period ${g.periodStart}..${g.periodEnd}: ${v.payments.length} payment(s)`, { grantId: g.grantId, payments: v.payments.length });
    return { grant: g, ...v };
  });
}

/** An evidence pack of the granted period: one payment, or one entity-month. Anything outside it is "not found". */
export async function auditorEvidencePack(ctx: TenantContext, scope: PackScope, format: z.infer<typeof PackFormat>) {
  const g = grantOf(ctx);
  if (scope.kind === "month") {
    if (!/^\d{4}-\d{2}$/.test(scope.month)) throw new RequestRefused(422, "BAD_MONTH", "Use YYYY-MM.");
    if (!g.months.includes(scope.month)) throw new AccessDenied(404, "Not found.");
    requireEntity(ctx, scope.entityId);
  }
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    if (scope.kind === "payment") {
      const { payments } = await periodPayments(tx, ctx, g);
      if (!payments.some((p) => p.orderId === scope.orderId)) throw new AccessDenied(404, "Not found.");
    }
    const p = await packData(tx, ctx, scope);
    const body = await renderPack(p, format);
    const digest = createHash("sha256").update(body).digest("hex");
    const id = scope.kind === "payment" ? scope.orderId : `${scope.entityId}-${scope.month}`;
    await serverAudit(tx, ctx, "auditor_evidence_pack_downloaded", scope.kind === "payment" ? "payment" : "merchant_entity", scope.kind === "payment" ? scope.orderId : scope.entityId,
      `Auditor downloaded an evidence pack (${format}, ${id}, sha256 ${digest.slice(0, 12)}…)`, { grantId: g.grantId, sha256: digest, format, scope });
    return { body, sha256: digest, fileName: `clearline-audit-evidence-${ctx.orgSlug}-${id.replace(/[^A-Za-z0-9_-]/g, "")}.${format}`,
      contentType: format === "json" ? "application/json; charset=utf-8" : format === "csv" ? "text/csv; charset=utf-8" : "application/pdf" };
  });
}
