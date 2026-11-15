/**
 * rc4 QA/security M1 (QA_SECURITY_REVIEW_RC4): load re-checks the evidence records themselves.
 * (a) a repayment allocation must have reconcileIncoming's shape (credit payment line, obligation's currency, the
 *     obligation's reference as a token); (b) a counted chain observation's status is re-derived from its confirmations
 *     (migration rule H, moved down, reported), and the bridge requires final-by-confirmations.
 */
import { describe, expect, it } from "vitest";
import { deriveJournalCandidates, loadWorkspace, sampleWorkspace, serializeWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { propose, proposals } from "./rc4-helpers";

const sample = () => JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;

/** QA's shape: the unreferenced s5 SGD 20,000 receipt attached to the s5 obligation as allocation + repayment record. */
function forgedRepayment(o: Workspace, mutateLine?: (l: Workspace["statementLines"][number]) => void) {
  const line = o.statementLines.find((l) => l.lineId === "SIMBANK-0005")!;
  mutateLine?.(line);
  const ob = o.obligations[0];
  o.allocations.push({ id: "alc_99991", statementLineId: line.id, evidenceKind: "statement_line", target: { kind: "repayment", obligationId: ob.id }, amountMinor: line.amountMinor, currency: line.currency, matchedBy: "trusted_reference", codes: ["RC_REPAYMENT_BY_REFERENCE"], createdAt: o.asOf });
  line.allocationIds = ["alc_99991"];
  line.status = "allocated";
  o.repaymentAllocations.push({ id: "rpa_99992", obligationId: ob.id, statementLineId: line.id, amountMinor: line.amountMinor, currency: line.currency, matchedBy: "trusted_reference", evidenceId: o.evidence[0].id, at: o.asOf });
  for (const e of o.exceptions.filter((x) => x.statementLineId === line.id)) Object.assign(e, { status: "resolved", ownerId: "usr_maya", resolution: { at: o.asOf, actorId: "usr_maya", note: "forged" } });
  return { line, ob };
}

describe("M1a: a repayment allocation is re-checked against the obligation's reference", () => {
  it("an unreferenced receipt forged as a repayment is refused on load, naming the rule", () => {
    const o = sample();
    forgedRepayment(o);
    const r = loadWorkspace(JSON.stringify(o));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toMatch(/must carry the obligation's repayment reference/);
  });
  it("the same receipt with the reference but as a debit, or in another currency, is refused too", () => {
    for (const mutate of [
      (l: Workspace["statementLines"][number]) => { l.reference = "RPY-SEABRIGHT-0001"; l.direction = "debit"; },
      (l: Workspace["statementLines"][number]) => { l.reference = "RPY-SEABRIGHT-0001"; l.currency = "USD"; },
    ]) {
      const o = sample();
      forgedRepayment(o, mutate);
      expect(loadWorkspace(JSON.stringify(o)).ok).toBe(false);
    }
  });
  it("the engine's own repayment allocation (SIMBANK-0004, referenced) loads unchanged", () => {
    const r = loadWorkspace(serializeWorkspace(sampleWorkspace()));
    expect(r.ok && r.value.migrations).toEqual([]);
  });
});

describe("M1b: a chain observation's status is re-derived from its confirmations", () => {
  const forgedFinal = () => {
    const o = sample();
    const obs = o.chainObservations[0];
    expect(obs.confirmations).toBeLessThan(12);
    obs.status = "final";
    o.allocations.push({ id: "alc_99995", statementLineId: obs.id, evidenceKind: "chain_observation", target: { kind: "payment", intentId: obs.intentId }, amountMinor: obs.amountMinor, currency: "USDC", matchedBy: "trusted_reference", codes: ["RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW"], createdAt: o.asOf });
    return { o, obs };
  };
  it("a 'final' status with 6 of 12 confirmations is moved down on load and reported (rule H); no supplier-paid entry is proposed", () => {
    const { o, obs } = forgedFinal();
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    const m = r.value.migrations.find((x) => x.kind === "chain_status_exceeds_confirmations")!;
    expect(m).toMatchObject({ observationId: obs.id, intentId: obs.intentId });
    expect(m.text).toMatch(/stored as final with 6 of 12 confirmations/);
    expect(r.value.workspace.chainObservations.find((x) => x.id === obs.id)!.status).toBe("pending_finality");
    const after = propose(r.value.workspace).workspace;
    expect(proposals(after).filter((p) => p.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER")).toEqual([]);
    const again = loadWorkspace(serializeWorkspace(r.value.workspace));
    expect(again.ok && again.value.migrations).toEqual([]);
  });
  it("defence in depth: the bridge itself never treats a stored 'final' below the threshold as final", () => {
    const { o } = forgedFinal(); // not loaded: the derivation reads the forged record directly
    const id = scenarioIntentId(o, "s4_chain")!;
    expect(deriveJournalCandidates(o).candidates.filter((c) => c.intentId === id && c.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER")).toEqual([]);
  });
});
