// A reorg "seen twice": the first sighting's block was reorged out and the same USDC transfer came
// back in the next block with a new log index. The request counts both observations, the ghost never
// gains confirmations, and the request sits at "confirming" forever. Ops must be able to dismiss the
// ghost. Replays the fictional fixture team/evals/crypto-protocol-engineer/fixtures/t6-reorg.json
// (REQ-1101) through the real ingest / deriveRequest / decide.

import { describe, expect, it } from "vitest";
import { compareDecimal } from "@/lib/decimal";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { allowedDecisions, createRequest, decide, deriveRequest, ingest, obsKey } from "@/lib/requests/lifecycle";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const CREATED = "2026-10-27T01:00:00.000Z";
const LOOKUP_1 = "2026-10-27T02:00:20.000Z";
const LOOKUP_2 = "2026-10-27T02:03:30.000Z";
const TO = "0x00000000a1b2c3d4e5f60718293a4b5c6d7e8f90";
const HASH = "0x0000000039f1c2aa5b6e7d8c9f0a1b2c3d4e5f60718293a4b5c6d7e8f9012345";

const sighting = (logIndex: number, blockNumber: number, confirmations: number, blockTime: string): TransferEvent => ({
  source: "live", demo: false, chain: "ethereum", hash: HASH, logIndex,
  from: "0xc0ffee00c0ffee00c0ffee00c0ffee00c0ffee01", to: TO,
  tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", amount: "12500.00", status: "success",
  blockNumber, blockTime, confirmations,
});
const put = (d: RequestsData, ev: TransferEvent, at: string) => ingest(d, ev, at, "test", checkObservation(at), CONFIRMATIONS).data;
const fresh = () => createRequest(emptyRequests(),
  { customerRef: "Cust 1101", invoiceRef: "INV-2290", amount: "12500.00", receivingAddress: TO, token: "USDC" },
  { now: CREATED, by: "Mei", demo: false, publicId: "REQ-1101", tokenContract: OFFICIAL_USDC, id: "REQ-1101" }).data;
const view = (d: RequestsData) => deriveRequest(d, d.requests["REQ-1101"], CONFIRMATIONS);

describe("reorg: same payment seen twice while confirming", () => {
  // Was it.fails: dismiss_transfer was only allowed when review === "flagged", so decide() refused it
  // while "confirming". Fixed in allowedDecisions / decide (src/lib/requests/lifecycle.ts).
  it("ops can dismiss the reorged-out ghost transfer, leaving only the surviving one", () => {
    let d = fresh();
    // Lookup 1 (Mei): logIndex 0x41 in block 0x1497e29, 4 confirmations. That block is later reorged out.
    d = put(d, sighting(0x41, 0x1497e29, 4, "2026-10-27T02:00:00.000Z"), LOOKUP_1);
    // Lookup 2 (Raj): the same tx, now logIndex 0x0c in block 0x1497e2a, 17 confirmations.
    d = put(d, sighting(0x0c, 0x1497e2a, 17, "2026-10-27T02:00:12.000Z"), LOOKUP_2);

    const ghost = obsKey("ethereum", HASH, 0x41);
    const survivor = obsKey("ethereum", HASH, 0x0c);
    const before = view(d);
    expect(before.counted.map((o) => o.key).sort()).toEqual([ghost, survivor].sort());
    expect(before.state).toBe("confirming"); // stuck: the ghost stays at 4 of 12

    const res = decide(d, "REQ-1101", { kind: "dismiss_transfer", observationKey: ghost, note: "Reorged out; same payment re-mined in the next block." },
      { now: "2026-10-27T02:40:00.000Z", by: "Mei", threshold: CONFIRMATIONS });
    expect(res.error).toBeUndefined();

    const after = view(res.data);
    expect(after.counted.map((o) => o.key)).toEqual([survivor]);
    expect(compareDecimal(after.received, "12500.00")).toBe(0); // money.ts keeps the shortest exact form ("12500")
    expect(after.pending).toBe("0");
    expect(after.state).toBe("matched");
  });

  const GHOST = obsKey("ethereum", HASH, 0x41);
  const SURVIVOR = obsKey("ethereum", HASH, 0x0c);
  const AT = { now: "2026-10-27T02:40:00.000Z", by: "Mei", threshold: CONFIRMATIONS };
  const seenTwice = () => put(put(fresh(), sighting(0x41, 0x1497e29, 4, "2026-10-27T02:00:00.000Z"), LOOKUP_1),
    sighting(0x0c, 0x1497e2a, 17, "2026-10-27T02:00:12.000Z"), LOOKUP_2);
  const dismiss = (d: RequestsData, key: string) => decide(d, "REQ-1101", { kind: "dismiss_transfer", observationKey: key, note: "Reorged out." }, AT);

  it("the dismissed ghost reported again on the canonical chain stays dismissed: counted once, never 'paid twice'", () => {
    let d = dismiss(seenTwice(), GHOST).data;
    // A later lookup reports the ghost's key again, now deep enough to pass the threshold.
    d = put(d, sighting(0x41, 0x1497e29, 40, "2026-10-27T02:00:00.000Z"), "2026-10-27T03:00:00.000Z");
    const v = view(d);
    expect(v.counted.map((o) => o.key)).toEqual([SURVIVOR]);
    expect(compareDecimal(v.received, "12500.00")).toBe(0);
    expect(v.duplicate).toBe(false);
    expect(v.state).toBe("matched");
  });

  it("the survivor can't be dismissed once it is the only transfer left", () => {
    const d = dismiss(seenTwice(), GHOST).data;
    expect(allowedDecisions(view(d), d)).not.toContain("dismiss_transfer");
    expect(dismiss(d, SURVIVOR).error).toBeDefined();
  });

  it("a confirmed (final) payment still can't be dismissed: unchanged", () => {
    const d = put(fresh(), sighting(0x0c, 0x1497e2a, 17, "2026-10-27T02:00:12.000Z"), LOOKUP_2);
    expect(view(d).state).toBe("matched");
    expect(allowedDecisions(view(d), d)).toEqual(["acknowledge"]);
    const res = dismiss(d, SURVIVOR);
    expect(res.error).toBeDefined();
    expect(res.data).toBe(d);
  });

  it("a payment removed by a reorg and not dismissed never counts as received, and a lone transfer can't be dismissed", () => {
    // Seen once at 4 confirmations; its block was reorged out and the tx was never re-mined.
    const d = put(fresh(), sighting(0x41, 0x1497e29, 4, "2026-10-27T02:00:00.000Z"), LOOKUP_1);
    const v = view(d);
    expect(v.state).toBe("confirming");
    expect(v.received).toBe("0");
    expect(v.pending).toMatch(/^12500(\.0+)?$/);
    expect(allowedDecisions(v, d)).toEqual([]);
    expect(dismiss(d, GHOST).error).toBeDefined();
  });

  it("only transfers of the same transaction count as 'seen twice': two different payments confirming can't be dismissed", () => {
    let d = put(fresh(), sighting(0x41, 0x1497e29, 4, "2026-10-27T02:00:00.000Z"), LOOKUP_1);
    d = put(d, { ...sighting(0x0c, 0x1497e2a, 5, "2026-10-27T02:00:12.000Z"), hash: HASH.replace(/5$/, "6") }, LOOKUP_2);
    expect(view(d).state).toBe("confirming");
    expect(allowedDecisions(view(d), d)).toEqual([]);
    expect(dismiss(d, GHOST).error).toBeDefined();
  });
});
