import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { BANK_EVIDENCE_SHORT, MERCHANT_ACCOUNTS, reconcile, type BankEvidenceLevel, type FiatCurrency } from "@/lib/clearline/merchant";
import { endOfLocalDay } from "@/lib/clearline/merchant/fx";
import { proposeRevaluations, type ForeignBalance } from "@/lib/clearline/merchant/revaluation";
import { DRAFT_MARKING } from "@/lib/clearline/exports/journal-drafts";
import { monthEndChecks, monthEndPdf, monthEndXlsx, type MonthEndPackModel, type PackJournalLine } from "@/lib/clearline/exports/month-end-pack";
import { postingRulesCatalogue } from "@/lib/clearline/merchant/posting-rules";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { serverAudit } from "./control";
import { MissingEntity, loadReconcileInput, normRate } from "./merchant-store";
import { AGE_BUCKETS, memberNames, orgLabel, packData, partsOf, receivableFromProvider } from "./merchant-ui";
import { journalSignOffLabel } from "./posting-rules";
import { AccessDenied, requireEntity, type TenantContext, withTenant } from "./tenant";

/**
 * v1 phase 4: the month-end pack as a PDF or an XLSX (src/lib/clearline/exports/month-end-pack.ts), built from the
 * database in one transaction. Finance, an Approver or an Admin (merchant_export), like every merchant export; the
 * export is audited with ids, counts and the file's SHA-256 only. Nothing is posted.
 */
export const MonthEndFormat = z.enum(["pdf", "xlsx"]);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** The pack's model. `agesAsOf` (ISO) fixes the instant exception ages are measured from; default now. */
export async function monthEndPackModel(tx: Tx, ctx: TenantContext, entityId: string, month: string, agesAsOf?: string): Promise<MonthEndPackModel> {
  requireEntity(ctx, entityId);
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
  if (!ent) throw new AccessDenied(404, "Not found.");
  const cur = ent.functionalCurrency as FiatCurrency;
  let input;
  try { input = await loadReconcileInput(tx, ctx.orgId, entityId); } catch (e) { if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found."); throw e; }
  const names = await memberNames(tx, ctx.orgId);
  const who = (id: string | null | undefined) => (id ? names.get(id) ?? "A former member" : "");

  // posting rules: signed for the CURRENT version, read in this transaction (fail closed)
  const cat = postingRulesCatalogue();
  const [sig] = await tx.select().from(t.postingRulesSignatures).where(and(eq(t.postingRulesSignatures.orgId, ctx.orgId), sql`${t.postingRulesSignatures.revokedAt} is null`))
    .orderBy(desc(t.postingRulesSignatures.signedAt)).limit(1);
  const signed = sig?.version === cat.version;

  // bridges: the month's batches as the engine ties them now (as the ZIP pack)
  const bridges = reconcile(input).bridges.filter((b) => b.providerDay.startsWith(month));
  const batchRows = new Map((bridges.length ? await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), inArray(t.settlementBatches.batchId, bridges.map((b) => b.batchId)))) : []).map((b) => [b.batchId, b]));

  // the entity's stored match records (receivable, evidence)
  const recs = (await tx.select({ m: t.matchRecords }).from(t.matchRecords).innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
    .where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.invoices.entityId, entityId))).orderBy(asc(t.matchRecords.orderId))).map((r) => r.m);
  const receivable = receivableFromProvider(recs, month, ent.utcOffsetMinutes);

  // exceptions of the entity's orders still open, by age
  const orders = input.invoices.map((i) => i.orderId);
  const exs = orders.length ? await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, orders), sql`${t.reconExceptions.status} <> 'resolved'`)).orderBy(asc(t.reconExceptions.id)) : [];
  const ref = agesAsOf ? Date.parse(agesAsOf) : Date.now();
  const bucketOf = (days: number) => AGE_BUCKETS.find((b, i) => days < b.max && (i === 0 || days >= AGE_BUCKETS[i - 1].max))!.label;
  const exceptions = exs.map((e) => { const d = Math.max(0, (ref - e.openedAt.getTime()) / 86_400_000); return { id: e.id, orderId: e.orderId ?? "", ownerRole: e.ownerRole, owner: who(e.ownerUserId), reason: e.reason, nextStep: e.nextStep, openedAt: e.openedAt.toISOString(), ageDays: Math.floor(d), bucket: bucketOf(d) }; });

  // the month's evidence (the same selection as the month's evidence pack)
  const pack = await packData(tx, ctx, { kind: "month", entityId, month });
  const recById = new Map(recs.map((r) => [r.orderId, r]));
  const evidence = pack.payments.map((p) => ({ orderId: p.orderId, decision: p.decision, bankEvidence: p.bankEvidence as BankEvidenceLevel, bankEvidenceLabel: BANK_EVIDENCE_SHORT[p.bankEvidence as BankEvidenceLevel] ?? p.bankEvidenceLabel, settled: p.settled,
    chainTransfers: partsOf(recById.get(p.orderId)!).chain.transfers.length, providerRecords: partsOf(recById.get(p.orderId)!).provider.records.length,
    packPath: `/api/control/merchant/evidence?order=${encodeURIComponent(p.orderId)}&format=pdf` }));

  // write-offs of the month's payments: preparer (who submitted it) and approver (the deciding Approver)
  const monthOrders = evidence.map((e) => e.orderId);
  const wos = monthOrders.length ? await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.orderId, monthOrders), ne(t.writeoffProposals.status, "superseded"))).orderBy(asc(t.writeoffProposals.id)) : [];
  const reqIds = wos.map((w) => w.approvalRequestId).filter((x): x is string => !!x);
  const reqs = reqIds.length ? await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), inArray(t.approvalRequests.id, reqIds))) : [];
  const decs = reqIds.length ? await tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.orgId, ctx.orgId), inArray(t.approvalDecisions.requestId, reqIds))).orderBy(asc(t.approvalDecisions.createdAt)) : [];
  const writeoffs = wos.map((w) => {
    const r = reqs.find((x) => x.id === w.approvalRequestId);
    const d = decs.filter((x) => x.requestId === w.approvalRequestId && (x.decision === "approve" || x.decision === "approved" || x.decision === "reject" || x.decision === "rejected")).at(-1);
    return { id: w.id, orderId: w.orderId, amountMinor: w.amountMinor.toString(), currency: w.currency, status: w.status, preparedBy: who(w.preparedBy ?? r?.requestedBy), approvedBy: d && /^approve/.test(d.decision) ? who(d.decidedBy) : "", decidedAt: d?.createdAt.toISOString() ?? "" };
  });

  // FX: other-currency balances still open at the period end, revalued by the engine at the recorded closing rate
  const closingAt = endOfLocalDay(lastDay(month), ent.utcOffsetMinutes);
  const rateRows = await tx.select().from(t.fiatRates).where(and(eq(t.fiatRates.orgId, ctx.orgId), eq(t.fiatRates.quoteCurrency, cur))).orderBy(asc(t.fiatRates.asOf));
  const rates = rateRows.map((r) => ({ pair: `${r.baseCurrency}/${r.quoteCurrency}`, rate: normRate(r.rate), asOf: r.asOf.toISOString(), source: r.sourceLabel }));
  const foreign: ForeignBalance[] = [...new Set(receivable.filter((g) => g.currency !== cur).map((g) => g.currency))].map((c) => ({
    account: "provider_clearing", currency: c as FiatCurrency, foreignMinor: receivable.filter((g) => g.currency === c).reduce((s, g) => s + g.creditedMinor, 0n),
    // [ASSUMPTION, decision needed] FX1 (booking an other-currency credit) is not built, so the carrying value is not known
    carryingMinor: null, ref: `receivable from the provider in ${c}`,
  }));
  const entity = { id: ent.id, name: ent.name, functionalCurrency: cur, ledger: ent.ledger, timeZone: { name: ent.timezone, utcOffsetMinutes: ent.utcOffsetMinutes } };
  const rv = proposeRevaluations(entity, lastDay(month), foreign, rates);
  const usedRates = rates.filter((r) => Date.parse(r.asOf) <= Date.parse(closingAt) && Date.parse(closingAt) - Date.parse(r.asOf) <= 24 * 3600 * 1000);

  // journals of the month (as the ZIP pack), labelled by the sign-off state
  const js = await tx.select().from(t.merchantJournalProposals).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.entityId, entityId), ne(t.merchantJournalProposals.status, "superseded"))).orderBy(asc(t.merchantJournalProposals.id));
  const journals = js.map((j) => ({ j, ev: j.evidenceRefs as { entryDate?: string | null; requiresApprovalOf?: string | null } })).filter(({ ev }) => !ev.entryDate || ev.entryDate.startsWith(month)).map(({ j, ev }) => ({
    id: j.id, entryDate: ev.entryDate ?? "", pattern: j.pattern, label: journalSignOffLabel(signed, ev.requiresApprovalOf), requiresApprovalOf: ev.requiresApprovalOf ?? "",
    lines: (j.lines as PackJournalLine[]).map((l) => ({ side: l.side, account: l.account, accountName: (MERCHANT_ACCOUNTS as Record<string, string>)[l.account] ?? l.account, amountMinor: String(l.amountMinor), ...(l.batchId ? { batchId: l.batchId } : {}), ...(l.onApproval ? { onApproval: l.onApproval } : {}) })),
  }));

  return {
    label: await orgLabel(tx, ctx.orgId), marking: DRAFT_MARKING, organisation: ctx.orgName, month, generatedAt: new Date().toISOString(), agesAsOf: new Date(ref).toISOString(),
    entity: { id: ent.id, name: ent.name, currency: cur, timezone: ent.timezone },
    postingRules: { signed, version: cat.version, signedBy: signed ? sig!.signedByName : null, signedAt: signed ? sig!.signedAt.toISOString() : null },
    bridges: bridges.map((b) => { const r = batchRows.get(b.batchId); return {
      batchId: b.batchId, providerDay: b.providerDay, currency: b.currency, grossMinor: String(r?.grossMinor ?? 0n), feesMinor: String(r?.feesMinor ?? 0n), refundsMinor: String(r?.refundsMinor ?? 0n), netMinor: String(r?.netMinor ?? 0n),
      bankLineId: b.bankLineId ?? "", bankLine: b.bankLineLabel ?? b.bankLineSource ?? "", tied: b.tied, settlementVerified: b.settlementVerified, bankEvidence: b.bankEvidence, bankEvidenceLabel: BANK_EVIDENCE_SHORT[b.bankEvidence], settled: b.settled, payments: b.paymentIds.length,
    }; }),
    receivable: receivable.map((g) => ({ ...g, creditedMinor: g.creditedMinor.toString() })),
    exceptions, exceptionBuckets: AGE_BUCKETS.map((b) => ({ label: b.label, count: exceptions.filter((e) => e.bucket === b.label).length })),
    writeoffs,
    fx: {
      available: true, functionalCurrency: cur, closingAt, rates: usedRates, proposalIds: rv.proposals.map((p) => p.id),
      note: "Proposals only, pending the founder's sign-off of the FX posting rules; never posted. A balance without a usable recorded rate or a known carrying value needs a rate (never 0).",
      items: rv.items.map((i) => ({ ref: i.balance.ref, currency: i.balance.currency, foreignMinor: i.balance.foreignMinor.toString(), status: i.status,
        closingMinor: i.status === "needs_rate" ? null : i.closing.amountMinor.toString(), carryingMinor: i.balance.carryingMinor === null ? null : i.balance.carryingMinor.toString(),
        differenceMinor: i.status === "proposed" ? i.differenceMinor.toString() : i.status === "no_difference" ? "0" : null, note: i.status === "needs_rate" ? i.reason : i.status === "proposed" ? i.proposalId : "no difference" })),
    },
    journals, evidence,
  };
}

/** The pack file, audited (ids, counts and the SHA-256 only). Finance, an Approver or an Admin. */
export async function monthEndPackFile(ctx: TenantContext, entityId: string, month: string, format: z.infer<typeof MonthEndFormat>) {
  if (!can(ctx.role, "merchant_export")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow exports.`);
  const m = Month.parse(month);
  const f = MonthEndFormat.parse(format);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const model = await monthEndPackModel(tx, ctx, entityId, m);
    const checks = monthEndChecks(model);
    const body = f === "pdf" ? await monthEndPdf(model, checks) : await monthEndXlsx(model, checks);
    const digest = sha256(body);
    const counts = { bridges: model.bridges.length, receivable: model.receivable.length, openExceptions: model.exceptions.length, writeoffs: model.writeoffs.length, journals: model.journals.length, payments: model.evidence.length, checksAgree: checks.filter((c) => c.agrees).length, checks: checks.length };
    await serverAudit(tx, ctx, "merchant_month_end_pack_exported", "merchant_entity", entityId, `Month-end pack (${f}) for ${entityId} ${m}: ${counts.journals} journal(s), ${counts.openExceptions} open exception(s), ${counts.checksAgree}/${counts.checks} checks agree (sha256 ${digest.slice(0, 12)}…)`,
      { month: m, format: f, sha256: digest, counts });
    return { body, sha256: digest, model, checks, fileName: `clearline-month-end-${ctx.orgSlug}-${entityId}-${m}.${f}`, contentType: f === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  });
}
