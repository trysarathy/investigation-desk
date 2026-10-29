// Server side of accounting sync: which accounting system is connected, the posting plan for each
// request, and the approve-and-post action. Server-only.

import "server-only";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { dataDir } from "../data-dir";
import { isDemoMode } from "../mode";
import { CONFIRMATIONS, OFFICIAL } from "../requests/check";
import { requestsStore } from "../requests/service";
import type { RequestToken } from "../requests/types";
import { approveAndPost, importInvoice, lines, seedDemoBooks } from "./engine";
import { DemoBooksAdapter, emptyDemoBooks } from "./providers/demo";
import { NetSuiteAdapter } from "./providers/netsuite";
import { QuickBooksAdapter } from "./providers/quickbooks";
import { XeroAdapter } from "./providers/xero";
import { accessToken, loadTokens, xeroConfigured } from "./providers/xero-auth";
import { planPosting } from "./rules";
import { FileAccountingStore } from "./store";
import { PROVIDER_LABEL, type AccountingData, type BooksAdapter, type BooksProvider, type PostingPlan } from "./types";

export const accountingStore = () => new FileAccountingStore(path.join(dataDir(), "accounting.json"));
const nowIso = () => new Date().toISOString();

/** The accounting system in use. Demo mode always uses the demo books, whatever is configured. */
export function activeProvider(acct: AccountingData): BooksProvider {
  return isDemoMode() ? "demo" : acct.provider === "demo" ? "demo" : acct.provider;
}

export async function adapterFor(acct: AccountingData, now: () => string): Promise<BooksAdapter> {
  const p = activeProvider(acct);
  if (p === "demo" && !isDemoMode()) throw new Error("No accounting system is connected yet. Connect Xero on the Books page.");
  if (p === "demo") return new DemoBooksAdapter(acct.demoBooks ?? (acct.demoBooks = emptyDemoBooks()), now);
  if (p === "xero") {
    const t = await loadTokens();
    if (!t) throw new Error("Xero isn't connected. Connect it on the Books page (/books).");
    return new XeroAdapter({ tenantId: t.tenantId, accessToken: async () => (await accessToken()).token });
  }
  if (p === "quickbooks") {
    const realmId = process.env.QBO_REALM_ID ?? "";
    const token = process.env.QBO_ACCESS_TOKEN ?? "";
    if (!realmId || !token) throw new Error("QuickBooks isn't connected (sandbox credentials missing on the server).");
    return new QuickBooksAdapter({ realmId, accessToken: async () => token, writeoffItemId: process.env.QBO_WRITEOFF_ITEM_ID });
  }
  return new NetSuiteAdapter();
}

export async function loadAccounting(): Promise<AccountingData> {
  return accountingStore().load();
}

export async function planFor(requestId: string): Promise<{ plan: PostingPlan; acct: AccountingData }> {
  const [reqData, acct] = await Promise.all([requestsStore().load(), accountingStore().load()]);
  return { plan: planPosting(reqData, acct, requestId, { threshold: CONFIRMATIONS }), acct };
}

/** Approve the plan a person saw (by its key) and post it. */
export async function approvePosting(requestId: string, by: string, expectedKey: string): Promise<{ error?: string; message?: string }> {
  const reqData = await requestsStore().load();
  type R = { error?: string; message?: string };
  return accountingStore().update(async (acct): Promise<[AccountingData | undefined, R]> => {
    const now = nowIso();
    let adapter: BooksAdapter;
    try { adapter = await adapterFor(acct, nowIso); } catch (e) {
      // Logged too: an approval that couldn't reach the books is a refusal on record.
      const error = (e as Error).message;
      const entry = { id: `AUD-${randomBytes(5).toString("hex")}`, at: now, kind: "refused" as const, by, provider: acct.provider, requestId,
        invoiceNumber: acct.links[requestId]?.invoiceNumber, reason: `Not posted: ${error}`, demo: false };
      return [{ ...acct, audit: [...acct.audit, entry] }, { error }];
    }
    const res = await approveAndPost(reqData, acct, requestId, { threshold: CONFIRMATIONS, by, now, adapter, expectedKey });
    if (res.error && res.acct === acct) return [undefined, { error: res.error }];
    return [res.acct, res.error ? { error: res.error } : { message: `Posted ${lines(res.plan.lines.length)} to ${adapter.provider === "demo" ? "the demo books" : PROVIDER_LABEL[adapter.provider]}.` }];
  });
}

/** Rebuild the demo books from the demo requests (called after "Load the demo day"). */
export async function resetAccountingDemo(): Promise<void> {
  const reqData = await requestsStore().load();
  await accountingStore().update(async (acct) => [await seedDemoBooks(reqData, acct, { now: nowIso(), operator: "Mei Tan (Finance ops)", threshold: CONFIRMATIONS }), undefined]);
}

/** Make payment requests from open invoices in the connected accounting system. */
export async function importOpenInvoices(by: string, receivingAddress: string, token: RequestToken): Promise<{ created: string[]; skipped: string[]; error?: string }> {
  const acct0 = await accountingStore().load();
  let invoices;
  try { invoices = await (await adapterFor(acct0, nowIso)).listOpenInvoices(); } catch (e) { return { created: [], skipped: [], error: (e as Error).message }; }
  const created: string[] = [];
  const skipped: string[] = [];
  await requestsStore().update(async (reqData) => {
    let rd = reqData;
    await accountingStore().update(async (acct) => {
      let a = acct;
      for (const inv of invoices) {
        const res = importInvoice(rd, a, inv, { now: nowIso(), by, demo: isDemoMode(), publicId: randomBytes(9).toString("base64url"), receivingAddress, token, tokenContract: OFFICIAL[token], provider: activeProvider(a) });
        if (res.error) { skipped.push(res.error); continue; }
        rd = res.reqData; a = res.acct; created.push(res.requestId!);
      }
      return [a, undefined];
    });
    return [rd, undefined];
  });
  return { created, skipped };
}

export const xeroStatus = async () => ({ configured: xeroConfigured(), connected: !!(await loadTokens()), org: (await loadTokens())?.tenantName });
