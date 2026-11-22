/**
 * rc6 ingestion adapters, adapter by adapter: the three cases go in through the adapters and give exactly the engine's
 * fixture results; totals-only settlement takes the proposed-grouping path; decimals, reorgs, live mode and FX
 * provenance. No network. Test mode · illustrative data.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  LiveChainClient, NORTHWIND_EXPORT_MAPPING, RecordedChainClient, assembleInput, assertLiveChainAllowed, chainClientFor, chainRecording, fxFeed,
  providerExportRows, readChainTransfers, readFxRates, readProviderExport, readSettlementReports, refreshFinality, settlementReport, stableJson, toCsv, watchedAddresses,
} from "@/lib/clearline/merchant/adapters";
import { TEST_MODE_LABEL, USDT_TRON, reconcile, type ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { case2Sgd, case2Usd, case2UsdNoBatchIds } from "@/lib/clearline/merchant/fixtures/case2";
import { case3 } from "@/lib/clearline/merchant/fixtures/case3";
import { minor } from "@/lib/clearline/merchant/fixtures/common";

const src = (id: string, v: unknown) => ({ id, read: () => v });
const liveSpy = vi.spyOn(LiveChainClient.prototype, "transfersTo");
afterAll(() => expect(liveSpy).not.toHaveBeenCalled());

async function throughAdapters(input: ReconcileInput, opts: { csv?: boolean; settlement?: unknown } = {}): Promise<ReconcileInput> {
  const rows = providerExportRows(input);
  const provider = await readProviderExport([src("export", opts.csv ? toCsv(rows, Object.keys(NORTHWIND_EXPORT_MAPPING.columns)) : rows)], NORTHWIND_EXPORT_MAPPING, { entityId: input.entity.id });
  const settlement = await readSettlementReports([src("report", opts.settlement ?? settlementReport(input))]);
  const chain = await readChainTransfers(new RecordedChainClient(chainRecording(input)), watchedAddresses(provider), { since: "2026-01-01T00:00:00.000Z" });
  const fx = await readFxRates([src("fx", fxFeed(input))]);
  for (const r of [provider, settlement, chain, fx]) expect(r.errors).toEqual([]);
  const transfers = chain.accepted.map(({ finalised, ...t }) => (void finalised, t));
  return assembleInput(input, { provider, settlement, transfers, fxRates: fx.accepted, bankLines: input.bankLines, addressFacts: input.addressFacts });
}

describe("the three cases through the adapters", () => {
  it.each([["Case 1", case1], ["Case 2 SGD", case2Sgd], ["Case 2 USD", case2Usd], ["Case 3", case3]] as const)("%s: identical engine result (JSON and CSV export)", async (_n, f) => {
    const want = stableJson(reconcile(f()));
    expect(stableJson(reconcile(await throughAdapters(f())))).toBe(want);
    expect(stableJson(reconcile(await throughAdapters(f(), { csv: true })))).toBe(want);
  });
  it("Case 1 figures survive the round trip: batch net 5,961.24, credited 1,348.65", async () => {
    const r = reconcile(await throughAdapters(case1()));
    expect(r.bridges[0].lines.at(-1)!.amountMinor).toBe(minor("5961.24"));
    expect(r.records.find((x) => x.orderId === "BK-24817")!.ledger.creditedMinor).toBe(minor("1348.65"));
  });
});

describe("provider export", () => {
  it("refuses a mapping that lacks a required field or maps a field twice", async () => {
    await expect(readProviderExport([], { provider: "x", columns: { A: "orderId" } }, { entityId: "E" })).rejects.toThrow(/orderAmount/);
    await expect(readProviderExport([], { provider: "x", columns: { A: "orderId", B: "orderId", C: "orderAmount", D: "orderCurrency", E: "quoteId" } }, { entityId: "E" })).rejects.toThrow(/mapped twice/);
  });
  it("a token is identified by (network, contract), never by symbol; a status is kept as a claim", async () => {
    const rows = providerExportRows(case1());
    const r = await readProviderExport([src("e", [{ ...rows[0], "Quote token": "T_FICTIONAL_LOOKALIKE_USDT" }, rows[1]])], NORTHWIND_EXPORT_MAPPING, { entityId: "ENT-SG-01" });
    expect(r.errors).toEqual([expect.objectContaining({ row: 1, code: "invalid", reason: expect.stringContaining("not a configured token") })]);
    expect(r.providerRecords).toEqual([expect.objectContaining({ providerPaymentId: "PP-24823", statusClaim: "underpaid" })]);
  });
  it("CSV rows are numbered by physical line (header = 1)", async () => {
    const rows = providerExportRows(case1());
    const csv = toCsv([rows[0], { ...rows[1], "Order amount": "27,00.00" }], Object.keys(NORTHWIND_EXPORT_MAPPING.columns));
    const r = await readProviderExport([src("e.csv", csv)], NORTHWIND_EXPORT_MAPPING, { entityId: "ENT-SG-01" });
    expect(r.errors).toEqual([expect.objectContaining({ source: "e.csv", row: 3, reason: expect.stringContaining("order amount") })]);
  });
  it("an order whose rows disagree is reported and dropped, never picked", async () => {
    const rows = providerExportRows(case3());
    const r = await readProviderExport([src("e", [rows[0], { ...rows[1], "Order amount": "18000.00" }])], NORTHWIND_EXPORT_MAPPING, { entityId: "ENT-AE-03" });
    expect(r.invoices).toEqual([]);
    expect(r.errors).toEqual([expect.objectContaining({ code: "duplicate_conflict", reason: expect.stringContaining("BK-25102") })]);
  });
});

describe("settlement report", () => {
  it("per-payment lines carry the batch ID and tie as in the fixture (Case 2: 41,862.30 → 40,228.68)", async () => {
    const r = await readSettlementReports([src("s", settlementReport(case2Sgd()))]);
    expect(r.shape).toBe("per_payment");
    expect(r.batches.find((b) => b.batchId === "B-1125-SGD")).toMatchObject({ grossMinor: minor("41862.30"), feesMinor: minor("418.62"), refundsMinor: minor("1215.00"), netMinor: minor("40228.68") });
  });
  it("a batch whose arithmetic does not tie is refused with a reason; its lines are refused too", async () => {
    const rep = settlementReport(case1());
    const r = await readSettlementReports([src("s", { ...rep, batches: [{ ...rep.batches[0], net: "5961.25" }] })]);
    expect(r.batches).toEqual([]);
    expect(r.errors[0].reason).toContain("≠ net");
    expect(r.errors.filter((e) => e.reason.includes("unknown or rejected batch"))).toHaveLength(4);
  });
  it("totals only: a grouping marked needs_confirmation, no batch, and the engine's proposed-grouping path applies", async () => {
    const usd = case2Usd();
    const b = usd.batches[0];
    const totals = { totals: [{ providerDay: b.providerDay, currency: "USD", targetBankAccount: b.targetBankAccount, gross: "9450.00", fees: "94.50", refunds: "0.00", net: "9355.50" }] };
    const r = await readSettlementReports([src("t", totals)]);
    expect(r.shape).toBe("totals_only");
    expect(r.batches).toEqual([]);
    expect(r.groupings).toEqual([expect.objectContaining({ status: "needs_confirmation", netMinor: minor("9355.50") })]);
    const res = reconcile(await throughAdapters(case2UsdNoBatchIds(), { settlement: totals }));
    expect(res.bridges).toEqual([]);
    expect(res.proposedGroupings).toEqual([expect.objectContaining({ status: "proposed_needs_confirmation", totalMinor: minor("9450.00") })]);
    expect(res.records.every((x) => x.explanation.ruleId === "M5.grouping.proposed_needs_confirmation" && x.explanation.decision === "suggested_for_review")).toBe(true);
  });
  it("a report cannot mix batches and totals", async () => {
    const r = await readSettlementReports([src("m", { ...settlementReport(case1()), totals: [] })]);
    expect(r.errors).toEqual([expect.objectContaining({ code: "malformed", row: null })]);
  });
});

describe("chain data (recorded; live mode off)", () => {
  it("reads base units with the token's decimals and refuses a recording whose decimals disagree", async () => {
    const rec = chainRecording(case1());
    const bad = { ...rec, transfers: [{ ...rec.transfers[0], decimals: 18 }, rec.transfers[1]] };
    const r = await readChainTransfers(new RecordedChainClient(bad), [{ network: "tron", address: rec.transfers[0].to }, { network: "tron", address: rec.transfers[1].to }], { since: "2026-01-01T00:00:00.000Z" });
    expect(r.errors).toEqual([expect.objectContaining({ code: "invalid", reason: expect.stringContaining("18 decimals") })]);
    expect(r.accepted).toEqual([expect.objectContaining({ amountBaseUnits: 1_760_000_000n, decimals: 6, tokenContract: USDT_TRON, finalised: true })]);
  });
  it("a transfer below the network's confirmations is read as not final", async () => {
    const rec = chainRecording(case1());
    const r = await readChainTransfers(new RecordedChainClient({ ...rec, transfers: [{ ...rec.transfers[0], confirmations: 5 }] }), [{ network: "tron", address: rec.transfers[0].to }], { since: "2026-01-01T00:00:00.000Z" });
    expect(r.accepted[0].finalised).toBe(false);
  });
  it("a reorg returns a transfer to not final: fewer confirmations, a block change, or the transaction gone", () => {
    expect(refreshFinality({ confirmations: 40, block: 100 }, { confirmations: 45, block: 100 }, 19)).toMatchObject({ finalised: true, reorg: false });
    expect(refreshFinality({ confirmations: 40, block: 100 }, { confirmations: 12, block: 100 }, 19)).toMatchObject({ finalised: false, reorg: true, confirmations: 12 });
    expect(refreshFinality({ confirmations: 40, block: 100 }, { confirmations: 41, block: 101 }, 19)).toMatchObject({ finalised: false, reorg: true, block: 101, confirmations: 0 });
    expect(refreshFinality({ confirmations: 40, block: 100 }, null, 19)).toMatchObject({ finalised: false, reorg: true });
  });
  it("the recorded client answers confirmations from its heads", async () => {
    const rec = chainRecording(case1());
    const c = new RecordedChainClient({ ...rec, heads: { [`tron:${rec.transfers[0].txHash}`]: { confirmations: 3, block: 7 } } });
    expect(await c.confirmations("tron", rec.transfers[0].txHash)).toEqual({ confirmations: 3, block: 7 });
    expect(await c.confirmations("tron", "fict_tron_tx_missing")).toBeNull();
  });
  it("live mode is off by default, refused under a test runner or CI, and never called", () => {
    expect(() => assertLiveChainAllowed({})).toThrow(/off/);
    expect(() => new LiveChainClient({})).toThrow(/off/);
    expect(() => new LiveChainClient({ CLEARLINE_CHAIN_LIVE: "1", VITEST: "true" })).toThrow(/refused in tests/);
    expect(() => new LiveChainClient({ CLEARLINE_CHAIN_LIVE: "1", CI: "1" })).toThrow(/refused in tests/);
    expect(() => new LiveChainClient()).toThrow(); // this process is a test runner
    expect(chainClientFor(chainRecording(case1()), {}).mode).toBe("recorded");
    expect(() => chainClientFor(chainRecording(case1()), { CLEARLINE_CHAIN_LIVE: "1", NODE_ENV: "test" })).toThrow();
  });
  it("a recording must carry the test-mode label", () => {
    expect(() => new RecordedChainClient({ transfers: [] })).toThrow();
    expect(() => new RecordedChainClient({ label: TEST_MODE_LABEL, transfers: [] })).not.toThrow();
  });
});

describe("FX rates", () => {
  it("each rate carries pair, rate, source and observedAt; one without a source or a timestamp is refused", async () => {
    const r = await readFxRates([src("fx", [
      { pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk", observedAt: "2026-11-24T02:00:00Z" },
      { pair: "USDT/SGD", rate: "1.3500", observedAt: "2026-11-24T02:00:00Z" },
      { pair: "USDT/SGD", rate: "1.3500", source: "  ", observedAt: "2026-11-24T02:00:00Z" },
      { pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk" },
      { pair: "USDT/SGD", rate: "1,35", source: "Fictional Rate Desk", observedAt: "2026-11-24T03:00:00Z" },
    ])]);
    expect(r.accepted).toEqual([{ pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk", timestamp: "2026-11-24T02:00:00.000Z" }]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].reason).toMatch(/source/);
    expect(r.errors[2].reason).toMatch(/observation time/);
  });
});
