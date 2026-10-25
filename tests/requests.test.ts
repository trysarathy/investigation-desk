// Payment requests: lifecycle, matching, duplicates, ambiguity, marking paid, the demo week's seven
// cases, reset and persistence. Every transfer here is synthetic and goes through the real
// ingestion code.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC, OFFICIAL_USDT } from "@/lib/requests/check";
import { addr, COUNTERFEIT_USDT, demoAdvance, demoMine, demoRedeliver, demoSend, lookalikeOf, resetDemo } from "@/lib/requests/demo";
import {
  AUTO_RULE, amountToSend, assignUnmatched, compareAddress, createRequest, decide, deriveRequest, formatUsdc, ingest, normaliseAmount, percentOf,
  recordAddressCheck, suggestMatches, toBaseUnits, unattributed, validateRequest,
} from "@/lib/requests/lifecycle";
import { eip681, nextAction, refundInstruction, replyDraft, verdict } from "@/lib/requests/present";
import { SimulatedProvider } from "@/lib/requests/provider";
import { FileRequestsStore } from "@/lib/requests/store";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";
import { glance } from "@/lib/requests/ui";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const pid = (id: string) => `pub-${id}`;
const day = () => resetDemo(emptyRequests(), NOW, pid);
const view = (d: RequestsData, id: string) => deriveRequest(d, d.requests[id], CONFIRMATIONS);
const sim = new SimulatedProvider();
const opts = { business: "Northwind Pay Pte Ltd" };

/** A real (non-demo) request, no auto-mark rule unless asked. */
const real = (d: RequestsData, id: string, amount: string, address: string, o: { at?: string; token?: "USDC" | "USDT"; auto?: boolean; customer?: string } = {}) =>
  createRequest(d, { customerRef: o.customer ?? `Cust ${id}`, invoiceRef: `INV-${id}`, amount, receivingAddress: address, token: o.token ?? "USDC" },
    { now: o.at ?? t(0), by: "Mei", demo: false, publicId: id, tokenContract: o.token === "USDT" ? OFFICIAL_USDT : OFFICIAL_USDC, id, autoMarkPaid: o.auto }).data;
/** A live-like (non-demo) transfer event, confirmed unless said otherwise. */
const tx = (to: string, amount: string, seq: string, o: Partial<TransferEvent> = {}): TransferEvent =>
  ({ ...sim.send(emptyRequests(), { to, amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr(`from:${seq}`), seq }),
    source: "live", demo: false, blockNumber: 900, blockTime: t(5), confirmations: CONFIRMATIONS, ...o });
const put = (d: RequestsData, ev: TransferEvent, at = t(6)) => ingest(d, ev, at, "test", checkObservation(at), CONFIRMATIONS).data;

describe("routine payment", () => {
  it("detected → confirming → matched; without the auto rule only a person marks it paid", () => {
    let d = real(emptyRequests(), "R1", "1250", addr("r1"));
    const ev = { ...tx(addr("r1"), "1250.00", "a"), blockNumber: undefined, confirmations: 0 };
    d = put(d, ev);
    expect(view(d, "R1").state).toBe("transfer_detected");
    d = put(d, { ...ev, blockNumber: 900, confirmations: 3 });
    expect(view(d, "R1").state).toBe("confirming");
    expect(decide(d, "R1", { kind: "acknowledge", note: "" }, { now: t(7), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
    d = put(d, { ...ev, blockNumber: 900, confirmations: CONFIRMATIONS });
    expect(view(d, "R1").state).toBe("matched");
    expect(view(d, "R1").counted[0].checks.at(-1)?.code).toBe("D12"); // the engine: arrived on-chain, not credited
    const done = decide(d, "R1", { kind: "acknowledge", note: "" }, { now: t(8), by: "Mei", threshold: CONFIRMATIONS }).data;
    expect(view(done, "R1").state).toBe("completed");
    expect(done.requests.R1.activity.at(-1)?.actor).toBe("Mei");
  });

  it("with the auto rule an exact, confirmed payment is marked paid with no one touching it, and the rule is on record", () => {
    let d = real(emptyRequests(), "R1", "1250", addr("r1"), { auto: true });
    d = put(d, { ...tx(addr("r1"), "1250.00", "a"), confirmations: 3 });
    expect(view(d, "R1").state).toBe("confirming"); // never before the confirmations
    d = put(d, tx(addr("r1"), "1250.00", "a"));
    const v = view(d, "R1");
    expect(v.state).toBe("completed");
    expect(v.acknowledgedBy?.by).toBe(AUTO_RULE);
    expect(d.requests.R1.activity.at(-1)?.text).toMatch(/Marked paid automatically/);
  });

  it("the auto rule never marks paid a short, counterfeit or ambiguous payment", () => {
    let d = real(real(emptyRequests(), "S", "100", addr("s"), { auto: true }), "F", "100", addr("f"), { auto: true });
    d = put(d, tx(addr("s"), "99.00", "short"));
    d = put(d, { ...tx(addr("f"), "100.00", "fake"), tokenContract: COUNTERFEIT_USDT });
    expect(view(d, "S").state).toBe("needs_review");
    expect(view(d, "F").state).toBe("needs_review");
    expect(view(d, "F").blocked).toBe(true);
  });
});

describe("duplicates and confirmations", () => {
  it("the same transfer delivered again counts once", () => {
    let d = demoAdvance(demoMine(demoSend(day(), "a", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const before = view(d, "DEMO-1041");
    d = demoRedeliver(d, t(4), "DEMO-1041").data;
    const after = view(d, "DEMO-1041");
    expect(after.received).toBe(before.received);
    expect(after.state).toBe("completed");
    expect(d.requests["DEMO-1041"].activity.at(-1)?.kind).toBe("duplicate");
  });

  it("an older event never takes confirmations backwards", () => {
    let d = real(emptyRequests(), "R1", "10", addr("r1"));
    d = put(d, tx(addr("r1"), "10.00", "c", { confirmations: 8 }));
    d = put(d, tx(addr("r1"), "10.00", "c", { confirmations: 2 }));
    expect(Object.values(d.observations)[0].confirmations).toBe(8);
  });

  it("a second payment after it was marked paid reopens it as paid twice, with a refund instruction", () => {
    let d = real(emptyRequests(), "R1", "1980", addr("r1"), { auto: true });
    d = put(d, tx(addr("r1"), "1980.00", "one"), t(6));
    expect(view(d, "R1").state).toBe("completed");
    d = put(d, { ...tx(addr("r1"), "1980.00", "two"), confirmations: 2 }, t(10));
    expect(view(d, "R1").state).toBe("confirming"); // the duplicate is visible while it confirms
    d = put(d, tx(addr("r1"), "1980.00", "two"), t(11));
    const v = view(d, "R1");
    expect(v.state).toBe("needs_review");
    expect(v.duplicate).toBe(true);
    expect(refundInstruction(v)).toMatch(/Refund 1,980.00 USDC/);
    d = decide(d, "R1", { kind: "refund_excess", note: "Confirmed with the customer." }, { now: t(12), by: "Mei", threshold: CONFIRMATIONS }).data;
    expect(view(d, "R1").state).toBe("completed");
  });
});

describe("ambiguous matching", () => {
  it("two open requests on one address: no automatic match, never by amount; a person assigns it", () => {
    const shared = addr("shared");
    let d = real(real(emptyRequests(), "A", "500", shared), "B", "500", shared);
    d = put(d, tx(shared, "500.00", "amb"));
    expect([view(d, "A").state, view(d, "B").state]).toEqual(["needs_review", "needs_review"]);
    expect(view(d, "A").received).toBe("0");
    const key = view(d, "A").ambiguous[0].key;
    expect(decide(d, "B", { kind: "assign_transfer", note: "", observationKey: key }, { now: t(7), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/note/);
    d = decide(d, "B", { kind: "assign_transfer", note: "Remittance advice for INV-B.", observationKey: key }, { now: t(7), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(7)) }).data;
    expect(view(d, "B").state).toBe("matched");
    expect(view(d, "A").state).toBe("awaiting_payment");
    expect(d.observations[key].attributionHistory?.[0].kind).toBe("ambiguous");
  });

  it("an open request on an address a paid request used: possible repeat payment, not a silent match", () => {
    const a = addr("reuse");
    let d = real(emptyRequests(), "A", "500", a);
    d = put(d, tx(a, "500.00", "first"));
    d = decide(d, "A", { kind: "acknowledge", note: "" }, { now: t(7), by: "Mei", threshold: CONFIRMATIONS }).data;
    d = real(d, "B", "500", a, { at: t(8) });
    d = put(d, tx(a, "500.00", "second", { blockTime: t(9) }), t(9));
    expect(view(d, "B").review).toBe("ambiguous");
  });

  it("demo transfers never touch real requests, even on the same address", () => {
    let d = real(emptyRequests(), "REQ-1", "1250", addr("DEMO-1041"));
    d = resetDemo(d, NOW, pid);
    d = demoAdvance(demoMine(demoSend(d, "a", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    expect(view(d, "REQ-1").received).toBe("0");
    expect(view(d, "DEMO-1041").state).toBe("completed");
  });
});

describe("the demo week: seven cases", () => {
  const d0 = day();

  it("loads the same records every time (only the clock moves), with the numbers the first screen shows", () => {
    const again = resetDemo(d0, NOW, pid);
    expect(JSON.stringify(again)).toBe(JSON.stringify(d0));
    const g = glance(d0, Object.values(d0.requests).map((r) => deriveRequest(d0, r, CONFIRMATIONS)), Date.parse(NOW));
    expect([g.sent, g.arrived, g.paidAuto, g.attention.length]).toEqual([18, 16, 11, 5]);
    expect(g.attention.map((a) => a.status).sort()).toEqual(["Blocked", "Paid twice", "Short payment", "Unidentified", "Wrong network"]);
  });

  it("every demo transaction hash looks fictional (eight leading zeros)", () => {
    for (const o of Object.values(d0.observations)) expect(o.hash.replace(/^0x/, "")).toMatch(/^00000000/);
  });

  it("b. Brightline: short by 50.00, likely cause fees (labelled as an inference), polite top-up reply", () => {
    const v = view(d0, "DEMO-1042");
    const vd = verdict(d0, v);
    expect(vd.title).toBe("Short by 50.00 USDC");
    expect(vd.cause?.text).toMatch(/Fees deducted/);
    expect(vd.cause?.basis.join(" ")).toMatch(/1\.0%.*exchange/s);
    expect(replyDraft(v, d0, opts)).toMatch(/Hi Priya,[\s\S]*remaining 50\.00 USDC/);
    expect(amountToSend(v)).toBe("50");
  });

  it("c. Orbit: counterfeit USDT is blocked: counts nothing, can't be marked paid, explained with both contracts", () => {
    const v = view(d0, "DEMO-1043");
    expect(v.received).toBe("0");
    expect(v.blocked).toBe(true);
    expect(v.flagged[0].obs.checks.at(-1)?.code).toBe("D06");
    expect(verdict(d0, v).points.join(" ")).toContain(OFFICIAL_USDT);
    expect(decide(d0, "DEMO-1043", { kind: "acknowledge", note: "" }, { now: t(1), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
    expect(replyDraft(v, d0, opts)).toMatch(/isn't real USDT/);
  });

  it("d. Meridian: Tron payment for an Ethereum request: wrong network, recoverable (own wallet), counted only by a person", () => {
    const v = view(d0, "DEMO-1044");
    const vd = verdict(d0, v);
    expect(vd.title).toBe("Paid on the wrong network (Tron)");
    expect(vd.recoverable?.answer).toBe("Yes");
    expect(v.received).toBe("0");
    const key = v.flagged[0].obs.key;
    const d = decide(d0, "DEMO-1044", { kind: "accept_other_network", note: "Treasury confirmed.", observationKey: key }, { now: t(1), by: "Mei", threshold: CONFIRMATIONS }).data;
    expect(view(d, "DEMO-1044").state).toBe("completed");
  });

  it("e. Kite: an unidentified payment gets a scored suggestion from evidence; a person confirms it", () => {
    const o = unattributed(d0)[0];
    const s = suggestMatches(d0, o, CONFIRMATIONS);
    expect(s).toHaveLength(1); // weak, timing-only suggestions are not shown
    expect(s[0].request.id).toBe("DEMO-1045");
    expect([s[0].score, s[0].confidence]).toEqual([100, "Strong"]);
    expect(nextAction(view(d0, "DEMO-1045"), d0).title).toBe("Confirm the suggested match");
    expect(assignUnmatched(d0, o.key, "DEMO-1045", "", { now: t(1), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/note/);
    expect(assignUnmatched(d0, o.key, "DEMO-1043", "x", { now: t(1), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/isn't USDT/);
    const d = assignUnmatched(d0, o.key, "DEMO-1045", "Exact amount, known sender.", { now: t(1), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(1)) }).data;
    expect(view(d, "DEMO-1045").state).toBe("matched"); // a person matched it; marking it paid is one more click
    expect(d.observations[o.key].attributionHistory?.[0].kind).toBe("none");
  });

  it("f. Fernhill: the payment page tells a look-alike from the real address, and records it for ops", () => {
    const r = d0.requests["DEMO-1046"];
    const fake = lookalikeOf(r.receivingAddress);
    expect(compareAddress(r.receivingAddress.toUpperCase().replace("0X", "0x"), r.receivingAddress)).toBe("match");
    expect(compareAddress(fake, r.receivingAddress)).toBe("lookalike");
    expect(compareAddress(addr("someone"), r.receivingAddress)).toBe("different");
    expect(compareAddress("hello", r.receivingAddress)).toBe("invalid");
    const d = recordAddressCheck(d0, "DEMO-1046", fake, t(1)).data;
    expect(verdict(d, view(d, "DEMO-1046")).status).toBe("Scam stopped");
    expect(replyDraft(view(d, "DEMO-1046"), d, opts)).toMatch(/address poisoning/);
  });

  it("g. Kestrel: paid twice, reopened after the auto rule marked it paid", () => {
    const v = view(d0, "DEMO-1047");
    expect(v.duplicate).toBe(true);
    expect(verdict(d0, v).summary).toMatch(/4 minutes apart/);
  });

  it("a. Acme: plays from awaiting to paid automatically through the real logic", () => {
    const d = demoAdvance(demoMine(demoSend(d0, "a", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    expect(verdict(d, view(d, "DEMO-1041")).title).toMatch(/marked paid automatically/);
  });
});

describe("demo reset and persistence", () => {
  it("reset removes only demo records", () => {
    let d = real(emptyRequests(), "REQ-9", "10", addr("real"));
    d = put(d, tx(addr("real"), "10.00", "real"));
    d = resetDemo(resetDemo(d, NOW, pid), NOW, pid);
    expect(d.requests["REQ-9"]).toBeDefined();
    expect(Object.values(d.observations).filter((o) => !o.demo)).toHaveLength(1);
  });

  it("state survives a reload from disk, and a corrupt file stops writes instead of being replaced", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "req-")), "requests.json");
    await new FileRequestsStore(file).update(() => [day(), null]);
    const back = await new FileRequestsStore(file).load();
    expect(Object.keys(back.requests)).toHaveLength(19); // last month's Kite invoice, 11 routine, 7 cases
    writeFileSync(file, "{not json");
    await expect(new FileRequestsStore(file).update((x) => [x, null])).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("{not json");
  });
});

describe("input, money and links", () => {
  it("validates amounts exactly, accepts USDT, and builds an EIP-681 link in base units", () => {
    expect(validateRequest({ customerRef: "A", invoiceRef: "I", amount: "1,250", receivingAddress: addr("x") }).amount).toBeDefined();
    expect(validateRequest({ customerRef: "A", invoiceRef: "I", amount: "1.0000001", receivingAddress: addr("x") }).amount).toBeDefined();
    expect(validateRequest({ customerRef: "A", invoiceRef: "I", amount: "10", receivingAddress: addr("x"), token: "USDT" })).toEqual({});
    expect(normaliseAmount("1250.5")).toBe("1250.50");
    expect(formatUsdc("1234567.5")).toBe("1,234,567.50");
    expect(toBaseUnits("1250.5")).toBe("1250500000");
    expect(percentOf("50", "5000")).toBe("1.0");
    const d = real(emptyRequests(), "R1", "1250.50", addr("r1"));
    expect(eip681(d.requests.R1)).toBe(`ethereum:${OFFICIAL_USDC}@1/transfer?address=${addr("r1")}&uint256=1250500000`);
  });

  it("simulated evidence never cites an explorer link, a chain lookup or a freeze check that wasn't made", () => {
    const ev = view(day(), "DEMO-1043").flagged[0].obs.checks.at(-1)!.evidence;
    expect(ev.some((e) => e.id === "ev.lookup" || e.id === "ev.freeze" || e.source.kind === "explorer")).toBe(false);
    expect(JSON.stringify(ev)).not.toMatch(/File A|another customer/);
  });

  it("a transfer mined before the request was created never counts by itself; a person can count a prepayment", () => {
    let d = real(emptyRequests(), "R1", "500", addr("pre"), { at: t(10) });
    d = put(d, tx(addr("pre"), "500.00", "pre", { blockTime: t(0) }), t(11));
    const v = view(d, "R1");
    expect(v.flagged[0].kind).toBe("timing");
    d = decide(d, "R1", { kind: "count_transfer", note: "Prepaid on our instruction.", observationKey: v.flagged[0].obs.key }, { now: t(12), by: "Mei", threshold: CONFIRMATIONS }).data;
    expect(view(d, "R1").state).toBe("matched");
  });
});
