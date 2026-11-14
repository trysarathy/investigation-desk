/**
 * rc3 Priority A — proofs for invariants that were ALREADY enforced before rc3 (no engine change needed).
 * Each test pins the behaviour against an adversarial neighbour that the earlier suites did not cover.
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, fundingProjection, getAdapter, investigate, listExceptions, obligationOutstanding, sampleWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { attempt, debitLine, errorCode, intent, later, run, sim, submitted } from "./helpers";

const s5 = () => {
  const ws = sampleWorkspace();
  const row = fundingProjection(ws).rows[0];
  return { ws, row, ob: row.obligation! };
};
let lineNo = 0;
const credit = (o: Record<string, unknown>) => ({ lineId: `RC3-C-${++lineNo}`, source: "bank_statement" as const, accountRef: "BANK-SGD-OPS (fictional)", direction: "credit" as const, kind: "payment" as const, amountMinor: 2_000_000, currency: "SGD" as const, reference: "", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-13", ...o });

describe("invariant 4 — reconciliation never allocates by amount alone and preserves ambiguity", () => {
  it("an outgoing debit equal to two submitted payouts' amounts allocates to neither and keeps both candidates", () => {
    const a = submitted({ amountMinor: 777_700 });
    const b = submitted({ amountMinor: 777_700, internalReference: "INV-RC3-AMB-2" }, "prv_northline", a.ws);
    const r = run(b.ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: 777_700, reference: "SUPPLIER PAYMENT" }) });
    expect(r.outcome).toBe("exception_raised");
    expect(r.workspace.allocations).toHaveLength(0);
    const e = listExceptions(r.workspace, { status: "unresolved" }).find((x) => x.explanationCode === "RC_AMOUNT_ONLY_CANDIDATES")!;
    expect(e.candidates.sort()).toEqual([a.id, b.id].sort());
  });
  it("an incoming credit quoting two obligations' references allocates to neither (ambiguity preserved)", () => {
    let { ws } = s5();
    const s1 = scenarioIntentId(ws, "s1_success")!;
    ws = run(ws, "usr_maya", { type: "create_advance", input: { intentId: s1, customerRef: "CUST-RC3", customerName: "Second Customer (fictional)", supplierName: "Oakwell Engineering (fictional)", invoiceRef: "INV-RC3-77", dueDate: "2026-12-01", repaymentReference: "RPY-RC3-0002" } }).workspace;
    const adv = ws.advances.at(-1)!;
    ws = run(ws, "usr_daniel", { type: "decide_advance", advanceId: adv.id, outcome: "approve", reason: "Fictional approval" }).workspace;
    const before = ws.repaymentAllocations.length;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "RPY-SEABRIGHT-0001 RPY-RC3-0002" }) });
    expect(r.outcome).toBe("exception_raised");
    expect(r.workspace.repaymentAllocations).toHaveLength(before);
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_AMBIGUOUS_REFERENCE");
  });
  it("the same statement line can never be ingested twice; a look-alike line is flagged, not allocated again", () => {
    const { ws, id, ppid } = submitted();
    const line = debitLine({ reference: `PAYOUT ${ppid}` });
    const w = run(ws, "usr_maya", { type: "ingest_statement_line", line }).workspace;
    expect(errorCode(attempt(w, "usr_maya", { type: "ingest_statement_line", line }))).toBe("duplicate_statement_line");
    const again = run(w, "usr_maya", { type: "ingest_statement_line", line: { ...line, lineId: line.lineId + "-B" } });
    expect(again.outcome).toBe("exception_raised");
    expect(again.workspace.allocations.filter((a) => a.target.kind === "payment" && a.target.intentId === id)).toHaveLength(1);
  });
});

describe("invariant 5 — stablecoin evidence: each identity field, destination and exact amount", () => {
  const usdc = () => submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");
  const base = (ws: Workspace, id: string) => ({
    intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC",
    txHash: "0x" + "12".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(intent(ws, id)),
    amountMinor: ws.quotes.find((q) => q.id === intent(ws, id).selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 7, confirmations: 12,
  });
  const cases: [string, (b: ReturnType<typeof base>) => Record<string, unknown>, string][] = [
    ["chain id", (b) => ({ ...b, chainId: 8453 }), "exception_raised"],
    ["network name", (b) => ({ ...b, network: "base-mainnet" }), "exception_raised"],
    ["contract address", (b) => ({ ...b, tokenContract: "0x" + "0".repeat(39) + "1" }), "exception_raised"],
    ["token symbol", (b) => ({ ...b, tokenSymbol: "USDT" }), "exception_raised"],
    ["destination wallet", (b) => ({ ...b, toAddress: "0x" + "9".repeat(40) }), "contradictory_exception_raised"],
    ["amount one minor unit short (6 dp)", (b) => ({ ...b, amountMinor: b.amountMinor - 1 }), "contradictory_exception_raised"],
    ["amount one minor unit over (6 dp)", (b) => ({ ...b, amountMinor: b.amountMinor + 1 }), "contradictory_exception_raised"],
  ];
  for (const [what, mutate, outcome] of cases)
    it(`a final transfer with the wrong ${what} is never counted`, () => {
      let { ws, id } = usdc();
      ws = sim(ws, id).workspace;
      const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: mutate(base(ws, id)) as never });
      expect(r.outcome).toBe(outcome);
      expect(intent(r.workspace, id).status.settlement).toBe("none");
    });
  it("finality threshold: 11 confirmations is pending, 12 is final; a chain observation never touches a fiat payout", () => {
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...base(ws, id), confirmations: 11 } }).workspace;
    expect(intent(ws, id).status.settlement).toBe("pending_finality");
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...base(ws, id), confirmations: 12 } }).workspace;
    expect(intent(ws, id).status.settlement).toBe("verified");
    const fiat = sampleWorkspace();
    const s1 = scenarioIntentId(fiat, "s1_success")!;
    const r = attempt(fiat, "usr_maya", { type: "ingest_chain_observation", observation: { ...base(ws, id), intentId: s1 } });
    expect(errorCode(r)).toBe("precondition_failed");
  });
});

describe("invariant 6 — funding: SGD 50,000 / 30,000 / 20,000 and what must never close it", () => {
  it("the sample keeps the scenario exactly", () => {
    const { ws, row, ob } = s5();
    expect(row.principal).toEqual({ amountMinor: 5_000_000, currency: "SGD" });
    expect(row.repaid).toEqual({ amountMinor: 3_000_000, currency: "SGD" });
    expect(row.outstanding).toEqual({ amountMinor: 2_000_000, currency: "SGD" });
    expect(row.allocations).toHaveLength(1);
    expect(ws.statementLines.find((l) => l.id === row.allocations[0].statementLineId)!.reference).toMatch(/^RPY-SEABRIGHT-0001\b/);
    expect(ob.reference).toBe("RPY-SEABRIGHT-0001");
  });
  it("an unrelated SGD 20,000.00 receipt with another reference never closes it — not now, not after the due date, not by resolving its exception", () => {
    let { ws, ob } = s5();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "INVOICE 4471 ACME (fictional)", counterparty: "OTHER CUSTOMER" }) }).workspace;
    expect(obligationOutstanding(ws, ob.id).amountMinor).toBe(2_000_000);
    const e = ws.exceptions.at(-1)!;
    expect(e.explanationCode).toBe("RC_AMOUNT_ONLY_CANDIDATES");
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-25T02:00:00.000Z" }).workspace;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Remittance advice (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Not the customer's repayment" }).workspace;
    expect(obligationOutstanding(ws, ob.id).amountMinor).toBe(2_000_000);
    expect(fundingProjection(ws).rows[0]).toMatchObject({ state: "overdue", outstanding: { amountMinor: 2_000_000 } });
    const od = listExceptions(ws, { category: "overdue_advance" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: od.id }, ownerId: "usr_maya" }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: od.id }, note: "x" }))).toBe("resolution_not_permitted");
  });
  it("over-repayment, wrong currency and a partial repayment are each flagged", () => {
    const { ws, ob } = s5();
    const over = run(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "RPY-SEABRIGHT-0001", amountMinor: 2_000_001 }) });
    expect(over.outcome).toBe("exception_raised");
    expect(over.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OVERPAYMENT");
    expect(obligationOutstanding(over.workspace, ob.id).amountMinor).toBe(2_000_000);
    const fx = run(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "RPY-SEABRIGHT-0001", currency: "USD", accountRef: "BANK-USD-OPS (fictional)" }) });
    expect(fx.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    expect(obligationOutstanding(fx.workspace, ob.id).amountMinor).toBe(2_000_000);
    const part = run(ws, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "RPY-SEABRIGHT-0001", amountMinor: 500_000 }) });
    expect(part.outcome).toBe("allocated");
    expect(part.workspace.statementLines.at(-1)!.explanationCodes).toEqual(expect.arrayContaining(["RC_REPAYMENT_BY_REFERENCE", "RC_PARTIAL_AMOUNT"]));
    expect(fundingProjection(part.workspace).rows[0]).toMatchObject({ state: "partly_repaid", outstanding: { amountMinor: 1_500_000 } });
    const v = investigate(part.workspace, scenarioIntentId(ws, "s5_funding")!);
    expect(v.ok && v.value.outstanding.find((o) => o.code === "OS_ADVANCE_OUTSTANDING")!.amount).toEqual({ amountMinor: 1_500_000, currency: "SGD" });
  });
});

describe("invariant 7 — human decisions", () => {
  it("funding approval: the preparer cannot approve; a non-approver cannot approve", () => {
    let { ws } = s5();
    const s1 = scenarioIntentId(ws, "s1_success")!;
    const a = run(ws, "usr_maya", { type: "create_advance", input: { intentId: s1, customerRef: "CUST-RC3", customerName: "Second Customer (fictional)", supplierName: "Oakwell Engineering (fictional)", invoiceRef: "INV-RC3-78", dueDate: "2026-12-01", repaymentReference: "RPY-RC3-0003" } });
    ws = a.workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "self" }))).toBe("maker_checker_violation");
    expect(errorCode(attempt(ws, "usr_sam", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "peer operator" }))).toBe("unauthorized_actor");
  });
  it("hold decision: the compliance reviewer cannot be the person who submitted the documents (stored data)", () => {
    const ws = sampleWorkspace();
    const h = ws.holds[0];
    const w = structuredClone(ws);
    w.holds[0].submittedDocuments.push({ name: "Invoice", evidenceId: "evd_x", at: ws.asOf, by: "usr_priya" });
    expect(errorCode(attempt(w, "usr_priya", { type: "record_hold_decision", holdId: h.id, decision: "release", reason: "ok" }))).toBe("maker_checker_violation");
  });
  it("a compliance hold is never released by a timer, a provider event, or a partner release alone", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s3_hold")!;
    const h = ws.holds[0];
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2027-06-01T00:00:00.000Z" }).workspace;
    for (const inj of ["none", "contradictory", "duplicate"] as const) {
      const r = attempt(ws, "usr_maya", { type: "simulate_provider_event", intentId: id, injection: inj });
      if (r.ok) ws = r.value.workspace;
    }
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: h.id, documents: ["Supporting commercial invoice"] }, later(ws, 1)).workspace;
    ws = sim(ws, id).workspace; // partner reports hold released
    expect(ws.holds[0].status).toBe("partner_release_reported");
    expect(intent(ws, id).status.execution).toBe("on_hold");
    expect(ws.holds[0].autoRelease).toBe(false);
  });
});
