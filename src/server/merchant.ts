import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  IMPORTED_BANK_LINE_LABEL, fmtFiat, localDate, proposeJournals, reconcile,
  type BatchBridge, type Decision as MatchDecision, type FiatCurrency, type ReconcileInput,
} from "@/lib/clearline/merchant";
import { stableJson } from "@/lib/clearline/merchant/adapters";
import { differenceIdsFor, splitDifferences } from "@/lib/clearline/merchant/difference-rows";
import { exceptionRate, exceptionRateCounts } from "@/lib/clearline/merchant/exception-rate";
import type { StatementLineInput } from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { Decision, IdempotencyKey, canonical, idempotent, serverAudit } from "./control";
import { MissingEntity, type IngestParts, loadReconcileInput, plain, plainForDisplay, writeIngested } from "./merchant-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { dataModeOf } from "./mapping-templates";
import type { DataLabel } from "@/lib/clearline/data-mode";
import { orgDataMode, verifyChainForEntity, verifyClientFromEnv } from "./chain-verify";
import { usesUploadPipeline, isDataMode } from "@/lib/clearline/data-mode";
import { demoNow } from "@/lib/clearline/demo/clock";
import type { VerifyChainClient } from "@/lib/clearline/merchant/chain";
import type { RunTrigger } from "./db/ops-schema";
import { MERCHANT_ENGINE_VERSION, RULE_SET_VERSION, closedOrders, errorCodeOf, newOutcome, outcomeKey, runCounts, runState, storedOutcome, type RunCounts } from "./runs";
import { stampAt, stampNow } from "./live-clock";

/**
 * rc6 Merchant Reconciliation services. Every function takes a TenantContext built on the server from the session
 * and runs in one RLS-scoped tenant transaction. Read-only domain: nothing holds, sends, converts or settles money.
 * The engine decides matches; this layer persists them, adds permissions, idempotency, two-person write-off approval
 * and audit, and serves read models. Every output carries the organisation's data label (dataLabel).
 */

export { MERCHANT_ENGINE_VERSION };
export const PROVIDER_DAY_NOTE = "provider day = UTC";
/** rc7 phase 3b: every response carries the organisation's data label ("Your data" for a live merchant; the demo label for sample data only). */
const orgLabel = async (tx: Tx, orgId: string): Promise<DataLabel> => (await dataModeOf(tx, orgId)).label;
/** The JSON shape of an engine object (BigInt → decimal string), as persisted and served. */
export type Jsonified<T> = T extends bigint ? string : T extends readonly (infer U)[] ? Jsonified<U>[] : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const inputSha256 = (input: ReconcileInput) => sha256(stableJson(input));
/**
 * Persisted ids are content-addressed: the engine numbers differences per order ("BK-25102.D1"), so the same engine id
 * can name a different difference once more data arrives. Appending under `<engine id>@<content hash>` keeps every
 * row immutable and deduplicates an identical rerun exactly.
 */
const contentId = (engineId: string, content: unknown) => `${engineId}@${sha256(canonical(plain(content))).slice(0, 10)}`;

/** Every stored difference id of these payments, with whether it is superseded. */
async function storedDifferenceIds(tx: Tx, orgId: string, orderIds: string[]) {
  const out = new Map<string, boolean>();
  for (let i = 0; i < orderIds.length; i += 1000) {
    for (const r of await tx.select({ id: t.differences.id, supersededAt: t.differences.supersededAt }).from(t.differences)
      .where(and(eq(t.differences.orgId, orgId), inArray(t.differences.orderId, orderIds.slice(i, i + 1000))))) out.set(r.id, r.supersededAt !== null);
  }
  return out;
}

async function load(tx: Tx, ctx: TenantContext, entityId: string) {
  try { return await loadReconcileInput(tx, ctx.orgId, entityId); } catch (e) {
    if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found.");
    throw e;
  }
}

/**
 * The entity and its policy row, and nothing else: for a read that needs only the entity's own facts (its currency,
 * its time zone). Not found, exactly as `load`, when either is missing.
 */
export async function entityOnly(tx: Tx, ctx: TenantContext, entityId: string) {
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
  const [pol] = ent ? await tx.select({ id: t.merchantPolicy.entityId }).from(t.merchantPolicy).where(and(eq(t.merchantPolicy.orgId, ctx.orgId), eq(t.merchantPolicy.entityId, entityId))) : [];
  if (!ent || !pol) throw new AccessDenied(404, "Not found.");
  return ent;
}

// ---------------------------------------------------------------------------------------------
// Ingestion and reconciliation
// ---------------------------------------------------------------------------------------------

/** Store adapter output for one entity (fictional or recorded data only). Facts are insert-only. */
export async function ingestAdapterOutput(ctx: TenantContext, entityId: string, parts: IngestParts, idempotencyKey: string, opts: { finalised?: (x: NonNullable<IngestParts["transfers"]>[number]) => boolean } = {}) {
  require(ctx, "merchant_reconcile");
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_ingest", entityId, parts: plain(parts) }, async () => {
    const written = await writeIngested(tx, ctx.orgId, entityId, parts, { chainSource: "recorded_fixture", ...(opts.finalised ? { finalised: opts.finalised } : {}) })
      .catch((e) => { if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found."); throw e; });
    await serverAudit(tx, ctx, "merchant_data_ingested", "merchant_entity", entityId, `Ingested ${Object.entries(written).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing new"}`, written);
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), entityId, written } };
  }));
}

/** Options of a run. `ruleSetVersion` replaces the code's version only in tests (to show a rule change re-runs). */
export interface RunOptions { chain?: VerifyChainClient; trigger?: RunTrigger; jobId?: string; ruleSetVersion?: string; /** The instant chain reads are made at (default: now; the demo clock for a demo organisation). */ now?: Date }

/**
 * (Live data: verify against the chain first, see chain-verify.ts.) Load the entity's rows → reconcile → persist the five parts, differences (append-only), exceptions, write-off
 * proposals and journal proposals (always pending sign-off) → audit, and record the run (rc7 phase 3a, runs.ts).
 * The same input under the same rule-set version and policy revision as the last run writes nothing ("no change").
 * Payments a person closed are left as they were; a run that would decide one differently records a notice instead.
 */
export async function runReconciliation(ctx: TenantContext, entityId: string, idempotencyKey: string, opts: RunOptions = {}) {
  require(ctx, "merchant_reconcile");
  const key = IdempotencyKey.parse(idempotencyKey);
  const trigger = opts.trigger ?? "manual";
  const version = opts.ruleSetVersion ?? RULE_SET_VERSION;
  const startedAt = new Date();
  try {
    // rc7 phase 2: a live organisation's payments are verified against chain data first (sample data is seeded with
    // its recorded chain facts). Reads happen outside the reconcile transaction; failed reads are stored, not thrown.
    // Demo build: a demo organisation goes through the same verification, against the recorded chain file, at the
    // demo clock (src/lib/clearline/demo/clock.ts); verifyClientFromEnv refuses the recording for any other org.
    const mode = await orgDataMode(ctx);
    if (isDataMode(mode) && usesUploadPipeline(mode)) await verifyChainForEntity(ctx, entityId, opts.chain ?? verifyClientFromEnv(process.env, mode), mode === "demo" ? { now: opts.now ?? demoNow() } : opts.now ? { now: opts.now } : {});
    return await tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_reconcile", entityId }, () => reconcileInTx(tx, ctx, entityId, { trigger, version, startedAt, jobId: opts.jobId ?? null })));
  } catch (e) {
    // A failed run is recorded with a code (never the message). An unknown entity or a refused member is not a run.
    if (!(e instanceof AccessDenied)) {
      await tenantTx(ctx, async (tx) => {
        const { policyRevision } = await runState(tx, ctx.orgId, entityId);
        await tx.insert(t.reconciliationRuns).values({ orgId: ctx.orgId, entityId, trigger, jobId: opts.jobId ?? null, startedBy: ctx.userId, ruleSetVersion: version, policyRevision, status: "failed", startedAt: stampAt(startedAt), finishedAt: stampNow(), errorCode: errorCodeOf(e) });
      }).catch(() => undefined);
    }
    throw e;
  }
}

export type RunBody = {
  label: DataLabel; entityId: string; inputSha256: string; engineVersion: string; ruleSetVersion: string; policyRevision: number; runId: string; status: "changed" | "no_change"; changed: boolean;
  records?: number; newDifferences?: number; supersededDifferences?: number; exceptions?: number; resolvedExceptions?: number; newWriteoffs?: number; supersededWriteoffs?: number; journals?: number; kept?: number; notices?: number; runCounts?: RunCounts;
};

async function reconcileInTx(tx: Tx, ctx: TenantContext, entityId: string, run: { trigger: RunTrigger; version: string; startedAt: Date; jobId: string | null }): Promise<{ status: number; body: RunBody }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|merchant_reconcile|${entityId}`}))`);
  const input = await load(tx, ctx, entityId);
  const hash = inputSha256(input);
  const orderIds = input.invoices.map((i) => i.orderId);
  const { prev, policyRevision } = await runState(tx, ctx.orgId, entityId);
  const runRow = { orgId: ctx.orgId, entityId, trigger: run.trigger, jobId: run.jobId, startedBy: ctx.userId, ruleSetVersion: run.version, policyRevision, inputSha256: hash, startedAt: stampAt(run.startedAt) };
  const meta = { label: await orgLabel(tx, ctx.orgId), entityId, inputSha256: hash, engineVersion: MERCHANT_ENGINE_VERSION, ruleSetVersion: run.version, policyRevision };
  if (prev && prev.inputSha256 === hash && prev.ruleSetVersion === run.version && prev.policyRevision === policyRevision) {
    const [r] = await tx.insert(t.reconciliationRuns).values({ ...runRow, status: "no_change", finishedAt: stampNow(), matched: prev.matched, withDifference: prev.withDifference,
      review: prev.review, exceptions: prev.exceptions, unpaid: prev.unpaid, kept: prev.kept, notices: 0 }).returning({ id: t.reconciliationRuns.id });
    return { status: 200, body: { ...meta, runId: r.id, status: "no_change" as const, changed: false, records: orderIds.length, newDifferences: 0, supersededDifferences: 0, exceptions: prev.exceptions, resolvedExceptions: 0, newWriteoffs: 0, supersededWriteoffs: 0, journals: 0, kept: prev.kept, notices: 0 } };
  }
  const result = reconcile(input);
  const journals = proposeJournals(input, result);
  const now = stampNow();
  // rc7 phase 3a: a payment a person closed keeps its stored decision; a different new decision becomes a notice
  const closed = await closedOrders(tx, ctx.orgId, orderIds);
  const stored = new Map(closed.size ? (await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.orderId, [...closed])))).map((m) => [m.orderId, m]) : []);
  const isKept = (orderId: string | null | undefined) => !!orderId && stored.has(orderId);
  const open = result.records.filter((r) => !isKept(r.orderId));
  const differ = result.records.filter((r) => isKept(r.orderId) && outcomeKey(newOutcome(r)) !== outcomeKey(storedOutcome(stored.get(r.orderId)!)));
  const runId = randomUUID();
  const openIds = orderIds.filter((o) => !isKept(o));
  // v1 phase 0: the open payments' stored difference rows; the current ones are what each payment's decision named
  // before this run re-decides it
  const storedDiffs = await storedDifferenceIds(tx, ctx.orgId, openIds);
  const diffIdOf = differenceIdsFor(new Map(open.flatMap((r) => r.explanation.differences.map((d) => [`${r.orderId}|${d.id}`, contentId(d.id, { orderId: r.orderId, type: d.type, amountMinor: d.amountMinor, currency: d.currency, ruleId: d.ruleId })] as const))), storedDiffs, runId);
  const writeOffs = result.writeOffs.filter((w) => !isKept(w.orderId));
  const woIdOf = new Map(writeOffs.map((w) => [w.id, contentId(w.id, { orderId: w.orderId, amountMinor: w.amountMinor, direction: w.direction, currency: w.currency, differenceIds: w.differenceIds.map((id) => diffIdOf.get(`${w.orderId}|${id}`)) })]));
  // rc7 phase 3b: written in chunks (the same rows and values as one statement per row)
  const records = open.map((r) => {
    const explanation = { ...r.explanation, differences: r.explanation.differences.map((d) => ({ ...d, persistedId: diffIdOf.get(`${r.orderId}|${d.id}`) })) };
    return {
      orgId: ctx.orgId, orderId: r.orderId, decision: r.explanation.decision, decidingStep: r.explanation.decidingStep, ruleId: r.explanation.ruleId,
      chain: plain(r.chain) as object, provider: plain(r.provider) as object, bank: plain(r.bank) as object, ledger: plain(r.ledger) as object,
      explanation: plain({ ...explanation, attention: r.attention ?? null, label: meta.label }) as object, engineVersion: MERCHANT_ENGINE_VERSION, inputSha256: hash, computedAt: now,
    };
  });
  const ex = (c: string) => sql.raw(`excluded.${c}`);
  for (let i = 0; i < records.length; i += 500) {
    await tx.insert(t.matchRecords).values(records.slice(i, i + 500)).onConflictDoUpdate({ target: [t.matchRecords.orgId, t.matchRecords.orderId], set: {
      decision: ex("decision"), decidingStep: ex("deciding_step"), ruleId: ex("rule_id"), chain: ex("chain"), provider: ex("provider"), bank: ex("bank"), ledger: ex("ledger"),
      explanation: ex("explanation"), engineVersion: ex("engine_version"), inputSha256: ex("input_sha256"), computedAt: ex("computed_at"),
    } });
  }
  // the run's own row is written last (with its counts): its foreign keys from differences are checked at commit
  await tx.execute(sql`set constraints differences_run_fk, differences_superseded_by_run_fk deferred`);
  const diffs = open.flatMap((r) => r.explanation.differences.map((d) => ({ orgId: ctx.orgId, id: diffIdOf.get(`${r.orderId}|${d.id}`)!, orderId: r.orderId, type: d.type, amountMinor: d.amountMinor, currency: d.currency, reason: d.reason, ruleId: d.ruleId,
    runId, ruleSetVersion: run.version, stampSource: "run" as const })));
  const newDiffs: { id: string }[] = [];
  for (let i = 0; i < diffs.length; i += 1000) newDiffs.push(...await tx.insert(t.differences).values(diffs.slice(i, i + 1000)).onConflictDoNothing().returning({ id: t.differences.id }));
  // v1 phase 0: a re-decided payment's earlier rows that its new decision no longer names are marked superseded by this
  // run (kept, never deleted; amounts never change). Closed payments are not re-decided, so their rows are untouched.
  const currentDiffIds = new Set(diffIdOf.values());
  const supersede = [...storedDiffs].filter(([id, superseded]) => !superseded && !currentDiffIds.has(id)).map(([id]) => id);
  for (let i = 0; i < supersede.length; i += 1000) {
    await tx.update(t.differences).set({ supersededAt: now, supersededByRunId: runId })
      .where(and(eq(t.differences.orgId, ctx.orgId), inArray(t.differences.id, supersede.slice(i, i + 1000)), isNull(t.differences.supersededAt)));
  }
  const exceptions = result.exceptions.filter((e) => !isKept(e.orderId));
  const exIds = new Set(exceptions.map((e) => e.id));
  for (let i = 0; i < exceptions.length; i += 500) {
    await tx.insert(t.reconExceptions).values(exceptions.slice(i, i + 500).map((e) => ({ orgId: ctx.orgId, id: e.id, orderId: e.orderId ?? null, ownerRole: e.owner, reason: e.reason, nextStep: e.nextStep, status: "open", openedAt: now })))
      .onConflictDoUpdate({ target: [t.reconExceptions.orgId, t.reconExceptions.id], set: { ownerRole: ex("owner_role"), reason: ex("reason"), nextStep: ex("next_step"), status: sql`case when ${t.reconExceptions.status} = 'resolved' then 'open' else ${t.reconExceptions.status} end`, closedAt: null } });
  }
  const stale = openIds.length ? (await tx.select({ id: t.reconExceptions.id }).from(t.reconExceptions)
    .where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, openIds), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((x) => !exIds.has(x.id)) : [];
  for (let i = 0; i < stale.length; i += 1000) await tx.update(t.reconExceptions).set({ status: "resolved", closedAt: now }).where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.id, stale.slice(i, i + 1000).map((x) => x.id))));
  const woRows = writeOffs.map((w) => ({
    orgId: ctx.orgId, id: woIdOf.get(w.id)!, orderId: w.orderId, amountMinor: w.amountMinor, currency: w.currency,
    differenceIds: w.differenceIds.map((id) => diffIdOf.get(`${w.orderId}|${id}`)!), status: "proposed",
  }));
  const newWo: { id: string }[] = [];
  for (let i = 0; i < woRows.length; i += 1000) newWo.push(...await tx.insert(t.writeoffProposals).values(woRows.slice(i, i + 1000)).onConflictDoNothing().returning({ id: t.writeoffProposals.id }));
  // a write-off the engine no longer proposes (the payment changed) is superseded, with any pending request for it
  const currentWo = new Set(woIdOf.values());
  const oldWo = openIds.length ? (await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.orderId, openIds),
    inArray(t.writeoffProposals.status, ["proposed", "awaiting_approval"])))).filter((w) => !currentWo.has(w.id)) : [];
  for (const w of oldWo) {
    await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: now }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_writeoff"), eq(t.approvalRequests.subjectId, w.id), eq(t.approvalRequests.status, "pending")));
    await tx.update(t.writeoffProposals).set({ status: "superseded" }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, w.id)));
  }
  // a journal about closed payments only is left as it was (it may wait for an approved write-off)
  const keptJournal = (orderIdsOf: string[]) => orderIdsOf.length > 0 && orderIdsOf.every((o) => isKept(o));
  const writtenJournals = journals.filter((j) => !keptJournal(j.evidence.orderIds));
  const journalRows = writtenJournals.map((j) => {
    // Document A "(on approval)" lines name the approval they wait for; write-off ids map to their stored ids.
    const lines = j.lines.map((l) => (l.onApproval ? { ...l, onApproval: woIdOf.get(l.onApproval) ?? l.onApproval } : l));
    return { orgId: ctx.orgId, id: j.id, entityId, pattern: j.kind, lines: plain(lines) as object, currency: j.currency, status: "proposed", postingRuleStatus: "pending_sign_off",
      evidenceRefs: plain({ ...j.evidence, ruleId: j.ruleId, entryDate: j.entryDate, memo: j.memo, requiresApprovalOf: j.requiresApprovalOf ? woIdOf.get(j.requiresApprovalOf) ?? j.requiresApprovalOf : null, label: meta.label }) as object };
  });
  for (let i = 0; i < journalRows.length; i += 500) {
    await tx.insert(t.merchantJournalProposals).values(journalRows.slice(i, i + 500)).onConflictDoUpdate({ target: [t.merchantJournalProposals.orgId, t.merchantJournalProposals.id],
      set: { entityId: ex("entity_id"), pattern: ex("pattern"), lines: ex("lines"), currency: ex("currency"), evidenceRefs: ex("evidence_refs") }, setWhere: sql`${t.merchantJournalProposals.status} = 'proposed'` });
  }
  const keep = journals.map((j) => j.id);
  const keptOrders = [...stored.keys()];
  await tx.update(t.merchantJournalProposals).set({ status: "superseded" }).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId),
    eq(t.merchantJournalProposals.status, "proposed"), keep.length ? sql`${t.merchantJournalProposals.id} not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})` : sql`true`,
    keptOrders.length ? sql`not (coalesce(${t.merchantJournalProposals.evidenceRefs} -> 'orderIds', '[]'::jsonb) <@ ${JSON.stringify(keptOrders)}::jsonb and jsonb_array_length(coalesce(${t.merchantJournalProposals.evidenceRefs} -> 'orderIds', '[]'::jsonb)) > 0)` : sql`true`));
  const notices = differ.length ? await tx.insert(t.ruleChangeNotices).values(differ.map((r) => {
    const m = stored.get(r.orderId)!;
    const fingerprint = sha256(`${outcomeKey(storedOutcome(m))}|${outcomeKey(newOutcome(r))}`);
    return { orgId: ctx.orgId, entityId, orderId: r.orderId, runId, ruleSetVersion: run.version, policyRevision, storedDecision: m.decision, storedRuleId: m.ruleId, newDecision: r.explanation.decision, newRuleId: r.explanation.ruleId, fingerprint };
  })).onConflictDoNothing().returning({ id: t.ruleChangeNotices.id }) : [];
  const effective = result.records.map((r) => (isKept(r.orderId) ? { decision: stored.get(r.orderId)!.decision, creditedMinor: String((stored.get(r.orderId)!.ledger as { creditedMinor: string }).creditedMinor) } : { decision: r.explanation.decision, creditedMinor: r.ledger.creditedMinor.toString() }));
  const rc = runCounts(effective, exceptions.length, stored.size, notices.length);
  await tx.insert(t.reconciliationRuns).values({ ...runRow, id: runId, status: "changed", finishedAt: stampNow(), ...rc });
  const counts = { records: result.records.length, newDifferences: newDiffs.length, supersededDifferences: supersede.length, exceptions: exceptions.length, resolvedExceptions: stale.length, newWriteoffs: newWo.length, supersededWriteoffs: oldWo.length, journals: writtenJournals.length, kept: stored.size, notices: notices.length };
  await serverAudit(tx, ctx, "merchant_reconciliation_run", "merchant_entity", entityId,
    `Reconciled ${counts.records} payments (engine ${MERCHANT_ENGINE_VERSION}, rules ${run.version}, policy r${policyRevision}, input sha256 ${hash.slice(0, 12)}…): ${counts.exceptions} exceptions, ${counts.newWriteoffs} new write-off proposals, ${counts.journals} journal proposals pending sign-off, ${counts.kept} closed payments kept, ${counts.notices} rule-change notices`,
    { inputSha256: hash, engineVersion: MERCHANT_ENGINE_VERSION, ruleSetVersion: run.version, policyRevision, runId, ...counts });
  return { status: 200, body: { ...meta, runId, status: "changed" as const, changed: true, ...counts, runCounts: rc } };
}

// ---------------------------------------------------------------------------------------------
// Matching policy (Admin only; the database refuses anyone else and stale revisions)
// ---------------------------------------------------------------------------------------------

const Minor = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().min(0)]).transform((v) => BigInt(v));
export const PolicyPatch = z.object({
  toleranceBps: z.number().int().min(0).max(1000).optional(),
  toleranceAbsMinor: Minor.optional(),
  toleranceCombine: z.enum(["smaller", "larger"]).optional(),
  writeoffThresholdMinor: Minor.optional(),
  allowImportedBankLinesAsVerified: z.boolean().optional(),
}).strict();

export async function updateMerchantPolicy(ctx: TenantContext, entityId: string, patch: z.input<typeof PolicyPatch>, expectedRevision: number, idempotencyKey: string) {
  require(ctx, "manage_policy");
  const p = PolicyPatch.parse(patch);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_policy", entityId, patch: plain(p), expectedRevision }, async () => {
    const r = await tx.update(t.merchantPolicy).set({ ...p, revision: expectedRevision + 1, updatedAt: stampNow() })
      .where(and(eq(t.merchantPolicy.orgId, ctx.orgId), eq(t.merchantPolicy.entityId, entityId), eq(t.merchantPolicy.revision, expectedRevision))).returning({ revision: t.merchantPolicy.revision });
    if (!r.length) throw new RequestRefused(409, "STALE_POLICY", "The policy changed since you read it (or does not exist). Reload it and try again.");
    await serverAudit(tx, ctx, "merchant_policy_updated", "merchant_entity", entityId, `Matching policy revision ${r[0].revision}: ${Object.keys(p).join(", ")}`, plain(p));
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), entityId, revision: r[0].revision } };
  }));
}

// ---------------------------------------------------------------------------------------------
// Write-offs: the engine proposes; a person submits it; a DIFFERENT Approver decides (rc5 two-person flow)
// ---------------------------------------------------------------------------------------------

async function writeoffBinding(tx: Tx, ctx: TenantContext, writeoffId: string) {
  const [wo] = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, writeoffId))).for("update");
  if (!wo) throw new AccessDenied(404, "Not found.");
  const [mr] = await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, wo.orderId)));
  const ids = wo.differenceIds as string[];
  const ds = ids.length ? await tx.select().from(t.differences).where(and(eq(t.differences.orgId, ctx.orgId), inArray(t.differences.id, ids))).orderBy(asc(t.differences.id)) : [];
  return {
    wo,
    binding: {
      label: await orgLabel(tx, ctx.orgId), writeoffId: wo.id, orderId: wo.orderId, amountMinor: wo.amountMinor.toString(), currency: wo.currency, differenceIds: ids,
      differences: ds.map((d) => ({ id: d.id, type: d.type, amountMinor: d.amountMinor.toString(), reason: d.reason })),
      matchDecision: mr?.decision ?? null, matchInputSha256: mr?.inputSha256 ?? null, engineVersion: mr?.engineVersion ?? null,
    },
  };
}

export async function proposeWriteoff(ctx: TenantContext, writeoffId: string, idempotencyKey: string) {
  require(ctx, "propose_writeoff");
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_writeoff_propose", writeoffId }, async () => {
    const { wo, binding } = await writeoffBinding(tx, ctx, writeoffId);
    if (wo.status !== "proposed" && wo.status !== "awaiting_approval") throw new RequestRefused(409, "WRITEOFF_CLOSED", `This write-off is ${wo.status}.`);
    if (binding.matchDecision !== "matched_with_difference") throw new RequestRefused(422, "WRITEOFF_NOT_SUPPORTED", "The payment is no longer matched with a difference; reconcile again.");
    const prior = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_writeoff"), eq(t.approvalRequests.subjectId, writeoffId))).for("update");
    for (const r of prior.filter((x) => x.status === "pending")) await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: stampNow() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, r.id)));
    const version = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const payload = { ...binding, version };
    const payloadSha256 = sha256(canonical(payload));
    const [req] = await tx.insert(t.approvalRequests).values({ orgId: ctx.orgId, subjectKind: "merchant_writeoff", subjectId: writeoffId, version, payload, payloadSha256, requestedBy: ctx.userId }).returning();
    await tx.update(t.writeoffProposals).set({ status: "awaiting_approval", approvalRequestId: req.id, preparedBy: ctx.userId }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, writeoffId)));
    await serverAudit(tx, ctx, "merchant_writeoff_requested", "writeoff", writeoffId, `Write-off ${writeoffId} v${version} (${fmtFiat(wo.amountMinor, wo.currency as FiatCurrency)}) submitted for a second person's approval (sha256 ${payloadSha256.slice(0, 12)}…)`, { requestId: req.id });
    return { status: 201, body: { label: await orgLabel(tx, ctx.orgId), requestId: req.id, writeoffId, version, payloadSha256, payload } };
  }));
}

export async function decideWriteoff(ctx: TenantContext, requestId: string, input: z.infer<typeof Decision>, idempotencyKey: string) {
  require(ctx, "decide_approval");
  const d = Decision.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.uuid().safeParse(requestId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_writeoff_decide", requestId, ...d }, async () => {
    const [req] = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId))).for("update");
    if (!req || req.subjectKind !== "merchant_writeoff") throw new AccessDenied(404, "Not found.");
    if (req.requestedBy === ctx.userId) throw new RequestRefused(409, "MAKER_CANNOT_APPROVE", "You submitted this write-off; another approver must decide it.");
    if (req.status !== "pending") throw new RequestRefused(409, "REQUEST_CLOSED", `This request is ${req.status}.`);
    if (req.payloadSha256 !== d.payloadSha256) throw new RequestRefused(409, "VERSION_MISMATCH", "The write-off changed since you reviewed it. Review the current version.");
    const { wo, binding } = await writeoffBinding(tx, ctx, req.subjectId);
    if (d.decision === "approve") {
      const pl = req.payload as typeof binding & { version: number };
      if (wo.approvalRequestId !== req.id || canonical({ ...binding, version: pl.version }) !== canonical(pl)) {
        throw new RequestRefused(409, "STALE_WRITEOFF", "The payment was reconciled again or the write-off changed after this request was made. Ask for a new version.");
      }
    }
    await tx.insert(t.approvalDecisions).values({ orgId: ctx.orgId, requestId, decidedBy: ctx.userId, decision: d.decision, reason: d.reason, payloadSha256: d.payloadSha256 });
    const status = d.decision === "approve" ? "approved" : "rejected";
    await tx.update(t.approvalRequests).set({ status, closedAt: stampNow() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId)));
    await tx.update(t.writeoffProposals).set({ status }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, wo.id)));
    await serverAudit(tx, ctx, d.decision === "approve" ? "merchant_writeoff_approved" : "merchant_writeoff_rejected", "writeoff", wo.id, `${status === "approved" ? "Approved" : "Rejected"} write-off ${wo.id} v${req.version} by a second person: ${d.reason}`, { requestId, payloadSha256: d.payloadSha256 });
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), requestId, writeoffId: wo.id, status } };
  }));
}

// ---------------------------------------------------------------------------------------------
// Imported bank lines (rc5 CSV import → bank_lines). Imported, not bank-authenticated.
// ---------------------------------------------------------------------------------------------

/**
 * Bridge a CONFIRMED rc5 statement import (second person, decideStatementImport) into merchant bank lines with
 * source 'csv_import' and the import id. Such a line is labelled "imported, not bank-authenticated" and never alone
 * makes settlement verified unless the entity's policy allows it (default off).
 */
export async function bankLinesFromImport(ctx: TenantContext, importId: string, entityId: string, idempotencyKey: string) {
  require(ctx, "import_statement");
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.uuid().safeParse(importId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_bank_lines_from_import", importId, entityId }, async () => {
    const [imp] = await tx.select().from(t.statementImports).where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.id, importId)));
    if (!imp) throw new AccessDenied(404, "Not found.");
    if (imp.status !== "imported") throw new RequestRefused(409, "IMPORT_NOT_CONFIRMED", "Only an import a second person confirmed can become bank lines.");
    const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    const staged = (imp.lines as { row: number; line: StatementLineInput }[]).filter((s) => s.line.direction === "credit" && s.line.currency === ent.functionalCurrency);
    const rows = staged.map((s) => ({
      orgId: ctx.orgId, lineId: `IMP-${s.line.lineId}`, account: s.line.accountRef, currency: s.line.currency, valueDate: s.line.valueDate, amountMinor: BigInt(s.line.amountMinor),
      description: s.line.reference, source: "csv_import", importId, entityId, provenance: `${IMPORTED_BANK_LINE_LABEL}: ${imp.fileName} row ${s.row} (sha256 ${imp.fileSha256.slice(0, 12)}…)`,
    }));
    const written = rows.length ? await tx.insert(t.bankLines).values(rows).onConflictDoNothing().returning({ id: t.bankLines.lineId }) : [];
    await serverAudit(tx, ctx, "merchant_bank_lines_imported", "statement_import", importId, `${written.length} imported bank line(s) for ${entityId} (${IMPORTED_BANK_LINE_LABEL})`, { entityId, lineIds: written.map((w) => w.id) });
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), importId, entityId, bankLineIds: written.map((w) => w.id), skipped: (imp.lines as unknown[]).length - staged.length, bankLineLabel: IMPORTED_BANK_LINE_LABEL } };
  }));
}

// ---------------------------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------------------------

interface StoredTransfer { network: string; txHash: string; timestamp: string; to: string; symbol: string; tokenContract: string }
interface StoredRecord { orderId: string; decision: MatchDecision; ruleId: string; chain: { transfers: StoredTransfer[] }; provider: { records: { batchId?: string }[] }; ledger: { invoice: { amountMinor: string; currency: string; entityId: string }; creditedMinor: string; openBalanceMinor: string; balanceLabel: string }; explanation: { differences: { type: string }[] } }

async function storedRecords(tx: Tx, orgId: string, entityId?: string) {
  const rows = await tx.select({ m: t.matchRecords, inv: t.invoices }).from(t.matchRecords)
    .innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
    .where(and(eq(t.matchRecords.orgId, orgId), ...(entityId ? [eq(t.invoices.entityId, entityId)] : []))).orderBy(asc(t.matchRecords.orderId));
  return rows.map(({ m, inv }) => ({ row: m, inv, rec: { orderId: m.orderId, decision: m.decision as MatchDecision, ruleId: m.ruleId, chain: m.chain, provider: m.provider, ledger: m.ledger, explanation: m.explanation } as StoredRecord }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function dailyReport(ctx: TenantContext, entityId: string, date: string) {
  require(ctx, "read");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RequestRefused(422, "BAD_DATE", "Use YYYY-MM-DD.");
  return tenantRead(ctx, async (tx) => {
    const input = await load(tx, ctx, entityId);
    const off = input.entity.timeZone.utcOffsetMinutes;
    const recs = (await storedRecords(tx, ctx.orgId, entityId)).filter((r) => r.rec.chain.transfers.some((x) => localDate(x.timestamp, off) === date));
    const orders = new Set(recs.map((r) => r.row.orderId));
    const bridges = reconcile(input).bridges.filter((b) => b.providerDay === date);
    const ex = (await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((e) => e.orderId && orders.has(e.orderId));
    const wos = (await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.status, ["proposed", "awaiting_approval"])))).filter((w) => orders.has(w.orderId));
    const tied = bridges.filter((b) => b.tied).length;
    return {
      label: await orgLabel(tx, ctx.orgId), entityId, date, timeZone: input.entity.timeZone.name, cutOffNote: PROVIDER_DAY_NOTE,
      payments: recs.length, settlementsTied: tied, settlements: bridges.length, exceptions: ex.length, writeoffsAwaitingApproval: wos.length,
      summary: `${plural(recs.length, "payment")} · ${plural(tied, "settlement")} tied · ${plural(ex.length, "exception")} · ${plural(wos.length, "write-off")} awaiting approval`,
    };
  });
}

/**
 * The daily report for every date of one entity in one read (the same figures as dailyReport for each date): the
 * entity's input and stored records are loaded once and the bridges computed once, instead of once per date.
 */
export async function dailyReports(ctx: TenantContext, entityId: string, dates: string[]) {
  require(ctx, "read");
  for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new RequestRefused(422, "BAD_DATE", "Use YYYY-MM-DD.");
  return tenantRead(ctx, async (tx) => {
    const input = await load(tx, ctx, entityId);
    const off = input.entity.timeZone.utcOffsetMinutes;
    const all = await storedRecords(tx, ctx.orgId, entityId);
    const allBridges = reconcile(input).bridges;
    const ex = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`));
    const wos = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.status, ["proposed", "awaiting_approval"])));
    const label = await orgLabel(tx, ctx.orgId);
    const out = new Map<string, { label: string; entityId: string; date: string; timeZone: string; cutOffNote: string; payments: number; settlementsTied: number; settlements: number; exceptions: number; writeoffsAwaitingApproval: number; summary: string }>();
    for (const date of dates) {
      const recs = all.filter((r) => r.rec.chain.transfers.some((x) => localDate(x.timestamp, off) === date));
      const orders = new Set(recs.map((r) => r.row.orderId));
      const bridges = allBridges.filter((b) => b.providerDay === date);
      const nEx = ex.filter((e) => e.orderId && orders.has(e.orderId)).length;
      const nWo = wos.filter((w) => orders.has(w.orderId)).length;
      const tied = bridges.filter((b) => b.tied).length;
      out.set(date, {
        label, entityId, date, timeZone: input.entity.timeZone.name, cutOffNote: PROVIDER_DAY_NOTE,
        payments: recs.length, settlementsTied: tied, settlements: bridges.length, exceptions: nEx, writeoffsAwaitingApproval: nWo,
        summary: `${plural(recs.length, "payment")} · ${plural(tied, "settlement")} tied · ${plural(nEx, "exception")} · ${plural(nWo, "write-off")} awaiting approval`,
      });
    }
    return out;
  });
}

export const PaymentFilters = z.object({
  entityId: z.string().max(64).optional(), result: z.enum(["matched", "matched_with_difference", "suggested_for_review", "exception"]).optional(),
  differenceType: z.string().max(40).optional(), network: z.string().max(20).optional(), token: z.string().max(120).optional(), batchId: z.string().max(64).optional(),
  minAgeDays: z.number().int().min(0).optional(), maxAgeDays: z.number().int().min(0).optional(), asOf: z.string().optional(), search: z.string().trim().max(200).optional(),
}).strict();

export async function listMerchantPayments(ctx: TenantContext, filters: z.input<typeof PaymentFilters> = {}) {
  require(ctx, "read");
  const f = PaymentFilters.parse(filters);
  const asOf = f.asOf ? Date.parse(f.asOf) : Date.now();
  return tenantRead(ctx, async (tx) => {
    const quotes = await tx.select().from(t.merchantQuotes).where(eq(t.merchantQuotes.orgId, ctx.orgId));
    const links = await tx.select().from(t.paymentLinks).where(eq(t.paymentLinks.orgId, ctx.orgId));
    const label = await orgLabel(tx, ctx.orgId);
    const rows = (await storedRecords(tx, ctx.orgId, f.entityId)).map(({ rec, inv }) => {
      const tr = rec.chain.transfers;
      const deposit = [...quotes.filter((q) => q.orderId === rec.orderId).map((q) => q.depositAddress), ...links.filter((l) => l.orderId === rec.orderId).map((l) => l.depositAddress)];
      return {
        label, orderId: rec.orderId, entityId: inv.entityId, decision: rec.decision, ruleId: rec.ruleId, invoiceMinor: inv.amountMinor === null ? null : inv.amountMinor.toString(), currency: inv.currency,
        // v1: a token-priced invoice has no fiat price; its token price (base units) is given instead
        ...(inv.priceTokenAmount !== null ? { priceToken: { network: inv.priceNetwork, contract: inv.priceTokenContract, baseUnits: String(inv.priceTokenAmount) } } : {}),
        creditedMinor: rec.ledger.creditedMinor, openBalanceMinor: rec.ledger.openBalanceMinor, balanceLabel: rec.ledger.balanceLabel,
        differenceTypes: [...new Set(rec.explanation.differences.map((d) => d.type))], networks: [...new Set(tr.map((x) => x.network))],
        tokens: [...new Set(tr.flatMap((x) => [x.symbol, x.tokenContract]))], batchIds: [...new Set(rec.provider.records.map((r) => r.batchId).filter((x): x is string => !!x))],
        txHashes: tr.map((x) => x.txHash), depositAddresses: deposit, ageDays: Math.floor((asOf - inv.issuedAt.getTime()) / 86_400_000),
      };
    });
    const q = f.search?.toLowerCase();
    return rows.filter((r) => (!f.result || r.decision === f.result) && (!f.differenceType || r.differenceTypes.includes(f.differenceType))
      && (!f.network || r.networks.includes(f.network)) && (!f.token || r.tokens.some((x) => x.toLowerCase() === f.token!.toLowerCase())) && (!f.batchId || r.batchIds.includes(f.batchId))
      && (f.minAgeDays === undefined || r.ageDays >= f.minAgeDays) && (f.maxAgeDays === undefined || r.ageDays <= f.maxAgeDays)
      && (!q || [r.orderId, ...r.txHashes, ...r.depositAddresses].some((x) => x.toLowerCase().includes(q))));
  });
}

export async function merchantPaymentDetail(ctx: TenantContext, orderId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const [m] = await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, orderId)));
    if (!m) throw new AccessDenied(404, "Not found.");
    const [inv] = await tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, ctx.orgId), eq(t.invoices.orderId, orderId)));
    const split = splitDifferences(await tx.select().from(t.differences).where(and(eq(t.differences.orgId, ctx.orgId), eq(t.differences.orderId, orderId))).orderBy(asc(t.differences.id)));
    const exceptions = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.orderId, orderId)));
    const writeoffs = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.orderId, orderId)));
    const reqIds = writeoffs.map((w) => w.id);
    const approvals = reqIds.length ? await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_writeoff"), inArray(t.approvalRequests.subjectId, reqIds))).orderBy(desc(t.approvalRequests.version)) : [];
    const reviews = await tx.select().from(t.matchReviews).where(and(eq(t.matchReviews.orgId, ctx.orgId), eq(t.matchReviews.orderId, orderId)));
    // rc7 phase 3b: the organisation's label, also over a label stored inside an older record's explanation
    const label = await orgLabel(tx, ctx.orgId);
    return {
      label, orderId, invoice: plain(inv), decision: m.decision, decidingStep: m.decidingStep, ruleId: m.ruleId,
      parts: { chain: m.chain, provider: m.provider, bank: m.bank, ledger: m.ledger }, explanation: { ...(m.explanation as Record<string, unknown>), label } as typeof m.explanation, engineVersion: m.engineVersion, inputSha256: m.inputSha256,
      // v1 phase 0: the current decision's differences; rows an earlier run wrote and a later run superseded, apart
      differences: plainForDisplay(split.current), supersededDifferences: plainForDisplay(split.superseded), exceptions, writeoffs: plainForDisplay(writeoffs),
      approvals: approvals.map((a) => ({ id: a.id, version: a.version, status: a.status, requestedBy: a.requestedBy, payloadSha256: a.payloadSha256 })), reviews,
    };
  });
}

export async function exceptionsQueue(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const open = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`)).orderBy(asc(t.reconExceptions.openedAt), asc(t.reconExceptions.id));
    const review = (await storedRecords(tx, ctx.orgId)).filter((r) => r.rec.decision === "suggested_for_review")
      .map((r) => ({ orderId: r.row.orderId, ruleId: r.row.ruleId, attention: (r.row.explanation as { attention?: unknown }).attention ?? null }));
    return { label: await orgLabel(tx, ctx.orgId), exceptions: open.map((e) => ({ id: e.id, orderId: e.orderId, owner: e.ownerRole, reason: e.reason, nextStep: e.nextStep, status: e.status, openedAt: e.openedAt })), needsReview: review };
  });
}

export async function batchBridge(ctx: TenantContext, batchId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const [b] = await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), eq(t.settlementBatches.batchId, batchId)));
    if (!b?.entityId) throw new AccessDenied(404, "Not found.");
    const bridge = reconcile(await load(tx, ctx, b.entityId)).bridges.find((x) => x.batchId === batchId);
    if (!bridge) throw new AccessDenied(404, "Not found.");
    return { ...(plain(bridge) as Jsonified<BatchBridge>), label: await orgLabel(tx, ctx.orgId), entityId: b.entityId, cutOffNote: PROVIDER_DAY_NOTE };
  });
}

export async function monthEnd(ctx: TenantContext, entityId: string, month: string) {
  require(ctx, "read");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RequestRefused(422, "BAD_MONTH", "Use YYYY-MM.");
  return tenantRead(ctx, async (tx) => {
    const ent = await entityOnly(tx, ctx, entityId);
    const js = await tx.select().from(t.merchantJournalProposals).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId), sql`${t.merchantJournalProposals.status} <> 'superseded'`)).orderBy(asc(t.merchantJournalProposals.id));
    const inMonth = js.filter((j) => { const d = (j.evidenceRefs as { entryDate: string | null }).entryDate; return d === null || d.startsWith(month); });
    const balances: Record<string, bigint> = {};
    for (const j of inMonth) for (const l of j.lines as { side: string; account: string; amountMinor: string }[]) balances[l.account] = (balances[l.account] ?? 0n) + (l.side === "debit" ? 1n : -1n) * BigInt(l.amountMinor);
    const recs = await storedRecords(tx, ctx.orgId, entityId);
    const openAr = recs.reduce((s, r) => s + BigInt(r.rec.ledger.openBalanceMinor), 0n);
    const orders = new Set(recs.map((r) => r.row.orderId));
    const ex = (await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((e) => e.orderId && orders.has(e.orderId));
    const wos = (await tx.select().from(t.writeoffProposals).where(eq(t.writeoffProposals.orgId, ctx.orgId))).filter((w) => orders.has(w.orderId));
    const label = await orgLabel(tx, ctx.orgId);
    return {
      label, entityId, month, currency: ent.functionalCurrency, postingRuleStatus: "pending_sign_off" as const,
      journals: inMonth.map((j) => ({ id: j.id, pattern: j.pattern, status: j.status, postingRuleStatus: j.postingRuleStatus, lines: j.lines, evidence: { ...(j.evidenceRefs as Record<string, unknown>), label } as unknown })),
      balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])), openReceivablesMinor: openAr.toString(), openExceptions: ex.length,
      writeoffs: { pending: wos.filter((w) => w.status !== "approved" && w.status !== "rejected").length, approved: wos.filter((w) => w.status === "approved").length },
    };
  });
}

/** Provider console: aggregates of the provider's own merchants only (SECURITY DEFINER function). */
export async function providerConsole(ctx: TenantContext) {
  require(ctx, "provider_console");
  return tenantRead(ctx, async (tx) => {
    const r = await tx.execute(sql`select merchant_org_id, merchant_name, payments::int, auto_matched::int, exceptions_open::int, oldest_open_exception_at, last_ingestion_at, grant_scope from provider_merchant_health(${ctx.orgId}) order by merchant_name`);
    const [org] = await tx.select({ theme: t.organizations.theme, name: t.organizations.name }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    return { label: await orgLabel(tx, ctx.orgId), provider: org?.name ?? ctx.orgName, theme: org?.theme ?? null, merchants: r.rows };
  });
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function pilotMetrics(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const recs = await storedRecords(tx, ctx.orgId);
    const auto = recs.filter((r) => r.rec.decision === "matched" || r.rec.decision === "matched_with_difference").length;
    const reviews = await tx.select().from(t.matchReviews).where(eq(t.matchReviews.orgId, ctx.orgId));
    const ex = await tx.select().from(t.reconExceptions).where(eq(t.reconExceptions.orgId, ctx.orgId));
    // v1 phase 0: still-open exceptions per 100 reconciled payments (exception-rate.ts), batch not tied apart
    const rate = exceptionRate(exceptionRateCounts(recs.map((r) => ({ orderId: r.rec.orderId, ruleId: r.rec.ruleId, creditedMinor: String(r.rec.ledger.creditedMinor ?? 0) })), ex));
    const resolved = ex.filter((e) => e.closedAt).map((e) => (e.closedAt!.getTime() - e.openedAt.getTime()) / 60_000);
    const entities = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id));
    let batches = 0, tied = 0;
    for (const e of entities) { const b = reconcile(await load(tx, ctx, e.id)).bridges; batches += b.length; tied += b.filter((x) => x.tied).length; }
    const minutes = await tx.select({ n: sql<number>`coalesce(sum(${t.pilotTimeLog.minutes}), 0)::int` }).from(t.pilotTimeLog).where(eq(t.pilotTimeLog.orgId, ctx.orgId));
    const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null);
    return {
      label: await orgLabel(tx, ctx.orgId), payments: recs.length, autoMatchedPct: pct(auto, recs.length),
      reviewedSample: reviews.length, wrongInSample: reviews.filter((r) => r.verdict === "wrong").length,
      exceptionsPer100: rate.per100, exceptionRate: rate, medianMinutesToResolve: median(resolved),
      batches, batchesTiedToTheCent: tied, minutesLogged: minutes[0]?.n ?? 0,
    };
  });
}

export async function recordMatchReview(ctx: TenantContext, orderId: string, input: { verdict: "correct" | "wrong"; note?: string }, idempotencyKey?: string) {
  require(ctx, "review_match");
  const v = z.object({ verdict: z.enum(["correct", "wrong"]), note: z.string().trim().max(1000).optional() }).strict().parse(input);
  // rc6 phase 8: with an Idempotency-Key (the API always sends one) a retried request replays the first answer
  if (idempotencyKey !== undefined) {
    const key = IdempotencyKey.parse(idempotencyKey);
    return (await tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_match_review", orderId, ...v }, async () => ({ status: 200, body: await reviewMatch(tx, ctx, orderId, v) })))).body;
  }
  return tenantTx(ctx, (tx) => reviewMatch(tx, ctx, orderId, v));
}

async function reviewMatch(tx: Tx, ctx: TenantContext, orderId: string, v: { verdict: "correct" | "wrong"; note?: string }) {
  const [m] = await tx.select({ id: t.matchRecords.orderId }).from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, orderId)));
  if (!m) throw new AccessDenied(404, "Not found.");
  await tx.insert(t.matchReviews).values({ orgId: ctx.orgId, orderId, reviewerUserId: ctx.userId, verdict: v.verdict, note: v.note ?? null })
    .onConflictDoUpdate({ target: [t.matchReviews.orgId, t.matchReviews.orderId, t.matchReviews.reviewerUserId], set: { verdict: v.verdict, note: v.note ?? null, reviewedAt: stampNow() } });
  await serverAudit(tx, ctx, "merchant_match_reviewed", "payment", orderId, `Match marked ${v.verdict}`, v);
  return { label: await orgLabel(tx, ctx.orgId), orderId, verdict: v.verdict };
}

export async function logMinutes(ctx: TenantContext, input: { day: string; minutes: number; note?: string }, idempotencyKey?: string) {
  require(ctx, "read");
  const v = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.number().int().min(0).max(1440), note: z.string().trim().max(500).optional() }).strict().parse(input);
  const insert = async (tx: Tx) => {
    const [row] = await tx.insert(t.pilotTimeLog).values({ orgId: ctx.orgId, userId: ctx.userId, day: v.day, minutes: v.minutes, note: v.note ?? null }).returning({ id: t.pilotTimeLog.id });
    return { label: await orgLabel(tx, ctx.orgId), id: row.id };
  };
  // rc6 phase 8: with an Idempotency-Key (the API always sends one) a retried request does not log the minutes twice
  if (idempotencyKey !== undefined) {
    const key = IdempotencyKey.parse(idempotencyKey);
    return (await tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "pilot_minutes", ...v }, async () => ({ status: 201, body: await insert(tx) })))).body;
  }
  return tenantTx(ctx, insert);
}
