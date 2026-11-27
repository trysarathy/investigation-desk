import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  LEDGER_PULL_MAPPING, LedgerPullRefused, ledgerInvoicesCsv, pullQboInvoices, pullXeroInvoices,
  type LedgerSource, type PulledInvoice, type QboReadCredentials, type XeroReadCredentials,
} from "@/lib/accounting/ledger-pull";
import { ledgerFetch, type Fetch } from "@/lib/accounting/providers/xero";
import { accessToken, loadTokens } from "@/lib/accounting/providers/xero-auth";
import * as t from "./db/schema";
import { openRows } from "./crypto/fields";
import { can, type Permission } from "./authz";
import { withTenant, AccessDenied, requireEntity, type TenantContext } from "./tenant";
import { RequestRefused } from "./errors";
import { dataModeOf } from "./mapping-templates";
import { createUpload, setUploadMapping, validateUpload } from "./uploads";
import type { UploadStorage } from "./storage";

/**
 * rc7 phase 3b: ledger invoices. A READ-ONLY pull from a Xero demo company or a QuickBooks sandbox, behind
 * CLEARLINE_LEDGER_PULL=1, enters through the same upload → mapping → validation flow as a file a person uploads: the
 * pull becomes a CSV upload (stored, hashed, retained like any upload), mapped with the fixed pull mapping and
 * validated. A person then confirms it and it is normalised (provenance, duplicates, exact decimals) like any file.
 * Nothing is ever written to the ledger. Audit rows hold ids and counts only.
 */

export const LEDGER_PULL_FLAG = "CLEARLINE_LEDGER_PULL";
export const ledgerPullEnabled = () => process.env[LEDGER_PULL_FLAG] === "1";

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}

export const PullInput = z.object({ entityId: z.string().min(1).max(64), source: z.enum(["xero_demo", "qbo_sandbox"]) }).strict();

/** Where a pull reads from: injected in tests (recorded, fictional responses); built from the server's connection otherwise. */
export interface PullDeps { fetchFn?: Fetch; xero?: XeroReadCredentials; qbo?: QboReadCredentials; now?: Date; storage?: UploadStorage }

async function defaultCreds(source: LedgerSource): Promise<Pick<PullDeps, "xero" | "qbo">> {
  if (source === "xero_demo") {
    const tok = await loadTokens();
    if (!tok) throw new RequestRefused(409, "LEDGER_NOT_CONNECTED", "Xero is not connected. Connect the Xero Demo Company first.");
    return { xero: { tenantId: tok.tenantId, accessToken: async () => (await accessToken()).token } };
  }
  const realmId = process.env.QBO_REALM_ID ?? "", token = process.env.QBO_ACCESS_TOKEN ?? "";
  if (!realmId || !token || (process.env.QBO_ENV ?? "sandbox") !== "sandbox") throw new RequestRefused(409, "LEDGER_NOT_CONNECTED", "No QuickBooks sandbox company is connected.");
  return { qbo: { realmId, accessToken: async () => token } };
}

/**
 * Pull the ledger's sales invoices (read-only) into a new ledger-invoices upload for this entity, mapped and validated.
 * Refused when the flag is off, for a sample organisation, for anyone but Finance or Payment Operations, for a Xero
 * organisation that is not a demo company and for a QuickBooks company that is not a sandbox.
 */
export async function pullLedgerInvoices(ctx: TenantContext, input: z.input<typeof PullInput>, idempotencyKey: string, deps: PullDeps = {}) {
  require(ctx, "merchant_upload");
  const v = PullInput.parse(input);
  requireEntity(ctx, v.entityId);
  if (!ledgerPullEnabled()) throw new RequestRefused(409, "LEDGER_PULL_OFF", `Reading invoices from a ledger is off (${LEDGER_PULL_FLAG} is not set). Upload a ledger export instead.`);
  const mode = await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => dataModeOf(tx, ctx.orgId), { read: true });
  if (mode.dataMode !== "live") throw new RequestRefused(409, "SAMPLE_ORGANISATION", "This organisation holds sample data; ledger invoices go to your live organisation.");
  const fetchFn = deps.fetchFn ?? ledgerFetch;
  const creds = deps.xero || deps.qbo ? deps : await defaultCreds(v.source);
  let invoices: PulledInvoice[];
  try {
    invoices = v.source === "xero_demo" ? await pullXeroInvoices(creds.xero!, fetchFn) : await pullQboInvoices(creds.qbo!, fetchFn);
  } catch (e) {
    if (e instanceof LedgerPullRefused) throw new RequestRefused(409, `LEDGER_${e.code}`, e.message);
    throw e;
  }
  if (!invoices.length) throw new RequestRefused(409, "LEDGER_EMPTY", "The ledger returned no sales invoices.");
  const day = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const fileName = `${v.source === "xero_demo" ? "Xero demo company" : "QuickBooks sandbox"} invoices ${day}.csv`;
  const up = await createUpload(ctx, { entityId: v.entityId, fileType: "ledger_invoices", fileName, bytes: ledgerInvoicesCsv(invoices) }, `${idempotencyKey.slice(0, 100)}:store`, deps.storage);
  await setUploadMapping(ctx, up.upload.id, { mapping: LEDGER_PULL_MAPPING }, `${idempotencyKey.slice(0, 100)}:map`, deps.storage);
  const validated = await validateUpload(ctx, up.upload.id, `${idempotencyKey.slice(0, 100)}:validate`, deps.storage);
  return { status: 201, body: { label: up.label, source: v.source, pulled: invoices.length, upload: validated.body } };
}

/** This entity's ledger invoices (the merchant's own members; RLS keeps every row in the organisation). */
export async function listLedgerInvoices(ctx: TenantContext, entityId: string) {
  require(ctx, "read");
  requireEntity(ctx, entityId);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const { label } = await dataModeOf(tx, ctx.orgId);
    const rows = await openRows(tx, ctx.orgId, "ledger_invoices", await tx.select().from(t.ledgerInvoices).where(and(eq(t.ledgerInvoices.orgId, ctx.orgId), eq(t.ledgerInvoices.entityId, entityId))).orderBy(asc(t.ledgerInvoices.invoiceNumber)));
    return {
      label, entityId,
      invoices: rows.map((r) => ({
        invoiceNumber: r.invoiceNumber, orderRef: r.orderRef, currency: r.currency, totalMinor: r.totalMinor.toString(), amountDueMinor: r.amountDueMinor?.toString() ?? null,
        amountPaidMinor: r.amountPaidMinor?.toString() ?? null, status: r.status, issuedOn: r.issuedOn, dueOn: r.dueOn, uploadId: r.uploadId, sourceRow: r.sourceRow,
      })),
    };
  }, { read: true });
}

