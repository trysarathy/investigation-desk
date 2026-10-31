// A reorg "seen twice": the first sighting's block was reorged out and the same USDC transfer came
// back in the next block with a new log index. The request counts both observations, the ghost never
// gains confirmations, and the request sits at "confirming" forever. Ops must be able to dismiss the
// ghost. Replays the fictional fixture team/evals/crypto-protocol-engineer/fixtures/t6-reorg.json
// (REQ-1101) through the real ingest / deriveRequest / decide.

import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { createRequest, decide, deriveRequest, ingest, obsKey } from "@/lib/requests/lifecycle";
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
const view = (d: RequestsData) => deriveRequest(d, d.requests["REQ-1101"], CONFIRMATIONS);

describe("reorg: same payment seen twice while confirming", () => {
  // BUG: remove .fails when fixed. dismiss_transfer is only allowed when review === "flagged"
  // (allowedDecisions in src/lib/requests/lifecycle.ts), so decide() refuses it while "confirming".
  it.fails("ops can dismiss the reorged-out ghost transfer, leaving only the surviving one", () => {
    let d = createRequest(emptyRequests(),
      { customerRef: "Cust 1101", invoiceRef: "INV-2290", amount: "12500.00", receivingAddress: TO, token: "USDC" },
      { now: CREATED, by: "Mei", demo: false, publicId: "REQ-1101", tokenContract: OFFICIAL_USDC, id: "REQ-1101" }).data;
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
    expect(after.received).toBe("12500.00");
    expect(after.pending).toBe("0");
    expect(after.state).toBe("matched");
  });
});
