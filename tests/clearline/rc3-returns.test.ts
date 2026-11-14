/**
 * rc3 Priority A — returns (invariant 3). The returnPosition tests failed before R-1
 * (investigation.ts returnPosition, labels RT_* and HUMAN_LABELS.returnStatus).
 */
import { describe, expect, it } from "vitest";
import { HUMAN_LABELS, describeCode, describeStatus, fundingProjection, investigate, listExceptions, sampleWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { debitLine, intent, run, sim, signedDelivery, submitted } from "./helpers";

const view = (ws: Workspace, id: string) => {
  const v = investigate(ws, id);
  if (!v.ok) throw new Error(v.error.message);
  return v.value;
};
const returnLine = (ppid: string, o: Record<string, unknown> = {}) => debitLine({ direction: "credit", kind: "return", reference: `RETURN ${ppid}`, ...o });

describe("rc3 R-1: net movement and beneficiary-unpaid are two separate facts", () => {
  it("debit + equal return credit → net movement zero AND beneficiary unpaid; never 'delivered'", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace; // completed
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.returned", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid", amount_minor: 1_000_000, currency: "SGD" }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: returnLine(ppid) }).workspace;
    const v = view(ws, id);
    expect(v.returnPosition).toMatchObject({
      returnStatus: "confirmed_by_statement",
      debited: { amountMinor: 1_000_000, currency: "SGD" },
      returnCredited: { amountMinor: 1_000_000, currency: "SGD" },
      netMovement: { amountMinor: 0, currency: "SGD" },
      netMovementZero: true,
      beneficiaryPaid: false,
      code: "RT_NET_ZERO",
    });
    expect(v.returnPosition!.text).toMatch(/net to zero.*not paid/);
    expect(v.explanationCodes).toEqual(expect.arrayContaining(["RT_NET_ZERO", "RT_BENEFICIARY_UNPAID", "OS_RETURN_RECEIVED_SUPPLIER_UNPAID"]));
    // once the return is resolved: reconciliation net-zero matched, labelled "supplier still unpaid", never verified
    const exc = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "funds_returned_confirmation", description: "Funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Funds back" }).workspace;
    const s = intent(ws, id).status;
    expect(s).toMatchObject({ execution: "returned", settlement: "none", reconciliation: "matched" });
    expect(describeStatus(s).reconciliation).toBe("Returned — net zero (supplier still unpaid)");
    expect(view(ws, id).returnPosition).toMatchObject({ netMovementZero: true, beneficiaryPaid: false });
  });

  it("the sample's returned payout (debit, then return, then return credit) shows net movement zero AND beneficiary unpaid; settlement never verified; an owned exception stays open", () => {
    // rc3 follow-up: the s2 sample now has the outgoing debit (SIMBANK-0002) before payout.returned and the
    // return credit (SIMBANK-0006) after it. (v2 sample: return credit only → RT_DEBIT_NOT_ON_STATEMENT,
    // which is still covered below on a constructed payout.)
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    const v = view(ws, id);
    expect(v.returnPosition).toMatchObject({
      returnStatus: "confirmed_by_statement", code: "RT_NET_ZERO", netMovementZero: true, beneficiaryPaid: false,
      debited: { amountMinor: 1_278_490, currency: "USD" }, returnCredited: { amountMinor: 1_278_490, currency: "USD" }, netMovement: { amountMinor: 0, currency: "USD" },
    });
    expect(v.status).toEqual({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement", reconciliation: "exception" });
    expect(describeStatus(v.status).summary).not.toMatch(/verified|delivered|paid/i);
    const open = listExceptions(ws, { intentId: id, status: "unresolved" });
    expect(open.map((e) => [e.category, e.ownerId])).toEqual([["returned_payout", "usr_maya"]]);
    expect(v.explanationCodes).toEqual(expect.arrayContaining(["RT_NET_ZERO", "RT_BENEFICIARY_UNPAID", "OS_RETURN_RECEIVED_SUPPLIER_UNPAID"]));
  });

  it("a return credit on the statement without the outgoing debit does not claim net zero (RT_DEBIT_NOT_ON_STATEMENT)", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: returnLine(ppid) }).workspace;
    const v = view(ws, id);
    expect(v.returnPosition).toMatchObject({ returnStatus: "confirmed_by_statement", code: "RT_DEBIT_NOT_ON_STATEMENT", netMovementZero: false, beneficiaryPaid: false, debited: { amountMinor: 0 }, returnCredited: { amountMinor: 1_000_000, currency: "SGD" } });
    expect(v.returnPosition!.netMovement).toBeUndefined();
  });

  it("a provider-reported return with nothing on the statement, and a partial return credit", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(view(ws, id).returnPosition).toMatchObject({ returnStatus: "provider_reported", code: "RT_RETURN_NOT_ON_STATEMENT", netMovementZero: false, beneficiaryPaid: false });
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: returnLine(ppid, { amountMinor: 400_000 }) }).workspace;
    expect(view(ws, id).returnPosition).toMatchObject({ code: "RT_NET_NOT_ZERO", netMovement: { amountMinor: 600_000 }, netMovementZero: false, beneficiaryPaid: false });
  });

  it("labels: a statement-confirmed return is labelled as such; every RT_ code has a label", () => {
    expect(HUMAN_LABELS.returnStatus.confirmed_by_statement).toBe("Return confirmed on the statement");
    expect(HUMAN_LABELS.returnStatus.provider_reported).toMatch(/provider/);
    for (const c of ["RT_NET_ZERO", "RT_NET_NOT_ZERO", "RT_RETURN_NOT_ON_STATEMENT", "RT_DEBIT_NOT_ON_STATEMENT", "RT_BENEFICIARY_UNPAID"]) expect(describeCode(c)).not.toMatch(/Unrecognised/);
    expect(describeCode("RC_RETURN_CONFIRMS_PROVIDER_RETURN")).toBe("Return confirmed on the statement");
  });
});

describe("rc3 invariant 3: a returned payout never appears delivered (already enforced; proof)", () => {
  it("the s5 funded payout, returned after its debit was verified: basis none, settlement contradicted, no 'paid'/'delivered' wording", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s5_funding")!;
    const ppid = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!.providerPaymentId!;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.returned", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    const s = intent(ws, id).status;
    expect(s).toMatchObject({ execution: "returned", settlement: "contradicted" });
    expect(fundingProjection(ws).rows.find((r) => r.intentId === id)!.supplierPaidBasis).toBe("none");
    const v = view(ws, id);
    const text = [describeStatus(s).summary, ...v.outstanding.map((o) => o.text)].join(" ");
    expect(text).not.toMatch(/\bdelivered\b|Settlement verified|supplier paid/i);
    expect(v.outstanding.map((o) => o.code)).toContain("OS_RETURN_NOT_YET_RECEIVED");
  });
});

describe("returned payout: settlement scope is pinned in every path (derive.ts and onExecutionChanged agree)", () => {
  const resolveWithEvidence = (ws: Workspace, excId: string, kind: "document_metadata" | "funds_returned_confirmation" = "document_metadata") => {
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: excId }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: excId }, evidence: { kind, description: "Evidence (fictional)" } }).workspace;
    return run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Reviewed" }).workspace;
  };

  it("return with a debit (s2): contradicted / bank_statement — also after a recompute while the return is open", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    expect(intent(ws, id).status).toMatchObject({ settlement: "contradicted", settlementScope: "bank_statement" });
    // a provider report on the returned payout opens a second contradiction; resolving it runs the recompute
    const ppid = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!.providerPaymentId!;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, amountMinor: 1_278_490, currency: "USD", valueDate: "2026-11-12" }) }).workspace;
    const rep = listExceptions(ws, { intentId: id, category: "contradictory_evidence", status: "unresolved" })[0];
    ws = resolveWithEvidence(ws, rep.id);
    // Before the fix: the recompute set scope "none" while settlement stayed "contradicted".
    expect(intent(ws, id).status).toMatchObject({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement" });
  });

  it("return without a debit: none / none, before and after a recompute", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "none", settlementScope: "none" });
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid }) }).workspace;
    const rep = listExceptions(ws, { intentId: id, category: "contradictory_evidence", status: "unresolved" })[0];
    ws = resolveWithEvidence(ws, rep.id);
    expect(intent(ws, id).status).toMatchObject({ settlement: "none", settlementScope: "none" });
  });

  it("after a person resolves the return: none / none, reconciliation matched only net of the confirmed return", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    const ret = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    ws = resolveWithEvidence(ws, ret.id, "funds_returned_confirmation");
    expect(intent(ws, id).status).toEqual({ execution: "returned", settlement: "none", settlementScope: "none", reconciliation: "matched" });
  });

  it("return after an on-chain transfer: contradicted / onchain_transfer, also after a recompute", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");
    ws = sim(ws, id).workspace; // in_transit
    ws = sim(ws, id).workspace; // chain observed (0 confirmations)
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_tidewater", { id: `${ppid}-E9`, type: "payout.returned", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "contradicted", settlementScope: "onchain_transfer" });
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_tidewater:settlement", reference: ppid, amountMinor: 6_427_830_000, currency: "USDC" }) }).workspace;
    const rep = listExceptions(ws, { intentId: id, category: "contradictory_evidence", status: "unresolved" }).find((e) => e.explanationCode === "RC_REPORT_ON_TERMINAL_PAYOUT")!;
    ws = resolveWithEvidence(ws, rep.id);
    expect(intent(ws, id).status).toMatchObject({ settlement: "contradicted", settlementScope: "onchain_transfer" });
  });
});
