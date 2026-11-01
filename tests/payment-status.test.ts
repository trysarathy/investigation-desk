// Task 6a: one plain-English status sentence and an honest ETA per payment (src/lib/requests/status.ts).
// ETA sources: ethereum.org PoS docs (12-second slots) and TRON docs dpos.md (3-second slots); the code
// waits for 12 confirmations on Ethereum (not Ethereum "finalized", POSTING_RULES R5 / plan D5.5), so a
// sentence may say "confirmed", never "final". BNB Chain: no ETA (see status.ts).

import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr, demoPublicId, lookalikeOf, resetDemo } from "@/lib/requests/demo";
import { createRequest, decide, deriveRequest, ingest, recordAddressCheck } from "@/lib/requests/lifecycle";
import { nextAction, verdict } from "@/lib/requests/present";
import { SimulatedProvider } from "@/lib/requests/provider";
import { confirmEta, paymentStatus } from "@/lib/requests/status";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const sim = new SimulatedProvider();
const JARGON = /\bblock|hash|contract|\bgas\b|on-chain|confirmations|finali[sz]|\bfinal\b|automatically|wallet/i;

function req(o: { amount?: string; demo?: boolean; auto?: boolean } = {}): RequestsData {
  return createRequest(emptyRequests(), { customerRef: "Cust L1", invoiceRef: "INV-L1", amount: o.amount ?? "1250", receivingAddress: addr("l1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: o.demo ?? false, publicId: "L1", tokenContract: OFFICIAL_USDC, id: "L1", autoMarkPaid: o.auto }).data;
}
function pay(d: RequestsData, ev: Partial<TransferEvent>, seq = "a"): RequestsData {
  const base = sim.send(d, { to: addr("l1"), amount: "1250.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:l1"), seq });
  return ingest(d, { ...base, demo: d.requests.L1.demo, ...ev }, NOW, "test", checkObservation(NOW), CONFIRMATIONS).data;
}
const statusOf = (d: RequestsData, id = "L1", o?: { chainUnreadable?: boolean }) => paymentStatus(d, deriveRequest(d, d.requests[id], CONFIRMATIONS), o);

describe("ETA math: from documented block timing and the confirmations the code waits for", () => {
  it("Ethereum: 12-second slots × confirmations still needed, rounded up to whole minutes", () => {
    expect(confirmEta("ethereum", 0, 12)).toMatchObject({ seconds: 144, minutes: 3 });
    expect(confirmEta("ethereum", 6, 12)).toMatchObject({ seconds: 72, minutes: 2 });
    expect(confirmEta("ethereum", 11, 12)).toMatchObject({ seconds: 12, minutes: 1 });
    expect(confirmEta("ethereum", 0, 12)!.basis).toMatch(/12-second slots.*ethereum\.org/);
  });
  it("Tron: 3-second slots (TRON docs), 20 confirmations → about a minute", () => {
    expect(confirmEta("tron", 0, 20)).toMatchObject({ seconds: 60, minutes: 1 });
  });
  it("no ETA when it can't be computed: already confirmed, BNB Chain, an unknown network", () => {
    expect(confirmEta("ethereum", 12, 12)).toBeNull();
    expect(confirmEta("bsc", 0, 15)).toBeNull();
    expect(confirmEta("polygon", 0, 12)).toBeNull();
  });
});

describe("status per state", () => {
  it("waiting for payment", () => {
    const s = statusOf(req());
    expect(s).toMatchObject({ key: "waiting", etaMinutes: null, sentence: "Waiting for payment: nothing has arrived yet." });
  });

  it("seen, not yet in a block: confirming with no ETA (inclusion time isn't predictable)", () => {
    const s = statusOf(pay(req(), { confirmations: 0 }));
    expect(s.key).toBe("seen");
    expect(s.etaMinutes).toBeNull();
    expect(s.sentence).toBe("Payment seen and confirming: we can't estimate how long yet, and there's nothing to do.");
  });

  it("confirming (demo, simulated Ethereum): ETA from 12 − confirmations, says 'confirmed', never 'final'", () => {
    const s = statusOf(pay(req({ demo: true }), { blockNumber: 100, blockTime: NOW, confirmations: 6 }));
    expect(s).toMatchObject({ key: "confirming", etaMinutes: 2 });
    expect(s.sentence).toBe("Confirming: about 2 minutes until it's confirmed, and there's nothing to do yet.");
    expect(s.sentence).not.toMatch(/final/i);
  });

  it("confirming, live transfer: no ETA, because live transfers only update when looked up again", () => {
    const s = statusOf(pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: 3 }));
    expect(s).toMatchObject({ key: "confirming", etaMinutes: null });
    expect(s.sentence).toBe("Confirming: look the payment up again to see whether it's confirmed.");
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

  it("couldn't check (provider down): says so, promises no time", () => {
    const s = statusOf(pay(req(), { source: "live", blockNumber: 100, blockTime: NOW, confirmations: CONFIRMATIONS }), "L1", { chainUnreadable: true });
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
  it("counterfeit, wrong network, look-alike, duplicate, suggested match, short", () => {
    expect(by("DEMO-1043")).toMatchObject({ key: "counterfeit", sentence: "Not real USDT, so it can't pay this invoice: tell the customer and close the payment." });
    expect(by("DEMO-1044")).toMatchObject({ key: "wrong_network", sentence: "Sent on Tron, not Ethereum, to the business's own Tron address: ask treasury to confirm it arrived, then count it." });
    expect(by("DEMO-1046")).toMatchObject({ key: "lookalike", sentence: "A look-alike address was stopped before the customer paid: warn them to copy the address from the payment page." });
    expect(by("DEMO-1047")).toMatchObject({ key: "duplicate", sentence: "Paid twice, 1,980.00 USDC extra: refund the duplicate or keep it as credit." });
    expect(by("DEMO-1045")).toMatchObject({ key: "suggested", sentence: "A payment that's probably this one arrived at another address: confirm the match." });
    expect(by("DEMO-1042").key).toBe("short");
  });
  it("every sentence is one sentence, plain words, and every ETA is a whole number of minutes or null", () => {
    for (const r of Object.values(d.requests)) {
      const s = by(r.id);
      expect(s.sentence, r.id).toMatch(/^[A-Z].*\.$/);
      expect(s.sentence, r.id).not.toMatch(/\.\s/);
      expect(s.sentence.replace(/demo's matching rule/, ""), r.id).not.toMatch(JARGON);
      expect(s.etaMinutes === null || Number.isInteger(s.etaMinutes), r.id).toBe(true);
      expect(s.nextAction.length, r.id).toBeGreaterThan(0);
      // The rest of the page agrees: confirmations are "confirmed", never "final"; no "about about".
      const v = deriveRequest(d, r, CONFIRMATIONS);
      expect(`${verdict(d, v).points.join(" ")} ${nextAction(v, d).detail}`, r.id).not.toMatch(/final for practical|about about/);
    }
  });
});
