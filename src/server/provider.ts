import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TEST_MODE_LABEL } from "@/lib/clearline/merchant";
import { ProviderMapping } from "@/lib/clearline/merchant/adapters";
import { addExceptionRateCounts, exceptionRate, type ExceptionRateCounts } from "@/lib/clearline/merchant/exception-rate";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { providerConsole } from "./merchant";
import { AccessDenied, requireUnscoped, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { stampNow } from "./live-clock";

/**
 * rc6 phase 8: the provider console (Provider Admin, Provider Ops) and the merchant-side settings it relies on.
 * A provider sees its merchants' AGGREGATES only (SECURITY DEFINER functions); a merchant's rows only under that
 * merchant's explicit, unrevoked full grant (RLS). Onboarding is configuration only: a column mapping stored as JSON,
 * proposed policy defaults (the merchant's own Admin sets the policy) and invitation records (no email is sent).
 * Test mode · illustrative data.
 */

const LABEL = TEST_MODE_LABEL;
function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null);

/**
 * v1 phase 0: the counts behind "exceptions per 100" for each of the provider's merchants (aggregates only, the
 * SECURITY DEFINER function of migration 0035), keyed by merchant. The rate itself is exception-rate.ts.
 */
interface RateRow { merchant_org_id: string; reconciled_payments: number; open_exceptions: number; open_batch_not_tied: number; open_on_unpaid: number; open_without_payment: number }
async function exceptionRateCountsByMerchant(tx: Tx, providerOrgId: string): Promise<Map<string, ExceptionRateCounts>> {
  const r = await tx.execute(sql`select merchant_org_id, reconciled_payments::int, open_exceptions::int, open_batch_not_tied::int, open_on_unpaid::int, open_without_payment::int from provider_exception_rate(${providerOrgId})`);
  return new Map((r.rows as unknown as RateRow[]).map((x) => [x.merchant_org_id, {
    reconciledPayments: x.reconciled_payments, openExceptions: x.open_exceptions, openBatchNotTied: x.open_batch_not_tied, openOnUnpaid: x.open_on_unpaid, openWithoutPayment: x.open_without_payment,
  }]));
}
const NO_COUNTS: ExceptionRateCounts = { reconciledPayments: 0, openExceptions: 0, openBatchNotTied: 0, openOnUnpaid: 0, openWithoutPayment: 0 };

// ---------------------------------------------------------------------------------------------
// Screen 10: merchants with health (aggregates only)
// ---------------------------------------------------------------------------------------------

/** "Exceptions per 100" (still open, per 100 reconciled payments; null = not measured) and its counts, batch not tied apart. */
const rateFields = (c: ExceptionRateCounts) => { const r = exceptionRate(c); return { exceptionsPer100: r.per100, exceptionRate: r }; };

interface HealthRow { merchant_org_id: string; merchant_name: string; payments: number; auto_matched: number; exceptions_open: number; oldest_open_exception_at: string | Date | null; last_ingestion_at: string | Date | null; grant_scope: string }
const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

export async function providerMerchants(ctx: TenantContext) {
  const c = await providerConsole(ctx);
  const rates = await tenantRead(ctx, (tx) => exceptionRateCountsByMerchant(tx, ctx.orgId));
  return {
    label: LABEL, provider: c.provider, theme: c.theme,
    merchants: (c.merchants as unknown as HealthRow[]).map((m) => ({
      merchantOrgId: m.merchant_org_id, name: m.merchant_name, payments: m.payments, autoMatched: m.auto_matched,
      autoMatchRatePct: pct(m.auto_matched, m.payments), exceptionsOpen: m.exceptions_open, ...rateFields(rates.get(m.merchant_org_id) ?? NO_COUNTS),
      oldestOpenExceptionAt: iso(m.oldest_open_exception_at), lastIngestionAt: iso(m.last_ingestion_at), grantScope: m.grant_scope === "full" ? "full" as const : "aggregates" as const,
    })),
  };
}

/**
 * A merchant's payment rows, ONLY under that merchant's explicit full grant to this provider (checked here and,
 * independently, by RLS: provider_full_grant_read). Without one the answer is a refusal, never rows.
 */
export async function providerMerchantPayments(ctx: TenantContext, merchantOrgId: string) {
  require(ctx, "provider_console");
  if (!z.uuid().safeParse(merchantOrgId).success) throw new AccessDenied(404, "Not found.");
  const m = (await providerMerchants(ctx)).merchants.find((x) => x.merchantOrgId === merchantOrgId);
  if (!m) throw new AccessDenied(404, "Not found.");
  if (m.grantScope !== "full") throw new AccessDenied(403, "This merchant has not granted your organisation full access. You see its aggregates only.");
  return tenantRead(ctx, async (tx) => {
    const rows = await tx.select({ orderId: t.matchRecords.orderId, decision: t.matchRecords.decision, ruleId: t.matchRecords.ruleId, computedAt: t.matchRecords.computedAt })
      .from(t.matchRecords).where(eq(t.matchRecords.orgId, merchantOrgId)).orderBy(asc(t.matchRecords.orderId));
    return { label: LABEL, merchant: { id: m.merchantOrgId, name: m.name }, grantScope: m.grantScope, payments: rows.map((r) => ({ ...r, computedAt: r.computedAt.toISOString() })) };
  });
}

// ---------------------------------------------------------------------------------------------
// Screen 12 (provider side): pilot metrics as aggregates
// ---------------------------------------------------------------------------------------------

interface PilotRow { merchant_org_id: string; merchant_name: string; payments: number; auto_matched: number; reviewed: number; reviewed_wrong: number; exceptions_total: number; exceptions_open: number; median_minutes_to_resolve: number | null; batches: number; batches_tied: number; minutes_logged: number }

export async function providerPilotMetrics(ctx: TenantContext) {
  require(ctx, "provider_console");
  return tenantRead(ctx, async (tx) => {
    const r = await tx.execute(sql`select merchant_org_id, merchant_name, payments::int, auto_matched::int, reviewed::int, reviewed_wrong::int, exceptions_total::int, exceptions_open::int,
      median_minutes_to_resolve, batches::int, batches_tied::int, minutes_logged::int from provider_pilot_metrics(${ctx.orgId}) order by merchant_name`);
    const rates = await exceptionRateCountsByMerchant(tx, ctx.orgId);
    const rows = (r.rows as unknown as PilotRow[]).map((m) => ({
      merchantOrgId: m.merchant_org_id, name: m.merchant_name, payments: m.payments, autoMatchedPct: pct(m.auto_matched, m.payments),
      reviewed: m.reviewed, reviewedWrong: m.reviewed_wrong, exceptionsOpen: m.exceptions_open, exceptionsOpened: m.exceptions_total, ...rateFields(rates.get(m.merchant_org_id) ?? NO_COUNTS),
      medianMinutesToResolve: m.median_minutes_to_resolve === null ? null : Math.round(Number(m.median_minutes_to_resolve) * 10) / 10,
      batches: m.batches, batchesTied: m.batches_tied, minutesLogged: m.minutes_logged,
    }));
    const sum = (k: "payments" | "reviewed" | "reviewedWrong" | "batches" | "batchesTied" | "minutesLogged") => rows.reduce((a, x) => a + x[k], 0);
    const auto = (r.rows as unknown as PilotRow[]).reduce((a, x) => a + x.auto_matched, 0);
    // the total rate is recomputed from the added counts, never averaged across merchants
    const total = rateFields(addExceptionRateCounts(rows.map((x) => x.exceptionRate)));
    return {
      label: LABEL, merchants: rows,
      total: { payments: sum("payments"), autoMatchedPct: pct(auto, sum("payments")), reviewed: sum("reviewed"), reviewedWrong: sum("reviewedWrong"), ...total, batches: sum("batches"), batchesTied: sum("batchesTied"), minutesLogged: sum("minutesLogged") },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Screen 11: onboarding (column mapping, proposed policy defaults, invitations); theme preview reads the provider's theme
// ---------------------------------------------------------------------------------------------

export const PolicyDefaults = z.object({
  toleranceBps: z.number().int().min(0).max(1000),
  toleranceAbsMinor: z.string().regex(/^\d{1,15}$/),
  writeoffThresholdMinor: z.string().regex(/^\d{1,15}$/),
  allowImportedBankLinesAsVerified: z.boolean(),
}).strict();
export const MappingInput = z.object({ mapping: z.unknown(), expectedRevision: z.number().int().min(0) }).strict();
export const DefaultsInput = z.object({ defaults: PolicyDefaults, expectedRevision: z.number().int().min(0) }).strict();
export const MERCHANT_ROLES = ["admin", "payment_ops", "finance", "approver", "viewer"] as const;
/**
 * A provider may invite only the read-only Viewer role. Any role with authority at the merchant (Admin, Payment Ops,
 * Finance, Approver) is granted by the merchant's own Admin, so a provider can never place a person in a merchant's
 * approval chain (rc6 integration review). Enforced again by the database (migration 0014).
 */
export const PROVIDER_INVITABLE_ROLES = ["viewer"] as const;
export const InvitationInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(PROVIDER_INVITABLE_ROLES) }).strict();

export async function onboardingView(ctx: TenantContext) {
  const merchants = (await providerMerchants(ctx)).merchants;
  return tenantRead(ctx, async (tx) => {
    const ob = await tx.select().from(t.merchantOnboarding).where(eq(t.merchantOnboarding.orgId, ctx.orgId));
    const inv = await tx.select().from(t.merchantInvitations).where(eq(t.merchantInvitations.orgId, ctx.orgId)).orderBy(desc(t.merchantInvitations.createdAt));
    return {
      label: LABEL,
      merchants: merchants.map((m) => {
        const o = ob.find((x) => x.merchantOrgId === m.merchantOrgId);
        return {
          merchantOrgId: m.merchantOrgId, name: m.name, revision: o?.revision ?? 0, columnMapping: o?.columnMapping ?? null, policyDefaults: (o?.policyDefaults ?? null) as z.infer<typeof PolicyDefaults> | null,
          updatedAt: o?.updatedAt.toISOString() ?? null,
          invitations: inv.filter((i) => i.merchantOrgId === m.merchantOrgId).map((i) => ({ id: i.id, email: i.email, role: i.role, status: i.status, createdAt: i.createdAt.toISOString() })),
        };
      }),
    };
  });
}

async function ownMerchant(ctx: TenantContext, merchantOrgId: string) {
  if (!z.uuid().safeParse(merchantOrgId).success) throw new AccessDenied(404, "Not found.");
  const m = (await providerMerchants(ctx)).merchants.find((x) => x.merchantOrgId === merchantOrgId);
  if (!m) throw new AccessDenied(404, "Not found.");
  return m;
}

async function saveOnboarding(tx: Tx, ctx: TenantContext, merchantOrgId: string, expectedRevision: number, set: { columnMapping?: unknown; policyDefaults?: unknown }) {
  if (expectedRevision === 0) {
    const r = await tx.insert(t.merchantOnboarding).values({ orgId: ctx.orgId, merchantOrgId, ...set, revision: 1, updatedBy: ctx.userId }).onConflictDoNothing().returning({ revision: t.merchantOnboarding.revision });
    if (!r.length) throw new RequestRefused(409, "STALE_ONBOARDING", "The onboarding changed since you read it. Reload and try again.");
    return r[0].revision;
  }
  const r = await tx.update(t.merchantOnboarding).set({ ...set, revision: expectedRevision + 1, updatedBy: ctx.userId, updatedAt: stampNow() })
    .where(and(eq(t.merchantOnboarding.orgId, ctx.orgId), eq(t.merchantOnboarding.merchantOrgId, merchantOrgId), eq(t.merchantOnboarding.revision, expectedRevision))).returning({ revision: t.merchantOnboarding.revision });
  if (!r.length) throw new RequestRefused(409, "STALE_ONBOARDING", "The onboarding changed since you read it. Reload and try again.");
  return r[0].revision;
}

/** "Connect exports": a column mapping validated against the provider-export adapter's schema. Nothing connects live. */
export async function saveColumnMapping(ctx: TenantContext, merchantOrgId: string, input: z.input<typeof MappingInput>, idempotencyKey: string) {
  require(ctx, "provider_manage");
  const v = MappingInput.parse(input);
  const parsed = ProviderMapping.safeParse(v.mapping);
  if (!parsed.success) throw new RequestRefused(422, "INVALID_MAPPING", `The column mapping is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "mapping"}: ${i.message}`).join("; ")}`);
  const key = IdempotencyKey.parse(idempotencyKey);
  const m = await ownMerchant(ctx, merchantOrgId);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_mapping", merchantOrgId, mapping: parsed.data, expectedRevision: v.expectedRevision }, async () => {
    const revision = await saveOnboarding(tx, ctx, merchantOrgId, v.expectedRevision, { columnMapping: parsed.data });
    await serverAudit(tx, ctx, "provider_column_mapping_saved", "merchant", merchantOrgId, `Column mapping for ${m.name} saved (${Object.keys(parsed.data.columns).length} columns, revision ${revision}); configuration only, nothing connected`, { revision });
    return { status: 200, body: { label: LABEL, merchantOrgId, revision, columns: Object.keys(parsed.data.columns).length } };
  }));
}

/** Proposed matching-policy defaults: a proposal the merchant's own Admin may adopt; the provider never sets the policy. */
export async function savePolicyDefaults(ctx: TenantContext, merchantOrgId: string, input: z.input<typeof DefaultsInput>, idempotencyKey: string) {
  require(ctx, "provider_manage");
  const v = DefaultsInput.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  const m = await ownMerchant(ctx, merchantOrgId);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_policy_defaults", merchantOrgId, ...v }, async () => {
    const revision = await saveOnboarding(tx, ctx, merchantOrgId, v.expectedRevision, { policyDefaults: v.defaults });
    await serverAudit(tx, ctx, "provider_policy_defaults_proposed", "merchant", merchantOrgId, `Policy defaults proposed to ${m.name} (revision ${revision}); the merchant's Admin sets the policy`, v.defaults);
    return { status: 200, body: { label: LABEL, merchantOrgId, revision } };
  }));
}

export const acceptInvitationCommand = (id: string) => `CLEARLINE_NEW_PASSWORD=… DATABASE_URL=$DATABASE_OWNER_URL npx tsx --conditions=react-server scripts/control/admin.ts accept-invitation ${id}`;

/** An invitation RECORD only: no email is sent; an operator accepts it with the admin CLI. */
export async function createInvitation(ctx: TenantContext, merchantOrgId: string, input: z.input<typeof InvitationInput>, idempotencyKey: string) {
  require(ctx, "provider_manage");
  const v = InvitationInput.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  const m = await ownMerchant(ctx, merchantOrgId);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_invitation", merchantOrgId, ...v }, async () => {
    const [dup] = await tx.select({ id: t.merchantInvitations.id }).from(t.merchantInvitations).where(and(eq(t.merchantInvitations.orgId, ctx.orgId), eq(t.merchantInvitations.merchantOrgId, merchantOrgId), eq(t.merchantInvitations.email, v.email), eq(t.merchantInvitations.status, "pending")));
    if (dup) throw new RequestRefused(409, "INVITATION_PENDING", "This person already has a pending invitation to this merchant.");
    const [row] = await tx.insert(t.merchantInvitations).values({ orgId: ctx.orgId, merchantOrgId, email: v.email, role: v.role, invitedBy: ctx.userId }).returning({ id: t.merchantInvitations.id });
    await serverAudit(tx, ctx, "provider_invitation_created", "merchant", merchantOrgId, `Invitation recorded for ${v.email} as ${v.role} at ${m.name} (no email sent)`, { id: row.id, role: v.role });
    return { status: 201, body: { label: LABEL, id: row.id, email: v.email, role: v.role, command: acceptInvitationCommand(row.id) } };
  }));
}

// ---------------------------------------------------------------------------------------------
// Merchant side: settings (policy by the merchant's Admin, provider access grant) and the pilot sample
// ---------------------------------------------------------------------------------------------

export async function merchantSettings(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const policies = await tx.select({ p: t.merchantPolicy, name: t.merchantEntities.name, currency: t.merchantEntities.functionalCurrency }).from(t.merchantPolicy)
      .innerJoin(t.merchantEntities, and(eq(t.merchantEntities.orgId, t.merchantPolicy.orgId), eq(t.merchantEntities.id, t.merchantPolicy.entityId)))
      .where(eq(t.merchantPolicy.orgId, ctx.orgId)).orderBy(asc(t.merchantPolicy.entityId));
    const prop = (await tx.execute(sql`select provider_name, policy_defaults, column_mapping, revision, updated_at from merchant_onboarding_proposal()`)).rows[0] as { provider_name: string; policy_defaults: z.infer<typeof PolicyDefaults> | null; column_mapping: { columns?: Record<string, string> } | null; revision: number; updated_at: string | Date } | undefined;
    const [grant] = await tx.select().from(t.providerGrants).where(and(eq(t.providerGrants.merchantOrgId, ctx.orgId), isNull(t.providerGrants.revokedAt)));
    const [org] = await tx.select({ providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    return {
      label: LABEL, hasProvider: !!org?.providerOrgId,
      policies: policies.map(({ p, name, currency }) => ({ entityId: p.entityId, name, currency, toleranceBps: p.toleranceBps, toleranceAbsMinor: p.toleranceAbsMinor.toString(), toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor.toString(), allowImportedBankLinesAsVerified: p.allowImportedBankLinesAsVerified, revision: p.revision, updatedAt: p.updatedAt.toISOString() })),
      proposal: prop ? { providerName: prop.provider_name, policyDefaults: prop.policy_defaults, mappedColumns: prop.column_mapping?.columns ? Object.keys(prop.column_mapping.columns).length : 0, revision: prop.revision } : null,
      grantScope: grant?.scope === "full" ? "full" as const : "aggregates" as const,
    };
  });
}

export const GrantInput = z.object({ scope: z.enum(["full", "aggregates"]) }).strict();

/** The merchant's Admin grants its provider full read access, or takes it back (aggregates only). */
export async function setProviderGrant(ctx: TenantContext, input: z.input<typeof GrantInput>, idempotencyKey: string) {
  require(ctx, "manage_members");
  requireUnscoped(ctx);
  const v = GrantInput.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_grant", ...v }, async () => {
    const [org] = await tx.select({ providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    if (!org?.providerOrgId) throw new RequestRefused(422, "NO_PROVIDER", "This organisation is not served by a provider.");
    if (v.scope === "full") {
      await tx.insert(t.providerGrants).values({ merchantOrgId: ctx.orgId, providerOrgId: org.providerOrgId, scope: "full", grantedBy: ctx.userId })
        .onConflictDoUpdate({ target: [t.providerGrants.merchantOrgId, t.providerGrants.providerOrgId], set: { scope: "full", grantedBy: ctx.userId, grantedAt: stampNow(), revokedAt: null } });
    } else {
      await tx.update(t.providerGrants).set({ revokedAt: stampNow(), grantedBy: ctx.userId }).where(and(eq(t.providerGrants.merchantOrgId, ctx.orgId), isNull(t.providerGrants.revokedAt)));
    }
    await serverAudit(tx, ctx, v.scope === "full" ? "provider_full_access_granted" : "provider_full_access_revoked", "organization", ctx.orgId,
      v.scope === "full" ? "Provider granted full read access to this merchant's rows" : "Provider full access revoked: aggregates only", v);
    return { status: 200, body: { label: LABEL, scope: v.scope } };
  }));
}

/**
 * The reviewed sample for the pilot's "wrong matches" metric: up to 20 automatically matched payments, evenly spaced
 * through the order ids [ASSUMPTION: a deterministic systematic sample; the pilot may choose another], with every
 * reviewer's verdict.
 */
export async function pilotSample(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const auto = await tx.select({ orderId: t.matchRecords.orderId, decision: t.matchRecords.decision, ruleId: t.matchRecords.ruleId }).from(t.matchRecords)
      .where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.decision, ["matched", "matched_with_difference"]))).orderBy(asc(t.matchRecords.orderId));
    const step = Math.max(1, Math.ceil(auto.length / 20));
    const sample = auto.filter((_, i) => i % step === 0).slice(0, 20);
    const reviews = sample.length ? await tx.select({ orderId: t.matchReviews.orderId, verdict: t.matchReviews.verdict, reviewer: t.matchReviews.reviewerUserId, name: t.users.name }).from(t.matchReviews)
      .innerJoin(t.users, eq(t.users.id, t.matchReviews.reviewerUserId)).where(and(eq(t.matchReviews.orgId, ctx.orgId), inArray(t.matchReviews.orderId, sample.map((x) => x.orderId)))) : [];
    return { label: LABEL, autoMatched: auto.length, sample: sample.map((x) => ({ ...x, reviews: reviews.filter((r) => r.orderId === x.orderId).map((r) => ({ verdict: r.verdict, name: r.name, mine: r.reviewer === ctx.userId })) })) };
  });
}
