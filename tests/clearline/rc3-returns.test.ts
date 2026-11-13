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

  it("the sample's returned payout (return credit on the statement, no debit line) does not claim net zero", () => {
    const ws = sampleWorkspace();
    const v = view(ws, scenarioIntentId(ws, "s2_returned")!);
    expect(v.returnPosition).toMatchObject({ returnStatus: "confirmed_by_statement", code: "RT_DEBIT_NOT_ON_STATEMENT", netMovementZero: false, beneficiaryPaid: false, debited: { amountMinor: 0 }, returnCredited: { amountMinor: 1_278_490, currency: "USD" } });
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
