// Where transfer events come from. Two providers behind one small interface, so the demo and a
// live source feed exactly the same ingestion and matching code:
//
//   SimulatedProvider  the demo's chain: synthetic transfers the operator triggers and mines by hand.
//                      Every event it emits is labelled "simulated"; none is a real observation.
//   LiveHashProvider   a real transaction hash, looked up read-only on Ethereum by the existing
//                      fetchers. No polling or address watching yet (production work).

import { createHash } from "node:crypto";
import { sameAddress } from "../address";
import { fetchFacts, type LiveDeps } from "../chain/investigate";
import type { Facts } from "../types";
import { REQUEST_SETTINGS, requestAddresses } from "./check";
import type { PaymentRequest, RequestsData, Source, TransferEvent } from "./types";

export interface TransferProvider {
  readonly source: Source;
  /** A plain-words label shown wherever an event from this provider appears. */
  readonly label: string;
}

/** Deterministic synthetic hex, so a demo replays identically: sha256(label) cut to `bytes`. */
export const synthHex = (label: string, bytes: number) => `0x${createHash("sha256").update(label).digest("hex").slice(0, bytes * 2)}`;

export class SimulatedProvider implements TransferProvider {
  readonly source = "simulated" as const;
  readonly label = "Simulated provider (demo)";

  /** A customer broadcasts a transfer: seen, not yet in a block. */
  send(data: RequestsData, o: { to: string; amount: string; tokenContract: string; tokenSymbol: string; from: string; seq: string }): TransferEvent {
    return { source: "simulated", demo: true, chain: "ethereum", hash: synthHex(`sim-tx:${o.seq}`, 32), logIndex: 0, from: o.from, to: o.to,
      tokenContract: o.tokenContract, tokenSymbol: o.tokenSymbol, amount: o.amount, status: "success", confirmations: 0 };
  }

  /** One new block: every simulated transfer waiting for a block goes into it. Returns the new head and the events. */
  mine(data: RequestsData, at: string): { head: number; events: TransferEvent[] } {
    const head = (data.demoHead ?? 0) + 1;
    const events = Object.values(data.observations).filter((o) => o.source === "simulated" && o.blockNumber === undefined)
      .map((o) => ({ ...eventOf(o), blockNumber: head, blockTime: at, confirmations: 0 }));
    return { head, events };
  }

  /** `n` more blocks: every simulated transfer in a block gains confirmations. */
  advance(data: RequestsData, n: number): { head: number; events: TransferEvent[] } {
    const head = (data.demoHead ?? 0) + n;
    const events = Object.values(data.observations).filter((o) => o.source === "simulated" && o.blockNumber !== undefined)
      .map((o) => ({ ...eventOf(o), confirmations: head - (o.blockNumber as number) }));
    return { head, events };
  }
}

const eventOf = (o: RequestsData["observations"][string]): TransferEvent => ({
  source: o.source, demo: o.demo, chain: o.chain, hash: o.hash, logIndex: o.logIndex, from: o.from, to: o.to, tokenContract: o.tokenContract,
  tokenSymbol: o.tokenSymbol, amount: o.amount, status: o.status, blockNumber: o.blockNumber, blockTime: o.blockTime, confirmations: o.confirmations,
});
export { eventOf };

export class LiveHashProvider implements TransferProvider {
  readonly source = "live" as const;
  readonly label = "Live Ethereum lookup";
  constructor(private readonly deps: LiveDeps) {}

  /** Look a hash up for one request. Returns the transfers into its receiving address, with the facts the engine used. */
  async lookup(hash: string, request: PaymentRequest, data: RequestsData):
    Promise<{ events: TransferEvent[]; facts?: Facts; message?: string }> {
    const ws = { depositAddresses: requestAddresses(data), ledger: [], ledgerUploadedAt: new Date().toISOString(), customerId: request.customerRef };
    const facts = await fetchFacts(hash, ws, this.deps, REQUEST_SETTINGS);
    if (facts.input.kind !== "hash") return { events: [], message: "That isn't a transaction hash (64 hex characters, optional 0x)." };
    const eth = facts.lookups.find((l) => l.chain === "ethereum");
    if (!facts.tx) {
      if (eth?.result === "error") return { events: [], message: `Ethereum didn't answer (${eth.error ?? "error"}). Nothing was recorded; try again.` };
      if (eth?.result === "pending") return { events: [], message: "Seen on Ethereum but not yet in a block. Try again shortly." };
      return { events: [], message: "Not found on Ethereum. Nothing was recorded." };
    }
    if (facts.tx.chain !== "ethereum") return { events: [], message: `Found on ${facts.tx.chain}, not Ethereum. Requests here are paid on Ethereum only.` };
    const mine = facts.tx.transfers.filter((t) => sameAddress(t.to, request.receivingAddress));
    if (!mine.length) return { events: [], facts, message: "This transaction has no token transfer to the request's receiving address." };
    const confirmations = facts.currentBlock !== undefined ? Math.max(0, facts.currentBlock - facts.tx.blockNumber) : 0;
    return {
      facts,
      events: mine.map((t) => ({ source: "live" as const, demo: false, chain: "ethereum" as const, hash: facts.tx!.hash, logIndex: t.logIndex,
        from: t.from, to: t.to, tokenContract: t.tokenContract, tokenSymbol: t.tokenSymbol, amount: t.amount, status: facts.tx!.status,
        blockNumber: facts.tx!.blockNumber, blockTime: facts.tx!.blockTime, confirmations })),
    };
  }
}
