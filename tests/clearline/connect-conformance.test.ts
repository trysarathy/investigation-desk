/**
 * rc5 Connect — provider adapter CONFORMANCE suite (sandbox only; fictional providers; no network).
 *
 * ONE parameterised suite, run against EVERY Connect adapter descriptor in the framework's registry
 * (`CONNECT_DESCRIPTORS`). A new adapter is acceptable only when it passes every case below. Each case is
 * driven through the adapter's own channel:
 * - an adapter whose declared scheme is implemented here is fed signed webhooks (`ingest_webhook`);
 * - an adapter whose scheme is unverified (no scheme, or one not implemented) never has a webhook applied;
 *   it is fed by polling (`poll_provider`), which is the documented alternative (CONNECT_ADAPTERS.md §5, §7).
 *
 * Scenario scripts are DERIVED from each descriptor's own mapping table (accepted / in transit / completed /
 * failed / returned / an unlisted status) and registered for the duration of this file only, so every adapter
 * is exercised with the same shape of scenario. Where a case cannot apply to an adapter, the documented
 * alternative is asserted explicitly. There is no skipped test.
 *
 * Specification: docs/clearline/CONNECT_ADAPTERS.md ("Conformance suite (rc5)").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ALLOWLISTED_TOKENS,
  CONNECT_DESCRIPTORS,
  CONNECT_PROVIDERS,
  CONNECT_SCRIPTS,
  ConnectAdapter,
  EVIDENCE_SOURCE_CLASS,
  IMPLEMENTED_SCHEMES,
  applyAction,
  classifyEvidenceRecord,
  connectKeyring,
  connectRoutes,
  encodeHeaderBundle,
  findMapping,
  getAdapter,
  parseProviderBody,
  providerEventSourceKind,
  providerIdempotencyKey,
  providerWebhook,
  receiveConnectWebhook,
  reconcileConnect,
  retryDecision,
  signDelivery,
  simulateProviderIdempotency,
  syntheticFinalTxHash,
  syntheticPreliminaryTxHash,
  toEnginePayload,
  unresolvedConnectIntents,
  webhookBody,
  type ActionResult,
  type AdapterDescriptor,
  type CreateIntentInput,
  type ScriptEntry,
  type StatusMapping,
  type VerificationScheme,
  type Workspace,
} from "@/lib/clearline";
import { debitLine, run } from "./helpers";
import { intentOf, outcomeOf, ownedContradiction, permutations, plusMin, submittedConnect, versions } from "./rc4-connect-helpers";

// ---------------------------------------------------------------------------------------------------------------
// Registry and per-adapter derivation
// ---------------------------------------------------------------------------------------------------------------

const ADAPTERS: readonly AdapterDescriptor[] = CONNECT_DESCRIPTORS;
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const maxIso = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);
const ACTOR = "usr_maya";

/** True when the adapter's declared scheme is implemented here, so its webhooks can be verified and applied. */
const verifiesWebhooks = (d: AdapterDescriptor) => d.verification.some((s) => IMPLEMENTED_SCHEMES.includes(s.id));

/** The first mapping row for an engine event (the conformance suite requires accepted / in transit / completed / failed). */
function pick(d: AdapterDescriptor, event: StatusMapping["event"], prefer?: (m: StatusMapping) => boolean): StatusMapping | undefined {
  const rows = d.statuses.filter((m) => m.event === event && m.subStatus !== "*");
  return rows.find((m) => (prefer ? prefer(m) : true)) ?? rows[0];
}
const entry = (m: StatusMapping, afterMinutes: number): ScriptEntry => ({ afterMinutes, status: m.raw, ...(m.subStatus !== undefined ? { subStatus: m.subStatus } : {}), ...(m.txHash ? { txHash: m.txHash } : {}) });

const UNLISTED_STATUS = "cf_unlisted_state";
const UNLISTED_SUB = "cf_unlisted_sub";

interface Picks {
  accepted: StatusMapping;
  inTransit: StatusMapping;
  completed: StatusMapping;
  failed: StatusMapping;
  returned?: StatusMapping;
}

function picksFor(d: AdapterDescriptor): Picks {
  const accepted = pick(d, "payout.accepted");
  const inTransit = pick(d, "payout.in_transit");
  const completed = pick(d, "payout.completed", (m) => m.confidence === "provider_claim");
  const failed = pick(d, "payout.failed");
  if (!accepted || !inTransit || !completed || !failed) throw new Error(`${d.providerId}: a Connect adapter must map accepted, in_transit, completed and failed statuses`);
  return { accepted, inTransit, completed, failed, returned: pick(d, "payout.returned") };
}

/** Scenario scripts derived from the descriptor's own mapping table (registered for this file only). */
function scenarios(d: AdapterDescriptor): Record<string, ScriptEntry[]> {
  const p = picksFor(d);
  const s: Record<string, ScriptEntry[]> = {
    cf_happy: [entry(p.accepted, 0), entry(p.inTransit, 10), entry(p.completed, 20)],
    cf_reversed: [entry(p.accepted, 0), entry(p.inTransit, 10), entry(p.completed, 20), entry(p.failed, 30)],
    cf_regress: [entry(p.accepted, 0), entry(p.inTransit, 10), entry(p.completed, 20), entry(p.inTransit, 30)],
    cf_unlisted: [entry(p.accepted, 0), entry(p.inTransit, 10), { afterMinutes: 20, status: UNLISTED_STATUS }],
  };
  if (p.returned) s.cf_returned = [entry(p.accepted, 0), entry(p.inTransit, 10), entry(p.completed, 20), entry(p.returned, 30)];
  // A KNOWN status with an unlisted sub-status, only where the provider's payload carries a sub-status at all.
  if (d.shape.subStatus) s.cf_unlisted_sub = [entry(p.accepted, 0), entry(p.inTransit, 10), { afterMinutes: 20, status: p.completed.raw, subStatus: UNLISTED_SUB }];
  return s;
}

/** Intent input derived from the adapter's own route (not hard-coded per provider). */
function inputFor(d: AdapterDescriptor): Partial<CreateIntentInput> {
  const r = connectRoutes().find((x) => x.providerId === d.providerId)!;
  const src = r.sourceCurrencies[0];
  const dst = r.destinationCurrencies.find((c) => c !== src) ?? r.destinationCurrencies[0];
  const country = r.destinationCountries.find((c) => c !== "*") ?? "SG";
  const amountMinor = Math.min(r.maxAmountMinor, Math.max(r.minAmountMinor, (r.providerFees[src] ?? 0) * 250, 1_000_000));
  return { sourceCurrency: src, destinationCurrency: dst, destinationCountry: country, amountMinor };
}

function payout(d: AdapterDescriptor, script: string, ws0?: Workspace) {
  return submittedConnect(d.providerId, script, inputFor(d), ws0);
}

const instrOf = (ws: Workspace, id: string) => ws.instructions.find((i) => i.id === intentOf(ws, id).instructionId)!;

// ---------------------------------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------------------------------

function ingestRaw(ws: Workspace, providerId: string, rawBody: unknown, signatureHeader: unknown, at: string): ActionResult {
  return applyAction(ws, { type: "ingest_webhook", delivery: { providerId, rawBody, signatureHeader } as never }, { actorId: ACTOR, at: maxIso(at, ws.asOf) });
}
function pollAt(ws: Workspace, id: string, at: string, version?: number): ActionResult {
  return applyAction(ws, { type: "poll_provider", intentId: id, ...(version !== undefined ? { version } : {}) }, { actorId: ACTOR, at: maxIso(at, ws.asOf) });
}
const must = (r: ActionResult, why: string) => {
  if (!r.ok) throw new Error(`${why}: ${r.error.code} ${r.error.message}`);
  return r.value;
};

/**
 * Feed one provider version through the adapter's channel at `at` (default: the version's own time):
 * a signed webhook for an adapter with an implemented scheme, otherwise a poll of that version.
 */
function feed(d: AdapterDescriptor, ws: Workspace, id: string, version: number, at?: string) {
  const v = versions(ws, id).find((x) => x.version === version)!;
  const when = maxIso(at ?? v.at, ws.asOf);
  if (verifiesWebhooks(d)) {
    const w = providerWebhook(ws, id, version, { signAt: when });
    return must(ingestRaw(ws, d.providerId, w.rawBody, w.signatureHeader, when), `feed ${d.providerId} v${version}`);
  }
  return must(pollAt(ws, id, when, version), `poll ${d.providerId} v${version}`);
}

/** Feed every version after the synchronous v1, in the given order, each at `at` (or its own time). */
function feedAll(d: AdapterDescriptor, ws: Workspace, id: string, order?: number[], at?: string) {
  const vs = order ?? versions(ws, id).slice(1).map((v) => v.version);
  for (const n of vs) ws = feed(d, ws, id, n, at).workspace;
  return ws;
}

/** A signed (or, for unverified schemes, "as the provider would send") delivery of an arbitrary body. */
function signedHeaders(d: AdapterDescriptor, rawBody: string, at: string) {
  return signDelivery(d.verification[0], rawBody, connectKeyring(d.providerId), unix(at));
}

/** The webhook body for an arbitrary script entry, as the provider would build it for `version`. */
function customBody(d: AdapterDescriptor, ws: Workspace, id: string, e: ScriptEntry, version: number, at: string) {
  return webhookBody(d, intentOf(ws, id), instrOf(ws, id), { version, at, entry: e });
}

/** Everything about the payout that must not move on a rejected / duplicate / no-op input. */
function stateOf(ws: Workspace, id: string) {
  return JSON.stringify({
    intent: intentOf(ws, id),
    instruction: instrOf(ws, id),
    exceptions: ws.exceptions.filter((e) => e.intentId === id),
    evidence: ws.evidence.filter((e) => e.intentId === id),
    holds: ws.holds.filter((h) => h.intentId === id),
    chain: ws.chainObservations.filter((o) => o.intentId === id),
    allocations: ws.allocations,
  });
}

/** Independent settlement evidence for the payout's rail: a bank debit line, or Clearline's own chain observation. */
function independentEvidence(d: AdapterDescriptor, ws: Workspace, id: string, ref: string, at: string): Workspace {
  const intent = intentOf(ws, id);
  const route = connectRoutes().find((r) => r.providerId === d.providerId)!;
  if (route.rail === "stablecoin_testnet") {
    const token = ALLOWLISTED_TOKENS[0];
    const quote = ws.quotes.find((q) => q.id === instrOf(ws, id).quoteId)!;
    return run(ws, ACTOR, {
      type: "ingest_chain_observation",
      observation: { intentId: id, chainId: token.chainId, network: token.network, tokenContract: token.contract, tokenSymbol: token.symbol, txHash: syntheticFinalTxHash(ref), toAddress: getAdapter(d.providerId)!.expectedWallet!(intent), amountMinor: quote.estimatedRecipientMinor, blockNumber: 18_100_000, confirmations: 12 },
    }, maxIso(at, ws.asOf)).workspace;
  }
  return run(ws, ACTOR, { type: "ingest_statement_line", line: debitLine({ reference: ref, amountMinor: intent.amountMinor, currency: intent.sourceCurrency, counterparty: d.providerName }) }, maxIso(at, ws.asOf)).workspace;
}

const openCodes = (ws: Workspace, id: string) => ws.exceptions.filter((e) => e.intentId === id && e.status !== "resolved").map((e) => e.explanationCode);

// ---------------------------------------------------------------------------------------------------------------
// Registration of the derived scenarios (this file only; removed afterwards)
// ---------------------------------------------------------------------------------------------------------------

const registered: Array<[string, string]> = [];
beforeAll(() => {
  for (const d of ADAPTERS) {
    const book = (CONNECT_SCRIPTS[d.providerId] ??= {});
    for (const [name, script] of Object.entries(scenarios(d))) {
      expect(Object.prototype.hasOwnProperty.call(book, name), `${d.providerId} already has a script ${name}`).toBe(false);
      book[name] = script;
      registered.push([d.providerId, name]);
    }
  }
});
afterAll(() => {
  for (const [p, name] of registered) delete CONNECT_SCRIPTS[p][name];
});

// ---------------------------------------------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------------------------------------------

describe("rc5 Connect conformance: the registry", () => {
  it("enumerates every registered Connect adapter descriptor, each backed by a ConnectAdapter with a route", () => {
    expect(ADAPTERS.length).toBeGreaterThanOrEqual(3);
    expect(CONNECT_PROVIDERS.map((p) => p.id)).toEqual(ADAPTERS.map((d) => d.providerId));
    for (const d of ADAPTERS) {
      expect(getAdapter(d.providerId), d.providerId).toBeInstanceOf(ConnectAdapter);
      expect(connectRoutes().some((r) => r.providerId === d.providerId), d.providerId).toBe(true);
      expect(() => picksFor(d)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The parameterised suite
// ---------------------------------------------------------------------------------------------------------------

for (const d of ADAPTERS) {
  const P = d.providerId;
  const verified = verifiesWebhooks(d);
  const channel = verified ? "signed webhook" : "poll (unverified scheme)";

  describe(`rc5 Connect conformance — ${d.providerName} [${P}] via ${channel}`, () => {
    // 1 ---------------------------------------------------------------------------------------------------------
    describe("1. duplicate deliveries", () => {
      it("the same event delivered twice is recorded once and the state is unchanged", () => {
        let { ws, id } = payout(d, "cf_happy");
        ws = feed(d, ws, id, 2).workspace;
        const before = stateOf(ws, id);
        const again = feed(d, ws, id, 2);
        expect(again.outcome).toBe("duplicate_ignored");
        expect(stateOf(again.workspace, id)).toBe(before);
        const key = again.workspace.providerEvents.at(-1)!.dedupeKey;
        expect(again.workspace.providerEvents.filter((e) => e.dedupeKey === key && e.processingOutcome !== "duplicate_ignored")).toHaveLength(1);
        expect(openCodes(again.workspace, id)).toEqual([]);
      });
      it("through the Connect intake, a redelivery is a duplicate as well (webhook or poll-to-confirm)", () => {
        let { ws, id } = payout(d, "cf_happy");
        const v2 = versions(ws, id)[1];
        const w = providerWebhook(ws, id, 2, { signAt: v2.at });
        const send = (x: Workspace) => receiveConnectWebhook(x, { providerId: P, rawBody: w.rawBody, headers: w.headers }, { actorId: ACTOR, at: maxIso(v2.at, x.asOf) });
        const first = send(ws);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.action).toBe(verified ? "ingested" : "polled_to_confirm");
        ws = first.value.workspace;
        const before = stateOf(ws, id);
        const second = send(ws);
        expect(second.ok && second.value.outcome).toBe("duplicate_ignored");
        if (second.ok) expect(stateOf(second.value.workspace, id)).toBe(before);
      });
      it("the reconciler does not re-ingest a snapshot it already holds (unchanged)", () => {
        let { ws, id } = payout(d, "cf_happy");
        const last = versions(ws, id).at(-1)!;
        ws = reconcileConnect(ws, { actorId: ACTOR, at: plusMin(last.at, 1) }).workspace;
        const before = stateOf(ws, id);
        const r = reconcileConnect(ws, { actorId: ACTOR, at: plusMin(last.at, 2) });
        expect(r.results.filter((x) => x.intentId === id).map((x) => x.outcome)).toEqual(["unchanged"]);
        expect(stateOf(r.workspace, id)).toBe(before);
      });
    });

    // 2 ---------------------------------------------------------------------------------------------------------
    describe("2. out-of-order delivery", () => {
      const scripts = ["cf_happy", "cf_reversed", ...(picksFor(d).returned ? ["cf_returned"] : []), ...(d.ordering.kind === "object_version" ? ["cf_regress"] : [])];
      for (const script of scripts)
        it(`${script}: every arrival order gives the same final outcome as in-order delivery`, () => {
          const base = payout(d, script);
          const inOrder = feedAll(d, base.ws, base.id);
          const expected = outcomeOf(inOrder, base.id);
          const vs = versions(base.ws, base.id).slice(1);
          const late = plusMin(vs.at(-1)!.at, 1);
          for (const order of permutations(vs.map((v) => v.version))) {
            const ws = feedAll(d, base.ws, base.id, order, late);
            expect(outcomeOf(ws, base.id), `${script} order ${order.join(",")}`).toEqual(expected);
          }
        });
      if (d.ordering.kind !== "object_version")
        it("state-rank ordering: the latest version arriving first is never overtaken by earlier ones arriving later", () => {
          const base = payout(d, "cf_happy");
          const last = versions(base.ws, base.id).at(-1)!;
          let ws = feed(d, base.ws, base.id, last.version).workspace;
          const after = intentOf(ws, base.id).status.execution;
          for (const v of versions(base.ws, base.id).slice(1, -1)) ws = feed(d, ws, base.id, v.version, plusMin(last.at, 1)).workspace;
          expect(intentOf(ws, base.id).status.execution).toBe(after);
          expect(d.ordering).toEqual({ kind: "state_rank" });
        });
    });

    // 3 ---------------------------------------------------------------------------------------------------------
    describe("3. replay outside the window", () => {
      const tol = Math.max(...d.verification.map((s) => s.toleranceSeconds));
      if (verified) {
        it("a valid signature with a timestamp outside the replay window is rejected and not applied (raw action and intake)", () => {
          const { ws, id } = payout(d, "cf_happy");
          const v2 = versions(ws, id)[1];
          const w = providerWebhook(ws, id, 2, { signAt: v2.at });
          const tooLate = new Date((unix(v2.at) + tol + 1) * 1000).toISOString();
          const r = must(ingestRaw(ws, P, w.rawBody, w.signatureHeader, tooLate), "replay");
          expect(r.outcome).toBe("rejected_signature");
          expect(intentOf(r.workspace, id).status).toEqual(intentOf(ws, id).status);
          const viaIntake = receiveConnectWebhook(ws, { providerId: P, rawBody: w.rawBody, headers: w.headers }, { actorId: ACTOR, at: tooLate });
          expect(viaIntake.ok && [viaIntake.value.action, viaIntake.value.verification]).toEqual(["rejected_recorded", { status: "invalid", scheme: d.verification[0].id, reason: "timestamp_outside_tolerance" }]);
          // A timestamp from the future beyond the window is refused the same way.
          const ahead = signedHeaders(d, w.rawBody, new Date((unix(v2.at) + tol + 1) * 1000).toISOString());
          expect(must(ingestRaw(ws, P, w.rawBody, encodeHeaderBundle(ahead), v2.at), "future").outcome).toBe("rejected_signature");
          // Inside the window the same delivery applies (the case is about the window, not the body).
          expect(must(ingestRaw(ws, P, w.rawBody, w.signatureHeader, new Date((unix(v2.at) + tol) * 1000).toISOString()), "edge").outcome).toBe("applied");
        });
      } else {
        it("documented alternative (unverified scheme): a stale webhook is never applied; the intake polls and applies only the provider's own answer", () => {
          const { ws, id } = payout(d, "cf_happy");
          const vs = versions(ws, id);
          const w = providerWebhook(ws, id, 3, { signAt: vs[2].at });
          const stale = new Date((unix(vs[2].at) + tol + 3600) * 1000).toISOString();
          const raw = must(ingestRaw(ws, P, w.rawBody, w.signatureHeader, stale), "raw");
          expect(raw.outcome).toBe("rejected_signature");
          expect(intentOf(raw.workspace, id).status).toEqual(intentOf(ws, id).status);
          const r = receiveConnectWebhook(ws, { providerId: P, rawBody: w.rawBody, headers: w.headers }, { actorId: ACTOR, at: stale });
          expect(r.ok && r.value.action).toBe("polled_to_confirm");
          if (!r.ok) return;
          expect(r.value.workspace.providerEvents.some((e) => e.rawBody === w.rawBody && e.processingOutcome !== "rejected_signature")).toBe(false);
          expect(r.value.workspace.providerEvents.at(-1)!.provenance).toBe("provider_poll");
        });
      }
    });

    // 4 ---------------------------------------------------------------------------------------------------------
    describe("4. invalid signature (raw bytes; no generic scheme)", () => {
      if (verified) {
        const signedV2 = () => {
          const { ws, id } = payout(d, "cf_happy");
          const v2 = versions(ws, id)[1];
          return { ws, id, at: v2.at, w: providerWebhook(ws, id, 2, { signAt: v2.at }) };
        };
        const expectRejected = (ws: Workspace, id: string, rawBody: string, header: string, at: string) => {
          const r = must(ingestRaw(ws, P, rawBody, header, at), "tampered");
          expect(r.outcome).toBe("rejected_signature");
          expect(intentOf(r.workspace, id).status).toEqual(intentOf(ws, id).status);
          expect(r.workspace.providerEvents.at(-1)!.processingOutcome).toBe("rejected_signature");
        };
        it("a body changed by one byte is rejected", () => {
          const { ws, id, at, w } = signedV2();
          const i = w.rawBody.search(/[0-9]/);
          const oneByte = w.rawBody.slice(0, i) + (w.rawBody[i] === "9" ? "8" : String(Number(w.rawBody[i]) + 1)) + w.rawBody.slice(i + 1);
          expect(oneByte.length).toBe(w.rawBody.length);
          expectRejected(ws, id, oneByte, w.signatureHeader, at);
          // Appending a single byte is also a change.
          expectRejected(ws, id, w.rawBody + " ", w.signatureHeader, at);
        });
        it("verification is over the raw bytes as received: a whitespace or key-order change of the same JSON fails", () => {
          const { ws, id, at, w } = signedV2();
          const parsed = JSON.parse(w.rawBody) as Record<string, unknown>;
          const spaced = JSON.stringify(parsed, null, 1);
          const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
          expect(JSON.parse(spaced)).toEqual(parsed);
          expect(JSON.parse(reordered)).toEqual(parsed);
          expect(reordered).not.toBe(w.rawBody);
          expectRejected(ws, id, spaced, w.signatureHeader, at);
          expectRejected(ws, id, reordered, w.signatureHeader, at);
          // The original bytes still verify: the rejection is caused by the re-serialisation alone.
          expect(must(ingestRaw(ws, P, w.rawBody, w.signatureHeader, at), "original").outcome).toBe("applied");
        });
        it("no generic scheme is assumed: a delivery signed with any OTHER scheme (same keys) is rejected", () => {
          const { ws, id, at, w } = signedV2();
          const others: VerificationScheme[] = [
            { id: "clearline_sandbox_v1", signatureHeader: "x-sandbox-signature", toleranceSeconds: 300 },
            { id: "hex_hmac_sha256_ts", signatureHeader: d.verification[0].signatureHeader, timestampHeader: d.verification[0].timestampHeader, toleranceSeconds: 300 },
            { id: "multi_sig_hmac_sha256_ts", signatureHeader: d.verification[0].signatureHeader, timestampHeader: d.verification[0].timestampHeader, toleranceSeconds: 300 },
          ].filter((s) => s.id !== d.verification[0].id) as VerificationScheme[];
          expect(others.length).toBeGreaterThan(0);
          for (const s of others) expectRejected(ws, id, w.rawBody, encodeHeaderBundle(signDelivery(s, w.rawBody, connectKeyring(P), unix(at))), at);
          // A signature made with another provider's keys is rejected too.
          for (const o of ADAPTERS.filter((x) => x.providerId !== P))
            expectRejected(ws, id, w.rawBody, encodeHeaderBundle(signDelivery(d.verification[0], w.rawBody, connectKeyring(o.providerId), unix(at))), at);
          // And a plain signature string that is not the provider's declared header bundle is refused.
          expectRejected(ws, id, w.rawBody, `t=${unix(at)},v1=${"0".repeat(64)}`, at);
        });
      } else {
        it("unverified scheme: a webhook is NEVER applied, even with plausible headers; it is confirmed by polling", () => {
          const { ws, id } = payout(d, "cf_happy");
          const vs = versions(ws, id);
          // A forged body claiming completion (with a final hash where the shape has one) while the provider's truth is still in transit.
          const p = picksFor(d);
          const forged = customBody(d, ws, id, entry(p.completed, 0), 99, vs[1].at);
          const headers = signedHeaders(d, forged, vs[1].at);
          const raw = must(ingestRaw(ws, P, forged, encodeHeaderBundle(headers), vs[1].at), "raw");
          expect(raw.outcome).toBe("rejected_signature");
          expect(intentOf(raw.workspace, id).status).toEqual(intentOf(ws, id).status);
          expect(raw.audit.some((a) => a.action === "event.rejected_signature" && /unverified scheme/i.test(a.summary))).toBe(true);
          const r = receiveConnectWebhook(ws, { providerId: P, rawBody: forged, headers }, { actorId: ACTOR, at: vs[1].at });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.value.verification.status).toBe("unverified");
          expect(r.value.action).toBe("polled_to_confirm");
          expect(r.value.workspace.providerEvents.some((e) => e.rawBody === forged)).toBe(false);
          expect(intentOf(r.value.workspace, id).status.execution).toBe(p.inTransit.execution);
          expect(r.value.workspace.providerEvents.at(-1)).toMatchObject({ provenance: "provider_poll", signatureResult: "not_applicable" });
        });
        it("unverified scheme: one-byte, whitespace and key-order variants are equally never applied", () => {
          const { ws, id } = payout(d, "cf_happy");
          const v2 = versions(ws, id)[1];
          const w = providerWebhook(ws, id, 2, { signAt: v2.at });
          const parsed = JSON.parse(w.rawBody) as Record<string, unknown>;
          for (const body of [w.rawBody, w.rawBody + " ", JSON.stringify(parsed, null, 1), JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()))]) {
            const r = must(ingestRaw(ws, P, body, w.signatureHeader, v2.at), "variant");
            expect(r.outcome).toBe("rejected_signature");
            expect(intentOf(r.workspace, id).status).toEqual(intentOf(ws, id).status);
          }
        });
      }
    });

    // 5 ---------------------------------------------------------------------------------------------------------
    describe("5. contradictions", () => {
      it("success followed by failure raises an owned contradiction and never leaves settlement verified", () => {
        let { ws, id, ref } = payout(d, "cf_reversed");
        const vs = versions(ws, id);
        ws = feed(d, ws, id, 2).workspace;
        ws = feed(d, ws, id, 3).workspace;
        expect(intentOf(ws, id).status.execution).toBe("provider_reported_completed");
        ws = independentEvidence(d, ws, id, ref, plusMin(vs[2].at, 2));
        expect(intentOf(ws, id).status.settlement).toBe("verified");
        ws = feed(d, ws, id, 4).workspace;
        expect(openCodes(ws, id)).toContain("EV_PROVIDER_SUCCESS_REVERSED");
        expect(intentOf(ws, id).status.execution).toBe("failed");
        expect(intentOf(ws, id).status.settlement).not.toBe("verified");
        expect(intentOf(ws, id).status.settlement).toBe("contradicted");
        expect(ownedContradiction(ws, id).whoActs).not.toBe("WA_NONE");
      });
      if (picksFor(d).returned) {
        it("success followed by a return raises the returned_payout exception and never leaves settlement verified", () => {
          let { ws, id, ref } = payout(d, "cf_returned");
          const vs = versions(ws, id);
          ws = feed(d, ws, id, 2).workspace;
          ws = feed(d, ws, id, 3).workspace;
          ws = independentEvidence(d, ws, id, ref, plusMin(vs[2].at, 2));
          expect(intentOf(ws, id).status.settlement).toBe("verified");
          ws = feed(d, ws, id, 4).workspace;
          expect(intentOf(ws, id).status.execution).toBe("returned");
          expect(ws.exceptions.some((e) => e.intentId === id && e.category === "returned_payout" && e.status !== "resolved")).toBe(true);
          expect(intentOf(ws, id).status.settlement).not.toBe("verified");
          expect(ownedContradiction(ws, id).whoActs).not.toBe("WA_NONE");
        });
      } else {
        it("documented alternative: the provider has no return status, so a reversal is expressed only as failure (covered above)", () => {
          expect(d.statuses.some((m) => m.event === "payout.returned")).toBe(false);
          expect(d.statuses.some((m) => m.event === "payout.failed")).toBe(true);
        });
      }
    });

    // 6 ---------------------------------------------------------------------------------------------------------
    describe("6. timeouts and poll failures", () => {
      it("a simulated provider timeout changes no payout state and leaves the payout retryable", () => {
        let { ws, id } = payout(d, "cf_happy");
        ws = feed(d, ws, id, 2).workspace;
        const before = intentOf(ws, id).status;
        const r = run(ws, ACTOR, { type: "simulate_provider_event", intentId: id, injection: "timeout" });
        expect(r.outcome).toBe("timeout_exception_raised");
        expect(intentOf(r.workspace, id).status).toEqual(before);
        expect(r.workspace.providerEvents.at(-1)).toMatchObject({ provenance: "clearline_timer", normalizedType: "payout.timeout" });
        expect(unresolvedConnectIntents(r.workspace)).toContain(id);
        // Retrying later through the adapter's own channel applies normally.
        const next = feed(d, r.workspace, id, 3);
        expect(next.outcome).toBe("applied");
        expect(intentOf(next.workspace, id).status.execution).toBe("provider_reported_completed");
      });
      it("a poll that gets no answer (provider timeout) changes nothing; the payout stays in the reconciler's set and a later poll applies", () => {
        let { ws, id } = payout(d, "cf_happy");
        ws = feed(d, ws, id, 2).workspace;
        const last = versions(ws, id).at(-1)!;
        const adapter = getAdapter(P)!;
        const before = stateOf(ws, id);
        const spy = vi.spyOn(adapter, "fetchStatus").mockReturnValue({ kind: "none", reason: "Simulated provider timeout (no response)." });
        try {
          const p = must(pollAt(ws, id, plusMin(last.at, 1)), "poll");
          expect(p.outcome).toBe("no_event_pending");
          expect(stateOf(p.workspace, id)).toBe(before);
          const rec = reconcileConnect(ws, { actorId: ACTOR, at: plusMin(last.at, 1) });
          expect(rec.results.filter((x) => x.intentId === id).map((x) => x.outcome)).toEqual(["no_event_pending"]);
          expect(stateOf(rec.workspace, id)).toBe(before);
          expect(unresolvedConnectIntents(rec.workspace)).toContain(id);
        } finally {
          spy.mockRestore();
        }
        const retry = reconcileConnect(ws, { actorId: ACTOR, at: plusMin(last.at, 2) });
        expect(retry.results.filter((x) => x.intentId === id).map((x) => x.outcome)).toEqual(["applied"]);
        expect(intentOf(retry.workspace, id).status.execution).toBe("provider_reported_completed");
      });
      it("a refused poll (bad version) is a typed error and changes nothing", () => {
        const { ws, id } = payout(d, "cf_happy");
        for (const version of [0, -1, 1.5, Number.NaN]) {
          const r = pollAt(ws, id, ws.asOf, version);
          expect(r.ok ? "ok" : r.error.code).toBe("invalid_field");
        }
        // A version the provider does not have yet is no answer, not a fact.
        const future = must(pollAt(ws, id, ws.asOf, 99), "future");
        expect(future.outcome).toBe("no_event_pending");
        expect(stateOf(future.workspace, id)).toBe(stateOf(ws, id));
      });
      // DEFECT: reconcileConnect calls adapter.fetchStatus outside any per-payout error boundary (reconciler.ts
      // pollOne). A provider timeout that surfaces as a thrown error therefore escapes reconcileConnect and aborts
      // the whole pass, instead of being reported as an error for that one payout while the other payouts are
      // still polled (CONNECT_ADAPTERS.md §7: "reports an error on one payout without stopping the others").
      it.fails("a poll that THROWS (provider timeout) for one payout is reported for that payout and does not stop the others", () => {
        const a = payout(d, "cf_happy");
        const b = payout(d, "cf_happy", a.ws);
        const last = versions(b.ws, b.id).at(-1)!;
        const adapter = getAdapter(P)!;
        const real = adapter.fetchStatus!.bind(adapter);
        const spy = vi.spyOn(adapter, "fetchStatus").mockImplementation((w, intent, instr, at, version) => {
          if (intent.id === a.id) throw new Error("Simulated provider timeout");
          return real(w, intent, instr, at, version);
        });
        try {
          const rec = reconcileConnect(b.ws, { actorId: ACTOR, at: plusMin(last.at, 1) });
          expect(rec.results.find((x) => x.intentId === a.id)?.outcome).toBe("error");
          expect(intentOf(rec.workspace, a.id).status).toEqual(intentOf(b.ws, a.id).status);
          expect(intentOf(rec.workspace, b.id).status.execution).toBe("provider_reported_completed");
        } finally {
          spy.mockRestore();
        }
      });
    });

    // 7 ---------------------------------------------------------------------------------------------------------
    describe("7. idempotency collisions", () => {
      const sem = d.idempotency;
      it("the provider key is one deterministic, valid key per instruction, echoed verbatim by every version", () => {
        let { ws, id } = payout(d, "cf_happy");
        ws = feedAll(d, ws, id);
        const key = providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instrOf(ws, id).id);
        expect(key).toBe(providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instrOf(ws, id).id));
        expect(key.length).toBeLessThanOrEqual(sem.maxLength);
        const bodies = ws.providerEvents.filter((e) => e.intentId === id && e.rawBody).map((e) => e.rawBody!);
        expect(bodies.length).toBeGreaterThanOrEqual(3);
        for (const b of bodies) expect(b).toContain(JSON.stringify(key));
      });
      it("the same outbound key with a DIFFERENT request is refused", () => {
        const { ws, id } = payout(d, "cf_happy");
        const key = providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instrOf(ws, id).id);
        const first = simulateProviderIdempotency(sem, [], { key, bodyHash: "body-a", at: ws.asOf, response: "resp-a" });
        expect(first.result).toEqual({ outcome: "created", response: "resp-a" });
        const other = simulateProviderIdempotency(sem, first.store, { key, bodyHash: "body-b", at: plusMin(ws.asOf, 1), response: "resp-b" });
        expect(other.result).toEqual({ outcome: "rejected_body_mismatch" });
        // Engine side: Clearline's own key reused with a different request body is refused with a typed error.
        const intent = intentOf(ws, id);
        const reuse = applyAction(ws, { type: "create_intent", input: { internalReference: intent.internalReference, amountMinor: intent.amountMinor + 1, sourceCurrency: intent.sourceCurrency, destinationCurrency: intent.destinationCurrency, purpose: intent.purpose, beneficiaryRef: intent.beneficiaryRef, beneficiaryName: intent.beneficiaryName, destinationCountry: intent.destinationCountry, requestedExecutionDate: intent.requestedExecutionDate, idempotencyKey: intent.idempotencyKey } as CreateIntentInput }, { actorId: ACTOR, at: ws.asOf });
        expect(reuse.ok ? "ok" : reuse.error.code).toBe("idempotency_conflict");
      });
      if (sem.onRepeat === "replay_first_response") {
        it("the same outbound key with the SAME request replays the first response (inside the TTL)", () => {
          const { ws, id } = payout(d, "cf_happy");
          const key = providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instrOf(ws, id).id);
          const first = simulateProviderIdempotency(sem, [], { key, bodyHash: "body-a", at: ws.asOf, response: "resp-a" });
          const again = simulateProviderIdempotency(sem, first.store, { key, bodyHash: "body-a", at: plusMin(ws.asOf, 5), response: "resp-new" });
          expect(again.result).toEqual({ outcome: "replayed", response: "resp-a" });
          expect(retryDecision(sem, ws.asOf, plusMin(ws.asOf, 5))).toBe("retry_with_same_key");
          expect(retryDecision(sem, ws.asOf, plusMin(ws.asOf, sem.ttlHours * 60 + 1))).toBe("poll_status_first");
        });
      } else {
        it("documented alternative (reject-duplicate provider): the same request is refused as a duplicate, so Clearline polls instead of retrying", () => {
          const { ws, id } = payout(d, "cf_happy");
          const key = providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instrOf(ws, id).id);
          const first = simulateProviderIdempotency(sem, [], { key, bodyHash: "body-a", at: ws.asOf, response: "resp-a" });
          const again = simulateProviderIdempotency(sem, first.store, { key, bodyHash: "body-a", at: plusMin(ws.asOf, 5), response: "resp-new" });
          expect(again.result).toEqual({ outcome: "rejected_duplicate" });
          expect(retryDecision(sem, ws.asOf, plusMin(ws.asOf, 5))).toBe("poll_status_first");
        });
      }
      it("engine side: the same Clearline request replays the same intent; a second submission of the instruction is refused", () => {
        const { ws, id, instructionId } = payout(d, "cf_happy");
        const intent = intentOf(ws, id);
        const fresh = submittedConnect(P, "cf_happy", inputFor(d));
        // Re-create with the identical request on the workspace that already holds it.
        const created = fresh.ws.intents.find((i) => i.id === fresh.id)!;
        const replay = applyAction(fresh.ws, { type: "create_intent", input: { internalReference: created.internalReference, amountMinor: created.amountMinor, sourceCurrency: created.sourceCurrency, destinationCurrency: created.destinationCurrency, purpose: created.purpose, beneficiaryRef: created.beneficiaryRef, beneficiaryName: created.beneficiaryName, destinationCountry: created.destinationCountry, requestedExecutionDate: created.requestedExecutionDate, idempotencyKey: created.idempotencyKey, metadata: created.metadata } as CreateIntentInput }, { actorId: ACTOR, at: fresh.ws.asOf });
        expect(replay.ok).toBe(true);
        if (replay.ok) expect(replay.value.workspace.intents.filter((i) => i.idempotencyKey === created.idempotencyKey)).toHaveLength(1);
        const twice = applyAction(ws, { type: "submit_instruction", instructionId }, { actorId: ACTOR, at: ws.asOf });
        expect(twice.ok ? "ok" : twice.error.code).toBe("invalid_transition");
        expect(ws.instructions.filter((i) => i.intentId === intent.id)).toHaveLength(1);
      });
    });

    // 8 ---------------------------------------------------------------------------------------------------------
    describe("8. malformed payloads", () => {
      const TYPED = ["invalid_field", "not_found", "precondition_failed"];
      /** Must not throw; must be a typed error or a recorded non-application; must not move the payout. */
      const expectContained = (ws: Workspace, id: string, f: () => ActionResult, label: string) => {
        let r: ActionResult | undefined;
        expect(() => (r = f()), label).not.toThrow();
        if (!r!.ok) {
          expect(TYPED, `${label}: ${r!.error.code}`).toContain(r!.error.code);
          return;
        }
        expect(["rejected_signature", "rejected_unknown_payment"], label).toContain(r!.value.outcome);
        expect(intentOf(r!.value.workspace, id).status, label).toEqual(intentOf(ws, id).status);
      };
      it("invalid JSON, wrong types, missing ids and huge bodies are rejected (signed as the provider would), without an escaping throw", () => {
        const { ws, id } = payout(d, "cf_happy");
        const v2 = versions(ws, id)[1];
        const good = JSON.parse(providerWebhook(ws, id, 2).rawBody) as Record<string, unknown>;
        const s = d.shape;
        const objOf = (b: Record<string, unknown>) => (s.objectField ? (b[s.objectField] as Record<string, unknown>) : b);
        const variant = (f: (b: Record<string, unknown>) => void) => {
          const b = structuredClone(good);
          f(b);
          return JSON.stringify(b);
        };
        const bodies: Record<string, string> = {
          "invalid JSON": "{" + JSON.stringify(good).slice(1, -1),
          "not an object": JSON.stringify([good]),
          "null": "null",
          "empty": "",
          "status is a number": variant((b) => (objOf(b)[s.status] = 7)),
          "amount is a string": variant((b) => (objOf(b)[s.amount] = String(objOf(b)[s.amount]))),
          "currency unknown": variant((b) => (objOf(b)[s.currency] = "ZZZ")),
          "occurredAt not an instant": variant((b) => (objOf(b)[s.occurredAt] = "yesterday")),
          "missing ref": variant((b) => delete objOf(b)[s.ref]),
          "ref is an object": variant((b) => (objOf(b)[s.ref] = { a: 1 })),
          "missing status": variant((b) => delete objOf(b)[s.status]),
          "huge body": JSON.stringify({ ...good, padding: "x".repeat(20_000) }),
        };
        if (s.eventIdField) bodies["event id is a number"] = variant((b) => (b[s.eventIdField!] = 12345));
        if (s.eventIdField) bodies["event id too long"] = variant((b) => (b[s.eventIdField!] = "e".repeat(200)));
        if (s.version && d.ordering.kind === "object_version") {
          bodies["missing version"] = variant((b) => delete objOf(b)[s.version!]);
          bodies["version is a string"] = variant((b) => (objOf(b)[s.version!] = "2"));
        }
        if (s.txHash) bodies["hash is not hex"] = variant((b) => (objOf(b)[s.txHash!] = "0xZZ"));
        for (const [label, body] of Object.entries(bodies)) {
          expectContained(ws, id, () => ingestRaw(ws, P, body, encodeHeaderBundle(signedHeaders(d, body, v2.at)), v2.at), `${P} ${label} (raw)`);
          let r: ReturnType<typeof receiveConnectWebhook> | undefined;
          expect(() => (r = receiveConnectWebhook(ws, { providerId: P, rawBody: body, headers: signedHeaders(d, body, v2.at) }, { actorId: ACTOR, at: v2.at })), `${label} (intake)`).not.toThrow();
          if (r!.ok) {
            expect(["rejected_recorded", "unverified_unknown_payment", "polled_to_confirm"], `${label} intake`).toContain(r!.value.action);
            expect(r!.value.workspace.providerEvents.some((e) => e.rawBody === body && e.processingOutcome !== "rejected_signature"), label).toBe(false);
          } else expect(TYPED, `${label} intake: ${r!.error.code}`).toContain(r!.error.code);
        }
      });
      it("non-string headers and non-string bodies are rejected without an escaping throw", () => {
        const { ws, id } = payout(d, "cf_happy");
        const v2 = versions(ws, id)[1];
        const w = providerWebhook(ws, id, 2, { signAt: v2.at });
        for (const header of [undefined, null, 42, { a: 1 }, ["x"], true, "", "headers-v1:" + "{".repeat(5000)])
          expectContained(ws, id, () => ingestRaw(ws, P, w.rawBody, header, v2.at), `signatureHeader ${JSON.stringify(header)?.slice(0, 20)}`);
        for (const body of [undefined, null, 42, { a: 1 }, ["x"]]) expectContained(ws, id, () => ingestRaw(ws, P, body, w.signatureHeader, v2.at), `rawBody ${JSON.stringify(body)}`);
        const sigName = d.verification[0].signatureHeader!;
        const tsName = d.verification[0].timestampHeader;
        const headerVariants: unknown[] = [
          null,
          undefined,
          42,
          "str",
          { ...w.headers, [sigName]: 42 },
          { ...w.headers, [sigName]: ["a", "b"] },
          { ...w.headers, [sigName]: null },
          { ...w.headers, [sigName]: { v: 1 } },
          ...(tsName ? [{ ...w.headers, [tsName]: unix(v2.at) }] : []),
        ];
        for (const headers of headerVariants) {
          let r: ReturnType<typeof receiveConnectWebhook> | undefined;
          expect(() => (r = receiveConnectWebhook(ws, { providerId: P, rawBody: w.rawBody, headers: headers as Record<string, string> }, { actorId: ACTOR, at: v2.at })), JSON.stringify(headers)).not.toThrow();
          if (!r!.ok) {
            expect(TYPED).toContain(r!.error.code);
            continue;
          }
          // Never applied from the webhook: either rejected, or (unverified scheme) confirmed by the provider's own poll.
          expect(["rejected_recorded", "polled_to_confirm"], JSON.stringify(headers)).toContain(r!.value.action);
          expect(r!.value.workspace.providerEvents.some((e) => e.rawBody === w.rawBody && e.processingOutcome === "applied"), JSON.stringify(headers)).toBe(false);
        }
        for (const body of [undefined, null, 42, { a: 1 }]) {
          let r: ReturnType<typeof receiveConnectWebhook> | undefined;
          expect(() => (r = receiveConnectWebhook(ws, { providerId: P, rawBody: body as unknown as string, headers: w.headers }, { actorId: ACTOR, at: v2.at })), `intake rawBody ${JSON.stringify(body)}`).not.toThrow();
          if (r!.ok) expect(["rejected_recorded", "unverified_unknown_payment"]).toContain(r!.value.action);
          else expect(TYPED).toContain(r!.error.code);
        }
      });
    });

    // 9 ---------------------------------------------------------------------------------------------------------
    describe("9. status regressions", () => {
      if (d.ordering.kind === "object_version") {
        it("completed → in_transit is flagged as an owned contradiction in every arrival order, never applied silently", () => {
          const base = payout(d, "cf_regress");
          const vs = versions(base.ws, base.id).slice(1);
          for (const order of permutations(vs.map((v) => v.version))) {
            const ws = feedAll(d, base.ws, base.id, order, plusMin(vs.at(-1)!.at, 1));
            expect(openCodes(ws, base.id), order.join(",")).toContain("EV_PROVIDER_STATUS_REGRESSED");
            expect(ownedContradiction(ws, base.id).whoActs).not.toBe("WA_NONE");
            const ex = ws.exceptions.find((e) => e.intentId === base.id && e.explanationCode === "EV_PROVIDER_STATUS_REGRESSED")!;
            expect(ex.supportingEventIds.length).toBe(2);
          }
          // In order: execution follows the provider's latest version, with the contradiction raised in the same step.
          let ws = base.ws;
          for (const v of vs.slice(0, -1)) ws = feed(d, ws, base.id, v.version).workspace;
          const r = feed(d, ws, base.id, vs.at(-1)!.version);
          const last = r.workspace.providerEvents.at(-1)!;
          const ex = r.workspace.exceptions.find((e) => e.intentId === base.id && e.explanationCode === "EV_PROVIDER_STATUS_REGRESSED" && e.status !== "resolved")!;
          expect(ex.supportingEventIds).toContain(last.id);
          expect(intentOf(r.workspace, base.id).status.execution).toBe(picksFor(d).inTransit.execution);
        });
      } else {
        it("documented alternative (state-rank ordering, §6 limit): a regressed status never moves execution backwards and is never applied", () => {
          const base = payout(d, "cf_regress");
          const vs = versions(base.ws, base.id).slice(1);
          for (const order of [vs.map((v) => v.version), [vs[1].version, vs[2].version], [vs[1].version, vs[2].version, vs[0].version]]) {
            const ws = feedAll(d, base.ws, base.id, order, plusMin(vs.at(-1)!.at, 1));
            expect(intentOf(ws, base.id).status.execution, order.join(",")).toBe("provider_reported_completed");
            const regressed = ws.providerEvents.filter((e) => e.intentId === base.id && e.sequence < picksFor(d).completed.rank && e.processingOutcome === "applied" && e.receivedAt > ws.providerEvents.find((x) => x.intentId === base.id && x.normalizedType === "payout.completed")!.receivedAt);
            expect(regressed, order.join(",")).toEqual([]);
          }
          expect(d.ordering).toEqual({ kind: "state_rank" });
        });
      }
    });

    // 10 --------------------------------------------------------------------------------------------------------
    describe("10. unknown statuses", () => {
      it("an unlisted raw status is refused with the raw status verbatim, never mapped (never success), nothing applied", () => {
        let { ws, id } = payout(d, "cf_unlisted");
        ws = feed(d, ws, id, 2).workspace;
        const before = stateOf(ws, id);
        const v3 = versions(ws, id)[2];
        expect(findMapping(d, UNLISTED_STATUS, undefined)).toBeUndefined();
        // Through the adapter's channel.
        const r = verified ? (() => { const w = providerWebhook(ws, id, 3, { signAt: v3.at }); return ingestRaw(ws, P, w.rawBody, w.signatureHeader, v3.at); })() : pollAt(ws, id, v3.at, 3);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe("invalid_field");
          expect(r.error.message).toContain(`"${UNLISTED_STATUS}"`);
        }
        // Through the reconciler: reported as an error for this payout, state unchanged.
        const rec = reconcileConnect(ws, { actorId: ACTOR, at: plusMin(v3.at, 1) });
        const mine = rec.results.filter((x) => x.intentId === id);
        expect(mine.map((x) => x.outcome)).toEqual(["error"]);
        expect(mine[0].error?.message).toContain(UNLISTED_STATUS);
        expect(stateOf(rec.workspace, id)).toBe(before);
        expect(intentOf(rec.workspace, id).status.execution).not.toBe("provider_reported_completed");
      });
      if (d.shape.subStatus) {
        it("a known status with an unlisted sub-status is refused too (never falls back to the completed row)", () => {
          let { ws, id } = payout(d, "cf_unlisted_sub");
          ws = feed(d, ws, id, 2).workspace;
          const v3 = versions(ws, id)[2];
          const r = verified ? (() => { const w = providerWebhook(ws, id, 3, { signAt: v3.at }); return ingestRaw(ws, P, w.rawBody, w.signatureHeader, v3.at); })() : pollAt(ws, id, v3.at, 3);
          expect(r.ok ? "ok" : r.error.code).toBe("invalid_field");
          if (!r.ok) expect(r.error.message).toContain(UNLISTED_SUB);
          expect(intentOf(ws, id).status.execution).toBe(picksFor(d).inTransit.execution);
        });
      } else {
        it("documented alternative: the provider's payload has no sub-status field, so only the status itself can be unlisted", () => {
          expect(d.shape.subStatus).toBeUndefined();
          expect(d.statuses.every((m) => m.subStatus === undefined)).toBe(true);
        });
      }
      it("every mapped status is kept verbatim as the raw status next to the normalised claim", () => {
        let { ws, id } = payout(d, "cf_reversed");
        ws = feedAll(d, ws, id);
        const evs = ws.providerEvents.filter((e) => e.intentId === id && e.rawBody && e.processingOutcome !== "rejected_signature");
        expect(evs.length).toBeGreaterThanOrEqual(4);
        for (const e of evs) {
          const parsed = parseProviderBody(d, e.rawBody!);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) continue;
          expect(e.detail.rawStatus).toBe(parsed.value.raw.status);
          expect(e.detail.rawSubStatus).toBe(parsed.value.raw.subStatus);
          expect(e.rawBody).toContain(JSON.stringify(e.detail.rawStatus));
        }
      });
    });

    // 11 --------------------------------------------------------------------------------------------------------
    describe("11. partial failures", () => {
      it("a sequence with one bad event in the middle ends exactly as the same sequence without it", () => {
        const base = payout(d, "cf_happy");
        const clean = feedAll(d, base.ws, base.id);
        let ws = feed(d, base.ws, base.id, 2).workspace;
        const v2 = versions(ws, base.id)[1];
        // The bad event: a tampered / unverifiable body, a malformed body, and an unlisted status.
        const good = providerWebhook(ws, base.id, 3, { signAt: v2.at });
        const tampered = must(ingestRaw(ws, P, good.rawBody.replace(/[0-9]/, (c) => (c === "9" ? "8" : String(Number(c) + 1))), good.signatureHeader, v2.at), "tampered");
        expect(tampered.outcome).toBe("rejected_signature");
        ws = tampered.workspace;
        const malformed = ingestRaw(ws, P, "{not json", encodeHeaderBundle(signedHeaders(d, "{not json", v2.at)), v2.at);
        if (malformed.ok) ws = malformed.value.workspace;
        const unlisted = customBody(d, ws, base.id, { afterMinutes: 0, status: UNLISTED_STATUS }, 50, v2.at);
        const u = ingestRaw(ws, P, unlisted, encodeHeaderBundle(signedHeaders(d, unlisted, v2.at)), v2.at);
        if (u.ok) ws = u.value.workspace;
        ws = feed(d, ws, base.id, 3).workspace;
        expect(outcomeOf(ws, base.id)).toEqual(outcomeOf(clean, base.id));
      });
      it("a reconciler batch where one payout's provider answer is bad does not corrupt the others", () => {
        const a = payout(d, "cf_happy");
        const b = payout(d, "cf_unlisted", a.ws);
        const c = payout(d, "cf_reversed", b.ws);
        const at = plusMin(versions(c.ws, c.id).at(-1)!.at, 1);
        const rec = reconcileConnect(c.ws, { actorId: ACTOR, at });
        const by = (id: string) => rec.results.filter((x) => x.intentId === id).map((x) => x.outcome);
        expect(by(b.id)).toEqual(["error"]);
        expect(by(a.id)).toEqual(["applied"]);
        expect(by(c.id)).toEqual(["applied"]);
        expect(intentOf(rec.workspace, a.id).status.execution).toBe("provider_reported_completed");
        expect(intentOf(rec.workspace, c.id).status.execution).toBe("failed");
        expect(intentOf(rec.workspace, b.id).status).toEqual(intentOf(c.ws, b.id).status);
        // Each other payout ends as if it had been reconciled alone.
        const alone = reconcileConnect(payout(d, "cf_happy").ws, { actorId: ACTOR, at });
        const aloneId = alone.workspace.intents.at(-1)!.id;
        expect(intentOf(rec.workspace, a.id).status).toEqual(intentOf(alone.workspace, aloneId).status);
      });
    });

    // 12 --------------------------------------------------------------------------------------------------------
    describe("12. provider confidence", () => {
      it("provider events alone NEVER set settlement verified; every event stays a provider claim", () => {
        for (const script of Object.keys(scenarios(d)).filter((s) => !s.startsWith("cf_unlisted"))) {
          let { ws, id } = payout(d, script);
          ws = feedAll(d, ws, id);
          const i = intentOf(ws, id);
          expect(i.status.settlement, script).not.toBe("verified");
          expect(i.status.settlement, script).toBe("none");
          expect(i.status.reconciliation, script).not.toBe("matched");
          for (const e of ws.providerEvents.filter((x) => x.intentId === id)) {
            expect(e.confidence, script).toBe("provider_claim");
            if (e.detail.claimConfidence !== undefined) expect(["provider_claim", "provider_time_inferred", "provider_ledger_claim", "provider_preliminary"]).toContain(e.detail.claimConfidence);
            expect(EVIDENCE_SOURCE_CLASS[providerEventSourceKind(e)].canVerifySettlement).toBe(false);
          }
          for (const ev of ws.evidence.filter((x) => x.intentId === id)) {
            expect(ev.independent, `${script} ${ev.kind}`).toBe(false);
            expect(classifyEvidenceRecord(ev)).not.toBe("independent");
          }
          expect(ws.chainObservations.filter((o) => o.intentId === id), script).toEqual([]);
        }
        // The mapping table itself can never say "verified".
        for (const m of d.statuses) expect(`${m.confidence} ${m.settlementClaim}`).not.toMatch(/verified/);
      });
      it("a preliminary transaction hash in a provider event never becomes a chain observation, tx hash or allocation", () => {
        const prelim = d.statuses.filter((m) => m.txHash === "preliminary");
        // Normaliser level, for EVERY mapping that is not declared final: a hash in the body never reaches tx_hash.
        const { ws: w0, id: id0 } = payout(d, "cf_happy");
        for (const m of d.statuses.filter((x) => x.txHash !== "final")) {
          const body = JSON.parse(customBody(d, w0, id0, entry(m, 0), 7, w0.asOf)) as Record<string, unknown>;
          const obj = (d.shape.objectField ? body[d.shape.objectField] : body) as Record<string, unknown>;
          obj[d.shape.txHash ?? "tx_hash"] = syntheticPreliminaryTxHash(instrOf(w0, id0).providerPaymentId!);
          const parsed = parseProviderBody(d, JSON.stringify(body));
          expect(parsed.ok, `${m.raw}/${m.subStatus ?? ""}`).toBe(true);
          if (!parsed.ok) continue;
          expect(parsed.value.txHash).toBeUndefined();
          expect(toEnginePayload(parsed.value).tx_hash).toBeUndefined();
          if (d.shape.txHash) expect(parsed.value.raw.txHashPreliminary).toBe(syntheticPreliminaryTxHash(instrOf(w0, id0).providerPaymentId!));
        }
        if (prelim.length) {
          // Engine level, through the adapter's channel.
          let { ws, id, ref } = payout(d, "cf_happy");
          const n = versions(ws, id).find((v) => v.entry.txHash === "preliminary")!.version;
          ws = feed(d, ws, id, n).workspace;
          const e = ws.providerEvents.at(-1)!;
          expect(e.detail.rawTxHashPreliminary).toBe(syntheticPreliminaryTxHash(ref));
          expect(e.detail.txHash).toBeUndefined();
          expect(providerEventSourceKind(e)).toBe("provider_preliminary_hash");
          expect(EVIDENCE_SOURCE_CLASS.provider_preliminary_hash.chainEvidence).toBe(false);
          expect(ws.chainObservations.filter((o) => o.intentId === id)).toEqual([]);
          expect(ws.allocations).toEqual([]);
          expect(intentOf(ws, id).status.settlement).toBe("none");
        } else {
          // Documented alternative: the provider declares no preliminary hash; a hash smuggled into a signed event is ignored.
          let { ws, id } = payout(d, "cf_happy");
          ws = feed(d, ws, id, 2).workspace;
          const v3 = versions(ws, id)[2];
          const body = JSON.parse(providerWebhook(ws, id, 3).rawBody) as Record<string, unknown>;
          const obj = (d.shape.objectField ? body[d.shape.objectField] : body) as Record<string, unknown>;
          obj.tx_hash = syntheticFinalTxHash(instrOf(ws, id).providerPaymentId!);
          const raw = JSON.stringify(body);
          const r = must(ingestRaw(ws, P, raw, encodeHeaderBundle(signedHeaders(d, raw, v3.at)), v3.at), "smuggled hash");
          const e = r.workspace.providerEvents.at(-1)!;
          expect(e.detail.txHash).toBeUndefined();
          expect(e.detail.rawTxHashPreliminary).toBeUndefined();
          expect(r.workspace.chainObservations.filter((o) => o.intentId === id)).toEqual([]);
          expect(r.workspace.allocations).toEqual([]);
          expect(d.shape.txHash).toBeUndefined();
          expect(prelim).toEqual([]);
        }
      });
    });
  });
}
