/**
 * rc7 phase 3b: the read-only ledger pull (pure parts, recorded fictional responses) and the ledger-invoices mapping.
 * Nothing here calls a ledger.
 */
import { describe, expect, it } from "vitest";
import {
  LEDGER_PULL_HEADERS, LEDGER_PULL_MAPPING, LedgerPullRefused, decimalText, ledgerInvoicesCsv, pullQboInvoices, pullXeroInvoices, readOnly, xeroDate, type PulledInvoice,
} from "@/lib/accounting/ledger-pull";
import type { Fetch } from "@/lib/accounting/providers/xero";
import { applyMapping, suggestMapping, validateMapping } from "@/lib/clearline/mapping";
import { readDelimited } from "@/lib/clearline/ingest";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const inv = (n: string, extra: Partial<PulledInvoice> = {}): PulledInvoice => ({ invoiceNumber: n, ledgerId: `id-${n}`, reference: "", contact: "Co (fictional)", currency: "USD", total: "1.00", amountDue: "1.00", amountPaid: "0", status: "open", issuedOn: "2026-11-01", dueOn: "", ...extra });

describe("read-only ledger pull", () => {
  it("refuses any write method before sending it", async () => {
    let sent = 0;
    const f = readOnly(async () => { sent++; return ok({}); });
    for (const method of ["PUT", "POST", "DELETE", "PATCH"]) await expect(f("https://x.example/", { method, headers: {} })).rejects.toBeInstanceOf(LedgerPullRefused);
    await expect(f("https://x.example/", { method: "GET", headers: {}, body: "{}" })).rejects.toThrow(/only reads/);
    expect(sent).toBe(0);
  });

  it("reads amounts as decimal text, never through float arithmetic", () => {
    expect([decimalText(0.1), decimalText("1350.00"), decimalText(250.5), decimalText("9007199254740993.27")]).toEqual(["0.1", "1350.00", "250.5", "9007199254740993.27"]);
    expect(() => decimalText("1e3")).toThrow(LedgerPullRefused);
    expect([xeroDate("/Date(1793577600000+0000)/"), xeroDate("2026-11-02T00:00:00"), xeroDate(undefined)]).toEqual(["2026-11-02", "2026-11-02", ""]);
  });

  it("Xero: a non-demo organisation is refused; a demo company's invoices are read page by page with GET", async () => {
    const calls: string[] = [];
    const fetchFn = (demo: boolean): Fetch => async (url, init) => { calls.push(`${init.method} ${url.replace(/^.*\/2\.0/, "")}`); return ok(url.endsWith("/Organisation") ? { Organisations: [{ IsDemoCompany: demo }] } : { Invoices: url.includes("page=1") ? [{ InvoiceNumber: "A-1", InvoiceID: "u1", Total: 10, AmountDue: 10, AmountPaid: 0, Status: "AUTHORISED", CurrencyCode: "USD", Contact: { Name: "C" } }] : [] }); };
    const creds = { tenantId: "t", accessToken: async () => "fictional" };
    await expect(pullXeroInvoices(creds, fetchFn(false))).rejects.toMatchObject({ code: "NOT_DEMO_COMPANY" });
    calls.length = 0;
    expect(await pullXeroInvoices(creds, fetchFn(true))).toEqual([expect.objectContaining({ invoiceNumber: "A-1", total: "10", status: "open" })]);
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
  });

  it("QuickBooks: only the sandbox host; the balance is read, the amount paid is never derived", async () => {
    const creds = { realmId: "4620816365", accessToken: async () => "fictional" };
    await expect(pullQboInvoices({ ...creds, baseUrl: "https://quickbooks.api.intuit.com" }, async () => ok({}))).rejects.toMatchObject({ code: "NOT_SANDBOX" });
    const urls: string[] = [];
    const r = await pullQboInvoices(creds, async (url) => { urls.push(url); return ok({ QueryResponse: { Invoice: [{ Id: "7", DocNumber: "1007", TotalAmt: 99.99, Balance: 0, CurrencyRef: { value: "USD" }, TxnDate: "2026-11-03" }] } }); });
    expect(urls[0]).toMatch(/^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/4620816365\/query/);
    expect(r).toEqual([expect.objectContaining({ invoiceNumber: "1007", total: "99.99", amountDue: "0", amountPaid: "", status: "paid" })]);
  });

  it("the pulled CSV is deterministic, formula-safe and maps with the fixed pull mapping", () => {
    const a = ledgerInvoicesCsv([inv("B-2"), inv("A-1", { contact: "=HYPERLINK(\"x\")" })]);
    expect(a).toEqual(ledgerInvoicesCsv([inv("A-1", { contact: "=HYPERLINK(\"x\")" }), inv("B-2")]));
    const text = new TextDecoder().decode(a);
    expect(text.split("\r\n")[0]).toBe(LEDGER_PULL_HEADERS.join(","));
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    const table = readDelimited(a);
    const check = validateMapping(LEDGER_PULL_MAPPING, table.headers);
    expect(check.ok).toBe(true);
    const applied = applyMapping(table, LEDGER_PULL_MAPPING);
    expect(applied.ok && applied.rows.map((r) => [r.status, r.values.invoice_number, r.values.total])).toEqual([["accepted", "A-1", 100n], ["accepted", "B-2", 100n]]);
  });

  it("a ledger export's headers are suggested for the ledger-invoices fields", () => {
    const s = suggestMapping(["Invoice Number", "Reference", "Contact", "Invoice Date", "Due Date", "Total", "Amount Due", "Currency", "Status"], "ledger_invoices");
    expect(Object.fromEntries(Object.entries(s.proposal).map(([k, v]) => [k, v.header]))).toMatchObject({
      invoice_number: "Invoice Number", order_id: "Reference", contact: "Contact", total: "Total", amount_due: "Amount Due", currency: "Currency", issued_on: "Invoice Date", due_on: "Due Date",
    });
  });
});
