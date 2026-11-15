/**
 * rc4 Connect — item 4: pluggable webhook verification on the raw body. Two schemes on top of the
 * existing one (hex HMAC-SHA256 with a timestamp header; multi-signature with a timestamp), several
 * active secrets (rotation), a replay window, constant-time comparison, `test_` secrets only, and
 * "unverified → poll to confirm" for no / unknown / unimplemented schemes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COBALT_WREN,
  QUILLFERN,
  SALTGLASS,
  applyAction,
  assertSandboxKeyring,
  connectKeyring,
  decodeHeaderBundle,
  encodeHeaderBundle,
  getAdapter,
  providerWebhook,
  receiveConnectWebhook,
  sandboxWebhookSecret,
  signDelivery,
  signSandboxWebhook,
  verifyDelivery,
  type SigningKey,
  type VerificationScheme,
} from "@/lib/clearline";
import { CW, QF, SG, deliver, intentOf, plusMin, submittedConnect, versions } from "./rc4-connect-helpers";

const NOW = 1_794_535_200; // 2026-11-13T04:00:00Z
const BODY = '{"ref":"QFRM-TEST","rev":2,"state":"IN_FLIGHT"}';
const hex = COBALT_WREN.verification[0];
const multi = QUILLFERN.verification[0];
const cwKeys = connectKeyring(CW);
const qfKeys = connectKeyring(QF);

describe("rc4 Connect item 4a: hex HMAC-SHA256 with a timestamp header", () => {
  const signed = signDelivery(hex, BODY, cwKeys, NOW);
  it("verifies the exact raw body; any byte change, wrong key or swapped timestamp fails", () => {
    expect(verifyDelivery([hex], BODY, signed, cwKeys, NOW)).toMatchObject({ status: "verified", scheme: "hex_hmac_sha256_ts", keyId: "cw_2026_a", timestamp: NOW });
    expect(verifyDelivery([hex], BODY + " ", signed, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([hex], BODY.replace("2", "3"), signed, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([hex], BODY, signed, [{ keyId: "x", secret: "test_other" }], NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([hex], BODY, { ...signed, "x-cobaltwren-timestamp": String(NOW - 1) }, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
  });
  it("header names are case-insensitive; missing or malformed headers are invalid (not unverified)", () => {
    const upper = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.toUpperCase(), v]));
    expect(verifyDelivery([hex], BODY, upper, cwKeys, NOW).status).toBe("verified");
    expect(verifyDelivery([hex], BODY, {}, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "missing_signature" });
    expect(verifyDelivery([hex], BODY, { ...signed, "x-cobaltwren-signature": "ABC" }, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "malformed_header" });
    expect(verifyDelivery([hex], BODY, { "x-cobaltwren-signature": signed["x-cobaltwren-signature"] }, cwKeys, NOW)).toMatchObject({ status: "invalid", reason: "malformed_header" });
  });
  it("replay window: older or newer than the tolerance is refused; at the edge it passes", () => {
    expect(verifyDelivery([hex], BODY, signed, cwKeys, NOW + 300).status).toBe("verified");
    expect(verifyDelivery([hex], BODY, signed, cwKeys, NOW + 301)).toMatchObject({ status: "invalid", reason: "timestamp_outside_tolerance" });
    expect(verifyDelivery([hex], BODY, signed, cwKeys, NOW - 301)).toMatchObject({ status: "invalid", reason: "timestamp_outside_tolerance" });
    expect(verifyDelivery([hex], BODY, signed, cwKeys, Number.NaN)).toMatchObject({ status: "invalid", reason: "timestamp_outside_tolerance" });
  });
});

describe("rc4 Connect item 4b: multi-signature header with timestamp, key rotation", () => {
  const [oldKey, newKey] = qfKeys;
  it("during rotation the provider signs with both keys; either signature alone also verifies", () => {
    const both = signDelivery(multi, BODY, qfKeys, NOW);
    expect(both["x-quillfern-signatures"].split(",")).toHaveLength(2);
    expect(verifyDelivery([multi], BODY, both, qfKeys, NOW)).toMatchObject({ status: "verified", keyId: "qf_2026_old" });
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, [newKey], NOW), qfKeys, NOW)).toMatchObject({ status: "verified", keyId: "qf_2026_new" });
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, [oldKey], NOW), qfKeys, NOW)).toMatchObject({ status: "verified", keyId: "qf_2026_old" });
  });
  it("a retired key no longer verifies after its window; a key before its window does not verify yet", () => {
    const after = oldKey.activeUntil! + 10;
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, [oldKey], after), qfKeys, after)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, [newKey], after), qfKeys, after).status).toBe("verified");
    const before = newKey.activeFrom! - 10;
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, [newKey], before), qfKeys, before)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    const none: SigningKey[] = [{ keyId: "k", secret: "test_k", activeUntil: NOW - 1 }];
    expect(verifyDelivery([multi], BODY, signDelivery(multi, BODY, none, NOW), none, NOW)).toMatchObject({ status: "invalid", reason: "no_active_key" });
  });
  it("one forged signature among valid ones still verifies only through the valid one; all forged fails; malformed lists fail", () => {
    const good = signDelivery(multi, BODY, [newKey], NOW)["x-quillfern-signatures"];
    const ts = { "x-quillfern-timestamp": String(NOW) };
    expect(verifyDelivery([multi], BODY, { ...ts, "x-quillfern-signatures": `v1=${"0".repeat(64)},${good}` }, qfKeys, NOW).status).toBe("verified");
    expect(verifyDelivery([multi], BODY, { ...ts, "x-quillfern-signatures": `v1=${"0".repeat(64)},v1=${"1".repeat(64)}` }, qfKeys, NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([multi], BODY, { ...ts, "x-quillfern-signatures": "v2=abc" }, qfKeys, NOW)).toMatchObject({ status: "invalid", reason: "malformed_header" });
    expect(verifyDelivery([multi], BODY, { ...ts, "x-quillfern-signatures": Array(9).fill(good).join(",") }, qfKeys, NOW)).toMatchObject({ status: "invalid", reason: "malformed_header" });
  });
});

describe("rc4 Connect item 4c: the existing scheme is one of the pluggable schemes", () => {
  it("clearline_sandbox_v1 verifies the original t=/v1= header against every active key", () => {
    const scheme: VerificationScheme = { id: "clearline_sandbox_v1", signatureHeader: "x-sandbox-signature", toleranceSeconds: 300 };
    const keys: SigningKey[] = [{ keyId: "old", secret: "test_old_secret" }, { keyId: "cur", secret: sandboxWebhookSecret("prv_northline") }];
    const header = signSandboxWebhook(BODY, sandboxWebhookSecret("prv_northline"), NOW);
    expect(verifyDelivery([scheme], BODY, { "x-sandbox-signature": header }, keys, NOW)).toMatchObject({ status: "verified", keyId: "cur" });
    expect(verifyDelivery([scheme], BODY + "x", { "x-sandbox-signature": header }, keys, NOW)).toMatchObject({ status: "invalid", reason: "signature_mismatch" });
    expect(verifyDelivery([scheme], BODY, { "x-sandbox-signature": "t=1,v1=zz" }, keys, NOW)).toMatchObject({ status: "invalid", reason: "malformed_header" });
  });
});

describe("rc4 Connect item 4d: no, unknown or unimplemented scheme → unverified (poll to confirm), never a fact", () => {
  it("classifies each case as unverified", () => {
    expect(verifyDelivery([], BODY, {}, [], NOW)).toEqual({ status: "unverified", scheme: "none", reason: "no_signature_scheme" });
    expect(verifyDelivery([{ id: "none", toleranceSeconds: 300 }], BODY, {}, [], NOW)).toEqual({ status: "unverified", scheme: "none", reason: "no_signature_scheme" });
    expect(verifyDelivery(SALTGLASS.verification, BODY, { "x-saltglass-signature": "anything" }, [], NOW)).toEqual({ status: "unverified", scheme: "asymmetric_rsa_sha256_ts", reason: "scheme_not_implemented" });
    expect(verifyDelivery([{ id: "made_up_scheme" as never, toleranceSeconds: 300 }], BODY, {}, [], NOW)).toEqual({ status: "unverified", scheme: "unknown", reason: "unknown_scheme" });
  });
  it("through the engine directly, an unverified webhook is never applied (recorded as not applied)", () => {
    const { ws, id } = submittedConnect(SG);
    const v2 = versions(ws, id)[1];
    const d = providerWebhook(ws, id, 2);
    const r = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: SG, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, { actorId: "usr_maya", at: v2.at });
    expect(r.ok && r.value.outcome).toBe("rejected_signature");
    if (r.ok) expect(intentOf(r.value.workspace, id).status.execution).toBe("submitted");
  });
  it("through the Connect intake it is not applied; Clearline polls and applies the provider's OWN answer", () => {
    const { ws, id, ref } = submittedConnect(SG);
    const v2 = versions(ws, id)[1];
    // A forged, unverifiable body claiming the payout is final on chain:
    const forged = JSON.stringify({ event_id: "evt_forged_0001", type: "object.updated", transfer: { transfer_ref: ref, phase: "onchain_final", amount_minor: 250_000_000, asset: "USDC", tx_hash: "0x" + "ab".repeat(32), at: v2.at } });
    const r = receiveConnectWebhook(ws, { providerId: SG, rawBody: forged, headers: { "x-saltglass-signature": "forged", "x-saltglass-timestamp": String(Math.floor(Date.parse(v2.at) / 1000)) } }, { actorId: "usr_maya", at: v2.at });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ action: "polled_to_confirm", verification: { status: "unverified", reason: "scheme_not_implemented" } });
    const w = r.value.workspace;
    // The provider's truth at that time is broadcast_unconfirmed (in transit), not final.
    expect(intentOf(w, id).status.execution).toBe("in_transit");
    expect(w.providerEvents.some((e) => e.rawBody === forged)).toBe(false);
    const last = w.providerEvents.at(-1)!;
    expect(last).toMatchObject({ provenance: "provider_poll", signatureResult: "not_applicable" });
    expect(last.detail.rawStatus).toBe("broadcast_unconfirmed");
  });
  it("an unverified body naming no known payout changes nothing", () => {
    const { ws } = submittedConnect(SG);
    const r = receiveConnectWebhook(ws, { providerId: SG, rawBody: '{"nonsense":true}', headers: {} }, { actorId: "usr_maya", at: ws.asOf });
    expect(r.ok && r.value.action).toBe("unverified_unknown_payment");
    if (r.ok) expect(r.value.workspace).toBe(ws);
  });
});

describe("rc4 Connect item 4e: engine wiring, replay and the sandbox key rule", () => {
  it("a verified delivery is applied; the same signed delivery replayed inside the window is a duplicate; outside it is rejected", () => {
    let { ws, id } = submittedConnect(CW);
    const v2 = versions(ws, id)[1];
    const d = providerWebhook(ws, id, 2);
    const send = (at: string) => applyAction(ws, { type: "ingest_webhook", delivery: { providerId: CW, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, { actorId: "usr_maya", at });
    const first = send(v2.at);
    expect(first.ok && first.value.outcome).toBe("applied");
    if (!first.ok) return;
    ws = first.value.workspace;
    const again = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: CW, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, { actorId: "usr_maya", at: plusMin(v2.at, 4) });
    expect(again.ok && again.value.outcome).toBe("duplicate_ignored");
    const late = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: CW, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, { actorId: "usr_maya", at: plusMin(v2.at, 6) });
    expect(late.ok && late.value.outcome).toBe("rejected_signature");
  });
  it("a tampered body fails verification and is recorded as rejected, never applied", () => {
    const { ws, id } = submittedConnect(QF);
    const v2 = versions(ws, id)[1];
    const d = providerWebhook(ws, id, 2);
    const r = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: QF, rawBody: d.rawBody.replace("IN_FLIGHT", "DONE"), signatureHeader: d.signatureHeader } }, { actorId: "usr_maya", at: v2.at });
    expect(r.ok && r.value.outcome).toBe("rejected_signature");
    if (r.ok) expect(intentOf(r.value.workspace, id).status.execution).toBe("submitted");
  });
  it("Connect adapters reject a delivery whose signature header is not a header bundle", () => {
    expect(getAdapter(CW)!.verifyWebhook(BODY, "t=1,v1=" + "0".repeat(64), NOW)).toEqual({ valid: false, reason: "malformed_header" });
    expect(getAdapter(SG)!.verifyWebhook(BODY, "", NOW)).toEqual({ valid: false, reason: "unverified_scheme" });
    expect(decodeHeaderBundle(encodeHeaderBundle({ "X-A": "1", b: "2" }))).toEqual({ "x-a": "1", b: "2" });
    expect(decodeHeaderBundle("headers-v1:[1]")).toBeUndefined();
    expect(decodeHeaderBundle("headers-v1:" + JSON.stringify({ "bad header": "x" }))).toBeUndefined();
    expect(decodeHeaderBundle("headers-v1:{")).toBeUndefined();
  });
  it("only fictional test_ secrets: a non-test key is refused for signing and never used to verify", () => {
    expect(() => assertSandboxKeyring([{ keyId: "live", secret: "whsec_live_value" }])).toThrow(/test_ secrets only/);
    expect(() => signDelivery(hex, BODY, [{ keyId: "live", secret: "whsec_live_value" }], NOW)).toThrow(/test_ secrets only/);
    // A key that is not test_ is ignored by the verifier even if the signature was made with it.
    const forgedHeaders = { "x-cobaltwren-timestamp": String(NOW), "x-cobaltwren-signature": signDelivery(hex, BODY, [{ keyId: "t", secret: "test_x" }], NOW)["x-cobaltwren-signature"] };
    expect(verifyDelivery([hex], BODY, forgedHeaders, [{ keyId: "live", secret: "x" } as SigningKey], NOW)).toMatchObject({ status: "invalid", reason: "no_active_key" });
  });
  it("comparison is constant-time: every key and signature is compared with constantTimeEqual, with no early exit", () => {
    const src = readFileSync(join(__dirname, "../../src/lib/clearline/connect/verify.ts"), "utf8");
    expect(src).toMatch(/import \{ constantTimeEqual, hmacSha256Hex \} from "\.\.\/sha256"/);
    const body = /function matchAny[\s\S]*?\n}\n/.exec(src)![0];
    expect(body).toMatch(/hit = constantTimeEqual\(expected, s\) \|\| hit/);
    expect(body).not.toMatch(/return [^;]*;\s*\n\s*}\s*\n\s*}\s*\n\s*return/);
    expect(body).not.toMatch(/break|===\s*s\b|expected ===/);
  });
  it("webhooks delivered through the helper path use the declared scheme for each provider", () => {
    const { ws, id } = submittedConnect(CW);
    expect(Object.keys(providerWebhook(ws, id, 2).headers).sort()).toEqual(["x-cobaltwren-signature", "x-cobaltwren-timestamp"]);
    const q = submittedConnect(QF);
    expect(Object.keys(providerWebhook(q.ws, q.id, 2).headers).sort()).toEqual(["x-quillfern-signatures", "x-quillfern-timestamp"]);
    expect(deliver(q.ws, q.id, 2).outcome).toBe("applied");
  });
});
