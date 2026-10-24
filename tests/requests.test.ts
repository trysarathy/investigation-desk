// Payment requests: lifecycle, matching, duplicates, ambiguity, acknowledgement, demo reset,
// persistence. Every transfer here is synthetic and goes through the real ingestion code.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr, demoAdvance, demoMine, demoRedeliver, demoSend, demoSendBalance, LOOKALIKE_USDC, resetDemo } from "@/lib/requests/demo";
import { createRequest, decide, deriveRequest, formatUsdc, ingest, normaliseAmount, toBaseUnits, validateRequest } from "@/lib/requests/lifecycle";
import { eip681, replyDraft } from "@/lib/requests/present";
import { SimulatedProvider } from "@/lib/requests/provider";
import { FileRequestsStore } from "@/lib/requests/store";
import { emptyRequests, type RequestsData } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const pid = (id: string) => `pub-${id}`;
const day = () => resetDemo(emptyRequests(), NOW, pid);
const view = (d: RequestsData, id: string) => deriveRequest(d, d.requests[id], CONFIRMATIONS);
const sim = new SimulatedProvider();

describe("routine payment (scenario A)", () => {
  it("detected → confirming → matched, and only an acknowledgement completes it", () => {
    let d = day();
    expect(view(d, "REQ-1041").state).toBe("awaiting_payment");
    d = demoSend(d, "routine", t(1), 1).data;
    expect(view(d, "REQ-1041").state).toBe("transfer_detected");
    d = demoMine(d, t(2));
    expect(view(d, "REQ-1041").state).toBe("confirming");
    d = demoAdvance(d, CONFIRMATIONS - 1, t(3));
    expect(view(d, "REQ-1041").state).toBe("confirming");
    d = demoAdvance(d, 1, t(4));
    const v = view(d, "REQ-1041");
    // Confirmed on-chain for exactly the amount is "matched", not "completed".
    expect(v.state).toBe("matched");
    expect(v.received).toBe("1250");
    expect(v.counted[0].checks.at(-1)?.code).toBe("D12"); // the engine: arrived on-chain, not credited
    const done = decide(d, "REQ-1041", { kind: "acknowledge", note: "" }, { now: t(5), by: "Mei", threshold: CONFIRMATIONS });
    expect(done.error).toBeUndefined();
    expect(view(done.data, "REQ-1041").state).toBe("completed");
    expect(done.data.requests["REQ-1041"].activity.at(-1)?.actor).toBe("Mei");
  });

  it("can't be acknowledged before it is matched", () => {
    let d = day();
    expect(decide(d, "REQ-1041", { kind: "acknowledge", note: "" }, { now: t(1), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
    d = demoMine(demoSend(d, "routine", t(1), 1).data, t(2));
    expect(decide(d, "REQ-1041", { kind: "acknowledge", note: "" }, { now: t(3), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
  });
});

describe("amount mismatch (scenario B)", () => {
  it("a short payment stays unresolved, shows the shortfall, and completes when the balance arrives", () => {
    let d = demoAdvance(demoMine(demoSend(day(), "short", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    let v = view(d, "REQ-1042");
    expect(v.state).toBe("needs_review");
    expect(v.review).toBe("short");
    expect(v.outstanding).toBe("1000");
    expect(formatUsdc(v.outstanding)).toBe("1,000.00");
    expect(replyDraft(v)).toContain("1,000.00 USDC less than the 4,800.00 USDC due");
    expect(decide(d, "REQ-1042", { kind: "acknowledge", note: "" }, { now: t(4), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
    expect(decide(d, "REQ-1042", { kind: "request_balance", note: "" }, { now: t(4), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/note is required/);
    d = decide(d, "REQ-1042", { kind: "request_balance", note: "Emailed the customer." }, { now: t(4), by: "Mei", threshold: CONFIRMATIONS }).data;
    v = view(d, "REQ-1042");
    expect(v.state).toBe("awaiting_payment");
    expect(v.review).toBe("short");
    d = demoAdvance(demoMine(demoSendBalance(d, t(5), 2).data, t(6)), CONFIRMATIONS, t(7));
    v = view(d, "REQ-1042");
    expect(v.state).toBe("matched");
    expect(v.received).toBe("4800");
  });

  it("an overpayment needs review and is never silently matched", () => {
    let d = day();
    const ev = sim.send(d, { to: addr("REQ-1044"), amount: "400.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("x"), seq: "over" });
    d = ingest(d, ev, t(1), "test", checkObservation(t(1)), CONFIRMATIONS).data;
    d = demoAdvance(demoMine(d, t(2)), CONFIRMATIONS, t(3));
    const v = view(d, "REQ-1044");
    expect(v.state).toBe("needs_review");
    expect(v.review).toBe("over");
    expect(v.outstanding).toBe("-89.5");
  });
});

describe("look-alike token (scenario C)", () => {
  it("the engine flags a fake token; it never counts toward the request", () => {
    let d = demoAdvance(demoMine(demoSend(day(), "fake", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const v = view(d, "REQ-1043");
    expect(v.state).toBe("needs_review");
    expect(v.review).toBe("flagged");
    expect(v.received).toBe("0");
    const obs = v.flagged[0].obs;
    expect(obs.tokenContract).toBe(LOOKALIKE_USDC);
    expect(obs.checks.at(-1)?.code).toBe("D06");
    expect(replyDraft(v)).toMatch(/isn't genuine USDC/);
    // Dismissing records a decision; the transfer and its check stay on file.
    d = decide(d, "REQ-1043", { kind: "dismiss_transfer", note: "Counterfeit token; customer told.", observationKey: obs.key }, { now: t(4), by: "Mei", threshold: CONFIRMATIONS }).data;
    expect(view(d, "REQ-1043").state).toBe("awaiting_payment");
    expect(d.observations[obs.key].checks.at(-1)?.code).toBe("D06");
  });
});

describe("duplicate events", () => {
  it("the same transfer delivered again counts once", () => {
    let d = demoAdvance(demoMine(demoSend(day(), "routine", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const before = view(d, "REQ-1041");
    const r = demoRedeliver(d, t(4));
    d = r.data;
    const after = view(d, "REQ-1041");
    expect(after.received).toBe(before.received);
    expect(after.counted).toHaveLength(1);
    expect(Object.values(d.observations).filter((o) => o.attribution.kind === "request" && o.attribution.requestId === "REQ-1041")).toHaveLength(1);
    expect(d.requests["REQ-1041"].activity.at(-1)?.kind).toBe("duplicate");
  });

  it("an older event never takes confirmations backwards", () => {
    let d = demoAdvance(demoMine(demoSend(day(), "routine", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const o = Object.values(d.observations).find((x) => x.attribution.kind === "request" && x.attribution.requestId === "REQ-1041")!;
    d = ingest(d, { ...o, source: "simulated", confirmations: 2 }, t(4), "test", checkObservation(t(4)), CONFIRMATIONS).data;
    expect(d.observations[o.key].confirmations).toBe(CONFIRMATIONS);
  });
});

describe("ambiguous matching", () => {
  it("two open requests on one address with the same amount: no automatic match; a person assigns it", () => {
    let d = emptyRequests();
    const shared = addr("shared");
    for (const [id, inv] of [["REQ-2001", "INV-1"], ["REQ-2002", "INV-2"]]) {
      d = createRequest(d, { customerRef: "C", invoiceRef: inv, amount: "500", receivingAddress: shared }, { now: t(0), by: "Mei", demo: false, publicId: id, tokenContract: OFFICIAL_USDC, id }).data;
    }
    const ev = { ...sim.send(d, { to: shared, amount: "500.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("y"), seq: "amb" }), blockNumber: 100, blockTime: t(1), confirmations: CONFIRMATIONS };
    d = ingest(d, ev, t(1), "test", checkObservation(t(1)), CONFIRMATIONS).data;
    const a = view(d, "REQ-2001"), b = view(d, "REQ-2002");
    expect([a.state, b.state]).toEqual(["needs_review", "needs_review"]);
    expect(a.review).toBe("ambiguous");
    expect(a.received).toBe("0");
    const key = a.ambiguous[0].key;
    expect(decide(d, "REQ-2002", { kind: "assign_transfer", note: "", observationKey: key }, { now: t(2), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/note/);
    d = decide(d, "REQ-2002", { kind: "assign_transfer", note: "Customer sent the remittance advice for INV-2.", observationKey: key }, { now: t(2), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(2)) }).data;
    expect(view(d, "REQ-2002").state).toBe("matched");
    expect(view(d, "REQ-2001").state).toBe("awaiting_payment");
    expect(d.requests["REQ-2001"].activity.at(-1)?.text).toMatch(/assigned to REQ-2002/);
  });

  it("a different amount at a shared address is still not decided by amount", () => {
    let d = emptyRequests();
    const shared = addr("shared2");
    d = createRequest(d, { customerRef: "C", invoiceRef: "A", amount: "500", receivingAddress: shared }, { now: t(0), by: "M", demo: false, publicId: "a", tokenContract: OFFICIAL_USDC, id: "REQ-1" }).data;
    d = createRequest(d, { customerRef: "C", invoiceRef: "B", amount: "750", receivingAddress: shared }, { now: t(0), by: "M", demo: false, publicId: "b", tokenContract: OFFICIAL_USDC, id: "REQ-2" }).data;
    const ev = sim.send(d, { to: shared, amount: "750.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("z"), seq: "amb2" });
    d = ingest(d, ev, t(1), "test", checkObservation(t(1)), CONFIRMATIONS).data;
    const o = Object.values(d.observations)[0];
    expect(o.attribution.kind).toBe("ambiguous");
    expect(o.attribution.kind === "ambiguous" && o.attribution.reason).toMatch(/amount alone isn't proof/);
  });
});

describe("demo reset and persistence", () => {
  it("reset removes only demo records and reseeds the day", () => {
    let d = emptyRequests();
    d = createRequest(d, { customerRef: "Real Co", invoiceRef: "R-1", amount: "10", receivingAddress: addr("real") }, { now: t(0), by: "Mei", demo: false, publicId: "real", tokenContract: OFFICIAL_USDC }).data;
    const realId = Object.keys(d.requests)[0];
    d = resetDemo(d, NOW, pid);
    d = demoAdvance(demoMine(demoSend(d, "routine", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    d = resetDemo(d, NOW, pid);
    expect(d.requests[realId]).toBeDefined();
    expect(d.requests[realId].demo).toBe(false);
    expect(view(d, "REQ-1041").state).toBe("awaiting_payment");
    expect(view(d, "REQ-1038").state).toBe("completed");
    expect(Object.values(d.observations).every((o) => o.demo)).toBe(true);
    expect(Object.values(d.observations)).toHaveLength(1); // only the seeded REQ-1038 payment
  });

  it("state survives a reload from disk", async () => {
    const store = new FileRequestsStore(path.join(mkdtempSync(path.join(tmpdir(), "req-")), "requests.json"));
    await store.update((d) => [demoMine(demoSend(resetDemo(d, NOW, pid), "routine", t(1), 1).data, t(2)), null]);
    const again = await new FileRequestsStore((store as unknown as { file: string }).file).load();
    expect(view(again, "REQ-1041").state).toBe("confirming");
    expect(again.rev).toBeGreaterThan(0);
  });
});

describe("request input and payment link", () => {
  it("validates amounts exactly and builds an EIP-681 link in base units", () => {
    expect(validateRequest({ customerRef: "A", invoiceRef: "B", amount: "1,250", receivingAddress: addr("a") }).amount).toBeDefined();
    expect(validateRequest({ customerRef: "A", invoiceRef: "B", amount: "0.0000001", receivingAddress: addr("a") }).amount).toMatch(/6 decimal/);
    expect(validateRequest({ customerRef: "A", invoiceRef: "B", amount: "0", receivingAddress: addr("a") }).amount).toMatch(/more than zero/);
    expect(validateRequest({ customerRef: "a@b.com", invoiceRef: "B", amount: "1", receivingAddress: "0x12" })).toMatchObject({ customerRef: expect.any(String), receivingAddress: expect.any(String) });
    expect(toBaseUnits("1250.5")).toBe("1250500000");
    expect(toBaseUnits("0.000001")).toBe("1");
    expect(normaliseAmount("1250")).toBe("1250.00");
    const d = day();
    expect(eip681(d.requests["REQ-1041"])).toBe(`ethereum:${OFFICIAL_USDC}@1/transfer?address=${addr("REQ-1041")}&uint256=1250000000`);
  });
});

describe("what the pages show stays consistent with the records", () => {
  it("the latest evidence reflects the latest confirmations, and earlier checks are kept", () => {
    const d = demoAdvance(demoMine(demoSend(day(), "fake", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const obs = view(d, "REQ-1043").flagged[0].obs;
    const conf = obs.checks.at(-1)!.evidence.find((e) => e.id === "ev.confirmations")!;
    expect(conf.value).toBe(`${CONFIRMATIONS} of ${CONFIRMATIONS}`);
    expect(obs.checks.length).toBeGreaterThan(1);
    expect(obs.checks[0].code).toBeNull(); // seen before a block: nothing to check yet
    expect(obs.checks[1].evidence.find((e) => e.id === "ev.confirmations")!.value).toBe(`0 of ${CONFIRMATIONS}`);
  });

  it("after a short payment the payment link asks for the balance, not the full amount", () => {
    const d = demoAdvance(demoMine(demoSend(day(), "short", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const v = view(d, "REQ-1042");
    expect(eip681(v.request, v.outstanding)).toMatch(/uint256=1000000000$/);
  });

  it("simulated evidence never cites a chain lookup or a freeze check that wasn't made", () => {
    const d = demoAdvance(demoMine(demoSend(day(), "routine", t(1), 1).data, t(2)), CONFIRMATIONS, t(3));
    const ids = view(d, "REQ-1041").counted[0].checks.at(-1)!.evidence.map((e) => e.id);
    expect(ids).not.toContain("ev.lookup");
    expect(ids).not.toContain("ev.freeze");
    expect(ids).not.toContain("ev.ledger");
  });
});

describe("timing", () => {
  it("a transfer mined before the request was created never counts by itself", () => {
    let d = day();
    const r = d.requests["REQ-1044"];
    const early = new Date(Date.parse(r.createdAt) - 86400_000).toISOString();
    const ev = { ...sim.send(d, { to: r.receivingAddress, amount: r.amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("q"), seq: "early" }), blockNumber: 50, blockTime: early, confirmations: CONFIRMATIONS };
    d = ingest(d, ev, t(1), "test", checkObservation(t(1)), CONFIRMATIONS).data;
    const v = view(d, "REQ-1044");
    expect(v.state).toBe("needs_review");
    expect(v.flagged[0].problem).toMatch(/before this request was created/);
  });
});
