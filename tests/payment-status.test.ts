// Task 6a: one plain-English status sentence per payment (src/lib/requests/status.ts). No countdown:
// payments don't re-check on their own yet, so etaMinutes is always null; the documented pace (Ethereum
// 12-second slots, ethereum.org source; Tron 3-second slots, TRON docs dpos.md) is stated as a pace.
// The code waits for 12 confirmations, not Ethereum "finalized" (POSTING_RULES R5 / plan D5.5), so a
// sentence may say "confirmed", never "final". BNB Chain: no pace (see status.ts).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr, demoPublicId, lookalikeOf, resetDemo } from "@/lib/requests/demo";
import { createRequest, decide, deriveRequest, ingest, recordAddressCheck } from "@/lib/requests/lifecycle";
import { nextAction, replyDraft, verdict } from "@/lib/requests/present";
import { SimulatedProvider } from "@/lib/requests/provider";
import { confirmPace, paymentStatus } from "@/lib/requests/status";
import { emptyRequests, type CheckSnapshot, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const sim = new SimulatedProvider();
const JARGON = /\bblock|hash|contract|\bgas\b|on-chain|confirmations|finali[sz]|\bfinal\b|automatically|wallet/i;

function req(o: { amount?: string; demo?: boolean; auto?: boolean } = {}): RequestsData {
  return createRequest(emptyRequests(), { customerRef: "Cust L1", invoiceRef: "INV-L1", amount: o.amount ?? "1250", receivingAddress: addr("l1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: o.demo ?? false, publicId: "L1", tokenContract: OFFICIAL_USDC, id: "L1", autoMarkPaid: o.auto }).data;
}
function pay(d: RequestsData, ev: Partial<TransferEvent>, seq = "a", check = checkObservation(NOW)): RequestsData {
  const base = sim.send(d, { to: addr("l1"), amount: "1250.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:l1"), seq });
  return ingest(d, { ...base, demo: d.requests.L1.demo, ...ev }, NOW, "test", check, CONFIRMATIONS).data;
}
const statusOf = (d: RequestsData, id = "L1") => paymentStatus(d, deriveRequest(d, d.requests[id], CONFIRMATIONS));
/** What check.ts stores when a chain didn't answer. */
const paused = (): CheckSnapshot => ({ at: NOW, code: null, label: "Check paused", confidence: null, problem: false, summary: "A chain didn't answer (ethereum).", evidence: [] });
/** Not jargon, but "rule" phrasing reserved for the demo. */
const ALLOWED = /demo's matching rule/g;

describe("pace, not countdown: from one source of block times and the confirmations the code waits for", () => {
  it("Ethereum: 12 confirmations × 12-second slots = 144 s, worded as formatDuration does for the next step", () => {
    expect(confirmPace("ethereum")).toBe("about 2 minutes");
  });
  it("Tron: 20 confirmations × 3-second slots = 60 s", () => {
    expect(confirmPace("tron")).toBe("about a minute");
  });
  it("no pace where it isn't documented: BNB Chain (BEP-619 0.45 s vs the 3 s setting), an unknown network", () => {
    expect(confirmPace("bsc")).toBeNull();
    expect(confirmPace("polygon")).toBeNull();
  });
});

describe("status per state", () => {
  it("waiting for payment", () => {
    const s = statusOf(req());
    expect(s).toMatchObject({ key: "waiting", etaMinutes: null, sentence: "Waiting for payment: nothing has arrived yet, so there's nothing to do until the customer pays." });
  });

  it("seen, not yet in a block: no pace (inclusion time isn't predictable)", () => {
    const s = statusOf(pay(req(), { confirmations: 0 }));
    expect(s).toMatchObject({ key: "seen", etaMinutes: null });
    expect(s.sentence).toBe("Payment seen, waiting for the network to pick it up: nothing to do yet.");
  });

  it("confirming (demo): Ethereum's usual pace, not a countdown, and says what moves demo blocks", () => {
    const d = pay(req({ demo: true, amount: "2500" }), { blockNumber: 100, blockTime: NOW, confirmations: 6 });
    const s = statusOf(d);
    expect(s).toMatchObject({ key: "confirming", etaMinutes: null });
    expect(s.sentence).toBe("Confirming (6 of 12): Ethereum usually takes about 2 minutes; in the demo, it moves on when you click.");
    expect(s.sentence).not.toMatch(/final|until it's confirmed/i);
    // The next step quotes the same time from the same source: they can't disagree.
    expect(nextAction(deriveRequest(d, d.requests.L1, CONFIRMATIONS)).detail).toContain(`(${confirmPace("ethereum")} on Ethereum)`);
  });

  it("confirming with part of the payment not yet in a block: no pace at all", () => {
    let d = pay(req({ demo: true, amount: "2500" }), { blockNumber: 100, blockTime: NOW, confirmations: 6 });
    d = pay(d, { confirmations: 0 }, "b");
    expect(statusOf(d)).toMatchObject({ key: "seen", etaMinutes: null });
  });

  it("confirming, live transfer: pace, plus look it up again (live transfers only update then)", () => {
    const s = statusOf(pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: 3 }));
    expect(s).toMatchObject({ key: "confirming", etaMinutes: null });
    expect(s.sentence).toBe("Confirming (3 of 12 at the last check): Ethereum usually takes about 2 minutes; look the payment up again to update it.");
  });

  it("confirmed and checked, ready to mark paid (live): 'confirmed', not 'final', not 'paid automatically'", () => {
    const s = statusOf(pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }));
    expect(s).toMatchObject({ key: "ready", etaMinutes: null, sentence: "Confirmed and checked for the exact amount: mark it paid." });
  });

  it("matched and paid, by a person", () => {
    let d = pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS });
    d = decide(d, "L1", { kind: "acknowledge", note: "" }, { now: NOW, by: "Mei Tan", threshold: CONFIRMATIONS, check: checkObservation(NOW) }).data!;
    expect(statusOf(d)).toMatchObject({ key: "paid", sentence: "Paid: Mei Tan marked it paid, so there's nothing to do." });
  });

  it("matched and paid by the demo's rule: says demo, and only then", () => {
    const d = pay(req({ demo: true, auto: true }), { blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS });
    expect(statusOf(d)).toMatchObject({ key: "paid", sentence: "Paid: the demo's matching rule marked it paid, so there's nothing to do." });
  });

  it("short", () => {
    const s = statusOf(pay(req(), { amount: "1200.00", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }));
    expect(s).toMatchObject({ key: "short", sentence: "Short by 50.00 USDC: ask the customer for the rest, or accept it as settled." });
  });

  it("over", () => {
    const s = statusOf(pay(req(), { amount: "1300.00", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }));
    expect(s).toMatchObject({ key: "over", sentence: "Overpaid by 50.00 USDC: refund the extra or keep it as credit." });
  });

  it("wrong token", () => {
    const s = statusOf(pay(req(), { tokenContract: addr("dai"), tokenSymbol: "DAI", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }));
    expect(s).toMatchObject({ key: "wrong_token", sentence: "Paid in DAI, not USDC, so it can't pay this invoice: tell the customer and close the payment." });
  });

  it("couldn't check (a stored 'Check paused' result): says so, promises no time", () => {
    const s = statusOf(pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }, "a", () => paused()));
    expect(s).toMatchObject({ key: "unchecked", etaMinutes: null });
    expect(s.sentence).toBe("We couldn't check this payment because the network didn't answer, so nothing is decided yet: look it up again later.");
    expect(s.sentence).not.toMatch(/\d|minute|soon/);
  });
});

describe("the demo day: every case gets one plain sentence", () => {
  const day = resetDemo(emptyRequests(), NOW, demoPublicId);
  // Fernhill's sender pastes a poisoned address into the payment page (the demo's case f).
  const d = recordAddressCheck(day, "DEMO-1046", lookalikeOf(day.requests["DEMO-1046"].receivingAddress), NOW).data;
  const by = (id: string) => statusOf(d, id);
  it("a confirming request on the day: one sentence, pace only, and the page's own copy has no 'final' or 'about about'", () => {
    const c = pay(req({ demo: true }), { blockNumber: 100, blockTime: NOW, confirmations: 0 });
    const v = deriveRequest(c, c.requests.L1, CONFIRMATIONS);
    expect(paymentStatus(c, v).sentence.replace(ALLOWED, "")).not.toMatch(JARGON);
    const words = `${verdict(c, v).summary} ${nextAction(v, c).detail} ${replyDraft(v, c, { business: "Northwind", link: "https://x" })}`;
    expect(words).toMatch(/about 2 minutes/);
    expect(words).not.toMatch(/final for practical|about about/);
  });
  it("counterfeit, wrong network, look-alike, duplicate, suggested match, short", () => {
    expect(by("DEMO-1043")).toMatchObject({ key: "counterfeit", sentence: "Not real USDT, so it can't pay this invoice: tell the customer and close the payment." });
    expect(by("DEMO-1044")).toMatchObject({ key: "wrong_network", sentence: "Sent on Tron, not Ethereum, to the business's own Tron address: ask treasury to confirm it arrived, then count it." });
    expect(by("DEMO-1046")).toMatchObject({ key: "lookalike", sentence: "A look-alike address was stopped before the customer paid: warn them to copy the address from the payment page." });
    expect(by("DEMO-1047")).toMatchObject({ key: "duplicate", sentence: "Paid twice, 1,980.00 USDC extra: refund the duplicate or keep it as credit." });
    expect(by("DEMO-1045")).toMatchObject({ key: "suggested", sentence: "A payment that's probably this one arrived at another address: confirm the match." });
    expect(by("DEMO-1042").key).toBe("short");
  });
  it("waiting, when the next step has an action: the sentence says it (Fernhill will reuse an old address)", () => {
    const s = statusOf(day, "DEMO-1046");
    expect(s).toMatchObject({ key: "waiting", sentence: "Waiting for payment, and Fernhill Foods says they'll reuse an old address: make sure they check it on the payment page before sending." });
    expect(nextAction(deriveRequest(day, day.requests["DEMO-1046"], CONFIRMATIONS), day).title).toMatch(/reuse an old address: make sure they check it/);
  });
  it("every sentence is one sentence, plain words, and every ETA is a whole number of minutes or null", () => {
    for (const r of Object.values(d.requests)) {
      const s = by(r.id);
      expect(s.sentence, r.id).toMatch(/^[A-Z].*\.$/);
      expect(s.sentence, r.id).not.toMatch(/\.\s/);
      expect(s.sentence.replace(ALLOWED, ""), r.id).not.toMatch(JARGON);
      expect(s.etaMinutes, r.id).toBeNull();
      expect(s.nextAction.length, r.id).toBeGreaterThan(0);
      // The rest of the page agrees: confirmations are "confirmed", never "final"; no "about about".
      const v = deriveRequest(d, r, CONFIRMATIONS);
      expect(`${verdict(d, v).points.join(" ")} ${nextAction(v, d).detail}`, r.id).not.toMatch(/final for practical|about about/);
    }
  });
});

describe("request page source", () => {
  it("the confirmations tooltip no longer calls 12 confirmations final", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "src/app/requests/[id]/page.tsx"), "utf8");
    expect(src).not.toMatch(/final for practical purposes/);
    expect(src).toMatch(/counts it as confirmed; Ethereum's own finality check is not used yet/);
  });
});
