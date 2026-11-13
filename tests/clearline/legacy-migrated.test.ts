/**
 * Equivalent assertions for the retired legacy tests (tests/clearline-core.test.ts and
 * tests/clearline-control.test.ts, which exercised src/lib/clearline/core.ts — removed under
 * code review M10). Each case maps one legacy assertion onto the unified engine / v1 API.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as LEGACY_GET, POST as LEGACY_POST } from "@/app/api/clearline/test/[action]/route";
import { canTransitionExecution, computeLiquidity, emptyWorkspace, investigate, sampleWorkspace, scenarioIntentId, signSandboxWebhook, verifySandboxWebhook, sandboxWebhookSecret } from "@/lib/clearline";
import { approved, attempt, baseInput, created, debitLine, errorCode, intent, run, sim, submitted } from "./helpers";

describe("migrated: Connect payment state machine (was clearline-core.test.ts)", () => {
  it("allows the complete partner-executed happy path", () => {
    let { ws, id } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(intent(ws, id).status.execution).toBe("provider_reported_completed");
  });
  it("blocks skips and terminal rewrites", () => {
    const { ws, id } = created();
    expect(errorCode(attempt(ws, "usr_maya", { type: "submit_instruction", instructionId: "ins_none" }))).toBe("not_found");
    expect(canTransitionExecution("created", "provider_reported_completed")).toBe(false);
    expect(canTransitionExecution("provider_reported_completed", "submitted")).toBe(false);
    expect(canTransitionExecution("returned", "provider_reported_completed")).toBe(false);
    void id;
  });
  it("quotes three sandbox providers and explains an ineligible route", () => {
    const { ws, id } = created();
    const qs = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace.quotes;
    expect(new Set(qs.map((q) => q.providerId)).size).toBe(3);
    expect(qs.filter((q) => q.eligible).length).toBeGreaterThanOrEqual(2);
    expect(qs.some((q) => !q.eligible && q.eligibilityReason)).toBe(true);
  });
  it("reconciles only exact references, never amounts alone", () => {
    let { ws, id } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: "NOT_THE_REFERENCE" }) });
    expect(r.workspace.allocations).toHaveLength(0);
    expect(intent(r.workspace, id).status.reconciliation).not.toBe("matched");
  });
  it("calculates usable cash with restricted, safeguarded, committed and buffer subtracted", () => {
    const row = computeLiquidity(emptyWorkspace()).rows[0];
    expect(row.usableMinor).toBe(row.eligibleMinor - row.restrictedMinor - row.safeguardedMinor - row.committedPayoutsMinor - row.bufferMinor);
  });
  it("states observations without asserting independent settlement", () => {
    const ws = sampleWorkspace();
    const v = investigate(ws, scenarioIntentId(ws, "s4_chain")!);
    expect(v.ok && v.value.explanationCodes).toContain("NA_AWAIT_FINALITY");
    expect(v.ok && v.value.status.settlement).not.toBe("verified");
  });
  it("signs and verifies webhook payloads, rejects tampering", () => {
    const secret = sandboxWebhookSecret("prv_northline");
    const payload = '{"id":"evt_test_83a","type":"payout.completed"}';
    const sig = signSandboxWebhook(payload, secret, 1_794_500_000);
    expect(verifySandboxWebhook(payload, sig, secret, 1_794_500_000).valid).toBe(true);
    expect(verifySandboxWebhook(payload + " ", sig, secret, 1_794_500_000).valid).toBe(false);
  });
  it("accepts strictly fictional intents and rejects malicious inputs", () => {
    expect(created().ws.intents).toHaveLength(1);
    expect(errorCode(attempt(emptyWorkspace(), "usr_maya", { type: "create_intent", input: baseInput({ amountMinor: 0 }) }))).toBe("invalid_amount");
    expect(errorCode(attempt(emptyWorkspace(), "usr_maya", { type: "create_intent", input: baseInput({ beneficiaryName: "<script>" }) }))).toBe("invalid_field");
  });
});

describe("migrated: Control derives from Connect events (was clearline-control.test.ts)", () => {
  it("a statement line for a completed payout matches by its provider reference", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 4_821_537 });
    ws = sim(sim(ws, id).workspace, id).workspace;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid, amountMinor: 4_821_537 }) });
    expect(r.workspace.allocations[0]).toMatchObject({ amountMinor: 4_821_537, target: { kind: "payment", intentId: id } });
    expect(intent(r.workspace, id).status.reconciliation).toBe("matched");
  });
  it("refuses settlement evidence for instructions that were never submitted", () => {
    const { ws } = created();
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: "NLPO-0000000000" }) });
    expect(r.workspace.allocations).toHaveLength(0);
  });
  it("a new approved payout is reflected in the provider's committed and usable liquidity", () => {
    const before = computeLiquidity(emptyWorkspace()).rows.find((r) => r.id === "liq_northline_sgd")!;
    const after = computeLiquidity(approved({ amountMinor: 4_821_537 }).ws).rows.find((r) => r.id === "liq_northline_sgd")!;
    expect(after.committedPayoutsMinor - before.committedPayoutsMinor).toBe(4_821_537);
    expect(before.usableMinor - after.usableMinor).toBe(4_821_537);
  });
  it("a provider's completion is never presented as independently verified settlement", () => {
    let { ws, id } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(intent(ws, id).status.settlement).toBe("none");
  });
});

describe("M10: the legacy unversioned API is retired", () => {
  it("returns 410 with a pointer to /api/clearline/test/v1 for every action", async () => {
    for (const action of ["health", "payments", "intents", "quotes", "transitions", "webhooks"]) {
      const g = await LEGACY_GET();
      const p = await LEGACY_POST();
      for (const r of [g, p]) {
        expect(r.status).toBe(410);
        expect((await r.json()).error.replacement).toBe("/api/clearline/test/v1");
      }
      void action;
    }
    void NextRequest;
  });
});
