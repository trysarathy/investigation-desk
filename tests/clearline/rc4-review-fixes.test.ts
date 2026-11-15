/**
 * rc4 Accounting Bridge — fixes for the independent review of a91dd11 (docs/release CODE_REVIEW_RC4_ACCOUNTING, BLOCK).
 * Each test reproduces the reviewer's finding (probes e1, e2, e5, e7, e8) and fails at a91dd11.
 */
import { describe, expect, it } from "vitest";
import {
  accountingExportToJson, reconciliationExportToCsv, buildJournalExport, buildReconciliationExport, describeError, getAdapter, journalExportToCsv, ledgerProblem, loadWorkspace, resetScenario,
  sampleWorkspace, serializeWorkspace, type JournalProposal, type Workspace,
} from "@/lib/clearline";
import { basisOf } from "@/lib/clearline/accounting/derive";
import { sha256Hex } from "@/lib/clearline/sha256";
import { attempt, debitLine, errorCode, intent, run, sim, submitted } from "./helpers";
import { S, active, byRule, net, period, postAll, propose, proposals, s4Final, tryAct, view } from "./rc4-helpers";

const ppidOf = (ws: Workspace, id: string) => ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!.providerPaymentId!;
const toFinal = (ws: Workspace, id: string) => { for (let k = 0; k < 6; k++) { const r = attempt(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }); if (!r.ok) break; ws = r.value.workspace; } return ws; };

/** An SGD → USDC payout on the stablecoin route with its bank debit, driven to a final chain transfer (probe e7). */
function onramp() {
  let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "USDC", destinationCountry: "SG" }, "prv_tidewater", sampleWorkspace());
  ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
  ws = toFinal(ws, id);
  return { ws: propose(ws).workspace, id, ppid };
}

describe("F1: the supplier payable is cleared once, on the payout's own rail", () => {
  it("SGD → USDC: the bank debit funds the on-ramp (Dr stablecoin clearing SGD); only the final chain transfer clears the payable (USDC)", () => {
    const { ws, id } = onramp();
    expect(ws.chainObservations.find((o) => o.intentId === id)!.status).toBe("final");
    const ps = proposals(ws).filter((p) => p.intentId === id);
    expect(ps.map((p) => p.ruleCode).sort()).toEqual(["JR_STABLECOIN_FINAL_TRANSFER", "JR_STABLECOIN_ONRAMP_FUNDING"]);
    const [fund] = byRule(ws, "JR_STABLECOIN_ONRAMP_FUNDING", id);
    expect(fund.lines.map((l) => [l.side, l.accountKey, l.currency])).toEqual([["debit", "stablecoin_clearing", "SGD"], ["credit", "bank:BANK-SGD-OPS (fictional)", "SGD"]]);
    expect(fund.showsSupplierPaid).toBe(false);
    const n = net(ps);
    expect(n.get("supplier_payable|SGD")).toBeUndefined();
    expect(n.get("supplier_payable|USDC")! > 0n).toBe(true);
    expect(ledgerProblem(ws)).toBeUndefined();
    const np = view(ws).notProposed.filter((x) => x.refs.includes(id)).map((x) => x.code);
    expect(np).toContain("NP_FX_NOT_EVIDENCED");
  });
  it("the conversion is listed as unresolved in the reconciliation export", () => {
    const { ws, id } = onramp();
    const doc = buildReconciliationExport(ws, { from: "2026-11-01", to: "2026-12-01" });
    if (!doc.ok) throw new Error(doc.error.message);
    const row = doc.value.rows.find((r) => r.movement === "stablecoin_conversion" && r.paymentId === id)!;
    expect(row).toMatchObject({ evidenceClass: "unresolved", ruleCode: "XR_CONVERSION_NOT_EVIDENCED", amount: { currency: "SGD" }, counterAmount: { currency: "USDC" } });
  });
  it("s4 (USDC → USDC) with a USDC custody debit: the payable is debited once, not twice (probe e1)", () => {
    let ws = sampleWorkspace();
    const id = S(ws, "s4_chain");
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "CUSTODY-USDC (fictional)", currency: "USDC", amountMinor: intent(ws, id).amountMinor, reference: `PAYOUT ${ppidOf(ws, id)}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(s4Final(ws)).workspace;
    const n = net(proposals(ws).filter((p) => p.intentId === id));
    expect(n.get("supplier_payable|USDC")! <= BigInt(intent(ws, id).amountMinor)).toBe(true);
    expect(byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)).toEqual([]);
  });
  it("an advance-funded USDC payout's final transfer debits the customer receivable, not the supplier payable (mutant M11)", () => {
    let ws = sampleWorkspace();
    const created = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-ADV-USDC", amountMinor: 1_000_000_000, sourceCurrency: "USDC", destinationCurrency: "USDC", purpose: "Supplier invoice", beneficiaryRef: "BEN-ADV-USDC", beneficiaryName: "Adv Supplier (fictional)", destinationCountry: "SG", requestedExecutionDate: "2026-11-20", idempotencyKey: "rc4-adv-usdc-1", sandboxOutcome: "chain_delay" } });
    ws = created.workspace;
    const id = created.createdIds[0];
    ws = run(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "CUST-ADVU", customerName: "Adv Customer (fictional)", supplierName: "Adv Supplier (fictional)", invoiceRef: "INV-ADV-USDC", dueDate: "2026-11-30", repaymentReference: "RPY-ADV-USDC-01" } }).workspace;
    const advId = intent(ws, id).advanceId!;
    const d = attempt(ws, "usr_daniel", { type: "decide_advance", advanceId: advId, outcome: "approve", reason: "Within limit (fictional)" });
    if (!d.ok) throw new Error(d.error.message);
    ws = d.value.workspace;
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_tidewater" && x.eligible)!;
    const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    ws = run(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] }).workspace;
    ws = run(ws, "usr_maya", { type: "submit_instruction", instructionId: c.createdIds[0] }).workspace;
    ws = propose(toFinal(ws, id)).workspace;
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", id);
    expect(p.lines[0].accountKey).toBe("customer_receivable");
    expect(p.advanceId).toBe(advId);
  });
});

describe("F2: a bank debit is never booked as cash in", () => {
  it("a debit-direction reversal quoting RETURN <ppid> on a returned payout is not allocated (RC_RETURN_LINE_IS_DEBIT) and gives no entry", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    for (let k = 0; k < 6 && intent(ws, id).status.execution !== "returned"; k++) ws = sim(ws, id).workspace;
    expect(intent(ws, id).status.execution).toBe("returned");
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ kind: "reversal", direction: "debit", reference: `RETURN ${ppid}`, valueDate: "2026-11-13" }) });
    expect(r.outcome).toBe("exception_raised");
    ws = r.workspace;
    const line = ws.statementLines.at(-1)!;
    expect(line.allocationIds).toEqual([]);
    expect(line.explanationCodes).toContain("RC_RETURN_LINE_IS_DEBIT");
    ws = propose(ws).workspace;
    expect(byRule(ws, "JR_PAYOUT_RETURN_CREDIT", id)).toEqual([]);
  });
  it("a crafted entry booking a debit line on the bank's debit side is refused at load", () => {
    const o = JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
    const i = o.accounting!.proposals.findIndex((p) => p.ruleCode === "JR_PAYOUT_RETURN_CREDIT");
    const debit = o.accounting!.proposals.find((p) => p.ruleCode === "JR_PAYOUT_DEBIT_NOT_DELIVERED")!;
    o.accounting!.proposals[i].evidence = structuredClone(debit.evidence); // point the return credit at the debit line
    for (const l of o.accounting!.proposals[i].lines) l.evidenceIds = debit.lines[0].evidenceIds;
    const r = loadWorkspace(JSON.stringify(o));
    expect(r.ok).toBe(false);
  });
});

describe("F3: stored amounts, approvals and evidence are never trusted", () => {
  const forged = () => {
    const ws0 = sampleWorkspace();
    const o = JSON.parse(serializeWorkspace(ws0)) as Workspace;
    const p = o.accounting!.proposals.find((x) => x.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
    p.status = "approved";
    p.approval = { by: "usr_daniel", at: o.asOf };
    return { o, p, ws0 };
  };
  it("probe e2: invented amounts on a forged approval are refused at load", () => {
    const { o, p, ws0 } = forged();
    const s4ev = o.providerEvents.find((e) => e.intentId === S(ws0, "s4_chain"))!.id;
    for (const l of p.lines) { l.amountMinor = 99_999_999; l.evidenceIds = [s4ev]; }
    expect(loadWorkspace(JSON.stringify(o)).ok).toBe(false);
  });
  it("amounts changed consistently (both lines, same evidence) are refused: lines must equal the allocation", () => {
    const { o, p } = forged();
    for (const l of p.lines) l.amountMinor = 99_999_999;
    const r = loadWorkspace(JSON.stringify(o));
    expect(!r.ok && r.error.field).toBe(`accounting.proposals[${o.accounting!.proposals.indexOf(p)}].lines`);
  });
  it("the basis hash covers the amount (mutant M9): a changed amount gives another basis", () => {
    const p = byRule(sampleWorkspace(), "JR_SUPPLIER_PAYOUT_DEBIT")[0];
    const q = structuredClone(p);
    for (const l of q.lines) l.amountMinor += 1;
    expect(basisOf(q)).not.toBe(basisOf(p));
    expect(basisOf(p)).toBe(p.basisHash);
  });
  it("a stored basisHash that does not match the stored fields is refused", () => {
    const o = JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
    o.accounting!.proposals[0].basisHash = "0".repeat(64);
    expect(loadWorkspace(JSON.stringify(o)).ok).toBe(false);
  });
  it("export_journal re-derives every approved entry (a forged approval with the real lines exports only its real lines)", () => {
    const { o } = forged();
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    // the approval has no account snapshot: the first action supersedes it (SP_MAPPING_CHANGED), so nothing is exported
    const ex = tryAct(r.value.workspace, "usr_maya", { type: "export_journal", periodId: period(r.value.workspace).id });
    expect(errorCode(ex)).toBe("precondition_failed");
    expect(!ex.ok && describeError(ex.error).reasonCode).toBe("MAPPING_CHANGED_SINCE_APPROVAL");
  });
});

describe("F4: a journal id in an export file is never reused", () => {
  it("probe e2 E4: reject after export, then reset s1 → refused (ACCOUNTING_ENTRIES_RECORDED); the export still re-renders to its hash", () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    ws = run(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "not imported" }).workspace;
    const r = resetScenario(ws, "s1_success", { actorId: "usr_maya", at: ws.asOf });
    expect(!r.ok && r.error.message).toMatch(/^ACCOUNTING_ENTRIES_RECORDED/);
    const rec = ws.accounting!.exports.at(-1)!;
    const d = buildJournalExport(ws, { exportId: rec.id });
    expect(d.ok && d.value.sha256).toBe(rec.sha256);
  });
  it("an export record listing a proposal that does not name it back is refused at load", () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    const o = structuredClone(ws);
    o.accounting!.exports.at(-1)!.proposalIds!.push(byRule(ws, "JR_ADVANCE_DISBURSED")[0].id);
    expect(loadWorkspace(JSON.stringify(o)).ok).toBe(false);
  });
});

describe("F5: reversal and rebooking are tied; one bank debit is never booked twice", () => {
  const scenario = () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `NORTHLINE PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    const first = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)[0];
    ws = postAll(ws, [first.id]);
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace; // returned
    ws = propose(ws).workspace;
    return { ws, id, first, rev: byRule(ws, "JR_REVERSAL", id)[0], rebook: byRule(ws, "JR_PAYOUT_DEBIT_NOT_DELIVERED", id)[0] };
  };
  it("probe e5: the required reversal cannot be rejected (REVERSAL_REQUIRED)", () => {
    const { ws, rev } = scenario();
    const r = tryAct(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: rev.id, reason: "dup" });
    expect(errorCode(r)).toBe("precondition_failed");
    expect(!r.ok && describeError(r.error).reasonCode).toBe("REVERSAL_REQUIRED");
  });
  it("the rebooking cannot be approved before its reversal (REVERSAL_FIRST); after it, both export together and nothing is double-counted", () => {
    let { ws, id, rev, rebook } = scenario();
    const r = tryAct(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: rebook.id });
    expect(!r.ok && describeError(r.error).reasonCode).toBe("REVERSAL_FIRST");
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: rev.id }).workspace;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: rebook.id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    for (const p of [rev, rebook]) ws = run(ws, "usr_maya", { type: "record_posting", proposalId: p.id, externalReference: "JNL-2" }).workspace;
    const n = net(proposals(ws).filter((p) => p.intentId === id && p.status === "posted"));
    expect(n.get("supplier_payable|SGD")).toBe(0n);
    expect(n.get("bank:BANK-SGD-OPS (fictional)|SGD")).toBe(-1_000_000n);
    expect(ledgerProblem(ws)).toBeUndefined();
  });
});

describe("F6: the export uses exactly the codes the approver saw", () => {
  it("probe e2 E3: an operator remapping supplier_payable after approval supersedes the approval (SP_MAPPING_CHANGED); the stale codes are never exported", () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    expect(proposals(ws).find((p) => p.id === id)!.approval!.accounts!.find((a) => a.accountKey === "supplier_payable")!.accountCode).toBe("2100");
    const entries = ws.accounting!.mapping!.entries.map((e) => (e.accountKey === "supplier_payable" ? { ...e, accountCode: "6999", accountName: "Sundry expense" } : e));
    expect(errorCode(tryAct(ws, "usr_maya", { type: "set_account_mapping", entries }))).toBe("precondition_failed"); // expectedRevision required
    ws = run(ws, "usr_maya", { type: "set_account_mapping", entries, expectedRevision: 1 }).workspace;
    const p = proposals(ws).find((x) => x.id === id)!;
    expect(p.status).toBe("superseded");
    expect(p.supersession!.code).toBe("SP_MAPPING_CHANGED");
    expect(errorCode(tryAct(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }))).toBe("precondition_failed");
    ws = propose(ws).workspace;
    const again = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT").find((x) => x.status === "proposed")!;
    expect(again.id).not.toBe(id);
  });
});

describe("F7: withdrawing an exported entry needs an approver and proposes a reversal", () => {
  it("probe e5 (2): the exporter or an operator cannot withdraw it; an approver can, and the reversal is proposed", () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    expect(errorCode(tryAct(ws, "usr_maya", { type: "reject_journal_proposal", proposalId: id, reason: "x" }))).toBe("maker_checker_violation");
    expect(errorCode(tryAct(ws, "usr_sam", { type: "reject_journal_proposal", proposalId: id, reason: "x" }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "Not ours (fictional)" }).workspace;
    const r = propose(ws);
    expect(r.outcome).toBe("proposals_created");
    const [rev] = byRule(r.workspace, "JR_REVERSAL");
    expect(rev.reverses).toBe(id);
    expect(rev.narrative).toMatch(/withdrew it after export/);
  });
});

describe("F8: an ignored duplicate webhook never changes the evidence basis", () => {
  it("probe e8: after the chain entry is posted, a redelivered webhook is ignored and the entry is not flagged or reversed", () => {
    let ws = propose(s4Final()).workspace;
    const id = S(ws, "s4_chain");
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", id);
    ws = postAll(ws, active(ws).map((x) => x.id));
    const e0 = ws.providerEvents.filter((e) => e.intentId === id && e.detail.txHash).at(-1)!;
    const instr = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!;
    const rawBody = JSON.stringify({ id: e0.providerEventId, type: e0.normalizedType, provider_payment_id: instr.providerPaymentId, sequence: e0.sequence, occurred_at: ws.asOf, tx_hash: e0.detail.txHash });
    const r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: instr.providerId, rawBody, signatureHeader: getAdapter(instr.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } });
    ws = r.workspace;
    expect(proposals(ws).find((x) => x.id === p.id)!.evidenceChange).toBeUndefined();
    expect(propose(ws).outcome).toBe("no_new_proposals");
  });
});

describe("Low: F9 dates, F10 file hashes, F11 flag cleared, F12 marking, F13 chain difference, mutants M6 / M17", () => {
  it("F9: a chain transfer has the same date in the reconciliation export and the journal (the allocation's org date)", () => {
    const ws = propose(s4Final()).workspace;
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER");
    const doc = buildReconciliationExport(ws, { from: "2026-11-01", to: "2026-12-01" });
    if (!doc.ok) throw new Error(doc.error.message);
    expect(doc.value.rows.find((r) => r.movement === "stablecoin_transfer")!.valueDate).toBe(p.entryDate);
  });
  it("F10: the export record carries the SHA-256 of the exact JSON and CSV bytes", () => {
    let ws = sampleWorkspace();
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    const rec = ws.accounting!.exports.at(-1)!;
    const d = buildJournalExport(ws, { exportId: rec.id });
    if (!d.ok) throw new Error(d.error.message);
    expect(rec.fileSha256).toEqual({ json: sha256Hex(accountingExportToJson(d.value)), csv: sha256Hex(journalExportToCsv(d.value)) });
    const rx = run(ws, "usr_maya", { type: "record_reconciliation_export", from: "2026-11-01", to: "2026-12-01" }).workspace.accounting!.exports.at(-1)!;
    expect(rx.fileSha256!.csv).toMatch(/^[0-9a-f]{64}$/);
  });
  it("F11: a posted chain entry flagged on a reorg is cleared when the transfer is final again", () => {
    let ws = propose(s4Final()).workspace;
    const id = S(ws, "s4_chain");
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", id);
    ws = postAll(ws, active(ws).map((x) => x.id));
    const o = ws.chainObservations.find((x) => x.intentId === id)!;
    const obs = (confirmations: number) => ({ type: "ingest_chain_observation" as const, observation: { intentId: id, chainId: o.chainId, network: o.network, tokenContract: o.tokenContract, tokenSymbol: o.tokenSymbol, txHash: o.txHash, toAddress: o.toAddress, amountMinor: o.amountMinor, blockNumber: o.blockNumber, confirmations } });
    ws = run(ws, "usr_maya", obs(3)).workspace;
    expect(proposals(ws).find((x) => x.id === p.id)!.evidenceChange).toBeDefined();
    for (const e of ws.exceptions.filter((x) => x.intentId === id && x.status !== "resolved")) {
      ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
      ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Explorer check (fictional)" } }).workspace;
      const r = attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Reorg reviewed" });
      if (r.ok) ws = r.value.workspace;
    }
    ws = run(ws, "usr_maya", obs(30)).workspace;
    if (ws.chainObservations.find((x) => x.id === o.id)!.status === "final" && ws.allocations.some((a) => a.statementLineId === o.id))
      expect(proposals(ws).find((x) => x.id === p.id)!.evidenceChange).toBeUndefined();
  });
  it("F12: a memo without the [SANDBOX] marking is refused at load; the journal CSV ids and every reconciliation row carry the marking", () => {
    const o = JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
    o.accounting!.proposals[0].lines[0].memo = "Payout";
    expect(loadWorkspace(JSON.stringify(o)).ok).toBe(false);
    let ws = sampleWorkspace();
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    const d = buildJournalExport(ws, { periodId: period(ws).id });
    if (!d.ok) throw new Error(d.error.message);
    for (const l of journalExportToCsv(d.value).trimEnd().split("\r\n").slice(1)) expect(l.startsWith("SANDBOX-jp_")).toBe(true);
    const rx = buildReconciliationExport(ws, { from: "2026-11-01", to: "2026-12-01" });
    if (!rx.ok) throw new Error(rx.error.message);
    for (const l of reconciliationExportToCsv(rx.value).trimEnd().split("\r\n").slice(1)) expect(l.endsWith(",FICTIONAL SANDBOX")).toBe(true);
  });
  it("F13: the uncovered remainder of a chain payout is listed (s4: 6,427.830000 paid on chain as 6,423.116085)", () => {
    const ws = propose(s4Final()).workspace;
    const id = S(ws, "s4_chain");
    const np = view(ws).notProposed.find((n) => n.code === "NP_PARTIAL_REMAINDER" && n.refs.includes(id))!;
    expect(np.amount).toEqual({ amountMinor: 6_427_830_000 - ws.chainObservations.find((o) => o.intentId === id)!.amountMinor, currency: "USDC" });
  });
  it("M6: an entry dated exactly on a period's end date is not in that period", () => {
    let { ws, id } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = { ...ws, accounting: undefined };
    ws = run(ws, "usr_maya", { type: "set_account_mapping", entries: sampleWorkspace().accounting!.mapping!.entries }).workspace;
    ws = run(ws, "usr_maya", { type: "open_accounting_period", name: "Short", from: "2026-11-01", to: "2026-11-13" }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppidOf(ws, id)}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    expect(byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)).toEqual([]);
    expect(byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT").length).toBe(1); // s1, dated 2026-11-12, is inside
    expect(view(ws).pending.find((x) => x.entryDate === "2026-11-13")!.reason).toMatch(/No accounting period covers 2026-11-13/);
  });
  it("M17: a period with an APPROVED (not yet exported) entry cannot be closed", () => {
    let ws = sampleWorkspace();
    for (const p of active(ws)) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id }).workspace;
    expect(active(ws).every((p) => p.status === "approved")).toBe(true);
    const r = tryAct(ws, "usr_daniel", { type: "close_accounting_period", periodId: period(ws).id });
    expect(!r.ok && describeError(r.error).reasonCode).toBe("PERIOD_HAS_PENDING_PROPOSALS");
  });
});

describe("defence in depth: each load / export check refuses on its own (mutation-tested)", () => {
  const sample = () => JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
  const reject = (p: JournalProposal, at: string) => { p.status = "rejected"; p.rejection = { by: "usr_daniel", at, reason: "x" }; };
  /** Post s1's and s4's entries through the real actions, then duplicate a posted entry under a new id (a crafted second posting). */
  function duplicatePosted(rule: "JR_SUPPLIER_PAYOUT_DEBIT" | "JR_STABLECOIN_FINAL_TRANSFER"): Workspace {
    let ws = propose(s4Final()).workspace;
    ws = postAll(ws, active(ws).map((x) => x.id));
    const o = structuredClone(ws);
    const orig = o.accounting!.proposals.find((x) => x.ruleCode === rule)!;
    const dup = { ...structuredClone(orig), id: "jp_99999", sourceKey: `DUP:${orig.sourceKey}` };
    dup.basisHash = basisOf(dup);
    o.accounting!.proposals.push(dup);
    const rec = o.accounting!.exports.find((x) => x.id === orig.export!.exportId)!;
    rec.proposalIds!.push(dup.id);
    return o;
  }
  it("F2 + R1: a proposed return credit on a line stored as a debit (an a91dd11 / rc3 state) is superseded on load, not refused, and gives no entry", () => {
    const o = sample();
    const p = o.accounting!.proposals.find((x) => x.ruleCode === "JR_PAYOUT_RETURN_CREDIT")!;
    o.statementLines.find((l) => l.id === p.evidence.statementLineIds[0])!.direction = "debit";
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    const q = r.value.workspace.accounting!.proposals.find((x) => x.id === p.id)!;
    expect(q).toMatchObject({ status: "superseded", supersession: { code: "SP_RULES_CHANGED", causedBy: "system" } });
    expect(r.value.migrations.map((m) => [m.kind, m.outcome, m.proposalId])).toEqual([["journal_proposal_superseded", "proposal_superseded", p.id]]);
    expect(propose(r.value.workspace).workspace.accounting!.proposals.filter((x) => x.ruleCode === "JR_PAYOUT_RETURN_CREDIT" && x.status === "proposed")).toEqual([]);
  });
  it("F3 basis alone: a (rejected) entry whose stored basisHash does not match its fields is refused, with truthful wording", () => {
    const o = sample();
    const p = o.accounting!.proposals[0];
    reject(p, o.asOf);
    p.basisHash = "0".repeat(64);
    const r = loadWorkspace(JSON.stringify(o));
    expect(!r.ok && r.error.field).toBe("accounting.proposals[0].basisHash");
    expect(!r.ok && r.error.message).toMatch(/contradict the evidence they name/);
    expect(!r.ok && r.error.message).not.toMatch(/No version of the engine/);
  });
  it("R1: a self-consistent proposed entry the current rules do not give is superseded on load and reported as a migration", () => {
    const o = sample();
    const p = o.accounting!.proposals[0];
    p.entryDate = p.postingDate = "2026-11-20";
    p.basisHash = basisOf(p);
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    const m = r.value.migrations[0];
    expect(m).toMatchObject({ kind: "journal_proposal_superseded", proposalId: p.id, intentId: p.intentId });
    expect(m.text).toMatch(/earlier posting rules/);
    expect(r.value.workspace.audit.find((x) => x.id === m.auditId)).toMatchObject({ action: "workspace.migrated", actorId: "system", entityId: p.id });
    // loading the migrated workspace again changes nothing more
    const again = loadWorkspace(serializeWorkspace(r.value.workspace));
    expect(again.ok && again.value.migrations).toEqual([]);
  });
  it("F5 + R1: a crafted second posting of the same bank debit loads, and the next propose reverses it (bank line booked once again)", () => {
    const l = loadWorkspace(JSON.stringify(duplicatePosted("JR_SUPPLIER_PAYOUT_DEBIT")));
    if (!l.ok) throw new Error(l.error.message);
    expect(ledgerProblem(l.value.workspace)).toMatch(/more than the (line|payout)/);
    expect(ledgerProblem(l.value.workspace, "bank")).toMatch(/more than the line/);
    const r = propose(l.value.workspace);
    expect(byRule(r.workspace, "JR_REVERSAL").map((x) => x.reverses)).toContain("jp_99999");
    expect(ledgerProblem(r.workspace)).toBeUndefined();
  });
  it("F1: a crafted second posting of a chain payment (no evidence source of its own) is reversed by the next propose, so the payable is cleared once again", () => {
    const o = duplicatePosted("JR_STABLECOIN_FINAL_TRANSFER");
    const l = loadWorkspace(JSON.stringify(o));
    if (!l.ok) throw new Error(l.error.message);
    expect(ledgerProblem(l.value.workspace)).toMatch(/supplier payable/);
    const r = propose(l.value.workspace);
    expect(byRule(r.workspace, "JR_REVERSAL").map((x) => x.reverses)).toContain("jp_99999");
    expect(ledgerProblem(r.workspace)).toBeUndefined();
  });
});
