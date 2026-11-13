/**
 * CHANGE 5 (release/clearline-v2-20261113): F1, F2, m11 and the human label API.
 * Fictional sandbox data only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE_LABELS,
  EXECUTION_TRANSITIONS,
  HUMAN_LABELS,
  RECONCILIATION_CODE_GROUP,
  RECONCILIATION_CODE_TEXT,
  SAMPLE_SCENARIOS,
  canResolveCase,
  describeCode,
  describeError,
  describeStatus,
  evidenceTimelineFor,
  investigate,
  isKnownCode,
  listExceptions,
  parseWorkspace,
  sampleWorkspace,
  serializeWorkspace,
  type ExecutionState,
  type Workspace,
} from "@/lib/clearline";
import { attempt, baseInput, debitLine, intent, run, signedDelivery, sim, submitted } from "./helpers";

const st = (ws: Workspace, id: string) => intent(ws, id).status;
const providerReport = (ppid: string, o: Record<string, unknown> = {}) =>
  debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, ...o });
const ingest = (ws: Workspace, line: ReturnType<typeof debitLine>) => run(ws, "usr_maya", { type: "ingest_statement_line", line });
const completedPayout = () => {
  const s = submitted();
  return { ...s, ws: sim(sim(s.ws, s.id).workspace, s.id).workspace };
};
const webhook = (ws: Workspace, ppid: string, type: string, seq: number) =>
  run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E${seq}`, type, provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;

/** Put a submitted payout into a terminal execution state. failed/returned arrive through signed provider webhooks. */
function terminalPayout(state: "failed" | "returned" | "cancelled" | "expired") {
  const s = state === "returned" ? completedPayout() : submitted();
  let ws = s.ws;
  if (state === "failed") ws = webhook(ws, s.ppid, "payout.failed", 9);
  else if (state === "returned") ws = webhook(ws, s.ppid, "payout.returned", 9);
  else {
    // The engine never moves a SUBMITTED payout to cancelled/expired (M7), so these states are set on
    // stored data here: the rule is defence in depth for workspaces that carry such a payout.
    ws = JSON.parse(serializeWorkspace(ws)) as Workspace;
    intent(ws, s.id).status.execution = state;
  }
  expect(st(ws, s.id).execution).toBe(state);
  return { ...s, ws };
}

describe("CHANGE 5 F1: provider settlement report on a terminal payout", () => {
  for (const state of ["failed", "returned", "cancelled", "expired"] as const) {
    it(`F1 ${state}: raises contradictory_evidence RC_REPORT_ON_TERMINAL_PAYOUT and leaves settlement unchanged`, () => {
      const { ws, id, ppid } = terminalPayout(state);
      const before = { ...st(ws, id) };
      const r = ingest(ws, providerReport(ppid));
      expect(r.outcome).toBe("contradictory_exception_raised");
      const after = st(r.workspace, id);
      expect(after.settlement).toBe(before.settlement);
      expect(after.settlementScope).toBe(before.settlementScope);
      expect(after.execution).toBe(state);
      expect(after.settlement).not.toBe("observed");
      const exc = r.workspace.exceptions.at(-1)!;
      expect(exc).toMatchObject({ category: "contradictory_evidence", explanationCode: "RC_REPORT_ON_TERMINAL_PAYOUT", intentId: id, status: "open" });
      expect(exc.explanation).toContain(`"${state}"`);
      const line = r.workspace.statementLines.at(-1)!;
      expect(line.allocationIds).toHaveLength(0);
      expect(line.explanationCodes).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
      expect(line.status).toBe("exception");
      const v = investigate(r.workspace, id);
      expect(v.ok && v.value.contradictions.map((c) => c.code)).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
      expect(RECONCILIATION_CODE_GROUP.RC_REPORT_ON_TERMINAL_PAYOUT).toBe("contradiction");
    });
  }
  it("F1: after a person resolves the contradiction, the recompute does not count the report as settlement on a failed payout", () => {
    const { ws: w0, id, ppid } = terminalPayout("failed");
    let ws = ingest(w0, providerReport(ppid)).workspace;
    const e = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Provider confirms the payout failed (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Report was sent in error" }).workspace;
    expect(st(ws, id)).toMatchObject({ execution: "failed", settlement: "none", settlementScope: "none" });
  });
  it("F1: a provider report on a live completed payout is still ordinary provider-reported evidence", () => {
    const { ws, id, ppid } = completedPayout();
    const r = ingest(ws, providerReport(ppid));
    expect(r.outcome).toBe("recorded_provider_report");
    expect(st(r.workspace, id)).toMatchObject({ settlement: "observed", settlementScope: "provider_report" });
  });
});

describe("CHANGE 5 F2: under-amount provider report and partial bank lines", () => {
  it("F2: a provider report below the payout raises RC_UNDER_AMOUNT_REPORT with the structured difference; settlement is not complete", () => {
    const { ws, id, ppid } = completedPayout();
    const r = ingest(ws, providerReport(ppid, { amountMinor: 400_000 }));
    expect(r.outcome).toBe("exception_raised");
    const s = st(r.workspace, id);
    expect(s.settlement).not.toBe("verified");
    expect(s.settlement).toBe("none");
    expect(s.reconciliation).toBe("exception");
    const exc = r.workspace.exceptions.at(-1)!;
    expect(exc).toMatchObject({ category: "unmatched_reconciliation", explanationCode: "RC_UNDER_AMOUNT_REPORT", status: "open", intentId: id });
    const d = { code: "RC_UNDER_AMOUNT_REPORT", expectedMinor: 1_000_000, reportedMinor: 400_000, differenceMinor: 600_000, currency: "SGD", source: "provider_settlement_report" };
    expect(exc.amountDifference).toMatchObject(d);
    expect(exc.amountDifference!.requiredNextAction).toMatch(/SGD 6,000\.00/);
    expect(exc.requiredAction).toBe(exc.amountDifference!.requiredNextAction);
    expect(exc.explanation).toContain("Expected SGD 10,000.00, reported SGD 4,000.00, difference SGD 6,000.00");
    const line = r.workspace.statementLines.at(-1)!;
    expect(line.amountDifference).toMatchObject(d);
    expect(line.explanationCodes).toEqual(expect.arrayContaining(["RC_PROVIDER_REPORT_ONLY", "RC_UNDER_AMOUNT_REPORT"]));
    expect(line.allocationIds).toHaveLength(0);
    // investigate()
    const v = investigate(r.workspace, id);
    if (!v.ok) throw new Error("investigate failed");
    expect(v.value.amountDifferences).toHaveLength(1);
    expect(v.value.amountDifferences[0]).toMatchObject(d);
    expect(v.value.contradictions.map((c) => c.code)).toContain("RC_UNDER_AMOUNT_REPORT");
    expect(v.value.explanationCodes).toContain("RC_UNDER_AMOUNT_REPORT");
    expect(v.value.nextActions.find((n) => n.code === "NA_UNMATCHED_RECONCILIATION")!.text).toBe(exc.amountDifference!.requiredNextAction);
    // evidence timeline
    const tl = evidenceTimelineFor(r.workspace, id);
    expect(tl.find((t) => t.kind === "statement_line" && t.refs[0] === line.id)!.amountDifference).toMatchObject(d);
    expect(tl.find((t) => t.kind === "exception" && t.refs[0] === exc.id)!.amountDifference).toMatchObject(d);
  });
  it("F2: under-amount report after a full bank match still raises the disagreement (provider and payout disagree)", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, debitLine({ reference: ppid })).workspace;
    const r = ingest(ws, providerReport(ppid, { amountMinor: 999_999 }));
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_UNDER_AMOUNT_REPORT");
    expect(r.workspace.exceptions.at(-1)!.amountDifference!.differenceMinor).toBe(1);
    expect(st(r.workspace, id).reconciliation).toBe("exception");
  });
  it("F2: a provider report for exactly the payout amount raises nothing", () => {
    const { ws, ppid } = completedPayout();
    const r = ingest(ws, providerReport(ppid));
    expect(r.workspace.exceptions.filter((e) => e.status !== "resolved")).toHaveLength(0);
    expect(r.workspace.statementLines.at(-1)!.amountDifference).toBeUndefined();
  });
  it("F2: a bank line below the payout stays partial with the same structured difference; the remainder completes it", () => {
    let { ws, id, ppid } = completedPayout();
    const r = ingest(ws, debitLine({ reference: ppid, amountMinor: 250_000 }));
    expect(r.outcome).toBe("allocated");
    expect(st(r.workspace, id)).toMatchObject({ settlement: "observed", settlementScope: "bank_statement", reconciliation: "partially_matched" });
    const line = r.workspace.statementLines.at(-1)!;
    const d = { code: "RC_PARTIAL_AMOUNT", expectedMinor: 1_000_000, reportedMinor: 250_000, differenceMinor: 750_000, currency: "SGD", source: "bank_statement" };
    expect(line.amountDifference).toMatchObject(d);
    expect(line.amountDifference!.requiredNextAction).toMatch(/SGD 7,500\.00/);
    const v = investigate(r.workspace, id);
    if (!v.ok) throw new Error("investigate failed");
    expect(v.value.amountDifferences[0]).toMatchObject(d);
    expect(v.value.outstanding.find((o) => o.code === "OS_PARTIALLY_RECONCILED")!.amount).toEqual({ amountMinor: 750_000, currency: "SGD" });
    expect(evidenceTimelineFor(r.workspace, id).find((t) => t.kind === "statement_line")!.amountDifference).toMatchObject(d);
    // second bank line covers the remainder exactly → matched/verified; its own line has no difference
    ws = ingest(r.workspace, debitLine({ reference: ppid, amountMinor: 750_000, lineId: "L-REMAINDER" })).workspace;
    expect(st(ws, id)).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    expect(ws.statementLines.at(-1)!.amountDifference).toBeUndefined();
  });
  it("F2: amountDifference survives serialise → parse; a tampered difference is rejected with a field path", () => {
    const { ws, ppid } = completedPayout();
    const w = ingest(ws, providerReport(ppid, { amountMinor: 400_000 })).workspace;
    const text = serializeWorkspace(w);
    const back = parseWorkspace(text);
    expect(back.ok).toBe(true);
    const bad = JSON.parse(text);
    bad.exceptions.at(-1).amountDifference.differenceMinor = 1;
    const r = parseWorkspace(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toMatch(/^exceptions\[\d+\]\.amountDifference\.differenceMinor$/);
  });
});

describe("CHANGE 5 m11: quotes never show 0 as eligible on a bad rate", () => {
  it("m11: a route with a malformed rate yields an ineligible quote with RATE_UNAVAILABLE, not an eligible 0", () => {
    const s = submitted();
    let ws = JSON.parse(serializeWorkspace(s.ws)) as Workspace;
    for (const r of ws.routes) for (const k of Object.keys(r.indicativeRates)) r.indicativeRates[k] = "not-a-rate";
    const c = run(ws, "usr_maya", { type: "create_intent", input: baseInput() });
    ws = c.workspace;
    const q = attempt(ws, "usr_maya", { type: "request_quotes", intentId: c.createdIds[0] });
    const quotes = q.ok ? q.value.workspace.quotes.filter((x) => x.intentId === c.createdIds[0]) : [];
    expect(quotes.length).toBeGreaterThan(0);
    for (const x of quotes) {
      expect(x.eligible && x.estimatedRecipientMinor === 0).toBe(false);
      if (!x.eligible) expect(x.estimatedRecipientMinor).toBe(0);
    }
    expect(quotes.some((x) => /No usable indicative rate/.test(x.eligibilityReason))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Human labels
// ---------------------------------------------------------------------------------------------

const ENGINE_DIR = join(__dirname, "../../src/lib/clearline");
const engineSource = () => readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(ENGINE_DIR, f), "utf8")).join("\n");
/** Union members of an exported string-literal type in types.ts. */
function unionMembers(name: string): string[] {
  const src = readFileSync(join(ENGINE_DIR, "types.ts"), "utf8");
  const m = new RegExp(`export type ${name} =([^;]+);`).exec(src);
  if (!m) throw new Error(`type ${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("CHANGE 5 human labels", () => {
  const dims: [keyof typeof HUMAN_LABELS, string][] = [
    ["execution", "ExecutionState"],
    ["settlement", "SettlementEvidenceState"],
    ["settlementScope", "SettlementScope"],
    ["reconciliation", "ReconciliationState"],
    ["exceptionCategory", "ExceptionCategory"],
    ["exceptionBlocker", "ExceptionCategory"],
    ["severity", "Severity"],
    ["exceptionStatus", "ExceptionStatus"],
    ["holdStatus", "HoldStatus"],
    ["advanceState", "AdvanceState"],
    ["instructionStatus", "InstructionStatus"],
    ["eventType", "NormalizedEventType"],
    ["processingOutcome", "ProcessingOutcome"],
    ["evidenceKind", "EvidenceKind"],
    ["statementSource", "StatementSource"],
    ["timelineKind", "EvidenceTimelineKind"],
    ["providerErrorClass", "ProviderErrorClass"],
    ["errorCode", "EngineErrorCode"],
  ];
  for (const [dim, typeName] of dims)
    it(`every ${typeName} member has a non-empty label in HUMAN_LABELS.${dim}`, () => {
      const members = unionMembers(typeName);
      expect(members.length).toBeGreaterThan(1);
      const map = HUMAN_LABELS[dim] as Record<string, string>;
      for (const v of members) expect(map[v], `${dim}.${v}`).toMatch(/\S/);
      expect(Object.keys(map).sort()).toEqual([...new Set(members)].sort());
    });

  it("execution labels follow the state machine (every EXECUTION_TRANSITIONS state, incl. the spec examples)", () => {
    expect(Object.keys(HUMAN_LABELS.execution).sort()).toEqual(Object.keys(EXECUTION_TRANSITIONS).sort());
    expect(HUMAN_LABELS.execution.provider_reported_completed).toBe("Provider reports completed");
    const d = describeStatus({ execution: "failed", settlement: "none", settlementScope: "none", reconciliation: "pending" });
    expect(d.executionFinal).toBe(true);
    expect(describeStatus({ execution: "in_transit", settlement: "none", settlementScope: "none", reconciliation: "pending" }).executionFinal).toBe(false);
    expect(describeStatus({ execution: "returned", settlement: "none", settlementScope: "none", reconciliation: "matched" }).reconciliation).toMatch(/net zero/);
    expect(describeStatus({ execution: "provider_reported_completed", settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" }).summary).toBe(
      "Provider reports completed · Settlement verified (Bank statement) · Matched",
    );
  });

  it("every ReconciliationCode has text, a group and a label; every code group has a label", () => {
    for (const c of unionMembers("ReconciliationCode")) {
      expect(RECONCILIATION_CODE_TEXT[c as keyof typeof RECONCILIATION_CODE_TEXT], c).toMatch(/\S/);
      expect(RECONCILIATION_CODE_GROUP[c as keyof typeof RECONCILIATION_CODE_GROUP], c).toMatch(/\S/);
      expect(isKnownCode(c), c).toBe(true);
    }
    for (const g of Object.values(RECONCILIATION_CODE_GROUP)) expect(HUMAN_LABELS.reconciliationCodeGroup[g]).toMatch(/\S/);
  });

  it("every static code string in the engine source (RC_/EV_/CH_/PV_/FD_/IE_/UK_/OS_/WA_/NA_/PR_/QT_/MC_/CT_ and resolution/eligibility codes) has a label", () => {
    const src = engineSource();
    const codes = new Set([...src.matchAll(/"((?:RC|EV|CH|PV|FD|IE|UK|OS|WA|NA|PR|QT|MC|CT)_[A-Z0-9_]*[A-Z0-9])"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/deny\("([A-Z_]+)"|code: "([A-Z][A-Z_]+)"/g)) codes.add(m[1] ?? m[2]);
    expect(codes.size).toBeGreaterThan(90);
    const missing = [...codes].filter((c) => !isKnownCode(c));
    expect(missing).toEqual([]);
    for (const c of codes) expect(describeCode(c)).not.toMatch(/Unrecognised/);
  });

  it("dynamic code families resolve for every member of their source enum", () => {
    for (const t of unionMembers("NormalizedEventType")) expect(isKnownCode("PR_LAST_" + t.replace(".", "_").toUpperCase()), t).toBe(true);
    for (const c of unionMembers("ProviderErrorClass")) {
      expect(isKnownCode("PV_FAILED_" + c.toUpperCase()), c).toBe(true);
      expect(isKnownCode("PV_RETURNED_" + c.toUpperCase()), c).toBe(true);
    }
    for (const c of unionMembers("ExceptionCategory")) expect(isKnownCode("NA_" + c.toUpperCase()), c).toBe(true);
    for (const o of unionMembers("ProcessingOutcome")) expect(isKnownCode("PE_" + o.toUpperCase()), o).toBe(true);
    for (const k of unionMembers("EvidenceKind")) expect(isKnownCode("EV_" + k.toUpperCase()), k).toBe(true);
    for (const s of ["observed", "pending_finality", "final", "rejected_unsupported"]) expect(isKnownCode("CH_" + s.toUpperCase()), s).toBe(true);
    for (const d of ["release", "reject", "request_more"]) expect(isKnownCode("HD_" + d.toUpperCase()), d).toBe(true);
    expect(describeCode("PR_LAST_PAYOUT_COMPLETED")).toBe("Last provider report: provider reports completed");
    expect(describeCode("ZZ_NOT_A_CODE")).toBe("Unrecognised code (ZZ_NOT_A_CODE)");
    expect(isKnownCode("ZZ_NOT_A_CODE")).toBe(false);
    expect(describeCode("")).toBe("Unrecognised code");
    expect(isKnownCode("__proto__")).toBe(false);
  });

  it("every code produced by the sample workspace (investigate + evidence timeline + exceptions + lines) is known", () => {
    const ws = sampleWorkspace();
    const seen = new Set<string>();
    for (const i of ws.intents) {
      const v = investigate(ws, i.id);
      if (v.ok) v.value.explanationCodes.forEach((c) => seen.add(c));
      for (const t of evidenceTimelineFor(ws, i.id)) t.codes.forEach((c) => seen.add(c));
    }
    ws.exceptions.forEach((e) => seen.add(e.explanationCode));
    ws.statementLines.forEach((l) => l.explanationCodes.forEach((c) => seen.add(c)));
    for (const c of ws.cases) seen.add(canResolveCase(ws, c.id).code);
    expect(seen.size).toBeGreaterThan(20);
    expect([...seen].filter((c) => !isKnownCode(c))).toEqual([]);
    expect(Object.keys(SAMPLE_SCENARIOS).length).toBe(5);
  });

  it("every applyAction outcome string in the engine has a label", () => {
    const src = readFileSync(join(ENGINE_DIR, "actions.ts"), "utf8") + readFileSync(join(ENGINE_DIR, "reconciliation.ts"), "utf8") + readFileSync(join(ENGINE_DIR, "chain.ts"), "utf8");
    const advanceStates = new Set(unionMembers("AdvanceState"));
    const outcomes = [...src.matchAll(/return "([a-z_]+)";/g)].map((m) => m[1]).filter((o) => !advanceStates.has(o));
    expect(outcomes.length).toBeGreaterThan(5);
    for (const o of [...outcomes, ...unionMembers("ProcessingOutcome"), "idempotent_replay"]) expect(HUMAN_LABELS.actionOutcome[o], o).toMatch(/\S/);
  });

  it("every error code (engine and v1 API) and resolution code has a label", () => {
    for (const c of unionMembers("EngineErrorCode")) expect(describeError({ code: c, message: "x" }).headline).not.toBe("Something went wrong.");
    for (const c of ["unauthenticated", "unknown_endpoint", "invalid_json", "invalid_request"]) expect(describeError({ code: c, message: "x" }).headline).not.toBe("Something went wrong.");
    const exSrc = readFileSync(join(ENGINE_DIR, "exceptions.ts"), "utf8");
    for (const m of exSrc.matchAll(/deny\("([A-Z_]+)"/g)) expect(HUMAN_LABELS.resolutionCode[m[1]], m[1]).toMatch(/\S/);
  });

  it('describeError: closing a payment whose missing_statement exception is open → "Payment cannot be closed. Settlement evidence is still missing."', () => {
    let { ws, id } = completedPayout();
    // let the statement window pass so the engine raises missing_statement
    ws = run(ws, "usr_maya", { type: "advance_clock", to: new Date(Date.parse(ws.asOf) + 10 * 86_400_000).toISOString() }).workspace;
    const miss = listExceptions(ws, { intentId: id, category: "missing_statement" })[0];
    expect(miss).toBeDefined();
    const caseId = intent(ws, id).caseId!;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_maya" }).workspace;
    const r = attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "close" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const h = describeError(r.error, ws);
    expect(h.reasonCode).toBe("OPEN_EXCEPTIONS");
    expect(h.headline).toBe("Payment cannot be closed.");
    expect(h.text.startsWith("Payment cannot be closed. Settlement evidence is still missing.")).toBe(true);
    // without the workspace, still readable
    expect(describeError(r.error).text).toBe("Payment cannot be closed. Linked exceptions are still open.");
    // exception refusal
    const e = attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: miss.id }, note: "x" });
    if (!e.ok) expect(describeError(e.error, ws).headline).toMatch(/cannot be resolved|Assign an owner/);
  });

  it("describeError: ordinary errors read as sentences and keep the field", () => {
    const h = describeError({ code: "maker_checker_violation", message: "The maker cannot approve their own instruction." });
    expect(h.text).toBe("The same person cannot prepare and approve. The maker cannot approve their own instruction.");
    expect(describeError({ code: "invalid_field", message: "must be a string", field: "line.reference" }).detail).toBe('Check "line.reference": must be a string');
    expect(describeError({ code: "weird" as never, message: "" }).text).toBe("Something went wrong.");
  });

  it("CODE_LABELS values are short, non-empty and contain no raw snake_case tokens", () => {
    for (const [k, v] of Object.entries(CODE_LABELS)) {
      expect(v, k).toMatch(/\S/);
      expect(v.length, k).toBeLessThan(110);
      expect(v, k).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
    const states: ExecutionState[] = Object.keys(HUMAN_LABELS.execution) as ExecutionState[];
    for (const s of states) expect(HUMAN_LABELS.execution[s]).not.toMatch(/_/);
  });
});

describe("CHANGE 5 R4: streamed body limit in the v1 test API", () => {
  const CHUNK = 64 * 1024;
  /** An endless chunked body that counts how many bytes were actually pulled. */
  function endless() {
    const counter = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        counter.pulled += CHUNK;
        c.enqueue(new Uint8Array(CHUNK).fill(0x20));
      },
      cancel() {
        counter.cancelled = true;
      },
    });
    return { stream, counter };
  }
  it("R4: readBodyLimited stops at the limit and cancels the stream", async () => {
    const { readBodyLimited } = await import("@/lib/clearline/bodylimit");
    const { stream, counter } = endless();
    const r = await readBodyLimited(stream, 512 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
    expect(counter.cancelled).toBe(true);
    expect(counter.pulled).toBeLessThanOrEqual(512 * 1024 + 2 * CHUNK);
    const small = new Blob(['{"a":"é"}']).stream();
    expect(await readBodyLimited(small, 512 * 1024)).toEqual({ ok: true, text: '{"a":"é"}', bytes: 10 });
    expect(await readBodyLimited(null, 10)).toEqual({ ok: true, text: "", bytes: 0 });
  });
  it("R4: the route refuses an endless chunked body (no Content-Length) after reading at most ~512 KB", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/clearline/test/v1/[...path]/route");
    const { stream, counter } = endless();
    const req = new NextRequest("http://x/api/clearline/test/v1/liquidity", {
      method: "POST",
      headers: { authorization: "Bearer cl_test_demo", "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as unknown as ConstructorParameters<typeof NextRequest>[1]);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req, { params: Promise.resolve({ path: ["liquidity"] }) });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_json");
    expect(counter.pulled).toBeLessThanOrEqual(512 * 1024 + 4 * CHUNK);
  });
  it("R4: a multi-byte body just under 512 KB is still accepted (bytes, not characters)", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/clearline/test/v1/[...path]/route");
    const mk = (pad: string) => POST(new NextRequest("http://x/api/clearline/test/v1/liquidity", { method: "POST", headers: { authorization: "Bearer cl_test_demo", "content-type": "application/json" }, body: JSON.stringify({ pad }) }), { params: Promise.resolve({ path: ["liquidity"] }) });
    expect((await mk("é".repeat(200_000))).status).toBe(200); // 400,000 bytes
    expect((await mk("é".repeat(270_000))).status).toBe(422); // 540,000 bytes > 512 KB
  });
});

describe("CHANGE 5 m5: supplier_paid carries its evidence basis", () => {
  it("m5: every funding row states whether 'supplier paid' is provider-reported or verified", async () => {
    const { fundingProjection, scenarioIntentId } = await import("@/lib/clearline");
    const ws = sampleWorkspace();
    const rows = fundingProjection(ws).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const s = intent(ws, r.intentId).status;
      expect(r.supplierPaidBasis).toBe(s.settlement === "verified" ? "verified_settlement" : s.execution === "provider_reported_completed" ? "provider_reported" : "none");
      if (r.state === "supplier_paid") expect(r.supplierPaidBasis).not.toBe("none");
    }
    expect(HUMAN_LABELS.advanceState.supplier_paid).toBe("Supplier paid (provider-reported)");
    // a provider "completed" claim alone → provider_reported; a verifying bank line → verified_settlement
    const id = scenarioIntentId(ws, "s5_funding")!;
    const row = rows.find((r) => r.intentId === id)!;
    expect(["provider_reported", "verified_settlement"]).toContain(row.supplierPaidBasis);
  });
});
