/**
 * rc4 Connect — item 7 (evidence source classification) and integration: existing providers and the
 * v1 API keep working, rc3 workspaces still load with `migrations: []`, and a workspace holding
 * Connect payouts round-trips with `migrations: []` too.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/clearline/test/v1/[...path]/route";
import {
  ALLOWLISTED_TOKENS,
  CONNECT_SCRIPTS,
  EVIDENCE_SOURCE_CLASS,
  classifyEvidenceRecord,
  classifyStatementSource,
  getAdapter,
  loadWorkspace,
  providerEventSourceKind,
  sampleWorkspace,
  serializeWorkspace,
  syntheticFinalTxHash,
  syntheticPreliminaryTxHash,
  type Workspace,
} from "@/lib/clearline";
import { debitLine, run } from "./helpers";
import { CW, QF, SG, deliver, intentOf, plusMin, poll, submittedConnect, versions } from "./rc4-connect-helpers";

function playAll(p: string, script?: string) {
  let { ws, id, ref } = submittedConnect(p, script);
  for (const v of versions(ws, id).slice(1)) ws = (p === SG ? poll(ws, id, v.at) : deliver(ws, id, v.version)).workspace;
  return { ws, id, ref };
}

/** Clearline's OWN (synthetic) chain observation of a Saltglass payout. */
function observe(ws: Workspace, id: string, txHash: string, confirmations: number, at?: string) {
  const token = ALLOWLISTED_TOKENS[0];
  const quote = ws.quotes.find((q) => q.id === ws.instructions.find((i) => i.intentId === id)!.quoteId)!;
  return run(ws, "usr_maya", {
    type: "ingest_chain_observation",
    observation: { intentId: id, chainId: token.chainId, network: token.network, tokenContract: token.contract, tokenSymbol: token.symbol, txHash, toAddress: getAdapter(SG)!.expectedWallet!(intentOf(ws, id)), amountMinor: quote.estimatedRecipientMinor, blockNumber: 18_100_000, confirmations },
  }, at);
}

describe("rc4 Connect item 7: evidence source classification", () => {
  it("the table: bank statement and Clearline's chain observation are independent; everything provider-authored is not", () => {
    expect(EVIDENCE_SOURCE_CLASS.bank_statement.class).toBe("independent");
    expect(EVIDENCE_SOURCE_CLASS.clearline_chain_observation).toEqual({ class: "independent", chainEvidence: true, canVerifySettlement: true });
    expect(EVIDENCE_SOURCE_CLASS.provider_settlement_report).toEqual({ class: "provider_report", chainEvidence: false, canVerifySettlement: false });
    for (const k of ["provider_status_event", "provider_ledger_confirmation", "provider_preliminary_hash"] as const)
      expect(EVIDENCE_SOURCE_CLASS[k]).toEqual({ class: "provider_claim", chainEvidence: false, canVerifySettlement: false });
    expect(classifyStatementSource("bank_statement")).toBe("independent");
    expect(classifyStatementSource("provider_settlement_report")).toBe("provider_report");
  });
  it("a Connect provider's settlement report is a provider report: observed / provider_report, never verified, never independent", () => {
    for (const p of [CW, QF]) {
      let { ws, id, ref } = playAll(p);
      const i = intentOf(ws, id);
      const row = getAdapter(p)!.ingestStatementRow({ id: `${p}-RPT-1`, payment_id: ref, amount_minor: i.amountMinor, currency: i.sourceCurrency, value_date: "2026-11-13", type: "payout" });
      expect(row.source).toBe("provider_settlement_report");
      ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: row }).workspace;
      expect(intentOf(ws, id).status).toMatchObject({ settlement: "observed", settlementScope: "provider_report" });
      const ev = ws.evidence.filter((e) => e.intentId === id && e.kind === "provider_settlement_report");
      expect(ev.length).toBe(1);
      expect(ev[0].independent).toBe(false);
      expect(classifyEvidenceRecord(ev[0])).toBe("provider_report");
    }
  });
  it("a provider-ledger 'done' for an internal transfer is a provider claim, never chain evidence", () => {
    const { ws, id } = playAll(SG, "internal_ledger");
    const e = ws.providerEvents.filter((x) => x.intentId === id).at(-1)!;
    expect(e.detail).toMatchObject({ rawStatus: "book_transfer_done", claimConfidence: "provider_ledger_claim", settlementClaim: "provider_claims_internal_ledger" });
    expect(e.detail.txHash).toBeUndefined();
    expect(providerEventSourceKind(e)).toBe("provider_ledger_confirmation");
    expect(EVIDENCE_SOURCE_CLASS[providerEventSourceKind(e)].chainEvidence).toBe(false);
    expect(ws.chainObservations.filter((o) => o.intentId === id)).toEqual([]);
    expect(intentOf(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none", settlementScope: "none" });
  });
  it("a preliminary hash is kept verbatim but is never the provider's tx hash, never chain evidence, never allocates", () => {
    let { ws, id, ref } = submittedConnect(SG);
    const vs = versions(ws, id);
    ws = poll(ws, id, vs[1].at).workspace;
    const e = ws.providerEvents.at(-1)!;
    expect(e.detail.rawTxHashPreliminary).toBe(syntheticPreliminaryTxHash(ref));
    expect(e.detail.txHash).toBeUndefined();
    expect(providerEventSourceKind(e)).toBe("provider_preliminary_hash");
    expect(ws.allocations).toEqual([]);
    // The provider's final hash differs; only Clearline's own observation of a final transfer verifies.
    ws = poll(ws, id, vs[2].at).workspace;
    expect(ws.providerEvents.at(-1)!.detail.txHash).toBe(syntheticFinalTxHash(ref));
    expect(intentOf(ws, id).status.settlement).toBe("none");
    ws = observe(ws, id, syntheticFinalTxHash(ref), 12, plusMin(vs[2].at, 5)).workspace;
    expect(intentOf(ws, id).status).toMatchObject({ settlement: "verified", settlementScope: "onchain_transfer" });
    const chainEv = ws.evidence.find((x) => x.intentId === id && x.kind === "chain_observation")!;
    expect([chainEv.independent, classifyEvidenceRecord(chainEv)]).toEqual([true, "independent"]);
  });
  it("Clearline's observation of the PRELIMINARY hash is contradicted once the provider reports a different final hash", () => {
    let { ws, id, ref } = submittedConnect(SG);
    const vs = versions(ws, id);
    ws = poll(ws, id, vs[1].at).workspace;
    ws = observe(ws, id, syntheticPreliminaryTxHash(ref), 12, plusMin(vs[1].at, 1)).workspace;
    ws = poll(ws, id, vs[2].at).workspace;
    expect(ws.exceptions.filter((x) => x.intentId === id).map((x) => x.explanationCode)).toContain("CH_TX_DIFFERS_FROM_PROVIDER");
    expect(intentOf(ws, id).status.reconciliation).not.toBe("matched");
  });
  it("for every Connect flow, a stored evidence record is independent exactly when it is classified independent", () => {
    let n = 0;
    for (const p of [CW, QF, SG])
      for (const s of Object.keys(CONNECT_SCRIPTS[p])) {
        let { ws, id, ref } = playAll(p, s);
        const i = intentOf(ws, id);
        if (p !== SG) ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ref, amountMinor: i.amountMinor, currency: i.sourceCurrency }) }).workspace;
        for (const e of ws.evidence) {
          expect(e.independent, `${p} ${s} ${e.kind}`).toBe(classifyEvidenceRecord(e) === "independent");
          n++;
        }
        for (const e of ws.providerEvents) expect(EVIDENCE_SOURCE_CLASS[providerEventSourceKind(e)].class).toBe("provider_claim");
      }
    expect(n).toBeGreaterThan(20);
  });
});

describe("rc4 Connect integration", () => {
  it("rc3 sample loads with migrations: [] and is unchanged by the Connect code", () => {
    const text = serializeWorkspace(sampleWorkspace());
    const l = loadWorkspace(text);
    expect(l.ok && l.value.migrations).toEqual([]);
    if (l.ok) expect(serializeWorkspace(l.value.workspace)).toBe(text);
  });
  it("a workspace holding Connect payouts (every provider, every script) round-trips with migrations: []", () => {
    for (const p of [CW, QF, SG])
      for (const s of Object.keys(CONNECT_SCRIPTS[p])) {
        const { ws } = playAll(p, s);
        const text = serializeWorkspace(ws);
        const l = loadWorkspace(text);
        expect(l.ok, `${p} ${s}`).toBe(true);
        if (!l.ok) continue;
        expect(l.value.migrations, `${p} ${s}`).toEqual([]);
        expect(serializeWorkspace(l.value.workspace)).toBe(text);
      }
  });
  it("v1 test API: the generic actions endpoint drives a Connect poll statelessly", async () => {
    const { ws, id } = submittedConnect(QF);
    const at = versions(ws, id)[2].at;
    const res = await POST(
      new NextRequest("http://x/api/clearline/test/v1/actions", { method: "POST", headers: { authorization: "Bearer cl_test_demo", "content-type": "application/json" }, body: JSON.stringify({ workspace: ws, action: { type: "poll_provider", intentId: id }, at }) }),
      { params: Promise.resolve({ path: ["actions"] }) },
    );
    const j = await res.json();
    expect(res.status, JSON.stringify(j).slice(0, 300)).toBeLessThan(300);
    const w: Workspace = j.workspace;
    expect(intentOf(w, id).status.execution).toBe("provider_reported_completed");
    expect(w.providerEvents.at(-1)!.detail).toMatchObject({ rawStatus: "DONE", rawSubStatus: "BANK_ACK" });
  });
});
