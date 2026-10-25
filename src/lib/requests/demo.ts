// The demo: one fictional business's week of stablecoin invoice payments. Every company, person,
// message, address, contract and transaction here is FICTIONAL and labelled "Demo data". The
// transfers come from the simulated provider and go through the same ingestion, matching, engine
// checks and auto-mark rule as live ones. Loading the demo day always rebuilds the same records
// (only the clock moves): rehearse it, break it, load it again.

import { tronHexToBase58 } from "../address";
import { USDT_TRON } from "../fixtures";
import { checkObservation, CONFIRMATIONS, OFFICIAL } from "./check";
import { createRequest, ingest } from "./lifecycle";
import { demoTxHash, SimulatedProvider, synthHex } from "./provider";
import type { InboundMessage, RequestsData, RequestToken, TransferEvent } from "./types";
import { emptyRequests } from "./types";

export const DEMO_BUSINESS = "Northwind Pay Pte Ltd";
export const DEMO_OPERATOR = "Mei Tan (Finance ops)";
/** A fictional contract that calls itself "USDT" but is not Tether's. */
export const COUNTERFEIT_USDT = synthHex("demo:counterfeit-usdt-contract", 20);
export const DEMO_HEAD = 21_480_000;
const sim = new SimulatedProvider();

export const addr = (label: string) => synthHex(`demo:address:${label}`, 20);
export const tronAddr = (label: string) => tronHexToBase58(`41${synthHex(`demo:tron:${label}`, 20).slice(2)}`);
/** Demo sender links stay the same across reloads, so a link opened before a reload still works. */
export const demoPublicId = (id: string) => `demo-${synthHex(`demo:public:${id}`, 8).slice(2)}`;

/** Same first 4 and last 4 hex characters as `real`, different in between: what an address-poisoning scammer generates. */
export function lookalikeOf(real: string): string {
  const mid = synthHex(`demo:lookalike:${real}`, 20).slice(2, 34);
  return `0x${real.slice(2, 6)}${mid}${real.slice(-4)}`;
}

export const TREASURY = addr("northwind:treasury");
export const OLD_TRON_WALLET = tronAddr("northwind:old-tron");
export const EXCHANGE_WALLET = addr("coinbridge:withdrawals");

/** The seven cases the demo is built around, in the order of the request numbers. */
export const CASES = [
  { key: "a", id: "DEMO-1041", title: "Routine payment", customer: "Acme Logistics", story: "Paid exactly right: matched and marked paid with no one touching it." },
  { key: "b", id: "DEMO-1042", title: "Short payment", customer: "Brightline Studio", story: "4,950.00 of 5,000.00 USDC arrived: likely fees deducted." },
  { key: "c", id: "DEMO-1043", title: "Counterfeit token", customer: "Orbit Retail", story: "7,500 \"USDT\" from a contract that isn't Tether's: blocked." },
  { key: "d", id: "DEMO-1044", title: "Wrong network", customer: "Meridian Travel", story: "USDT sent on Tron to an Ethereum-only request." },
  { key: "e", id: "DEMO-1045", title: "Unidentified payment", customer: "Kite Analytics", story: "2,180.00 USDC arrived with no reference: suggested match." },
  { key: "f", id: "DEMO-1046", title: "Look-alike address", customer: "Fernhill Foods", story: "The payment page stops a sender pasting a poisoned address." },
  { key: "g", id: "DEMO-1047", title: "Duplicate payment", customer: "Kestrel Freight", story: "Paid twice: refund drafted." },
] as const;
export type CaseKey = (typeof CASES)[number]["key"];

/** Routine payments earlier this week, all marked paid by the auto-match rule. */
const ROUTINE: [string, string, string, RequestToken][] = [
  ["DEMO-1030", "Harbourline Shipping", "4200.00", "USDC"],
  ["DEMO-1031", "Pixel & Grain", "680.00", "USDC"],
  ["DEMO-1032", "Lumen Health Supplies", "12500.00", "USDT"],
  ["DEMO-1033", "Tanjong Coffee Co.", "315.40", "USDC"],
  ["DEMO-1034", "Bluefin Charters", "2750.00", "USDT"],
  ["DEMO-1035", "Cobalt Robotics", "9980.00", "USDC"],
  ["DEMO-1036", "Saffron Kitchen Group", "1120.00", "USDC"],
  ["DEMO-1037", "Vantage Prints", "450.00", "USDC"],
  ["DEMO-1038", "Red Dot Events", "6300.00", "USDT"],
  ["DEMO-1039", "Northstar Clinics", "3075.50", "USDC"],
  ["DEMO-1040", "Greenleaf Packaging", "1890.00", "USDC"],
];

const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Remove every demo record (and only those), then build the demo week again. Non-demo records are untouched. */
export function resetDemo(data: RequestsData, now: string, publicId: (id: string) => string): RequestsData {
  const keepReq = Object.fromEntries(Object.entries(data.requests).filter(([, r]) => !r.demo));
  const keepObs = Object.fromEntries(Object.entries(data.observations).filter(([, o]) => !o.demo));
  const keepNext = data.nextNumber ?? emptyRequests().nextNumber;
  const N = Date.parse(now);
  // A few minutes' jitter per value, from the value itself, so timestamps don't all share one minute (still deterministic).
  const jitter = (h: number) => ((Math.round(h * 997) % 23) - 11) * 60_000;
  const ago = (hours: number) => iso(N - hours * HOUR + jitter(hours));
  let d: RequestsData = {
    ...emptyRequests(), ...data, requests: keepReq, observations: keepObs, demoHead: DEMO_HEAD,
    wallets: [
      ...(data.wallets ?? []).filter((w) => !w.demo),
      { chain: "ethereum", address: TREASURY, label: "Northwind's main receiving address (the one on its website)", demo: true },
      { chain: "tron", address: OLD_TRON_WALLET, label: "Northwind's old Tron wallet (on invoices before March 2026)", demo: true },
    ],
    senderLabels: [
      ...(data.senderLabels ?? []).filter((l) => !l.demo),
      { address: EXCHANGE_WALLET, label: "Coinbridge's withdrawal wallet (a fictional exchange)", kind: "exchange", demo: true },
    ],
  };
  let block = DEMO_HEAD - 3000;
  const mk = (id: string, customerRef: string, amount: string, token: RequestToken, createdHoursAgo: number, messages?: InboundMessage[], invoice = id.replace("DEMO", "INV")) => {
    d = createRequest(d, { customerRef, invoiceRef: invoice, amount, receivingAddress: addr(id), token },
      { now: ago(createdHoursAgo), by: DEMO_OPERATOR, demo: true, publicId: publicId(id), tokenContract: OFFICIAL[token], id, autoMarkPaid: true, messages }).data;
  };
  /** A transfer seen, mined and confirmed at `hoursAgo`, through the real ingestion. */
  const pay = (seq: string, ev: Omit<TransferEvent, "source" | "demo" | "hash" | "logIndex" | "status" | "confirmations">, hoursAgo: number, o: { claimedFor?: string; by?: string; lookedUpHoursAgo?: number } = {}) => {
    const seen = sim.send(d, { to: ev.to, amount: ev.amount, tokenContract: ev.tokenContract, tokenSymbol: ev.tokenSymbol, from: ev.from, seq: `demo:${seq}`, chain: ev.chain });
    block += 37;
    const need = ev.chain === "tron" ? 20 : CONFIRMATIONS;
    const t = N - hoursAgo * HOUR + jitter(Math.round(hoursAgo) + 0.5); // same jitter within an hour keeps gaps like "4 minutes apart" exact
    const actor = o.by ?? sim.label;
    if (o.claimedFor) {
      // Found later from the hash the customer emailed: already in a block and fully confirmed when looked up.
      const at = iso(N - (o.lookedUpHoursAgo ?? hoursAgo) * HOUR);
      d = ingest(d, { ...seen, blockNumber: block, blockTime: iso(t + 15_000), confirmations: need + 4000 }, at, actor, checkObservation(at), CONFIRMATIONS, { claimedFor: o.claimedFor }).data;
      return;
    }
    d = ingest(d, seen, iso(t), actor, checkObservation(iso(t)), CONFIRMATIONS).data;
    const mined = { ...seen, blockNumber: block, blockTime: iso(t + 15_000), confirmations: 0 };
    d = ingest(d, mined, iso(t + 15_000), actor, checkObservation(iso(t + 15_000)), CONFIRMATIONS).data;
    d = ingest(d, { ...mined, confirmations: need }, iso(t + 3 * 60_000), actor, checkObservation(iso(t + 3 * 60_000)), CONFIRMATIONS).data;
  };
  const official = (token: RequestToken) => ({ tokenContract: OFFICIAL[token], tokenSymbol: token, chain: "ethereum" as const });

  // Kite paid an earlier invoice last month from its usual wallet: the history case (e) relies on.
  mk("DEMO-0988", "Kite Analytics", "2180.00", "USDC", 24 * 24, undefined, "INV-0988");
  pay("kite-0988", { ...official("USDC"), from: addr("kite:treasury"), to: addr("DEMO-0988"), amount: "2180.00" }, 24 * 23);

  // This week's routine payments: each matched and marked paid by the rule.
  ROUTINE.forEach(([id, customer, amount, token], i) => {
    const created = 110 - i * 9;
    mk(id, customer, amount, token, created);
    pay(`routine-${id}`, { ...official(token), from: addr(`payer:${id}`), to: addr(id), amount }, created - 5 - (i % 3));
  });

  // (b) Brightline: 4,950.00 of 5,000.00 USDC, sent from an exchange that took its fee out of the amount.
  mk("DEMO-1042", "Brightline Studio", "5000.00", "USDC", 52, [
    { at: ago(3), from: "Priya Nair, Accounts, Brightline Studio", channel: "Email",
      text: "Hi, we sent the payment yesterday. Why is invoice INV-1042 still showing as unpaid?" },
  ]);
  pay("brightline", { ...official("USDC"), from: EXCHANGE_WALLET, to: addr("DEMO-1042"), amount: "4950.00" }, 21);

  // (c) Orbit: 7,500 "USDT" from a counterfeit contract.
  mk("DEMO-1043", "Orbit Retail", "7500.00", "USDT", 49, [
    { at: ago(2), from: "Daniel Koh, Finance, Orbit Retail", channel: "Email",
      text: "We paid INV-1043 in full yesterday (7,500 USDT). Our wallet shows it as sent. Please confirm and close the invoice." },
  ]);
  pay("orbit", { tokenContract: COUNTERFEIT_USDT, tokenSymbol: "USDT", chain: "ethereum", from: addr("orbit:wallet"), to: addr("DEMO-1043"), amount: "7500.00" }, 20);

  // (d) Meridian: USDT sent on Tron, to Northwind's old Tron wallet from an old invoice. Found from the hash they emailed.
  const tronSeq = "demo:meridian-tron";
  const tronHash = demoTxHash(`sim-tx:${tronSeq}`).slice(2);
  mk("DEMO-1044", "Meridian Travel", "3200.00", "USDT", 46, [
    { at: ago(4), from: "Aisha Rahman, Meridian Travel", channel: "Email",
      text: `Payment for INV-1044 was made yesterday, 3,200 USDT. Transaction: ${tronHash}. Can you confirm receipt?` },
  ]);
  pay("meridian-tron", { tokenContract: USDT_TRON, tokenSymbol: "USDT", chain: "tron", from: tronAddr("meridian:wallet"), to: OLD_TRON_WALLET, amount: "3200.00" }, 22,
    { claimedFor: "DEMO-1044", by: `Hash lookup by ${DEMO_OPERATOR}`, lookedUpHoursAgo: 3.5 });

  // (e) Kite: an open invoice, and 2,180.00 USDC that arrived at the main address with no reference.
  mk("DEMO-1045", "Kite Analytics", "2180.00", "USDC", 70, [
    { at: ago(1.5), from: "Accounts payable, Kite Analytics", channel: "Email",
      text: "Hi Northwind, we paid INV-1045 yesterday. Please confirm receipt. Thanks!" },
  ]);
  pay("kite-1045", { ...official("USDC"), from: addr("kite:treasury"), to: TREASURY, amount: "2180.00" }, 21);

  // (f) Fernhill: open, about to pay. The payment page's address checker is the case.
  mk("DEMO-1046", "Fernhill Foods", "860.00", "USDC", 6, [
    { at: ago(0.8), from: "Tom Lee, Fernhill Foods", channel: "Chat",
      text: "Paying INV-1046 now, I'll use the address from last time." },
  ]);

  // (g) Kestrel: the same 1,980.00 USDC paid twice by an AP run, four minutes apart.
  mk("DEMO-1047", "Kestrel Freight", "1980.00", "USDC", 30, [
    { at: ago(1), from: "Kestrel Freight AP team", channel: "Email",
      text: "Yesterday's payment run may have paid INV-1047 twice. Can you check, and refund if so?" },
  ]);
  pay("kestrel-1", { ...official("USDC"), from: addr("kestrel:ap"), to: addr("DEMO-1047"), amount: "1980.00" }, 20);
  pay("kestrel-2", { ...official("USDC"), from: addr("kestrel:ap"), to: addr("DEMO-1047"), amount: "1980.00" }, 20 - 4 / 60);

  // (a) Acme: sent this morning, not yet paid. The presenter plays the payment live.
  mk("DEMO-1041", "Acme Logistics", "1250.00", "USDC", 2);

  // Demo requests use their own IDs (DEMO-…), so they can never collide with a business's REQ-… numbers.
  return { ...d, demoHead: block + 30, nextNumber: keepNext };
}

export function feed(d: RequestsData, ev: TransferEvent, now: string): RequestsData {
  return ingest(d, ev, now, sim.label, checkObservation(now), CONFIRMATIONS).data;
}

/** Case (a): Acme broadcasts its payment. `n` keeps a replay's hash distinct from earlier plays. */
export function demoSend(d: RequestsData, key: "a", now: string, n: number): { data: RequestsData; error?: string } {
  const r = d.requests["DEMO-1041"];
  if (key !== "a" || !r || !r.demo) return { data: d, error: "Load the demo day first." };
  const ev = sim.send(d, { to: r.receivingAddress, amount: r.amount, tokenContract: r.tokenContract, tokenSymbol: r.token, from: addr("acme:treasury"), seq: `DEMO-1041:${n}` });
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
export function demoRedeliver(d: RequestsData, now: string, requestId?: string): { data: RequestsData; error?: string } {
  const last = Object.values(d.observations).filter((o) => o.source === "simulated" && o.chain === "ethereum"
    && (!requestId || (o.attribution.kind === "request" && o.attribution.requestId === requestId))).sort((a, b) => (a.lastUpdatedAt < b.lastUpdatedAt ? 1 : -1))[0];
  if (!last) return { data: d, error: "No simulated transfer to deliver again yet." };
  const ev: TransferEvent = { source: last.source, demo: last.demo, chain: last.chain, hash: last.hash, logIndex: last.logIndex, from: last.from, to: last.to,
    tokenContract: last.tokenContract, tokenSymbol: last.tokenSymbol, amount: last.amount, status: last.status, blockNumber: last.blockNumber,
    blockTime: last.blockTime, confirmations: last.confirmations };
  return { data: feed(d, ev, now) };
}
