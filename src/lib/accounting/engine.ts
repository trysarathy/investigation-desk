// Approve-and-post, invoice import and the demo books: the steps that change accounting data. They
// take the adapter and the clock as arguments, so the tests run them against fake accounting
// systems. The only write to the books is `approveAndPost`, and it posts only a "ready" plan.

import { createHash } from "node:crypto";
import { createRequest, deriveRequest } from "../requests/lifecycle";
import type { RequestsData, RequestToken } from "../requests/types";
import { addDemoInvoice, DEMO_ORG_TIMEZONE, DemoBooksAdapter, emptyDemoBooks } from "./providers/demo";
import { planPosting, type PlanOptions } from "./rules";
import { PartialPostError, PROVIDER_LABEL, type AccountingData, type AuditEntry, type BooksAdapter, type BooksInvoice, type BooksProvider, type InvoiceLink, type OrgTimeZone, type PostingPlan } from "./types";

const auditId = (seed: string) => `AUD-${createHash("sha256").update(seed).digest("hex").slice(0, 10)}`;

function appendAudit(acct: AccountingData, e: Omit<AuditEntry, "id">): AccountingData {
  const entry: AuditEntry = { id: auditId(`${acct.audit.length}:${e.at}:${e.kind}:${e.requestId ?? ""}:${e.idempotencyKey ?? ""}`), ...e };
  return { ...acct, audit: [...acct.audit, entry] };
}

/** The IANA zone postings are dated in: the demo org's stated zone, or the zone last read from the connected system. */
export function orgTimeZoneFor(acct: AccountingData, provider: BooksProvider): string | undefined {
  if (provider === "demo") return DEMO_ORG_TIMEZONE;
  return acct.orgTimeZone?.provider === provider ? acct.orgTimeZone.ianaTimeZone : undefined;
}

/** Why a real system's plan has no zone, in plain English, for the plan's reason. Undefined when there is a zone. */
export function noTimeZoneReasonFor(acct: AccountingData, provider: BooksProvider): string | undefined {
  if (provider === "demo" || orgTimeZoneFor(acct, provider)) return undefined;
  const label = PROVIDER_LABEL[provider];
  const tz = acct.orgTimeZone?.provider === provider ? acct.orgTimeZone : undefined;
  if (tz?.source) return `Your organisation's timezone in ${label} isn't one Clearline recognises yet, so it won't guess the posting date. Post this one by hand.`;
  return `Clearline hasn't been able to read your organisation's timezone from ${label}, so it won't guess the posting date. Reconnect ${label} (Clearline needs permission to read organisation settings) or post this one by hand.`;
}

const readFailed = (label: string) =>
  `Clearline couldn't read your organisation's timezone from ${label}, so it won't guess the posting date. Reconnect ${label} (Clearline needs permission to read organisation settings) or post this one by hand.`;

/**
 * Re-read the organisation's timezone just before posting (R2), and keep what was read. If it can't be
 * read, `error` (plain English; the system's own message is in `detail`, for the audit row) and nothing
 * may post. A changed zone is not refused here: the approval is bound to the dates the person saw
 * (PostingPlan.approvalKey), so a plan whose dates moved is refused by approveAndPost; `changed` says why.
 */
export async function refreshOrgTimeZone(acct: AccountingData, adapter: BooksAdapter, now: string):
  Promise<{ acct: AccountingData; error?: string; detail?: string; changed?: string }> {
  if (adapter.provider === "demo" || !adapter.readOrgTimeZone) return { acct };
  const label = PROVIDER_LABEL[adapter.provider];
  let tz: OrgTimeZone;
  try { tz = await adapter.readOrgTimeZone(now); } catch (e) {
    return { acct, error: readFailed(label), detail: e instanceof Error ? e.message : String(e) };
  }
  const before = orgTimeZoneFor(acct, adapter.provider);
  const next: AccountingData = { ...acct, orgTimeZone: tz };
  if (tz.ianaTimeZone === before) return { acct: next };
  return { acct: next, changed: `Your organisation's timezone in ${label} has changed${tz.ianaTimeZone ? ` (now ${tz.ianaTimeZone})` : " to one Clearline doesn't recognise"}.` };
}

/**
 * On connecting an accounting system: read its timezone and record the connection. The zone is replaced,
 * never kept from an earlier connection: unreadable or unknown → none, so plans are blocked, never UTC.
 */
export async function connectOrgTimeZone(acct: AccountingData, adapter: BooksAdapter, o: { orgName: string; at: string; by: string }): Promise<AccountingData> {
  const label = PROVIDER_LABEL[adapter.provider];
  let tz: OrgTimeZone | undefined;
  let detail = "";
  try { tz = await adapter.readOrgTimeZone?.(o.at); } catch (e) { detail = ` (${e instanceof Error ? e.message : String(e)})`; }
  const zone = tz?.ianaTimeZone ? `timezone ${tz.ianaTimeZone} (${label}: ${tz.source})`
    : tz ? `timezone "${tz.source || "not set"}" not recognised: nothing will post until it is`
    : `timezone couldn't be read${detail}: nothing will post until it is`;
  return appendAudit({ ...acct, provider: adapter.provider, orgTimeZone: tz },
    { at: o.at, kind: "connected", by: o.by, provider: adapter.provider, reason: `Connected to the ${label} organisation "${o.orgName}", ${zone}.`, demo: false });
}

export interface PostResult { acct: AccountingData; plan: PostingPlan; error?: string; posted?: AuditEntry }

/**
 * A person approves the plan for one request, and it posts. Refuses anything that isn't "ready"
 * (and records the refusal). A failure part-way is recorded with what was planned; retrying uses
 * the same idempotency key, so lines that did post are not posted again.
 */
export async function approveAndPost(
  reqData: RequestsData, acct: AccountingData, requestId: string,
  o: PlanOptions & { by: string; now: string; adapter: BooksAdapter; expectedKey?: string },
): Promise<PostResult> {
  const plan = planPosting(reqData, acct, requestId, o);
  const link = acct.links[requestId];
  const demo = !!reqData.requests[requestId]?.demo;
  const base = { at: o.now, by: o.by, provider: o.adapter.provider, requestId, invoiceNumber: link?.invoiceNumber, demo };
  if (plan.status !== "ready") {
    const why = plan.status === "posted" ? "Already in the books: nothing new to post." : plan.reasons.join(" ");
    return { acct: appendAudit(acct, { ...base, kind: "refused", reason: `Not posted (${plan.status.replace("_", " ")}): ${why}` }), plan, error: why };
  }
  if (o.expectedKey && o.expectedKey !== plan.approvalKey) {
    // What the person approved isn't what would post now (a transfer arrived, a decision changed, a posting
    // date moved because the organisation's timezone changed): show them again.
    const error = "The plan changed since you looked at it. Check the new lines and approve again.";
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
    next = appendAudit(next, { ...base, kind: "failed", reason: msg, idempotencyKey: plan.idempotencyKey, planned: plan.lines });
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
