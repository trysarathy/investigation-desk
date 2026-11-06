import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { columns, importCsv } from "../../src/lib/funding/imports";
import {
  emptyFunding,
  type FundingData,
  type ImportKind,
} from "../../src/lib/funding/model";
import { fundingLedger } from "../../src/lib/funding/ledger";
import { applyFundingEvent, reviewAdvance } from "../../src/lib/funding/review";
import { applyFundingEvent as legacyEvent } from "../../src/lib/funding/review-v2";
import { validateFundingData } from "../../src/lib/funding/store";
const at = "2026-11-19T10:00:00Z";
const file = (k: ImportKind) =>
  readFileSync(`fixtures/funding/${k}.csv`, "utf8");
const load = () =>
  ["customers", "advances", "payouts"].reduce(
    (d, k) =>
      importCsv(d, k as ImportKind, file(k as ImportKind), undefined, k, at),
    emptyFunding(),
  );
function receipt(d: FundingData, changes: Record<string, string> = {}) {
  const row = {
    id: "r1",
    effective_at: "2026-11-18T09:00:00Z",
    known_at: "2026-11-18T09:01:00Z",
    customer_id: "customer-1",
    reference: "INV-001",
    account: "provider-sgd",
    amount: "40000",
    currency: "SGD",
    ...changes,
  };
  return importCsv(
    d,
    "receipts",
    columns.receipts.join(",") +
      "\n" +
      columns.receipts.map((k) => row[k as keyof typeof row]).join(",") +
      "\n",
    undefined,
    "bank.csv",
    at,
  );
}
function writeoff(
  d: FundingData,
  value = "100000",
  time = "2026-11-18T10:00:00Z",
) {
  const users = [
    { id: "checker", name: "Treasury", role: "approver" as const },
  ];
  if (!d.users.length)
    d = applyFundingEvent(d, {
      action: "users",
      at: "2026-11-17T10:00:00Z",
      import_count: d.imports.length,
      base_revision: d.revision,
      actor_id: "",
      advance_id: "",
      reason: "deployment",
      users,
    });
  return applyFundingEvent(d, {
    action: "write_off",
    at: time,
    import_count: d.imports.length,
    base_revision: d.revision,
    actor_id: "checker",
    advance_id: "advance-1",
    reason: "Authorized loss recognition",
    users: [],
    amount: value,
  });
}
describe("actual principal and repayment ledger", () => {
  it("matches a customerless unique reference and reconciles partial repayment", () => {
    const result = fundingLedger(receipt(load(), { customer_id: "" }), at);
    expect(result.rows[0].outstanding).toBe("60000");
    expect(result.totals.SGD).toBe("60000");
    expect(result.allocations).toHaveLength(1);
    expect(result.exceptions.map((e) => e.code)).toEqual(
      expect.arrayContaining([
        "partial_repayment",
        "overdue",
        "supplier_paid_unrepaid_by_due",
        "approval_evidence_missing",
      ]),
    );
  });
  it("leaves unknown explicit references unmatched instead of amount fallback", () => {
    const result = fundingLedger(
      receipt(load(), { reference: "unknown", amount: "100000" }),
      at,
    );
    expect(result.allocations).toHaveLength(0);
    expect(result.totals.SGD).toBe("100000");
  });
  it.each<Record<string, string>>([
    { currency: "USD" },
    { account: "other" },
    { reference: "", customer_id: "" },
  ])("holds mismatched evidence %j", (change) => {
    expect(fundingLedger(receipt(load(), change), at).allocations).toHaveLength(
      0,
    );
  });
  it("matches unique customer and exact amount only without reference", () => {
    expect(
      fundingLedger(receipt(load(), { reference: "", amount: "100000" }), at)
        .rows[0].state,
    ).toBe("repaid");
  });
  it("holds one amount-only receipt when two same-customer candidates exist", () => {
    let d = load();
    d = importCsv(
      d,
      "advances",
      file("advances")
        .replaceAll("advance-1", "advance-2")
        .replaceAll("INV-001", "INV-002"),
      undefined,
      "a",
      at,
    );
    d = importCsv(
      d,
      "payouts",
      file("payouts")
        .replaceAll("advance-1", "advance-2")
        .replaceAll("payout-1", "payout-2")
        .replaceAll("BANK-OUT-1", "BANK-OUT-2"),
      undefined,
      "p",
      at,
    );
    const result = fundingLedger(
      receipt(d, { reference: "", amount: "100000" }),
      at,
    );
    expect(result.allocations).toHaveLength(0);
    expect(result.totals.SGD).toBe("200000");
  });
  it("caps one receipt to one advance and holds excess", () => {
    const result = fundingLedger(receipt(load(), { amount: "150000" }), at);
    expect(result.allocations[0].amount).toBe("100000");
    expect(
      result.exceptions.find((e) => e.code === "unmatched_receipt")?.amount,
    ).toBe("50000");
  });
  it("cannot apply a receipt before supplier payout", () => {
    expect(
      fundingLedger(
        receipt(load(), {
          effective_at: "2026-11-09T10:00:00Z",
          known_at: "2026-11-09T10:01:00Z",
        }),
        at,
      ).allocations,
    ).toHaveLength(0);
  });
  it("quarantines duplicate fingerprints without replacing the original allocation", () => {
    let d = receipt(load(), { id: "zzz" });
    expect(fundingLedger(d, at).allocations[0].receipt_id).toBe("zzz");
    d = receipt(d, { id: "aaa", known_at: "2026-11-18T09:00:01Z" });
    const result = fundingLedger(d, at);
    expect(result.allocations.map((a) => a.receipt_id)).toEqual(["zzz"]);
    expect(result.exceptions.some((e) => e.code === "duplicate_receipt")).toBe(
      true,
    );
  });
  it("flags duplicate ID reimports without settling twice", () => {
    const result = fundingLedger(receipt(receipt(load())), at);
    expect(result.rows[0].repaid).toBe("40000");
    expect(result.exceptions.some((e) => e.code === "duplicate_receipt")).toBe(
      true,
    );
  });
  it("preserves human writeoff against a later imported backdated receipt", () => {
    let d = writeoff(load());
    d = receipt(d, {
      effective_at: "2026-11-17T11:00:00Z",
      known_at: "2026-11-17T11:01:00Z",
      amount: "50000",
    });
    expect(validateFundingData(d)).toEqual(d);
    const row = fundingLedger(d, at).rows[0];
    expect(row.outstanding).toBe("0");
    expect(row.written_off).toBe("100000");
    expect(row.repaid).toBe("0");
    expect(row.state).toBe("written_off");
  });
  it("requires a named approver, reason and capped writeoff", () => {
    expect(() => writeoff(load(), "100001")).toThrow(/exceed/);
    const d = writeoff(load(), "50000");
    expect(fundingLedger(d, at).rows[0].outstanding).toBe("50000");
    const bad = { ...d.events[d.events.length - 1], actor_id: "missing" };
    expect(() => applyFundingEvent(d, bad)).toThrow(/approver/);
  });
  it("excludes future-known receipt and does not mix currency totals", () => {
    const result = fundingLedger(
      receipt(load(), { known_at: "2026-11-20T09:00:00Z" }),
      at,
    );
    expect(result.totals).toEqual({ SGD: "100000", USD: "0" });
  });
  it("flags over-limit actual unpaid exposure", () => {
    const d = load();
    d.customers[0].credit_limit = "100";
    expect(
      fundingLedger(d, at).exceptions.some((e) => e.code === "over_limit"),
    ).toBe(true);
  });
  it("uses receipt-time eligible outstanding for amount fallback despite later payouts", () => {
    const d = load();
    d.payouts[0].amount = "50000";
    d.payouts.push({
      ...d.payouts[0],
      id: "later",
      amount: "50000",
      effective_at: "2026-11-19T09:00:00Z",
      known_at: "2026-11-19T09:01:00Z",
    });
    const result = fundingLedger(
      receipt(d, { reference: "", amount: "50000" }),
      at,
    );
    expect(result.allocations[0].amount).toBe("50000");
    expect(result.rows[0].outstanding).toBe("50000");
  });
  it("quarantines a later duplicate payout without doubling principal", () => {
    let d = load();
    d = importCsv(
      d,
      "payouts",
      file("payouts").replace("payout-1", "aaa"),
      undefined,
      "duplicate.csv",
      at,
    );
    const result = fundingLedger(d, at);
    expect(result.rows[0].paid).toBe("100000");
    expect(result.exceptions.some((e) => e.code === "duplicate_payout")).toBe(
      true,
    );
  });
  it("does not restore limit from a writeoff, but restores it from matched repayment", () => {
    const extra = (d: FundingData) =>
      importCsv(
        d,
        "advances",
        file("advances")
          .replaceAll("advance-1", "advance-2")
          .replaceAll("INV-001", "INV-002"),
        undefined,
        "extra.csv",
        at,
      );
    let d = extra(receipt(load(), { amount: "100000" }));
    d.customers[0].credit_limit = "100000";
    expect(
      reviewAdvance(d, "advance-2", at).checks.find((c) => c.code === "limit")
        ?.status,
    ).toBe("pass");
    d = extra(writeoff(load()));
    d.customers[0].credit_limit = "100000";
    expect(
      reviewAdvance(d, "advance-2", at).checks.find((c) => c.code === "limit")
        ?.status,
    ).toBe("fail");
  });
  it("shows partial supplier delivery and does not call an open commitment fully repaid", () => {
    let d = ["customers", "advances", "cash"].reduce(
      (d, k) =>
        importCsv(d, k as ImportKind, file(k as ImportKind), undefined, k, at),
      emptyFunding(),
    );
    const base = {
      at: "2026-11-09T10:00:00Z",
      import_count: d.imports.length,
      base_revision: 0,
      actor_id: "maker",
      advance_id: "advance-1",
      reason: "Reviewed",
    };
    d = applyFundingEvent(d, {
      ...base,
      action: "users",
      users: [
        { id: "maker", name: "M", role: "operator" },
        { id: "checker", name: "C", role: "approver" },
      ],
    });
    d = applyFundingEvent(d, { ...base, action: "prepare", users: [] });
    d = applyFundingEvent(d, {
      ...base,
      action: "approve",
      actor_id: "checker",
      users: [],
    });
    d = importCsv(
      d,
      "payouts",
      file("payouts").replace("100000", "50000"),
      undefined,
      "partial.csv",
      at,
    );
    expect(fundingLedger(d, at).rows[0].state).toBe("overdue");
    expect(fundingLedger(d, at).rows[0].supplier_delivery).toBe("partly_paid");
    d = receipt(d, { amount: "50000" });
    const row = fundingLedger(d, at).rows[0];
    expect(row.state).toBe("drawn_repaid_commitment_open");
    expect(row.remaining_commitment).toBe("50000");
  });
  it("keeps currency totals separate and refuses a conflicting named customer", () => {
    let d = load();
    d = importCsv(
      d,
      "customers",
      file("customers")
        .replaceAll("customer-1", "customer-2")
        .replaceAll("SGD", "USD"),
      undefined,
      "usd-customer",
      at,
    );
    d = importCsv(
      d,
      "advances",
      file("advances")
        .replaceAll("customer-1", "customer-2")
        .replaceAll("advance-1", "advance-2")
        .replaceAll("INV-001", "INV-002")
        .replaceAll("SGD", "USD")
        .replaceAll("provider-sgd", "provider-usd"),
      undefined,
      "usd-advance",
      at,
    );
    d = importCsv(
      d,
      "payouts",
      file("payouts")
        .replaceAll("advance-1", "advance-2")
        .replaceAll("payout-1", "payout-2")
        .replaceAll("SGD", "USD")
        .replaceAll("provider-sgd", "provider-usd"),
      undefined,
      "usd-payout",
      at,
    );
    expect(fundingLedger(d, at).totals).toEqual({
      SGD: "100000",
      USD: "100000",
    });
    expect(
      fundingLedger(receipt(d, { customer_id: "customer-2" }), at).allocations,
    ).toHaveLength(0);
  });
  it("never adds a matched receipt to usable cash without a new balance", () => {
    let d = load();
    d = importCsv(
      d,
      "cash",
      file("cash").replaceAll("2026-11-09", "2026-11-19"),
      undefined,
      "balance",
      at,
    );
    const before = reviewAdvance(d, "advance-1", at).free_cash;
    expect(
      reviewAdvance(receipt(d, { amount: "100000" }), "advance-1", at)
        .free_cash,
    ).toBe(before);
  });
  it("validates unchanged legacy M2 decision snapshots", () => {
    let d = ["customers", "advances", "cash"].reduce(
      (d, k) =>
        importCsv(d, k as ImportKind, file(k as ImportKind), undefined, k, at),
      emptyFunding(),
    );
    const base = {
      at: "2026-11-09T10:00:00Z",
      import_count: d.imports.length,
      base_revision: 0,
      actor_id: "maker",
      advance_id: "advance-1",
      reason: "Reviewed",
    };
    d = legacyEvent(d, {
      ...base,
      action: "users",
      users: [
        { id: "maker", name: "M", role: "operator" },
        { id: "checker", name: "C", role: "approver" },
      ],
    });
    d = legacyEvent(d, { ...base, action: "prepare", users: [] });
    d = legacyEvent(d, {
      ...base,
      action: "approve",
      actor_id: "checker",
      users: [],
    });
    expect(validateFundingData(d)).toEqual(d);
  });
});
