// The real approve path (service.approvePosting) re-reads the organisation's timezone before posting,
// and posts only the dates the person saw. Runs on a scratch data dir in live mode, with Xero faked at
// the fetch level (tokens on disk, so no OAuth call is made).

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { approvePosting, loadAccounting, planFor } from "@/lib/accounting/service";
import { emptyAccounting, type AccountingData, type InvoiceLink } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-11-01T00:00:00.000Z";
const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, DEMO_MODE: process.env.DEMO_MODE };
let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "desk-tz-approve-"));
  process.env.DESK_DATA_DIR = dir;
  process.env.DEMO_MODE = "off";
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(dir, { recursive: true, force: true });
});

/** A fresh data dir state: one 1,000.00 request paid at 07:30 SGT on 1 Nov, linked to a Xero invoice. */
async function seed(orgTimeZone?: AccountingData["orgTimeZone"]) {
  const d0 = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: "INV-R1", amount: "1000.00", receivingAddress: addr("R1"), token: "USDC" },
    { now: "2026-10-25T09:00:00.000Z", by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  const ev: TransferEvent = { ...new SimulatedProvider().send(emptyRequests(), { to: addr("R1"), amount: "1000.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:a"), seq: "a" }),
    source: "live", demo: false, blockNumber: 900, blockTime: "2026-10-31T23:30:00.000Z", confirmations: CONFIRMATIONS };
  const reqData = ingest(d0, ev, NOW, "test", checkObservation(NOW), CONFIRMATIONS).data;
  const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-R1", contactId: "c", contactName: "Acme", currency: "USD", amountDue: "1000.00", linkedAt: NOW, demo: false };
  const acct: AccountingData = { ...emptyAccounting(), provider: "xero", links: { R1: link }, orgTimeZone };
  await writeFile(path.join(dir, "requests.json"), JSON.stringify(reqData));
  await writeFile(path.join(dir, "accounting.json"), JSON.stringify(acct));
  await writeFile(path.join(dir, "xero-tokens.json"), JSON.stringify({ accessToken: "test-access", refreshToken: "test-refresh", expiresAt: Date.parse("2099-01-01"), tenantId: "tenant-1", tenantName: "Demo Company (SG)" }));
}

/** Fake Xero at the fetch level: GET /Organisation answers with `zone()` (or 403 when undefined), PUT /Payments records the body. */
function fakeXero(zone: () => string | undefined) {
  const puts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
    if (url.endsWith("/Organisation")) {
      const z = zone();
      return z === undefined
        ? { ok: false, status: 403, json: async () => ({}), text: async () => "AuthorizationUnsuccessful: insufficient scope" }
        : { ok: true, status: 200, json: async () => ({ Organisations: [{ Timezone: z }] }), text: async () => "" };
    }
    if (url.endsWith("/Payments") && init.method === "PUT") puts.push(init.body ?? "");
    return { ok: true, status: 200, json: async () => ({ Payments: [{ PaymentID: "pay-1" }] }), text: async () => "" };
  });
  return puts;
}
const SG = { provider: "xero" as const, source: "SINGAPORESTANDARDTIME", ianaTimeZone: "Asia/Singapore", readAt: NOW };

describe("approvePosting: the timezone re-read before posting", () => {
  it("read fails → refused with a plain sentence, a 'refused' audit row with the detail, nothing sent", async () => {
    await seed(SG);
    const { plan } = await planFor("R1");
    const puts = fakeXero(() => undefined);
    const res = await approvePosting("R1", "Mei", plan.approvalKey);
    expect(res.error).toBe("Clearline couldn't read your organisation's timezone from Xero, so it won't guess the posting date. Reconnect Xero (Clearline needs permission to read organisation settings) or post this one by hand.");
    expect(puts).toEqual([]);
    const acct = await loadAccounting();
    expect(acct.audit.at(-1)).toMatchObject({ kind: "refused", requestId: "R1" });
    expect(acct.audit.at(-1)?.reason).toMatch(/403/);
    expect(acct.orgTimeZone).toEqual(SG);
  });

  it("reviewer's reproduction: plan shown dated 1 Nov (Singapore); org moves to New York → refused twice with the old key, the new zone is stored; re-shown plan posts 31 Oct", async () => {
    await seed(SG);
    const { plan: seen } = await planFor("R1");
    expect(seen.lines[0].date).toBe("2026-11-01");
    const zone = "EASTERNSTANDARDTIME";
    const puts = fakeXero(() => zone);
    const first = await approvePosting("R1", "Mei", seen.approvalKey);
    expect(first.error).toMatch(/timezone in Xero has changed \(now America\/New_York\)\. The plan changed .* approve again/);
    expect((await loadAccounting()).orgTimeZone?.ianaTimeZone).toBe("America/New_York");
    // The stored zone is now New York: approving again with the key for the 1 Nov plan is still refused.
    const second = await approvePosting("R1", "Mei", seen.approvalKey);
    expect(second.error).toMatch(/The plan changed .* approve again/);
    expect(puts).toEqual([]);
    // The person sees the plan again (31 Oct) and approves that one.
    const { plan: reseen } = await planFor("R1");
    expect(reseen.lines[0].date).toBe("2026-10-31");
    const ok = await approvePosting("R1", "Mei", reseen.approvalKey);
    expect(ok.error).toBeUndefined();
    expect(puts.map((b) => JSON.parse(b).Payments[0].Date)).toEqual(["2026-10-31"]);
  });

  it("same zone → posts with that zone's date", async () => {
    await seed(SG);
    const { plan } = await planFor("R1");
    const puts = fakeXero(() => "SINGAPORESTANDARDTIME");
    expect((await approvePosting("R1", "Mei", plan.approvalKey)).error).toBeUndefined();
    expect(puts.map((b) => JSON.parse(b).Payments[0].Date)).toEqual(["2026-11-01"]);
  });

  it("zone changed to one Clearline doesn't recognise → refused with 'post by hand', never 'approve again'", async () => {
    await seed(SG);
    const { plan } = await planFor("R1");
    const puts = fakeXero(() => "MIDATLANTICSTANDARDTIME");
    const res = await approvePosting("R1", "Mei", plan.approvalKey);
    expect(res.error).toMatch(/isn't one Clearline recognises yet.*Post this one by hand/);
    expect(res.error).not.toMatch(/approve again/);
    expect(puts).toEqual([]);
    expect((await planFor("R1")).plan.status).toBe("blocked");
  });
});
