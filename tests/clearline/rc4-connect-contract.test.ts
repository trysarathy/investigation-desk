/**
 * rc4 Connect — item 1 (adapter contract), item 8 (fictional descriptors) and P2 outbound idempotency.
 * Sandbox only; every provider here is fictional.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECT_DESCRIPTORS,
  CONNECT_PROVIDERS,
  CONNECT_SCRIPTS,
  EXECUTION_TRANSITIONS,
  SANDBOX_PROVIDERS,
  connectKeyring,
  findMapping,
  getAdapter,
  isTerminalExecution,
  isValidProviderKey,
  providerIdempotencyKey,
  retryDecision,
  sampleWorkspace,
  simulateProviderIdempotency,
  type AdapterDescriptor,
} from "@/lib/clearline";
import { EVENT_TARGET } from "@/lib/clearline/state";
import { CW, QF, SG, intentOf, submittedConnect } from "./rc4-connect-helpers";

const CONNECT_DIR = join(__dirname, "../../src/lib/clearline/connect");

describe("rc4 Connect item 1: every descriptor declares the whole contract", () => {
  it("there are three fictional descriptors with distinct semantics", () => {
    expect(CONNECT_DESCRIPTORS.map((d) => d.providerId)).toEqual([CW, QF, SG]);
    // One regression-capable, one at-most-once (polling required), one stablecoin with a preliminary hash.
    const cw = CONNECT_DESCRIPTORS[0], qf = CONNECT_DESCRIPTORS[1], sg = CONNECT_DESCRIPTORS[2];
    expect(cw.statuses.some((m) => m.execution === "failed" && m.settlementClaim === "provider_claims_reversed")).toBe(true);
    expect(qf.polling.webhookDelivery).toBe("at_most_once");
    expect(sg.statuses.some((m) => m.txHash === "preliminary")).toBe(true);
    expect(new Set(CONNECT_DESCRIPTORS.map((d) => d.ordering.kind)).size).toBe(2);
    expect(new Set(CONNECT_DESCRIPTORS.map((d) => d.dedupe.declared)).size).toBe(2);
    expect(new Set(CONNECT_DESCRIPTORS.map((d) => d.verification[0].id)).size).toBe(3);
  });

  for (const d of CONNECT_DESCRIPTORS)
    describe(d.providerName, () => {
      it("maps every raw status to an engine claim whose execution equals the engine's own EVENT_TARGET", () => {
        expect(d.statuses.length).toBeGreaterThanOrEqual(5);
        for (const m of d.statuses) {
          expect(EVENT_TARGET[m.event] ?? "unchanged", `${m.raw}/${m.subStatus}`).toBe(m.execution);
          if (m.execution !== "unchanged") expect(Object.keys(EXECUTION_TRANSITIONS)).toContain(m.execution);
          else expect(m.event).toBe("payout.hold_released");
          expect(Number.isInteger(m.rank) && m.rank > 0).toBe(true);
        }
      });
      it("raw (status, sub-status) pairs are unique, so a lookup is never ambiguous", () => {
        const keys = d.statuses.map((m) => `${m.raw}/${m.subStatus ?? ""}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const m of d.statuses) expect(findMapping(d, m.raw, m.subStatus)).toBe(m);
      });
      it("terminal outcomes rank above every progress status (a reversal is never mistaken for a late event)", () => {
        const terminal = d.statuses.filter((m) => m.execution !== "unchanged" && isTerminalExecution(m.execution));
        const progress = d.statuses.filter((m) => !terminal.includes(m));
        expect(terminal.length).toBeGreaterThan(0);
        for (const t of terminal) for (const p of progress) expect(t.rank, `${t.raw} > ${p.raw}`).toBeGreaterThan(p.rank);
      });
      it("declares verification, dedupe, ordering, polling and idempotency semantics", () => {
        expect(d.verification.length).toBeGreaterThan(0);
        for (const s of d.verification) expect(s.toleranceSeconds).toBeGreaterThan(0);
        expect(["event_id", "object_version"]).toContain(d.dedupe.declared);
        expect(d.dedupe.fallback).toMatch(/\S/);
        expect(["object_version", "state_rank"]).toContain(d.ordering.kind);
        expect(d.polling.fetchStatus).toBe(true);
        expect(d.idempotency.maxLength).toBeGreaterThan(0);
        expect(d.idempotency.ttlHours).toBeGreaterThan(0);
        expect(["replay_first_response", "reject_duplicate"]).toContain(d.idempotency.onRepeat);
        if (d.ordering.kind === "object_version") expect(d.shape.version).toBeDefined();
      });
      it("a settlement report is a provider report (the only class the type allows)", () => {
        expect(d.settlementReportClass).toBe("provider_report");
      });
      it("is registered as a Connect adapter with liveExecution false and polling", () => {
        const a = getAdapter(d.providerId)!;
        expect(a.capabilities()).toMatchObject({ sandbox: true, liveExecution: false, polling: true, providerName: d.providerName });
        expect(typeof a.fetchStatus).toBe("function");
        expect(a.routes().length).toBe(1);
      });
      it("every script entry maps (the simulator never emits a status the mapping table lacks)", () => {
        for (const [name, script] of Object.entries(CONNECT_SCRIPTS[d.providerId]))
          for (const e of script) expect(findMapping(d, e.status, e.subStatus), `${name}: ${e.status}/${e.subStatus}`).toBeDefined();
      });
    });
});

describe("rc4 Connect item 8: the providers are fictional and sandbox-only", () => {
  // Status words that real providers' docs use verbatim (from the research's state-model comparison).
  const REAL_STATUS_WORDS = ["paid", "PAID", "failed", "FAILED", "completed", "COMPLETED", "returned", "reversed", "in_transit", "pending", "canceled", "DEEMED_PAID", "PROCESSED_BY_CLEARING", "payment_submitted", "payment_processed", "CONFIRMED", "SETTLED", "succeeded", "Complete", "capture_succeeded", "SUCCEEDED", "unconfirmed"];
  const REAL_VENDOR_NAMES = /modern treasury|stripe|nium|thunes|airwallex|primer|gr4vy|formance|finmo|circle|bvnk|bridge|fireblocks|bitgo|zero ?hash/i;

  it("names say fictional; no real vendor is named; raw status names are not real vendors' verbatim names", () => {
    for (const d of CONNECT_DESCRIPTORS) {
      expect(d.providerName).toMatch(/\(fictional/);
      expect(`${d.providerName} ${d.providerId}`).not.toMatch(REAL_VENDOR_NAMES);
      for (const m of d.statuses) {
        expect(REAL_STATUS_WORDS, m.raw).not.toContain(m.raw);
        if (m.subStatus) expect(REAL_STATUS_WORDS, m.subStatus).not.toContain(m.subStatus);
      }
    }
  });
  it("all keys are public test_ secrets", () => {
    for (const d of CONNECT_DESCRIPTORS) for (const k of connectKeyring(d.providerId)) expect(k.secret.startsWith("test_")).toBe(true);
  });
  it("the Connect modules make no network calls and hold no signing library", () => {
    const src = readdirSync(CONNECT_DIR).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(CONNECT_DIR, f), "utf8")).join("\n");
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|from "node:(net|http|https|tls|dgram)"|require\(|axios|eth_sendRawTransaction|privateKey/);
  });
  it("the sample workspace and SANDBOX_PROVIDERS are unchanged; Connect providers are listed separately", () => {
    expect(SANDBOX_PROVIDERS.map((p) => p.id)).toEqual(["prv_northline", "prv_harbour", "prv_tidewater"]);
    expect(CONNECT_PROVIDERS.map((p) => p.id)).toEqual([CW, QF, SG]);
    expect(sampleWorkspace().routes.some((r) => r.providerId.startsWith("prv_cx_"))).toBe(false);
  });
});

describe("rc4 Connect P2: outbound idempotency semantics", () => {
  const sem = (d: AdapterDescriptor) => d.idempotency;
  it("the derived provider key fits each provider's format and length, and is stable per instruction", () => {
    for (const d of CONNECT_DESCRIPTORS) {
      const k = providerIdempotencyKey(d, "clearline-key-0001", "ins_00009");
      expect(isValidProviderKey(sem(d), k), `${d.providerId}: ${k}`).toBe(true);
      expect(k.length).toBeLessThanOrEqual(d.idempotency.maxLength);
      expect(providerIdempotencyKey(d, "clearline-key-0001", "ins_00009")).toBe(k);
      expect(providerIdempotencyKey(d, "clearline-key-0001", "ins_00010")).not.toBe(k);
    }
    expect(providerIdempotencyKey(CONNECT_DESCRIPTORS[1], "k-00000001", "ins_1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("format and length are enforced (too long, wrong format)", () => {
    expect(isValidProviderKey(CONNECT_DESCRIPTORS[2].idempotency, "x".repeat(65))).toBe(false);
    expect(isValidProviderKey(CONNECT_DESCRIPTORS[2].idempotency, "x".repeat(64))).toBe(true);
    expect(isValidProviderKey(CONNECT_DESCRIPTORS[1].idempotency, "not-a-uuid")).toBe(false);
    expect(isValidProviderKey(CONNECT_DESCRIPTORS[0].idempotency, "has space")).toBe(false);
  });
  it("replay-first-response vs reject-duplicate; a different body is always rejected; after the TTL the key is forgotten", () => {
    const at = "2026-11-13T02:00:00.000Z";
    for (const d of CONNECT_DESCRIPTORS) {
      const key = providerIdempotencyKey(d, "k-00000001", "ins_1");
      const first = simulateProviderIdempotency(d.idempotency, [], { key, bodyHash: "h1", at, response: "R1" });
      expect(first.result).toEqual({ outcome: "created", response: "R1" });
      const again = simulateProviderIdempotency(d.idempotency, first.store, { key, bodyHash: "h1", at: "2026-11-13T03:00:00.000Z", response: "R2" });
      expect(again.result).toEqual(d.idempotency.onRepeat === "replay_first_response" ? { outcome: "replayed", response: "R1" } : { outcome: "rejected_duplicate" });
      expect(simulateProviderIdempotency(d.idempotency, first.store, { key, bodyHash: "h2", at, response: "R2" }).result.outcome).toBe("rejected_body_mismatch");
      const late = new Date(Date.parse(at) + d.idempotency.ttlHours * 3_600_000).toISOString();
      expect(simulateProviderIdempotency(d.idempotency, first.store, { key, bodyHash: "h1", at: late, response: "R3" }).result.outcome).toBe("created");
      expect(simulateProviderIdempotency(d.idempotency, [], { key: "bad key!", bodyHash: "h1", at, response: "R" }).result.outcome).toBe("rejected_key_format");
    }
    expect(CONNECT_DESCRIPTORS.map((d) => d.idempotency.onRepeat)).toEqual(["replay_first_response", "reject_duplicate", "replay_first_response"]);
  });
  it("never retry blindly: after the TTL, or with a reject-duplicate provider, poll the status first", () => {
    const [cw, qf] = CONNECT_DESCRIPTORS;
    const t0 = "2026-11-13T02:00:00.000Z";
    expect(retryDecision(cw.idempotency, t0, "2026-11-13T05:00:00.000Z")).toBe("retry_with_same_key");
    expect(retryDecision(cw.idempotency, t0, "2026-11-14T02:00:00.000Z")).toBe("poll_status_first");
    expect(retryDecision(qf.idempotency, t0, "2026-11-13T02:05:00.000Z")).toBe("poll_status_first");
  });
  it("the provider's synchronous response echoes the derived key, kept verbatim in the stored raw body", () => {
    for (const p of [CW, QF, SG]) {
      const { ws, id, instructionId } = submittedConnect(p);
      const d = CONNECT_DESCRIPTORS.find((x) => x.providerId === p)!;
      const ack = ws.providerEvents.find((e) => e.intentId === id && e.provenance === "provider_api_response")!;
      expect(JSON.parse(ack.rawBody!).idempotency_key).toBe(providerIdempotencyKey(d, intentOf(ws, id).idempotencyKey, instructionId));
    }
  });
});
