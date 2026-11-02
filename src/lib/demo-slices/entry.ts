// DEMO ONLY (S2). The replayed payment matched to its sample invoice, and the entry the existing
// posting rules (planPosting, unchanged) would propose for it. The Dr/Cr view follows the approved
// account decision (docs/POSTING_RULES.md §9, decision 1: receipts go to a "Stablecoin clearing"
// account, not a bank account) and case C1 (Dr clearing, Cr the customer's invoice in Receivables).
// Amounts come from planPosting only; nothing here computes, rounds or edits them. Nothing is posted.

import { planPosting } from "../accounting/rules";
import { emptyAccounting, type AccountingData, type PlanStatus } from "../accounting/types";
import { CONFIRMATIONS } from "../requests/check";
import { formatUsdc } from "../requests/lifecycle";
import { shortHash } from "../requests/present";
import { replay, scenarios, TRANSFER_LABEL } from "./replay";

/** The sample organisation's clearing account code (each organisation sets its own; there is no default). */
export const SAMPLE_CLEARING = { code: "SAMPLE-CLR", name: "Stablecoin clearing (sample account)" };
/** What the demo's Approve does: nothing leaves the page. */
export const APPROVED_MESSAGE = "Would post to Xero after approval (demo: not sent).";

export interface EntryRow { account: string; code?: string; dr?: string; cr?: string; detail: string }
export interface ProposedEntry {
  scenarioId: string;
  invoiceId: string;
  customerRef: string;
  invoiceAmount: string;
  matchReasons: string[];
  status: PlanStatus;
  planReasons: string[];
  rows: EntryRow[];
  label: string;
}

/** A scenario whose plan is a plain C1 payment: the only shape S2 shows Dr/Cr for. */
export async function proposedEntry(id: string): Promise<ProposedEntry | null> {
  const r = await replay(id);
  if (!r.view) return null;
  const inv = r.invoice;
  const acct: AccountingData = {
    ...emptyAccounting(),
    accounts: { walletAccountCode: SAMPLE_CLEARING.code, feeAccountCode: "SAMPLE-SHORTFALL" },
    links: { [inv.id]: { provider: "demo", invoiceId: inv.id, invoiceNumber: inv.id, contactName: inv.customer_ref, currency: "USD", amountDue: inv.amount, linkedAt: inv.created_at, demo: true } },
  };
  const plan = planPosting(r.data, acct, inv.id, { threshold: CONFIRMATIONS });
  const rows: EntryRow[] = [];
  for (const l of plan.lines) {
    if (l.kind !== "payment") return null;
    const via = `${formatUsdc(l.tokenAmount ?? l.amount)} ${l.token} on ${l.network} · tx ${shortHash(l.txHash ?? "")} · ${l.usdRate} USD each · ${l.date}`;
    rows.push({ account: SAMPLE_CLEARING.name, code: l.accountCode, dr: l.amount, detail: via });
    rows.push({ account: `Accounts Receivable · ${inv.customer_ref}`, cr: l.amount, detail: `Payment applied to ${inv.id}` });
  }
  return {
    scenarioId: id, invoiceId: inv.id, customerRef: inv.customer_ref, invoiceAmount: `${formatUsdc(inv.amount)} ${inv.token}`,
    matchReasons: r.view.reasons, status: plan.status, planReasons: plan.reasons, rows, label: TRANSFER_LABEL,
  };
}

/** The scenarios S2 can show: those whose existing plan is ready and is payment lines only. */
export async function entryScenarios(): Promise<string[]> {
  const out: string[] = [];
  for (const s of scenarios()) {
    const e = await proposedEntry(s.id);
    if (e && e.status === "ready" && e.rows.length) out.push(s.id);
  }
  return out;
}
