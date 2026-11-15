/**
 * rc4 G1 (found by the Connect engineer, predates rc4): a live payout whose provider status reports contradict each other
 * (an OPEN contradictory_evidence exception) and that then gets a matched bank debit must stay settlement
 * "contradicted" (engine), give no entry that shows the supplier paid (bridge), and a saved workspace in the old state is
 * repaired on load (migration rule G). Covers the original providers (EV_IMPOSSIBLE_TRANSITION) and Connect
 * (EV_PROVIDER_STATUS_REGRESSED).
 */
import { describe, expect, it } from "vitest";
import { loadWorkspace, sampleWorkspace, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { attempt, debitLine, intent, run, signedDelivery, submitted } from "./helpers";
import { CW, deliver, intentOf, submittedConnect, versions } from "./rc4-connect-helpers";
import { byRule, propose, proposals, view } from "./rc4-helpers";
import { DEFAULT_SAMPLE_MAPPING } from "@/lib/clearline";

const contradictions = (ws: Workspace, id: string) => ws.exceptions.filter((e) => e.intentId === id && e.category === "contradictory_evidence" && e.status !== "resolved");
function resolveAll(ws: Workspace, id: string): Workspace {
  for (const e of contradictions(ws, id)) {
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Provider confirmation (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Provider confirmed completion" }).workspace;
  }
  return ws;
}

/** Original provider: completed, then an impossible in_transit report (EV_IMPOSSIBLE_TRANSITION) while nothing is evidenced yet. */
function original() {
  let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
  ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
  ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
  expect(intent(ws, id).status.execution).toBe("provider_reported_completed");
  const seq = ws.providerEvents.filter((e) => e.intentId === id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
  ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-G1`, type: "payout.in_transit", provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf }) }).workspace;
  expect(contradictions(ws, id).map((e) => e.explanationCode)).toEqual(["EV_IMPOSSIBLE_TRANSITION"]);
  expect(intent(ws, id).status.settlement).toBe("none");
  return { ws, id, ppid };
}
const debit = (ws: Workspace, ref: string, accountRef = "BANK-SGD-OPS (fictional)") => run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef, reference: ref, valueDate: "2026-11-13" }) }).workspace;

describe("G1, original providers (EV_IMPOSSIBLE_TRANSITION)", () => {
  it("a debit matched while the contradiction is open leaves settlement contradicted; no entry shows the supplier paid; after resolution the normal rule applies", () => {
    let { ws, id, ppid } = original();
    ws = debit(ws, `PAYOUT ${ppid}`);
    expect(intent(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "contradicted", settlementScope: "bank_statement", reconciliation: "exception" });
    ws = propose(ws).workspace;
    expect(proposals(ws).filter((p) => p.intentId === id && p.showsSupplierPaid)).toEqual([]);
    expect(view(ws).notProposed.find((n) => n.code === "NP_EVIDENCE_CONTRADICTED" && n.refs.includes(id))).toBeDefined();
    ws = resolveAll(ws, id);
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    ws = propose(ws).workspace;
    expect(byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id).filter((p) => p.status === "proposed")).toHaveLength(1);
  });
  it("an entry already proposed is superseded when the contradiction opens (basis change)", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = propose(debit(ws, `PAYOUT ${ppid}`)).workspace;
    const [p] = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id);
    const seq = ws.providerEvents.filter((e) => e.intentId === id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-G2`, type: "payout.in_transit", provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf }) }).workspace;
    expect(proposals(ws).find((x) => x.id === p.id)).toMatchObject({ status: "superseded", supersession: { code: "SP_EVIDENCE_WITHDRAWN" } });
  });
  it("migration rule G: a saved workspace in the old state (verified / matched with the contradiction open) is repaired on load, reported, never refused", () => {
    let { ws, id, ppid } = original();
    ws = debit(ws, `PAYOUT ${ppid}`);
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    Object.assign(o.intents.find((i) => i.id === id)!.status, { settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" }); // what the code before G1 stored
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    const m = r.value.migrations.find((x) => x.kind === "open_contradiction_settlement")!;
    expect(m).toMatchObject({ intentId: id, outcome: "contradicted_open", exceptionCode: "EV_IMPOSSIBLE_TRANSITION", to: { settlement: "contradicted", reconciliation: "exception" } });
    expect(intent(r.value.workspace, id).status.settlement).toBe("contradicted");
    const again = loadWorkspace(serializeWorkspace(r.value.workspace));
    expect(again.ok && again.value.migrations).toEqual([]);
  });
});

describe("G1, Connect providers (EV_PROVIDER_STATUS_REGRESSED)", () => {
  it("completed, then a regression report (contradiction open), then the matched debit: contradicted and no entry until resolved", () => {
    let { ws, id, ref } = submittedConnect(CW, "regress_and_recover");
    const vs = versions(ws, id);
    const completedAt = vs.findIndex((v) => v.entry.status === "delivered");
    for (const v of vs.slice(1, completedAt + 1)) ws = deliver(ws, id, v.version).workspace;
    ws = deliver(ws, id, completedAt + 2).workspace; // the regression (conflict path)
    expect(contradictions(ws, id).length).toBeGreaterThan(0);
    const before = intentOf(ws, id).status.execution;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ref, counterparty: "Cobalt Wren Payouts (fictional sandbox)" }) }).workspace;
    expect(intentOf(ws, id).status).toMatchObject({ execution: before, settlement: "contradicted", reconciliation: "exception" });
    ws = run(ws, "usr_maya", { type: "set_account_mapping", entries: [...DEFAULT_SAMPLE_MAPPING.map((e) => ({ ...e })), { accountKey: "bank:BANK-SGD-TEST", accountCode: "1099", accountName: "Test bank account (fictional)" }] }).workspace;
    ws = run(ws, "usr_maya", { type: "open_accounting_period", name: "2026-11", from: "2026-11-01", to: "2026-12-01" }).workspace;
    const r = attempt(ws, "usr_maya", { type: "propose_journal_entries" });
    if (r.ok) ws = r.value.workspace;
    expect(proposals(ws).filter((p) => p.intentId === id && p.showsSupplierPaid)).toEqual([]);
  });
});
