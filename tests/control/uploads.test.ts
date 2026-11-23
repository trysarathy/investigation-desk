/**
 * rc7 uploads against PostgreSQL 16 and a temporary upload folder: storage (encrypted, random keys), duplicate
 * files and rows, validation reports without cell values, second-person confirmation of bank statements (service
 * and database), merchant isolation, retention, and logs and audit rows that never contain file contents.
 * Fictional data only, built in the test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, resolveTenant, withTenant } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { grantMembership } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import {
  createUpload, decideUpload, deleteUpload, getUpload, listUploads, purgeExpiredUploads, sanitiseFileName, setRetentionDays, setUploadMapping, uploadPreview, validateUpload, validationReport,
} from "../../src/server/uploads";
import { saveMappingTemplate } from "../../src/server/mapping-templates";
import type { Mapping } from "../../src/lib/clearline/mapping";
import { USDT_TRON } from "../../src/lib/clearline/merchant/config";

let s: LiveSeed;
let sample: Awaited<ReturnType<typeof seedMerchantCases>>;
let dir: string;
let n = 0;
const key = () => `up-key-${++n}-${Date.now()}`;
const utf8 = (x: string) => new TextEncoder().encode(x);
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const tron = (i: number) => "T" + Array.from({ length: 33 }, (_, j) => B58[(i * 11 + j * 7) % 58]).join("");
const HEADER = "Order Ref,Quote,Invoice Amount,Quoted USDT,Rate,Contract,Chain,Deposit Address,Created,Expires";
const exportCsv = (ids: number[], marker = "") => [HEADER, ...ids.map((i) => `ORD-${marker}${i},Q-${i},"1,${String(i).padStart(3, "0")}.00",${750 + i}.000000,1.3500,${USDT_TRON},TRON,${tron(i)},2026-11-0${1 + (i % 8)} 10:00,2026-11-0${1 + (i % 8)} 10:30`)].join("\r\n") + "\r\n";
const MAPPING: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "Order Ref" }, quote_id: { header: "Quote" }, invoice_amount: { header: "Invoice Amount" }, currency: { constant: "SGD" }, quoted_token_amount: { header: "Quoted USDT" },
    quote_rate: { header: "Rate" }, rate_source: { constant: "provider quote" }, token_contract: { header: "Contract" }, network: { header: "Chain" }, deposit_address: { header: "Deposit Address" },
    created_at: { header: "Created", defaultUtcOffsetMinutes: 480 }, expires_at: { header: "Expires", defaultUtcOffsetMinutes: 480 },
  },
};
const BANK_CSV = "Date;Amount;Reference\n02.11.2026;5.961,24;B-FICT-001\n03.11.2026;(12,00);FEE\n";
const BANK: Mapping = { fileType: "bank_statement", columns: { bank_account: { constant: "ACC-FICTIONAL-1" }, value_date: { header: "Date", dateFormat: "dmy" }, currency: { constant: "SGD" }, amount: { header: "Amount", decimalSeparator: "," }, reference: { header: "Reference" } } };

async function uploadAndValidate(email: string, fileType: "provider_export" | "bank_statement", bytes: Uint8Array, mapping: Mapping, entityId = "ENT-LIVE-SG") {
  const c = await liveCtx(s, email, "a");
  const up = await createUpload(c, { entityId, fileType, fileName: `${fileType}.csv`, bytes }, key());
  await setUploadMapping(c, up.upload.id, { mapping }, key());
  return { up, validated: (await validateUpload(c, up.upload.id, key())).body };
}

beforeAll(async () => {
  dir = useTestStorage(true);
  await resetAndSeed();
  sample = await seedMerchantCases(ownerDb(), { password: "fictional-test-pass-01" });
  s = await seedLiveMerchants(ownerDb());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("storing an upload", () => {
  it("stores the file encrypted under a random key in the merchant's folder, and returns a preview and suggestions", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const r = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "../../etc/Export Nov\u0000.csv", bytes: utf8(exportCsv(Array.from({ length: 25 }, (_, i) => i + 1))) }, key());
    expect(r).toMatchObject({ status: 201, label: "Your data", upload: { status: "stored", fileFormat: "csv", encrypted: true, originalName: "Export Nov.csv", counts: { rows: 0 } } });
    expect(r.preview.rows).toHaveLength(20);
    expect(r.preview.totalRows).toBe(25);
    expect(r.suggestion?.suggestion.proposal.order_id).toEqual({ header: "Order Ref" });
    const [row] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, r.upload.id));
    const file = path.join(dir, s.orgs.a, row.storageKey!);
    expect(readdirSync(path.join(dir, s.orgs.a))).toEqual([row.storageKey]);
    expect(readFileSync(file).includes(Buffer.from("ORD-1"))).toBe(false);
    expect(row.deleteAfter.getTime() - row.createdAt.getTime()).toBeGreaterThan(89 * 86_400_000);
    expect((await uploadPreview(await liveCtx(s, "viewer@live-a.example", "a"), r.upload.id)).preview.headers[0]).toBe("Order Ref");
  });
  it("refuses a duplicate file, a sample organisation, an unreadable file, and roles that do not upload", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "again.csv", bytes: utf8(exportCsv(Array.from({ length: 25 }, (_, i) => i + 1))) }, key()), "DUPLICATE_UPLOAD");
    // the same file for another entity is a different upload
    expect((await createUpload(fin, { entityId: "ENT-LIVE-US", fileType: "provider_export", fileName: "x.csv", bytes: utf8(exportCsv([1])) }, key())).status).toBe(201);
    const sampleFin = await resolveTenant({ userId: sample.users["finance@straits-demo.example"], name: "f", email: "f" }, MERCHANT_SEED_ORGS.sg.slug);
    await refused(createUpload(sampleFin, { entityId: "ENT-SG-01", fileType: "provider_export", fileName: "x.csv", bytes: utf8(exportCsv([1])) }, key()), "SAMPLE_ORGANISATION");
    await dbRefuses(as(sampleFin.userId, sampleFin.orgId, sql`insert into uploads (org_id, entity_id, file_type, file_format, original_name, byte_size, content_sha256, encrypted, uploaded_by, delete_after)
      values (${sampleFin.orgId}, 'ENT-SG-01', 'provider_export', 'csv', 'x', 1, ${"a".repeat(64)}, false, ${sampleFin.userId}, now())`), /live merchant/);
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "x.pdf", bytes: utf8("%PDF-1.4 fictional") }, key()), "FILE_UNSUPPORTED_FILE");
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "x.csv", bytes: new Uint8Array(0) }, key()), "FILE_FILE_EMPTY");
    await refused(createUpload(fin, { entityId: "ENT-NOPE", fileType: "provider_export", fileName: "x.csv", bytes: utf8(exportCsv([77])) }, key()), "ACCESS_404");
    for (const e of ["viewer@live-a.example", "approver@live-a.example", "admin@live-a.example"]) {
      await refused(createUpload(await liveCtx(s, e, "a"), { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "x.csv", bytes: utf8(exportCsv([88])) }, key()), "ACCESS_403");
    }
  });
});

describe("a JSON file with several lists (rc7 blind test, generic)", () => {
  // an invoicing export with two lists and nested totals: a generic shape, not any provider's format (fictional)
  const FILE = utf8(JSON.stringify({ exported: "2026-11-30", invoices: [{ no: "INV-J1", total: { amount: "10.00", ccy: "SGD" } }, { no: "INV-J2", total: { amount: "5.50", ccy: "SGD" } }], refunds: [{ no: "RF-J1", of: "INV-J1", amount: "1.00" }] }));
  const ORDERS: Mapping = { fileType: "orders_invoices", columns: { order_id: { header: "no" }, invoice_amount: { header: "total.amount" }, currency: { header: "total.ccy" } } };
  it("is refused with its lists named; uploaded again with the chosen list, which is kept as a file fact the database will not change", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    let err: unknown;
    try { await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "orders_invoices", fileName: "invoices.json", bytes: FILE }, key()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RequestRefused);
    expect(err).toMatchObject({ status: 422, code: "FILE_JSON_LIST_CHOICE", choices: ["invoices", "refunds"] });
    expect(await ownerDb().select().from(t.uploads).where(and(eq(t.uploads.orgId, s.orgs.a), eq(t.uploads.originalName, "invoices.json")))).toEqual([]);
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "orders_invoices", fileName: "invoices.json", bytes: FILE, jsonList: "payments" }, key()), "FILE_JSON_LIST_CHOICE");
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "orders_invoices", fileName: "x.csv", bytes: utf8("Order,Amount\nA,1\n"), jsonList: "invoices" }, key()), "JSON_LIST_NOT_JSON");
    const up = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "orders_invoices", fileName: "invoices.json", bytes: FILE, jsonList: "invoices" }, key());
    expect(up).toMatchObject({ status: 201, upload: { fileFormat: "json", jsonList: "invoices" }, preview: { headers: ["no", "total.amount", "total.ccy"], totalRows: 2, list: "invoices", lists: ["invoices", "refunds"] } });
    expect((await uploadPreview(fin, up.upload.id)).preview).toMatchObject({ list: "invoices", totalRows: 2 });
    await setUploadMapping(fin, up.upload.id, { mapping: ORDERS }, key());
    expect((await validateUpload(fin, up.upload.id, key())).body.counts).toMatchObject({ rows: 2, accepted: 2, rejected: 0 });
    // the other list of the same file is another file type's upload; the same file, type and entity again is a duplicate
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "orders_invoices", fileName: "invoices.json", bytes: FILE, jsonList: "refunds" }, key()), "DUPLICATE_UPLOAD");
    await dbRefuses(ownerDb().execute(sql`update uploads set status = 'mapped', json_list = 'refunds' where id = ${up.upload.id}`), /file facts are immutable/);
    await dbRefuses(ownerDb().execute(sql`insert into uploads (org_id, entity_id, file_type, file_format, original_name, byte_size, content_sha256, encrypted, uploaded_by, delete_after, json_list)
      values (${s.orgs.a}, 'ENT-LIVE-SG', 'orders_invoices', 'csv', 'x', 1, ${"b".repeat(64)}, false, ${s.users["finance@live-a.example"]}, now(), 'invoices')`), /uploads_json_list_chk/);
  });
});

describe("mapping and validation", () => {
  it("validates rows with reason codes, and marks rows already in another upload as duplicates", async () => {
    const { up, validated } = await uploadAndValidate("ops@live-a.example", "provider_export", utf8(exportCsv([101, 102, 103]).replace("Q-102,", "Q-102 ,").replace("1.3500,", "abc,")), MAPPING);
    expect(validated).toMatchObject({ status: "validated", counts: { rows: 3, accepted: 2, rejected: 1, duplicate: 0 } });
    const report = await validationReport(await liveCtx(s, "viewer@live-a.example", "a"), up.upload.id, { status: "rejected" });
    expect(report.rows).toEqual([{ rowNumber: 2, status: "rejected", reasonCodes: [{ field: "quote_rate", code: "amount_not_a_number", level: "error" }], targetRef: null }]);
    const second = await uploadAndValidate("ops@live-a.example", "provider_export", utf8(exportCsv([102, 103, 104])), MAPPING);
    expect(second.validated.counts).toEqual({ rows: 3, accepted: 1, rejected: 0, warning: 0, duplicate: 2 });
    // using a template records its id and version
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const tpl = (await saveMappingTemplate(fin, { fileType: "provider_export", name: "Export", headers: HEADER.split(","), mapping: MAPPING }, key())).body;
    const mapped = (await setUploadMapping(fin, second.up.upload.id, { templateId: tpl.id }, key())).body;
    expect(mapped).toMatchObject({ status: "mapped", templateId: tpl.id, templateVersion: 1, counts: { rows: 0 } });
    expect((await validateUpload(fin, second.up.upload.id, key())).body.counts.duplicate).toBe(2);
  });
  it("SECURITY: merchant B and a provider cannot see or use merchant A's uploads", async () => {
    const [u] = (await listUploads(await liveCtx(s, "finance@live-a.example", "a"))).uploads;
    const b = await liveCtx(s, "finance@live-b.example", "b");
    expect((await listUploads(b)).uploads).toEqual([]);
    await refused(getUpload(b, u.id), "ACCESS_404");
    await refused(uploadPreview(b, u.id), "ACCESS_404");
    await refused(validateUpload(b, u.id, key()), "ACCESS_404");
    for (const table of ["uploads", "upload_rows"]) expect((await as(b.userId, s.orgs.a, sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n, table).toBe(0);
    const p = await liveCtx(s, "admin@provider-a.example", "providerA");
    await refused(listUploads(p), "ACCESS_403");
    expect((await as(p.userId, p.orgId, sql`select count(*)::int as n from uploads`)).rows[0].n).toBe(0);
  });
});

describe("confirmation", () => {
  it("SECURITY: a bank statement is confirmed only by an approver who did not upload it (service and database)", async () => {
    const { up, validated } = await uploadAndValidate("finance@live-a.example", "bank_statement", utf8(BANK_CSV), BANK);
    expect(validated.counts).toMatchObject({ accepted: 2 });
    const decision = { decision: "confirm" as const, reason: "Statement checked (fictional)", contentSha256: validated.contentSha256, rowsSha256: validated.rowsSha256! };
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    await refused(decideUpload(fin, up.upload.id, decision, key()), "ACCESS_403");
    await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set status = 'confirmed', confirmed_by = ${fin.userId}, confirmed_at = now() where id = ${up.upload.id}`), /maker-checker|uploads_confirmer_chk/);
    // even as an approver, the uploader cannot confirm
    await grantMembership(ownerDb(), { orgSlug: s.slugs.a, email: "finance@live-a.example", role: "approver" });
    try {
      await refused(decideUpload(await liveCtx(s, "finance@live-a.example", "a"), up.upload.id, decision, key()), "MAKER_CANNOT_CONFIRM");
      await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set status = 'confirmed', confirmed_by = ${fin.userId}, confirmed_at = now() where id = ${up.upload.id}`), /maker-checker|uploads_confirmer_chk/);
    } finally { await grantMembership(ownerDb(), { orgSlug: s.slugs.a, email: "finance@live-a.example", role: "finance" }); }
    const approver = await liveCtx(s, "approver@live-a.example", "a");
    await dbRefuses(as(approver.userId, approver.orgId, sql`update uploads set status = 'confirmed', confirmed_by = ${s.users["approver2@live-a.example"]} where id = ${up.upload.id}`), /signed-in user/);
    await refused(decideUpload(approver, up.upload.id, { ...decision, rowsSha256: "0".repeat(64) }, key()), "VERSION_MISMATCH");
    expect((await decideUpload(approver, up.upload.id, decision, key())).body).toMatchObject({ status: "confirmed", confirmedBy: approver.userId });
    // a confirmed upload's validation and file facts never change, and the app cannot delete it
    await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set rows_sha256 = ${"1".repeat(64)} where id = ${up.upload.id}`), /immutable/);
    await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set original_name = 'x' where id = ${up.upload.id}`), /immutable/);
    await dbRefuses(as(fin.userId, fin.orgId, sql`delete from upload_rows where upload_id = ${up.upload.id}`), /kept until retention/);
    await refused(deleteUpload(fin, up.upload.id, key()), "UPLOAD_CONFIRMED");
    await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set status = 'normalised' where id = ${(await listUploads(fin)).uploads[0].id}`), /cannot go from/);
  });
  it("other files are confirmed by Finance or Payment Operations, including the uploader", async () => {
    const { up, validated } = await uploadAndValidate("ops@live-a.example", "provider_export", utf8(exportCsv([201, 202])), MAPPING);
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    await refused(decideUpload(await liveCtx(s, "viewer@live-a.example", "a"), up.upload.id, { decision: "confirm", reason: "ok (fictional)", contentSha256: validated.contentSha256, rowsSha256: validated.rowsSha256! }, key()), "ACCESS_403");
    expect((await decideUpload(ops, up.upload.id, { decision: "confirm", reason: "Mapping checked (fictional)", contentSha256: validated.contentSha256, rowsSha256: validated.rowsSha256! }, key())).body.status).toBe("confirmed");
  });
});

describe("retention", () => {
  it("only an Admin sets the period; purge removes the file and validation rows and keeps an audit of counts", async () => {
    await refused(setRetentionDays(await liveCtx(s, "finance@live-a.example", "a"), 30, key()), "ACCESS_403");
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    await dbRefuses(as(fin.userId, fin.orgId, sql`insert into merchant_data_settings (org_id, retention_days, updated_by) values (${fin.orgId}, 1, ${fin.userId})`), /set by an Admin/);
    expect((await setRetentionDays(await liveCtx(s, "admin@live-a.example", "a"), 30, key())).body).toEqual({ retentionDays: 30 });
    const { up } = await uploadAndValidate("finance@live-a.example", "provider_export", utf8(exportCsv([301, 302])), MAPPING);
    const [row] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, up.upload.id));
    expect(Math.round((row.deleteAfter.getTime() - row.createdAt.getTime()) / 86_400_000)).toBe(30);
    const file = path.join(dir, s.orgs.a, row.storageKey!);
    expect(existsSync(file)).toBe(true);
    const purged = await purgeExpiredUploads(ownerDb(), new Date(row.deleteAfter.getTime() + 1));
    expect(purged.uploads).toBeGreaterThanOrEqual(1);
    expect(existsSync(file)).toBe(false);
    const [after] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, up.upload.id));
    expect(after).toMatchObject({ status: "deleted", storageKey: null });
    expect(await ownerDb().select().from(t.uploadRows).where(eq(t.uploadRows.uploadId, up.upload.id))).toEqual([]);
    const audit = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.action, "upload_purged"), eq(t.auditEvents.entityId, up.upload.id)));
    expect(audit[0].details).toMatchObject({ uploadId: up.upload.id, fileRemoved: true, validationRows: 2 });
    await refused(getUpload(fin, up.upload.id), "ACCESS_404");
    // a purged file may be uploaded again
    expect((await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "again.csv", bytes: utf8(exportCsv([301, 302])) }, key())).status).toBe(201);
  });
});

describe("SECURITY: logs and audit never contain file contents", () => {
  const MARKER = "ZQX-FICTIONAL-MARKER-4471";
  let captured: string[] = [];
  beforeEach(() => {
    captured = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map(String).join(" ")); });
  });
  afterEach(() => vi.restoreAllMocks());
  it("a file holding a distinctive marker leaves no trace of it outside upload storage", async () => {
    const bytes = utf8(exportCsv([401, 402, 403], MARKER).replace(`${tron(402)}`, `${MARKER}`));
    const { up, validated } = await uploadAndValidate("finance@live-a.example", "provider_export", bytes, MAPPING);
    expect(validated.counts).toMatchObject({ accepted: 2, rejected: 1 });
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    await validationReport(fin, up.upload.id);
    await uploadPreview(fin, up.upload.id);
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "provider_export", fileName: "bad.json", bytes: utf8(`[{"a": "${MARKER}" ]`) }, key()), "FILE_INVALID_JSON");
    await decideUpload(fin, up.upload.id, { decision: "confirm", reason: "Checked (fictional)", contentSha256: validated.contentSha256, rowsSha256: validated.rowsSha256! }, key());
    expect(captured.join("\n")).not.toContain(MARKER);
    for (const table of ["audit_events", "idempotency_records", "uploads", "upload_rows", "mapping_templates"]) {
      const dump = await ownerDb().execute(sql.raw(`select coalesce(string_agg(x::text, ''), '') as dump from ${table} x`));
      expect(String(dump.rows[0].dump), table).not.toContain(MARKER);
    }
    for (const f of readdirSync(path.join(dir, s.orgs.a))) expect(readFileSync(path.join(dir, s.orgs.a, f)).includes(Buffer.from(MARKER))).toBe(false);
  });
});

describe("file names", () => {
  it("are display names only: no path, no control characters, at most 120 characters", () => {
    expect(sanitiseFileName("C:\\Users\\x\\Statement Nov.xlsx")).toBe("Statement Nov.xlsx");
    expect(sanitiseFileName("..")).toBe("upload");
    expect(sanitiseFileName(`${"a".repeat(300)}.csv`)).toHaveLength(120);
    expect(sanitiseFileName(`${"a".repeat(300)}.csv`).endsWith(".csv")).toBe(true);
  });
});
