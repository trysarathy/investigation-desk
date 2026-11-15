/**
 * rc4 Connect — item 2 (raw status preserved verbatim; time-based inference is a distinct, weaker
 * confidence) and item 3 (a provider moving a status backwards is a contradiction with an owner,
 * never an error and never silent), consistent with F1, N1, the terminal rules and "execution
 * never sets settlement".
 */
import { describe, expect, it } from "vitest";
import {
  CONNECT_DESCRIPTORS,
  CONNECT_SCRIPTS,
  applyAction,
  getAdapter,
  listExceptions,
  type Workspace,
} from "@/lib/clearline";
import { run, debitLine, sim, submitted } from "./helpers";
import { CW, QF, SG, deliver, intentOf, outcomeOf, ownedContradiction, plusMin, poll, submittedConnect, versions } from "./rc4-connect-helpers";

/** Deliver every provider version after the synchronous one, in order, by webhook (Saltglass by poll). */
function playAll(providerId: string, script?: string) {
  let { ws, id, ref } = submittedConnect(providerId, script);
  for (const v of versions(ws, id).slice(1)) ws = (providerId === SG ? poll(ws, id, v.at) : deliver(ws, id, v.version)).workspace;
  return { ws, id, ref };
}
const lastEvent = (ws: Workspace, id: string) => ws.providerEvents.filter((e) => e.intentId === id).at(-1)!;

describe("rc4 Connect item 2: the raw status is kept verbatim next to the normalised claim", () => {
  it("every Connect event carries rawStatus / rawSubStatus / rawAddendum / rawReasonCode / rank / confidence / settlement claim / version, equal to the raw body", () => {
    for (const [p, script] of [[CW, undefined], [CW, "return"], [QF, undefined], [SG, undefined], [SG, "internal_ledger"]] as const) {
      const { ws, id } = playAll(p, script);
      const d = CONNECT_DESCRIPTORS.find((x) => x.providerId === p)!;
      const events = ws.providerEvents.filter((e) => e.intentId === id);
      expect(events.length).toBeGreaterThanOrEqual(2);
      for (const e of events) {
        const body = JSON.parse(e.rawBody!);
        const obj = d.shape.objectField && body[d.shape.objectField] ? body[d.shape.objectField] : body;
        expect(e.detail.rawStatus, `${p} ${e.id}`).toBe(obj[d.shape.status]);
        if (d.shape.subStatus) expect(e.detail.rawSubStatus).toBe(obj[d.shape.subStatus]);
        if (d.shape.addendum && obj[d.shape.addendum] !== undefined) expect(e.detail.rawAddendum).toBe(obj[d.shape.addendum]);
        if (d.shape.reason && obj[d.shape.reason] !== undefined) expect(e.detail.rawReasonCode).toBe(obj[d.shape.reason]);
        if (d.shape.version) expect(e.detail.objectVersion).toBe(obj[d.shape.version]);
        const m = d.statuses.find((x) => x.raw === obj[d.shape.status] && x.subStatus === (d.shape.subStatus ? obj[d.shape.subStatus] : undefined))!;
        expect(e.detail).toMatchObject({ rawRank: m.rank, claimConfidence: m.confidence, settlementClaim: m.settlementClaim });
        expect(e.normalizedType).toBe(m.event);
        expect(e.confidence).toBe("provider_claim");
      }
    }
  });
  it("a time-inferred status (presumed paid after a return window) has the distinct confidence provider_time_inferred and never verifies settlement", () => {
    const { ws, id } = playAll(QF, "presumed_only");
    const e = lastEvent(ws, id);
    expect(e.detail).toMatchObject({ rawStatus: "DONE", rawSubStatus: "PRESUMED_AFTER_WINDOW", claimConfidence: "provider_time_inferred" });
    expect(e.detail.claimConfidence).not.toBe("provider_claim");
    expect(intentOf(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none", settlementScope: "none" });
    // The mapping table has no route to "verified": no confidence or settlement claim can say it.
    for (const d of CONNECT_DESCRIPTORS) for (const m of d.statuses) expect(`${m.confidence} ${m.settlementClaim}`).not.toMatch(/verified/);
    const timeBased = CONNECT_DESCRIPTORS.flatMap((d) => d.statuses).filter((m) => m.confidence === "provider_time_inferred");
    expect(timeBased.map((m) => `${m.raw}/${m.subStatus}`)).toEqual(["DONE/PRESUMED_AFTER_WINDOW"]);
  });
  it("an unmapped raw status is refused with a typed error and nothing is recorded (never guessed)", () => {
    const { ws, id, ref } = submittedConnect(CW);
    const body = JSON.stringify({ id: "evt_unmapped_0001", type: "object.updated", payout: { ref, version: 2, status: "teleported", amount_minor: 1_000_000, currency: "SGD", updated_at: ws.asOf } });
    const header = getAdapter(CW)!.signWebhook(body, Math.floor(Date.parse(ws.asOf) / 1000));
    const r = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: CW, rawBody: body, signatureHeader: header } }, { actorId: "usr_maya", at: ws.asOf });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "invalid_field" });
    if (!r.ok) expect(r.error.message).toMatch(/unmapped raw status "teleported"/);
    expect(intentOf(ws, id).status.execution).toBe("submitted");
  });
  it("events of the original sandbox providers are unchanged (no raw* keys)", () => {
    let { ws, id } = submitted({}, "prv_northline");
    for (let i = 0; i < 3; i++) ws = sim(ws, id).workspace;
    const legacy = ws.providerEvents.filter((e) => e.intentId === id);
    expect(legacy.length).toBeGreaterThanOrEqual(3);
    for (const e of legacy) expect(Object.keys(e.detail).filter((k) => /^raw|claimConfidence|settlementClaim|objectVersion/.test(k))).toEqual([]);
  });
});

describe("rc4 Connect item 3: regression is a contradiction with an owner, never an error, never silent", () => {
  it("paid → failed (delivered, then bounced): contradiction, execution kept, open exception someone acts on", () => {
    const { ws, id } = playAll(CW, "return");
    const ev = lastEvent(ws, id);
    expect(ev.detail.rawStatus).toBe("bounced");
    expect(ev.processingOutcome).toBe("contradictory_exception_raised");
    expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
    expect(intentOf(ws, id).status.settlement).not.toBe("verified");
    expect(listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).map((e) => e.explanationCode)).toEqual(["EV_IMPOSSIBLE_TRANSITION"]);
    const o = ownedContradiction(ws, id);
    expect(o.open).toBeGreaterThan(0);
    expect(o.whoActs).not.toBe("WA_NONE");
  });
  it("completed → returned (clawed back): the return is applied and an owned returned_payout exception is open", () => {
    const { ws, id } = playAll(CW, "clawback");
    expect(intentOf(ws, id).status).toMatchObject({ execution: "returned", reconciliation: "exception" });
    expect(intentOf(ws, id).returnStatus).toBe("provider_reported");
    expect(listExceptions(ws, { intentId: id, status: "unresolved" }).map((e) => e.category)).toContain("returned_payout");
    expect(ownedContradiction(ws, id).whoActs).not.toBe("WA_NONE");
  });
  it("a raw regression inside the same execution claim (bank_confirmed → handed_to_bank) raises EV_PROVIDER_STATUS_REGRESSED (it is not silently recorded)", () => {
    const { ws, id } = playAll(CW, "regress_substatus");
    const ev = lastEvent(ws, id);
    expect(ev).toMatchObject({ processingOutcome: "contradictory_exception_raised", normalizedType: "payout.completed" });
    expect(ev.detail).toMatchObject({ rawStatus: "delivered", rawSubStatus: "handed_to_bank" });
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" });
    expect(exc.map((e) => e.explanationCode)).toEqual(["EV_PROVIDER_STATUS_REGRESSED"]);
    expect(exc[0].explanation).toMatch(/delivered\/bank_confirmed \(seq 3\) → delivered\/handed_to_bank \(seq 4\)/);
    expect(exc[0].supportingEventIds).toHaveLength(2);
    expect(ownedContradiction(ws, id).whoActs).not.toBe("WA_NONE");
    expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
  });
  it("a regression across claims (delivered → routing) raises the same regression code; state not changed", () => {
    const { ws, id } = playAll(CW, "regress_to_routing");
    expect(listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).map((e) => e.explanationCode)).toEqual(["EV_PROVIDER_STATUS_REGRESSED"]);
    expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
  });
  it("the same regression learned by polling gives the same outcome (one rule for every path)", () => {
    let { ws, id } = submittedConnect(CW, "regress_substatus");
    for (const v of versions(ws, id).slice(1)) ws = poll(ws, id, v.at).workspace;
    const byWebhook = playAll(CW, "regress_substatus");
    expect(outcomeOf(ws, id)).toEqual(outcomeOf(byWebhook.ws, byWebhook.id));
    expect(lastEvent(ws, id).provenance).toBe("provider_poll");
  });
  it("side states are not progress: a hold reported while at the bank (lower rank) is a hold, not a regression", () => {
    for (const p of [CW, QF]) {
      const { ws, id } = playAll(p, "hold");
      expect(intentOf(ws, id).status.execution).toBe("on_hold");
      expect(listExceptions(ws, { intentId: id }).map((e) => e.explanationCode)).toEqual(["PV_PARTNER_COMPLIANCE_HOLD"]);
    }
  });
  it("an OLDER version arriving late is not a regression: stored without changing state, no exception", () => {
    let { ws, id } = submittedConnect(CW);
    const vs = versions(ws, id);
    ws = deliver(ws, id, 5, vs[4].at).workspace; // bank_confirmed first
    ws = deliver(ws, id, 4, plusMin(vs[4].at, 1)).workspace; // handed_to_bank (older version) later
    ws = deliver(ws, id, 2, plusMin(vs[4].at, 2)).workspace;
    expect(ws.providerEvents.filter((e) => e.intentId === id).map((e) => e.processingOutcome).slice(-3)).toEqual(["applied", "recorded_no_state_change", "stored_late_no_regression"]);
    expect(listExceptions(ws, { intentId: id })).toEqual([]);
  });
  it("a regression with bank evidence already recorded contradicts settlement (never left verified)", () => {
    let { ws, id, ref } = submittedConnect(CW, "regress_substatus");
    const vs = versions(ws, id);
    ws = deliver(ws, id, 2).workspace;
    ws = deliver(ws, id, 3).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ref, counterparty: "Cobalt Wren Payouts (fictional sandbox)" }) }, plusMin(vs[2].at, 5)).workspace;
    expect(intentOf(ws, id).status.settlement).toBe("verified");
    ws = deliver(ws, id, 4).workspace;
    expect(intentOf(ws, id).status.settlement).toBe("contradicted");
  });
  it("F1 stays: a provider settlement report on the clawed-back payout is a contradiction, not evidence", () => {
    let { ws, id, ref } = playAll(CW, "clawback");
    const row = getAdapter(CW)!.ingestStatementRow({ id: "CWRPT-1", payment_id: ref, amount_minor: 1_000_000, currency: "SGD", value_date: "2026-11-13", type: "payout" });
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: row }).workspace;
    expect(listExceptions(ws, { intentId: id }).map((e) => e.explanationCode)).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
    expect(intentOf(ws, id).status.settlement).not.toBe("verified");
  });
  it("N1 stays: a bank debit matched after the provider's return is contradicted (scope bank_statement), never verified", () => {
    let { ws, id, ref } = playAll(CW, "clawback");
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ref }) }).workspace;
    expect(intentOf(ws, id).status).toMatchObject({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement" });
  });
  it("execution never sets settlement: no Connect status event alone ever moves settlement off none", () => {
    for (const d of CONNECT_DESCRIPTORS)
      for (const script of Object.keys(CONNECT_SCRIPTS[d.providerId])) {
        const { ws, id } = playAll(d.providerId, script);
        expect(intentOf(ws, id).status.settlement, `${d.providerId} ${script}`).toBe("none");
        expect(intentOf(ws, id).status.reconciliation).not.toBe("matched");
      }
  });
  it("a terminal payout stays terminal: a later success version after bounced is a contradiction", () => {
    let { ws, id, ref } = submittedConnect(CW);
    const body = (v: number, status: string, sub?: string) => JSON.stringify({ id: `evt_manual_${v}`, type: "object.updated", payout: { ref, version: v, status, ...(sub ? { sub_status: sub } : {}), amount_minor: 1_000_000, currency: "SGD", updated_at: ws.asOf } });
    const send = (w: Workspace, b: string) => run(w, "usr_maya", { type: "ingest_webhook", delivery: { providerId: CW, rawBody: b, signatureHeader: getAdapter(CW)!.signWebhook(b, Math.floor(Date.parse(w.asOf) / 1000)) } });
    ws = send(ws, body(2, "rejected")).workspace;
    expect(intentOf(ws, id).status.execution).toBe("failed");
    const r = send(ws, body(3, "delivered", "bank_confirmed"));
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intentOf(r.workspace, id).status.execution).toBe("failed");
  });
});
