// v1 phase 2.3: what Clearline reads from a connected ledger, and the ONE thing it may write: a DRAFT manual journal.
//
// Reads (GET only, through `readOnly`): the organisation (base currency, demo flag), sales invoices and payments.
// Writes: Xero PUT /ManualJournals with Status "DRAFT", one Idempotency-Key per journal. `assertDraftOnly` checks the
// body before it is sent and the answer after: anything but a draft is refused or reported as a failure. QuickBooks
// Online has no draft state for journal entries [ASSUMPTION: its JournalEntry API has no draft/pending status], so
// Clearline never writes a journal to QuickBooks; it refuses (LedgerWriteRefused "NO_DRAFTS").
//
// Every call takes a slot from the rate limiter first. A 401 (and Xero's 403 for a removed connection) means the
// person must connect again; a 429 blocks the connection until Retry-After. Errors carry the status only.

import { draftCell } from "../../clearline/exports/journal-drafts";
import { decimalText, readOnly, xeroDate } from "../ledger-pull";
import type { Fetch } from "../providers/xero";
import { LedgerCallFailed, type LedgerProvider, type ProviderConfig } from "./providers";
import { LedgerRateLimiter, retryAfterSeconds } from "./rate-limit";

export type LedgerFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;

export const sharedLimiter = new LedgerRateLimiter();

export interface LedgerSession {
  config: ProviderConfig;
  /** Xero tenant id or QuickBooks realm id. */
  tenantId: string;
  accessToken(): Promise<string>;
  fetchFn: LedgerFetch;
  limiter?: LedgerRateLimiter;
}

export class LedgerWriteRefused extends Error {
  constructor(readonly code: "NO_DRAFTS" | "NOT_DRAFT" | "AMOUNT_PRECISION", message: string) { super(message); }
}

async function call(s: LedgerSession, method: "GET" | "PUT", path: string, opts: { body?: unknown; idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
  (s.limiter ?? sharedLimiter).take(s.config.provider, s.tenantId);
  const headers: Record<string, string> = { Authorization: `Bearer ${await s.accessToken()}`, Accept: "application/json" };
  if (s.config.provider === "xero") headers["xero-tenant-id"] = s.tenantId;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const url = `${s.config.apiBase}${path}`;
  const f = method === "GET" ? (readOnly(s.fetchFn as Fetch) as LedgerFetch) : s.fetchFn;
  const res = await f(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (res.status === 401 || (s.config.provider === "xero" && res.status === 403)) {
    throw new LedgerCallFailed("reconnect", res.status, "The ledger no longer accepts this connection (expired or revoked). Connect it again.");
  }
  if (res.status === 429) {
    const after = retryAfterSeconds(res.headers?.get("retry-after"));
    (s.limiter ?? sharedLimiter).backOff(s.config.provider, s.tenantId, after);
    throw new LedgerCallFailed("rate_limited", 429, "The ledger is rate limiting Clearline; try again later.", after);
  }
  if (!res.ok) throw new LedgerCallFailed("error", res.status, `The ledger answered ${res.status} to ${method} ${path.split("?")[0]}.`);
  const j = await res.json();
  if (!j || typeof j !== "object") throw new LedgerCallFailed("error", res.status, "The ledger returned no JSON object.");
  return j as Record<string, unknown>;
}

export interface LedgerOrg { name: string; baseCurrency: string; isDemoCompany: boolean }

export async function readOrganisation(s: LedgerSession): Promise<LedgerOrg> {
  if (s.config.provider === "xero") {
    const o = ((await call(s, "GET", "/Organisation")).Organisations as Record<string, unknown>[] | undefined)?.[0] ?? {};
    return { name: String(o.Name ?? "").slice(0, 200), baseCurrency: String(o.BaseCurrency ?? ""), isDemoCompany: o.IsDemoCompany === true };
  }
  const r = await call(s, "GET", `/v3/company/${encodeURIComponent(s.tenantId)}/companyinfo/${encodeURIComponent(s.tenantId)}?minorversion=75`);
  const ci = (r.CompanyInfo ?? {}) as Record<string, unknown>;
  // QuickBooks: the sandbox host is the "demo" guarantee (production is never configured, see providers.ts)
  const home = ((ci.HomeCurrency ?? {}) as Record<string, unknown>).value;
  return { name: String(ci.CompanyName ?? "").slice(0, 200), baseCurrency: String(home ?? ""), isDemoCompany: s.config.env === "standin" || s.config.apiBase.startsWith("https://sandbox-quickbooks.api.intuit.com") };
}

/** A sales invoice as Clearline keeps it: exact decimal strings, the ledger's own id, a Clearline status. */
export interface LedgerInvoice { ledgerId: string; invoiceNumber: string; currency: string; total: string; amountDue: string; status: "draft" | "open" | "paid" | "void"; issuedOn: string }
/** A payment the ledger records against an invoice: a CLAIM of the ledger, never evidence that money arrived. */
export interface LedgerPayment { ledgerId: string; invoiceLedgerId: string; invoiceNumber: string; amount: string; currency: string; paidOn: string; status: string }

const XERO_STATUS: Record<string, LedgerInvoice["status"]> = { DRAFT: "draft", SUBMITTED: "draft", AUTHORISED: "open", PAID: "paid", VOIDED: "void", DELETED: "void" };
const MAX_PAGES = 50;

export async function readInvoices(s: LedgerSession): Promise<LedgerInvoice[]> {
  const out: LedgerInvoice[] = [];
  if (s.config.provider === "xero") {
    const where = encodeURIComponent('Type=="ACCREC"');
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = ((await call(s, "GET", `/Invoices?where=${where}&page=${page}`)).Invoices as Record<string, unknown>[] | undefined) ?? [];
      for (const i of list) out.push({
        ledgerId: String(i.InvoiceID ?? ""), invoiceNumber: String(i.InvoiceNumber ?? ""), currency: String(i.CurrencyCode ?? ""),
        total: decimalText(i.Total ?? "0"), amountDue: decimalText(i.AmountDue ?? "0"), status: XERO_STATUS[String(i.Status ?? "")] ?? "draft", issuedOn: xeroDate(i.DateString ?? i.Date),
      });
      if (list.length < 100) break;
    }
    return out;
  }
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = encodeURIComponent(`select * from Invoice startposition ${page * 100 + 1} maxresults 100`);
    const list = (((await call(s, "GET", `/v3/company/${encodeURIComponent(s.tenantId)}/query?query=${q}&minorversion=75`)).QueryResponse as Record<string, unknown> | undefined)?.Invoice as Record<string, unknown>[] | undefined) ?? [];
    for (const i of list) {
      const due = decimalText(i.Balance ?? "0");
      out.push({
        ledgerId: String(i.Id ?? ""), invoiceNumber: String(i.DocNumber ?? i.Id ?? ""), currency: String(((i.CurrencyRef ?? {}) as Record<string, unknown>).value ?? ""),
        total: decimalText(i.TotalAmt ?? "0"), amountDue: due, status: /^0+(\.0+)?$/.test(due) ? "paid" : "open", issuedOn: String(i.TxnDate ?? "").slice(0, 10),
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export async function readPayments(s: LedgerSession): Promise<LedgerPayment[]> {
  const out: LedgerPayment[] = [];
  if (s.config.provider === "xero") {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = ((await call(s, "GET", `/Payments?page=${page}`)).Payments as Record<string, unknown>[] | undefined) ?? [];
      for (const p of list) {
        const inv = (p.Invoice ?? {}) as Record<string, unknown>;
        out.push({ ledgerId: String(p.PaymentID ?? ""), invoiceLedgerId: String(inv.InvoiceID ?? ""), invoiceNumber: String(inv.InvoiceNumber ?? ""), amount: decimalText(p.Amount ?? "0"),
          currency: String(inv.CurrencyCode ?? ""), paidOn: xeroDate(p.Date), status: String(p.Status ?? "") });
      }
      if (list.length < 100) break;
    }
    return out;
  }
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = encodeURIComponent(`select * from Payment startposition ${page * 100 + 1} maxresults 100`);
    const list = (((await call(s, "GET", `/v3/company/${encodeURIComponent(s.tenantId)}/query?query=${q}&minorversion=75`)).QueryResponse as Record<string, unknown> | undefined)?.Payment as Record<string, unknown>[] | undefined) ?? [];
    for (const p of list) {
      for (const line of (p.Line as Record<string, unknown>[] | undefined) ?? []) {
        for (const lt of (line.LinkedTxn as Record<string, unknown>[] | undefined) ?? []) {
          if (lt.TxnType !== "Invoice") continue;
          out.push({ ledgerId: String(p.Id ?? ""), invoiceLedgerId: String(lt.TxnId ?? ""), invoiceNumber: "", amount: decimalText(line.Amount ?? "0"),
            currency: String(((p.CurrencyRef ?? {}) as Record<string, unknown>).value ?? ""), paidOn: String(p.TxnDate ?? "").slice(0, 10), status: "recorded" });
        }
      }
    }
    if (list.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Invoices into the existing order/invoice model (an orders_invoices upload a person confirms)
// ---------------------------------------------------------------------------------------------

export const ORDERS_HEADERS = ["Order ID", "Invoice Amount", "Currency", "Status", "Ledger ID"] as const;

/**
 * The ledger's issued sales invoices as an orders/invoices CSV: Order ID = the invoice number (what a customer quotes
 * as the payment reference), amount = the invoice TOTAL, status open (authorised or paid) or void. Drafts (never sent to
 * a customer) are left out. No issue time is invented (the ledger has a date only), so the column is not mapped.
 */
export function ordersCsv(invoices: LedgerInvoice[]): { bytes: Uint8Array; rows: number; draftsLeftOut: number } {
  const issued = invoices.filter((i) => i.status !== "draft" && i.invoiceNumber);
  const cell = draftCell; // formula characters neutralised, quotes doubled, line breaks removed
  const rows = [...issued].sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : a.invoiceNumber > b.invoiceNumber ? 1 : 0))
    .map((i) => [i.invoiceNumber, i.total, i.currency, i.status === "void" ? "void" : "open", i.ledgerId]);
  const text = [ORDERS_HEADERS as readonly string[], ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return { bytes: new TextEncoder().encode(text), rows: rows.length, draftsLeftOut: invoices.length - issued.length };
}

export const ORDERS_MAPPING = {
  fileType: "orders_invoices",
  columns: {
    order_id: { header: "Order ID" }, invoice_amount: { header: "Invoice Amount", decimalSeparator: "." }, currency: { header: "Currency" },
    status: { header: "Status", statusValueMap: { open: "open", void: "void" } },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Draft manual journals
// ---------------------------------------------------------------------------------------------

export interface DraftJournalLine { accountCode: string; description: string; /** exact decimal, debit positive, credit negative */ amount: string }
export interface DraftJournalRequest { narration: string; date: string; currency: string; lines: DraftJournalLine[] }

/** The Xero body for one draft journal. Status is always DRAFT. */
export function xeroDraftJournalBody(j: DraftJournalRequest) {
  return { ManualJournals: [{
    Narration: j.narration.slice(0, 4000), Date: j.date, Status: "DRAFT", LineAmountTypes: "NoTax", ShowOnCashBasisReports: false,
    JournalLines: j.lines.map((l) => ({ LineAmount: Number(l.amount), AccountCode: l.accountCode, Description: l.description.slice(0, 4000) })),
  }] };
}

/** A body that could post anything but a draft never leaves Clearline. */
export function assertDraftOnly(body: { ManualJournals: { Status: string }[] }): void {
  if (!body.ManualJournals.length || body.ManualJournals.some((m) => m.Status !== "DRAFT")) throw new LedgerWriteRefused("NOT_DRAFT", "Only draft journals are ever written to a ledger.");
}

/** Send one journal as a DRAFT. The caller has already checked the posting-rules signature and the account mapping. */
export async function writeDraftJournal(s: LedgerSession, j: DraftJournalRequest, idempotencyKey: string): Promise<{ externalId: string; status: "DRAFT" }> {
  if (s.config.provider !== "xero") throw new LedgerWriteRefused("NO_DRAFTS", "QuickBooks Online has no draft journals; Clearline never writes a journal there. Use the draft journal file instead.");
  // Xero's JSON takes numbers: an amount a double cannot carry exactly is refused rather than rounded
  for (const l of j.lines) {
    const dp = l.amount.split(".")[1]?.length ?? 0;
    if (!/^-?\d+(\.\d+)?$/.test(l.amount) || Number(l.amount).toFixed(dp) !== l.amount) throw new LedgerWriteRefused("AMOUNT_PRECISION", "An amount is too large to send to the ledger exactly; nothing was written.");
  }
  const body = xeroDraftJournalBody(j);
  assertDraftOnly(body);
  const r = await call(s, "PUT", "/ManualJournals", { body, idempotencyKey });
  const m = ((r.ManualJournals as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
  if (m.Status !== "DRAFT") throw new LedgerCallFailed("error", 200, "The ledger did not record the journal as a draft; check it in the ledger now.");
  if (typeof m.ManualJournalID !== "string" || !m.ManualJournalID) throw new LedgerCallFailed("error", 200, "The ledger returned no journal id.");
  return { externalId: m.ManualJournalID, status: "DRAFT" };
}

export const draftsSupported = (p: LedgerProvider) => p === "xero";
