import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { JOURNAL_RULES, RULES, type ReconcileResult } from "@/lib/clearline/merchant";
import { active, type JournalRuleId, type RuleId } from "@/lib/clearline/merchant/rules";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { canonical } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";

/**
 * rc7 phase 3a: reconciliation runs and rule versions.
 *
 * - The rule-set version names the engine version and the set of rules in force (a hash of the active rule ids). A
 *   run records it with the entity's policy revision; a run on the same input under the same version and revision
 *   writes nothing and says "no change".
 * - A payment a person closed (an approved write-off, or an exception resolved through an approved resolution) is
 *   never changed by a later run. If the engine would now decide it differently, the run records a "rule change
 *   would differ" notice for a person instead.
 * Runs carry ids, versions, counts and an error code: never file contents.
 */

export const MERCHANT_ENGINE_VERSION = "rc6-merchant-engine/1";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function ruleSetVersionOf(ruleIds: readonly string[], engineVersion = MERCHANT_ENGINE_VERSION): string {
  return `${engineVersion}#${sha256([...new Set(ruleIds)].sort().join("\n")).slice(0, 12)}`;
}
export const ACTIVE_RULE_IDS: readonly string[] = ([...Object.keys(RULES), ...Object.keys(JOURNAL_RULES)] as (RuleId | JournalRuleId)[]).filter((id) => active(id));
export const RULE_SET_VERSION = ruleSetVersionOf(ACTIVE_RULE_IDS);

/** A stable code for a failure (never the message, which could quote a file). */
export function errorCodeOf(e: unknown): string {
  if (e instanceof RequestRefused && /^[A-Z0-9_]{2,64}$/.test(e.code)) return e.code;
  if (e instanceof AccessDenied) return `ACCESS_${e.status}`;
  if (e instanceof z.ZodError) return "INVALID_REQUEST";
  const pg = (e as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
  if (typeof pg === "string" && /^[0-9A-Z]{5}$/.test(pg)) return `PG_${pg}`;
  return "INTERNAL";
}

/** Orders a person closed: an approved write-off, or an exception resolved through an approved resolution. */
export async function closedOrders(tx: Tx, orgId: string, orderIds: string[]): Promise<Set<string>> {
  if (!orderIds.length) return new Set();
  const wo = await tx.selectDistinct({ orderId: t.writeoffProposals.orderId }).from(t.writeoffProposals)
    .where(and(eq(t.writeoffProposals.orgId, orgId), eq(t.writeoffProposals.status, "approved"), inArray(t.writeoffProposals.orderId, orderIds)));
  const res = await tx.selectDistinct({ orderId: t.reconExceptions.orderId }).from(t.reconExceptions)
    .innerJoin(t.approvalRequests, and(eq(t.approvalRequests.orgId, t.reconExceptions.orgId), eq(t.approvalRequests.subjectKind, "merchant_resolution"),
      eq(t.approvalRequests.subjectId, t.reconExceptions.id), eq(t.approvalRequests.status, "approved")))
    .where(and(eq(t.reconExceptions.orgId, orgId), eq(t.reconExceptions.status, "resolved"), inArray(t.reconExceptions.orderId, orderIds)));
  return new Set([...wo.map((x) => x.orderId), ...res.map((x) => x.orderId).filter((x): x is string => !!x)]);
}

interface Outcome { decision: string; ruleId: string; differences: { type: string; amountMinor: string }[] }
/** What a decision says, for comparing a stored decision with a new one (ids and order of differences ignored). */
export const outcomeKey = (o: Outcome) => canonical({ decision: o.decision, ruleId: o.ruleId, differences: o.differences.map((d) => `${d.type}:${d.amountMinor}`).sort() });
export const storedOutcome = (m: { decision: string; ruleId: string; explanation: unknown }): Outcome => ({
  decision: m.decision, ruleId: m.ruleId,
  differences: ((m.explanation as { differences?: { type: string; amountMinor: string | number }[] }).differences ?? []).map((d) => ({ type: d.type, amountMinor: String(d.amountMinor) })),
});
export const newOutcome = (r: ReconcileResult["records"][number]): Outcome => ({
  decision: r.explanation.decision, ruleId: r.explanation.ruleId, differences: r.explanation.differences.map((d) => ({ type: d.type, amountMinor: d.amountMinor.toString() })),
});

export interface RunCounts { matched: number; withDifference: number; review: number; exceptions: number; unpaid: number; kept: number; notices: number }
export function runCounts(decisions: { decision: string; creditedMinor: string }[], exceptions: number, kept: number, notices: number): RunCounts {
  const n = (d: string) => decisions.filter((x) => x.decision === d).length;
  return { matched: n("matched"), withDifference: n("matched_with_difference"), review: n("suggested_for_review"), exceptions, unpaid: decisions.filter((x) => BigInt(x.creditedMinor) === 0n).length, kept, notices };
}

/** The latest completed (not failed) run of an entity, and the entity's policy revision now. */
export async function runState(tx: Tx, orgId: string, entityId: string) {
  const [prev] = await tx.select().from(t.reconciliationRuns).where(and(eq(t.reconciliationRuns.orgId, orgId), eq(t.reconciliationRuns.entityId, entityId), sql`${t.reconciliationRuns.status} <> 'failed'`))
    .orderBy(desc(t.reconciliationRuns.startedAt), desc(t.reconciliationRuns.finishedAt)).limit(1);
  const [pol] = await tx.select({ revision: t.merchantPolicy.revision }).from(t.merchantPolicy).where(and(eq(t.merchantPolicy.orgId, orgId), eq(t.merchantPolicy.entityId, entityId)));
  return { prev: prev ?? null, policyRevision: pol?.revision ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Read model (merchant members; RLS limits every row to the organisation)
// ---------------------------------------------------------------------------------------------

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });

export async function listRuns(ctx: TenantContext, opts: { entityId?: string; limit?: number } = {}) {
  require(ctx, "read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return tenantRead(ctx, async (tx) => {
    const runs = await tx.select().from(t.reconciliationRuns)
      .where(and(eq(t.reconciliationRuns.orgId, ctx.orgId), ...(opts.entityId ? [eq(t.reconciliationRuns.entityId, opts.entityId)] : [])))
      .orderBy(desc(t.reconciliationRuns.startedAt), desc(t.reconciliationRuns.finishedAt)).limit(limit);
    const notices = await tx.select().from(t.ruleChangeNotices).where(eq(t.ruleChangeNotices.orgId, ctx.orgId)).orderBy(desc(t.ruleChangeNotices.createdAt), asc(t.ruleChangeNotices.orderId)).limit(100);
    return {
      ruleSetVersion: RULE_SET_VERSION,
      runs: runs.map((r) => ({
        id: r.id, entityId: r.entityId, trigger: r.trigger, status: r.status, ruleSetVersion: r.ruleSetVersion, policyRevision: r.policyRevision,
        startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt.toISOString(), inputSha256: r.inputSha256, errorCode: r.errorCode,
        counts: { matched: r.matched, withDifference: r.withDifference, review: r.review, exceptions: r.exceptions, unpaid: r.unpaid, kept: r.kept, notices: r.notices },
      })),
      notices: notices.map((n) => ({ id: n.id, entityId: n.entityId, orderId: n.orderId, runId: n.runId, storedDecision: n.storedDecision, storedRuleId: n.storedRuleId, newDecision: n.newDecision, newRuleId: n.newRuleId, ruleSetVersion: n.ruleSetVersion, policyRevision: n.policyRevision, at: n.createdAt.toISOString() })),
    };
  });
}
