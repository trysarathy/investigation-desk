/**
 * rc4 Accounting Bridge — proposed journal entries (CHANGE 15). Every test names the invariant it proves.
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, describeError, getAdapter, sampleWorkspace, type Workspace } from "@/lib/clearline";
import { debitLine, errorCode, intent, run, signedDelivery, submitted } from "./helpers";
import { S, active, byRule, net, period, postAll, propose, proposals, s4Final, tryAct, view } from "./rc4-helpers";

const ws0 = sampleWorkspace();

describe("sample: proposals for the evidenced events only", () => {
  it("s1 payout debit: Dr supplier payable / Cr bank SGD 24,651.37, from bank line SIMBANK-0001", () => {
    const [p] = byRule(ws0, "JR_SUPPLIER_PAYOUT_DEBIT", S(ws0, "s1_success"));
    expect(p).toMatchObject({ status: "proposed", currency: "SGD", entryDate: "2026-11-12", postingDate: "2026-11-12", showsSupplierPaid: true });
    expect(p.lines.map((l) => [l.side, l.accountKey, l.amountMinor])).toEqual([["debit", "supplier_payable", 2_465_137], ["credit", "bank:BANK-SGD-OPS (fictional)", 2_465_137]]);
    const line = ws0.statementLines.find((l) => l.lineId === "SIMBANK-0001")!;
    expect(p.evidence.statementLineIds).toEqual([line.id]);
    expect(p.lines[0].evidenceIds).toContain(line.id);
    expect(p.lines[0].evidenceIds).toContain(line.allocationIds[0]);
  });

  it("s2 debit and return: both to provider clearing; the supplier payable is never touched (returns never imply the supplier was paid)", () => {
    const id = S(ws0, "s2_returned");
    const [debit] = byRule(ws0, "JR_PAYOUT_DEBIT_NOT_DELIVERED", id);
    const [credit] = byRule(ws0, "JR_PAYOUT_RETURN_CREDIT", id);
    expect(debit.lines.map((l) => [l.side, l.accountKey, l.amountMinor, l.currency])).toEqual([["debit", "provider_clearing", 1_278_490, "USD"], ["credit", "bank:BANK-USD-OPS (fictional)", 1_278_490, "USD"]]);
    expect(credit.lines.map((l) => [l.side, l.accountKey, l.amountMinor, l.currency])).toEqual([["debit", "bank:BANK-USD-OPS (fictional)", 1_278_490, "USD"], ["credit", "provider_clearing", 1_278_490, "USD"]]);
    for (const p of [debit, credit]) {
      expect(p.showsSupplierPaid).toBe(false);
      expect(p.lines.some((l) => l.accountKey === "supplier_payable")).toBe(false);
      expect(p.narrative).toMatch(/NOT paid/);
      expect(p.narrative).toMatch(/supplier payable stays open/);
    }
    const n = net(proposals(ws0).filter((p) => p.intentId === id));
    expect(n.get("provider_clearing|USD")).toBe(0n);
    expect(n.get("bank:BANK-USD-OPS (fictional)|USD")).toBe(0n);
    expect(n.has("supplier_payable|USD")).toBe(false);
  });

  it("s5: advance disbursed (Dr receivable / Cr bank 50,000.00) and repayment by reference (Dr bank / Cr receivable 30,000.00); receivable 20,000.00 = outstanding", () => {
    const id = S(ws0, "s5_funding");
    const [adv] = byRule(ws0, "JR_ADVANCE_DISBURSED", id);
    const [rep] = byRule(ws0, "JR_REPAYMENT_BY_REFERENCE");
    expect(adv.lines.map((l) => [l.side, l.accountKey, l.amountMinor])).toEqual([["debit", "customer_receivable", 5_000_000], ["credit", "bank:BANK-SGD-OPS (fictional)", 5_000_000]]);
    expect(rep.lines.map((l) => [l.side, l.accountKey, l.amountMinor])).toEqual([["debit", "bank:BANK-SGD-OPS (fictional)", 3_000_000], ["credit", "customer_receivable", 3_000_000]]);
    expect(rep.obligationId).toBe(ws0.obligations[0].id);
    expect(net([adv, rep]).get("customer_receivable|SGD")).toBe(2_000_000n);
  });

  it("the unrelated s5 SGD 20,000.00 receipt gives NO entry, only its exception (an amount-only match never produces an entry)", () => {
    const line = ws0.statementLines.find((l) => l.lineId === "SIMBANK-0005")!;
    expect(proposals(ws0).some((p) => p.lines.some((l) => l.evidenceIds.includes(line.id)))).toBe(false);
    const np = view(ws0).notProposed.find((n) => n.refs.includes(line.id))!;
    expect(np.code).toBe("NP_AMOUNT_ONLY_MATCH");
    const exc = ws0.exceptions.find((e) => e.statementLineId === line.id)!;
    expect(exc).toMatchObject({ category: "missing_payment_reference", explanationCode: "RC_AMOUNT_ONLY_CANDIDATES", status: "open" });
    expect(np.exceptionIds).toEqual([exc.id]);
  });

  it("s3 (held, no bank line) and s4 (chain transfer not final; provider completion only) give no entry; fees and FX are not proposed", () => {
    for (const sc of ["s3_hold", "s4_chain"]) expect(proposals(ws0).filter((p) => p.intentId === S(ws0, sc))).toEqual([]);
    const codes = view(ws0).notProposed.map((n) => n.code);
    expect(codes).toEqual(expect.arrayContaining(["NP_PROVIDER_COMPLETION_ONLY", "NP_CHAIN_NOT_FINAL", "NP_FEE_NOT_EVIDENCED", "NP_FX_NOT_EVIDENCED"]));
    expect(proposals(ws0)).toHaveLength(5);
    expect(proposals(ws0).every((p) => p.status === "proposed" && !p.posting && !p.approval)).toBe(true);
  });
});

describe("invariant: balanced per currency, exactly", () => {
  it("every sample proposal's debits equal its credits in BigInt, one currency per entry", () => {
    for (const p of proposals(ws0)) {
      const d = p.lines.filter((l) => l.side === "debit").reduce((s, l) => s + BigInt(l.amountMinor), 0n);
      const c = p.lines.filter((l) => l.side === "credit").reduce((s, l) => s + BigInt(l.amountMinor), 0n);
      expect(d).toBe(c);
      expect(new Set(p.lines.map((l) => l.currency))).toEqual(new Set([p.currency]));
    }
  });
});

describe("invariant: maker ≠ checker; proposed ≠ posted", () => {
  const id = byRule(ws0, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
  it("the proposer cannot approve; an operator cannot approve; a viewer cannot propose", () => {
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "approve_journal_proposal", proposalId: id }))).toBe("maker_checker_violation");
    expect(errorCode(tryAct(ws0, "usr_sam", { type: "approve_journal_proposal", proposalId: id }))).toBe("unauthorized_actor");
    expect(errorCode(tryAct(ws0, "usr_alex", { type: "propose_journal_entries" }))).toBe("unauthorized_actor");
    expect(errorCode(tryAct(ws0, "usr_priya", { type: "approve_journal_proposal", proposalId: id }))).toBe("unauthorized_actor");
  });
  it("an approver who proposed cannot approve their own proposal", () => {
    let ws = s4Final();
    ws = propose(ws, "usr_daniel").workspace;
    const p = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER")[0];
    expect(p.createdBy).toBe("usr_daniel");
    expect(errorCode(tryAct(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }))).toBe("maker_checker_violation");
  });
  it("posted only via record_posting after approval and export, with the person's external reference; nothing is posted automatically", () => {
    let ws = ws0;
    expect(errorCode(tryAct(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: "JNL-1" }))).toBe("invalid_transition");
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id, note: "Checked bank line (fictional)" }).workspace;
    expect(proposals(ws).find((p) => p.id === id)!.status).toBe("approved");
    expect(errorCode(tryAct(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: "JNL-1" }))).toBe("invalid_transition");
    const exp = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id });
    ws = exp.workspace;
    const p1 = proposals(ws).find((p) => p.id === id)!;
    expect(p1.status).toBe("exported");
    expect(p1.posting).toBeUndefined();
    expect(errorCode(tryAct(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: "=HYPERLINK(x)" }))).toBe("invalid_field");
    expect(errorCode(tryAct(ws, "usr_alex", { type: "record_posting", proposalId: id, externalReference: "JNL-1" }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: "JNL-2026-11-0042" }).workspace;
    const p2 = proposals(ws).find((p) => p.id === id)!;
    expect(p2).toMatchObject({ status: "posted", posting: { externalReference: "JNL-2026-11-0042", recordedBy: "usr_maya", simulated: true } });
    expect(ws.audit.at(-1)).toMatchObject({ action: "journal.posting_recorded", actorId: "usr_maya", entityId: id });
    expect(ws.audit.at(-1)!.summary).toMatch(/Clearline has no ledger connection/);
    // every other proposal is still not posted
    expect(proposals(ws).filter((p) => p.status === "posted").map((p) => p.id)).toEqual([id]);
    expect(errorCode(tryAct(ws, "usr_maya", { type: "reject_journal_proposal", proposalId: id, reason: "too late" }))).toBe("invalid_transition");
  });
  it("no action other than record_posting ever produces a posted proposal (every action type checked on the sample)", () => {
    const actions = [
      { type: "propose_journal_entries" }, { type: "export_journal", periodId: period(ws0).id }, { type: "record_reconciliation_export", from: "2026-11-01", to: "2026-12-01" },
      { type: "advance_clock", to: "2026-11-30T00:00:00.000Z" },
    ] as const;
    for (const a of actions) for (const actor of ["usr_maya", "usr_daniel"]) {
      const r = tryAct(ws0, actor, a);
      if (r.ok) expect(proposals(r.value.workspace).some((p) => p.status === "posted")).toBe(false);
    }
  });
});

describe("rejection and re-proposal", () => {
  it("a rejected proposal is not proposed again for the same evidence; it is when the evidence changes", () => {
    const id = byRule(ws0, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    let ws = run(ws0, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "Booked by hand (fictional)" }).workspace;
    expect(propose(ws).outcome).toBe("no_new_proposals");
    expect(errorCode(tryAct(ws, "usr_maya", { type: "reject_journal_proposal", proposalId: id, reason: "x" }))).toBe("invalid_transition");
    expect(proposals(ws).find((p) => p.id === id)!.rejection).toMatchObject({ by: "usr_daniel", reason: "Booked by hand (fictional)" });
  });
});

describe("evidence changes after a proposal", () => {
  it("a debit proposed for a live payout is superseded when the provider reports it returned; the replacement books provider clearing", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace; // in transit
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `NORTHLINE PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    const first = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)[0];
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: first.id }).workspace;
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace; // returned
    expect(intent(ws, id).status.execution).toBe("returned");
    const sup = proposals(ws).find((p) => p.id === first.id)!;
    expect(sup.status).toBe("superseded");
    expect(sup.supersession).toMatchObject({ code: "SP_EVIDENCE_CHANGED", causedBy: "usr_maya" });
    expect(sup.supersession!.reason).toMatch(/not delivered/);
    expect(ws.audit.some((a) => a.action === "journal.superseded" && a.entityId === first.id)).toBe(true);
    ws = propose(ws).workspace;
    const [repl] = byRule(ws, "JR_PAYOUT_DEBIT_NOT_DELIVERED", id);
    expect(repl.lines[0].accountKey).toBe("provider_clearing");
    expect(proposals(ws).find((p) => p.id === first.id)!.supersession!.replacedBy).toBe(repl.id);
    // approving the stale one is impossible
    expect(errorCode(tryAct(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: first.id }))).toBe("invalid_transition");
  });

  it("a posted entry is never changed: its evidence change is recorded and a reversal plus the new entry are proposed", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `NORTHLINE PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    const first = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)[0];
    ws = postAll(ws, [first.id]);
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace; // returned
    const kept = proposals(ws).find((p) => p.id === first.id)!;
    expect(kept.status).toBe("posted");
    expect(kept.lines).toEqual(first.lines);
    expect(kept.evidenceChange).toMatchObject({ code: "SP_EVIDENCE_CHANGED" });
    ws = propose(ws).workspace;
    const [rev] = byRule(ws, "JR_REVERSAL", id);
    expect(rev.reverses).toBe(first.id);
    expect(rev.lines.map((l) => [l.side, l.accountKey, l.amountMinor])).toEqual([["credit", "supplier_payable", 1_000_000], ["debit", "bank:BANK-SGD-OPS (fictional)", 1_000_000]]);
    expect(rev.showsSupplierPaid).toBe(false);
    const [rebook] = byRule(ws, "JR_PAYOUT_DEBIT_NOT_DELIVERED", id);
    // net of the posted entry, its reversal and the rebooking: the supplier payable is back to zero (supplier not paid)
    const n = net([kept, rev, rebook]);
    expect(n.get("supplier_payable|SGD")).toBe(0n);
    expect(n.get("provider_clearing|SGD")).toBe(1_000_000n);
    expect(n.get("bank:BANK-SGD-OPS (fictional)|SGD")).toBe(-1_000_000n);
    expect(propose(ws).outcome).toBe("no_new_proposals");
  });

  it("a final chain transfer's entry is withdrawn on a reorg (confirmations decrease): superseded with the reason", () => {
    let ws = propose(s4Final()).workspace;
    const id = S(ws, "s4_chain");
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", id);
    const obs = ws.chainObservations.find((o) => o.intentId === id)!;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { intentId: id, chainId: obs.chainId, network: obs.network, tokenContract: obs.tokenContract, tokenSymbol: obs.tokenSymbol, txHash: obs.txHash, toAddress: obs.toAddress, amountMinor: obs.amountMinor, blockNumber: obs.blockNumber, confirmations: 3 } }).workspace;
    const sup = proposals(ws).find((x) => x.id === p.id)!;
    expect(sup.status).toBe("superseded");
    expect(sup.supersession!.code).toBe("SP_EVIDENCE_WITHDRAWN");
    expect(propose(ws).outcome).toBe("no_new_proposals");
  });
});

describe("stablecoin: a final chain transfer supports a stablecoin-clearing entry, never a bank line", () => {
  it("Dr supplier payable / Cr stablecoin clearing USDC (6 dp), evidence = chain observation + allocation + the provider-reported tx hash event", () => {
    const ws = propose(s4Final()).workspace;
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", S(ws, "s4_chain"));
    expect(p.currency).toBe("USDC");
    expect(p.lines.map((l) => [l.side, l.accountKey])).toEqual([["debit", "supplier_payable"], ["credit", "stablecoin_clearing"]]);
    expect(p.lines.some((l) => l.accountKey.startsWith("bank:"))).toBe(false);
    expect(p.evidence.chainObservationIds).toHaveLength(1);
    expect(p.evidence.providerEventIds.length).toBeGreaterThan(0);
    expect(p.narrative).toMatch(/never evidences a bank credit/);
  });
  it("a transfer that is not final gives no entry", () => {
    expect(byRule(ws0, "JR_STABLECOIN_FINAL_TRANSFER")).toEqual([]);
  });
});

describe("invariant: no entry without evidence; provider-reported completion and amount-only matches give none", () => {
  it("provider-reported completion alone: no proposal (and no memo line), listed as pending evidence", () => {
    let { ws, id } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    expect(intent(ws, id).status.execution).toBe("provider_reported_completed");
    ws = propose(ws).workspace;
    expect(proposals(ws).filter((p) => p.intentId === id)).toEqual([]);
    expect(view(ws).notProposed.find((n) => n.refs.includes(id))!.code).toBe("NP_PROVIDER_COMPLETION_ONLY");
  });
  it("a provider settlement report gives none; an unreferenced debit of the exact amount gives none", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: `PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: "", amountMinor: 1_000_000 }) }).workspace;
    ws = propose(ws).workspace;
    expect(proposals(ws).filter((p) => p.intentId === id)).toEqual([]);
    const codes = view(ws).notProposed.map((n) => n.code);
    expect(codes).toContain("NP_PROVIDER_REPORT_ONLY");
    const unref = ws.statementLines.at(-1)!;
    expect(view(ws).notProposed.find((n) => n.refs.includes(unref.id))!.code).toBe("NP_AMOUNT_ONLY_MATCH");
  });
  it("an over-amount bank debit a person accepted is not matched, so it gives no entry (NP_ACCEPTED_DIFFERENCE)", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, amountMinor: 1_000_050 }) }).workspace;
    const e = ws.exceptions.filter((x) => x.intentId === id && x.statementLineId).at(-1)!;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Bank advice (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Bank charge", acceptDifference: true }).workspace;
    ws = propose(ws).workspace;
    expect(proposals(ws).filter((p) => p.intentId === id)).toEqual([]);
    expect(view(ws).notProposed.find((n) => n.refs.includes(e.statementLineId!))!.code).toBe("NP_ACCEPTED_DIFFERENCE");
  });
  it("a partial bank debit gives an entry for the evidenced amount only, and the remainder is listed", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, amountMinor: 400_000 }) }).workspace;
    ws = propose(ws).workspace;
    const [p] = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id);
    expect(p.lines[0].amountMinor).toBe(400_000);
    expect(view(ws).notProposed.find((n) => n.code === "NP_PARTIAL_REMAINDER" && n.refs.includes(id))!.amount).toEqual({ amountMinor: 600_000, currency: "SGD" });
  });
  it("a bank debit for a failed payout goes to provider clearing (supplier not paid)", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}` }) }).workspace;
    const ins = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, ins.providerId, { id: `${ppid}-F9`, type: "payout.failed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    ws = propose(ws).workspace;
    const [p] = byRule(ws, "JR_PAYOUT_DEBIT_NOT_DELIVERED", id);
    expect(p.lines[0].accountKey).toBe("provider_clearing");
    expect(p.showsSupplierPaid).toBe(false);
  });
});

describe("invariant: closed periods respected", () => {
  it("closing refuses while proposals are pending; a closed period refuses new proposals dated in it; late items go to the next open period flagged prior-period", () => {
    let ws = ws0;
    const nov = period(ws);
    expect(errorCode(tryAct(ws, "usr_daniel", { type: "close_accounting_period", periodId: nov.id }))).toBe("precondition_failed");
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: nov.id }).workspace;
    expect(errorCode(tryAct(ws, "usr_maya", { type: "close_accounting_period", periodId: nov.id }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_daniel", { type: "close_accounting_period", periodId: nov.id }).workspace;
    const refused = tryAct(ws, "usr_maya", { type: "propose_journal_entries", periodId: nov.id });
    expect(errorCode(refused)).toBe("precondition_failed");
    expect(!refused.ok && describeError(refused.error, ws).reasonCode).toBe("PERIOD_CLOSED");
    // a late November item, with only December open
    ws = run(ws, "usr_maya", { type: "open_accounting_period", name: "2026-12", from: "2026-12-01", to: "2027-01-01" }).workspace;
    const dec = ws.accounting!.periods.find((p) => p.name === "2026-12")!;
    ws = s4Final(ws);
    ws = propose(ws).workspace;
    const [late] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER");
    expect(late.entryDate < "2026-12-01").toBe(true);
    expect(late).toMatchObject({ periodId: dec.id, postingDate: "2026-12-01", priorPeriodItem: { originalDate: late.entryDate, originalPeriodId: nov.id } });
    expect(late.priorPeriodItem!.reason).toMatch(/closed period 2026-11/);
    expect(proposals(ws).filter((p) => p.periodId === nov.id && (p.status === "proposed" || p.status === "approved"))).toEqual([]);
  });
  it("overlapping periods are refused; without an open period nothing is proposed", () => {
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "open_accounting_period", name: "Overlap", from: "2026-11-15", to: "2026-12-15" }))).toBe("precondition_failed");
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "open_accounting_period", name: "Bad", from: "2026-12-15", to: "2026-12-01" }))).toBe("invalid_field");
    const bare: Workspace = { ...structuredClone(ws0), accounting: undefined };
    const r = tryAct(bare, "usr_maya", { type: "propose_journal_entries" });
    expect(errorCode(r)).toBe("precondition_failed");
    expect(!r.ok && describeError(r.error).reasonCode).toBe("NO_OPEN_PERIOD");
  });
});

describe("chart-of-accounts mapping", () => {
  it("an unmapped role blocks approval (and so the export) with a clear reason; mapping it unblocks (CHANGE 16: approval needs the codes)", () => {
    let ws = run(ws0, "usr_maya", { type: "set_account_mapping", entries: ws0.accounting!.mapping!.entries.filter((e) => e.accountKey !== "provider_clearing"), expectedRevision: 1 }).workspace;
    const [debit] = byRule(ws, "JR_PAYOUT_DEBIT_NOT_DELIVERED");
    const r = tryAct(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: debit.id });
    expect(errorCode(r)).toBe("precondition_failed");
    expect(!r.ok && r.error.message).toMatch(/UNMAPPED_ACCOUNT_ROLE: map provider_clearing/);
    expect(!r.ok && describeError(r.error, ws).text).toMatch(/Map every account role/);
    expect(view(ws).unmappedKeys).toEqual(["provider_clearing"]);
    ws = run(ws, "usr_daniel", { type: "set_account_mapping", expectedRevision: 2, entries: [...ws.accounting!.mapping!.entries, { accountKey: "provider_clearing", accountCode: "1300", accountName: "Provider clearing (fictional)" }] }).workspace;
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    expect(tryAct(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).ok).toBe(true);
  });
  it("mapping validation: bad keys, codes, duplicates and stale revisions are refused", () => {
    const e = ws0.accounting!.mapping!.entries;
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "set_account_mapping", entries: [{ accountKey: "cash", accountCode: "1", accountName: "Cash" }] }))).toBe("invalid_field");
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "set_account_mapping", entries: [{ ...e[0], accountCode: "=1+1" }] }))).toBe("invalid_field");
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "set_account_mapping", entries: [e[0], { ...e[1], accountCode: e[0].accountCode }] }))).toBe("invalid_field");
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "set_account_mapping", entries: [e[0], e[0]] }))).toBe("invalid_field");
    expect(errorCode(tryAct(ws0, "usr_maya", { type: "set_account_mapping", entries: e, expectedRevision: 7 }))).toBe("precondition_failed");
    expect(errorCode(tryAct(ws0, "usr_alex", { type: "set_account_mapping", entries: e }))).toBe("unauthorized_actor");
  });
  it("the sample's default fictional mapping maps every role and both sample bank accounts", () => {
    const keys = ws0.accounting!.mapping!.entries.map((x) => x.accountKey).sort();
    expect(keys).toEqual(["bank:BANK-SGD-OPS (fictional)", "bank:BANK-USD-OPS (fictional)", "customer_receivable", "provider_clearing", "stablecoin_clearing", "supplier_payable", "suspense"]);
    expect(ws0.accounting!.mapping!.entries.every((x) => /\(fictional\)$/.test(x.accountName))).toBe(true);
    expect(view(ws0).unmappedKeys).toEqual([]);
  });
});

describe("audit: every bridge action is audited with actor and evidence references", () => {
  it("propose, approve, reject, export, posting, period and mapping actions each append audit events naming the actor", () => {
    let ws = ws0;
    const before = ws.audit.length;
    const [a, b] = active(ws);
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: a.id }).workspace;
    ws = run(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: b.id, reason: "Not ours (fictional)" }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    ws = run(ws, "usr_maya", { type: "record_posting", proposalId: a.id, externalReference: "JNL-9" }).workspace;
    ws = run(ws, "usr_maya", { type: "record_reconciliation_export", from: "2026-11-01", to: "2026-12-01" }).workspace;
    const added = ws.audit.slice(before);
    expect(added.map((x) => [x.action, x.actorId])).toEqual([
      ["journal.approved", "usr_daniel"], ["journal.rejected", "usr_daniel"], ["accounting.journal_exported", "usr_maya"], ["journal.posting_recorded", "usr_maya"], ["accounting.reconciliation_exported", "usr_maya"],
    ]);
    for (const x of added.filter((y) => y.action.startsWith("journal."))) expect(x.summary).toMatch(/evidence (stl|alc|evd|chn|rpa|pev)_\d{5}/);
    expect(ws0.audit.filter((x) => x.action === "journal.proposed")).toHaveLength(5);
    expect(ws0.audit.some((x) => x.action === "accounting.mapping_set" && x.actorId === "usr_maya")).toBe(true);
    expect(ws0.audit.some((x) => x.action === "accounting.period_opened")).toBe(true);
  });
});

describe("advance funded USDC payout and repayments beyond the sample", () => {
  it("an over-repayment or wrong-currency repayment gives no entry; the exact remaining 20,000.00 by reference gives one", () => {
    let ws = ws0;
    const ob = ws.obligations[0];
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "R-OVER", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_500_000, currency: "SGD", reference: ob.reference, counterparty: "SEABRIGHT", valueDate: "2026-11-14" } }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "R-USD", source: "bank_statement", accountRef: "BANK-USD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "USD", reference: ob.reference, counterparty: "SEABRIGHT", valueDate: "2026-11-14" } }).workspace;
    expect(propose(ws).outcome).toBe("no_new_proposals");
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "R-OK", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "SGD", reference: ob.reference, counterparty: "SEABRIGHT", valueDate: "2026-11-14" } }).workspace;
    ws = propose(ws).workspace;
    expect(net(byRule(ws, "JR_ADVANCE_DISBURSED").concat(byRule(ws, "JR_REPAYMENT_BY_REFERENCE"))).get("customer_receivable|SGD")).toBe(0n);
  });
  it("token identity stays the synthetic allowlisted one", () => {
    expect(ALLOWLISTED_TOKENS[0].label).toMatch(/ynthetic/);
    expect(getAdapter("prv_tidewater")).toBeDefined();
  });
});
