import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { toFiatMinor } from "@/lib/clearline/merchant/amounts";
import { FIAT_DECIMALS, normAddress } from "@/lib/clearline/merchant/config";
import { IMPORTED_BANK_LINE_LABEL, type FiatCurrency, type NetworkId } from "@/lib/clearline/merchant/types";
import type { MappedValue } from "@/lib/clearline/mapping";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { normRate, plain } from "./merchant-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { analyseUpload, loadUpload, type AnalysedRow, type UploadRow } from "./uploads";
import { uploadStorage, type UploadStorage } from "./storage";
import { stampNow } from "./live-clock";

/**
 * rc7 normalisation: the accepted rows of a CONFIRMED upload → the rc6 merchant tables the engine reads
 * (loadReconcileInput), with provenance (upload, row, template, uploader) on every row. Idempotent: a row already
 * present with the same facts is "existing"; with other facts a "conflict" (nothing written for that row or batch);
 * a second run changes nothing. Statement lines become 'file_import' lines: imported, not bank-authenticated, never
 * verifying settlement unless the merchant policy flag is on (it stays off). A tx hash in a provider file becomes a
 * provider-CLAIMED transfer (source provider_export, unconfirmed, never final by itself). Nothing keys on fixtures.
 */

type Outcome = "created" | "existing" | "conflict" | "skipped";
interface Target { table: string; key: string }
interface RowResult { outcome: Outcome; targets: Target[] }
class Conflict extends Error {}
const str = (v: MappedValue | undefined) => (typeof v === "string" ? v : undefined);
const big = (v: MappedValue | undefined) => (typeof v === "bigint" ? v : undefined);
const dbNet = (n: string) => (n === "arbitrum_one" ? "arbitrum-one" : n);
const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
const ms = (d: Date | string) => new Date(d).getTime();

/**
 * rc7 phase 3b (speed, same decisions): the row functions below run in one of three modes.
 *  - "collect": no database access; records every (table, key) a row would read or write.
 *  - "plan": against the rows loaded in bulk for those keys (plus the rows earlier rows of this file would create),
 *    decides each row exactly as "db" would (created / existing / conflict, a conflicting row leaving nothing), and
 *    queues the inserts, which are then written in bulk.
 *  - "db": the original row-by-row path (a savepoint per row), used if the bulk write does not insert exactly what
 *    the plan expected (e.g. another unique index refused a row), so the outcome is always the row-by-row one.
 */
type Mode = "collect" | "plan" | "db";
interface Pending { name: string; key: string; table: PgTable; values: Record<string, unknown> }
interface Ctx {
  tx: Tx; orgId: string; entityId: string; currency: FiatCurrency; u: UploadRow;
  tokens: { network: string; contract: string; decimals: number }[];
  prov: (row: number) => { uploadId: string; sourceRow: number; mappingTemplateId: string | null; mappingTemplateVersion: number | null; uploadedBy: string };
  mode: Mode; keys: Map<string, Set<string>>; state: Map<string, Map<string, Record<string, unknown>>>; pending: Pending[];
}
const note = (c: Ctx, name: string, key: string) => { const s = c.keys.get(name) ?? new Set<string>(); s.add(key); c.keys.set(name, s); };
const lookup = (c: Ctx, name: string, key: string) => c.pending.find((p) => p.name === name && p.key === key)?.values ?? c.state.get(name)?.get(key);

/**
 * Insert one row unless its key exists; then compare the facts that matter. `facts` reads the same projection from
 * the values written and from the row found. Throws Conflict for a different row under the same key.
 */
async function put<R extends Record<string, unknown>>(c: Ctx, table: PgTable, name: string, key: string, values: R, find: () => Promise<Record<string, unknown> | undefined>, facts: (r: Record<string, unknown>) => unknown, out: Target[]): Promise<Outcome> {
  if (c.mode === "collect") { note(c, name, key); out.push({ table: name, key }); return "created"; }
  if (c.mode === "plan") {
    const found = lookup(c, name, key);
    if (found && !same(facts(found), facts(values))) throw new Conflict(name);
    if (!found) c.pending.push({ name, key, table, values });
    out.push({ table: name, key });
    return found ? "existing" : "created";
  }
  const created = await c.tx.insert(table).values(values).onConflictDoNothing().returning();
  const outcome: Outcome = created.length ? "created" : await find().then((x) => (x && same(facts(x), facts(values)) ? "existing" : Promise.reject(new Conflict(name))));
  out.push({ table: name, key });
  return outcome;
}

/** rc7: the quote a payment-link row belongs to when the export names none (one per order). */
export const impliedQuoteId = (orderId: string) => `${orderId}#quote`;

async function providerRow(c: Ctx, v: Record<string, MappedValue>, row: number): Promise<RowResult> {
  const { tx, orgId } = c;
  const net = v.network as NetworkId;
  const token = c.tokens.find((k) => k.network === dbNet(net) && normAddress(net, k.contract) === normAddress(net, v.token_contract as string))!;
  const linkId = str(v.payment_link_id);
  const orderId = v.order_id as string, quoteId = str(v.quote_id) ?? impliedQuoteId(orderId);
  // rc7: quote terms the file does not carry stay NULL (never derived); the engine abstains on those orders.
  const created = str(v.created_at) ? new Date(v.created_at as string) : null, expires = str(v.expires_at) ? new Date(v.expires_at as string) : null;
  const rate = str(v.quote_rate) ?? null, quoted = big(v.quoted_token_amount);
  const paidAt = str(v.paid_at) ? new Date(v.paid_at as string) : null;
  const p = c.prov(row);
  const targets: Target[] = [];
  const outcomes: Outcome[] = [];
  if (big(v.invoice_amount) !== undefined) {
    outcomes.push(await put(c, t.invoices, "invoices", orderId,
      { orgId, orderId, entityId: c.entityId, amountMinor: big(v.invoice_amount)!, currency: v.currency as string, status: "open", issuedAt: created ?? paidAt ?? c.u.createdAt, ...p },
      async () => (await tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.orderId, orderId))))[0],
      (r) => [r.entityId, r.amountMinor, r.currency], targets));
  } else {
    // without an invoice amount the order must already be in reconciliation (from an orders file), for this entity
    const inv = c.mode === "collect" ? (note(c, "invoices", orderId), { entityId: c.entityId }) : c.mode === "plan" ? lookup(c, "invoices", orderId)
      : (await tx.select({ entityId: t.invoices.entityId }).from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.orderId, orderId))))[0];
    if (!inv || inv.entityId !== c.entityId) throw new Conflict("invoices");
  }
  // A payment-link row gives the LINK's address and amount, not its quote's: the quote is recorded with neither.
  outcomes.push(await put(c, t.merchantQuotes, "merchant_quotes", quoteId, {
    orgId, quoteId, orderId, network: dbNet(net), tokenContract: token.contract, quotedBaseUnits: linkId ? null : quoted?.toString() ?? null, rate,
    rateSource: str(v.rate_source) ?? null, rateAt: rate !== null ? created : null, createdAt: created, expiresAt: expires, depositAddress: v.deposit_address as string, ...p,
  }, async () => (await tx.select().from(t.merchantQuotes).where(and(eq(t.merchantQuotes.orgId, orgId), eq(t.merchantQuotes.quoteId, quoteId))))[0],
  linkId ? (r) => [r.orderId, r.rate === null || r.rate === undefined ? null : normRate(String(r.rate))]
    : (r) => [r.orderId, r.network, r.tokenContract, r.quotedBaseUnits === null || r.quotedBaseUnits === undefined ? null : String(r.quotedBaseUnits), r.rate === null || r.rate === undefined ? null : normRate(String(r.rate)), r.depositAddress, r.createdAt ? ms(r.createdAt as Date) : null, r.expiresAt ? ms(r.expiresAt as Date) : null], targets));
  if (linkId) {
    outcomes.push(await put(c, t.paymentLinks, "payment_links", linkId, {
      orgId, linkId, orderId, kind: "full", network: dbNet(net), depositAddress: v.deposit_address as string, quoteId, tokenContract: token.contract,
      // [ASSUMPTION] a link row's quoted amount is the link's requested amount; its own window is not in the file (NULL)
      requestedBaseUnits: quoted?.toString() ?? null, requestedMinor: quoted !== undefined && rate !== null ? toFiatMinor(quoted, token.decimals, normRate(rate), c.currency) : null,
      createdAt: null, expiresAt: null, ...p,
    }, async () => (await tx.select().from(t.paymentLinks).where(and(eq(t.paymentLinks.orgId, orgId), eq(t.paymentLinks.linkId, linkId))))[0],
    (r) => [r.orderId, r.quoteId, r.depositAddress, r.requestedBaseUnits === null || r.requestedBaseUnits === undefined ? null : String(r.requestedBaseUnits)], targets));
  }
  const txHash = str(v.tx_hash);
  const logIndexUnknown = typeof v.log_index !== "number";
  // the claim row needs a key; 0 when the file has no log index — the engine never uses it (logIndexUnknown)
  const logIndex = typeof v.log_index === "number" ? v.log_index : 0;
  const paymentId = str(v.payment_id);
  if (paymentId) {
    const record = {
      providerPaymentId: paymentId, ref: linkId ? { linkId } : { quoteId }, ...(txHash ? { transferRef: { network: net, txHash, logIndex }, ...(logIndexUnknown ? { logIndexUnknown: true } : {}) } : {}),
      statusClaim: v.status, ...(str(v.status_text) ? { displayedStatus: str(v.status_text) } : {}), receivedBaseUnits: big(v.received_token_amount)!,
      creditedMinor: big(v.credited_fiat)!, executedRate: v.executed_rate, ...(big(v.fee) !== undefined ? { feeMinor: big(v.fee) } : {}), ...(str(v.batch_id) ? { batchId: str(v.batch_id) } : {}),
      note: "provider statuses are claims, not proof",
    };
    outcomes.push(await put(c, t.providerPaymentRecords, "provider_payment_records", paymentId, {
      orgId, providerPaymentId: paymentId, quoteId: linkId ? null : quoteId, linkId: linkId ?? null, statusClaim: v.status as string, receivedBaseUnits: big(v.received_token_amount)!.toString(),
      creditedMinor: big(v.credited_fiat)!, creditedCurrency: v.currency as string, executedRate: v.executed_rate as string, feeMinor: big(v.fee) ?? null, batchId: str(v.batch_id) ?? null,
      record: plain(record) as object, ...p,
    }, async () => (await tx.select().from(t.providerPaymentRecords).where(and(eq(t.providerPaymentRecords.orgId, orgId), eq(t.providerPaymentRecords.providerPaymentId, paymentId))))[0],
    (r) => [r.quoteId, r.linkId, r.statusClaim, String(r.receivedBaseUnits), r.creditedMinor, r.batchId], targets));
  }
  if (txHash && big(v.received_token_amount) !== undefined) {
    // A provider's claim about a transfer: recorded as such, unconfirmed and not final. An observed chain fact under
    // the same key is kept as it is (the claim is then only on the provider record, compared by the engine).
    const key = `${net}|${txHash}|${logIndex}`;
    const values = {
      orgId, network: net, txHash, logIndex, tokenContract: token.contract, fromAddress: str(v.sender) ?? "", toAddress: v.deposit_address as string,
      amountBaseUnits: big(v.received_token_amount)!.toString(), decimals: token.decimals, block: 0, blockTime: paidAt ?? created ?? c.u.createdAt, confirmations: 0,
      finalised: false, source: "provider_export", entityId: c.entityId, claimedSymbol: str(v.token_symbol) ?? null, ...p,
    };
    if (c.mode === "collect") { note(c, "chain_transfers", key); outcomes.push("created"); }
    else if (c.mode === "plan") {
      const found = lookup(c, "chain_transfers", key);
      if (!found) c.pending.push({ name: "chain_transfers", key, table: t.chainTransfers, values });
      outcomes.push(found ? "existing" : "created");
    } else outcomes.push((await tx.insert(t.chainTransfers).values(values).onConflictDoNothing().returning({ k: t.chainTransfers.txHash })).length ? "created" : "existing");
    targets.push({ table: "chain_transfers", key });
  }
  return { outcome: outcomes.includes("created") ? "created" : "existing", targets };
}

async function invoiceRow(c: Ctx, v: Record<string, MappedValue>, row: number): Promise<RowResult> {
  const orderId = v.order_id as string;
  const targets: Target[] = [];
  const outcome = await put(c, t.invoices, "invoices", orderId, {
    orgId: c.orgId, orderId, entityId: c.entityId, amountMinor: big(v.invoice_amount)!, currency: v.currency as string, status: v.status === "void" ? "void" : "open",
    issuedAt: new Date(str(v.issued_at) ?? c.u.createdAt), ...c.prov(row),
  }, async () => (await c.tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, c.orgId), eq(t.invoices.orderId, orderId))))[0],
  (r) => [r.entityId, r.amountMinor, r.currency], targets);
  return { outcome, targets };
}

/** rc7 phase 3b: a sales invoice as the ledger holds it (reference data; the engine never reads it). */
async function ledgerRow(c: Ctx, v: Record<string, MappedValue>, row: number): Promise<RowResult> {
  const invoiceNumber = v.invoice_number as string;
  const targets: Target[] = [];
  const outcome = await put(c, t.ledgerInvoices, "ledger_invoices", `${c.entityId}|${invoiceNumber}`, {
    orgId: c.orgId, entityId: c.entityId, invoiceNumber, orderRef: str(v.order_id) ?? null, contact: str(v.contact) ?? null, currency: v.currency as string,
    totalMinor: big(v.total)!, amountDueMinor: big(v.amount_due) ?? null, amountPaidMinor: big(v.amount_paid) ?? null, status: str(v.status) ?? "open",
    issuedOn: str(v.issued_on) ?? null, dueOn: str(v.due_on) ?? null, ledgerId: str(v.ledger_id) ?? null, ...c.prov(row),
  }, async () => (await c.tx.select().from(t.ledgerInvoices).where(and(eq(t.ledgerInvoices.orgId, c.orgId), eq(t.ledgerInvoices.entityId, c.entityId), eq(t.ledgerInvoices.invoiceNumber, invoiceNumber))))[0],
  (r) => [r.currency, r.totalMinor, r.amountDueMinor ?? null, r.status, r.orderRef ?? null], targets);
  return { outcome, targets };
}

async function bankRow(c: Ctx, v: Record<string, MappedValue>, row: number, rowHash: string): Promise<RowResult> {
  // [ASSUMPTION] the engine reconciles settlement credits in the entity's currency; debits and other currencies are skipped
  if (v.direction !== "credit" || v.currency !== c.currency || big(v.amount) === 0n) return { outcome: "skipped", targets: [] };
  const lineId = `FILE-${rowHash.slice(0, 32)}`;
  const targets: Target[] = [];
  const outcome = await put(c, t.bankLines, "bank_lines", lineId, {
    orgId: c.orgId, lineId, account: v.bank_account as string, currency: v.currency as string, valueDate: v.value_date as string, amountMinor: big(v.amount)!,
    description: [str(v.reference), str(v.bank_reference), str(v.description)].filter((x) => x).join(" · ").slice(0, 500) || "(no reference)",
    source: "file_import", entityId: c.entityId, bankAccountId: c.u.bankAccountId ?? null, provenance: `${IMPORTED_BANK_LINE_LABEL}: upload ${c.u.id} row ${row} (sha256 ${c.u.contentSha256.slice(0, 12)}…)`, ...c.prov(row),
  }, async () => (await c.tx.select().from(t.bankLines).where(and(eq(t.bankLines.orgId, c.orgId), eq(t.bankLines.lineId, lineId))))[0],
  (r) => [r.account, r.currency, r.valueDate, r.amountMinor], targets);
  return { outcome, targets };
}

/** One settlement batch from its rows: per-payment lines (gross, fees and refunds summed) or one totals row. */
async function batchRows(c: Ctx, batchId: string, rows: AnalysedRow[], lines: boolean): Promise<RowResult> {
  const v0 = rows[0].values;
  const agree = (k: string) => rows.every((r) => JSON.stringify(plain(r.values[k])) === JSON.stringify(plain(v0[k])));
  if (!agree("provider_day") || !agree("currency") || !agree("bank_account")) throw new Conflict("settlement_batches");
  if (v0.currency !== c.currency) return { outcome: "skipped", targets: [] };
  const sumOf = (k: string, pick: (r: AnalysedRow) => boolean = () => true) => rows.filter(pick).reduce((s, r) => s + (big(r.values[k]) ?? 0n), 0n);
  const refund = (r: AnalysedRow) => r.values.line_type === "refund";
  const feeLine = (r: AnalysedRow) => r.values.line_type === "fee";
  // rc7: per-line reports carry fees per line (a fee column), as batch-level fee lines, or both; refunds as refund lines
  const totals = lines
    ? { grossMinor: sumOf("line_amount", (r) => !refund(r) && !feeLine(r)), feesMinor: sumOf("fee") + sumOf("line_amount", feeLine), refundsMinor: sumOf("line_amount", refund) }
    : { grossMinor: big(v0.gross)!, feesMinor: big(v0.fee) ?? 0n, refundsMinor: big(v0.refund) ?? 0n };
  const netMinor = totals.grossMinor - totals.feesMinor - totals.refundsMinor;
  if (lines && rows.some((r) => big(r.values.net) !== undefined)) {
    const nets = rows.map((r) => big(r.values.net) ?? 0n);
    if (!nets.every((n) => n === netMinor) && nets.reduce((s, n) => s + n, 0n) !== netMinor) throw new Conflict("settlement_batches");
  }
  if (!lines && big(v0.net) !== netMinor) throw new Conflict("settlement_batches");
  // [ASSUMPTION] the provider day is a UTC day unless the provider states otherwise (rc6: "provider day = UTC")
  const start = Date.parse(`${v0.provider_day}T00:00:00.000Z`);
  const targets: Target[] = [];
  const p = c.prov(rows[0].rowNumber);
  const outcome = await put(c, t.settlementBatches, "settlement_batches", batchId, {
    orgId: c.orgId, batchId, entityId: c.entityId, dayStart: new Date(start), dayEnd: new Date(start + 86_400_000), dayTimezone: "UTC", dayUtcOffsetMinutes: 0,
    currency: v0.currency as string, targetBankAccount: v0.bank_account as string, ...totals, netMinor, ...p,
  }, async () => (await c.tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, c.orgId), eq(t.settlementBatches.batchId, batchId))))[0],
  (r) => [r.currency, r.targetBankAccount, r.grossMinor, r.feesMinor, r.refundsMinor, r.netMinor, ms(r.dayStart as Date)], targets);
  if (!lines) return { outcome, targets };
  const sorted = [...rows].filter((r) => !feeLine(r)).sort((a, b) => { const ka = `${refund(a) ? "refund" : "payment"}${str(a.values.payment_id) ?? str(a.values.refund_id)}`, kb = `${refund(b) ? "refund" : "payment"}${str(b.values.payment_id) ?? str(b.values.refund_id)}`; return ka < kb ? -1 : 1; });
  for (const [i, r] of sorted.entries()) {
    const kind = refund(r) ? "refund" : "payment";
    const values = { orgId: c.orgId, batchId, lineNo: i + 1, kind, ref: (kind === "payment" ? str(r.values.payment_id) : str(r.values.refund_id)) ?? "", amountMinor: big(r.values.line_amount)!, orderId: str(r.values.order_id) ?? null, ...c.prov(r.rowNumber) };
    await put(c, t.settlementBatchLines, "settlement_batch_lines", `${batchId}|${i + 1}`, values,
      async () => (await c.tx.select().from(t.settlementBatchLines).where(and(eq(t.settlementBatchLines.orgId, c.orgId), eq(t.settlementBatchLines.batchId, batchId), eq(t.settlementBatchLines.lineNo, i + 1))))[0],
      (x) => [x.kind, x.ref, x.amountMinor, x.orderId], targets);
  }
  return { outcome, targets };
}

// ---------------------------------------------------------------------------------------------
// Bulk reads and writes for the "plan" mode (same keys and facts as the row-by-row path)
// ---------------------------------------------------------------------------------------------

class BulkMiss extends Error {}
type Row = Record<string, unknown>;
const LOADERS: Record<string, { table: PgTable; keyOf: (r: Row) => string; load: (tx: Tx, orgId: string, keys: string[]) => Promise<Row[]> }> = {
  invoices: { table: t.invoices, keyOf: (r) => String(r.orderId), load: (tx, o, k) => tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, o), inArray(t.invoices.orderId, k))) },
  merchant_quotes: { table: t.merchantQuotes, keyOf: (r) => String(r.quoteId), load: (tx, o, k) => tx.select().from(t.merchantQuotes).where(and(eq(t.merchantQuotes.orgId, o), inArray(t.merchantQuotes.quoteId, k))) },
  payment_links: { table: t.paymentLinks, keyOf: (r) => String(r.linkId), load: (tx, o, k) => tx.select().from(t.paymentLinks).where(and(eq(t.paymentLinks.orgId, o), inArray(t.paymentLinks.linkId, k))) },
  provider_payment_records: { table: t.providerPaymentRecords, keyOf: (r) => String(r.providerPaymentId),
    load: (tx, o, k) => tx.select().from(t.providerPaymentRecords).where(and(eq(t.providerPaymentRecords.orgId, o), inArray(t.providerPaymentRecords.providerPaymentId, k))) },
  chain_transfers: { table: t.chainTransfers, keyOf: (r) => `${r.network}|${r.txHash}|${r.logIndex}`,
    load: (tx, o, k) => tx.select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, o), inArray(t.chainTransfers.txHash, [...new Set(k.map((x) => x.split("|")[1]))]))) },
  settlement_batches: { table: t.settlementBatches, keyOf: (r) => String(r.batchId), load: (tx, o, k) => tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, o), inArray(t.settlementBatches.batchId, k))) },
  settlement_batch_lines: { table: t.settlementBatchLines, keyOf: (r) => `${r.batchId}|${r.lineNo}`,
    load: (tx, o, k) => tx.select().from(t.settlementBatchLines).where(and(eq(t.settlementBatchLines.orgId, o), inArray(t.settlementBatchLines.batchId, [...new Set(k.map((x) => x.slice(0, x.lastIndexOf("|"))))]))) },
  bank_lines: { table: t.bankLines, keyOf: (r) => String(r.lineId), load: (tx, o, k) => tx.select().from(t.bankLines).where(and(eq(t.bankLines.orgId, o), inArray(t.bankLines.lineId, k))) },
  ledger_invoices: { table: t.ledgerInvoices, keyOf: (r) => `${r.entityId}|${r.invoiceNumber}`,
    load: (tx, o, k) => tx.select().from(t.ledgerInvoices).where(and(eq(t.ledgerInvoices.orgId, o), inArray(t.ledgerInvoices.invoiceNumber, [...new Set(k.map((x) => x.slice(x.indexOf("|") + 1)))]))) },
};
const WRITE_ORDER = ["invoices", "merchant_quotes", "payment_links", "provider_payment_records", "chain_transfers", "settlement_batches", "settlement_batch_lines", "bank_lines", "ledger_invoices"];

async function loadExisting(tx: Tx, orgId: string, name: string, keys: string[]): Promise<Map<string, Row>> {
  const l = LOADERS[name];
  const out = new Map<string, Row>();
  const want = new Set(keys);
  for (let i = 0; i < keys.length; i += 1000) for (const r of await l.load(tx, orgId, keys.slice(i, i + 1000)) as Row[]) { const k = l.keyOf(r); if (want.has(k)) out.set(k, r); }
  return out;
}

/** Write the planned rows in bulk, parents first; anything not inserted exactly as planned undoes the bulk write. */
async function writeBulk(tx: Tx, creates: Pending[]) {
  for (const name of WRITE_ORDER) {
    const rows = creates.filter((p) => p.name === name);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const done = await tx.insert(LOADERS[name].table).values(chunk.map((p) => p.values)).onConflictDoNothing().returning();
      if (done.length !== chunk.length) throw new BulkMiss(name);
    }
  }
}

export interface NormaliseResult { uploadId: string; status: "normalised"; changed: boolean; counts: Record<Outcome, number> }

/**
 * Normalise a confirmed upload into the merchant tables. The file is re-read and re-validated: if its validation no
 * longer matches what the confirmer reviewed (e.g. the token configuration changed), nothing is written.
 */
export async function normaliseUpload(ctx: TenantContext, uploadId: string, idempotencyKey: string, storage: UploadStorage = uploadStorage(), opts: { rowByRow?: boolean } = {}) {
  if (!can(ctx.role, "merchant_upload") && !can(ctx.role, "confirm_import")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const key = IdempotencyKey.parse(idempotencyKey);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => idempotent(tx, ctx, key, { op: "upload_normalise", uploadId }, async () => {
    const u = await loadUpload(tx, ctx, uploadId, true);
    if (u.status === "normalised") return { status: 200, body: { uploadId, status: "normalised", changed: false, counts: (u.normalisedCounts as { rows: Record<Outcome, number> }).rows } as NormaliseResult };
    if (u.status !== "confirmed") throw new RequestRefused(409, "UPLOAD_NOT_CONFIRMED", `This upload is ${u.status}; only a confirmed upload is normalised.`);
    const analysis = await analyseUpload(tx, u, await storage.get(ctx.orgId, u.storageKey!));
    const stored = await tx.select().from(t.uploadRows).where(and(eq(t.uploadRows.orgId, ctx.orgId), eq(t.uploadRows.uploadId, uploadId)));
    const byRow = new Map(stored.map((r) => [r.rowNumber, r]));
    if (stored.length !== analysis.rows.length || analysis.rows.some((r) => { const s = byRow.get(r.rowNumber); return !s || s.rowHash !== r.rowHash || (s.status !== r.status && s.status !== "duplicate"); }))
      throw new RequestRefused(409, "VALIDATION_CHANGED", "The file no longer validates as it did when it was confirmed. Nothing was written; validate and confirm it again.");
    const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, u.entityId)));
    if (!(ent.functionalCurrency in FIAT_DECIMALS)) throw new RequestRefused(409, "ENTITY_CURRENCY", "The entity's currency is not supported by reconciliation.");
    const c: Ctx = {
      tx, orgId: ctx.orgId, entityId: u.entityId, currency: ent.functionalCurrency as FiatCurrency, u, tokens: await tx.select().from(t.tokenConfig),
      prov: (row) => ({ uploadId: u.id, sourceRow: row, mappingTemplateId: u.templateId, mappingTemplateVersion: u.templateVersion, uploadedBy: u.uploadedBy }),
      mode: "collect", keys: new Map(), state: new Map(), pending: [],
    };
    // one normalisation at a time per organisation: the bulk plan reads what is there, then writes
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|normalise`}))`);
    const results = new Map<number, RowResult>();
    // rc7: a file covering several entities (e.g. one orders list for every book): rows naming another entity, or —
    // when the file names none — in another currency than this entity's, are left out of this entity ("skipped").
    const otherEntity = (v: Record<string, MappedValue>) => (u.fileType === "orders_invoices" || u.fileType === "provider_export" || u.fileType === "ledger_invoices")
      && (str(v.entity) !== undefined ? v.entity !== u.entityId : v.currency !== ent.functionalCurrency);
    const usable = analysis.rows.filter((r) => { const s = byRow.get(r.rowNumber)!.status; return s === "accepted" || s === "warning"; });
    for (const r of usable) if (otherEntity(r.values)) results.set(r.rowNumber, { outcome: "skipped", targets: [] });
    const live = usable.filter((r) => !results.has(r.rowNumber));
    const attempt = async (rowNumbers: number[], run: () => Promise<RowResult>) => {
      let res: RowResult;
      if (c.mode === "db") {
        try { res = await tx.transaction(async () => run()); } catch (e) { if (!(e instanceof Conflict)) throw e; res = { outcome: "conflict", targets: [] }; }
      } else {
        c.pending = [];
        try { res = await run(); } catch (e) { if (!(e instanceof Conflict)) throw e; res = { outcome: "conflict", targets: [] }; c.pending = []; }
        if (c.mode === "plan") for (const p of c.pending) { const m = c.state.get(p.name) ?? new Map(); m.set(p.key, p.values); c.state.set(p.name, m); creates.push(p); }
        c.pending = [];
      }
      for (const n of rowNumbers) results.set(n, res);
    };
    const runRows = async () => {
      if (u.fileType === "settlement_report") {
        const lines = (u.mapping as { shape?: string }).shape === "per_payment_lines";
        const groups = new Map<string, AnalysedRow[]>();
        for (const r of live) groups.set(r.values.batch_id as string, [...(groups.get(r.values.batch_id as string) ?? []), r]);
        for (const [batchId, rows] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) await attempt(rows.map((r) => r.rowNumber), () => batchRows(c, batchId, rows, lines));
      } else {
        for (const r of live) await attempt([r.rowNumber], () =>
          u.fileType === "provider_export" ? providerRow(c, r.values, r.rowNumber) : u.fileType === "orders_invoices" ? invoiceRow(c, r.values, r.rowNumber)
            : u.fileType === "ledger_invoices" ? ledgerRow(c, r.values, r.rowNumber) : bankRow(c, r.values, r.rowNumber, r.rowHash!));
      }
    };
    const creates: Pending[] = [];
    if (opts.rowByRow) c.mode = "db"; // the row-by-row path only (the equivalence test compares both)
    await runRows(); // collect (or, row by row, everything)
    if (c.mode === "collect") {
      for (const [name, keys] of c.keys) c.state.set(name, await loadExisting(tx, ctx.orgId, name, [...keys]));
      c.mode = "plan";
      for (const r of live) results.delete(r.rowNumber);
      await runRows();
      try {
        await tx.transaction(async () => writeBulk(tx, creates));
      } catch (e) {
        if (!(e instanceof BulkMiss)) throw e;
        c.mode = "db";
        for (const r of live) results.delete(r.rowNumber);
        await runRows();
      }
    }
    // A duplicate row confirms the rows its earlier copy became (so they stay while either upload is kept).
    const dups = stored.filter((s) => s.status === "duplicate" && s.rowHash);
    if (dups.length) {
      const earlier = await tx.select({ rowHash: t.uploadRows.rowHash, table: t.uploadRowTargets.targetTable, key: t.uploadRowTargets.targetKey }).from(t.uploadRowTargets)
        .innerJoin(t.uploadRows, and(eq(t.uploadRows.orgId, t.uploadRowTargets.orgId), eq(t.uploadRows.uploadId, t.uploadRowTargets.uploadId), eq(t.uploadRows.rowNumber, t.uploadRowTargets.rowNumber)))
        .innerJoin(t.uploads, and(eq(t.uploads.orgId, t.uploadRows.orgId), eq(t.uploads.id, t.uploadRows.uploadId)))
        .where(and(eq(t.uploadRowTargets.orgId, ctx.orgId), ne(t.uploads.id, uploadId), ne(t.uploads.status, "deleted"), eq(t.uploads.entityId, u.entityId), eq(t.uploads.fileType, u.fileType),
          inArray(t.uploadRows.rowHash, dups.map((d) => d.rowHash!))));
      for (const d of dups) {
        const targets = [...new Map(earlier.filter((e) => e.rowHash === d.rowHash).map((e) => [`${e.table}|${e.key}`, { table: e.table, key: e.key }])).values()];
        results.set(d.rowNumber, { outcome: targets.length ? "existing" : "skipped", targets });
      }
    }
    const counts: Record<Outcome, number> = { created: 0, existing: 0, conflict: 0, skipped: 0 };
    const tables: Record<string, number> = {};
    const targetRows: { orgId: string; uploadId: string; rowNumber: number; targetTable: string; targetKey: string }[] = [];
    const outcomes: [number, Outcome, string | null][] = [];
    for (const [rowNumber, res] of [...results.entries()].sort(([a], [b]) => a - b)) {
      counts[res.outcome]++;
      const targets = [...new Map(res.targets.map((x) => [`${x.table}|${x.key}`, x])).values()];
      for (const x of targets) targetRows.push({ orgId: ctx.orgId, uploadId, rowNumber, targetTable: x.table, targetKey: x.key });
      for (const x of targets) if (res.outcome === "created") tables[x.table] = (tables[x.table] ?? 0) + 1;
      const primary = targets.find((x) => ["provider_payment_records", "bank_lines", "settlement_batches", "invoices", "ledger_invoices"].includes(x.table)) ?? targets[0];
      outcomes.push([rowNumber, res.outcome, primary ? `${primary.table}:${primary.key}` : null]);
    }
    for (let i = 0; i < targetRows.length; i += 5000) await tx.insert(t.uploadRowTargets).values(targetRows.slice(i, i + 5000));
    for (let i = 0; i < outcomes.length; i += 5000) {
      const chunk = outcomes.slice(i, i + 5000);
      await tx.execute(sql`update upload_rows u set normalise_outcome = v.o, target_ref = v.r from (values ${sql.join(chunk.map(([n, o, r]) => sql`(${n}::int, ${o}::text, ${r}::text)`), sql`, `)}) as v(n, o, r)
        where u.org_id = ${ctx.orgId} and u.upload_id = ${uploadId} and u.row_number = v.n`);
    }
    await tx.update(t.uploads).set({ status: "normalised", normalisedCounts: { rows: counts, targets: tables }, normalisedAt: stampNow() })
      .where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, uploadId)));
    await serverAudit(tx, ctx, "upload_normalised", "upload", uploadId,
      `Upload normalised: ${counts.created} row(s) created, ${counts.existing} already present, ${counts.conflict} conflicting, ${counts.skipped} skipped`, { uploadId, rows: counts, targets: tables });
    return { status: 200, body: { uploadId, status: "normalised", changed: true, counts } as NormaliseResult };
  }));
}
