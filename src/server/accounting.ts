import "server-only";
import { createHash } from "node:crypto";
import {
  accountingBridgeView, accountingExportToJson, buildJournalExport, buildReconciliationExport, journalExportToCsv, reconciliationExportToCsv,
  type AccountingBridgeView, type JournalProposalRow, type JournalRuleCode,
} from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { readWorkspace } from "./engine-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { stampNow } from "./live-clock";

/**
 * Accounting Bridge services for Clearline Control (SANDBOX ONLY). Reads and file downloads; every change goes
 * through `runAction` (src/server/control.ts), which applies the permission matrix and then the engine's own rules
 * (approver ≠ proposer, evidence re-derived, posted only via record_posting with a person's reference).
 *
 * Nothing here posts to a ledger or makes a network call: a journal export is a FILE re-rendered from the
 * persisted export record, byte for byte.
 */

// The small helpers below are copied from control.ts on purpose (control.ts is not edited by this change).
function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}

const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);

async function serverAudit(tx: Tx, ctx: TenantContext, action: string, entityType: string | null, entityId: string | null, summary: string, details?: unknown) {
  await tx.insert(t.auditEvents).values({ orgId: ctx.orgId, source: "server", actorUserId: ctx.userId, action, entityType, entityId, summary, at: stampNow(), details: details ?? null });
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Posting rules of the stablecoin route. docs/clearline/ACCOUNTING_BRIDGE.md §2 and §2.1: these are sandbox rules
 * "flagged for Aashmiin's sign-off" — the payable is cleared in USDC by the chain transfer while the on-ramp funding
 * stays in the debit's currency, and the conversion between them is not proposed. Until founder / accounting
 * sign-off, every proposal under these rules (and every reversal of one) is shown with `pendingSignOff: true`.
 */
export const STABLECOIN_ROUTE_RULES_PENDING_SIGN_OFF: readonly JournalRuleCode[] = ["JR_STABLECOIN_ONRAMP_FUNDING", "JR_STABLECOIN_FINAL_TRANSFER"];

const isStablecoinRule = (r: JournalRuleCode) => STABLECOIN_ROUTE_RULES_PENDING_SIGN_OFF.includes(r);

export type AccountingProposalRow = JournalProposalRow & { pendingSignOff?: true };
export type AccountingOverview = Omit<AccountingBridgeView, "proposals"> & { proposals: AccountingProposalRow[] };

/** The engine's Accounting Bridge view of this organisation, with stablecoin-route proposals flagged pending sign-off. */
export async function accountingOverview(ctx: TenantContext): Promise<AccountingOverview> {
  require(ctx, "read");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const v = accountingBridgeView(ws);
    const byId = new Map(v.proposals.map((p) => [p.id, p]));
    const stablecoin = (p: JournalProposalRow) => isStablecoinRule(p.ruleCode) || (p.ruleCode === "JR_REVERSAL" && !!p.reverses && !!byId.get(p.reverses) && isStablecoinRule(byId.get(p.reverses)!.ruleCode));
    return { ...v, proposals: v.proposals.map((p): AccountingProposalRow => (stablecoin(p) ? { ...p, pendingSignOff: true } : p)) };
  });
}

export interface ExportFile { body: string; sha256: string; documentId: string; contentType: string; fileName: string }

/**
 * Re-renders a RECORDED journal export (an accounting_exports row) byte for byte from the persisted proposals and
 * the account codes the export used (`buildJournalExport(ws, { exportId })`). The bytes must hash to the
 * `fileSha256` recorded at export time; if they do not, nothing is served. Audited with the file's SHA-256.
 */
export async function journalExportFile(ctx: TenantContext, exportId: string, format: "csv" | "json"): Promise<ExportFile> {
  require(ctx, "read");
  if (format !== "csv" && format !== "json") throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const rec = ws.accounting?.exports.find((x) => x.id === exportId && x.kind === "journal");
    if (!rec) throw new AccessDenied(404, "Not found.");
    const doc = buildJournalExport(ws, { exportId });
    if (!doc.ok) throw new AccessDenied(404, "Not found.");
    const body = format === "json" ? accountingExportToJson(doc.value) : journalExportToCsv(doc.value);
    const digest = sha256(body);
    if (doc.value.documentId !== rec.documentId || doc.value.sha256 !== rec.sha256 || (rec.fileSha256 && rec.fileSha256[format] !== digest)) {
      throw new Error(`journal export ${exportId} no longer re-renders to the recorded file (${format}); refusing to serve it`);
    }
    await serverAudit(tx, ctx, "journal_export_downloaded", "accounting_export", exportId, `Journal export ${rec.documentId} downloaded (${format}, sha256 ${digest.slice(0, 12)}…). A file only; nothing was posted.`, { sha256: digest, format, documentId: rec.documentId });
    return { body, sha256: digest, documentId: rec.documentId, contentType: format === "json" ? "application/json" : "text/csv", fileName: `${rec.documentId}.${format}` };
  });
}

/**
 * The accounting-ready reconciliation export of one accounting period ([from, to) of the period), rendered from the
 * persisted evidence. Deterministic for a given workspace state. Audited with the file's SHA-256. Recording it as an
 * export is a separate engine action (`record_reconciliation_export` through runAction).
 */
export async function reconciliationExportFile(ctx: TenantContext, periodId: string, format: "csv" | "json"): Promise<ExportFile> {
  require(ctx, "read");
  if (format !== "csv" && format !== "json") throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const period = ws.accounting?.periods.find((p) => p.id === periodId);
    if (!period) throw new AccessDenied(404, "Not found.");
    const doc = buildReconciliationExport(ws, { from: period.from, to: period.to });
    if (!doc.ok) throw new AccessDenied(404, "Not found.");
    const body = format === "json" ? accountingExportToJson(doc.value) : reconciliationExportToCsv(doc.value);
    const digest = sha256(body);
    await serverAudit(tx, ctx, "reconciliation_export_downloaded", "accounting_period", period.id, `Reconciliation export ${doc.value.documentId} for ${period.name} downloaded (${format}, sha256 ${digest.slice(0, 12)}…)`, { sha256: digest, format, documentId: doc.value.documentId, from: period.from, to: period.to });
    return { body, sha256: digest, documentId: doc.value.documentId, contentType: format === "json" ? "application/json" : "text/csv", fileName: `${doc.value.documentId}.${format}` };
  });
}
