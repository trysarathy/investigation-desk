// Demo slices S1 / S1b / S2 and the demo watcher (DEMO ONLY): wording per state, quiet-by-default
// messages, no "safe" anywhere on the rendered pages, a watcher that can't take a real address,
// no live chain call, and an Approve that sends nothing. All on the 20 replayed real transfers.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planPosting } from "@/lib/accounting/rules";
import { APPROVED_MESSAGE, entryScenarios, proposedEntry } from "@/lib/demo-slices/entry";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { card, DEMO_WATCH_ID, DEMO_WATCH_LABEL, notificationFor, watchTimeline } from "@/lib/demo-slices/release";
import { releaseHeadline, type ReleaseChecks } from "@/lib/demo-slices/release-adapter";
import { replay, replayOnly, scenarios, scenariosForHash, TRANSFER_LABEL } from "@/lib/demo-slices/replay";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/demo/release",
  useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("redirect"); } }));

const html = async (el: ReactNode) => { const s = await renderToReadableStream(el); await s.allReady; return (await new Response(s).text()).replace(/&#x27;/g, "'").replace(/&quot;/g, '"'); };
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
const env = { demo: process.env.DEMO_MODE, slices: process.env.DEMO_SLICES };
beforeAll(() => { process.env.DEMO_MODE = "on"; delete process.env.DEMO_SLICES; });
afterAll(() => { process.env.DEMO_MODE = env.demo; process.env.DEMO_SLICES = env.slices; });
afterEach(() => vi.restoreAllMocks());

describe("S1 release card: wording per state (only checks that ran)", () => {
  it("paid and final, with sanctions and freeze not run: says the sender was NOT checked", async () => {
    const c = await card("SCN-01");
    expect(c.result.tone).toBe("paid");
    expect(c.result.headline).toBe("Paid and final. Right token and amount. Sender NOT checked.");
    expect(c.checks.sanctions.state).toBe("not_run");
    expect(c.checks.freeze.state).toBe("not_run");
  });
  it("not final yet: says so, with the network's usual pace as a pace, not a promise", async () => {
    const c = await card("SCN-01", { asOfConfirmations: 4 });
    expect(c.result).toMatchObject({ tone: "not_yet", headline: "Not final yet." });
    expect(c.result.lines.join(" ")).toMatch(/4 of the 12 blocks.*Ethereum usually takes about 2 minutes; that's a usual pace, not a promise/);
  });
  it.each([
    ["SCN-07", /^Short by 8\.74181 USDT: .* Don't release yet\.$/],
    ["SCN-08", /^Only 0\.001 of 250\.00 USDT arrived\. Don't release yet\.$/],
    ["SCN-12", /^Look-alike token: it calls itself USDT but isn't Tether's contract\. Don't release yet\.$/],
    ["SCN-13", /^Wrong token: ".+" is not USDT, and isn't Tether's contract\. Don't release yet\.$/],
    ["SCN-14", /^Sent on Tron, not Ethereum.*Don't release yet\.$/],
    ["SCN-15", /^Sent on BNB Chain, not Ethereum.*Don't release yet\.$/],
    ["SCN-16", /^Not paid to this invoice: it went to a look-alike address \(0xbaff2…f8b5, not 0xbaf4b…f8b5\)\. Don't release yet\.$/],
  ])("%s problem: says what's wrong plainly and 'Don't release yet'", async (id, re) => {
    const c = await card(id);
    expect(c.result.tone).toBe("problem");
    expect(c.result.headline).toMatch(re);
  });
  it("every one of the 20 cards: sanctions and freeze never claimed, no jargon in the headline", async () => {
    for (const s of scenarios()) {
      const c = await card(s.id);
      expect(c.checks.sanctions.state, s.id).toBe("not_run");
      expect(c.checks.freeze.state, s.id).toBe("not_run");
      expect(c.result.headline, s.id).not.toMatch(/finaliz|confirmation|safe/i);
      if (c.result.tone === "paid") expect(c.result.headline, s.id).toContain("Sender NOT checked.");
    }
  });
  it("adapter: only when both sender checks passed does it say so; a failed one is a problem", () => {
    const ok = { state: "passed" as const, detail: "ok." };
    const all: ReleaseChecks = { finality: ok, token: ok, amount: ok, sanctions: ok, freeze: ok };
    expect(releaseHeadline(all).headline).toBe("Paid and final. Right token and amount. Sender not on public sanctions lists. Not frozen.");
    const hit = releaseHeadline({ ...all, sanctions: { state: "failed", detail: "Sender is on the public sanctions list." } });
    expect(hit).toMatchObject({ tone: "problem", headline: "Sender is on the public sanctions list. Don't release yet." });
  });
});

describe("S1b notification preview: quiet by default", () => {
  it("no message for a not-final step; one for paid-and-final and for a problem", async () => {
    expect(notificationFor(await card("SCN-01", { asOfConfirmations: 3 }))).toBeNull();
    expect(notificationFor(await card("SCN-01"))?.subject).toBe("Paid and final: SAMPLE-INV-2001 (331.40 USDT, SAMPLE-CUST-01)");
    expect(notificationFor(await card("SCN-07"))?.slack).toMatch(/^Don't release yet · SAMPLE-INV-2007/);
  });
  it("the watcher previews a message only on paid-and-final or problem steps, never on every block", async () => {
    const steps = await watchTimeline(DEMO_WATCH_ID);
    expect(steps.length).toBeGreaterThanOrEqual(6);
    for (const s of steps) expect(!!s.notify, s.card.scenarioId).toBe(s.card.result.tone !== "not_yet");
    expect(steps.filter((s) => !s.notify).length).toBeGreaterThan(0);
    expect(steps.map((s) => s.card.result.tone).slice(0, 3)).toEqual(["not_yet", "not_yet", "paid"]);
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

describe("S2: matched invoice and the proposed entry, from the existing posting plan", () => {
  it("shows only scenarios whose plan is ready with payment lines; Dr clearing = Cr receivable = the plan's amount", async () => {
    const ids = await entryScenarios();
    expect(ids).toEqual(["SCN-01", "SCN-02", "SCN-03", "SCN-04", "SCN-05", "SCN-11"]);
    for (const id of ids) {
      const e = (await proposedEntry(id))!;
      const r = await replay(id);
      const acct = { version: 1 as const, provider: "demo" as const, accounts: { walletAccountCode: "SAMPLE-CLR", feeAccountCode: "SAMPLE-SHORTFALL" }, audit: [],
        links: { [r.invoice.id]: { provider: "demo" as const, invoiceId: r.invoice.id, invoiceNumber: r.invoice.id, contactName: r.invoice.customer_ref, currency: "USD", amountDue: r.invoice.amount, linkedAt: r.invoice.created_at, demo: true } } };
      const plan = planPosting(r.data, acct, r.invoice.id, { threshold: 12 });
      expect(e.rows.filter((x) => x.dr).map((x) => x.dr)).toEqual(plan.lines.map((l) => l.amount));
      expect(e.rows.filter((x) => x.cr).map((x) => x.cr)).toEqual(plan.lines.map((l) => l.amount));
      expect(e.rows[0]).toMatchObject({ account: "Stablecoin clearing (sample account)", code: "SAMPLE-CLR" });
      expect(e.label).toBe(TRANSFER_LABEL);
    }
  });
  it("Approve sends nothing: no network or server call in the component, and it says so", () => {
    const src = readFileSync(path.join(__dirname, "..", "src/components/demo-slices/ApproveDemo.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|"use server"|action=/);
    expect(APPROVED_MESSAGE).toBe("Would post to Xero after approval (demo: not sent).");
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
    ["notify", {}], ["notify", { s: "SCN-01", wait: "4" }], ["notify", { s: "SCN-16" }], ["entry", {}], ["entry", { s: "SCN-07" }],
  ];
  it.each(cases)("%s %j", async (name, q) => {
    const P = (await pages())[name] as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
    const h = text(await html(await P({ searchParams: Promise.resolve(q) })));
    expect(h).not.toMatch(/safe/i);
    expect(h).toContain(DEMO_WATCH_LABEL);
    expect(h).toContain(TRANSFER_LABEL);
    if (name === "notify" && !q.wait) expect(h).toContain("Preview — nothing is sent");
    if (name === "notify" && q.wait) expect(h).toContain("Quiet: no message for this step.");
    if (name === "entry") { expect(h).toContain("Approve"); expect(h).toContain("Proposed Xero entry"); }
  });
  it("the watcher's every step renders without 'safe', and the not-final step says 'Final: Not yet'", async () => {
    const { Watcher } = await import("@/components/demo-slices/Watcher");
    const steps = await watchTimeline(DEMO_WATCH_ID);
    for (let i = 1; i <= steps.length; i++) {
      const h = text(await html(createElement(Watcher, { steps, label: DEMO_WATCH_LABEL, initial: i, autoplay: false })));
      expect(h, `step ${i}`).not.toMatch(/safe/i);
      if (i === 1) expect(h).toContain("Final: Not yet.");
    }
  });
  it("in live mode the pages are a 404", async () => {
    process.env.DEMO_MODE = "off";
    const { release } = await pages();
    await expect(release({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    process.env.DEMO_MODE = "on";
  });
});
