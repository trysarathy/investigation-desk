// HOLDOUT T2 (hidden test). Copy into tests/holdout/ of a worktree with the employee's branch and run
// npx vitest run tests/holdout/t2-hidden.test.ts. Uses only the public lifecycle API that exists on
// main @ fd9b992 (ingest, deriveRequest, createRequest, checkObservation). Fails on main: ingest keeps
// the first block number forever and never lets confirmations fall.

import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, deriveRequest, ingest } from "@/lib/requests/lifecycle";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const HASH = "0x00000000c1ea511e0e9a1f2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f"; // fictional
const TO = addr("t2:deposit");
const FROM = addr("t2:payer");

const request = (auto = false) => createRequest(emptyRequests(),
  { customerRef: "Kestrel Freight", invoiceRef: "INV-2207", amount: "4200", receivingAddress: TO, token: "USDC" },
  { now: t(0), by: "Mei", demo: false, publicId: "pub-R1", tokenContract: OFFICIAL_USDC, id: "R1", autoMarkPaid: auto }).data;

const ev = (blockNumber: number, confirmations: number, o: Partial<TransferEvent> = {}): TransferEvent => ({
  source: "live", demo: false, chain: "ethereum", hash: HASH, logIndex: 112, from: FROM, to: TO, tokenContract: OFFICIAL_USDC,
  tokenSymbol: "USDC", amount: "4200.00", status: "success", blockNumber, blockTime: t(2), confirmations, ...o,
});
const put = (d: RequestsData, e: TransferEvent, at: string) => ingest(d, e, at, "Live chain lookup", checkObservation(at), CONFIRMATIONS).data;
const state = (d: RequestsData) => deriveRequest(d, d.requests.R1, CONFIRMATIONS).state;
const obs = (d: RequestsData) => Object.values(d.observations)[0];

describe("T2: a transfer re-mined in a different block (reorg) vs a lagging provider", () => {
  it("re-mined in another block: the new block is kept and confirmations restart from the new block", () => {
    let d = put(request(), ev(23_041_870, 8), t(3));
    expect(state(d)).toBe("confirming");
    d = put(d, ev(23_041_872, 1, { blockTime: t(4) }), t(5));
    expect(obs(d).blockNumber).toBe(23_041_872);
    expect(obs(d).confirmations).toBe(1);
    expect(obs(d).blockTime).toBe(t(4));
    expect(Object.keys(d.observations)).toHaveLength(1); // still one transfer, never counted twice
    expect(state(d)).toBe("confirming");
    const last = d.requests.R1.activity.at(-1)!;
    expect(last.text).toMatch(/23,?041,?870/);
    expect(last.text).toMatch(/23,?041,?872/);
    expect(last.text).toMatch(/reorg|reorgani[sz]/i);
  });

  it("a matched request whose transfer is re-mined goes back to confirming", () => {
    let d = put(request(), ev(23_041_870, CONFIRMATIONS), t(3));
    expect(state(d)).toBe("matched");
    d = put(d, ev(23_041_873, 2), t(5));
    expect(state(d)).toBe("confirming");
  });

  it("same block, lower count (a lagging provider): confirmations still never go backwards", () => {
    let d = put(request(), ev(23_041_870, 9), t(3));
    d = put(d, ev(23_041_870, 4), t(4));
    expect(obs(d).blockNumber).toBe(23_041_870);
    expect(obs(d).confirmations).toBe(9);
  });

  it("re-mined after the auto rule marked it paid: the decision stays on record, and the move is visible on the request", () => {
    let d = put(request(true), ev(23_041_870, CONFIRMATIONS), t(3));
    expect(state(d)).toBe("completed");
    const decisions = d.requests.R1.decisions.length;
    d = put(d, ev(23_041_874, 1), t(6));
    expect(d.requests.R1.decisions.length).toBeGreaterThanOrEqual(decisions); // append-only: nothing erased
    expect(d.requests.R1.activity.some((a) => /reorg|reorgani[sz]/i.test(a.text))).toBe(true);
  });
});
