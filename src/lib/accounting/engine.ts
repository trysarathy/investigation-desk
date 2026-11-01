// Approve-and-post, invoice import and the demo books: the steps that change accounting data. They
// take the adapter and the clock as arguments, so the tests run them against fake accounting
// systems. The only write to the books is `approveAndPost`, and it posts only a "ready" plan.

import { createHash } from "node:crypto";
import { createRequest, deriveRequest } from "../requests/lifecycle";
import type { RequestsData, RequestToken } from "../requests/types";
import { addDemoInvoice, DEMO_ORG_TIMEZONE, DemoBooksAdapter, emptyDemoBooks } from "./providers/demo";
import { planPosting, postedFor, type PlanOptions } from "./rules";
import { isUnknownOutcome, PartialPostError, type AccountingData, type AuditEntry, type BooksAdapter, type BooksInvoice, type InvoiceLink, type PostedLine, type PostFailure, type PostingLine, type PostingPlan } from "./types";

const auditId = (seed: string) => `AUD-${createHash("sha256").update(seed).digest("hex").slice(0, 10)}`;

function appendAudit(acct: AccountingData, e: Omit<AuditEntry, "id">): AccountingData {
  const entry: AuditEntry = { id: auditId(`${acct.audit.length}:${e.at}:${e.kind}:${e.requestId ?? ""}:${e.idempotencyKey ?? ""}`), ...e };
  return { ...acct, audit: [...acct.audit, entry] };
}

/** Xero keeps an Idempotency-Key 6 minutes from the first call; Clearline trusts it for 5. */
export const KEY_WINDOW_MS = 5 * 60_000;

/** Records the books made on earlier attempts for lines that didn't finish (a credit note not yet allocated). */
function withMade(acct: AccountingData, requestId: string, lines: PostingLine[]): PostingLine[] {
  const made: Record<string, string> = Object.assign({}, ...acct.audit.filter((e) => e.requestId === requestId && e.made).map((e) => e.made));
  return lines.map((l) => (l.key && made[l.key] ? { ...l, madeId: made[l.key] } : l));
}

/**
 * Lines still not in the books that were being sent when a call ended with an unknown outcome (timeout,
 * 5xx, unreadable reply), once Xero may have forgotten their key: Xero's 6 minutes run from the key's
 * first call, so the clock starts at the earliest approval that planned that key. Read back before sending.
 */
function unsureLines(acct: AccountingData, requestId: string, now: string): PostingLine[] {
  const mine = acct.audit.filter((e) => e.requestId === requestId);
  const done = new Set(postedFor(acct, requestId).map((l) => l.key));
  const firstSent = (key: string) => Math.min(...mine.filter((e) => e.kind === "approved" && e.planned?.some((l) => l.key === key)).map((e) => Date.parse(e.at)));
  const lines = mine.filter((e) => e.kind === "failed" && e.outcome === "unknown" && e.inFlight && !done.has(e.inFlight))
    .map((e) => e.planned?.find((l) => l.key === e.inFlight)).filter((l): l is PostingLine => !!l)
    .filter((l) => !(Date.parse(now) - firstSent(l.key!) < KEY_WINDOW_MS));
  return withMade(acct, requestId, lines.filter((l, i) => lines.findIndex((x) => x.key === l.key) === i));
}

export interface PostResult { acct: AccountingData; plan: PostingPlan; error?: string; posted?: AuditEntry }

/**
 * A person approves the plan for one request, and it posts. Refuses anything that isn't "ready"
 * (and records the refusal). A failure part-way is recorded with what was planned. Lines that posted
 * are never sent again; every other line is re-sent with its own fixed key (`lineKey`). After an unknown
 * outcome that Xero may no longer remember, the line is read back first; if that can't tell, nothing posts.
 */
export async function approveAndPost(
  reqData: RequestsData, acct: AccountingData, requestId: string,
  o: PlanOptions & { by: string; now: string; adapter: BooksAdapter; expectedKey?: string },
): Promise<PostResult> {
  const link = acct.links[requestId];
  const demo = !!reqData.requests[requestId]?.demo;
  const base = { at: o.now, by: o.by, provider: o.adapter.provider, requestId, invoiceNumber: link?.invoiceNumber, demo };
  const unsure = link ? unsureLines(acct, requestId, o.now) : [];
  const found: PostedLine[] = [];
  if (unsure.length) {
    try {
      if (!o.adapter.readBack) throw new Error("This accounting system can't be checked automatically. Check the invoice there.");
      for (const l of unsure) { const hit = await o.adapter.readBack(link, l, postedFor(acct, requestId)); if (hit) found.push(hit); }
    } catch (e) {
      const error = `Not posted: an earlier attempt ended without a clear answer, and ${e instanceof Error ? e.message : String(e)}`;
      return { acct: appendAudit(acct, { ...base, kind: "refused", reason: error, planned: unsure }), plan: planPosting(reqData, acct, requestId, o), error };
    }
    if (found.length) acct = appendAudit(acct, { ...base, kind: "posted", reason: `Found in the books on read-back after an earlier failure: ${found.length} line(s).`, lines: found });
  }
  const planned = planPosting(reqData, acct, requestId, o);
  const plan = { ...planned, lines: withMade(acct, requestId, planned.lines) };
  const foundNote = found.length ? " Clearline found part of it already in the books and recorded that, so the lines changed." : "";
  if (plan.status !== "ready") {
    const why = plan.status === "posted" ? "Already in the books: nothing new to post." : plan.reasons.join(" ");
    return { acct: appendAudit(acct, { ...base, kind: "refused", reason: `Not posted (${plan.status.replace("_", " ")}): ${why}` }), plan, error: why };
  }
  if (o.expectedKey && o.expectedKey !== plan.idempotencyKey) {
    // What the person approved isn't what would post now (a transfer arrived, a decision changed): show them again.
    const error = `The plan changed since you looked at it.${foundNote} Check the new lines and approve again.`;
    return { acct: appendAudit(acct, { ...base, kind: "refused", reason: `Not posted: ${error}`, idempotencyKey: plan.idempotencyKey }), plan, error };
  }
  let next = appendAudit(acct, { ...base, kind: "approved", reason: `${o.by} approved ${plan.lines.length} line(s): ${plan.reasons.join(" ")}`, idempotencyKey: plan.idempotencyKey, planned: plan.lines });
  try {
    const lines = await o.adapter.post(link, plan.lines, plan.idempotencyKey);
    next = appendAudit(next, { ...base, kind: "posted", reason: plan.reasons.join(" "), idempotencyKey: plan.idempotencyKey, lines });
    return { acct: next, plan, posted: next.audit[next.audit.length - 1] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Lines that did reach the books before the failure are recorded as posted, so a retry never posts them again.
    if (e instanceof PartialPostError && e.posted.length) {
      next = appendAudit(next, { ...base, kind: "posted", reason: `Part of the plan posted before a failure: ${e.posted.length} of ${plan.lines.length} line(s).`, idempotencyKey: plan.idempotencyKey, lines: e.posted });
    }
    const unknown = isUnknownOutcome(e);
    const { inFlight, made } = e as PostFailure;
    next = appendAudit(next, { ...base, kind: "failed", reason: unknown ? `${msg} (no clear answer: the books may hold the record; Clearline checks before sending it again)` : msg,
      idempotencyKey: plan.idempotencyKey, planned: plan.lines, ...(unknown ? { outcome: "unknown" as const } : {}),
      ...(inFlight ? { inFlight } : {}), ...(made && Object.keys(made).length ? { made } : {}) });
    return { acct: next, plan, error: `Posting failed: ${msg}` };
  }
}

/** Make a payment request from an invoice in the books, and link the two. */
export function importInvoice(
  reqData: RequestsData, acct: AccountingData, inv: BooksInvoice,
  o: { now: string; by: string; demo: boolean; publicId: string; receivingAddress: string; token: RequestToken; tokenContract: string; provider: AccountingData["provider"]; id?: string; autoMarkPaid?: boolean },
): { reqData: RequestsData; acct: AccountingData; requestId?: string; error?: string } {
  if (Object.values(acct.links).some((l) => l.invoiceId === inv.invoiceId && l.provider === o.provider)) {
    return { reqData, acct, error: `${inv.invoiceNumber} already has a payment request.` };
  }
  if (inv.currency.toUpperCase() !== "USD") return { reqData, acct, error: `${inv.invoiceNumber} is in ${inv.currency}: only USD invoices for now.` };
  const { data, request } = createRequest(reqData, { customerRef: inv.contactName, invoiceRef: inv.invoiceNumber, amount: inv.amountDue, receivingAddress: o.receivingAddress, token: o.token },
    { now: o.now, by: o.by, demo: o.demo, publicId: o.publicId, tokenContract: o.tokenContract, id: o.id, autoMarkPaid: o.autoMarkPaid });
  const link: InvoiceLink = { provider: o.provider, invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, contactId: inv.contactId, contactName: inv.contactName, currency: inv.currency, amountDue: inv.amountDue, linkedAt: o.now, demo: o.demo };
  const linked = appendAudit({ ...acct, links: { ...acct.links, [request.id]: link } },
    { at: o.now, by: o.by, provider: o.provider, kind: "imported", requestId: request.id, invoiceNumber: inv.invoiceNumber, reason: `Payment request ${request.id} made from ${inv.invoiceNumber} (${inv.amountDue} ${inv.currency} due).`, demo: o.demo });
  return { reqData: data, acct: linked, requestId: request.id };
}

/**
 * Demo books: one fictional invoice per demo request, linked to it. The week's routine payments were
 * approved and posted by the demo operator a few minutes after they were marked paid, so the demo
 * starts with real-looking history. Non-demo links and audit entries are kept.
 */
export async function seedDemoBooks(reqData: RequestsData, acct: AccountingData, o: { now: string; operator: string; threshold: number }): Promise<AccountingData> {
  const books = emptyDemoBooks();
  let next: AccountingData = {
    ...acct,
    provider: acct.provider === "demo" || !acct.provider ? "demo" : acct.provider,
    links: Object.fromEntries(Object.entries(acct.links).filter(([, l]) => !l.demo)),
    audit: acct.audit.filter((e) => !e.demo),
    demoBooks: books,
  };
  const demoRequests = Object.values(reqData.requests).filter((r) => r.demo).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const r of demoRequests) {
    const inv = addDemoInvoice(books, { invoiceNumber: r.invoiceRef, contactName: r.customerRef, total: r.amount });
    next.links[r.id] = { provider: "demo", invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, contactName: r.customerRef, currency: "USD", amountDue: r.amount, linkedAt: r.createdAt, demo: true };
    next = appendAudit(next, { at: r.createdAt, by: o.operator, provider: "demo", kind: "imported", requestId: r.id, invoiceNumber: r.invoiceRef, reason: `Payment request ${r.id} made from ${r.invoiceRef} (${r.amount} USD due).`, demo: true });
  }
  // Routine, exactly-paid requests that were marked paid: posted shortly after, as if approved then.
  for (const r of demoRequests) {
    const v = deriveRequest(reqData, r, o.threshold);
    if (v.state !== "completed" || v.review || v.request.id === "DEMO-1041") continue;
    const ack = v.acknowledgedBy;
    if (!ack || r.decisions.some((d) => d.kind !== "acknowledge")) continue;
    const at = new Date(Date.parse(ack.at) + 12 * 60_000).toISOString();
    const res = await approveAndPost(reqData, next, r.id, { threshold: o.threshold, orgTimeZone: DEMO_ORG_TIMEZONE, by: o.operator, now: at, adapter: new DemoBooksAdapter(books, () => at) });
    next = { ...res.acct, demoBooks: books };
  }
  next.audit.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return next;
}
