/**
 * rc6 adapter CONFORMANCE: the Connect conformance idea applied to the merchant ingestion adapters. ONE contract,
 * run against EVERY adapter (provider export as JSON and as CSV, settlement report, recorded chain client, FX):
 * timeouts (an injected thrown error), malformed data, duplicates and out-of-order delivery. A failure in one source
 * or one item never stops the others, and each result reports an error per item. No network. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import {
  type AdapterResult, type AdapterSource, type ChainClient, NORTHWIND_EXPORT_MAPPING, RecordedChainClient, chainRecording, fxFeed,
  providerExportRows, readChainTransfers, readFxRates, readProviderExport, readSettlementReports, settlementReport, stableJson, toCsv,
} from "@/lib/clearline/merchant/adapters";
import { TEST_MODE_LABEL, type NetworkId } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { case3 } from "@/lib/clearline/merchant/fixtures/case3";
import { shuffled } from "./helpers";

interface Group { id: string; items?: unknown[]; fail?: Error }
interface Spec {
  name: string;
  items: unknown[];
  malformed: unknown;
  conflict: (item: unknown) => unknown;
  /** The item the conflicting copy replaces (a settlement line, so its batch stays valid). */
  conflictOf?: number;
  run: (groups: Group[]) => Promise<AdapterResult<unknown>>;
}

const source = (g: Group, body: (items: unknown[]) => unknown): AdapterSource => ({
  id: g.id,
  // an injected failure is asynchronous, like a timed-out request
  read: () => (g.fail ? new Promise((_, reject) => setTimeout(() => reject(g.fail), 0)) : body(g.items ?? [])),
});

const exportRows = providerExportRows(case1());
const HEADER = Object.keys(NORTHWIND_EXPORT_MAPPING.columns);
const report = settlementReport(case1());
const settlementItems = [...report.batches.map((value) => ({ kind: "batch", value })), ...report.lines.map((value) => ({ kind: "line", value }))];
const splitSettlement = (items: unknown[]) => {
  const xs = items as { kind: string; value: unknown }[];
  return { batches: xs.filter((x) => x.kind === "batch").map((x) => x.value), lines: xs.filter((x) => x.kind === "line").map((x) => x.value) };
};
const transfers = chainRecording(case1()).transfers;

/** A recorded client whose failing targets throw (an injected timeout); everything else is the recording. */
function chainRun(groups: Group[]) {
  const all = groups.flatMap((g) => g.items ?? []) as { network: NetworkId; to: string }[];
  const recorded = new RecordedChainClient({ label: TEST_MODE_LABEL, transfers: all });
  const failing = new Map(groups.filter((g) => g.fail).map((g) => [g.id, g.fail!]));
  const client: ChainClient = {
    mode: "recorded",
    transfersTo: async (network, address, since) => { const f = failing.get(address); if (f) { await Promise.resolve(); throw f; } return recorded.transfersTo(network, address, since); },
    confirmations: (n, h) => recorded.confirmations(n, h),
  };
  const targets = [...groups.filter((g) => g.fail).map((g) => ({ network: "tron" as NetworkId, address: g.id })),
    ...all.map((t) => ({ network: t.network, address: t.to }))].filter((x, i, xs) => xs.findIndex((y) => y.network === x.network && y.address === x.address) === i);
  return readChainTransfers(client, targets, { since: "2026-01-01T00:00:00.000Z" });
}

const SPECS: Spec[] = [
  {
    name: "provider export (JSON)", items: exportRows,
    malformed: { ...exportRows[0], "Payment": "PP-BAD", "Order": "BK-BAD", "Order amount": "-5.00" },
    conflict: (x) => ({ ...(x as object), "Credited": "1.00" }),
    run: (gs) => readProviderExport(gs.map((g) => source(g, (items) => items)), NORTHWIND_EXPORT_MAPPING, { entityId: "ENT-SG-01" }),
  },
  {
    name: "provider export (CSV)", items: exportRows,
    malformed: { ...exportRows[0], "Payment": "PP-BAD", "Order": "BK-BAD", "Received": "1e3" },
    conflict: (x) => ({ ...(x as object), "Credited": "1.00" }),
    run: (gs) => readProviderExport(gs.map((g) => source(g, (items) => toCsv(items as Record<string, string>[], HEADER))), NORTHWIND_EXPORT_MAPPING, { entityId: "ENT-SG-01" }),
  },
  {
    name: "settlement report", items: settlementItems, conflictOf: 1,
    malformed: { kind: "batch", value: { ...report.batches[0], batchId: "B-BAD", net: "1.00" } },
    conflict: (x) => { const i = x as { kind: string; value: object }; return { ...i, value: { ...i.value, ...(i.kind === "batch" ? { targetBankAccount: "OTHER" } : { amount: "1.00" }) } }; },
    run: (gs) => readSettlementReports(gs.map((g) => source(g, splitSettlement))),
  },
  {
    name: "chain (recorded client)", items: transfers,
    malformed: { ...transfers[0], txHash: "fict_tron_tx_bad", amountBaseUnits: "-1" },
    conflict: (x) => ({ ...(x as object), confirmations: 3 }),
    run: chainRun,
  },
  {
    name: "FX rates", items: fxFeed(case3()),
    malformed: { pair: "USDT/AED", rate: "3.6725", observedAt: "2026-12-01T06:00:00.000Z" },
    conflict: (x) => ({ ...(x as object), rate: "9.9999" }),
    run: (gs) => readFxRates(gs.map((g) => source(g, (items) => items))),
  },
];

describe.each(SPECS)("adapter contract: $name", (spec) => {
  const N = spec.items.length;
  const half = Math.ceil(N / 2);
  const A: Group = { id: "src-a", items: spec.items.slice(0, half) };
  const B: Group = { id: "src-b", items: spec.items.slice(half) };

  it("accepts every valid item, labelled, with no errors", async () => {
    const r = await spec.run([A, B]);
    expect(r.label).toBe(TEST_MODE_LABEL);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toHaveLength(N);
  });

  it("timeout: a source that throws is reported once and never stops the others", async () => {
    const r = await spec.run([{ id: "src-timeout", fail: new Error("ETIMEDOUT after 30000 ms (injected)") }, { id: "src-a", items: spec.items }]);
    expect(r.errors).toEqual([expect.objectContaining({ code: "source_failed", row: null, reason: expect.stringContaining("ETIMEDOUT") })]);
    expect(r.accepted).toHaveLength(N);
  });

  it("malformed: one bad item is rejected with its row number and a reason; the others are accepted", async () => {
    const r = await spec.run([{ id: "src-a", items: [...spec.items.slice(0, 1), spec.malformed, ...spec.items.slice(1)] }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toMatch(/invalid|malformed/);
    expect(r.errors[0].row).toBeGreaterThan(0);
    expect(r.errors[0].reason.length).toBeGreaterThan(5);
    expect(r.accepted).toHaveLength(N);
  });

  it("duplicates: an exact duplicate is accepted once; a conflicting one is rejected for every copy, per item", async () => {
    const exact = await spec.run([A, B, { id: "src-replay", items: [spec.items[0]] }]);
    expect(exact.errors).toEqual([]);
    expect(exact.accepted).toHaveLength(N);
    expect(exact.duplicates.length).toBeGreaterThanOrEqual(1);
    const conflict = await spec.run([A, B, { id: "src-conflict", items: [spec.conflict(spec.items[spec.conflictOf ?? 0])] }]);
    const dupErrors = conflict.errors.filter((e) => e.code === "duplicate_conflict");
    expect(dupErrors.length).toBeGreaterThanOrEqual(2);
    expect(dupErrors.every((e) => e.row !== null)).toBe(true);
    expect(conflict.accepted).toHaveLength(N - 1);
  });

  it("out-of-order delivery gives the same accepted output", async () => {
    const base = stableJson((await spec.run([A, B])).accepted);
    for (const seed of [1, 7, 42]) {
      const items = shuffled(spec.items, seed);
      const r = await spec.run([{ id: "src-b", items: items.slice(half) }, { id: "src-a", items: items.slice(0, half) }]);
      expect(stableJson(r.accepted)).toBe(base);
    }
  });
});
