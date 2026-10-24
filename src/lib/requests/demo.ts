// The demo: one sample business's working day of USDC invoice payments. Every company, customer,
// address, contract and transaction here is SYNTHETIC and labelled so; the transfers come from the
// simulated provider and go through the same ingestion, matching and engine checks as live ones.

import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "./check";
import { createRequest, decide, ingest } from "./lifecycle";
import { SimulatedProvider, synthHex } from "./provider";
import type { RequestsData, TransferEvent } from "./types";
import { emptyRequests } from "./types";

export const DEMO_BUSINESS = "Harbor & Pine Supply Co.";
export const DEMO_OPERATOR = "Mei Tan (Finance ops)";
/** A synthetic contract that calls itself "USDC" but is not Circle's. Fictional address. */
export const LOOKALIKE_USDC = synthHex("demo:lookalike-usdc-contract", 20);
export const DEMO_HEAD = 26_300_000;
const sim = new SimulatedProvider();

export const addr = (label: string) => synthHex(`demo:address:${label}`, 20);
/** Demo sender links stay the same across resets, so a link opened before a reset still works. */
export const demoPublicId = (id: string) => `demo-${synthHex(`demo:public:${id}`, 8).slice(2)}`;

/** The three scenarios and the requests around them. `send` = what the scenario's customer sends. */
export const SCENARIOS = [
  { key: "routine", id: "REQ-1041", customerRef: "Acme Logistics", invoiceRef: "INV-2041", amount: "1250.00",
    title: "Routine payment", send: { amount: "1250.00", token: "official" as const },
    blurb: "Acme pays the invoice in full. It confirms, matches, and the operator acknowledges it." },
  { key: "short", id: "REQ-1042", customerRef: "Brightline Studio", invoiceRef: "INV-2042", amount: "4800.00",
    title: "Amount mismatch", send: { amount: "3800.00", token: "official" as const },
    blurb: "Brightline sends 3,800.00 of 4,800.00. The request stays open, with the shortfall shown." },
  { key: "fake", id: "REQ-1043", customerRef: "Orbit Retail", invoiceRef: "INV-2043", amount: "2000.00",
    title: "Look-alike token", send: { amount: "2000.00", token: "lookalike" as const },
    blurb: "Orbit's 2,000.00 'USDC' comes from a contract that isn't Circle's. The engine flags a fake token." },
] as const;
export type ScenarioKey = (typeof SCENARIOS)[number]["key"];

const at = (base: number, minutes: number) => new Date(base + minutes * 60_000).toISOString();

/** Remove every demo record (and only those), then seed the day again. Non-demo requests are untouched. */
export function resetDemo(data: RequestsData, now: string, publicId: (id: string) => string): RequestsData {
  const keepReq = Object.fromEntries(Object.entries(data.requests).filter(([, r]) => !r.demo));
  const keepObs = Object.fromEntries(Object.entries(data.observations).filter(([, o]) => !o.demo));
  let d: RequestsData = { ...emptyRequests(), ...data, requests: keepReq, observations: keepObs, demoHead: DEMO_HEAD };
  const t0 = Date.parse(now) - 5 * 3600_000;
  const mk = (id: string, customerRef: string, invoiceRef: string, amount: string, minutes: number) => {
    d = createRequest(d, { customerRef, invoiceRef, amount, receivingAddress: addr(id) },
      { now: at(t0, minutes), by: DEMO_OPERATOR, demo: true, publicId: publicId(id), tokenContract: OFFICIAL_USDC, id }).data;
  };
  // Earlier today: one already settled, for context.
  mk("REQ-1038", "Northwind Traders", "INV-2038", "640.00", 0);
  for (const [i, s] of SCENARIOS.entries()) mk(s.id, s.customerRef, s.invoiceRef, s.amount, 30 + i * 10);
  mk("REQ-1044", "Kite Analytics", "INV-2044", "310.50", 90);

  // REQ-1038 was paid and acknowledged this morning (simulated, like everything here).
  const paid = sim.send(d, { to: addr("REQ-1038"), amount: "640.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("customer:northwind"), seq: "seed:REQ-1038" });
  d = feed(d, paid, at(t0, 40));
  d = feed(d, { ...paid, blockNumber: DEMO_HEAD - 60, blockTime: at(t0, 41), confirmations: 0 }, at(t0, 41));
  d = feed(d, { ...paid, blockNumber: DEMO_HEAD - 60, blockTime: at(t0, 41), confirmations: 60 }, at(t0, 54));
  d = decide(d, "REQ-1038", { kind: "acknowledge", note: "Credited in the ledger." }, { now: at(t0, 70), by: DEMO_OPERATOR, threshold: CONFIRMATIONS }).data;
  return { ...d, nextNumber: Math.max(d.nextNumber, 1045) };
}

export function feed(d: RequestsData, ev: TransferEvent, now: string): RequestsData {
  return ingest(d, ev, now, sim.label, checkObservation(now), CONFIRMATIONS).data;
}

/** Scenario step 1: that scenario's customer broadcasts their transfer. */
export function demoSend(d: RequestsData, key: ScenarioKey, now: string, n: number): { data: RequestsData; error?: string } {
  const s = SCENARIOS.find((x) => x.key === key);
  const r = s && d.requests[s.id];
  if (!s || !r || !r.demo) return { data: d, error: "Load the demo day first." };
  const official = s.send.token === "official";
  const ev = sim.send(d, { to: r.receivingAddress, amount: s.send.amount, tokenContract: official ? OFFICIAL_USDC : LOOKALIKE_USDC,
    tokenSymbol: "USDC", from: addr(`customer:${s.key}`), seq: `${s.id}:${n}` });
  return { data: feed(d, ev, now) };
}

/** Brightline sends the remaining balance after a short payment. */
export function demoSendBalance(d: RequestsData, now: string, n: number): { data: RequestsData; error?: string } {
  const r = d.requests["REQ-1042"];
  if (!r) return { data: d, error: "Load the demo day first." };
  const ev = sim.send(d, { to: r.receivingAddress, amount: "1000.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("customer:short"), seq: `REQ-1042:balance:${n}` });
  return { data: feed(d, ev, now) };
}

export function demoMine(d: RequestsData, now: string): RequestsData {
  const { head, events } = sim.mine(d, now);
  let next: RequestsData = { ...d, demoHead: head };
  for (const ev of events) next = feed(next, ev, now);
  return next;
}

export function demoAdvance(d: RequestsData, blocks: number, now: string): RequestsData {
  const { head, events } = sim.advance(d, blocks);
  let next: RequestsData = { ...d, demoHead: head };
  for (const ev of events) next = feed(next, ev, now);
  return next;
}

/** Deliver the most recent simulated event again, unchanged: shows that a repeat never double-counts. */
export function demoRedeliver(d: RequestsData, now: string): { data: RequestsData; error?: string } {
  const last = Object.values(d.observations).filter((o) => o.source === "simulated").sort((a, b) => (a.lastUpdatedAt < b.lastUpdatedAt ? 1 : -1))[0];
  if (!last) return { data: d, error: "No simulated transfer to deliver again yet." };
  const ev: TransferEvent = { source: last.source, demo: last.demo, chain: last.chain, hash: last.hash, logIndex: last.logIndex, from: last.from, to: last.to,
    tokenContract: last.tokenContract, tokenSymbol: last.tokenSymbol, amount: last.amount, status: last.status, blockNumber: last.blockNumber,
    blockTime: last.blockTime, confirmations: last.confirmations };
  return { data: feed(d, ev, now) };
}
