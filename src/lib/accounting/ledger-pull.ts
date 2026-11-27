// rc7 phase 3b: a READ-ONLY pull of sales invoices from a Xero demo company or a QuickBooks Online sandbox company.
//
// The pull never writes to the ledger: every request goes through `readOnly`, which refuses any method but GET. It
// refuses a Xero organisation that is not a demo company (Organisation.IsDemoCompany) and a QuickBooks base URL that
// is not the sandbox host. What it returns is rendered as a ledger-invoices CSV that enters Clearline through the same
// upload → mapping → validation → confirmation → normalise flow as a file a person uploads (src/server/ledger.ts).
// Amounts stay decimal strings (never floating-point arithmetic); the CSV carries them as text.
// CI never calls a ledger: tests pass a recorded, fictional fetch.

import type { Fetch } from "./providers/xero";
import { XERO_API } from "./providers/xero";
import { AMOUNT_TEXT, isFormulaLike } from "../csv/cell";

export type LedgerSource = "xero_demo" | "qbo_sandbox";
export const QBO_SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";

export interface PulledInvoice {
  invoiceNumber: string; ledgerId: string; reference: string; contact: string; currency: string;
  total: string; amountDue: string; amountPaid: string; status: "draft" | "open" | "paid" | "void"; issuedOn: string; dueOn: string;
}

export class LedgerPullRefused extends Error {
  constructor(readonly code: "NOT_DEMO_COMPANY" | "NOT_SANDBOX" | "WRITE_REFUSED" | "LEDGER_ERROR" | "BAD_RESPONSE", message: string) { super(message); }
}

/** Every call of a pull: GET only. A write method is refused before anything is sent. */
export function readOnly(fetchFn: Fetch): Fetch {
  return (url, init) => {
    if (init.method !== "GET" || init.body !== undefined) return Promise.reject(new LedgerPullRefused("WRITE_REFUSED", "The ledger pull only reads; it never writes to the ledger."));
    return fetchFn(url, init);
  };
}

/** A decimal string from a ledger's JSON number or string, without float arithmetic on it ("1350" → "1350", 12.5 → "12.5"). */
export function decimalText(v: unknown): string {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new LedgerPullRefused("BAD_RESPONSE", "The ledger returned an amount that is not a plain decimal.");
  return s;
}

/** Xero dates: "/Date(1730419200000+0000)/" or "2026-11-01T00:00:00" → "2026-11-01". */
export function xeroDate(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const ms = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(v);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}

const XERO_STATUS: Record<string, PulledInvoice["status"]> = { DRAFT: "draft", SUBMITTED: "draft", AUTHORISED: "open", PAID: "paid", VOIDED: "void", DELETED: "void" };

async function getJson(fetchFn: Fetch, url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await readOnly(fetchFn)(url, { method: "GET", headers });
  if (!res.ok) throw new LedgerPullRefused("LEDGER_ERROR", `The ledger answered ${res.status}.`); // never the body: it may quote data
  const j = await res.json();
  if (!j || typeof j !== "object") throw new LedgerPullRefused("BAD_RESPONSE", "The ledger returned no JSON object.");
  return j as Record<string, unknown>;
}

export interface XeroReadCredentials { accessToken(): Promise<string>; tenantId: string }

/** Sales invoices (ACCREC) of a Xero DEMO company, page by page (at most `maxPages` pages of 100). */
export async function pullXeroInvoices(creds: XeroReadCredentials, fetchFn: Fetch, opts: { maxPages?: number } = {}): Promise<PulledInvoice[]> {
  const headers = async () => ({ Authorization: `Bearer ${await creds.accessToken()}`, "xero-tenant-id": creds.tenantId, Accept: "application/json" });
  const org = await getJson(fetchFn, `${XERO_API}/Organisation`, await headers());
  const o = ((org.Organisations as Record<string, unknown>[] | undefined) ?? [])[0];
  if (!o || o.IsDemoCompany !== true) throw new LedgerPullRefused("NOT_DEMO_COMPANY", "Only the Xero Demo Company can be read here; this organisation is not a demo company.");
  const out: PulledInvoice[] = [];
  const where = encodeURIComponent('Type=="ACCREC"');
  for (let page = 1; page <= (opts.maxPages ?? 50); page++) {
    const res = await getJson(fetchFn, `${XERO_API}/Invoices?where=${where}&page=${page}`, await headers());
    const list = (res.Invoices as Record<string, unknown>[] | undefined) ?? [];
    for (const i of list) {
      const c = (i.Contact ?? {}) as Record<string, unknown>;
      out.push({
        invoiceNumber: String(i.InvoiceNumber ?? ""), ledgerId: String(i.InvoiceID ?? ""), reference: String(i.Reference ?? ""), contact: String(c.Name ?? ""),
        currency: String(i.CurrencyCode ?? ""), total: decimalText(i.Total ?? "0"), amountDue: decimalText(i.AmountDue ?? "0"), amountPaid: decimalText(i.AmountPaid ?? "0"),
        status: XERO_STATUS[String(i.Status ?? "")] ?? "open", issuedOn: xeroDate(i.DateString ?? i.Date), dueOn: xeroDate(i.DueDateString ?? i.DueDate),
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export interface QboReadCredentials { accessToken(): Promise<string>; realmId: string; baseUrl?: string }

/** Invoices of a QuickBooks Online SANDBOX company (the production host is refused). */
export async function pullQboInvoices(creds: QboReadCredentials, fetchFn: Fetch, opts: { maxPages?: number } = {}): Promise<PulledInvoice[]> {
  const base = creds.baseUrl ?? QBO_SANDBOX_HOST;
  if (base !== QBO_SANDBOX_HOST) throw new LedgerPullRefused("NOT_SANDBOX", "Only a QuickBooks sandbox company can be read here.");
  if (!/^\d{1,32}$/.test(creds.realmId)) throw new LedgerPullRefused("NOT_SANDBOX", "The QuickBooks company id is not valid.");
  const out: PulledInvoice[] = [];
  for (let page = 0; page < (opts.maxPages ?? 50); page++) {
    const q = encodeURIComponent(`select * from Invoice startposition ${page * 100 + 1} maxresults 100`);
    const res = await getJson(fetchFn, `${base}/v3/company/${creds.realmId}/query?query=${q}&minorversion=75`, { Authorization: `Bearer ${await creds.accessToken()}`, Accept: "application/json" });
    const list = ((res.QueryResponse as Record<string, unknown> | undefined)?.Invoice as Record<string, unknown>[] | undefined) ?? [];
    for (const i of list) {
      const total = decimalText(i.TotalAmt ?? "0"), due = decimalText(i.Balance ?? "0");
      const cur = (i.CurrencyRef ?? {}) as Record<string, unknown>;
      out.push({
        invoiceNumber: String(i.DocNumber ?? i.Id ?? ""), ledgerId: String(i.Id ?? ""), reference: String((i.CustomField as { StringValue?: string }[] | undefined)?.[0]?.StringValue ?? ""),
        contact: String(((i.CustomerRef ?? {}) as Record<string, unknown>).name ?? ""), currency: String(cur.value ?? ""), total, amountDue: due,
        amountPaid: "", // QuickBooks reports the balance, not the amount paid; nothing is derived
        status: /^0+(\.0+)?$/.test(due) ? "paid" : "open", issuedOn: String(i.TxnDate ?? "").slice(0, 10), dueOn: String(i.DueDate ?? "").slice(0, 10),
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export const LEDGER_PULL_HEADERS = ["Invoice Number", "Ledger ID", "Reference", "Contact", "Currency", "Total", "Amount Due", "Amount Paid", "Status", "Invoice Date", "Due Date"] as const;

/** One CSV cell; text starting with = + - @ is prefixed with ' so a spreadsheet never runs it. Amounts are unsigned. */
export function ledgerPullCell(v: string): string {
  let s = v.replace(/[\r\n\u2028\u2029]+/g, " ");
  if (!AMOUNT_TEXT.test(s) && isFormulaLike(s)) s = "'" + s;
  return /[",']|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The pulled invoices as a ledger-invoices CSV (sorted by invoice number, so the same pull gives the same bytes). */
export function ledgerInvoicesCsv(invoices: PulledInvoice[]): Uint8Array {
  const rows = [...invoices].sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : a.invoiceNumber > b.invoiceNumber ? 1 : 0))
    .map((i) => [i.invoiceNumber, i.ledgerId, i.reference, i.contact, i.currency, i.total, i.amountDue, i.amountPaid, i.status, i.issuedOn, i.dueOn]);
  return new TextEncoder().encode([LEDGER_PULL_HEADERS as readonly string[], ...rows].map((r) => r.map(ledgerPullCell).join(",")).join("\r\n") + "\r\n");
}

/** The mapping of a pulled file (it is always the same layout); amounts in the CSV use a decimal point. */
export const LEDGER_PULL_MAPPING = {
  fileType: "ledger_invoices",
  columns: {
    invoice_number: { header: "Invoice Number" }, ledger_id: { header: "Ledger ID" }, order_id: { header: "Reference" }, contact: { header: "Contact" },
    currency: { header: "Currency" }, total: { header: "Total", decimalSeparator: "." }, amount_due: { header: "Amount Due", decimalSeparator: "." },
    amount_paid: { header: "Amount Paid", decimalSeparator: "." }, status: { header: "Status", statusValueMap: { draft: "draft", open: "open", paid: "paid", void: "void" } },
    issued_on: { header: "Invoice Date", dateFormat: "iso" }, due_on: { header: "Due Date", dateFormat: "iso" },
  },
} as const;
