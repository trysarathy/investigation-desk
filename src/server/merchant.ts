import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  IMPORTED_BANK_LINE_LABEL, TEST_MODE_LABEL, fmtFiat, localDate, proposeJournals, reconcile,
  type BatchBridge, type Decision as MatchDecision, type FiatCurrency, type ReconcileInput,
} from "@/lib/clearline/merchant";
import { stableJson } from "@/lib/clearline/merchant/adapters";
import type { StatementLineInput } from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { Decision, IdempotencyKey, canonical, idempotent, serverAudit } from "./control";
import { MissingEntity, type IngestParts, loadReconcileInput, plain, writeIngested } from "./merchant-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * rc6 Merchant Reconciliation services. Every function takes a TenantContext built on the server from the session
 * and runs in one RLS-scoped tenant transaction. Read-only domain: nothing holds, sends, converts or settles money.
 * The engine decides matches; this layer persists them, adds permissions, idempotency, two-person write-off approval
 * and audit, and serves read models. Every output carries "Test mode · illustrative data".
 */

export const MERCHANT_ENGINE_VERSION = "rc6-merchant-engine/1";
export const PROVIDER_DAY_NOTE = "provider day = UTC";
const LABEL = TEST_MODE_LABEL;
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

async function load(tx: Tx, ctx: TenantContext, entityId: string) {
  try { return await loadReconcileInput(tx, ctx.orgId, entityId); } catch (e) {
    if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found.");
    throw e;
  }
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
    return { status: 200, body: { label: LABEL, entityId, written } };
  }));
}

/**
 * Load the entity's rows → reconcile → persist the five parts, differences (append-only), exceptions, write-off
 * proposals and journal proposals (always pending sign-off) → audit. An identical rerun changes nothing.
 */
export async function runReconciliation(ctx: TenantContext, entityId: string, idempotencyKey: string) {
  require(ctx, "merchant_reconcile");
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_reconcile", entityId }, async () => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|merchant_reconcile|${entityId}`}))`);
    const input = await load(tx, ctx, entityId);
    const hash = inputSha256(input);
    const orderIds = input.invoices.map((i) => i.orderId);
    const prior = orderIds.length ? await tx.select({ orderId: t.matchRecords.orderId, sha: t.matchRecords.inputSha256, ver: t.matchRecords.engineVersion }).from(t.matchRecords)
      .where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.orderId, orderIds))) : [];
    if (orderIds.length && prior.length === orderIds.length && prior.every((p) => p.sha === hash && p.ver === MERCHANT_ENGINE_VERSION)) {
      return { status: 200, body: { label: LABEL, entityId, inputSha256: hash, engineVersion: MERCHANT_ENGINE_VERSION, changed: false } };
    }
    const result = reconcile(input);
    const journals = proposeJournals(input, result);
    const now = new Date();
    const diffIdOf = new Map(result.records.flatMap((r) => r.explanation.differences.map((d) => [`${r.orderId}|${d.id}`, contentId(d.id, { orderId: r.orderId, type: d.type, amountMinor: d.amountMinor, currency: d.currency, ruleId: d.ruleId })] as const)));
    const woIdOf = new Map(result.writeOffs.map((w) => [w.id, contentId(w.id, { orderId: w.orderId, amountMinor: w.amountMinor, direction: w.direction, currency: w.currency, differenceIds: w.differenceIds.map((id) => diffIdOf.get(`${w.orderId}|${id}`)) })]));
    for (const r of result.records) {
      const explanation = { ...r.explanation, differences: r.explanation.differences.map((d) => ({ ...d, persistedId: diffIdOf.get(`${r.orderId}|${d.id}`) })) };
      const row = {
        decision: r.explanation.decision, decidingStep: r.explanation.decidingStep, ruleId: r.explanation.ruleId,
        chain: plain(r.chain) as object, provider: plain(r.provider) as object, bank: plain(r.bank) as object, ledger: plain(r.ledger) as object,
        explanation: plain({ ...explanation, attention: r.attention ?? null, label: r.label }) as object, engineVersion: MERCHANT_ENGINE_VERSION, inputSha256: hash, computedAt: now,
      };
      await tx.insert(t.matchRecords).values({ orgId: ctx.orgId, orderId: r.orderId, ...row }).onConflictDoUpdate({ target: [t.matchRecords.orgId, t.matchRecords.orderId], set: row });
    }
    const diffs = result.records.flatMap((r) => r.explanation.differences.map((d) => ({ orgId: ctx.orgId, id: diffIdOf.get(`${r.orderId}|${d.id}`)!, orderId: r.orderId, type: d.type, amountMinor: d.amountMinor, currency: d.currency, reason: d.reason, ruleId: d.ruleId })));
    const newDiffs = diffs.length ? await tx.insert(t.differences).values(diffs).onConflictDoNothing().returning({ id: t.differences.id }) : [];
    const exIds = new Set(result.exceptions.map((e) => e.id));
    for (const e of result.exceptions) {
      await tx.insert(t.reconExceptions).values({ orgId: ctx.orgId, id: e.id, orderId: e.orderId ?? null, ownerRole: e.owner, reason: e.reason, nextStep: e.nextStep, status: "open", openedAt: now })
        .onConflictDoUpdate({ target: [t.reconExceptions.orgId, t.reconExceptions.id], set: { ownerRole: e.owner, reason: e.reason, nextStep: e.nextStep, status: sql`case when ${t.reconExceptions.status} = 'resolved' then 'open' else ${t.reconExceptions.status} end`, closedAt: null } });
    }
    const stale = orderIds.length ? (await tx.select({ id: t.reconExceptions.id }).from(t.reconExceptions)
      .where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, orderIds), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((x) => !exIds.has(x.id)) : [];
    for (const x of stale) await tx.update(t.reconExceptions).set({ status: "resolved", closedAt: now }).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, x.id)));
    const newWo = result.writeOffs.length ? await tx.insert(t.writeoffProposals).values(result.writeOffs.map((w) => ({
      orgId: ctx.orgId, id: woIdOf.get(w.id)!, orderId: w.orderId, amountMinor: w.amountMinor, currency: w.currency,
      differenceIds: w.differenceIds.map((id) => diffIdOf.get(`${w.orderId}|${id}`)!), status: "proposed",
    }))).onConflictDoNothing().returning({ id: t.writeoffProposals.id }) : [];
    // a write-off the engine no longer proposes (the payment changed) is superseded, with any pending request for it
    const currentWo = new Set(woIdOf.values());
    const oldWo = orderIds.length ? (await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.orderId, orderIds),
      inArray(t.writeoffProposals.status, ["proposed", "awaiting_approval"])))).filter((w) => !currentWo.has(w.id)) : [];
    for (const w of oldWo) {
      await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: now }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_writeoff"), eq(t.approvalRequests.subjectId, w.id), eq(t.approvalRequests.status, "pending")));
      await tx.update(t.writeoffProposals).set({ status: "superseded" }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, w.id)));
    }
    for (const j of journals) {
      // Document A "(on approval)" lines name the approval they wait for; write-off ids map to their stored ids.
      const lines = j.lines.map((l) => (l.onApproval ? { ...l, onApproval: woIdOf.get(l.onApproval) ?? l.onApproval } : l));
      const row = { entityId, pattern: j.kind, lines: plain(lines) as object, currency: j.currency,
        evidenceRefs: plain({ ...j.evidence, ruleId: j.ruleId, entryDate: j.entryDate, memo: j.memo, requiresApprovalOf: j.requiresApprovalOf ? woIdOf.get(j.requiresApprovalOf) ?? j.requiresApprovalOf : null, label: j.label }) as object };
      await tx.insert(t.merchantJournalProposals).values({ orgId: ctx.orgId, id: j.id, ...row, status: "proposed", postingRuleStatus: "pending_sign_off" })
        .onConflictDoUpdate({ target: [t.merchantJournalProposals.orgId, t.merchantJournalProposals.id], set: row, setWhere: sql`${t.merchantJournalProposals.status} = 'proposed'` });
    }
    const keep = journals.map((j) => j.id);
    await tx.update(t.merchantJournalProposals).set({ status: "superseded" }).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId),
      eq(t.merchantJournalProposals.status, "proposed"), keep.length ? sql`${t.merchantJournalProposals.id} not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})` : sql`true`));
    const counts = { records: result.records.length, newDifferences: newDiffs.length, exceptions: result.exceptions.length, resolvedExceptions: stale.length, newWriteoffs: newWo.length, supersededWriteoffs: oldWo.length, journals: journals.length };
    await serverAudit(tx, ctx, "merchant_reconciliation_run", "merchant_entity", entityId,
      `Reconciled ${counts.records} payments (engine ${MERCHANT_ENGINE_VERSION}, input sha256 ${hash.slice(0, 12)}…): ${counts.exceptions} exceptions, ${counts.newWriteoffs} new write-off proposals, ${counts.journals} journal proposals pending sign-off`,
      { inputSha256: hash, engineVersion: MERCHANT_ENGINE_VERSION, ...counts });
    return { status: 200, body: { label: LABEL, entityId, inputSha256: hash, engineVersion: MERCHANT_ENGINE_VERSION, changed: true, ...counts } };
  }));
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
    const r = await tx.update(t.merchantPolicy).set({ ...p, revision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(t.merchantPolicy.orgId, ctx.orgId), eq(t.merchantPolicy.entityId, entityId), eq(t.merchantPolicy.revision, expectedRevision))).returning({ revision: t.merchantPolicy.revision });
    if (!r.length) throw new RequestRefused(409, "STALE_POLICY", "The policy changed since you read it (or does not exist). Reload it and try again.");
    await serverAudit(tx, ctx, "merchant_policy_updated", "merchant_entity", entityId, `Matching policy revision ${r[0].revision}: ${Object.keys(p).join(", ")}`, plain(p));
    return { status: 200, body: { label: LABEL, entityId, revision: r[0].revision } };
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
      label: LABEL, writeoffId: wo.id, orderId: wo.orderId, amountMinor: wo.amountMinor.toString(), currency: wo.currency, differenceIds: ids,
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
    for (const r of prior.filter((x) => x.status === "pending")) await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, r.id)));
    const version = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const payload = { ...binding, version };
    const payloadSha256 = sha256(canonical(payload));
    const [req] = await tx.insert(t.approvalRequests).values({ orgId: ctx.orgId, subjectKind: "merchant_writeoff", subjectId: writeoffId, version, payload, payloadSha256, requestedBy: ctx.userId }).returning();
    await tx.update(t.writeoffProposals).set({ status: "awaiting_approval", approvalRequestId: req.id, preparedBy: ctx.userId }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, writeoffId)));
    await serverAudit(tx, ctx, "merchant_writeoff_requested", "writeoff", writeoffId, `Write-off ${writeoffId} v${version} (${fmtFiat(wo.amountMinor, wo.currency as FiatCurrency)}) submitted for a second person's approval (sha256 ${payloadSha256.slice(0, 12)}…)`, { requestId: req.id });
    return { status: 201, body: { label: LABEL, requestId: req.id, writeoffId, version, payloadSha256, payload } };
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
    await tx.update(t.approvalRequests).set({ status, closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId)));
    await tx.update(t.writeoffProposals).set({ status }).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.id, wo.id)));
    await serverAudit(tx, ctx, d.decision === "approve" ? "merchant_writeoff_approved" : "merchant_writeoff_rejected", "writeoff", wo.id, `${status === "approved" ? "Approved" : "Rejected"} write-off ${wo.id} v${req.version} by a second person: ${d.reason}`, { requestId, payloadSha256: d.payloadSha256 });
    return { status: 200, body: { label: LABEL, requestId, writeoffId: wo.id, status } };
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
    return { status: 200, body: { label: LABEL, importId, entityId, bankLineIds: written.map((w) => w.id), skipped: (imp.lines as unknown[]).length - staged.length, bankLineLabel: IMPORTED_BANK_LINE_LABEL } };
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
      label: LABEL, entityId, date, timeZone: input.entity.timeZone.name, cutOffNote: PROVIDER_DAY_NOTE,
      payments: recs.length, settlementsTied: tied, settlements: bridges.length, exceptions: ex.length, writeoffsAwaitingApproval: wos.length,
      summary: `${plural(recs.length, "payment")} · ${plural(tied, "settlement")} tied · ${plural(ex.length, "exception")} · ${plural(wos.length, "write-off")} awaiting approval`,
    };
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
    const rows = (await storedRecords(tx, ctx.orgId, f.entityId)).map(({ rec, inv }) => {
      const tr = rec.chain.transfers;
      const deposit = [...quotes.filter((q) => q.orderId === rec.orderId).map((q) => q.depositAddress), ...links.filter((l) => l.orderId === rec.orderId).map((l) => l.depositAddress)];
      return {
        label: LABEL, orderId: rec.orderId, entityId: inv.entityId, decision: rec.decision, ruleId: rec.ruleId, invoiceMinor: inv.amountMinor.toString(), currency: inv.currency,
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
    const diffs = await tx.select().from(t.differences).where(and(eq(t.differences.orgId, ctx.orgId), eq(t.differences.orderId, orderId))).orderBy(asc(t.differences.id));
    const exceptions = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.orderId, orderId)));
    const writeoffs = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.orderId, orderId)));
    const reqIds = writeoffs.map((w) => w.id);
    const approvals = reqIds.length ? await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_writeoff"), inArray(t.approvalRequests.subjectId, reqIds))).orderBy(desc(t.approvalRequests.version)) : [];
    const reviews = await tx.select().from(t.matchReviews).where(and(eq(t.matchReviews.orgId, ctx.orgId), eq(t.matchReviews.orderId, orderId)));
    return {
      label: LABEL, orderId, invoice: plain(inv), decision: m.decision, decidingStep: m.decidingStep, ruleId: m.ruleId,
      parts: { chain: m.chain, provider: m.provider, bank: m.bank, ledger: m.ledger }, explanation: m.explanation, engineVersion: m.engineVersion, inputSha256: m.inputSha256,
      differences: plain(diffs), exceptions, writeoffs: plain(writeoffs),
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
    return { label: LABEL, exceptions: open.map((e) => ({ id: e.id, orderId: e.orderId, owner: e.ownerRole, reason: e.reason, nextStep: e.nextStep, status: e.status, openedAt: e.openedAt })), needsReview: review };
  });
}

export async function batchBridge(ctx: TenantContext, batchId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const [b] = await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), eq(t.settlementBatches.batchId, batchId)));
    if (!b?.entityId) throw new AccessDenied(404, "Not found.");
    const bridge = reconcile(await load(tx, ctx, b.entityId)).bridges.find((x) => x.batchId === batchId);
    if (!bridge) throw new AccessDenied(404, "Not found.");
    return { ...(plain(bridge) as Jsonified<BatchBridge>), label: LABEL, entityId: b.entityId, cutOffNote: PROVIDER_DAY_NOTE };
  });
}

export async function monthEnd(ctx: TenantContext, entityId: string, month: string) {
  require(ctx, "read");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RequestRefused(422, "BAD_MONTH", "Use YYYY-MM.");
  return tenantRead(ctx, async (tx) => {
    const input = await load(tx, ctx, entityId);
    const js = await tx.select().from(t.merchantJournalProposals).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId), sql`${t.merchantJournalProposals.status} <> 'superseded'`)).orderBy(asc(t.merchantJournalProposals.id));
    const inMonth = js.filter((j) => { const d = (j.evidenceRefs as { entryDate: string | null }).entryDate; return d === null || d.startsWith(month); });
    const balances: Record<string, bigint> = {};
    for (const j of inMonth) for (const l of j.lines as { side: string; account: string; amountMinor: string }[]) balances[l.account] = (balances[l.account] ?? 0n) + (l.side === "debit" ? 1n : -1n) * BigInt(l.amountMinor);
    const recs = await storedRecords(tx, ctx.orgId, entityId);
    const openAr = recs.reduce((s, r) => s + BigInt(r.rec.ledger.openBalanceMinor), 0n);
    const orders = new Set(recs.map((r) => r.row.orderId));
    const ex = (await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((e) => e.orderId && orders.has(e.orderId));
    const wos = (await tx.select().from(t.writeoffProposals).where(eq(t.writeoffProposals.orgId, ctx.orgId))).filter((w) => orders.has(w.orderId));
    return {
      label: LABEL, entityId, month, currency: input.entity.functionalCurrency, postingRuleStatus: "pending_sign_off" as const,
      journals: inMonth.map((j) => ({ id: j.id, pattern: j.pattern, status: j.status, postingRuleStatus: j.postingRuleStatus, lines: j.lines, evidence: j.evidenceRefs })),
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
    return { label: LABEL, provider: org?.name ?? ctx.orgName, theme: org?.theme ?? null, merchants: r.rows };
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
    const resolved = ex.filter((e) => e.closedAt).map((e) => (e.closedAt!.getTime() - e.openedAt.getTime()) / 60_000);
    const entities = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id));
    let batches = 0, tied = 0;
    for (const e of entities) { const b = reconcile(await load(tx, ctx, e.id)).bridges; batches += b.length; tied += b.filter((x) => x.tied).length; }
    const minutes = await tx.select({ n: sql<number>`coalesce(sum(${t.pilotTimeLog.minutes}), 0)::int` }).from(t.pilotTimeLog).where(eq(t.pilotTimeLog.orgId, ctx.orgId));
    const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null);
    return {
      label: LABEL, payments: recs.length, autoMatchedPct: pct(auto, recs.length),
      reviewedSample: reviews.length, wrongInSample: reviews.filter((r) => r.verdict === "wrong").length,
      exceptionsPer100: recs.length ? Math.round((ex.length * 1000) / recs.length) / 10 : null, medianMinutesToResolve: median(resolved),
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
    .onConflictDoUpdate({ target: [t.matchReviews.orgId, t.matchReviews.orderId, t.matchReviews.reviewerUserId], set: { verdict: v.verdict, note: v.note ?? null, reviewedAt: new Date() } });
  await serverAudit(tx, ctx, "merchant_match_reviewed", "payment", orderId, `Match marked ${v.verdict}`, v);
  return { label: LABEL, orderId, verdict: v.verdict };
}

export async function logMinutes(ctx: TenantContext, input: { day: string; minutes: number; note?: string }, idempotencyKey?: string) {
  require(ctx, "read");
  const v = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.number().int().min(0).max(1440), note: z.string().trim().max(500).optional() }).strict().parse(input);
  const insert = async (tx: Tx) => {
    const [row] = await tx.insert(t.pilotTimeLog).values({ orgId: ctx.orgId, userId: ctx.userId, day: v.day, minutes: v.minutes, note: v.note ?? null }).returning({ id: t.pilotTimeLog.id });
    return { label: LABEL, id: row.id };
  };
  // rc6 phase 8: with an Idempotency-Key (the API always sends one) a retried request does not log the minutes twice
  if (idempotencyKey !== undefined) {
    const key = IdempotencyKey.parse(idempotencyKey);
    return (await tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "pilot_minutes", ...v }, async () => ({ status: 201, body: await insert(tx) })))).body;
  }
  return tenantTx(ctx, insert);
}
