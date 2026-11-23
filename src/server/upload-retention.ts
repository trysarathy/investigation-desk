import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";

/**
 * Retention of normalised data (founder decision 6), run by purgeExpiredUploads with the schema OWNER connection.
 * A row normalised from uploads is deleted when the purged upload refers to it, it came from an upload (it carries an
 * upload_id: never seeded or chain-observed data) and no other upload that is still kept refers to it. The order's
 * reconciliation outputs go with its invoice. Two rc6 tables refuse deletes to everyone (bank_lines immutable,
 * differences append-only): retention disables exactly those two triggers inside its own transaction, which holds
 * an exclusive lock on the table until it commits, and re-enables them before committing. The runtime role cannot do
 * this (it does not own the tables). Approval records and audit events are kept (they hold ids and amounts of
 * decisions, never file contents).
 */

type Key = { table: string; key: string };

async function deletable(tx: Db | Tx, orgId: string, uploadId: string): Promise<Map<string, string[]>> {
  const mine = await tx.selectDistinct({ table: t.uploadRowTargets.targetTable, key: t.uploadRowTargets.targetKey }).from(t.uploadRowTargets)
    .where(and(eq(t.uploadRowTargets.orgId, orgId), eq(t.uploadRowTargets.uploadId, uploadId)));
  const kept = new Set<string>();
  for (let i = 0; i < mine.length; i += 500) {
    const chunk = mine.slice(i, i + 500);
    const others = await tx.selectDistinct({ table: t.uploadRowTargets.targetTable, key: t.uploadRowTargets.targetKey }).from(t.uploadRowTargets)
      .innerJoin(t.uploads, and(eq(t.uploads.orgId, t.uploadRowTargets.orgId), eq(t.uploads.id, t.uploadRowTargets.uploadId)))
      .where(and(eq(t.uploadRowTargets.orgId, orgId), ne(t.uploadRowTargets.uploadId, uploadId), ne(t.uploads.status, "deleted"), inArray(t.uploadRowTargets.targetKey, chunk.map((x) => x.key))));
    for (const o of others) kept.add(`${o.table}|${o.key}`);
  }
  const out = new Map<string, string[]>();
  for (const x of mine as Key[]) if (!kept.has(`${x.table}|${x.key}`)) out.set(x.table, [...(out.get(x.table) ?? []), x.key]);
  return out;
}

export async function purgeDerivedRows(tx: Db | Tx, u: { orgId: string; id: string }): Promise<Record<string, number>> {
  const org = u.orgId;
  const keys = await deletable(tx, org, u.id);
  const n: Record<string, number> = {};
  const count = (k: string, rows: unknown[]) => { if (rows.length) n[k] = (n[k] ?? 0) + rows.length; };
  const fromUpload = sql`upload_id is not null`;
  const del = async (table: string, where: ReturnType<typeof sql>) => count(table, (await tx.execute(sql`delete from ${sql.identifier(table)} where org_id = ${org} and ${fromUpload} and ${where} returning 1`)).rows);
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const get = (table: string) => keys.get(table) ?? [];

  // Orders whose invoice goes: drop their per-order reconciliation outputs first (they reference the invoice).
  const orders = get("invoices").length ? (await tx.execute(sql`select order_id from invoices where org_id = ${org} and upload_id is not null and order_id in (${list(get("invoices"))})
    and not exists (select 1 from merchant_quotes q where q.org_id = invoices.org_id and q.order_id = invoices.order_id and q.quote_id not in (${list(get("merchant_quotes").length ? get("merchant_quotes") : [""])}))`)).rows.map((r) => String(r.order_id)) : [];
  const bankIds = get("bank_lines");
  if (orders.length || bankIds.length) {
    if (orders.length) {
      count("recon_exception_notes", (await tx.execute(sql`delete from recon_exception_notes where org_id = ${org} and exception_id in (select id from recon_exceptions where org_id = ${org} and order_id in (${list(orders)})) returning 1`)).rows);
      for (const table of ["recon_exceptions", "match_reviews", "writeoff_proposals", "match_records", "rule_change_notices"]) count(table, (await tx.execute(sql`delete from ${sql.identifier(table)} where org_id = ${org} and order_id in (${list(orders)}) returning 1`)).rows);
    }
    const journalRefs = sql.join([
      ...(orders.length ? [sql`evidence_refs -> 'orderIds' ?| array[${list(orders)}]::text[]`] : []),
      ...(bankIds.length ? [sql`evidence_refs ->> 'bankLineId' in (${list(bankIds)})`] : []),
    ], sql` or `);
    count("merchant_journal_proposals", (await tx.execute(sql`delete from merchant_journal_proposals where org_id = ${org} and (${journalRefs}) returning 1`)).rows);
  }
  if (orders.length) {
    await tx.execute(sql`alter table differences disable trigger differences_append_only`);
    count("differences", (await tx.execute(sql`delete from differences where org_id = ${org} and order_id in (${list(orders)}) returning 1`)).rows);
    await tx.execute(sql`alter table differences enable trigger differences_append_only`);
  }
  const transfers = get("chain_transfers").map((k) => k.split("|"));
  if (get("provider_payment_records").length) await del("provider_payment_records", sql`provider_payment_id in (${list(get("provider_payment_records"))})`);
  for (const [network, txHash, logIndex] of transfers) await del("chain_transfers", sql`network = ${network} and tx_hash = ${txHash} and log_index = ${Number(logIndex)} and source = 'provider_export'`);
  const lines = get("settlement_batch_lines").map((k) => { const i = k.lastIndexOf("|"); return [k.slice(0, i), Number(k.slice(i + 1))] as const; });
  for (const [batchId, lineNo] of lines) await del("settlement_batch_lines", sql`batch_id = ${batchId} and line_no = ${lineNo}`);
  if (get("settlement_batches").length) await del("settlement_batches", sql`batch_id in (${list(get("settlement_batches"))}) and not exists (select 1 from settlement_batch_lines l where l.org_id = settlement_batches.org_id and l.batch_id = settlement_batches.batch_id)`);
  if (get("payment_links").length) await del("payment_links", sql`link_id in (${list(get("payment_links"))})`);
  if (get("merchant_quotes").length) await del("merchant_quotes", sql`quote_id in (${list(get("merchant_quotes"))}) and not exists (select 1 from payment_links l where l.org_id = merchant_quotes.org_id and l.quote_id = merchant_quotes.quote_id)`);
  if (orders.length) await del("invoices", sql`order_id in (${list(orders)}) and not exists (select 1 from merchant_quotes q where q.org_id = invoices.org_id and q.order_id = invoices.order_id)`);
  for (const k of get("ledger_invoices")) {
    const i = k.indexOf("|");
    await del("ledger_invoices", sql`entity_id = ${k.slice(0, i)} and invoice_number = ${k.slice(i + 1)}`);
  }
  if (bankIds.length) {
    await tx.execute(sql`alter table bank_lines disable trigger bank_lines_immutable`);
    await del("bank_lines", sql`line_id in (${list(bankIds)}) and source = 'file_import'`);
    await tx.execute(sql`alter table bank_lines enable trigger bank_lines_immutable`);
  }
  count("upload_row_targets", await tx.delete(t.uploadRowTargets).where(and(eq(t.uploadRowTargets.orgId, org), eq(t.uploadRowTargets.uploadId, u.id))).returning({ n: t.uploadRowTargets.rowNumber }));
  return n;
}
