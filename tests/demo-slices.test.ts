// Demo slices S1 / S1b / S2 and the demo watcher (DEMO ONLY): wording per state, quiet-by-default
// messages, no "safe" anywhere on the rendered pages, a watcher that can't take a real address,
// no live chain call, and an Approve that sends nothing. All on the 20 replayed real transfers.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planPosting } from "@/lib/accounting/rules";
import { APPROVED_MESSAGE, APPROVER, entryScenarios, proposedEntry, WAITING_MESSAGE } from "@/lib/demo-slices/entry";
import { checkChips, ranSummary, statusLabel } from "@/lib/demo-slices/present";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { card, cardFor, DEMO_WATCH_ID, DEMO_WATCH_LABEL, FREEZE_FIXTURE, freezeFixtureCovers, notificationFor, watchTimeline } from "@/lib/demo-slices/release";
import { replay, replayOnly, scenarios, scenariosForHash, TRANSFER_LABEL } from "@/lib/demo-slices/replay";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/demo/release",
  useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("redirect"); } }));

const html = async (el: ReactNode) => { const s = await renderToReadableStream(el); await s.allReady; return (await new Response(s).text()).replace(/&#x27;/g, "'").replace(/&quot;/g, '"'); };
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
const env = { demo: process.env.DEMO_MODE, slices: process.env.DEMO_SLICES };
beforeAll(() => { process.env.DEMO_MODE = "on"; delete process.env.DEMO_SLICES; });
afterAll(() => { process.env.DEMO_MODE = env.demo; process.env.DEMO_SLICES = env.slices; });
afterEach(() => vi.restoreAllMocks());

describe("S1 release card: crypto-protocol-engineer's checks, fed with recorded data only", () => {
  it("SCN-01 as recorded: token and amount checked, sender NOT checked, not frozen (recorded freeze read), finality NOT checked (no finalized block recorded yet)", async () => {
    const c = await card("SCN-01");
    expect(c.result.tone).toBe("not_yet");
    expect(c.result.headline).toBe("Finality NOT checked.");
    expect(c.result.lines[0]).toBe("Right token and amount. Sender NOT checked. Not frozen.");
    expect(c.checks.sanctions.state).toBe("not_run");
    expect(c.checks.freeze).toMatchObject({ state: "passed", issuer: "Tether" });
    expect(c.checks.freeze.detail).toMatch(/^Neither the sender nor the receiving address is frozen by Tether \(as of .* block \d+\); this can change later\.$/);
  });
  it("with a finalized block covering the transfer: Paid and final, and still says the sender was NOT checked", async () => {
    const r = await replay("SCN-01");
    const c = await cardFor(r, { finalizedBlock: r.facts!.tx!.blockNumber });
    expect(c.result).toMatchObject({ tone: "paid", headline: "Paid and final. Right token and amount. Sender NOT checked. Not frozen.", allChecked: false });
    const r5 = await replay("SCN-05");
    expect((await cardFor(r5, { finalizedBlock: r5.facts!.tx!.blockNumber })).result.headline).toBe("Paid and final. Right token and amount. Sender NOT checked. Freeze status NOT checked.");
  });
  it("TRON-01 (Tron-first): Paid and final from the recorded Tron finality read, and the line says it's a recording, not a live read", async () => {
    const c = await card("TRON-01");
    expect(c.result).toMatchObject({ tone: "paid", headline: "Paid and final. Right token and amount. Sender NOT checked. Freeze status NOT checked.", allChecked: false });
    expect(c.result.lines[0]).toMatch(/^In block \d+; the network had finalized up to block 87642970\. \(from a recording made at .*, not a live read\)$/);
    expect(c.network).toBe("Tron");
    expect(c.label).toBe(TRANSFER_LABEL);
  });
  it("not final yet (replayed wait): says so, with the 6a status sentence as the time line", async () => {
    const c = await card("SCN-01", { asOfConfirmations: 4 });
    expect(c.result).toMatchObject({ tone: "not_yet", headline: "Not final yet." });
    expect(c.result.lines[0]).toMatch(/Ethereum usually takes about 2 minutes/);
    expect(c.checks.finality.detail).toBe("In a block, not final yet (this wait is replayed faster than real time).");
  });
  it.each([
    ["SCN-07", /^Don't release: Short by 8\.74181 USDT/],
    ["SCN-08", /^Don't release: Short by 249\.999 USDT/],
    ["SCN-12", /^Don't release: Wrong token: this is not Tether's USDT contract on Ethereum, it's a look-alike\.$/],
    ["SCN-13", /^Don't release: Wrong token: .*look-alike\.$/],
    ["SCN-14", /^Don't release: Sent on Tron, not Ethereum, the network on the invoice\.$/],
    ["SCN-15", /^Don't release: Sent on BNB Chain, not Ethereum/],
    ["SCN-16", /^Don't release: Not paid to this invoice: it went to a look-alike address \(0xbaff2…f8b5, not 0xbaf4b…f8b5\)\.$/],
  ])("%s problem: says what's wrong plainly, with 'Don't release'", async (id, re) => {
    const c = await card(id);
    expect(c.result.tone).toBe("problem");
    expect(c.result.headline).toMatch(re);
  });
  it("every one of the 20 cards: sanctions never claimed (no list shipped), freeze only where recorded, never 'safe'", async () => {
    for (const s of scenarios()) {
      const c = await card(s.id);
      expect(c.checks.sanctions.state, s.id).toBe("not_run");
      expect(c.checks.freeze.state, s.id).toBe(["SCN-01", "SCN-19"].includes(s.id) ? "passed" : "not_run");
      expect([c.result.headline, ...c.result.lines].join(" "), s.id).not.toMatch(/safe/i);
      if (c.result.tone !== "problem") expect(c.result.lines.join(" "), s.id).toContain("Sender NOT checked.");
    }
  });
  it("the freeze fixture really covers the demo transfer's sender and receiver", () => {
    expect(freezeFixtureCovers(FREEZE_FIXTURE["ETH-01.json"], "0x8afcf06919e6719bec706696c5ccb3dde40b4377", "0x6f416e24bab64ea58bd6390bb5e19c6506a0d99c")).toBe(true);
    expect(freezeFixtureCovers(FREEZE_FIXTURE["ETH-01.json"], "0x8afcf06919e6719bec706696c5ccb3dde40b4377", "0x02c3401fdd8c80e8bb9576f30e51234007bcaf8b")).toBe(false);
  });
});

describe("S1b notification preview: quiet by default", () => {
  it("no message for a not-final step; one for paid-and-final and for a problem", async () => {
    expect(notificationFor(await card("SCN-01", { asOfConfirmations: 3 }))).toBeNull();
    expect(notificationFor(await card("SCN-01"))).toBeNull(); // finality not checked: not "paid", so quiet
    const r = await replay("SCN-01");
    expect(notificationFor(await cardFor(r, { finalizedBlock: r.facts!.tx!.blockNumber }))?.subject).toBe("Paid and final: SAMPLE-INV-2001 (331.40 USDT, SAMPLE-CUST-01)");
    const short = notificationFor(await card("SCN-07"))!;
    expect(short.slack).toMatch(/^Don't release · SAMPLE-INV-2007/);
    expect(short.subject).toMatch(/^Don't release: SAMPLE-INV-2007/);
    expect([short.subject, short.slack, ...short.body].join(" ")).not.toMatch(/release yet/);
  });
  it("the watcher previews a message only on paid-and-final or problem steps, never on every block", async () => {
    const steps = await watchTimeline(DEMO_WATCH_ID);
    expect(steps.length).toBeGreaterThanOrEqual(6);
    for (const s of steps) expect(!!s.notify, s.card.scenarioId).toBe(s.card.result.tone !== "not_yet");
    expect(steps.filter((s) => !s.notify).length).toBeGreaterThan(0);
    expect(steps.slice(0, 3).map((s) => [s.card.scenarioId, s.card.result.tone])).toEqual([["TRON-01", "not_yet"], ["TRON-01", "not_yet"], ["TRON-01", "paid"]]);
  });
});

describe("demo watcher: demo only, can't be pointed at a real address, no live calls", () => {
  it.each(["0x6f416e24bab64ea58bd6390bb5e19c6506a0d99c", "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", "", "demo-replay-2"])("refuses %j", async (t) => {
    await expect(watchTimeline(t)).rejects.toThrow("can't watch a real address");
  });
  it("its only target is not an address on any network", () => {
    expect(DEMO_WATCH_ID).not.toMatch(/^(0x)?[0-9a-fA-F]{40}$|^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(DEMO_WATCH_LABEL).toBe("Demo: replaying recorded transfers");
  });
  it("replaying all 20 transfers and the timeline never calls fetch", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const s of scenarios()) await replay(s.id);
    await watchTimeline(DEMO_WATCH_ID);
    expect(f).not.toHaveBeenCalled();
  });
  it("the replay transport serves only what was recorded", async () => {
    const t = replayOnly({ name: "X", hash: "0x", recordedAt: "2026-10-24T00:00:00Z", exchanges: [] });
    await expect(t({ method: "GET", url: "https://api.example.com/x" })).rejects.toThrow("Nothing was fetched");
  });
  it("is off in live mode and with DEMO_SLICES=off", () => {
    process.env.DEMO_MODE = "off"; expect(demoSlicesOn()).toBe(false);
    process.env.DEMO_MODE = "on"; process.env.DEMO_SLICES = "off"; expect(demoSlicesOn()).toBe(false);
    delete process.env.DEMO_SLICES; expect(demoSlicesOn()).toBe(true);
  });
  it("paste-a-hash knows only the recorded hashes and looks nothing up", () => {
    const h = scenarios()[0].transfer!.hash;
    expect(scenariosForHash(h.toUpperCase().replace("0X", "0x")).map((s) => s.id)).toContain("SCN-01");
    expect(scenariosForHash(h.slice(2)).length).toBeGreaterThan(0);
    expect(scenariosForHash(`0x${"1".repeat(64)}`)).toEqual([]);
    expect(scenariosForHash("0x6f416e24bab64ea58bd6390bb5e19c6506a0d99c")).toEqual([]);
  });
});

describe("S2: matched invoice, the same release checks, and the proposed entry from the existing posting plan", () => {
  it("leads with TRON-01, then Ethereum plans that are ready with payment lines; Dr clearing = Cr receivable = the plan's amount", async () => {
    const ids = await entryScenarios();
    expect(ids).toEqual(["TRON-01", "SCN-01", "SCN-02", "SCN-03", "SCN-04", "SCN-05", "SCN-11"]);
    for (const id of ids.slice(1)) {
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
  it("TRON-01: final, but no posting plan exists for Tron, so it says so instead of inventing an entry", async () => {
    const e = (await proposedEntry("TRON-01"))!;
    expect(e).toMatchObject({ approvable: true, status: "no_plan", rows: [] });
    expect(e.planReasons[0]).toBe("Clearline's posting plan covers Ethereum payments only today, so no Xero entry is prepared for this Tron payment.");
  });
  it("the page: checks right above Approve; Approve disabled with 'Waiting until final' when finality hasn't passed", async () => {
    const P = (await import("@/app/demo/entry/page")).default;
    const h = text(await html(await P({ searchParams: Promise.resolve({ s: "SCN-01" }) })));
    expect(h).toContain(WAITING_MESSAGE);
    expect(h).toMatch(/Checks\s+Final: NOT checked\s+Token: checked\s+Amount: checked\s+Sanctions \(US OFAC SDN only\): NOT checked\s+Freeze: checked/);
    expect(h).toContain("SGD: rate not applied in this demo.");
    expect(h).not.toMatch(/On-chain this is done/);
    const raw = await html(await P({ searchParams: Promise.resolve({ s: "SCN-01" }) }));
    expect(raw).toMatch(/<button[^>]*disabled=""[^>]*data-testid="approve-demo"/);
  });
  it("Approve sends nothing: no network or server call in the component, and it says so", () => {
    const src = readFileSync(path.join(__dirname, "..", "src/components/demo-slices/ApproveDemo.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|"use server"|action=/);
    expect(APPROVED_MESSAGE).toBe("Live, this would now post to Xero. Demo: nothing sent.");
    expect(APPROVER).toBe("Mei Tan (sample user)");
  });
});

describe("plain labels: chips, summary, status, times", () => {
  it("not-run checks are amber warnings, and the summary is computed", async () => {
    const c = await card("SCN-01");
    const chips = checkChips(c.checks);
    expect(chips.filter((x) => x.word === "NOT checked").every((x) => x.tone === "warn")).toBe(true);
    expect(ranSummary(c.checks, c.result.tone)).toBe("3 of 5 checks ran. 2 did not — release is your call.");
    expect(ranSummary((await card("SCN-07")).checks, "problem")).toMatch(/^\d of 5 checks ran\. \d did not\.$/);
    expect(statusLabel(c.checks, c.result.tone)).toBe("Finality not checked");
    expect(statusLabel((await card("TRON-01", { asOfConfirmations: 2 })).checks, "not_yet")).toBe("Not final yet");
  });
  it("wrong network chip names both networks", async () => {
    const c = await card("SCN-14");
    expect(checkChips(c.checks, { wrongNetwork: c.wrongNetwork }).find((x) => x.key === "token")).toMatchObject({ label: "Network", word: "problem (Tron, invoice says Ethereum)", tone: "fail" });
  });
  it("sanctions line names the one list and says others aren't checked; times are SGT, never ISO", async () => {
    const c = await card("TRON-01");
    expect(c.result.lines).toContain("No copy of the US OFAC SDN list is loaded, so the sender wasn't checked. Other lists are not checked.");
    expect(c.result.lines.join(" ")).not.toMatch(/\d{4}-\d\d-\d\dT/);
    expect(c.result.lines.join(" ")).toMatch(/2 Nov 2026, \d\d:\d\d SGT/);
  });
});

describe("rendered pages: labelled, and never the word 'safe'", () => {
  const pages = async () => ({
    release: (await import("@/app/demo/release/page")).default,
    notify: (await import("@/app/demo/notify/page")).default,
    entry: (await import("@/app/demo/entry/page")).default,
  });
  const cases: [keyof Awaited<ReturnType<typeof pages>>, Record<string, string>][] = [
    ["release", {}], ["release", { at: "3", paused: "1" }], ["release", { hash: "nope" }], ["release", { hash: `0x${"1".repeat(64)}` }],
    ...scenarios().map((s) => ["release", { s: s.id }] as [keyof Awaited<ReturnType<typeof pages>>, Record<string, string>]),
    ["notify", {}], ["notify", { s: "TRON-01", wait: "4" }], ["release", { s: "TRON-01" }], ["notify", { s: "SCN-16" }], ["entry", {}], ["entry", { s: "SCN-07" }],
  ];
  it.each(cases)("%s %j", async (name, q) => {
    const P = (await pages())[name] as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
    const h = text(await html(await P({ searchParams: Promise.resolve(q) })));
    expect(h).not.toMatch(/safe/i);
    expect(h).toContain(DEMO_WATCH_LABEL);
    expect(h).toContain(TRANSFER_LABEL);
    if (name === "notify" && !q.wait) expect(h).toContain("Preview — nothing is sent");
    if (name === "notify" && !q.s && !q.wait) expect(h).toContain("Paid and final: SAMPLE-INV-T001");
    if (name === "notify" && q.wait) expect(h).toContain("No message for this update.");
    if (name === "entry") { expect(h).toContain("Approve"); expect(h).toContain("Proposed Xero entry"); }
  });
  it("the watcher's every step renders without 'safe', and the not-final step says 'Final: not yet'", async () => {
    const { Watcher } = await import("@/components/demo-slices/Watcher");
    const steps = await watchTimeline(DEMO_WATCH_ID);
    for (let i = 1; i <= steps.length; i++) {
      const h = text(await html(createElement(Watcher, { steps, label: DEMO_WATCH_LABEL, initial: i, autoplay: false })));
      expect(h, `step ${i}`).not.toMatch(/safe/i);
      if (i === 1) expect(h).toContain("Final: not yet");
    }
  });
  it("in live mode the pages are a 404", async () => {
    process.env.DEMO_MODE = "off";
    const { release } = await pages();
    await expect(release({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    process.env.DEMO_MODE = "on";
  });
});
