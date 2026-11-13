import { describe, expect, it } from "vitest";
import { listExceptions } from "@/lib/clearline";
import { attempt, debitLine, errorCode, intent, run, sim, submitted } from "./helpers";

const completed = (o = {}) => {
  let { ws, id, ppid } = submitted(o);
  ws = sim(ws, id).workspace;
  ws = sim(ws, id).workspace;
  return { ws, id, ppid };
};
const ingest = (ws: Parameters<typeof run>[0], line: ReturnType<typeof debitLine>) => run(ws, "usr_maya", { type: "ingest_statement_line", line });

describe("reconciliation", () => {
  it("exact trusted reference + amount + currency + window matches and verifies the debit", () => {
    const { ws, id, ppid } = completed();
    const r = ingest(ws, debitLine({ reference: `PAYOUT ${ppid}` }));
    expect(r.outcome).toBe("allocated");
    expect(intent(r.workspace, id).status).toEqual({ execution: "provider_reported_completed", settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    expect(r.workspace.allocations[0].codes).toContain("RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW");
  });
  it("an amount-only match never allocates", () => {
    const { ws, id } = completed();
    const r = ingest(ws, debitLine({ reference: "SOMETHING ELSE" }));
    expect(r.outcome).toBe("exception_raised");
    expect(r.workspace.allocations).toHaveLength(0);
    expect(intent(r.workspace, id).status.reconciliation).toBe("pending");
    const e = r.workspace.exceptions.at(-1)!;
    expect(e.explanationCode).toBe("RC_AMOUNT_ONLY_CANDIDATES");
    expect(e.candidates).toEqual([id]);
    const noRef = ingest(ws, debitLine({ reference: "" }));
    expect(noRef.workspace.exceptions.at(-1)!.category).toBe("missing_payment_reference");
  });
  it("unknown reference with no amount candidates is unmatched outgoing", () => {
    const { ws } = completed();
    const r = ingest(ws, debitLine({ reference: "XYZ", amountMinor: 777 }));
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_UNMATCHED_OUTGOING");
  });
  it("ambiguous references are preserved, never resolved by picking one", () => {
    const a = completed();
    const b = completed({}, );
    // put b's payment into a's workspace by building b on top of a
    let ws = a.ws;
    const second = submitted({}, "prv_northline", ws);
    ws = second.ws;
    const r = ingest(ws, debitLine({ reference: `${a.ppid} ${second.ppid}` }));
    const e = r.workspace.exceptions.at(-1)!;
    expect(e.explanationCode).toBe("RC_AMBIGUOUS_REFERENCE");
    expect(e.candidates.sort()).toEqual([a.id, second.id].sort());
    expect(r.workspace.allocations).toHaveLength(0);
    void b;
  });
  it("partial lines leave the remainder outstanding, the next part completes the match", () => {
    const { ws, id, ppid } = completed();
    let r = ingest(ws, debitLine({ reference: ppid, amountMinor: 400_000 }));
    expect(intent(r.workspace, id).status).toMatchObject({ reconciliation: "partially_matched", settlement: "observed" });
    r = ingest(r.workspace, debitLine({ reference: ppid, amountMinor: 600_000, valueDate: "2026-11-14" }));
    expect(intent(r.workspace, id).status).toMatchObject({ reconciliation: "matched", settlement: "verified" });
  });
  it("rejects a re-ingested statement line id and flags duplicate-looking lines", () => {
    const { ws, ppid } = completed();
    const line = debitLine({ reference: ppid });
    const r = ingest(ws, line);
    expect(errorCode(attempt(r.workspace, "usr_maya", { type: "ingest_statement_line", line }))).toBe("duplicate_statement_line");
    const dup = ingest(r.workspace, { ...line, lineId: "OTHER-ID" });
    expect(dup.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_DUPLICATE_SUSPECTED");
    expect(dup.workspace.allocations).toHaveLength(1);
  });
  it("currency mismatch is never matched", () => {
    const { ws, ppid } = completed();
    const r = ingest(ws, debitLine({ reference: ppid, currency: "USD" }));
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    expect(r.workspace.allocations).toHaveLength(0);
  });
  it("outside the time window is not matched; a late-arriving statement in window is matched with a code", () => {
    const { ws, ppid } = completed();
    expect(ingest(ws, debitLine({ reference: ppid, valueDate: "2026-12-30" })).workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OUTSIDE_TIME_WINDOW");
    const late = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid }) }, "2026-11-19T00:00:00Z");
    expect(late.workspace.allocations[0].codes).toContain("RC_LATE_STATEMENT");
  });
  it("overpayment against a trusted reference is not allocated", () => {
    const { ws, ppid } = completed();
    expect(ingest(ws, debitLine({ reference: ppid, amountMinor: 1_000_001 })).workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OVERPAYMENT");
  });
  it("a provider settlement report is provider-reported: observed, never allocated or matched (review M1)", () => {
    const { ws, id, ppid } = completed();
    const r = ingest(ws, debitLine({ reference: ppid, source: "provider_settlement_report", accountRef: "prv_northline:settlement" }));
    expect(r.outcome).toBe("recorded_provider_report");
    expect(intent(r.workspace, id).status).toMatchObject({ settlement: "observed", settlementScope: "provider_report", reconciliation: "pending" });
    expect(r.workspace.allocations).toHaveLength(0);
    expect(r.workspace.statementLines.at(-1)!.explanationCodes).toContain("RC_PROVIDER_REPORT_ONLY");
  });
  it("a return line confirms a provider-reported return", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(ws, id).workspace;
    ws = sim(ws, id).workspace;
    const r = ingest(ws, debitLine({ reference: `RETURN ${ppid}`, direction: "credit", kind: "return" }));
    expect(r.outcome).toBe("allocated");
    const e = listExceptions(r.workspace, { intentId: id, category: "returned_payout" })[0];
    expect(e.status).not.toBe("resolved");
    expect(e.supportingEvidenceIds.length).toBeGreaterThan(0);
  });
  it("a reversal contradicting the provider's completion is a contradiction", () => {
    const { ws, id, ppid } = completed();
    let r = ingest(ws, debitLine({ reference: ppid }));
    r = ingest(r.workspace, debitLine({ reference: `REVERSAL ${ppid}`, direction: "credit", kind: "reversal" }));
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status).toMatchObject({ settlement: "contradicted", reconciliation: "exception" });
  });
});
