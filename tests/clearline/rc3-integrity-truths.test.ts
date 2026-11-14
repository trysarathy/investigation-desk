/**
 * rc3 Priority A — three truths (invariant 2) and stored-workspace integrity (invariants 4, 6, 7).
 * - T-1 / T-2 failed before the fixes in reconciliation.ts onExecutionChanged / derive.ts.
 * - I-1 failed before serialize.ts crossCheck: a tampered workspace was accepted and built on.
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, applyAction, evidenceTimelineFor, getAdapter, investigate, listExceptions, parseWorkspace, parseWorkspaceValue, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { debitLine, intent, run, sim, signedDelivery, submitted } from "./helpers";

const clone = (ws: Workspace) => JSON.parse(serializeWorkspace(ws)) as Workspace;
const refused = (ws: Workspace, field: RegExp) => {
  const r = parseWorkspace(serializeWorkspace(ws));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.field ?? "").toMatch(field);
  // applyAction re-validates: nothing can be built on a tampered workspace.
  const a = applyAction(ws, { type: "advance_clock", to: ws.asOf }, { actorId: "usr_maya", at: ws.asOf });
  expect(a.ok).toBe(false);
};

describe("rc3 I-1: parseWorkspace refuses a workspace that breaks a financial invariant", () => {
  it("the sample and every engine-produced workspace pass", () => {
    expect(parseWorkspaceValue(sampleWorkspace()).ok).toBe(true);
  });
  it("one statement line allocated to two payouts (contradictory ownership)", () => {
    const ws = clone(sampleWorkspace());
    const a = ws.allocations.find((x) => x.target.kind === "payment" && x.evidenceKind === "statement_line")!;
    const other = ws.intents.find((i) => a.target.kind === "payment" && i.id !== a.target.intentId)!;
    const dup = { ...a, id: "alc_99001", amountMinor: 1, target: { kind: "payment" as const, intentId: other.id } };
    ws.allocations.push(dup);
    ws.statementLines.find((l) => l.id === a.statementLineId)!.allocationIds.push(dup.id);
    refused(ws, /allocations\[\d+\]\.target/);
  });
  it("one statement line allocated twice above its amount (duplicate allocation)", () => {
    const ws = clone(sampleWorkspace());
    const a = ws.allocations.find((x) => x.evidenceKind === "statement_line")!;
    const dup = { ...a, id: "alc_99002" };
    ws.allocations.push(dup);
    ws.statementLines.find((l) => l.id === a.statementLineId)!.allocationIds.push(dup.id);
    refused(ws, /statementLines\[\d+\]\.allocationIds/);
  });
  it("an allocation not listed on its line, or naming a line that does not exist", () => {
    const ws = clone(sampleWorkspace());
    ws.allocations.push({ ...ws.allocations[0], id: "alc_99003" });
    refused(ws, /allocations\[\d+\]\.id/);
    const w2 = clone(sampleWorkspace());
    w2.allocations[0].statementLineId = "stl_missing";
    refused(w2, /allocations\[0\]\.statementLineId/);
  });
  it("a repayment counted twice for one statement line", () => {
    const ws = clone(sampleWorkspace());
    ws.repaymentAllocations.push({ ...ws.repaymentAllocations[0], id: "rpa_99004" });
    refused(ws, /repaymentAllocations\[1\]\.statementLineId/);
  });
  it("maker = checker on a funding decision or an instruction", () => {
    const ws = clone(sampleWorkspace());
    ws.fundingDecisions[0].checkerId = ws.fundingDecisions[0].makerId;
    refused(ws, /fundingDecisions\[0\]\.checkerId/);
    const w2 = clone(sampleWorkspace());
    w2.instructions[0].checkerId = w2.instructions[0].makerId;
    refused(w2, /instructions\[0\]\.checkerId/);
  });
  it("a hold released (or rejected) with no reviewer decision", () => {
    const ws = clone(sampleWorkspace());
    ws.holds[0].status = "released";
    refused(ws, /holds\[0\]\.status/);
    const w2 = clone(sampleWorkspace());
    w2.holds[0].status = "rejected";
    refused(w2, /holds\[0\]\.status/);
  });
  it("a terminal payout stored as verified with NO settlement evidence (no engine version produces it)", () => {
    // Review M-1: s2 now carries a bank debit, so "returned / verified" on s2 is a state an earlier engine could
    // produce and is MIGRATED (rc3-migration.test.ts). The refusal is pinned on a payout with no evidence at all:
    // s3 (held, no debit, no chain observation) stored as cancelled / verified.
    const ws = clone(sampleWorkspace());
    const s3 = intent(ws, scenarioIntentId(ws, "s3_hold")!);
    s3.status.execution = "cancelled";
    s3.status.settlement = "verified";
    refused(ws, /intents\[\d+\]\.status\.settlement/);
  });
});

const usdc = () => submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");

describe("rc3 T-1 / T-2: a failed payout never keeps settlement evidence as success", () => {
  it("T-1: a final on-chain transfer, then payout.failed → contradicted with an open exception; once resolved, none (never verified)", () => {
    let { ws, id, ppid } = usdc();
    ws = sim(ws, id).workspace; // in_transit
    const i = intent(ws, id);
    const obs = { intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: "0x" + "ef".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: ws.quotes.find((q) => q.id === i.selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 500, confirmations: 12 };
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs }).workspace;
    expect(intent(ws, id).status.settlement).toBe("verified");
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_tidewater", { id: `${ppid}-E8`, type: "payout.failed", provider_payment_id: ppid, sequence: 8, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    // Before the fix: failed / verified, with no contradiction.
    expect(intent(ws, id).status).toMatchObject({ execution: "failed", settlement: "contradicted" });
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).find((e) => e.explanationCode === "CH_TRANSFER_FOR_TERMINAL_PAYOUT")!;
    expect(exc).toBeTruthy();
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "document_metadata", description: "Provider confirmation (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Reviewed" }).workspace;
    expect(intent(ws, id).status.settlement).toBe("none");
  });

  it("T-2: a bank debit then payout.failed; after a person resolves the contradiction the recompute gives none, never verified", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E8`, type: "payout.failed", provider_payment_id: ppid, sequence: 8, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    for (const e of listExceptions(ws, { intentId: id, status: "unresolved" })) {
      ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
      ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Bank recall request (fictional)" } }).workspace;
      ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Recall requested" }).workspace;
    }
    // Before the fix: failed / verified (bank_statement).
    expect(intent(ws, id).status).toMatchObject({ execution: "failed", settlement: "none" });
    const v = investigate(ws, id);
    expect(v.ok && v.value.explanationCodes).toContain("IE_BANK_STATEMENT_LINE"); // the debit stays on record
  });
});

describe("rc3 invariant 2: three truths stay separate (property over the sample and adversarial flows)", () => {
  it("verified settlement always rests on independent evidence; never on a provider claim; never on a terminal payout", () => {
    const sample = sampleWorkspace();
    const flows: Workspace[] = [sample];
    for (const s of ["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"] as const) {
      const id = scenarioIntentId(sample, s)!;
      for (const inj of ["none", "contradictory", "duplicate", "out_of_order"] as const) {
        const r = applyAction(sample, { type: "simulate_provider_event", intentId: id, injection: inj }, { actorId: "usr_maya", at: sample.asOf });
        if (r.ok) flows.push(r.value.workspace);
      }
    }
    // provider completion alone
    let { ws, id } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    flows.push(ws);
    expect(intent(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none", reconciliation: "pending" });
    let checked = 0;
    for (const w of flows) {
      expect(parseWorkspaceValue(w).ok).toBe(true);
      for (const i of w.intents) {
        if (i.status.settlement !== "verified") continue;
        checked++;
        expect(["failed", "cancelled", "expired", "returned"]).not.toContain(i.status.execution);
        if (i.status.settlementScope === "bank_statement") {
          const bank = w.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === i.id && a.evidenceKind === "statement_line" && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).reduce((s, a) => s + a.amountMinor, 0);
          const independent = w.statementLines.filter((l) => l.allocationIds.some((x) => w.allocations.find((a) => a.id === x && a.target.kind === "payment" && a.target.intentId === i.id)));
          expect(bank).toBeGreaterThanOrEqual(i.amountMinor);
          expect(independent.every((l) => l.source === "bank_statement")).toBe(true);
        } else {
          expect(i.status.settlementScope).toBe("onchain_transfer");
          expect(w.chainObservations.some((o) => o.intentId === i.id && o.status === "final")).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe("rc3 E-1: the evidence timeline lists every source", () => {
  it("a provider settlement report recorded as evidence (no allocation, no exception) appears, marked provider-reported and not independent", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid }) });
    expect(r.outcome).toBe("recorded_provider_report");
    const lineId = r.createdIds[0];
    // Before the fix: the line was missing from the timeline although settlement rested on it.
    const entry = evidenceTimelineFor(r.workspace, id).find((e) => e.id === lineId)!;
    expect(entry).toMatchObject({ kind: "statement_line", provenance: "provider_settlement_report", independent: false });
    expect(entry.codes).toContain("RC_PROVIDER_REPORT_ONLY");
  });
});
