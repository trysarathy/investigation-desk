import { expect, it, vi } from "vitest";
import { approveAndPost } from "@/lib/accounting/engine";
import { emptyAccounting, type BooksAdapter } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { createRequest, ingest } from "@/lib/requests/lifecycle";
import { emptyRequests } from "@/lib/requests/types";
import { finalityFixture } from "./posting-finality-fixture";

function setup(change?: Parameters<typeof finalityFixture>[1]) {
  const now = "2026-10-25T09:10:00.000Z";
  const from = `0x${"11".repeat(20)}`, to = `0x${"22".repeat(20)}`, hash = `0x${"33".repeat(32)}`;
  let data = createRequest(emptyRequests(), { customerRef: "Synthetic", invoiceRef: "INV-1", amount: "100", receivingAddress: to, token: "USDC" },
    { now: "2026-10-25T09:00:00.000Z", by: "Tester", demo: false, publicId: "test", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  data = ingest(data, { source: "live", demo: false, chain: "ethereum", hash, logIndex: 1, from, to, tokenContract: OFFICIAL_USDC,
    tokenSymbol: "USDC", amount: "100", status: "success", blockNumber: 900, blockTime: "2026-10-25T09:05:00.000Z", confirmations: 9999 },
  now, "test", checkObservation(now), CONFIRMATIONS).data;
  const acct = emptyAccounting();
  acct.links.R1 = { provider: "xero", invoiceId: "synthetic", invoiceNumber: "INV-1", contactName: "Synthetic", currency: "USD", amountDue: "100", linkedAt: now, demo: false };
  const post = vi.fn(async (_link, lines) => lines.map((l: any) => ({ ...l, externalId: "test", externalType: "Payment" })));
  const adapter: BooksAdapter = { provider: "xero", listOpenInvoices: async () => [], post };
  const fixture = finalityFixture(Object.values(data.observations), change);
  const run = (evm = fixture.evm) => approveAndPost(data, acct, "R1", { threshold: CONFIRMATIONS, by: "Tester", now, adapter, evm });
  return { data, acct, now, adapter, post, fixture, run };
}

it("fresh finalized canonical transfer posts once and records the finality read", async () => {
  const s = setup();
  const r = await s.run();
  expect(r.error).toBeUndefined();
  expect(s.post).toHaveBeenCalledTimes(1);
  expect(r.acct.audit[0].reason).toContain("Ethereum finalized block 900");
  expect(s.fixture.calls.every((c) => c.ttl === 0)).toBe(true);
  expect(s.fixture.calls[0].params).toEqual(["finalized", false]);
});

it("confirmation counts and a caller finality flag cannot authorize a write without a reader", async () => {
  const s = setup();
  const r = await approveAndPost(s.data, s.acct, "R1", { threshold: CONFIRMATIONS, by: "Tester", now: s.now, adapter: s.adapter });
  expect(r.error).toMatch(/finality/);
  expect(s.post).not.toHaveBeenCalled();
});

const mutations: [string, Parameters<typeof finalityFixture>[1]][] = [
  ["unavailable finalized signal", (m, r) => m === "eth_getBlockByNumber" ? null : r],
  ["RPC outage", () => { throw new Error("RPC unavailable"); }],
  ["non-final transfer despite 9999 confirmations", (m, r) => m === "eth_getBlockByNumber" ? { ...r, number: "0x383" } : r],
  ["missing receipt", (m, r) => m === "eth_getTransactionReceipt" ? null : r],
  ["reverted transaction", (m, r) => m === "eth_getTransactionReceipt" ? { ...r, status: "0x0" } : r],
  ["wrong transaction", (m, r) => m === "eth_getTransactionReceipt" ? { ...r, transactionHash: `0x${"44".repeat(32)}` } : r],
  ["moved block", (m, r) => m === "eth_getTransactionReceipt" ? { ...r, blockNumber: "0x385" } : r],
  ["same-height reorg", (m, r) => m === "eth_getTransactionReceipt" ? { ...r, blockHash: `0x${"cc".repeat(32)}` } : r],
  ["changed payment date", (m, r) => m === "eth_getBlockByNumber" ? { ...r, timestamp: "0x1" } : r],
  ...["address", "data", "logIndex", "removed", "topics"].map((field): [string, Parameters<typeof finalityFixture>[1]] =>
    [`changed ${field}`, (m, r) => m === "eth_getTransactionReceipt" ? { ...r, logs: [{ ...r.logs[0], [field]: field === "removed" ? true : field === "topics" ? [] : "0x0" }] } : r]),
  ["duplicate log index", (m, r) => m === "eth_getTransactionReceipt" ? { ...r, logs: [r.logs[0], r.logs[0]] } : r],
];
it.each(mutations)("refuses %s without touching the accounting adapter", async (_, change) => {
  const s = setup(change);
  const r = await s.run();
  expect(r.error).toBeTruthy();
  expect(s.post).not.toHaveBeenCalled();
  expect(r.acct.audit.map((e) => e.kind)).toEqual(["refused"]);
});

it("a simulated request never reaches real books even with a responding RPC", async () => {
  const s = setup(); s.data.requests.R1.demo = true;
  expect((await s.run()).error).toBeTruthy();
  expect(s.post).not.toHaveBeenCalled();
});

it("validates every transfer before any line posts", async () => {
  const s = setup();
  const first = Object.values(s.data.observations)[0];
  const second = { ...first, logIndex: 2, key: `${first.chain}:${first.hash}:2` };
  s.data.observations[second.key] = second;
  s.data.requests.R1.amount = "200";
  s.acct.links.R1.amountDue = "200";
  const { evm } = finalityFixture([first, second], (m, r) => m === "eth_getTransactionReceipt"
    ? { ...r, logs: r.logs.map((l: any) => l.logIndex === "0x2" ? { ...l, removed: true } : l) } : r);
  expect((await s.run(evm)).error).toBeTruthy();
  expect(s.post).not.toHaveBeenCalled();
});
