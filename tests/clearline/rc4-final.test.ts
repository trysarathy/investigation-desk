/**
 * rc4 Accounting Bridge — final check of CHANGE 17 (APPROVE 5278061): K1, K3, K4, genuine a91dd11 fixtures, second approver.
 * Probes: scratchpad/review-probes/q-final.test.ts, real-a91-fixtures.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_ACTORS, describeError, ledgerProblem, loadWorkspace, sampleWorkspace, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { basisOf } from "@/lib/clearline/accounting/derive";
import { attempt, debitLine, intent, run, signedDelivery, submitted } from "./helpers";
import { byRule, period, postAll, propose, proposals, view } from "./rc4-helpers";

const FIX = join(__dirname, "fixtures");

describe("K1: a crafted second copy of a posted entry", () => {
  /** Exactly the reviewer's Q1 shape: s1's posted entry copied under a new id, same source key and basis hash, listed in its export. */
  const q1 = () => {
    const ws = postAll(sampleWorkspace(), [byRule(sampleWorkspace(), "JR_SUPPLIER_PAYOUT_DEBIT")[0].id]);
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const p = o.accounting!.proposals.find((x) => x.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
    const dup = { ...structuredClone(p), id: "jp_09999" };
    o.accounting!.proposals.push(dup);
    o.accounting!.exports.find((x) => x.id === p.export!.exportId)!.proposalIds!.push(dup.id);
    return { o, p, dup };
  };
  it("is refused at load, with wording that says what it is (not 'no version of the engine')", () => {
    const { o, p } = q1();
    const r = loadWorkspace(JSON.stringify(o));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe(`accounting.proposals[${o.accounting!.proposals.length - 1}]`);
    expect(!r.ok && r.error.message).toMatch(new RegExp(`second copy of ${p.id} in the ledger`));
    expect(!r.ok && r.error.message).toMatch(/contradict the evidence they name, or each other/);
    expect(!r.ok && r.error.message).not.toMatch(/No version of the engine/);
  });
  it("a reversed earlier copy with the same basis is a legitimate state and loads (posted, reversed, re-booked)", () => {
    // P posted; the evidence changes and P is reversed (posted); the evidence returns, so the same entry is booked again.
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    const first = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)[0];
    ws = postAll(ws, [first.id]);
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const p = o.accounting!.proposals.find((x) => x.id === first.id)!;
    const rev = { ...structuredClone(p), id: "jp_09998", sourceKey: `REV:${p.id}`, ruleCode: "JR_REVERSAL" as const, reverses: p.id, lines: p.lines.map((l) => ({ ...l, side: l.side === "debit" ? ("credit" as const) : ("debit" as const), ruleCode: "JR_REVERSAL" as const })), showsSupplierPaid: false };
    rev.basisHash = basisOf(rev);
    for (const l of rev.lines) l.memo = `[SANDBOX] Reversal of ${p.id}`;
    const again = { ...structuredClone(p), id: "jp_09997" };
    o.accounting!.proposals.push(rev, again);
    o.accounting!.exports.find((x) => x.id === p.export!.exportId)!.proposalIds!.push(rev.id, again.id);
    const r = loadWorkspace(JSON.stringify(o));
    expect(r.ok ? "ok" : r.error.message).toBe("ok");
  });
  it("an existing ledger issue never blocks unrelated proposals (propose refuses only issues it introduces or worsens)", () => {
    let ws = postAll(sampleWorkspace(), [byRule(sampleWorkspace(), "JR_SUPPLIER_PAYOUT_DEBIT")[0].id]);
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const s1 = o.intents.find((i) => i.scenario === "s1_success")!;
    s1.amountMinor = 1_000_000; // a stored payout amount now below what is already posted against its payable
    for (const x of o.instructions) if (x.intentId === s1.id) x.amountMinor = 1_000_000;
    const l = loadWorkspace(JSON.stringify(o));
    if (!l.ok) throw new Error(l.error.message);
    ws = l.value.workspace;
    expect(ledgerProblem(ws)).toMatch(/more than the payout/);
    const s = submitted({ amountMinor: 500_000 }, "prv_northline", ws);
    ws = run(s.ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${s.ppid}`, amountMinor: 500_000, valueDate: "2026-11-13" }) }).workspace;
    const r = attempt(ws, "usr_maya", { type: "propose_journal_entries" });
    expect(r.ok && r.value.outcome).toBe("proposals_created");
    expect(r.ok && byRule(r.value.workspace, "JR_SUPPLIER_PAYOUT_DEBIT", s.id).length).toBe(1);
  });
});

describe("K4: every open contradiction on a bank-settled live payout leaves it contradicted (engine, bridge and load rule G agree)", () => {
  const amountContradiction = () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", settlementScope: "bank_statement" });
    const seq = ws.providerEvents.filter((e) => e.intentId === id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-K4`, type: "payout.completed", provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf, amount_minor: 1_000_100, currency: "SGD" }) }).workspace;
    expect(ws.exceptions.some((e) => e.intentId === id && e.explanationCode === "EV_AMOUNT_DIFFERS_FROM_INSTRUCTION" && e.status !== "resolved")).toBe(true);
    return { ws, id };
  };
  it("a debit first, then an amount contradiction (EV_AMOUNT_DIFFERS_FROM_INSTRUCTION): settlement becomes contradicted and the bridge proposes no supplier-paid entry", () => {
    const { ws, id } = amountContradiction();
    expect(intent(ws, id).status).toMatchObject({ settlement: "contradicted", reconciliation: "exception" });
    const after = propose(ws).workspace;
    expect(proposals(after).filter((p) => p.intentId === id && p.showsSupplierPaid)).toEqual([]);
    expect(view(after).notProposed.some((n) => n.code === "NP_EVIDENCE_CONTRADICTED" && n.refs.includes(id))).toBe(true);
  });
  it("rule G repairs a saved verified state with that (non provider-status) contradiction open", () => {
    const { ws, id } = amountContradiction();
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    Object.assign(o.intents.find((i) => i.id === id)!.status, { settlement: "verified", reconciliation: "matched" });
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations.find((m) => m.kind === "open_contradiction_settlement")).toMatchObject({ intentId: id, exceptionCode: "EV_AMOUNT_DIFFERS_FROM_INSTRUCTION" });
    expect(intent(r.value.workspace, id).status.settlement).toBe("contradicted");
  });
});

describe("R1 on GENUINE a91dd11 fixtures (generated by the reviewer in a frozen a91dd11 copy)", () => {
  const load = (f: string) => { const r = loadWorkspace(readFileSync(join(FIX, f), "utf8")); if (!r.ok) throw new Error(`${f}: ${r.error.message}`); return r.value; };
  it("rc4a_onramp_proposed: the SGD payable entry is superseded (SP_RULES_CHANGED, neutral text); propose gives the on-ramp funding; reload is clean", () => {
    const l = load("rc4a_onramp_proposed.json");
    expect(l.migrations.map((m) => m.kind)).toEqual(["journal_proposal_superseded"]);
    expect(l.migrations[0].text).toMatch(/no longer matches the current posting rules/);
    const sup = proposals(l.workspace).find((p) => p.id === l.migrations[0].proposalId)!;
    expect(sup).toMatchObject({ status: "superseded", ruleCode: "JR_SUPPLIER_PAYOUT_DEBIT", supersession: { code: "SP_RULES_CHANGED" } });
    const after = propose(l.workspace).workspace;
    expect(byRule(after, "JR_STABLECOIN_ONRAMP_FUNDING", sup.intentId).filter((p) => p.status === "proposed")).toHaveLength(1);
    expect(ledgerProblem(after)).toBeUndefined();
    const again = loadWorkspace(serializeWorkspace(after));
    expect(again.ok && again.value.migrations).toEqual([]);
  });
  it("rc4a_chain_duplicate_event_proposed: the chain entry is superseded and proposed again without the duplicate", () => {
    const l = load("rc4a_chain_duplicate_event_proposed.json");
    expect(l.migrations.map((m) => m.kind)).toEqual(["journal_proposal_superseded"]);
    const old = proposals(l.workspace).find((p) => p.id === l.migrations[0].proposalId)!;
    const after = propose(l.workspace).workspace;
    const fresh = byRule(after, "JR_STABLECOIN_FINAL_TRANSFER").filter((p) => p.status === "proposed");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].evidence.providerEventIds.length).toBeLessThan(old.evidence.providerEventIds.length);
  });
  it("rc4a_rejected_reversal_double_count: loads with no migrations, no exported or posted entry changes, and propose corrects the double booking", () => {
    const text = readFileSync(join(FIX, "rc4a_rejected_reversal_double_count.json"), "utf8");
    const l = load("rc4a_rejected_reversal_double_count.json");
    expect(l.migrations).toEqual([]);
    const before = (JSON.parse(text) as Workspace).accounting!.proposals.filter((p) => p.status === "posted" || p.status === "exported");
    for (const p of before) expect(proposals(l.workspace).find((x) => x.id === p.id)).toEqual(p);
    expect(ledgerProblem(l.workspace, "bank")).toMatch(/more than the line/);
    const after = propose(l.workspace).workspace;
    expect(ledgerProblem(after)).toBeUndefined();
  });
});

describe("sample: a second approver", () => {
  it("usr_lin (fictional) is an approver; when usr_daniel exports, usr_lin can confirm not imported", () => {
    expect(SAMPLE_ACTORS.filter((a) => a.role === "approver").map((a) => a.id)).toEqual(["usr_daniel", "usr_lin"]);
    expect(SAMPLE_ACTORS.find((a) => a.id === "usr_lin")!.name).toMatch(/\(fictional\)$/);
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_lin", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_daniel", { type: "export_journal", periodId: period(ws).id }).workspace;
    const own = attempt(ws, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "Not imported" });
    expect(!own.ok && describeError(own.error).code).toBe("maker_checker_violation");
    ws = run(ws, "usr_lin", { type: "confirm_not_imported", proposalId: id, note: "Ledger checked: not imported (fictional)" }).workspace;
    expect(proposals(ws).find((p) => p.id === id)!.rejection!.notImported!.by).toBe("usr_lin");
  });
});
