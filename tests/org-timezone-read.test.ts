// Reading the organisation's timezone from the accounting system (R2, ADR 0002 PR (b)): Xero
// GET /Organisation `Timezone` (needs accounting.settings.read), QuickBooks CompanyInfo `DefaultTimeZone`,
// and re-reading it just before posting.

import { describe, expect, it } from "vitest";
import { approveAndPost, connectOrgTimeZone, noTimeZoneReasonFor, orgTimeZoneFor, refreshOrgTimeZone } from "@/lib/accounting/engine";
import { DEMO_ORG_TIMEZONE, DemoBooksAdapter, emptyDemoBooks } from "@/lib/accounting/providers/demo";
import { QuickBooksAdapter } from "@/lib/accounting/providers/quickbooks";
import { XeroAdapter, type Fetch } from "@/lib/accounting/providers/xero";
import { DEFAULT_SCOPES } from "@/lib/accounting/providers/xero-auth";
import { planPosting } from "@/lib/accounting/rules";
import { emptyAccounting, type AccountingData, type InvoiceLink, type OrgTimeZone } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-11-01T00:00:00.000Z";
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(routes: (url: string, method: string) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn: Fetch = async (url, init) => {
    calls.push({ url, ...init });
    const r = routes(url, init.method);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {}, text: async () => (status < 400 ? "" : "forbidden") };
  };
  return { fn, calls };
}
const xero = (f: Fetch) => new XeroAdapter({ tenantId: "tenant-1", accessToken: async () => "test-access" }, f);
const qbo = (f: Fetch) => new QuickBooksAdapter({ realmId: "123", accessToken: async () => "test-access" }, f);
const org = (Timezone?: string) => ({ body: { Organisations: [Timezone === undefined ? {} : { Timezone }] } });

describe("Xero: GET /Organisation Timezone", () => {
  it("requests accounting.settings.read by default (needed for GET /Organisation)", () => {
    expect(DEFAULT_SCOPES.split(" ")).toContain("accounting.settings.read");
  });
  it("SINGAPORESTANDARDTIME → Asia/Singapore, read from /Organisation for the connected tenant", async () => {
    const { fn, calls } = fakeFetch(() => org("SINGAPORESTANDARDTIME"));
    expect(await xero(fn).readOrgTimeZone(NOW)).toEqual({ provider: "xero", source: "SINGAPORESTANDARDTIME", ianaTimeZone: "Asia/Singapore", readAt: NOW });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.xero.com/api.xro/2.0/Organisation" });
    expect(calls[0].headers["xero-tenant-id"]).toBe("tenant-1");
  });
  it("an unmapped or missing Timezone gives no IANA zone (never UTC)", async () => {
    for (const tz of ["MIDATLANTICSTANDARDTIME", undefined]) {
      const r = await xero(fakeFetch(() => org(tz)).fn).readOrgTimeZone(NOW);
      expect(r.ianaTimeZone).toBeUndefined();
    }
  });
  it("scope not granted (403) → throws, so the caller blocks", async () => {
    await expect(xero(fakeFetch(() => ({ status: 403 })).fn).readOrgTimeZone(NOW)).rejects.toThrow(/403/);
  });
});

describe("QuickBooks: CompanyInfo DefaultTimeZone", () => {
  it("reads /companyinfo/<realmId>; an IANA or a Windows name is accepted", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { CompanyInfo: { DefaultTimeZone: "America/New_York" } } }));
    expect((await qbo(fn).readOrgTimeZone(NOW)).ianaTimeZone).toBe("America/New_York");
    expect(calls[0].url).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123?minorversion=75");
    const win = fakeFetch(() => ({ body: { CompanyInfo: { DefaultTimeZone: "Singapore Standard Time" } } }));
    expect((await qbo(win.fn).readOrgTimeZone(NOW)).ianaTimeZone).toBe("Asia/Singapore");
  });
  it("legacy abbreviations Node still accepts are refused (\"EST\" would be fixed UTC-5, no daylight saving)", async () => {
    for (const DefaultTimeZone of ["EST", "PST", "MST", "EST5EDT", "Etc/GMT+5"]) {
      expect((await qbo(fakeFetch(() => ({ body: { CompanyInfo: { DefaultTimeZone } } })).fn).readOrgTimeZone(NOW)).ianaTimeZone).toBeUndefined();
    }
  });
  it("missing or junk DefaultTimeZone → no zone", async () => {
    for (const body of [{ CompanyInfo: {} }, { CompanyInfo: { DefaultTimeZone: "Somewhere/Nowhere" } }, {}]) {
      expect((await qbo(fakeFetch(() => ({ body })).fn).readOrgTimeZone(NOW)).ianaTimeZone).toBeUndefined();
    }
  });
});

describe("which zone a plan uses, and the re-read before posting", () => {
  const stored = (provider: "xero" | "quickbooks", ianaTimeZone?: string): AccountingData =>
    ({ ...emptyAccounting(), provider, orgTimeZone: { provider, source: "X", ianaTimeZone, readAt: NOW } });
  it("demo → the demo org's zone; a real system → the zone read from that system only", () => {
    expect(orgTimeZoneFor(emptyAccounting(), "demo")).toBe(DEMO_ORG_TIMEZONE);
    expect(orgTimeZoneFor(stored("xero", "Asia/Singapore"), "xero")).toBe("Asia/Singapore");
    expect(orgTimeZoneFor(stored("quickbooks", "Asia/Singapore"), "xero")).toBeUndefined();
    expect(orgTimeZoneFor(emptyAccounting(), "xero")).toBeUndefined();
  });
  it("demo adapter: nothing to read", async () => {
    const acct = emptyAccounting();
    expect(await refreshOrgTimeZone(acct, new DemoBooksAdapter(emptyDemoBooks(), () => NOW), NOW)).toEqual({ acct });
  });
  it("read fails → plain error (the system's message only in detail), stored zone untouched", async () => {
    const acct = stored("xero", "Asia/Singapore");
    const r = await refreshOrgTimeZone(acct, xero(fakeFetch(() => ({ status: 403 })).fn), NOW);
    expect(r.error).toBe("Clearline couldn't read your organisation's timezone from Xero, so it won't guess the posting date. Reconnect Xero (Clearline needs permission to read organisation settings) or post this one by hand.");
    expect(r.detail).toMatch(/403/);
    expect(r.acct).toBe(acct);
  });
  it("zone changed → the new zone is kept and noted (the approval key, not this, refuses a moved date)", async () => {
    const r = await refreshOrgTimeZone(stored("xero", "Asia/Singapore"), xero(fakeFetch(() => org("EASTERNSTANDARDTIME")).fn), NOW);
    expect(r.error).toBeUndefined();
    expect(r.changed).toMatch(/has changed \(now America\/New_York\)/);
    expect(r.acct.orgTimeZone?.ianaTimeZone).toBe("America/New_York");
  });
  it("same zone → nothing to note, read time updated", async () => {
    const r = await refreshOrgTimeZone(stored("xero", "Asia/Singapore"), xero(fakeFetch(() => org("SINGAPORESTANDARDTIME")).fn), "2026-11-02T00:00:00.000Z");
    expect(r.error ?? r.changed).toBeUndefined();
    expect(r.acct.orgTimeZone).toMatchObject<Partial<OrgTimeZone>>({ ianaTimeZone: "Asia/Singapore", readAt: "2026-11-02T00:00:00.000Z" });
  });
  it("the plan's reason says why there is no zone: never read vs not recognised", () => {
    expect(noTimeZoneReasonFor(emptyAccounting(), "xero")).toMatch(/hasn't been able to read .* from Xero.*Reconnect Xero/);
    const unknown = stored("xero", undefined);
    expect(noTimeZoneReasonFor(unknown, "xero")).toMatch(/isn't one Clearline recognises yet.*Post this one by hand/);
    expect(noTimeZoneReasonFor(unknown, "xero")).not.toMatch(/Reconnect|approve again/);
    expect(noTimeZoneReasonFor(stored("xero", "Asia/Singapore"), "xero")).toBeUndefined();
    expect(noTimeZoneReasonFor(emptyAccounting(), "demo")).toBeUndefined();
  });
});

// One 1,000.00 request paid at 07:30 SGT on 1 Nov (2026-10-31T23:30Z): 1 Nov in Singapore, 31 Oct in New York.
function paidRequest() {
  const d0 = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: "INV-R1", amount: "1000.00", receivingAddress: addr("R1"), token: "USDC" },
    { now: "2026-10-25T09:00:00.000Z", by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  const ev: TransferEvent = { ...new SimulatedProvider().send(emptyRequests(), { to: addr("R1"), amount: "1000.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:a"), seq: "a" }),
    source: "live", demo: false, blockNumber: 900, blockTime: "2026-10-31T23:30:00.000Z", confirmations: CONFIRMATIONS };
  const reqData = ingest(d0, ev, NOW, "test", checkObservation(NOW), CONFIRMATIONS).data;
  const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-R1", contactId: "c", contactName: "Acme", currency: "USD", amountDue: "1000.00", linkedAt: NOW, demo: false };
  return { reqData, acct: { ...emptyAccounting(), provider: "xero", links: { R1: link } } as AccountingData };
}
const withZone = (acct: AccountingData, source: string, ianaTimeZone?: string): AccountingData =>
  ({ ...acct, orgTimeZone: { provider: "xero", source, ianaTimeZone, readAt: NOW } });

describe("an approval is bound to the posting dates the person saw (review finding, 1b)", () => {
  it("the approval key changes with the dates; the idempotency key doesn't", () => {
    const { reqData, acct } = paidRequest();
    const sg = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: "Asia/Singapore" });
    const ny = planPosting(reqData, acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: "America/New_York" });
    expect(sg.lines[0].date).toBe("2026-11-01");
    expect(ny.lines[0].date).toBe("2026-10-31");
    expect(sg.idempotencyKey).toBe(ny.idempotencyKey);
    expect(sg.approvalKey).not.toBe(ny.approvalKey);
  });
  it("reproduction: shown dated 1 Nov (Singapore), zone since stored as New York, approved with the old key → refused, nothing sent", async () => {
    const { reqData, acct } = paidRequest();
    const seen = planPosting(reqData, withZone(acct, "SINGAPORESTANDARDTIME", "Asia/Singapore"), "R1", { threshold: CONFIRMATIONS, orgTimeZone: "Asia/Singapore" });
    const nowNy = withZone(acct, "EASTERNSTANDARDTIME", "America/New_York");
    const { fn, calls } = fakeFetch(() => ({ body: { Payments: [{ PaymentID: "pay-1" }] } }));
    const res = await approveAndPost(reqData, nowNy, "R1", { threshold: CONFIRMATIONS, orgTimeZone: orgTimeZoneFor(nowNy, "xero"), by: "Mei", now: NOW, adapter: xero(fn), expectedKey: seen.approvalKey });
    expect(res.error).toMatch(/plan changed .* approve again/);
    expect(calls).toEqual([]);
    expect(res.acct.audit.at(-1)).toMatchObject({ kind: "refused" });
  });
  it("end to end: a 07:30 SGT 1 Nov receipt posts to Xero dated 2026-11-01, approved with the key the person saw", async () => {
    const { reqData, acct: acct0 } = paidRequest();
    expect(planPosting(reqData, acct0, "R1", { threshold: CONFIRMATIONS, orgTimeZone: orgTimeZoneFor(acct0, "xero") }).status).toBe("blocked");
    const { fn, calls } = fakeFetch((url) => (url.endsWith("/Organisation") ? org("SINGAPORESTANDARDTIME") : { body: { Payments: [{ PaymentID: "pay-1" }] } }));
    const adapter = xero(fn);
    const z = await refreshOrgTimeZone(acct0, adapter, NOW);
    const seen = planPosting(reqData, z.acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: orgTimeZoneFor(z.acct, "xero") });
    const res = await approveAndPost(reqData, z.acct, "R1", { threshold: CONFIRMATIONS, orgTimeZone: orgTimeZoneFor(z.acct, "xero"), by: "Mei", now: NOW, adapter, expectedKey: seen.approvalKey });
    expect(res.error).toBeUndefined();
    const put = calls.find((c) => c.url.endsWith("/Payments"))!;
    expect(JSON.parse(put.body!).Payments[0].Date).toBe("2026-11-01");
  });
});

describe("connecting: the zone is read and stored, replacing any earlier one (callback route)", () => {
  const connect = (acct: AccountingData, f: Fetch) => connectOrgTimeZone(acct, xero(f), { orgName: "Demo Company (SG)", at: NOW, by: "Xero OAuth" });
  it("mapped zone → stored, and the 'connected' audit row states it", async () => {
    const a = await connect(emptyAccounting(), fakeFetch(() => org("SINGAPORESTANDARDTIME")).fn);
    expect(a.provider).toBe("xero");
    expect(a.orgTimeZone).toEqual({ provider: "xero", source: "SINGAPORESTANDARDTIME", ianaTimeZone: "Asia/Singapore", readAt: NOW });
    expect(a.audit.at(-1)).toMatchObject({ kind: "connected", provider: "xero", reason: 'Connected to the Xero organisation "Demo Company (SG)", timezone Asia/Singapore (Xero: SINGAPORESTANDARDTIME).' });
  });
  it("unmapped zone → stored without an IANA zone, so plans are blocked; the audit says so", async () => {
    const a = await connect(withZone(emptyAccounting(), "SINGAPORESTANDARDTIME", "Asia/Singapore"), fakeFetch(() => org("MIDATLANTICSTANDARDTIME")).fn);
    expect(a.orgTimeZone?.ianaTimeZone).toBeUndefined();
    expect(orgTimeZoneFor(a, "xero")).toBeUndefined();
    expect(a.audit.at(-1)?.reason).toMatch(/"MIDATLANTICSTANDARDTIME" not recognised: nothing will post until it is/);
  });
  it("read fails on a reconnect → the earlier zone is cleared, never kept", async () => {
    const a = await connect(withZone(emptyAccounting(), "SINGAPORESTANDARDTIME", "Asia/Singapore"), fakeFetch(() => ({ status: 403 })).fn);
    expect(a.orgTimeZone).toBeUndefined();
    expect(orgTimeZoneFor(a, "xero")).toBeUndefined();
    expect(a.audit.at(-1)?.reason).toMatch(/timezone couldn't be read: nothing will post until it is/);
    expect(a.audit.at(-1)?.reason).not.toMatch(/403|forbidden/);
    expect(a.audit.at(-1)?.detail).toMatch(/Xero GET \/Organisation failed \(403\)/);
  });
});
