/**
 * rc4 Connect — item 5 (dedupe by the provider's declared key with a documented fallback; ordering
 * by provider object version or state rank, never by arrival) and item 6 (polling reconciler:
 * at-most-once webhook loss followed by a poll gives the same final state as receiving the webhook).
 */
import { describe, expect, it } from "vitest";
import {
  CONNECT_DESCRIPTORS,
  CONNECT_SCRIPTS,
  applyAction,
  getAdapter,
  listExceptions,
  listSince,
  parseProviderBody,
  providerWebhook,
  reconcileConnect,
  unresolvedConnectIntents,
  type Workspace,
} from "@/lib/clearline";
import { run } from "./helpers";
import { CW, QF, SG, deliver, intentOf, outcomeOf, ownedContradiction, permutations, plusMin, poll, receive, rng, submittedConnect, versions } from "./rc4-connect-helpers";

const ctx = (at: string) => ({ actorId: "usr_maya", at });
const D = (p: string) => CONNECT_DESCRIPTORS.find((d) => d.providerId === p)!;

describe("rc4 Connect item 5a: dedupe by the provider's declared key, with a documented fallback", () => {
  it("Cobalt Wren: declared = event id; a redelivery (re-signed) is a duplicate; poll snapshots fall back to (ref, version)", () => {
    let { ws, id } = submittedConnect(CW);
    const v2 = versions(ws, id)[1];
    ws = deliver(ws, id, 2).workspace;
    const again = deliver(ws, id, 2, plusMin(v2.at, 30));
    expect(again.outcome).toBe("duplicate_ignored");
    expect(listExceptions(again.workspace, { intentId: id })).toEqual([]);
    const web = parseProviderBody(D(CW), providerWebhook(ws, id, 2).rawBody);
    expect(web.ok && [web.value.dedupeKey.startsWith("evt:"), web.value.dedupeKeySource]).toEqual([true, "declared"]);
    const snap = getAdapter(CW)!.fetchStatus!(ws, intentOf(ws, id), ws.instructions.find((i) => i.intentId === id)!, v2.at);
    const polled = snap.kind === "snapshot" ? parseProviderBody(D(CW), snap.rawBody) : undefined;
    expect(polled?.ok && [polled.value.dedupeKey, polled.value.dedupeKeySource]).toEqual([`ver:${intentOf(ws, id) && ws.instructions.find((i) => i.intentId === id)!.providerPaymentId}:2`, "fallback"]);
  });
  it("Cobalt Wren: the same event id with a different body is not applied and raises EV_SAME_ID_DIFFERENT_PAYLOAD", () => {
    let { ws, id } = submittedConnect(CW);
    const v2 = versions(ws, id)[1];
    ws = deliver(ws, id, 2).workspace;
    const d = providerWebhook(ws, id, 2);
    const changed = d.rawBody.replace('"awaiting_bank"', '"at_bank"');
    const r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: CW, rawBody: changed, signatureHeader: getAdapter(CW)!.signWebhook(changed, Math.floor(Date.parse(v2.at) / 1000)) } }, v2.at);
    expect(r.outcome).toBe("duplicate_ignored");
    expect(listExceptions(r.workspace, { intentId: id }).map((e) => e.explanationCode)).toEqual(["EV_SAME_ID_DIFFERENT_PAYLOAD"]);
  });
  it("Quillfern: declared = (ref, object version): a webhook and a poll of the same version dedupe across paths (same bytes, no exception)", () => {
    let { ws, id } = submittedConnect(QF);
    const v2 = versions(ws, id)[1];
    ws = deliver(ws, id, 2).workspace;
    const r = poll(ws, id, plusMin(v2.at, 1));
    expect(r.outcome).toBe("duplicate_ignored");
    const evs = r.workspace.providerEvents.filter((e) => e.intentId === id && e.sequence === 2);
    expect(evs.map((e) => e.provenance)).toEqual(["provider_webhook", "provider_poll"]);
    expect(evs[0].payloadHash).toBe(evs[1].payloadHash);
    expect(listExceptions(r.workspace, { intentId: id })).toEqual([]);
  });
  it("Saltglass: declared = event id; poll snapshots fall back to (ref, raw status)", () => {
    const { ws, id, ref } = submittedConnect(SG);
    const snap = getAdapter(SG)!.fetchStatus!(ws, intentOf(ws, id), ws.instructions.find((i) => i.intentId === id)!, versions(ws, id)[1].at);
    const c = snap.kind === "snapshot" ? parseProviderBody(D(SG), snap.rawBody) : undefined;
    expect(c?.ok && [c.value.dedupeKey, c.value.dedupeKeySource]).toEqual([`st:${ref}:broadcast_unconfirmed:`, "fallback"]);
    const w = parseProviderBody(D(SG), providerWebhook(ws, id, 2).rawBody);
    expect(w.ok && w.value.dedupeKeySource).toBe("declared");
  });
  it("a Quillfern body without its object version is refused (its ordering needs it), never deduped by guesswork", () => {
    const r = parseProviderBody(D(QF), JSON.stringify({ payment_ref: "QFRM-X", state: "RECEIVED", amount: 100, ccy: "SGD", changed_at: "2026-11-13T02:00:00.000Z" }));
    expect(!r.ok && r.error.message).toMatch(/orders by object version/);
  });
});

describe("rc4 Connect item 5b: ordering by provider version or state rank, never by arrival", () => {
  const finalOf = (ws: Workspace, id: string) => ({ ...outcomeOf(ws, id) });
  // Review M-1/M-2: EVERY non-hold script of the version-ordered providers, regressions and reversals included,
  // ends in exactly the same state (statuses, return status and open exception codes) in every arrival order.
  // Hold scripts are excluded: a late pre-hold event arriving during a hold is suppressed for a person (H3), see spec §6.
  const PERM_CASES = CONNECT_DESCRIPTORS.filter((d) => d.ordering.kind === "object_version").flatMap((d) =>
    Object.keys(CONNECT_SCRIPTS[d.providerId]).filter((s) => !s.startsWith("hold")).map((s) => [d.providerId, s] as const),
  );
  it("covers the regression and reversal scripts", () => {
    expect(PERM_CASES.map(([p, s]) => `${p}:${s}`)).toEqual(expect.arrayContaining([`${CW}:return`, `${CW}:regress_substatus`, `${CW}:regress_to_routing`, `${CW}:clawback`, `${QF}:return`]));
  });
  for (const [p, script] of PERM_CASES)
    it(`${p} ${script}: every arrival order of the webhooks ends in the same state as provider order`, () => {
      const base = submittedConnect(p, script);
      const vs = versions(base.ws, base.id).slice(1).map((v) => v.version);
      const end = versions(base.ws, base.id).at(-1)!.at;
      let ws0 = base.ws;
      vs.forEach((v, i) => (ws0 = deliver(ws0, base.id, v, plusMin(end, i)).workspace));
      const ref = finalOf(ws0, base.id);
      let n = 0;
      for (const order of permutations(vs)) {
        let ws = base.ws;
        order.forEach((v, i) => (ws = deliver(ws, base.id, v, plusMin(end, i)).workspace));
        expect(finalOf(ws, base.id), order.join(",")).toEqual(ref);
        n++;
      }
      expect(n).toBe(permutations(vs).length);
      expect(n).toBeGreaterThanOrEqual(2);
      const contradictions = ref.openExceptions.filter((e) => e.startsWith("contradictory"));
      if (/regress|^return$/.test(script) && p === CW) {
        expect(contradictions.length, script).toBe(1);
        expect(ownedContradiction(ws0, base.id).whoActs).not.toBe("WA_NONE");
      } else expect(contradictions).toEqual([]);
    });
  it("Cobalt Wren paid → failed: the one outcome in every order is failed + EV_PROVIDER_SUCCESS_REVERSED + the failure exception", () => {
    const base = submittedConnect(CW, "return");
    const vs = versions(base.ws, base.id);
    for (const order of permutations(vs.slice(1).map((v) => v.version))) {
      let ws = base.ws;
      order.forEach((v, i) => (ws = deliver(ws, base.id, v, plusMin(vs.at(-1)!.at, i)).workspace));
      expect(outcomeOf(ws, base.id).status.execution, order.join(",")).toBe("failed");
      expect(outcomeOf(ws, base.id).openExceptions).toEqual(["contradictory_evidence:EV_PROVIDER_SUCCESS_REVERSED", "failed_submission:PV_FAILED_BENEFICIARY_REJECTED"]);
    }
  });
  it("Saltglass (no version) orders by raw rank: a preliminary status after the final one is late, not a regression", () => {
    let { ws, id } = submittedConnect(SG);
    const vs = versions(ws, id);
    ws = poll(ws, id, vs[2].at, 3).workspace;
    const r = poll(ws, id, plusMin(vs[2].at, 1), 2);
    expect(r.outcome).toBe("stored_late_no_regression");
    expect(intentOf(r.workspace, id).status.execution).toBe("provider_reported_completed");
    expect(listExceptions(r.workspace, { intentId: id })).toEqual([]);
  });
  it("arrival time is not used: two deliveries in reverse arrival order but the same versions give the same result", () => {
    const a = submittedConnect(CW);
    const vs = versions(a.ws, a.id);
    const t = vs.at(-1)!.at;
    const w1 = deliver(deliver(a.ws, a.id, 4, t).workspace, a.id, 5, plusMin(t, 1)).workspace;
    const w2 = deliver(deliver(a.ws, a.id, 5, t).workspace, a.id, 4, plusMin(t, 1)).workspace;
    expect(outcomeOf(w1, a.id)).toEqual(outcomeOf(w2, a.id));
  });
});

/** Run W: every webhook arrives at its version's time. Saltglass webhooks go through the intake (unverified → poll). */
function runWebhooks(p: string, script: string) {
  let { ws, id } = submittedConnect(p, script);
  for (const v of versions(ws, id).slice(1)) ws = p === SG ? receive(ws, id, v.version).workspace : deliver(ws, id, v.version).workspace;
  return { ws, id };
}

describe("rc4 Connect item 6: at-most-once webhook loss + poll gives the same final state", () => {
  const cases: [string, string][] = [];
  for (const d of CONNECT_DESCRIPTORS) for (const s of Object.keys(CONNECT_SCRIPTS[d.providerId])) cases.push([d.providerId, s]);

  it(`property: for ${cases.length} provider scripts × 25 seeds, each lost webhook replaced by a fetchStatus poll before the next version ends identically`, () => {
    let lost = 0;
    for (const [p, script] of cases) {
      const w = runWebhooks(p, script);
      const expected = outcomeOf(w.ws, w.id);
      for (let seed = 1; seed <= 25; seed++) {
        const r = rng(seed * 7919 + p.length);
        let { ws, id } = submittedConnect(p, script);
        for (const v of versions(ws, id).slice(1)) {
          if (r() < 0.5) {
            ws = p === SG ? receive(ws, id, v.version).workspace : deliver(ws, id, v.version).workspace;
          } else {
            lost++; // at-most-once: this delivery never arrives; the reconciler polls before the next change
            ws = reconcileConnect(ws, ctx(plusMin(v.at, 1))).workspace;
          }
        }
        expect(outcomeOf(ws, id), `${p} ${script} seed ${seed}`).toEqual(expected);
      }
    }
    expect(lost).toBeGreaterThan(100);
  });

  it("every webhook lost: one list_since pass replays each provider's change feed in order and ends identically (feed providers)", () => {
    for (const [p, script] of cases.filter(([p]) => D(p).polling.listSince)) {
      const w = runWebhooks(p, script);
      const { ws, id } = submittedConnect(p, script);
      const end = versions(ws, id).at(-1)!.at;
      const r = reconcileConnect(ws, ctx(plusMin(end, 1)), { mode: "list_since" });
      expect(outcomeOf(r.workspace, id), `${p} ${script}`).toEqual(outcomeOf(w.ws, w.id));
      expect(r.cursors[p]).toBe(plusMin(end, 1));
      // A second pass from the returned cursor finds nothing new.
      const again = reconcileConnect(r.workspace, ctx(plusMin(end, 2)), { mode: "list_since", cursors: r.cursors });
      expect(again.results.filter((x) => x.providerId === p)).toEqual([]);
    }
  });

  it("Saltglass has no change feed: list_since falls back to fetchStatus, which ends identically for its scripts", () => {
    // claims_conflict needs both completion claims seen; one late poll sees only the last (the §7 single-poll limit).
    for (const script of Object.keys(CONNECT_SCRIPTS[SG]).filter((x) => x !== "claims_conflict")) {
      const w = runWebhooks(SG, script);
      const { ws, id } = submittedConnect(SG, script);
      const end = versions(ws, id).at(-1)!.at;
      expect(listSince(ws, SG, undefined, end).supported).toBe(false);
      const r = reconcileConnect(ws, ctx(plusMin(end, 1)), { mode: "list_since" });
      expect(outcomeOf(r.workspace, id), script).toEqual(outcomeOf(w.ws, w.id));
    }
  });

  it("documented limit: a single late fetchStatus can miss a transient state (delivered → bounced); the change feed does not", () => {
    const w = runWebhooks(CW, "return");
    const { ws, id } = submittedConnect(CW, "return");
    const end = versions(ws, id).at(-1)!.at;
    const once = reconcileConnect(ws, ctx(plusMin(end, 1)));
    expect(intentOf(once.workspace, id).status.execution).toBe("failed"); // never saw "delivered"
    expect(outcomeOf(once.workspace, id)).not.toEqual(outcomeOf(w.ws, w.id));
    const feed = reconcileConnect(ws, ctx(plusMin(end, 1)), { mode: "list_since" });
    expect(outcomeOf(feed.workspace, id)).toEqual(outcomeOf(w.ws, w.id));
  });

  it("the reconciler polls only unresolved Connect payouts, skips unchanged snapshots, and reports per payout", () => {
    let a = submittedConnect(CW);
    let b = submittedConnect(QF, "return", {}, a.ws);
    let ws = b.ws;
    expect(unresolvedConnectIntents(ws).sort()).toEqual([a.id, b.id].sort());
    const end = versions(ws, b.id).at(-1)!.at;
    ws = reconcileConnect(ws, ctx(end)).workspace;
    expect(intentOf(ws, b.id).status.execution).toBe("returned");
    expect(unresolvedConnectIntents(ws)).toEqual([a.id]); // returned is terminal; completed can still regress
    const again = reconcileConnect(ws, ctx(plusMin(end, 5)));
    expect(again.results).toEqual([{ intentId: a.id, providerId: CW, version: 5, outcome: "unchanged" }]);
    expect(again.workspace).toBe(ws);
  });

  it("poll_provider: the engine fetches the snapshot itself; provenance provider_poll; refuses before submission or a version not yet existing", () => {
    const { ws, id } = submittedConnect(QF);
    const v2 = versions(ws, id)[1];
    const r = poll(ws, id, v2.at);
    expect(r.outcome).toBe("applied");
    expect(r.workspace.providerEvents.at(-1)).toMatchObject({ provenance: "provider_poll", signatureResult: "not_applicable", confidence: "provider_claim" });
    expect(poll(ws, id, v2.at, 3).outcome).toBe("no_event_pending");
    const bad = applyAction(ws, { type: "poll_provider", intentId: id, version: 0 }, ctx(v2.at));
    expect(!bad.ok && bad.error.code).toBe("invalid_field");
    const viewer = applyAction(ws, { type: "poll_provider", intentId: id }, { actorId: "usr_alex", at: v2.at });
    expect(!viewer.ok && viewer.error.code).toBe("unauthorized_actor");
    const legacy = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-P-1", amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-P-01", beneficiaryName: "P Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20", idempotencyKey: "poll-key-00001" } });
    const pre = applyAction(legacy.workspace, { type: "poll_provider", intentId: legacy.createdIds[0] }, ctx(v2.at));
    expect(!pre.ok && pre.error.code).toBe("precondition_failed");
  });
});
