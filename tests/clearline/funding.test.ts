import { describe, expect, it } from "vitest";
import { FUNDING_PROJECTION_LABEL, canResolveException, emptyWorkspace, formatMoney, fundingProjection, investigate, listExceptions, obligationOutstanding, sampleWorkspace, type Workspace } from "@/lib/clearline";
import { attempt, created, debitLine, errorCode, run, sim } from "./helpers";

const REF = "RPY-CUST-0001";
function funded(principal = 5_000_000) {
  let { ws, id } = created({ amountMinor: principal, destinationCurrency: "SGD", destinationCountry: "SG" });
  const a = run(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "CUST-1", customerName: "Customer One (fictional)", supplierName: "Supplier One (fictional)", invoiceRef: "INV-S1", dueDate: "2026-11-20", repaymentReference: REF } });
  ws = run(a.workspace, "usr_daniel", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "Within limit (fictional)" }).workspace;
  ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
  const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_northline")!;
  const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
  ws = run(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] }).workspace;
  ws = run(ws, "usr_maya", { type: "submit_instruction", instructionId: c.createdIds[0] }).workspace;
  ws = sim(sim(ws, id).workspace, id).workspace;
  return { ws, id, advanceId: a.createdIds[0] };
}
const credit = (o: Record<string, unknown>) => debitLine({ direction: "credit", counterparty: "CUSTOMER ONE", ...o });
const ing = (ws: Workspace, o: Record<string, unknown>) => run(ws, "usr_maya", { type: "ingest_statement_line", line: credit(o) });
const row = (ws: Workspace) => fundingProjection(ws).rows[0];

describe("Funding Desk projection: SGD 50,000 / 30,000 / 20,000", () => {
  it("advance SGD 50,000.00, reference repayment SGD 30,000.00 → SGD 20,000.00 outstanding with due date and evidence", () => {
    let { ws } = funded();
    expect(row(ws).state).toBe("supplier_paid");
    ws = ing(ws, { amountMinor: 3_000_000, reference: `${REF} PART` }).workspace;
    const r = row(ws);
    expect(formatMoney(r.principal)).toBe("SGD 50,000.00");
    expect(formatMoney(r.repaid)).toBe("SGD 30,000.00");
    expect(formatMoney(r.outstanding)).toBe("SGD 20,000.00");
    expect(r.obligation).toMatchObject({ dueDate: "2026-11-20", reference: REF });
    expect(r.allocations).toHaveLength(1);
    expect(ws.evidence.find((e) => e.id === r.allocations[0].evidenceId)?.independent).toBe(true);
    expect(r.state).toBe("partly_repaid");
    expect(r.fundingDeskStage).toBe("partly_repaid");
    expect(r.treasuryApproval).toMatchObject({ makerId: "usr_maya", checkerId: "usr_daniel" });
  });
  it("a SGD 20,000.00 receipt WITHOUT the reference does not close the obligation", () => {
    let { ws } = funded();
    ws = ing(ws, { amountMinor: 3_000_000, reference: REF }).workspace;
    const r = ing(ws, { amountMinor: 2_000_000, reference: "" });
    expect(r.outcome).toBe("exception_raised");
    expect(formatMoney(row(r.workspace).outstanding)).toBe("SGD 20,000.00");
    const e = r.workspace.exceptions.at(-1)!;
    expect(e.category).toBe("missing_payment_reference");
    expect(e.explanationCode).toBe("RC_AMOUNT_ONLY_CANDIDATES");
    expect(e.candidates).toEqual([row(r.workspace).obligation!.id]);
    expect(row(r.workspace).exceptionIds).toContain(e.id);
    // resolving the exception never allocates
    let ws2 = run(r.workspace, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws2 = run(ws2, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "note", description: "Customer says this was for another invoice" } }).workspace;
    ws2 = run(ws2, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Not attributable without reference" }).workspace;
    expect(formatMoney(row(ws2).outstanding)).toBe("SGD 20,000.00");
    // a referenced 20,000 then closes it
    const done = ing(r.workspace, { amountMinor: 2_000_000, reference: REF, valueDate: "2026-11-14" }).workspace;
    expect(row(done).outstanding.amountMinor).toBe(0);
    expect(row(done).state).toBe("repaid");
  });
  it("a different unknown reference with a matching amount is unmatched, not allocated", () => {
    let { ws } = funded();
    const r = ing(ws, { amountMinor: 5_000_000, reference: "RPY-SOMEONE-ELSE" });
    expect(r.workspace.exceptions.at(-1)!.category).toBe("unmatched_reconciliation");
    expect(row(r.workspace).repaid.amountMinor).toBe(0);
  });
  it("duplicate repayment lines and overpayments are not allocated", () => {
    let { ws } = funded();
    ws = ing(ws, { lineId: "R1", amountMinor: 1_000_000, reference: REF }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ lineId: "R1", amountMinor: 1_000_000, reference: REF }) }))).toBe("duplicate_statement_line");
    const dup = ing(ws, { lineId: "R2", amountMinor: 1_000_000, reference: REF });
    expect(dup.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_DUPLICATE_SUSPECTED");
    expect(row(dup.workspace).repaid.amountMinor).toBe(1_000_000);
    const over = ing(ws, { amountMinor: 4_000_001, reference: REF, valueDate: "2026-11-14" });
    expect(over.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OVERPAYMENT");
  });
  it("currency mismatch on a repayment is not allocated", () => {
    let { ws } = funded();
    const r = ing(ws, { amountMinor: 3_000_000, reference: REF, currency: "USD" });
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    expect(row(r.workspace).repaid.amountMinor).toBe(0);
  });
  it("overdue after the due date opens overdue_advance, resolvable only when nothing is outstanding", () => {
    let { ws } = funded();
    ws = ing(ws, { amountMinor: 3_000_000, reference: REF }).workspace;
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-21T02:00:00Z" }).workspace;
    expect(row(ws).state).toBe("overdue");
    const e = listExceptions(ws, { category: "overdue_advance" })[0];
    expect(e.impact).toEqual({ amountMinor: 2_000_000, currency: "SGD" });
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    expect(canResolveException(ws, e.id).code).toBe("OUTSTANDING_REMAINS");
  });
  it("treasury approval must come from a different person; approvers only", () => {
    let { ws, id } = created({ amountMinor: 100_000, destinationCurrency: "SGD", destinationCountry: "SG" });
    const a = run(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "C2", customerName: "Customer Two", supplierName: "Supplier Two", invoiceRef: "INV-2", dueDate: "2026-11-30", repaymentReference: "RPY-C2-0001" } });
    expect(errorCode(attempt(a.workspace, "usr_sam", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "x" }))).toBe("unauthorized_actor");
    const ws2 = { ...a.workspace, advances: a.workspace.advances.map((x) => ({ ...x, preparedBy: "usr_daniel" })) };
    expect(errorCode(attempt(ws2, "usr_daniel", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "x" }))).toBe("maker_checker_violation");
    expect(errorCode(attempt(a.workspace, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "C2", customerName: "Customer Two", supplierName: "Supplier Two", invoiceRef: "INV-2", dueDate: "2026-11-30", repaymentReference: "RPY-C2-0002" } }))).toBe("precondition_failed");
  });
  it("funding shortfall (fresh usable liquidity below principal) opens an exception and blocks approval", () => {
    let { ws, id } = created({ amountMinor: 24_000_000, destinationCurrency: "SGD", destinationCountry: "SG" });
    const a = run(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "C3", customerName: "Customer Three", supplierName: "Supplier Three", invoiceRef: "INV-3", dueDate: "2026-11-30", repaymentReference: "RPY-C3-0001" } });
    expect(a.workspace.exceptions.some((e) => e.category === "funding_shortfall")).toBe(true);
    expect(errorCode(attempt(a.workspace, "usr_daniel", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "x" }))).toBe("precondition_failed");
    const d = run(a.workspace, "usr_daniel", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "decline", reason: "Insufficient free cash" });
    expect(fundingProjection(d.workspace).rows[0].state).toBe("declined");
    expect(d.workspace.obligations).toHaveLength(0);
  });
  it("is labelled as a projection, not a shared ledger; totals per currency", () => {
    const p = fundingProjection(emptyWorkspace());
    expect(p.label).toBe(FUNDING_PROJECTION_LABEL);
    expect(p.label).toMatch(/Not a shared production ledger/);
  });
  it("the sample workspace carries scenario 5 exactly", () => {
    const ws = sampleWorkspace();
    const r = fundingProjection(ws).rows[0];
    expect(formatMoney(r.principal)).toBe("SGD 50,000.00");
    expect(formatMoney(r.repaid)).toBe("SGD 30,000.00");
    expect(formatMoney(r.outstanding)).toBe("SGD 20,000.00");
    expect(obligationOutstanding(ws, r.obligation!.id).amountMinor).toBe(2_000_000);
    expect(r.exceptionIds.map((id) => ws.exceptions.find((e) => e.id === id)!.category)).toContain("missing_payment_reference");
    const v = investigate(ws, r.intentId);
    expect(v.ok && v.value.outstanding.map((o) => o.code)).toEqual(expect.arrayContaining(["OS_ADVANCE_OUTSTANDING", "OS_UNALLOCATED_RECEIPT"]));
  });
});
