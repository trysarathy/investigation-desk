import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { reconcile } from "@/lib/clearline/merchant";
import { DRAFT_MARKING, draftCell, journalDraftCsv, plainAmount, type DraftJournal, type DraftTool } from "@/lib/clearline/exports/journal-drafts";
import { storeZip } from "@/lib/clearline/exports/zip";
import { NEEDS_A_RATE } from "@/lib/clearline/merchant/fiat-value";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { openRows } from "./crypto/fields";
import { can } from "./authz";
import { serverAudit } from "./control";
import { MissingEntity, loadReconcileInput } from "./merchant-store";
import { memberNames, orgLabel, packData } from "./merchant-ui";
import { RULE_SET_VERSION, runState } from "./runs";
import { AccessDenied, requireEntity, type TenantContext, withTenant } from "./tenant";

/**
 * rc7 phase 3b exports, Finance, an Approver or an Admin only (merchant_export; rc8 founder decision 3). FILES only: nothing is posted to any ledger and
 * the posting rules are unchanged (still pending sign-off). Each export is audited with ids, counts and the file's
 * SHA-256 only, never contents.
 *
 * - Draft journal file in Xero's or QuickBooks' manual-journal import layout, for a sandbox / demo company, from the
 *   month's proposed journals whose posting rules are pending sign-off.
 * - Month-end pack: one ZIP with the batch bridges, the open exceptions (owner, reason, next step), the journal
 *   proposals (and both draft layouts), the provenance of every file used, the ledger-invoice comparison, the month's
 *   evidence pack and a manifest (rule-set version, policy revision, latest run, each file's SHA-256).
 */

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const DraftToolInput = z.enum(["xero", "quickbooks"]);

function requireExport(ctx: TenantContext) {
  if (!can(ctx.role, "merchant_export")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow exports.`);
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map((v) => draftCell(v === null || v === undefined ? "" : String(v))).join(",")).join("\r\n") + "\r\n";

async function entityOf(tx: Tx, ctx: TenantContext, entityId: string) {
  requireEntity(ctx, entityId);
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
  if (!ent) throw new AccessDenied(404, "Not found.");
  return ent;
}

async function monthJournals(tx: Tx, ctx: TenantContext, entityId: string, month: string): Promise<DraftJournal[]> {
  const js = await tx.select().from(t.merchantJournalProposals).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId),
    ne(t.merchantJournalProposals.status, "superseded"))).orderBy(asc(t.merchantJournalProposals.id));
  return js.map((j) => {
    const ev = j.evidenceRefs as { entryDate?: string | null; memo?: string };
    return { id: j.id, pattern: j.pattern, status: j.status, postingRuleStatus: j.postingRuleStatus, entryDate: ev.entryDate ?? null, memo: ev.memo ?? "", lines: j.lines as DraftJournal["lines"] };
  }).filter((j) => j.entryDate === null || j.entryDate.startsWith(month));
}
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** A draft journal file for a sandbox ledger: never posted; posting rules pending sign-off. */
export async function journalDraftFile(ctx: TenantContext, entityId: string, month: string, tool: DraftTool) {
  requireExport(ctx);
  const m = Month.parse(month);
  const v = DraftToolInput.parse(tool);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const ent = await entityOf(tx, ctx, entityId);
    const journals = await monthJournals(tx, ctx, entityId, m);
    const d = journalDraftCsv(v, journals, ent.functionalCurrency, lastDay(m));
    const digest = sha256(d.body);
    await serverAudit(tx, ctx, "merchant_journal_draft_exported", "merchant_entity", entityId, `Draft ${v} journal file for ${entityId} ${m}: ${d.journals} journal(s), ${d.lines} line(s); sandbox only, nothing posted (sha256 ${digest.slice(0, 12)}…)`,
      { tool: v, month: m, journals: d.journals, lines: d.lines, sha256: digest });
    return { body: d.body, sha256: digest, journals: d.journals, fileName: `clearline-${v}-journal-DRAFT-${ctx.orgSlug}-${entityId}-${m}.csv`, contentType: "text/csv; charset=utf-8" };
  });
}

/** The month-end pack as one ZIP (the same data gives the same files; the evidence pack's audit trail grows with each export). */
export async function monthEndPack(ctx: TenantContext, entityId: string, month: string) {
  requireExport(ctx);
  const m = Month.parse(month);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const ent = await entityOf(tx, ctx, entityId);
    const label = await orgLabel(tx, ctx.orgId);
    const cur = ent.functionalCurrency;
    const amt = (minor: bigint | string | number) => plainAmount(BigInt(minor), cur);
    let input;
    try { input = await loadReconcileInput(tx, ctx.orgId, entityId); } catch (e) { if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found."); throw e; }
    const { prev, policyRevision } = await runState(tx, ctx.orgId, entityId);
    const names = await memberNames(tx, ctx.orgId);
    const who = (id: string | null) => (id ? names.get(id) ?? "A former member" : "");

    // bridges: the month's settlement batches (provider day in the month), as the engine ties them now
    const bridges = reconcile(input).bridges.filter((b) => b.providerDay.startsWith(m));
    const batches = new Map((bridges.length ? await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), inArray(t.settlementBatches.batchId, bridges.map((b) => b.batchId)))) : []).map((b) => [b.batchId, b]));
    const bridgesCsv = csv([["batch_id", "provider_day", "currency", "gross", "fees", "refunds", "net", "bank_line_id", "bank_line", "tied", "settlement_verified", "bank_evidence", "settled", "payments"],
      ...bridges.map((b) => { const r = batches.get(b.batchId); return [b.batchId, b.providerDay, b.currency, r ? plainAmount(r.grossMinor, b.currency) : "", r ? plainAmount(r.feesMinor, b.currency) : "", r ? plainAmount(r.refundsMinor, b.currency) : "",
        r ? plainAmount(r.netMinor, b.currency) : "", b.bankLineId ?? "", b.bankLineLabel ?? (b.bankLineSource ?? ""), b.tied, b.settlementVerified, b.bankEvidence, b.settled, b.paymentIds.length]; })]);

    // exceptions of the entity's orders that are still open: owner, reason, next step
    const orders = input.invoices.map((i) => i.orderId);
    const exs = orders.length ? await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, orders), sql`${t.reconExceptions.status} <> 'resolved'`)).orderBy(asc(t.reconExceptions.id)) : [];
    const exceptionsCsv = csv([["exception_id", "order_id", "owner_role", "owner", "reason", "next_step", "status", "opened_at"],
      ...exs.map((e) => [e.id, e.orderId, e.ownerRole, who(e.ownerUserId), e.reason, e.nextStep, e.status, e.openedAt.toISOString()])]);

    // journal proposals (all of the month) and the two sandbox draft layouts
    const journals = await monthJournals(tx, ctx, entityId, m);
    const journalsCsv = csv([["journal_id", "entry_date", "pattern", "status", "posting_rule_status", "side", "account", "amount", "currency", "memo"],
      ...journals.flatMap((j) => j.lines.map((l) => [j.id, j.entryDate ?? "", j.pattern, j.status, j.postingRuleStatus, l.side, l.account, amt(l.amountMinor), cur, j.memo]))]);
    const xero = journalDraftCsv("xero", journals, cur, lastDay(m)), qbo = journalDraftCsv("quickbooks", journals, cur, lastDay(m));

    // provenance of every file used for this entity (uploads that reached reconciliation)
    const ups = await tx.select().from(t.uploads).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.entityId, entityId), eq(t.uploads.status, "normalised"))).orderBy(asc(t.uploads.createdAt));
    const provenanceCsv = csv([["upload_id", "file_type", "file_format", "file_name", "sha256", "rows", "accepted", "warnings", "rejected", "duplicates", "template_id", "template_version", "uploaded_by", "confirmed_by", "confirmed_at", "normalised_at", "delete_after"],
      ...ups.map((u) => [u.id, u.fileType, u.fileFormat, u.originalName, u.contentSha256, u.rowCount, u.acceptedCount, u.warningCount, u.rejectedCount, u.duplicateCount, u.templateId ?? "", u.templateVersion ?? "",
        who(u.uploadedBy), who(u.confirmedBy), u.confirmedAt?.toISOString() ?? "", u.normalisedAt?.toISOString() ?? "", u.deleteAfter.toISOString()])]);

    // ledger invoices against the orders in reconciliation (reference only; never changes a decision)
    const ledger = await openRows(tx, ctx.orgId, "ledger_invoices", await tx.select().from(t.ledgerInvoices).where(and(eq(t.ledgerInvoices.orgId, ctx.orgId), eq(t.ledgerInvoices.entityId, entityId))).orderBy(asc(t.ledgerInvoices.invoiceNumber)));
    const inv = new Map(input.invoices.map((i) => [i.orderId, i]));
    // v1 (#173): a token-priced order has no fiat price; its fiat value is the stored record's, at a recorded rate, or
    // "needs a rate" (never 0, and never compared as if it were 0)
    const priced = input.invoices.filter((i) => i.price).map((i) => i.orderId);
    const rated = new Map((priced.length ? await tx.select({ orderId: t.matchRecords.orderId, ledger: t.matchRecords.ledger }).from(t.matchRecords)
      .where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.orderId, priced))) : [])
      .map((r) => [r.orderId, (r.ledger as { fiatValue?: { status: string; amountMinor?: string } }).fiatValue] as const)
      .filter(([, f]) => f?.status === "rated").map(([id, f]) => [id, BigInt(f!.amountMinor!)] as const));
    const orderFiat = (o: (typeof input.invoices)[number]) => (o.price ? rated.get(o.orderId) : o.amountMinor);
    const ledgerCsv = csv([["invoice_number", "order_ref", "ledger_total", "ledger_amount_due", "ledger_status", "order_amount", "comparison"],
      ...ledger.map((l) => { const o = l.orderRef ? inv.get(l.orderRef) : undefined; const of = o ? orderFiat(o) : undefined; return [l.invoiceNumber, l.orderRef ?? "", amt(l.totalMinor), l.amountDueMinor === null ? "" : amt(l.amountDueMinor), l.status,
        !o ? "" : of === undefined ? NEEDS_A_RATE : amt(of), !l.orderRef ? "no_order_reference" : !o ? "order_not_in_reconciliation" : of === undefined ? "order_fiat_value_needs_rate" : of === l.totalMinor && l.currency === o.currency ? "same_amount" : "amount_differs"]; })]);

    const evidence = JSON.stringify(await packData(tx, ctx, { kind: "month", entityId, month: m }), null, 2) + "\n";
    const files: [string, string][] = [
      ["bridges.csv", bridgesCsv], ["exceptions.csv", exceptionsCsv], ["journal-proposals.csv", journalsCsv], ["xero-manual-journal-DRAFT.csv", xero.body],
      ["quickbooks-journal-DRAFT.csv", qbo.body], ["provenance.csv", provenanceCsv], ["ledger-invoices.csv", ledgerCsv], ["evidence-pack.json", evidence],
    ];
    const manifest = {
      label, marking: DRAFT_MARKING, organisation: ctx.orgName, entity: { id: ent.id, name: ent.name, currency: cur, timezone: ent.timezone, ledger: ent.ledger }, month: m,
      ruleSetVersion: prev?.ruleSetVersion ?? RULE_SET_VERSION, currentRuleSetVersion: RULE_SET_VERSION, policyRevision, latestRun: prev ? { id: prev.id, at: prev.finishedAt.toISOString(), status: prev.status, inputSha256: prev.inputSha256 } : null,
      postingRuleStatus: "pending_sign_off", note: "Files only. Nothing was posted to any ledger. Journal drafts are for a sandbox / demo company and need an accountant's review.",
      counts: { bridges: bridges.length, openExceptions: exs.length, journals: journals.length, draftedJournals: xero.journals, files: ups.length, ledgerInvoices: ledger.length },
      files: files.map(([name, body]) => ({ name, sha256: sha256(body) })),
    };
    const zip = storeZip([["manifest.json", JSON.stringify(manifest, null, 2) + "\n"] as [string, string], ...files].map(([name, data]) => ({ name, data })), lastDay(m));
    const digest = sha256(zip);
    await serverAudit(tx, ctx, "merchant_month_end_pack_exported", "merchant_entity", entityId, `Month-end pack for ${entityId} ${m}: ${files.length + 1} files, ${journals.length} journal proposal(s), ${exs.length} open exception(s), ${ups.length} source file(s) (sha256 ${digest.slice(0, 12)}…)`,
      { month: m, sha256: digest, counts: manifest.counts, uploadIds: ups.map((u) => u.id), journalIds: journals.map((j) => j.id), ruleSetVersion: manifest.ruleSetVersion, policyRevision });
    return { body: zip, sha256: digest, fileName: `clearline-month-end-${ctx.orgSlug}-${entityId}-${m}.zip`, contentType: "application/zip", manifest };
  });
}

/** The latest month that has journal proposals or reconciled payments for an entity (for the export screen). */
export async function exportMonths(ctx: TenantContext, entityId: string) {
  requireExport(ctx);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    await entityOf(tx, ctx, entityId);
    const rows = await tx.select({ d: sql<string | null>`${t.merchantJournalProposals.evidenceRefs} ->> 'entryDate'` }).from(t.merchantJournalProposals)
      .where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId))).orderBy(desc(t.merchantJournalProposals.id));
    return [...new Set(rows.map((r) => r.d?.slice(0, 7)).filter((x): x is string => !!x))].sort();
  }, { read: true });
}

/**
 * v1 overnight: results as plain CSV for a spreadsheet. kind "exceptions": every open exception with its owner, reason
 * and next step; kind "matched": every payment decided matched or matched_with_difference, with its rule and the bank
 * evidence level. Same role rule as the other exports, entity scope applied, formula-safe cells, audited, hashed.
 */
export const ResultsKind = z.enum(["exceptions", "matched"]);
export async function resultsCsv(ctx: TenantContext, kind: z.infer<typeof ResultsKind>) {
  requireExport(ctx);
  const k = ResultsKind.parse(kind);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const inScope = (entityId: string | null) => ctx.entityScope === null || (entityId !== null && ctx.entityScope.includes(entityId));
    let rows: unknown[][];
    if (k === "exceptions") {
      const names = await memberNames(tx, ctx.orgId);
      const ex = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), ne(t.reconExceptions.status, "resolved")))
        .orderBy(asc(t.reconExceptions.openedAt), asc(t.reconExceptions.id));
      rows = [["exception_id", "order_id", "entity", "status", "owner_role", "owner", "reason", "next_step", "opened_at"],
        ...ex.filter((e) => inScope(e.entityId)).map((e) => [e.id, e.orderId, e.entityId, e.status, e.ownerRole, e.ownerUserId ? names.get(e.ownerUserId) ?? "A former member" : "", e.reason, e.nextStep, e.openedAt.toISOString()])];
    } else {
      const recs = await tx.select({ orderId: t.matchRecords.orderId, decision: t.matchRecords.decision, ruleId: t.matchRecords.ruleId, bankEvidence: t.matchRecords.bankEvidence,
        settled: t.matchRecords.settled, computedAt: t.matchRecords.computedAt, entityId: t.invoices.entityId }).from(t.matchRecords)
        .innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
        .where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.decision, ["matched", "matched_with_difference"]))).orderBy(asc(t.matchRecords.orderId));
      rows = [["order_id", "entity", "decision", "rule", "bank_evidence", "settled", "decided_at"],
        ...recs.filter((r) => inScope(r.entityId)).map((r) => [r.orderId, r.entityId, r.decision, r.ruleId, r.bankEvidence, r.settled ? "yes" : "no", r.computedAt.toISOString()])];
    }
    const body = csv(rows);
    const digest = sha256(body);
    await serverAudit(tx, ctx, "merchant_results_exported", "organization", ctx.orgId, `${k === "exceptions" ? "Open exceptions" : "Matched payments"} CSV: ${rows.length - 1} row(s) (sha256 ${digest.slice(0, 12)}…)`,
      { format: "csv", scope: k, counts: { rows: rows.length - 1 }, sha256: digest });
    return { body, sha256: digest, fileName: `clearline-${k}-${ctx.orgSlug}-${new Date().toISOString().slice(0, 10)}.csv`, contentType: "text/csv; charset=utf-8" };
  });
}
