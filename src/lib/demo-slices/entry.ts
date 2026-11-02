// DEMO ONLY (S2). The replayed payment matched to its sample invoice, and the entry the existing
// posting rules (planPosting, unchanged) would propose for it. The Dr/Cr view follows the approved
// account decision (docs/POSTING_RULES.md §9, decision 1: receipts go to a "Stablecoin clearing"
// account, not a bank account) and case C1 (Dr clearing, Cr the customer's invoice in Receivables).
// Amounts come from planPosting only; nothing here computes, rounds or edits them. Nothing is posted.

import { planPosting } from "../accounting/rules";
import { emptyAccounting, type AccountingData, type PlanStatus } from "../accounting/types";
import { CONFIRMATIONS } from "../requests/check";
import { formatUsdc } from "../requests/lifecycle";
import { shortAddr, shortHash } from "../requests/present";
import { sameAddress } from "../address";
import { cardFor, type ReleaseCard } from "./release";
import { replay, scenarios, TRON_SCENARIO } from "./replay";

/** The sample organisation's clearing account code (each organisation sets its own; there is no default). */
export const SAMPLE_CLEARING = { code: "SAMPLE-CLR", name: "Stablecoin clearing (sample account)" };
/** What the demo's Approve says after the click (with who and when): nothing leaves the page. */
/** QA's wording: Xero is "in testing" (PRODUCT_FACTS), so never "would now post". Final wording is Aashmiin's call. */
export const APPROVED_MESSAGE = "Live, this is the step that would post the entry to Xero once it's connected and switched on. Demo: nothing sent.";
export const APPROVER = "Mei Tan (sample user)";
/** Only when finality is actually pending (on the chain, not final yet). */
export const WAITING_MESSAGE = "Waiting until final — can't be approved yet.";
/** When finality couldn't be read (every Ethereum sample today): it won't become final by waiting here. */
export const NOT_CHECKED_MESSAGE = "Finality wasn't checked, so this can't be approved.";

export interface EntryRow { account: string; code?: string; dr?: string; cr?: string; detail: string }
export interface ProposedEntry {
  scenarioId: string;
  invoiceId: string;
  customerRef: string;
  invoiceAmount: string;
  /** Why the payment belongs to this invoice (never a claim about finality: that is the checks' job). */
  matchLine: string;
  /** The same release checks as S1. */
  card: ReleaseCard;
  /** Aashmiin's rule: post only when final. Approvable only when the checks say paid and final. */
  approvable: boolean;
  status: PlanStatus | "no_plan";
  planReasons: string[];
  rows: EntryRow[];
}

const peg = (source?: string) => (source?.startsWith("par") ? "assumed peg, not a market rate" : source ?? "rate source unknown");

export async function proposedEntry(id: string): Promise<ProposedEntry | null> {
  const r = await replay(id);
  const inv = r.invoice;
  const c = await cardFor(r);
  const head = { scenarioId: id, invoiceId: inv.id, customerRef: inv.customer_ref, invoiceAmount: `${formatUsdc(inv.amount)} ${inv.token}`, card: c, approvable: c.result.tone === "paid" };
  if (!r.view) {
    const to = r.facts?.tx?.transfers.find((t) => sameAddress(t.to, inv.receiving_address));
    if (!to) return null;
    return { ...head, matchLine: `Paid to this sample invoice's own address (${shortAddr(inv.receiving_address)}).`, status: "no_plan", rows: [],
      planReasons: [`Clearline's posting plan covers Ethereum payments only today, so no Xero entry is prepared for this ${c.network} payment.`] };
  }
  const acct: AccountingData = {
    ...emptyAccounting(),
    accounts: { walletAccountCode: SAMPLE_CLEARING.code, feeAccountCode: "SAMPLE-SHORTFALL" },
    links: { [inv.id]: { provider: "demo", invoiceId: inv.id, invoiceNumber: inv.id, contactName: inv.customer_ref, currency: "USD", amountDue: inv.amount, linkedAt: inv.created_at, demo: true } },
  };
  const plan = planPosting(r.data, acct, inv.id, { threshold: CONFIRMATIONS });
  const rows: EntryRow[] = [];
  for (const l of plan.lines) {
    if (l.kind !== "payment") return null;
    const via = `${formatUsdc(l.tokenAmount ?? l.amount)} ${l.token} × ${l.usdRate} USD (${peg(l.usdRateSource)}) · on ${l.network} · tx ${shortHash(l.txHash ?? "")} · ${l.date}`;
    rows.push({ account: SAMPLE_CLEARING.name, code: l.accountCode, dr: l.amount, detail: via });
    rows.push({ account: `Accounts Receivable · ${inv.customer_ref}`, cr: l.amount, detail: `Payment applied to ${inv.id}` });
  }
  const linked = Object.values(r.data.observations).find((o) => o.attribution.kind === "request" && o.attribution.requestId === inv.id);
  // Reported more than once, kept once by the product (one observation per transfer): say so, one entry.
  const once = (r.scenario.deliveries ?? 1) > 1 && Object.keys(r.data.observations).length === 1;
  return { ...head, matchLine: linked?.attribution.reason ?? "Matched by a person.", status: plan.status, planReasons: once ? [...plan.reasons, "Reported twice — counted once."] : plan.reasons, rows };
}

/** The scenarios S2 shows: TRON-01 first (the one that is final from a recorded read), then plans ready with payment lines. */
export async function entryScenarios(): Promise<string[]> {
  const out: string[] = [TRON_SCENARIO.id];
  for (const s of scenarios()) {
    const e = await proposedEntry(s.id);
    if (e && e.status === "ready" && e.rows.length) out.push(s.id);
  }
  return out;
}
