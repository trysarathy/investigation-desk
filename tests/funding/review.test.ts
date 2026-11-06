import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCsv } from "../../src/lib/funding/imports";
import {
  emptyFunding,
  type FundingData,
  type ImportKind,
} from "../../src/lib/funding/model";
import {
  applyFundingEvent,
  reviewAdvance,
  type FundingEvent,
} from "../../src/lib/funding/review";
import { FundingStore, validateFundingData } from "../../src/lib/funding/store";
const at = "2026-11-09T10:00:00Z";
const file = (kind: ImportKind) =>
  readFileSync(`fixtures/funding/${kind}.csv`, "utf8");
const load = () =>
  (["customers", "advances", "cash"] as ImportKind[]).reduce(
    (d, k) => importCsv(d, k, file(k), undefined, `${k}.csv`, at),
    emptyFunding(),
  );
const roster = [
  { id: "maker", name: "Operator", role: "operator" as const },
  { id: "checker", name: "Treasury", role: "approver" as const },
  { id: "reader", name: "Viewer", role: "viewer" as const },
];
function act(
  d: FundingData,
  action: FundingEvent["action"],
  actor_id = "maker",
  advance_id = "advance-1",
  reason = "Reviewed terms",
  time = at,
) {
  return applyFundingEvent(d, {
    action,
    at: time,
    actor_id,
    advance_id,
    reason,
    users: action === "users" ? roster : [],
    import_count: d.imports.length,
    base_revision: d.revision,
  });
}
const prepared = () => act(act(load(), "users"), "prepare");
const check = (d: FundingData, code: string, time = at) =>
  reviewAdvance(d, "advance-1", time).checks.find((c) => c.code === code)!;
describe("advance review and treasury decisions", () => {
  it("migrates an M1 import-only store without losing evidence", () => {
    const before = load();
    const old = structuredClone(before) as unknown as Record<string, unknown>;
    delete old.events;
    expect(validateFundingData(old)).toEqual(before);
    old.users = [{ id: "x", name: "x", role: "approver" }];
    expect(() => validateFundingData(old)).toThrow();
  });
  it("prepares and approves with five checks and an immutable evidence snapshot", () => {
    const d = act(prepared(), "approve", "checker");
    expect(d.advances[0].state).toBe("approved");
    expect(d.events[2].review?.checks.every((c) => c.status === "pass")).toBe(
      true,
    );
    expect(d.decisions[0].prepared_by).toBe("maker");
    expect(validateFundingData(d)).toEqual(d);
  });
  it("requires a missing invoice", () => {
    const d = load();
    d.advances[0].invoice_ref = "";
    expect(check(d, "invoice").status).toBe("needs_review");
  });
  it("blocks normalized duplicate invoices for the same customer", () => {
    const d = load();
    d.advances.push({
      ...d.advances[0],
      id: "second",
      invoice_ref: " inv-001 ",
    });
    expect(check(d, "invoice").status).toBe("fail");
  });
  it("blocks missing terms and suspended customers", () => {
    const d = load();
    d.customers[0].terms = "";
    expect(check(d, "terms").status).toBe("needs_review");
    d.customers[0].terms = "agreed";
    d.customers[0].status = "suspended";
    expect(check(d, "terms").status).toBe("fail");
  });
  it("counts actual payout exposure even without an approval and never double counts approval plus payout", () => {
    const d = load();
    d.advances.push({
      ...d.advances[0],
      id: "other",
      invoice_ref: "INV-002",
      amount: "150000",
      state: "approved",
    });
    d.payouts.push({
      id: "p",
      source: "bank",
      effective_at: at,
      known_at: at,
      advance_id: "other",
      amount: "150000",
      currency: "SGD",
      account: "provider-sgd",
      reference: "P",
    });
    expect(reviewAdvance(d, "advance-1", at).exposure).toBe("150000");
    expect(check(d, "limit").status).toBe("fail");
    d.advances[1].state = "proposed";
    expect(check(d, "limit").status).toBe("fail");
  });
  it("flags an overdue earlier advance and does not net unallocated receipts", () => {
    const d = load();
    d.advances.push({
      ...d.advances[0],
      id: "other",
      invoice_ref: "INV-002",
      state: "approved",
      due_at: at,
    });
    expect(check(d, "overdue").status).toBe("fail");
  });
  it("requires complete cash and uses the 24 hour policy", () => {
    const d = load();
    expect(check(d, "cash", "2026-11-10T09:00:00Z").status).toBe("pass");
    expect(check(d, "cash", "2026-11-10T09:00:01Z").status).toBe(
      "needs_review",
    );
    d.cash.pop();
    expect(check(d, "cash").status).toBe("needs_review");
  });
  it("withholds conflicting cash snapshots and insufficient free cash", () => {
    const d = load();
    d.cash[0].amount = "100";
    expect(check(d, "cash").status).toBe("needs_review");
    const e = load();
    e.advances[0].amount = "150000";
    expect(check(e, "cash").status).toBe("fail");
  });
  it("keeps a drawn reservation consumed against an unchanged bank snapshot", () => {
    const d = load();
    d.advances.push({
      ...d.advances[0],
      id: "other",
      invoice_ref: "INV-002",
      amount: "60000",
      state: "approved",
    });
    d.payouts.push({
      id: "p",
      source: "bank",
      effective_at: at,
      known_at: at,
      advance_id: "other",
      amount: "60000",
      currency: "SGD",
      account: "provider-sgd",
      reference: "P",
    });
    expect(reviewAdvance(d, "advance-1", at).free_cash).toBe("80000");
  });
  it("refuses viewer decisions and self approval", () => {
    expect(() => act(prepared(), "approve", "reader")).toThrow(/approver/);
    expect(() => act(prepared(), "approve", "maker")).toThrow(/approver/);
  });
  it("records a decline reason and allows decline despite failed checks", () => {
    const d = prepared();
    expect(() => act(d, "decline", "checker", "advance-1", " ")).toThrow(
      /reason/,
    );
    const result = act(d, "decline", "checker");
    expect(result.decisions[0].reason).toBe("Reviewed terms");
    expect(result.advances[0].state).toBe("declined");
  });
  it("rejects missing or future evidence at approval", () => {
    const d = prepared();
    d.cash.forEach((c) => (c.known_at = "2026-11-09T11:00:00Z"));
    expect(() => act(d, "approve", "checker")).toThrow(/uncertain/);
  });
  it("rejects edited decision evidence on load validation", () => {
    const d = act(prepared(), "approve", "checker");
    d.events[2].review!.free_cash = "999999";
    expect(() => validateFundingData(d)).toThrow();
  });
  it("preserves the undisbursed part of an approved advance after a partial payout", () => {
    const d = load();
    d.advances.push({
      ...d.advances[0],
      id: "other",
      invoice_ref: "INV-002",
      amount: "60000",
      state: "approved",
    });
    d.payouts.push({
      id: "p",
      source: "bank",
      effective_at: at,
      known_at: at,
      advance_id: "other",
      amount: "1000",
      currency: "SGD",
      account: "provider-sgd",
      reference: "P",
    });
    expect(reviewAdvance(d, "advance-1", at).reserved_cash).toBe("59000");
    expect(reviewAdvance(d, "advance-1", at).free_cash).toBe("80000");
  });
  it("rejects historical review against later workflow state", () => {
    const d = act(
      prepared(),
      "approve",
      "checker",
      "advance-1",
      "Reviewed",
      "2026-11-09T11:00:00Z",
    );
    expect(() => reviewAdvance(d, "advance-1", at)).toThrow(
      /earlier event replay/,
    );
  });
  it("rejects unknown runtime actions", () => {
    expect(() =>
      act(prepared(), "unknown" as FundingEvent["action"], "checker"),
    ).toThrow(/supported/);
  });
  it("does not release committed cash to another invoice after a concurrent approval", async () => {
    let d = load();
    d = importCsv(
      d,
      "advances",
      file("advances")
        .replaceAll("advance-1", "advance-2")
        .replaceAll("INV-001", "INV-002"),
      undefined,
      "second.csv",
      at,
    );
    d = act(act(act(d, "users"), "prepare"), "prepare", "maker", "advance-2");
    const p = join(
      await mkdtemp(join(tmpdir(), "funding-review-")),
      "data.json",
    );
    const store = new FundingStore(p);
    await store.update(() => [d, undefined]);
    const revision = (await store.load()).revision;
    const input = (id: string) => ({
      action: "approve" as const,
      at,
      actor_id: "checker",
      advance_id: id,
      reason: "Reviewed",
      users: [],
    });
    const results = await Promise.allSettled(
      ["advance-1", "advance-2"].map((id) => store.act(input(id), revision)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await store.load();
    const remaining = after.advances.find((a) => a.state === "prepared")!;
    await expect(
      store.act(input(remaining.id), after.revision),
    ).rejects.toThrow(/uncertain/);
    expect(
      reviewAdvance(after, remaining.id, at).checks.find(
        (c) => c.code === "cash",
      )?.status,
    ).toBe("fail");
  });
  it("rejects rewriting workflow history through the service", async () => {
    const p = join(
      await mkdtemp(join(tmpdir(), "funding-review-")),
      "data.json",
    );
    const store = new FundingStore(p);
    await store.update(() => [prepared(), undefined]);
    await expect(store.update(() => [load(), undefined])).rejects.toThrow(
      /append-only/,
    );
  });
  it("atomically rejects stale concurrent approvals and preserves cash headroom", async () => {
    const p = join(
      await mkdtemp(join(tmpdir(), "funding-review-")),
      "data.json",
    );
    const store = new FundingStore(p);
    await store.update(() => [prepared(), undefined]);
    const revision = (await store.load()).revision;
    const input = {
      action: "approve" as const,
      at,
      actor_id: "checker",
      advance_id: "advance-1",
      reason: "Reviewed",
      users: [],
    };
    const result = await Promise.allSettled([
      store.act(input, revision),
      new FundingStore(p).act(input, revision),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.load()).decisions).toHaveLength(1);
  });
});
