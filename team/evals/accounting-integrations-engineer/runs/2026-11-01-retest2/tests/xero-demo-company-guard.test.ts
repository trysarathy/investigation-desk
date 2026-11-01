// Golden task 4 (retest 2), accounting-integrations-engineer, 2026-11-01 SGT.
// Defect: the Xero adapter posts into whatever organisation the token is connected to. It never reads
// GET /Organisation, so nothing stops a PUT /Payments into a real (non-demo) company's books.
// Policy (agent file "Never" + xero-api.md "Use IsDemoCompany as a hard guard"): until Aashmiin switches
// live posting on, refuse to post unless GET /Organisation says IsDemoCompany === true.
// Run: copy into tests/ of a checkout of origin/main and `npx vitest run tests/xero-demo-company-guard.test.ts`.
// Expected today: test 1 FAILS (the adapter makes PUT /Payments and resolves); test 2 passes.
import { describe, expect, it } from "vitest";
import { XeroAdapter, type Fetch } from "@/lib/accounting/providers/xero";
import type { InvoiceLink, PostingLine } from "@/lib/accounting/types";

const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-1", contactId: "contact-guid", contactName: "<customer>", currency: "USD", amountDue: "1000.00", linkedAt: "2026-11-01T13:40:00.000Z", demo: false };
const pay: PostingLine = { kind: "payment", amount: "1000.00", accountCode: "090", txHash: "0xabc", token: "USDT", network: "Ethereum", usdRate: "1.00", date: "2026-10-31", description: "d" };

function fakeXero(isDemoCompany: boolean) {
  const calls: { method: string; path: string }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const path = url.replace("https://api.xero.com/api.xro/2.0", "");
    calls.push({ method: init.method, path });
    const body = path.startsWith("/Organisation")
      ? { Organisations: [{ Name: isDemoCompany ? "Demo Company (Global)" : "<real organisation>", IsDemoCompany: isDemoCompany, Timezone: "SINGAPORESTANDARDTIME", BaseCurrency: "SGD" }] }
      : path.endsWith("/Payments") ? { Payments: [{ PaymentID: "pay-1" }] } : {};
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };
  return { calls, fetchFn };
}

describe("Xero adapter: Demo Company guard", () => {
  it("refuses to post to an organisation whose GET /Organisation says IsDemoCompany: false, and sends no PUT", async () => {
    const { calls, fetchFn } = fakeXero(false);
    const x = new XeroAdapter({ tenantId: "tenant-real", accessToken: async () => "fake" }, fetchFn);
    await expect(x.post(link, [pay], "clearline-key")).rejects.toThrow(/demo company/i);
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("still posts to the Xero Demo Company (neighbour: the guard must not block sandbox tests)", async () => {
    const { calls, fetchFn } = fakeXero(true);
    const x = new XeroAdapter({ tenantId: "tenant-demo", accessToken: async () => "fake" }, fetchFn);
    const out = await x.post(link, [pay], "clearline-key");
    expect(out.map((o) => o.externalType)).toEqual(["Payment"]);
    expect(calls.some((c) => c.method === "PUT" && c.path === "/Payments")).toBe(true);
  });
});
