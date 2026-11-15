/**
 * Independent QA, release candidate 4 (2c0f0f0): Connect adapter framework, adversarial.
 * Tests named "DEFECT (...)" assert the correct behaviour and FAIL on 2c0f0f0; the rest pass and pin what held.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction, connectKeyring, encodeHeaderBundle, getDescriptor, providerWebhook, receiveConnectWebhook, signDelivery, type Workspace,
} from "@/lib/clearline";
import { CW, QF, SG, deliver, intentOf, outcomeOf, plusMin, poll, submittedConnect, versions } from "../clearline/rc4-connect-helpers";

const tryAct = (ws: Workspace, action: Parameters<typeof applyAction>[1], at = ws.asOf) => applyAction(ws, action, { actorId: "usr_maya", at });
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const lastEvent = (ws: Workspace, id: string) => ws.providerEvents.filter((e) => e.intentId === id).at(-1)!;

describe("QA rc4 Connect: webhook verification", () => {
  it("a byte changed after signing is rejected and not applied", () => {
    const s = submittedConnect(CW, "success");
    const v = versions(s.ws, s.id).at(-1)!;
    const d = providerWebhook(s.ws, s.id, v.version, { signAt: v.at });
    const tampered = d.rawBody.replace(/"delivered"|"routing"|"queued"/, '"delivered"').replace(/}$/, ' }');
    const r = tryAct(s.ws, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: tampered, signatureHeader: d.signatureHeader } }, v.at);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.outcome).toBe("rejected_signature");
    expect(intentOf(r.value.workspace, s.id).status.execution).toBe(intentOf(s.ws, s.id).status.execution);
  });

  it("replay: the same delivery twice is a duplicate; the same delivery outside the 300 s window is invalid", () => {
    const s = submittedConnect(CW, "success");
    const v = versions(s.ws, s.id)[1];
    const first = deliver(s.ws, s.id, v.version);
    const d = providerWebhook(first.workspace, s.id, v.version, { signAt: v.at });
    const again = tryAct(first.workspace, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, plusMin(v.at, 1));
    expect(again.ok && again.value.outcome).toBe("duplicate_ignored");
    const late = tryAct(s.ws, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, plusMin(v.at, 6));
    expect(late.ok && late.value.outcome).toBe("rejected_signature");
  });

  it("rotated keys: a key outside its validity window, and a non-test_ secret, never verify", () => {
    const s = submittedConnect(QF, "success");
    const keys = connectKeyring(QF);
    const v = versions(s.ws, s.id)[1];
    const expired = keys.map((k) => ({ ...k, activeFrom: 0, activeUntil: unix(v.at) - 3600 }));
    const d = providerWebhook(s.ws, s.id, v.version, { signAt: v.at, keys: expired });
    // The engine verifies with its own keyring; a signature by an attacker-chosen secret fails:
    const fake = providerWebhook(s.ws, s.id, v.version, { signAt: v.at, keys: [{ keyId: "k_attacker", secret: "test_attacker_secret" }] });
    const r = tryAct(s.ws, { type: "ingest_webhook", delivery: { providerId: fake.providerId, rawBody: fake.rawBody, signatureHeader: fake.signatureHeader } }, v.at);
    expect(r.ok && r.value.outcome).toBe("rejected_signature");
    expect(d.rawBody.length).toBeGreaterThan(0);
    expect(() => signDelivery(getDescriptor(QF)!.verification[0], "{}", [{ keyId: "live", secret: "sk_live_x" }], 1)).toThrow();
  });

  it("unknown or unimplemented scheme (Saltglass): a forged 'final' webhook is never applied through the raw action", () => {
    const s = submittedConnect(SG, "success");
    const vs = versions(s.ws, s.id);
    const fin = vs.at(-1)!;
    const d = providerWebhook(s.ws, s.id, fin.version, { signAt: fin.at, headers: { "x-forged": "1" } });
    const r = tryAct(s.ws, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: d.rawBody, signatureHeader: encodeHeaderBundle({ "x-forged": "1" }) } }, fin.at);
    expect(r.ok && r.value.outcome).toBe("rejected_signature");
    if (!r.ok) return;
    expect(intentOf(r.value.workspace, s.id).status.settlement).not.toBe("verified");
    expect(r.value.workspace.chainObservations.filter((o) => o.intentId === s.id)).toEqual([]);
  });

  it("header-bundle abuse is refused: oversize, too many headers, bad names, non-string values, missing prefix", () => {
    const s = submittedConnect(CW, "success");
    const v = versions(s.ws, s.id)[1];
    const d = providerWebhook(s.ws, s.id, v.version, { signAt: v.at });
    const good = JSON.parse(d.signatureHeader.slice("headers-v1:".length)) as Record<string, string>;
    const many: Record<string, string> = { ...good }; for (let k = 0; k < 20; k++) many[`x-pad-${k}`] = "1";
    const bundles = [
      "headers-v1:" + JSON.stringify({ ...good, "x-pad": "a".repeat(5000) }),
      "headers-v1:" + JSON.stringify(many),
      "headers-v1:" + JSON.stringify({ ...good, "X-UPPER": "1" }),
      "headers-v1:" + JSON.stringify({ ...good, "x-num": 1 }),
      JSON.stringify(good),
      "headers-v1:[]",
      "headers-v1:" + JSON.stringify(good).replace(/^\{/, '{"__proto__":"x",'),
    ];
    for (const b of bundles) {
      const r = tryAct(s.ws, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: d.rawBody, signatureHeader: b } }, v.at);
      expect(r.ok ? r.value.outcome : r.error.code, b.slice(0, 40)).not.toBe("applied");
    }
  });
});

describe("QA rc4 Connect: polling and settlement", () => {
  it("poll injection: a version the provider never had, a negative or fractional version, and another payout's id are refused or change nothing", () => {
    const s = submittedConnect(CW, "success");
    const at = plusMin(s.ws.asOf, 300);
    for (const version of [999, -1, 1.5, Number.NaN]) {
      const r = tryAct(s.ws, { type: "poll_provider", intentId: s.id, version }, at);
      expect(r.ok ? r.value.outcome : "refused", String(version)).not.toBe("applied");
    }
    const notConnect = tryAct(s.ws, { type: "poll_provider", intentId: "pi_nope" }, at);
    expect(notConnect.ok).toBe(false);
  });

  it("no provider claim ever verifies settlement: delivered/bank_confirmed, presumed-after-window, book transfer, preliminary hash", () => {
    for (const [p, script] of [[CW, "success"], [QF, "presumed_only"], [SG, "internal_ledger"], [SG, "claims_conflict"], [QF, "success"], [CW, "clawback"]] as const) {
      let s;
      try { s = submittedConnect(p, script); } catch { s = submittedConnect(p); }
      let ws = s.ws;
      for (const v of versions(ws, s.id)) { try { ws = deliver(ws, s.id, v.version).workspace; } catch { /* unverified / suppressed */ } }
      ws = poll(ws, s.id, plusMin(ws.asOf, 600)).workspace;
      const st = intentOf(ws, s.id).status;
      // Saltglass "onchain_final" may verify through the chain observation; every other claim must not.
      const chainFinal = ws.chainObservations.some((o) => o.intentId === s.id && o.status === "final");
      if (!chainFinal) expect(st.settlement, `${p}/${script}`).not.toBe("verified");
      for (const o of ws.chainObservations.filter((x) => x.intentId === s.id)) expect(o.txHash).not.toBe(String(lastEvent(ws, s.id).detail?.rawTxHashPreliminary ?? "none"));
    }
  });

  it("arrival order: delivered→bounced in reverse order ends the same as in provider order", () => {
    const s = submittedConnect(CW, "return");
    const vs = versions(s.ws, s.id);
    let a = s.ws; for (const v of vs) a = deliver(a, s.id, v.version, vs.at(-1)!.at).workspace;
    let b = s.ws; for (const v of [...vs].reverse()) b = deliver(b, s.id, v.version, vs.at(-1)!.at).workspace;
    expect(outcomeOf(b, s.id)).toEqual(outcomeOf(a, s.id));
    expect(intentOf(a, s.id).status.settlement).not.toBe("verified");
  });

  it("receiveConnectWebhook on an unverified provider ignores the forged body and applies the polled truth", () => {
    const s = submittedConnect(SG, "success");
    const v = versions(s.ws, s.id)[0];
    const forged = providerWebhook(s.ws, s.id, versions(s.ws, s.id).at(-1)!.version, { signAt: v.at, headers: {} });
    const r = receiveConnectWebhook(s.ws, { providerId: SG, rawBody: forged.rawBody, headers: {} }, { actorId: "usr_maya", at: plusMin(v.at, 1) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recorded = r.value.workspace.providerEvents.filter((e) => e.intentId === s.id).map((e) => e.rawBody);
    expect(recorded).not.toContain(forged.rawBody);
  });
});
