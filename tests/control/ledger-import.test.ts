/**
 * rc7 phase 3b: ledger invoices through the SAME upload → mapping → validation → confirmation → normalise flow, as a
 * CSV, as an XLSX and as a read-only pull from a (recorded, fictional) Xero demo company. Exact decimals, provenance,
 * content-hash duplicates, row duplicates across files, cross-merchant isolation, retention, and no file content in
 * logs or audit rows. Every value is fictional and built in the test; nothing calls a ledger.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, purgeExpiredUploads, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { saveMappingTemplate } from "../../src/server/mapping-templates";
import { listLedgerInvoices, pullLedgerInvoices } from "../../src/server/ledger";
import type { Mapping } from "../../src/lib/clearline/mapping";
import type { Fetch } from "../../src/lib/accounting/providers/xero";

let s: LiveSeed;
let fin: TenantContext, ops: TenantContext, viewer: TenantContext, finB: TenantContext;
let n = 0;
const key = () => `ledger-key-${++n}-${Date.now()}`;
const MARKER = "ZQX-LEDGER-MARKER-4471";
const captured: string[] = [];
const utf8 = (x: string) => new TextEncoder().encode(x);

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

const CSV = [
  "Invoice No,Reference,Customer,Total,Ccy,Balance,Status,Invoice Date,Due Date",
  `INV-0001,SG-1001,${MARKER} Pte (fictional),"1,350.00",SGD,0.00,Paid,2026-11-01,2026-11-15`,
  "INV-0002,SG-1002,Harbour Co (fictional),0.10,SGD,0.10,Authorised,2026-11-02,2026-11-16",
  "INV-0003,,Lumen Co (fictional),9007199254740993.27,SGD,9007199254740993.27,Authorised,2026-11-03,2026-11-17",
  "INV-0004,SG-1004,Void Co (fictional),20.00,SGD,0.00,Voided,2026-11-03,",
  "INV-0005,SG-1005,USD Co (fictional),15.00,USD,15.00,Authorised,2026-11-03,",
  "INV-0006,SG-1006,Bad Co (fictional),12.345,SGD,0,Authorised,2026-11-04,",
].join("\r\n") + "\r\n";
const MAPPING: Mapping = {
  fileType: "ledger_invoices",
  columns: {
    invoice_number: { header: "Invoice No" }, order_id: { header: "Reference" }, contact: { header: "Customer" }, total: { header: "Total", decimalSeparator: "." }, currency: { header: "Ccy" },
    amount_due: { header: "Balance", decimalSeparator: "." }, status: { header: "Status", statusValueMap: { Paid: "paid", Authorised: "open", Voided: "void" } },
    issued_on: { header: "Invoice Date", dateFormat: "iso" }, due_on: { header: "Due Date", dateFormat: "iso" },
  },
};

async function pipeline(c: TenantContext, entityId: string, fileName: string, bytes: Uint8Array, mapping: Mapping | { templateId: string }) {
  const up = await createUpload(c, { entityId, fileType: "ledger_invoices", fileName, bytes }, key());
  await setUploadMapping(c, up.upload.id, "templateId" in mapping ? mapping : { mapping }, key());
  const v = (await validateUpload(c, up.upload.id, key())).body;
  await decideUpload(c, up.upload.id, { decision: "confirm", reason: "Checked against the ledger (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  const norm = (await normaliseUpload(c, up.upload.id, key())).body;
  return { id: up.upload.id, v, norm, suggestion: up.suggestion };
}
const rowsOf = (c: TenantContext, entityId: string) => withTenant({ userId: c.userId, orgId: c.orgId }, (tx) =>
  tx.select().from(t.ledgerInvoices).where(and(eq(t.ledgerInvoices.orgId, c.orgId), eq(t.ledgerInvoices.entityId, entityId))).orderBy(t.ledgerInvoices.invoiceNumber), { read: true });

beforeAll(async () => {
  useTestStorage();
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map(String).join(" ")); });
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-ledger");
  fin = await liveCtx(s, "finance@live-a.example", "a");
  ops = await liveCtx(s, "ops@live-a.example", "a");
  viewer = await liveCtx(s, "viewer@live-a.example", "a");
  finB = await liveCtx(s, "finance@live-b.example", "b");
});
afterAll(async () => { vi.restoreAllMocks(); await closeDatabase(); await closeOwner(); });

describe("ledger invoices: CSV", () => {
  let first: Awaited<ReturnType<typeof pipeline>>;
  it("validates every row (accepted, or rejected with a reason code) and normalises exact amounts with provenance", async () => {
    first = await pipeline(fin, "ENT-LIVE-SG", "ledger-export.csv", utf8(CSV), MAPPING);
    expect(first.suggestion?.suggestion.proposal.invoice_number?.header).toBe("Invoice No");
    expect(first.v.counts).toMatchObject({ rows: 6, accepted: 5, rejected: 1 });
    // INV-0005 is in USD: left out of the SGD entity (skipped), never converted
    expect(first.norm.counts).toEqual({ created: 4, existing: 0, conflict: 0, skipped: 1 });
    const rows = await rowsOf(fin, "ENT-LIVE-SG");
    expect(rows.map((r) => [r.invoiceNumber, r.totalMinor, r.amountDueMinor, r.status, r.orderRef, r.issuedOn])).toEqual([
      ["INV-0001", 135000n, 0n, "paid", "SG-1001", "2026-11-01"],
      ["INV-0002", 10n, 10n, "open", "SG-1002", "2026-11-02"],
      ["INV-0003", 900719925474099327n, 900719925474099327n, "open", null, "2026-11-03"], // beyond 2^53: exact
      ["INV-0004", 2000n, 0n, "void", "SG-1004", "2026-11-03"],
    ]);
    for (const r of rows) expect({ uploadId: r.uploadId, uploadedBy: r.uploadedBy }).toEqual({ uploadId: first.id, uploadedBy: fin.userId });
    expect(rows.map((r) => r.sourceRow)).toEqual([2, 3, 4, 5]);
  });

  it("a row with more decimals than the currency allows is rejected with a reason code, never rounded", async () => {
    const report = await withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.select().from(t.uploadRows).where(and(eq(t.uploadRows.uploadId, first.id), eq(t.uploadRows.status, "rejected"))), { read: true });
    expect(report.map((r) => [r.rowNumber, (r.reasonCodes as { code: string }[]).map((x) => x.code)])).toEqual([[7, ["amount_too_many_decimals"]]]);
  });

  it("the same file again is refused by its content hash; nothing is stored twice", async () => {
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "copy.csv", bytes: utf8(CSV) }, key()), "DUPLICATE_UPLOAD");
  });

  it("the same rows in an XLSX are duplicates of the CSV's rows and are not imported twice; a changed amount is a conflict", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Invoices");
    ws.addRow(["Invoice No", "Reference", "Customer", "Total", "Ccy", "Balance", "Status", "Invoice Date", "Due Date"]);
    ws.addRow(["INV-0001", "SG-1001", `${MARKER} Pte (fictional)`, "1350.00", "SGD", "0.00", "Paid", "2026-11-01", "2026-11-15"]);
    ws.addRow(["INV-0002", "SG-1002", "Harbour Co (fictional)", "0.20", "SGD", "0.20", "Authorised", "2026-11-02", "2026-11-16"]);
    ws.addRow(["INV-0007", "SG-1007", "New Co (fictional)", "7.07", "SGD", "7.07", "Authorised", "2026-11-05", "2026-11-19"]);
    const x = await pipeline(fin, "ENT-LIVE-SG", "ledger-export.xlsx", new Uint8Array(await wb.xlsx.writeBuffer()), MAPPING);
    expect(x.v.fileFormat).toBe("xlsx");
    expect(x.v.counts).toMatchObject({ rows: 3, accepted: 2, duplicate: 1 });
    expect(x.norm.counts).toEqual({ created: 1, existing: 1, conflict: 1, skipped: 0 });
    const rows = await rowsOf(fin, "ENT-LIVE-SG");
    expect(rows.find((r) => r.invoiceNumber === "INV-0002")!.totalMinor).toBe(10n); // the first value stands; the conflict is reported
    expect(rows.find((r) => r.invoiceNumber === "INV-0007")!.totalMinor).toBe(707n);
  });

  it("a template saved by merchant A cannot be used by merchant B; B never sees A's ledger invoices", async () => {
    const tpl = await saveMappingTemplate(fin, { fileType: "ledger_invoices", name: "Ledger export", headers: CSV.split("\r\n")[0].split(","), mapping: MAPPING }, key());
    const up = await createUpload(finB, { entityId: "ENT-LIVE-AE", fileType: "ledger_invoices", fileName: "b.csv", bytes: utf8(CSV.replace(/SGD/g, "AED")) }, key());
    await refused(setUploadMapping(finB, up.upload.id, { templateId: tpl.body.id }, key()), "ACCESS_404");
    expect((await listLedgerInvoices(finB, "ENT-LIVE-SG")).invoices).toEqual([]);
    const direct = await withTenant({ userId: finB.userId, orgId: finB.orgId }, (tx) => tx.select().from(t.ledgerInvoices), { read: true });
    expect(direct).toEqual([]);
    // a member of A who is not signed in to B cannot read B either (RLS, not only the service)
    const asA = await withTenant({ userId: fin.userId, orgId: finB.orgId }, (tx) => tx.select().from(t.ledgerInvoices), { read: true });
    expect(asA).toEqual([]);
  });

  it("the runtime role cannot change or delete a ledger invoice, nor write one without a confirmed upload", async () => {
    await expect(withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(sql`update ledger_invoices set total_minor = 1 where org_id = ${fin.orgId}`))).rejects.toThrow();
    await expect(withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(sql`delete from ledger_invoices where org_id = ${fin.orgId}`))).rejects.toThrow();
    await expect(withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.insert(t.ledgerInvoices).values({
      orgId: fin.orgId, entityId: "ENT-LIVE-SG", invoiceNumber: "FORGED-1", currency: "SGD", totalMinor: 1n, status: "open", uploadId: first.id, sourceRow: 99, uploadedBy: fin.userId,
    }))).rejects.toThrow();
  });

  it("a viewer can read but not upload; a sample organisation refuses ledger files", async () => {
    expect((await listLedgerInvoices(viewer, "ENT-LIVE-SG")).label).toBe("Your data");
    await refused(createUpload(viewer, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "v.csv", bytes: utf8(CSV + "\n") }, key()), "ACCESS_403");
  });
});

// ------------------------------------------------------------------ read-only pull from a recorded Xero demo company

const DEMO_ORG = { Organisations: [{ Name: "Demo Company (fictional)", IsDemoCompany: true }] };
const XERO_INVOICES = { Invoices: [
  { InvoiceID: "00000000-0000-4000-8000-00000000a001", InvoiceNumber: "XD-0001", Reference: "US-2001", Type: "ACCREC", Contact: { Name: `${MARKER} Inc (fictional)` }, CurrencyCode: "USD", Total: 250.5, AmountDue: 250.5, AmountPaid: 0, Status: "AUTHORISED", DateString: "2026-11-02T00:00:00", DueDateString: "2026-11-30T00:00:00" },
  { InvoiceID: "00000000-0000-4000-8000-00000000a002", InvoiceNumber: "XD-0002", Reference: "", Type: "ACCREC", Contact: { Name: "Other (fictional)" }, CurrencyCode: "USD", Total: 0.3, AmountDue: 0, AmountPaid: 0.3, Status: "PAID", Date: "/Date(1793577600000+0000)/" },
] };
function recordedXero(org: unknown, calls: { method: string; url: string }[]): Fetch {
  return async (url, init) => {
    calls.push({ method: init.method, url });
    const body = url.includes("/Organisation") ? org : url.includes("page=1") ? XERO_INVOICES : { Invoices: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}
const xero = { tenantId: "fictional-tenant", accessToken: async () => "fictional-token-not-a-secret" };

describe("ledger invoices: read-only pull (recorded Xero demo company)", () => {
  it("is off unless CLEARLINE_LEDGER_PULL=1", async () => {
    delete process.env.CLEARLINE_LEDGER_PULL;
    await refused(pullLedgerInvoices(fin, { entityId: "ENT-LIVE-US", source: "xero_demo" }, key(), { fetchFn: recordedXero(DEMO_ORG, []), xero }), "LEDGER_PULL_OFF");
  });

  it("refuses an organisation that is not a demo company, before reading any invoice", async () => {
    process.env.CLEARLINE_LEDGER_PULL = "1";
    const calls: { method: string; url: string }[] = [];
    await refused(pullLedgerInvoices(fin, { entityId: "ENT-LIVE-US", source: "xero_demo" }, key(), { fetchFn: recordedXero({ Organisations: [{ IsDemoCompany: false }] }, calls), xero }), "LEDGER_NOT_DEMO_COMPANY");
    expect(calls.map((c) => c.url.replace(/^.*\/2\.0/, ""))).toEqual(["/Organisation"]);
  });

  it("pulls with GET only into a validated upload that a person confirms; normalised like any file", async () => {
    const calls: { method: string; url: string }[] = [];
    const r = await pullLedgerInvoices(fin, { entityId: "ENT-LIVE-US", source: "xero_demo" }, key(), { fetchFn: recordedXero(DEMO_ORG, calls), xero, now: new Date("2026-11-20T00:00:00Z") });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(r.body).toMatchObject({ label: "Your data", pulled: 2, upload: { status: "validated", fileType: "ledger_invoices", originalName: "Xero demo company invoices 2026-11-20.csv", counts: { rows: 2, accepted: 2 } } });
    // nothing reaches reconciliation until a person confirms it
    expect(await rowsOf(fin, "ENT-LIVE-US")).toEqual([]);
    const v = r.body.upload;
    await decideUpload(ops, v.id, { decision: "confirm", reason: "Checked against the demo company (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
    await normaliseUpload(ops, v.id, key());
    expect((await rowsOf(fin, "ENT-LIVE-US")).map((x) => [x.invoiceNumber, x.totalMinor, x.amountDueMinor, x.amountPaidMinor, x.status, x.issuedOn, x.ledgerId])).toEqual([
      ["XD-0001", 25050n, 25050n, 0n, "open", "2026-11-02", "00000000-0000-4000-8000-00000000a001"],
      ["XD-0002", 30n, 0n, 30n, "paid", "2026-11-02", "00000000-0000-4000-8000-00000000a002"],
    ]);
    // the same pull again is the same file: refused as a duplicate, nothing stored twice
    await refused(pullLedgerInvoices(fin, { entityId: "ENT-LIVE-US", source: "xero_demo" }, key(), { fetchFn: recordedXero(DEMO_ORG, []), xero, now: new Date("2026-11-21T00:00:00Z") }), "DUPLICATE_UPLOAD");
  });

  it("refuses a QuickBooks company that is not the sandbox", async () => {
    await refused(pullLedgerInvoices(fin, { entityId: "ENT-LIVE-US", source: "qbo_sandbox" }, key(), { fetchFn: recordedXero(DEMO_ORG, []), qbo: { realmId: "1234", accessToken: async () => "x", baseUrl: "https://quickbooks.api.intuit.com" } }), "LEDGER_NOT_SANDBOX");
  });
});

describe("retention and logs", () => {
  it("retention deletes ledger invoices with their upload", async () => {
    const before = (await ownerDb().select().from(t.ledgerInvoices).where(eq(t.ledgerInvoices.orgId, fin.orgId))).length;
    expect(before).toBe(7);
    await purgeExpiredUploads(ownerDb(), new Date(Date.now() + 400 * 86_400_000));
    expect(await ownerDb().select().from(t.ledgerInvoices).where(eq(t.ledgerInvoices.orgId, fin.orgId))).toEqual([]);
  });

  it("the distinctive marker in the files appears in no console output, audit row or idempotency record", async () => {
    expect(captured.join("\n")).not.toContain(MARKER);
    const audit = await ownerDb().execute(sql`select count(*)::int as n from audit_events where summary like ${`%${MARKER}%`} or details::text like ${`%${MARKER}%`}`);
    expect(audit.rows[0].n).toBe(0);
    const idem = await ownerDb().execute(sql`select count(*)::int as n from idempotency_records where response::text like ${`%${MARKER}%`} or fingerprint like ${`%${MARKER}%`}`);
    expect(idem.rows[0].n).toBe(0);
  });
});
