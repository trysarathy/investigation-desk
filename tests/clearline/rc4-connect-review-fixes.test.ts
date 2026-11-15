/**
 * rc4 Connect — fixes for the independent review (CODE_REVIEW_RC4_CONNECT.md): M-3 hold release, L-1 reconciler
 * skip after a hold, M-4 intake receipt, L-3 unverified-scheme audit text, L-4 header-bundle prefix.
 * (M-1, M-2 and L-2 are pinned in rc4-connect-status.test.ts and rc4-connect-delivery.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { QUILLFERN, applyAction, declaredHeaders, decodeHeaderBundle, getAdapter, listExceptions, providerWebhook, receiveConnectWebhook, reconcileConnect, type Workspace } from "@/lib/clearline";
import { run, signedDelivery, submitted } from "./helpers";
import { CW, QF, SG, deliver, intentOf, plusMin, submittedConnect, versions } from "./rc4-connect-helpers";

const ctx = (at: string) => ({ actorId: "usr_maya", at });
const holdOf = (ws: Workspace, id: string) => ws.holds.find((h) => h.intentId === id)!;
function prepareRelease(ws: Workspace, id: string, at: string) {
  const h = holdOf(ws, id);
  ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: h.id, documents: ["Supporting commercial invoice"] }, at).workspace;
  return run(ws, "usr_daniel", { type: "assign_hold_reviewer", holdId: h.id, reviewerId: "usr_priya" }, at).workspace;
}
const release = (ws: Workspace, id: string, at: string) => run(ws, "usr_priya", { type: "record_hold_decision", holdId: holdOf(ws, id).id, decision: "release", reason: "Documents reviewed (fictional)" }, at).workspace;

describe("review M-3: a Connect hold can be released — only with the partner's release AND the reviewer's decision", () => {
  for (const p of [CW, QF])
    it(`${p}: hold → documents → reviewer release → partner release → resumes (lower rank, no regression) → completes`, () => {
      let { ws, id } = submittedConnect(p, "hold_release");
      const vs = versions(ws, id);
      const holdV = vs.findIndex((v) => v.entry.status === "paused_for_review" || v.entry.status === "HALTED") + 1;
      for (const v of vs.slice(1, holdV)) ws = deliver(ws, id, v.version).workspace;
      expect(intentOf(ws, id).status.execution).toBe("on_hold");
      ws = prepareRelease(ws, id, vs[holdV - 1].at);
      ws = release(ws, id, plusMin(vs[holdV - 1].at, 5));
      expect(intentOf(ws, id).status.execution).toBe("on_hold"); // the reviewer alone does not release
      ws = deliver(ws, id, holdV + 1).workspace; // partner release
      expect(holdOf(ws, id).status).toBe("released");
      expect(intentOf(ws, id).status.execution).toBe("in_transit");
      for (const v of vs.slice(holdV + 1)) ws = deliver(ws, id, v.version).workspace;
      expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
      expect(listExceptions(ws, { intentId: id, category: "contradictory_evidence" })).toEqual([]);
    });
  it("the partner's release alone never releases; the reviewer's later decision then does", () => {
    let { ws, id } = submittedConnect(CW, "hold_release");
    const vs = versions(ws, id);
    for (const v of [2, 3, 4]) ws = deliver(ws, id, v).workspace;
    expect(holdOf(ws, id).status).toBe("partner_release_reported");
    expect(intentOf(ws, id).status.execution).toBe("on_hold");
    ws = prepareRelease(ws, id, vs[3].at);
    ws = release(ws, id, plusMin(vs[3].at, 5));
    expect(intentOf(ws, id).status.execution).toBe("in_transit");
  });
  it("hold-capable descriptors map a partner-release status to payout.hold_released", () => {
    for (const d of [QUILLFERN]) expect(d.statuses.some((m) => m.event === "payout.hold_released")).toBe(true);
    expect(getAdapter(CW)!.parseWebhook(JSON.stringify({ ref: "CWPO-X", version: 4, status: "review_cleared", amount_minor: 1, currency: "SGD", updated_at: "2026-11-13T02:00:00.000Z" })).ok).toBe(true);
  });
});

describe("review L-1: a status suppressed during a hold is re-applied by the reconciler after the hold ends", () => {
  it("list_since during the hold records the partner release and suppresses later versions; after the reviewer's release the reconciler applies them", () => {
    let { ws, id } = submittedConnect(CW, "hold_release");
    const end = versions(ws, id).at(-1)!.at;
    ws = reconcileConnect(ws, ctx(plusMin(end, 1)), { mode: "list_since" }).workspace;
    expect(intentOf(ws, id).status.execution).toBe("on_hold");
    expect(holdOf(ws, id).status).toBe("partner_release_reported");
    expect(ws.providerEvents.some((e) => e.intentId === id && e.detail.suppressedOnHold)).toBe(true);
    ws = prepareRelease(ws, id, plusMin(end, 2));
    ws = release(ws, id, plusMin(end, 3));
    expect(intentOf(ws, id).status.execution).toBe("in_transit");
    const r = reconcileConnect(ws, ctx(plusMin(end, 4)));
    expect(r.results.map((x) => x.outcome)).toEqual(["applied"]);
    expect(intentOf(r.workspace, id).status.execution).toBe("provider_reported_completed");
  });
});

describe("review M-4: the intake receipt follows what the engine recorded", () => {
  it("a correctly signed delivery with many ordinary request headers (and odd names) is ingested and applied", () => {
    const { ws, id } = submittedConnect(CW);
    const v2 = versions(ws, id)[1];
    const d = providerWebhook(ws, id, 2);
    const noise: Record<string, string> = { "X_Forwarded_Proto": "https", "user-agent": "fictional-provider/1.0", "content-type": "application/json" };
    for (let i = 0; i < 20; i++) noise[`x-trace-${i}`] = "t".repeat(1500);
    const r = receiveConnectWebhook(ws, { providerId: CW, rawBody: d.rawBody, headers: { ...noise, ...d.headers } }, ctx(v2.at));
    expect(r.ok && [r.value.verification.status, r.value.action, r.value.outcome]).toEqual(["verified", "ingested", "applied"]);
    expect(declaredHeaders(QUILLFERN)).toEqual(["x-quillfern-signatures", "x-quillfern-timestamp"]);
  });
  it("an invalid delivery is reported as rejected_recorded, matching the engine's rejected_signature", () => {
    const { ws, id } = submittedConnect(CW);
    const v2 = versions(ws, id)[1];
    const d = providerWebhook(ws, id, 2);
    const r = receiveConnectWebhook(ws, { providerId: CW, rawBody: d.rawBody + " ", headers: d.headers }, ctx(v2.at));
    expect(r.ok && [r.value.verification.status, r.value.action, r.value.outcome]).toEqual(["invalid", "rejected_recorded", "rejected_signature"]);
  });
});

describe("review L-3: an unverified-scheme delivery is audited as such, not as an invalid signature", () => {
  it("Saltglass through ingest_webhook: 'unverified scheme' in the audit; an original provider's bad signature keeps its text", () => {
    const { ws, id } = submittedConnect(SG);
    const d = providerWebhook(ws, id, 2);
    const r = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: SG, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, ctx(versions(ws, id)[1].at));
    expect(r.ok && r.value.outcome).toBe("rejected_signature");
    if (r.ok) expect(r.value.audit.find((a) => a.action === "event.rejected_signature")!.summary).toMatch(/unverified scheme/);
    const legacy = submitted({}, "prv_northline");
    const bad = signedDelivery(legacy.ws, "prv_northline", { id: `${legacy.ppid}-E2`, type: "payout.in_transit", provider_payment_id: legacy.ppid, sequence: 2, occurred_at: legacy.ws.asOf });
    const lr = run(legacy.ws, "usr_maya", { type: "ingest_webhook", delivery: { ...bad, signatureHeader: bad.signatureHeader.slice(0, -4) + "0000" } });
    expect(lr.audit.find((a) => a.action === "event.rejected_signature")!.summary).toBe("Webhook signature invalid; not applied");
  });
});

describe("review L-4: the header bundle format requires its prefix", () => {
  it("bare JSON (no headers-v1: prefix) is not a bundle", () => {
    expect(decodeHeaderBundle(JSON.stringify({ a: "1" }))).toBeUndefined();
    expect(decodeHeaderBundle("headers-v2:" + JSON.stringify({ a: "1" }))).toBeUndefined();
    expect(decodeHeaderBundle("headers-v1:" + JSON.stringify({ a: "1" }))).toEqual({ a: "1" });
  });
});
