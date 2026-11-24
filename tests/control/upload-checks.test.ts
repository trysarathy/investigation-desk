/**
 * rc8 against PostgreSQL 16: the upload-provenance and upload-target checks, now run once per statement (migration
 * 0030), keep the per-row guarantee. Every kind of row the per-row triggers refused (another merchant's upload, an
 * unknown upload, an upload not confirmed or already normalised, a file type that does not produce the table, another
 * uploader, another template, a statement line without its second person, a provider claim that is confirmed or
 * final) is still refused when it is one row of a multi-row or bulk statement, and then NOTHING of that statement is
 * written: single-row, multi-row and bulk inserts, as the runtime login and as the owner, and updates.
 * Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { accountFields, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import { withTenant, type TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let fin: TenantContext, ops: TenantContext, approver: TenantContext;
let n = 0;
const key = () => `chk-key-${++n}-${Date.now()}`;
type Row = Record<string, unknown>;
const U: Record<string, string> = {};
const T: Record<string, Row> = {};
let ROWS: number[] = [];

async function upload(uploader: TenantContext, fileType: FileType, name: string, bytes: Uint8Array, mapping: Mapping, until: "validated" | "confirmed" | "normalised", confirmer?: TenantContext) {
  const up = await createUpload(uploader, { entityId: sc.SG.entityId, fileType, fileName: name, bytes, ...(await accountFields(uploader, sc.SG.entityId, fileType)) }, key());
  await setUploadMapping(uploader, up.upload.id, { mapping }, key());
  const v = (await validateUpload(uploader, up.upload.id, key())).body;
  if (until !== "validated") await decideUpload(confirmer!, up.upload.id, { decision: "confirm", reason: "Checked (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  if (until === "normalised") await normaliseUpload(confirmer!, up.upload.id, key());
  return up.upload.id;
}

const rowsOf = (table: string, rows: Row[]) => sql`insert into ${sql.identifier(table)} select * from jsonb_populate_recordset(null::${sql.identifier(table)}, ${JSON.stringify(rows)}::jsonb)`;
const asRuntime = (q: ReturnType<typeof sql>) => withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(q));
const asOwner = (q: ReturnType<typeof sql>) => ownerDb().execute(q);
async function refused(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
const count = async (table: string, col: string, prefix: string) =>
  Number((await ownerDb().execute(sql`select count(*)::int as n from ${sql.identifier(table)} where org_id = ${s.orgs.a} and ${sql.identifier(col)} like ${`${prefix}%`}`)).rows[0].n);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A fresh (fictional) TRON-shaped deposit address: quotes' deposit addresses are unique. */
const address = () => "T" + Array.from(randomBytes(33), (b) => B58[b % 58]).join("");
/** Per table: the template row (a row normalisation wrote), the key column and how to make the i-th good row. */
interface Table { table: string; keyCol: string; good: (prefix: string, i: number) => Row }
const tables = (): Record<string, Table> => ({
  invoices: { table: "invoices", keyCol: "order_id", good: (p, i) => ({ ...T.invoices, order_id: `${p}${i}`, upload_id: U.export2, source_row: i + 1 }) },
  bank_lines: { table: "bank_lines", keyCol: "line_id", good: (p, i) => ({ ...T.bank_lines, line_id: `${p}${i}`, upload_id: U.bank2, source_row: i + 1 }) },
  chain_transfers: { table: "chain_transfers", keyCol: "tx_hash", good: (p, i) => ({ ...T.chain_transfers, tx_hash: `${p}${String(i).padStart(6, "0")}`, upload_id: U.export2, source_row: i + 1 }) },
  merchant_quotes: { table: "merchant_quotes", keyCol: "quote_id", good: (p, i) => ({ ...T.merchant_quotes, quote_id: `${p}${i}`, deposit_address: address(), upload_id: U.export2, source_row: i + 1 }) },
  provider_payment_records: { table: "provider_payment_records", keyCol: "provider_payment_id", good: (p, i) => ({ ...T.provider_payment_records, provider_payment_id: `${p}${i}`, upload_id: U.export2, source_row: i + 1 }) },
  upload_row_targets: { table: "upload_row_targets", keyCol: "target_key", good: (p, i) => ({ org_id: s.orgs.a, upload_id: U.export2, row_number: ROWS[i % ROWS.length], target_table: "invoices", target_key: `${p}${i}` }) },
});

/**
 * Every kind of bad row the per-row triggers refused, with the refusal each gives (the rc7 messages, unchanged). Where
 * a CHECK or foreign key also refuses the row, the database answers with whichever runs first (the rc7 BEFORE trigger
 * ran before constraints; the statement check runs after them): the statement is refused either way.
 */
const PROVENANCE = /a row comes from a confirmed upload of a matching file type, with that upload's provenance/;
const BAD: { name: string; table: string; bad: (r: Row) => Row; re: RegExp }[] = [
  { name: "another merchant's upload", table: "invoices", bad: (r) => ({ ...r, upload_id: U.otherOrg }), re: PROVENANCE },
  { name: "an upload that does not exist", table: "invoices", bad: (r) => ({ ...r, upload_id: randomUUID() }), re: PROVENANCE },
  { name: "an upload not confirmed (validated only)", table: "invoices", bad: (r) => ({ ...r, upload_id: U.unconfirmed }), re: PROVENANCE },
  { name: "an upload already normalised", table: "invoices", bad: (r) => ({ ...r, upload_id: U.export1 }), re: PROVENANCE },
  { name: "a file type that does not produce invoices (bank statement)", table: "invoices", bad: (r) => ({ ...r, upload_id: U.bank2 }), re: PROVENANCE },
  { name: "another uploader", table: "invoices", bad: (r) => ({ ...r, uploaded_by: ops.userId }), re: PROVENANCE },
  { name: "another template", table: "invoices", bad: (r) => ({ ...r, mapping_template_id: randomUUID(), mapping_template_version: 1 }), re: PROVENANCE },
  { name: "a statement line from a provider export", table: "bank_lines", bad: (r) => ({ ...r, upload_id: U.export2 }), re: PROVENANCE },
  { name: "a statement line from an unconfirmed upload", table: "bank_lines", bad: (r) => ({ ...r, upload_id: U.unconfirmedBank }), re: PROVENANCE },
  { name: "a statement line naming its upload but not imported (maker-checker)", table: "bank_lines", bad: (r) => ({ ...r, source: "csv_import" }), re: /maker-checker: a statement line is written only after a second person confirmed its upload|bank_lines_import_chk/ },
  { name: "an imported statement line without its upload", table: "bank_lines", bad: (r) => ({ ...r, upload_id: null }), re: /names its upload|bank_lines_upload_chk/ },
  { name: "a provider claim recorded final", table: "chain_transfers", bad: (r) => ({ ...r, finalised: true }), re: /a transfer claimed by a provider file is recorded from its upload, unconfirmed and not final/ },
  { name: "a provider claim recorded confirmed", table: "chain_transfers", bad: (r) => ({ ...r, confirmations: 30 }), re: /unconfirmed and not final/ },
  { name: "a provider claim without its upload", table: "chain_transfers", bad: (r) => ({ ...r, upload_id: null }), re: /unconfirmed and not final/ },
  { name: "a file's transfer that is not a provider claim", table: "chain_transfers", bad: (r) => ({ ...r, source: "chain_client" }), re: /a transfer from a provider file is a provider claim|chain_transfers_evidence_chk/ },
  { name: "a quote from a bank statement", table: "merchant_quotes", bad: (r) => ({ ...r, upload_id: U.bank2 }), re: PROVENANCE },
  { name: "a quote from an unconfirmed upload", table: "merchant_quotes", bad: (r) => ({ ...r, upload_id: U.unconfirmed }), re: PROVENANCE },
  { name: "a payment record from a bank statement", table: "provider_payment_records", bad: (r) => ({ ...r, upload_id: U.bank2 }), re: PROVENANCE },
  { name: "a payment record from another merchant's upload", table: "provider_payment_records", bad: (r) => ({ ...r, upload_id: U.otherOrg }), re: PROVENANCE },
  { name: "a target of an unconfirmed upload", table: "upload_row_targets", bad: (r) => ({ ...r, upload_id: U.unconfirmed }), re: /normalised rows are recorded only while a confirmed upload is normalised/ },
  { name: "a target of an upload already normalised", table: "upload_row_targets", bad: (r) => ({ ...r, upload_id: U.export1 }), re: /normalised rows are recorded only while a confirmed upload is normalised/ },
];

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  [fin, ops, approver] = await Promise.all([liveCtx(s, "finance@live-a.example", "a"), liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "approver@live-a.example", "a")]);
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  U.export1 = await upload(fin, "provider_export", "export-1.csv", sc.sgExportCsv("one"), sc.SG_EXPORT_MAPPING, "normalised", ops);
  // a second export with other orders, payments and transactions (the first one's rows would be duplicates)
  const other = new TextEncoder().encode(new TextDecoder().decode(sc.sgExportCsv("two")).replaceAll("SG-1", "SG-2").replaceAll("P-SG-", "P-SG2-").replaceAll("Q-SG-", "Q-SG2-").replaceAll("abc00", "abd00"));
  U.export2 = await upload(fin, "provider_export", "export-2.csv", other, sc.SG_EXPORT_MAPPING, "confirmed", ops);
  U.unconfirmed = await upload(fin, "provider_export", "export-3.csv", sc.sgExportCsv("three"), sc.SG_EXPORT_MAPPING, "validated");
  U.bank1 = await upload(fin, "bank_statement", "bank-1.csv", sc.sgBankCsv("one"), sc.SG_BANK_MAPPING, "normalised", approver);
  U.bank2 = await upload(fin, "bank_statement", "bank-2.csv", sc.sgBankCsv("two"), sc.SG_BANK_MAPPING, "confirmed", approver);
  U.unconfirmedBank = await upload(fin, "bank_statement", "bank-3.csv", sc.sgBankCsv("three"), sc.SG_BANK_MAPPING, "validated");
  const finB = await liveCtx(s, "finance@live-b.example", "b");
  U.otherOrg = (await createUpload(finB, { entityId: "ENT-LIVE-AE", fileType: "provider_export", fileName: "b.csv", bytes: sc.sgExportCsv("b") }, key())).upload.id;
  ROWS = (await ownerDb().execute(sql`select row_number from upload_rows where upload_id = ${U.export2} order by 1`)).rows.map((x) => Number(x.row_number));
  expect(ROWS.length).toBeGreaterThan(0);
  for (const tb of ["invoices", "bank_lines", "chain_transfers", "merchant_quotes", "provider_payment_records"]) {
    const [r] = (await ownerDb().execute(sql`select to_jsonb(x) as j from ${sql.identifier(tb)} x where org_id = ${s.orgs.a} and upload_id = ${tb === "bank_lines" ? U.bank1 : U.export1} limit 1`)).rows;
    expect(r, `${tb}: normalisation wrote a template row`).toBeDefined();
    T[tb] = r.j as Row;
  }
  expect(T.chain_transfers).toMatchObject({ source: "provider_export", finalised: false, confirmations: 0 });
  expect(T.bank_lines).toMatchObject({ source: "file_import" });
});
afterAll(async () => { vi.restoreAllMocks(); await closeDatabase(); await closeOwner(); });

describe("the checks run once per statement", () => {
  it("every provenance and target trigger is an AFTER INSERT statement trigger over the inserted rows", async () => {
    const r = (await ownerDb().execute(sql`select c.relname as tbl, t.tgname, (t.tgtype & 1) = 1 as per_row, (t.tgtype & 2) = 2 as before, (t.tgtype & 4) = 4 as on_insert,
        t.tgnewtable, p.proname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where t.tgname like '%upload_provenance' or t.tgname = 'upload_row_targets_check' order by 1`)).rows;
    expect(r.map((x) => x.tbl)).toEqual(["bank_lines", "chain_transfers", "invoices", "ledger_invoices", "merchant_quotes", "payment_links", "provider_payment_records", "settlement_batch_lines", "settlement_batches", "upload_row_targets"]);
    for (const x of r) expect(x, String(x.tbl)).toMatchObject({ per_row: false, before: false, on_insert: true, tgnewtable: "new_rows" });
  });
});

describe("SECURITY: one bad row refuses the whole statement, and nothing of it is written", () => {
  it("a batch of good rows alone is written (so each refusal below is the bad row's)", async () => {
    for (const tb of Object.values(tables())) {
      const p = `OK-${tb.table.slice(0, 3)}-`;
      await asRuntime(rowsOf(tb.table, Array.from({ length: 5 }, (_, i) => tb.good(p, i))));
      expect(await count(tb.table, tb.keyCol, p), tb.table).toBe(5);
    }
  });

  for (const c of BAD) {
    it(`${c.table}: ${c.name}: single-row, multi-row and bulk inserts (runtime login), and a multi-row insert by the owner`, async () => {
      const tb = tables()[c.table];
      const p = `B${++n}-`;
      const good = (i: number) => tb.good(p, i);
      await refused(asRuntime(rowsOf(tb.table, [c.bad(good(0))])), c.re);
      await refused(asRuntime(rowsOf(tb.table, [good(1), good(2), good(3), c.bad(good(4)), good(5), good(6)])), c.re);
      await refused(asRuntime(rowsOf(tb.table, Array.from({ length: 400 }, (_, i) => (i === 250 ? c.bad(good(100 + i)) : good(100 + i))))), c.re);
      await refused(asOwner(rowsOf(tb.table, [good(900), c.bad(good(901)), good(902)])), c.re);
      expect(await count(tb.table, tb.keyCol, p)).toBe(0);
    });
  }

  it("another merchant's rows: refused by row-level security for the runtime login, by the check for the owner", async () => {
    const p = "ORG-";
    // (the rc7 BEFORE trigger answered before row-level security; the statement check answers after it: both refuse)
    await refused(asRuntime(rowsOf("invoices", [tables().invoices.good(p, 1), { ...tables().invoices.good(p, 2), org_id: s.orgs.b }])), new RegExp(`row-level security|${PROVENANCE.source}`));
    await refused(asOwner(rowsOf("invoices", [tables().invoices.good(p, 3), { ...tables().invoices.good(p, 4), org_id: s.orgs.b }])), new RegExp(`${PROVENANCE.source}|invoices_entity_fk`));
    await refused(asOwner(rowsOf("upload_row_targets", [tables().upload_row_targets.good(p, 1), { ...tables().upload_row_targets.good(p, 2), upload_id: U.otherOrg }])), /normalised rows are recorded only|upload_row_targets_row_fk/);
    expect(await count("invoices", "order_id", p)).toBe(0);
    expect(Number((await ownerDb().execute(sql`select count(*)::int as n from invoices where order_id like 'ORG-%'`)).rows[0].n)).toBe(0);
    expect(await count("upload_row_targets", "target_key", p)).toBe(0);
  });

  it("updates: a single-row or bulk update that changes one row's provenance, or confirms a provider claim, is refused and changes nothing", async () => {
    const p = "UPD-";
    await asRuntime(rowsOf("invoices", Array.from({ length: 300 }, (_, i) => tables().invoices.good(p, i))));
    await asRuntime(rowsOf("chain_transfers", Array.from({ length: 300 }, (_, i) => tables().chain_transfers.good(p, i))));
    const snapshot = async () => (await ownerDb().execute(sql`select string_agg(to_jsonb(x)::text, '|' order by order_id) as d from invoices x where order_id like 'UPD-%'`)).rows[0].d
      + String((await ownerDb().execute(sql`select string_agg(to_jsonb(x)::text, '|' order by tx_hash) as d from chain_transfers x where tx_hash like 'UPD-%'`)).rows[0].d);
    const before = await snapshot();
    const one = "UPD-7";
    await refused(asRuntime(sql`update invoices set upload_id = ${U.bank2} where org_id = ${s.orgs.a} and order_id = ${one}`), /provenance is immutable/);
    await refused(asRuntime(sql`update invoices set uploaded_by = case when order_id = ${one} then ${ops.userId} else uploaded_by end where org_id = ${s.orgs.a} and order_id like 'UPD-%'`), /provenance is immutable/);
    await refused(asOwner(sql`update invoices set source_row = source_row + case when order_id = ${one} then 1 else 0 end where order_id like 'UPD-%'`), /provenance is immutable/);
    await refused(asRuntime(sql`update chain_transfers set finalised = true where org_id = ${s.orgs.a} and tx_hash = ${"UPD-000007"}`), /never confirmed or finalised/);
    await refused(asRuntime(sql`update chain_transfers set confirmations = case when tx_hash = ${"UPD-000007"} then 40 else 0 end where org_id = ${s.orgs.a} and tx_hash like 'UPD-%'`), /never confirmed or finalised/);
    expect(await snapshot()).toBe(before);
  });

  it("a bad row an INSERT … ON CONFLICT DO NOTHING skips (its key already exists) is not written either", async () => {
    // The good row exists; the proposed row for the same key names an unconfirmed upload. Nothing of it is stored and
    // the stored row is unchanged. (rc7's per-row trigger refused this statement; the statement check sees only rows
    // the statement actually inserts, so here the statement is a no-op instead. No bad row is stored in either case.)
    const p = "CONF-";
    await asRuntime(rowsOf("invoices", [tables().invoices.good(p, 1)]));
    const stored = async () => (await ownerDb().execute(sql`select to_jsonb(x) as j from invoices x where org_id = ${s.orgs.a} and order_id = ${`${p}1`}`)).rows[0].j;
    const before = await stored();
    await asRuntime(sql`insert into invoices select * from jsonb_populate_recordset(null::invoices, ${JSON.stringify([{ ...tables().invoices.good(p, 1), upload_id: U.unconfirmed }])}::jsonb) on conflict do nothing`).catch(() => undefined);
    expect(await stored()).toEqual(before);
    // a bad row for a NEW key in the same statement is still refused, with the whole statement
    await refused(asRuntime(sql`insert into invoices select * from jsonb_populate_recordset(null::invoices, ${JSON.stringify([tables().invoices.good(p, 1), { ...tables().invoices.good(p, 2), upload_id: U.unconfirmed }])}::jsonb) on conflict do nothing`), PROVENANCE);
    expect(await count("invoices", "order_id", p)).toBe(1);
  });
});
