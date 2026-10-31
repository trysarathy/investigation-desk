// BUG: accounting posting dates are the UTC date, not the date in the accounting organisation's
// own timezone. rules.ts builds every line's `date` with
//   const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);
// and the providers send it unchanged (Xero `Date`, QuickBooks `TxnDate`). A receipt at 00:00-07:59
// Singapore time books to the previous day, and at month end to the previous month.
//
// Spec for the fix: the posting date is the calendar date of the transfer's block time in the
// accounting organisation's timezone (Xero: the Organisation's `Timezone` from GET /Organisation;
// QuickBooks: the company's timezone). Not UTC, and not a hard-coded Singapore.
//
// Seam: `planPosting(data, acct, requestId, opts)` takes a `PlanOptions` object; the fix should add
//   orgTimeZone?: string   // IANA zone, e.g. "Asia/Singapore"
// to `PlanOptions` and use it in `day()`. Until it exists, the tests pass it through an object typed
// `PlanOptions & { orgTimeZone: string }`, which TypeScript accepts today and still accepts after the
// fix. The provider payload builders (`xeroBody`, `qboBodies`) carry `line.date` unchanged, so the
// payload checks feed them the lines planPosting produced.

import { describe, expect, it } from "vitest";
import { qboBodies } from "@/lib/accounting/providers/quickbooks";
import { xeroBody } from "@/lib/accounting/providers/xero";
import { planPosting, type PlanOptions } from "@/lib/accounting/rules";
import { emptyAccounting, type AccountingData, type InvoiceLink } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, decide, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const sim = new SimulatedProvider();
const later = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

const SGT = "Asia/Singapore";
const NYC = "America/New_York";
const optsIn = (orgTimeZone: string): PlanOptions & { orgTimeZone: string } => ({ threshold: CONFIRMATIONS, orgTimeZone });

function invoiced(amount: string) {
  const reqData = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: "INV-R1", amount, receivingAddress: addr("R1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-R1", contactId: "contact-guid", contactName: "Acme", currency: "USD", amountDue: amount, linkedAt: NOW, demo: false };
  const acct: AccountingData = { ...emptyAccounting(), provider: "xero", links: { R1: link } };
  return { reqData, acct, link };
}

/** One confirmed transfer to R1 whose block time is `blockTime`. */
function paid(d: RequestsData, amount: string, blockTime: string): RequestsData {
  const ev: TransferEvent = { ...sim.send(emptyRequests(), { to: addr("R1"), amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:a"), seq: "a" }),
    source: "live", demo: false, blockNumber: 900, blockTime, confirmations: CONFIRMATIONS };
  const at = later(blockTime, 1);
  return ingest(d, ev, at, "test", checkObservation(at), CONFIRMATIONS).data;
}

const acceptShort = (d: RequestsData, at: string) =>
  decide(d, "R1", { kind: "accept_short", note: "Exchange fee." }, { now: at, by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(at) }).data;

const cases: { name: string; blockTime: string; tz: string; date: string }[] = [
  { name: "23:59 SGT 30 Oct stays on 30 Oct", blockTime: "2026-10-30T15:59:00.000Z", tz: SGT, date: "2026-10-30" },
  { name: "00:00 SGT 31 Oct posts on 31 Oct (UTC is still 30 Oct)", blockTime: "2026-10-30T16:00:00.000Z", tz: SGT, date: "2026-10-31" },
  { name: "07:59 SGT 31 Oct posts on 31 Oct (UTC is still 30 Oct)", blockTime: "2026-10-30T23:59:00.000Z", tz: SGT, date: "2026-10-31" },
  { name: "month end: 07:30 SGT 1 Nov posts to November, not October", blockTime: "2026-10-31T23:30:00.000Z", tz: SGT, date: "2026-11-01" },
  { name: "same instant in a New York org posts on 31 Oct (not hard-coded to Singapore)", blockTime: "2026-10-31T23:30:00.000Z", tz: NYC, date: "2026-10-31" },
];

describe("posting date is the calendar date in the accounting organisation's timezone", () => {
  for (const c of cases) {
    // BUG: remove .fails when fixed (posting date must use the org's timezone)
    it.fails(`payment line: ${c.name}`, () => {
      const { reqData: d0, acct } = invoiced("1000.00");
      const plan = planPosting(paid(d0, "1000.00", c.blockTime), acct, "R1", optsIn(c.tz));
      expect(plan.lines.map((l) => [l.kind, l.date])).toEqual([["payment", c.date]]);
      // The SGT 23:59 case and the NYC case match UTC by coincidence; this makes each case prove the zone was used.
      expect(planPosting(paid(d0, "1000.00", c.blockTime), acct, "R1", optsIn("Pacific/Kiritimati")).lines[0].date)
        .toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date(c.blockTime)));
    });

    // BUG: remove .fails when fixed (posting date must use the org's timezone)
    it.fails(`short payment note line: ${c.name}`, () => {
      const { reqData: d0, acct } = invoiced("5000.00");
      const plan = planPosting(paid(d0, "4950.00", c.blockTime), acct, "R1", optsIn(c.tz));
      expect(plan.lines.map((l) => [l.kind, l.date])).toEqual([["payment", c.date], ["note", c.date]]);
      expect(planPosting(paid(d0, "4950.00", c.blockTime), acct, "R1", optsIn("Pacific/Kiritimati")).lines[1].date)
        .toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date(c.blockTime)));
    });

    // BUG: remove .fails when fixed (posting date must use the org's timezone)
    it.fails(`fee write-off line: ${c.name}`, () => {
      const { reqData: d0, acct } = invoiced("5000.00");
      const d = acceptShort(paid(d0, "4950.00", c.blockTime), later(c.blockTime, 5));
      const plan = planPosting(d, acct, "R1", optsIn(c.tz));
      expect(plan.lines.map((l) => [l.kind, l.date])).toEqual([["payment", c.date], ["fee_writeoff", c.date]]);
      expect(planPosting(d, acct, "R1", optsIn("Pacific/Kiritimati")).lines[1].date)
        .toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date(c.blockTime)));
    });
  }
});

describe("the provider payloads carry the organisation-local posting date", () => {
  // 07:30 SGT on 1 Nov: a Singapore organisation must see November in its books.
  const blockTime = "2026-10-31T23:30:00.000Z";

  // BUG: remove .fails when fixed (posting date must use the org's timezone)
  it.fails("Xero: Payment Date and CreditNote Date are the org-local date (Singapore org, 1 Nov)", () => {
    const { reqData: d0, acct, link } = invoiced("5000.00");
    const plan = planPosting(acceptShort(paid(d0, "4950.00", blockTime), later(blockTime, 5)), acct, "R1", optsIn(SGT));
    const [pay, fee] = plan.lines;
    expect(xeroBody(link, pay).body).toMatchObject({ Payments: [{ Date: "2026-11-01" }] });
    expect(xeroBody(link, fee).body).toMatchObject({ CreditNotes: [{ Date: "2026-11-01" }] });
  });

  // BUG: remove .fails when fixed (posting date must use the org's timezone)
  it.fails("QuickBooks: payment and credit memo TxnDate are the org-local date (Singapore company, 1 Nov)", () => {
    const { reqData: d0, acct } = invoiced("5000.00");
    const link: InvoiceLink = { ...acct.links.R1, provider: "quickbooks" };
    const plan = planPosting(acceptShort(paid(d0, "4950.00", blockTime), later(blockTime, 5)), { ...acct, provider: "quickbooks" }, "R1", optsIn(SGT));
    const [pay, fee] = plan.lines;
    expect(qboBodies(link, pay, undefined)[0].body).toMatchObject({ TxnDate: "2026-11-01" });
    expect(qboBodies(link, fee, undefined, "item-1")[0].body).toMatchObject({ TxnDate: "2026-11-01" });
  });
});
