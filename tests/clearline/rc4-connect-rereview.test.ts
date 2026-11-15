/**
 * rc4 Connect — re-review follow-ups (CODE_REVIEW_RC4_CONNECT.md, "Re-review"): RR-1 post-hold version before the
 * hold, RR-2 regression between two pre-newest versions (stored-late reference), RR-3 padded signature header,
 * RR-4 conflict-driven execution changes against the Accounting Bridge (read-only use of the bridge's actions).
 */
import { describe, expect, it } from "vitest";
import { COBALT_WREN, DEFAULT_SAMPLE_MAPPING, canonicalHeaderValue, connectKeyring, getAdapter, signDelivery, verifyDelivery, ledgerProblem, listExceptions, providerWebhook, receiveConnectWebhook, QUILLFERN, type Workspace } from "@/lib/clearline";
import { debitLine, run } from "./helpers";
import { CW, QF, deliver, intentOf, outcomeOf, permutations, plusMin, submittedConnect, versions } from "./rc4-connect-helpers";
import { net, postAll, proposals, propose } from "./rc4-helpers";

describe("RR-1: a post-hold version that arrives before the hold", () => {
  it("the regression raised before the hold was known is annotated (still open for a person) once the hold arrives", () => {
    let { ws, id } = submittedConnect(CW, "hold_release");
    const vs = versions(ws, id);
    ws = deliver(ws, id, 2).workspace; // routing/at_bank (25)
    ws = deliver(ws, id, 5, vs[4].at).workspace; // routing/awaiting_bank (20), after the release — no hold known yet
    const exc = () => listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).find((e) => e.explanationCode === "EV_PROVIDER_STATUS_REGRESSED")!;
    expect(exc()).toBeDefined();
    expect(exc().history.some((h) => h.action === "hold_boundary_noted")).toBe(false);
    const r = deliver(ws, id, 3, plusMin(vs[4].at, 1)); // the hold itself, late
    ws = r.workspace;
    expect(exc().status).not.toBe("resolved"); // nothing resolves itself
    expect(exc().history.filter((h) => h.action === "hold_boundary_noted")).toHaveLength(1);
    expect(exc().explanation).toMatch(/hold \(seq 3\) arrived later .* not a regression/);
    expect(r.audit.some((a) => a.action === "exception.context_added")).toBe(true);
    // A second side-state event (the partner release) does not annotate twice.
    ws = deliver(ws, id, 4, plusMin(vs[4].at, 2)).workspace;
    expect(exc().history.filter((h) => h.action === "hold_boundary_noted")).toHaveLength(1);
  });
  it("a hold that arrives AFTER both versions of a regression (not between them) does not annotate it", () => {
    let { ws, id, ref } = submittedConnect(CW);
    const send = (v: number, status: string, sub?: string) => {
      const b = JSON.stringify({ id: `evt_rr1_${v}`, type: "object.updated", payout: { ref, version: v, status, ...(sub ? { sub_status: sub } : {}), amount_minor: 1_000_000, currency: "SGD", updated_at: ws.asOf } });
      ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: CW, rawBody: b, signatureHeader: getAdapter(CW)!.signWebhook(b, Math.floor(Date.parse(ws.asOf) / 1000)) } }).workspace;
    };
    send(2, "routing", "at_bank");
    send(3, "routing", "awaiting_bank"); // regression, seq 2 → 3
    send(4, "paused_for_review"); // hold at seq 4: outside (2, 3)
    expect(intentOf(ws, id).status.execution).toBe("on_hold");
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).find((e) => e.explanationCode === "EV_PROVIDER_STATUS_REGRESSED")!;
    expect(exc.history.some((h) => h.action === "hold_boundary_noted")).toBe(false);
  });
  it("a regression that does NOT span the hold is not annotated", () => {
    let { ws, id } = submittedConnect(CW, "regress_substatus");
    for (const v of versions(ws, id).slice(1)) ws = deliver(ws, id, v.version).workspace;
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
    expect(exc.history.some((h) => h.action === "hold_boundary_noted")).toBe(false);
  });
});

describe("RR-2: the regression is found when its higher-ranked side was stored late", () => {
  for (const script of ["regress_mid", "regress_and_recover"])
    it(`${script}: all 24 arrival orders raise EV_PROVIDER_STATUS_REGRESSED and end identically`, () => {
      const base = submittedConnect(CW, script);
      const vs = versions(base.ws, base.id);
      const end = vs.at(-1)!.at;
      const outs = new Set<string>();
      let storedLateReference = 0;
      for (const order of permutations(vs.slice(1).map((v) => v.version))) {
        let ws = base.ws;
        order.forEach((v, i) => (ws = deliver(ws, base.id, v, plusMin(end, i)).workspace));
        const o = outcomeOf(ws, base.id);
        expect(o.openExceptions, order.join(",")).toContain("contradictory_evidence:EV_PROVIDER_STATUS_REGRESSED");
        outs.add(JSON.stringify(o));
        const exc = listExceptions(ws, { intentId: base.id, category: "contradictory_evidence" })[0];
        if (exc.supportingEventIds.some((x) => ws.providerEvents.find((e) => e.id === x)?.processingOutcome === "stored_late_no_regression")) storedLateReference++;
      }
      expect(outs.size).toBe(1);
      expect(storedLateReference).toBeGreaterThan(0); // the pattern the shipped scripts never exercised
    });
});

describe("RR-3: pre-check and engine verify the same canonical headers", () => {
  it("a genuine Quillfern delivery whose signature list is padded past 1024 characters is verified, ingested and applied", () => {
    const { ws, id } = submittedConnect(QF);
    const d = providerWebhook(ws, id, 2);
    const sigs = d.headers["x-quillfern-signatures"].split(",");
    const padded = { ...d.headers, "x-quillfern-signatures": sigs.join("," + " ".repeat(1100)) + "  " };
    expect(padded["x-quillfern-signatures"].length).toBeGreaterThan(1024);
    const r = receiveConnectWebhook(ws, { providerId: QF, rawBody: d.rawBody, headers: padded }, { actorId: "usr_maya", at: versions(ws, id)[1].at });
    expect(r.ok && [r.value.verification.status, r.value.action, r.value.outcome]).toEqual(["verified", "ingested", "applied"]);
  });
  it("garbage that stays over the decoder limit after canonicalisation is invalid in the pre-check AND rejected by the engine", () => {
    const { ws, id } = submittedConnect(QF);
    const d = providerWebhook(ws, id, 2);
    const junk = { ...d.headers, "x-quillfern-signatures": d.headers["x-quillfern-signatures"] + ",v1=" + "a".repeat(1100) };
    const r = receiveConnectWebhook(ws, { providerId: QF, rawBody: d.rawBody, headers: junk }, { actorId: "usr_maya", at: versions(ws, id)[1].at });
    expect(r.ok && [r.value.verification.status, r.value.action, r.value.outcome]).toEqual(["invalid", "rejected_recorded", "rejected_signature"]);
  });
  it("the verifier canonicalises too: padded timestamp and hex signature values verify when called directly", () => {
    const body = '{"x":1}';
    const now = 1_794_535_200;
    const h = signDelivery(COBALT_WREN.verification[0], body, connectKeyring(CW), now);
    const padded = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, `  ${v} `]));
    expect(verifyDelivery(COBALT_WREN.verification, body, padded, connectKeyring(CW), now).status).toBe("verified");
  });
  it("canonical form: trimmed, and no whitespace around signature-list commas", () => {
    expect(canonicalHeaderValue(QUILLFERN.verification, "X-Quillfern-Signatures", " v1=a ,  v1=b ")).toBe("v1=a,v1=b");
    expect(canonicalHeaderValue(QUILLFERN.verification, "x-quillfern-timestamp", " 123 ")).toBe("123");
  });
});

/** A Connect payout with a bank debit and the bridge's proposed entry. */
function withEntry(script: string) {
  let { ws, id, ref } = submittedConnect(CW, script);
  const vs = versions(ws, id);
  const completedAt = vs.findIndex((v) => v.entry.status === "delivered");
  for (const v of vs.slice(1, completedAt + 1)) ws = deliver(ws, id, v.version).workspace;
  expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
  ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ref, counterparty: "Cobalt Wren Payouts (fictional sandbox)" }) }).workspace;
  expect(intentOf(ws, id).status.settlement).toBe("verified");
  ws = run(ws, "usr_maya", { type: "set_account_mapping", entries: [...DEFAULT_SAMPLE_MAPPING.map((e) => ({ ...e })), { accountKey: "bank:BANK-SGD-TEST", accountCode: "1099", accountName: "Test bank account (fictional)" }] }).workspace;
  ws = run(ws, "usr_maya", { type: "open_accounting_period", name: "2026-11", from: "2026-11-01", to: "2026-12-01" }).workspace;
  ws = propose(ws).workspace;
  const entry = proposals(ws).find((p) => p.intentId === id)!;
  expect(entry).toMatchObject({ ruleCode: "JR_SUPPLIER_PAYOUT_DEBIT", showsSupplierPaid: true, status: "proposed" });
  return { ws, id, vs, entry, next: completedAt + 2 };
}
const supplierPayable = (ws: Workspace, id: string) => net(proposals(ws).filter((p) => p.intentId === id && !["superseded", "rejected"].includes(p.status))).get("supplier_payable|SGD") ?? 0n;

describe("RR-4: a conflict-driven execution change keeps the Accounting Bridge consistent", () => {
  it("paid → failed (provider reversal) after a PROPOSED entry: the entry is superseded and the debit is rebooked as not delivered", () => {
    let { ws, id, entry, next } = withEntry("return");
    ws = deliver(ws, id, next).workspace; // bounced: conflict path completed → failed
    expect(intentOf(ws, id).status).toMatchObject({ execution: "failed", settlement: "contradicted" });
    expect(proposals(ws).find((p) => p.id === entry.id)).toMatchObject({ status: "superseded", supersession: { code: "SP_EVIDENCE_CHANGED" } });
    ws = propose(ws).workspace;
    const live = proposals(ws).filter((p) => p.intentId === id && !["superseded", "rejected"].includes(p.status));
    expect(live.map((p) => [p.ruleCode, p.showsSupplierPaid])).toEqual([["JR_PAYOUT_DEBIT_NOT_DELIVERED", false]]);
    expect(supplierPayable(ws, id)).toBe(0n);
    expect(ledgerProblem(ws)).toBeUndefined();
  });
  it("paid → failed after the entry was APPROVED, EXPORTED and POSTED: it is kept, flagged, and reversed; the supplier is not shown paid", () => {
    let { ws, id, entry, next } = withEntry("return");
    ws = postAll(ws, [entry.id]);
    ws = deliver(ws, id, next).workspace;
    const posted = proposals(ws).find((p) => p.id === entry.id)!;
    expect(posted.status).toBe("posted");
    expect(posted.evidenceChange?.code).toBe("SP_EVIDENCE_CHANGED");
    ws = propose(ws).workspace;
    const rules = proposals(ws).filter((p) => p.intentId === id && p.id !== entry.id).map((p) => p.ruleCode).sort();
    expect(rules).toEqual(["JR_PAYOUT_DEBIT_NOT_DELIVERED", "JR_REVERSAL"]);
    expect(proposals(ws).find((p) => p.ruleCode === "JR_REVERSAL")!.reverses).toBe(entry.id);
    expect(supplierPayable(ws, id)).toBe(0n); // posted debit + reversal net to zero; the rebooking is to provider clearing
    expect(ledgerProblem(ws)).toBeUndefined();
  });
  it("completed → in_transit (cross-claim regression): while its contradiction is open the pending supplier-paid entry is superseded, nothing is proposed, and nothing double-counts (G1)", () => {
    let { ws, id, entry, next } = withEntry("regress_and_recover");
    ws = deliver(ws, id, next).workspace; // routing/at_bank: conflict path completed → in_transit
    expect(intentOf(ws, id).status.execution).toBe("in_transit");
    // Updated for the accounting round's G1 (coordinator request): while the regression's contradictory_evidence exception
    // is open the supplier is never shown paid, so the pending entry is superseded and nothing is proposed until a person
    // resolves it. It still never double-counts.
    expect(proposals(ws).find((p) => p.id === entry.id)!.status).toBe("superseded");
    ws = propose(ws).workspace;
    expect(proposals(ws).filter((p) => p.intentId === id && p.status === "proposed")).toHaveLength(0);
    expect(ledgerProblem(ws)).toBeUndefined();
  });
});
