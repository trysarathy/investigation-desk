// Demo slice S2 (DEMO ONLY): the matched sample invoice, the same release checks as S1, the entry the
// existing posting plan proposes (unchanged), and an Approve that is disabled until final and never sends.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planPosting } from "@/lib/accounting/rules";
import { APPROVED_MESSAGE, APPROVER, entryScenarios, NOT_CHECKED_MESSAGE, proposedEntry, WAITING_MESSAGE } from "@/lib/demo-slices/entry";
import { DEMO_WATCH_LABEL } from "@/lib/demo-slices/release";
import { replay, TRANSFER_LABEL } from "@/lib/demo-slices/replay";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/demo/entry",
  useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("redirect"); } }));

const html = async (el: ReactNode) => { const s = await renderToReadableStream(el); await s.allReady; return (await new Response(s).text()).replace(/&#x27;/g, "'").replace(/&quot;/g, '"'); };
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
const env = { demo: process.env.DEMO_MODE, slices: process.env.DEMO_SLICES };
beforeAll(() => { process.env.DEMO_MODE = "on"; delete process.env.DEMO_SLICES; });
afterAll(() => { process.env.DEMO_MODE = env.demo; process.env.DEMO_SLICES = env.slices; });
afterEach(() => vi.restoreAllMocks());

describe("S2: matched invoice, the same release checks, and the proposed entry from the existing posting plan", () => {
  it("leads with TRON-01, then Ethereum plans that are ready with payment lines; Dr clearing = Cr receivable = the plan's amount", async () => {
    const ids = await entryScenarios();
    expect(ids).toEqual(["TRON-01", "SCN-01", "SCN-02", "SCN-03", "SCN-04", "SCN-05", "SCN-11"]);
    for (const id of ids.slice(1).filter((x) => x !== "SCN-11")) {
      const e = (await proposedEntry(id))!;
      const r = await replay(id);
      const acct = { version: 1 as const, provider: "demo" as const, accounts: { walletAccountCode: "SAMPLE-CLR", feeAccountCode: "SAMPLE-SHORTFALL" }, audit: [],
        links: { [r.invoice.id]: { provider: "demo" as const, invoiceId: r.invoice.id, invoiceNumber: r.invoice.id, contactName: r.invoice.customer_ref, currency: "USD", amountDue: r.invoice.amount, linkedAt: r.invoice.created_at, demo: true } } };
      const plan = planPosting(r.data, acct, r.invoice.id, { threshold: 12 });
      expect(e.rows.filter((x) => x.dr).map((x) => x.dr)).toEqual(plan.lines.map((l) => l.amount));
      expect(e.rows.filter((x) => x.cr).map((x) => x.cr)).toEqual(plan.lines.map((l) => l.amount));
      expect(e.rows[0]).toMatchObject({ account: "Stablecoin clearing (sample account)", code: "SAMPLE-CLR" });
      expect(e.rows[0].detail).toMatch(/ USDT? × 1\.00 USD \(assumed peg, not a market rate\)|USDC × 1\.00 USD \(assumed peg, not a market rate\)/);
      // Post only when final: Ethereum finality isn't read, so none of these can be approved.
      expect(e.approvable, id).toBe(false);
      expect(e.matchLine).not.toMatch(/on-chain this is done|confirmed/i);
    }
  });
  it("SCN-11 (same transfer reported twice): labelled, no second entry, no Dr/Cr", async () => {
    const e = (await proposedEntry("SCN-11"))!;
    expect(e).toMatchObject({ status: "duplicate", rows: [], approvable: false });
    expect(e.planReasons).toEqual(["Same transfer as SCN-03 — no second entry."]);
    const P = (await import("@/app/demo/entry/page")).default as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
    const h = text(await html(await P({ searchParams: Promise.resolve({ s: "SCN-11" }) })));
    expect(h).toContain("Same transfer as SCN-03 — no second entry.");
    expect(h).not.toMatch(/Debit|Credit/);
  });
  it("TRON-01: final, but no posting plan exists for Tron, so it says so instead of inventing an entry", async () => {
    const e = (await proposedEntry("TRON-01"))!;
    expect(e).toMatchObject({ approvable: true, status: "no_plan", rows: [] });
    expect(e.planReasons[0]).toBe("Clearline's posting plan covers Ethereum payments only today, so no Xero entry is prepared for this Tron payment.");
  });
  it("the page: checks right above Approve; Approve disabled, saying finality wasn't checked (not 'waiting') on Ethereum", async () => {
    const P = (await import("@/app/demo/entry/page")).default;
    const h = text(await html(await P({ searchParams: Promise.resolve({ s: "SCN-01" }) })));
    expect(h).toContain(NOT_CHECKED_MESSAGE);
    expect(NOT_CHECKED_MESSAGE).toBe("Finality wasn't checked, so this can't be approved.");
    expect(h).not.toContain(WAITING_MESSAGE); // "Waiting until final" only when finality is actually pending
    expect(h).toMatch(/Checks\s+Final: NOT checked\s+Network: checked\s+Address: checked\s+Token: checked\s+Amount: checked\s+Sanctions \(US OFAC SDN only\): NOT checked\s+Freeze: checked/);
    expect(h).toContain("SGD: rate not applied in this demo.");
    expect(h).not.toMatch(/On-chain this is done/);
    const raw = await html(await P({ searchParams: Promise.resolve({ s: "SCN-01" }) }));
    expect(raw).toMatch(/<button[^>]*disabled=""[^>]*data-testid="approve-demo"/);
  });
  it("Approve sends nothing: no network or server call in the component, and it says so", () => {
    const src = readFileSync(path.join(__dirname, "..", "src/components/demo-slices/ApproveDemo.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|"use server"|action=/);
    // QA: Xero is "in testing" (PRODUCT_FACTS); never "would now post".
    expect(APPROVED_MESSAGE).toBe("Live, this is the step that would post the entry to Xero once it's connected and switched on. Demo: nothing sent.");
    expect(APPROVED_MESSAGE).not.toMatch(/would now post/);
    expect(APPROVER).toBe("Mei Tan (sample user)");
  });
});

describe("S2 page: labelled, never 'safe', gated, odd params", () => {
  const Entry = async () => (await import("@/app/demo/entry/page")).default as unknown as (p: { searchParams: Promise<Record<string, string | string[]>> }) => Promise<ReactNode>;
  it.each([[{}], [{ s: "SCN-07" }], [{ s: ["SCN-01", "SCN-02"] }]] as [Record<string, string | string[]>][])("%j", async (q) => {
    const h = text(await html(await (await Entry())({ searchParams: Promise.resolve(q) })));
    expect(h).not.toMatch(/safe/i);
    expect(h).toContain(DEMO_WATCH_LABEL);
    expect(h).toContain(TRANSFER_LABEL);
    expect(h).toContain("Approve");
    if (Array.isArray(q.s)) expect(h).toContain("Matched to SAMPLE-INV-2001");
    if (Array.isArray(q.s)) expect(h).toContain("Proposed Xero entry"); // SCN-01 has a plan
  });
  it.each([["DEMO_MODE", "off"], ["DEMO_MODE", "live"], ["DEMO_MODE", "0"], ["DEMO_SLICES", "off"]])("%s=%s: not-found", async (k, v) => {
    process.env[k] = v;
    try { await expect((await Entry())({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND"); }
    finally { process.env.DEMO_MODE = "on"; delete process.env.DEMO_SLICES; }
  });
  it("TRON-01 (no entry prepared): the link and heading don't promise a proposed entry", async () => {
    const h = text(await html(await (await Entry())({ searchParams: Promise.resolve({ s: "TRON-01" }) })));
    expect(h).toMatch(/Xero entry/);
    expect(h).not.toContain("Proposed Xero entry");
    const Release = (await import("@/app/demo/release/page")).default as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
    const r = text(await html(await Release({ searchParams: Promise.resolve({ s: "TRON-01" }) })));
    expect(r).toContain("See it matched to its invoice");
    expect(r).not.toMatch(/proposed Xero entry/i);
    const e = text(await html(await Release({ searchParams: Promise.resolve({ s: "SCN-01" }) })));
    expect(e).not.toContain("See it matched"); // not paid: no link
  });
  it("entry.ts reads nothing from disk", () => {
    expect(readFileSync(path.join(__dirname, "..", "src/lib/demo-slices/entry.ts"), "utf8")).not.toMatch(/node:fs|readFileSync|process\.cwd/);
  });
});
