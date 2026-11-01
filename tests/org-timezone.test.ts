// The organisation's timezone (posting rule R2, ADR 0002): Xero's Windows-style zone names mapped to
// IANA, and plans that refuse to guess a posting date when the zone or the block time is unknown.

import { describe, expect, it } from "vitest";
import { seedDemoBooks } from "@/lib/accounting/engine";
import { DEMO_ORG_TIMEZONE } from "@/lib/accounting/providers/demo";
import { qboBodies } from "@/lib/accounting/providers/quickbooks";
import { planPosting } from "@/lib/accounting/rules";
import { isIanaZone, localDate, windowsToIana } from "@/lib/accounting/timezone";
import { WINDOWS_TO_IANA } from "@/lib/accounting/windows-zones";
import { emptyAccounting, type AccountingData, type InvoiceLink } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr, resetDemo } from "@/lib/requests/demo";
import { createRequest, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const sim = new SimulatedProvider();
const BLOCK = "2026-10-31T23:30:00.000Z"; // 07:30 on 1 Nov in Singapore

function setup(provider: "xero" | "quickbooks", ev: Partial<TransferEvent> = {}) {
  const d0 = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: "INV-R1", amount: "1000.00", receivingAddress: addr("R1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  const link: InvoiceLink = { provider, invoiceId: "inv-guid", invoiceNumber: "INV-R1", contactId: "contact-guid", contactName: "Acme", currency: "USD", amountDue: "1000.00", linkedAt: NOW, demo: false };
  const acct: AccountingData = { ...emptyAccounting(), provider, links: { R1: link } };
  const t: TransferEvent = { ...sim.send(emptyRequests(), { to: addr("R1"), amount: "1000.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:a"), seq: "a" }),
    source: "live", demo: false, blockNumber: 900, blockTime: BLOCK, confirmations: CONFIRMATIONS, ...ev };
  const at = "2026-11-01T00:00:00.000Z";
  const reqData: RequestsData = ingest(d0, t, at, "test", checkObservation(at), CONFIRMATIONS).data;
  return { reqData, acct, link };
}

describe("Xero's Windows-style timezone names map to IANA (CLDR windowsZones, territory 001)", () => {
  it("SINGAPORESTANDARDTIME is Asia/Singapore", () => expect(windowsToIana("SINGAPORESTANDARDTIME")).toBe("Asia/Singapore"));
  it("EASTERNSTANDARDTIME is America/New_York", () => expect(windowsToIana("EASTERNSTANDARDTIME")).toBe("America/New_York"));
  it("Xero's odd forms map too: UTC02, UTC+12, EASTERNSTANDARDTIME(MEXICO)", () => {
    expect(windowsToIana("UTC02")).toBe("Etc/GMT+2");
    expect(windowsToIana("UTC+12")).toBe("Etc/GMT-12");
    expect(windowsToIana("EASTERNSTANDARDTIME(MEXICO)")).toBe("America/Cancun");
  });
  it("an unknown, empty or missing name maps to nothing (never to UTC)", () => {
    for (const v of ["NOTAREALSTANDARDTIME", "", undefined, "Asia/Singapore", "KAMCHATKASTANDARDTIME", "MIDATLANTICSTANDARDTIME"]) {
      expect(windowsToIana(v)).toBeUndefined();
    }
  });
  it("every IANA zone in the table is one this Node runtime knows", () => {
    const bad = Object.entries(WINDOWS_TO_IANA).filter(([, z]) => !isIanaZone(z));
    expect(bad).toEqual([]);
    expect(Object.keys(WINDOWS_TO_IANA).length).toBeGreaterThan(130);
  });
  it("isIanaZone rejects junk and the empty string", () => {
    for (const z of ["", "Not/AZone", "SINGAPORESTANDARDTIME"]) expect(isIanaZone(z)).toBe(false);
    expect(isIanaZone("Pacific/Kiritimati")).toBe(true);
  });
  it("localDate gives the calendar date in the zone, across DST (New York, 1 Nov 2026 is the change)", () => {
    expect(localDate(BLOCK, "Asia/Singapore")).toBe("2026-11-01");
    expect(localDate("2026-11-01T04:30:00.000Z", "America/New_York")).toBe("2026-11-01"); // 00:30 EDT
    expect(localDate("2026-11-01T03:59:00.000Z", "America/New_York")).toBe("2026-10-31"); // 23:59 EDT
  });
});

describe("unknown timezone or block time: the plan is blocked, nothing posts", () => {
  for (const provider of ["xero", "quickbooks"] as const) {
    it(`${provider}: no organisation timezone → blocked with a plain-English reason, no lines`, () => {
      const { reqData, acct } = setup(provider);
      const plan = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS });
      expect(plan.status).toBe("blocked");
      expect(plan.lines).toEqual([]);
      expect(plan.reasons.join(" ")).toMatch(/couldn't read your organisation's timezone/);
    });
    it(`${provider}: a zone that isn't a real IANA zone (e.g. Xero's raw name) → blocked`, () => {
      const { reqData, acct } = setup(provider);
      for (const z of ["SINGAPORESTANDARDTIME", "Not/AZone", ""]) {
        expect(planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: z }).status).toBe("blocked");
      }
    });
  }
  it("a confirmed transfer with no block time → blocked (never dated by when Clearline saw it)", () => {
    const { reqData, acct } = setup("xero", { blockTime: undefined });
    const plan = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: "Asia/Singapore" });
    expect(plan.status).toBe("blocked");
    expect(plan.lines).toEqual([]);
    expect(plan.reasons.join(" ")).toMatch(/block time/);
  });
  it("QuickBooks: with the company's zone the payment TxnDate is the local date", () => {
    const { reqData, acct, link } = setup("quickbooks");
    const plan = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: "Asia/Singapore" });
    expect(plan.status).toBe("ready");
    expect(qboBodies(link, plan.lines[0], undefined)[0].body).toMatchObject({ TxnDate: "2026-11-01" });
    const ny = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: "America/New_York" });
    expect(qboBodies(link, ny.lines[0], undefined)[0].body).toMatchObject({ TxnDate: "2026-10-31" });
  });
});

describe("demo books post in the demo organisation's stated timezone", () => {
  it("the demo org's zone is a labelled IANA zone, and seeded demo entries are dated in it", async () => {
    expect(isIanaZone(DEMO_ORG_TIMEZONE)).toBe(true);
    const reqData = resetDemo(emptyRequests(), NOW, (id) => `pub-${id}`);
    const acct = await seedDemoBooks(reqData, emptyAccounting(), { now: NOW, operator: "Mei Tan (Finance ops)", threshold: CONFIRMATIONS });
    const entries = acct.demoBooks!.entries;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const audit = acct.audit.find((a) => a.kind === "posted" && a.lines?.some((l) => l.externalId === e.externalId));
      const obsKey = audit?.lines?.find((l) => l.externalId === e.externalId)?.observationKey;
      const obs = Object.values(reqData.observations).find((o) => o.key === obsKey);
      expect(obs?.blockTime).toBeDefined();
      expect(e.date).toBe(localDate(obs!.blockTime!, DEMO_ORG_TIMEZONE));
    }
  });
});
