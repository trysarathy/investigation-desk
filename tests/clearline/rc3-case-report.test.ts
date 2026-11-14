/**
 * rc3 feature (b): deterministic synthetic case report — buildCaseReport + caseReportToJson / caseReportToCsv.
 */
import { describe, expect, it } from "vitest";
import {
  CASE_REPORT_CSV_COLUMNS, CASE_REPORT_MARKING, HUMAN_LABELS, SAMPLE_SCENARIOS, buildCaseReport, caseReportToCsv, caseReportToJson, sampleWorkspace,
  scenarioIntentId, serializeWorkspace, type SampleScenario, type SyntheticCaseReport, type Workspace,
} from "@/lib/clearline";
import { created, debitLine, errorCode, intent, run, signedDelivery, sim, submitted } from "./helpers";

const SCENARIOS = Object.keys(SAMPLE_SCENARIOS) as SampleScenario[];
const report = (ws: Workspace, ref: Parameters<typeof buildCaseReport>[1]): SyntheticCaseReport => {
  const r = buildCaseReport(ws, ref);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** Minimal RFC 4180 parser (quoted cells, doubled quotes, CRLF rows). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Every {value, currency} object anywhere in the report. */
function amountsIn(v: unknown, out: { value: unknown; currency: unknown }[] = []) {
  if (Array.isArray(v)) v.forEach((x) => amountsIn(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("value" in o && "currency" in o && Object.keys(o).length === 2) out.push(o as { value: unknown; currency: unknown });
    else Object.values(o).forEach((x) => amountsIn(x, out));
  }
  return out;
}

describe("buildCaseReport: structure, determinism, marking", () => {
  const ws = sampleWorkspace();

  for (const sc of SCENARIOS)
    it(`${sc}: payment id and case id give the same deterministic report; JSON and CSV are byte-stable and the input is unchanged`, () => {
      const id = scenarioIntentId(ws, sc)!;
      const snapshot = serializeWorkspace(ws);
      const a = report(ws, id);
      const b = report(sampleWorkspace(), { paymentId: id });
      expect(caseReportToJson(a)).toBe(caseReportToJson(b));
      expect(caseReportToCsv(a)).toBe(caseReportToCsv(b));
      const caseId = intent(ws, id).caseId;
      if (caseId) expect(caseReportToJson(report(ws, { caseId }))).toBe(caseReportToJson(a));
      expect(serializeWorkspace(ws)).toBe(snapshot);
      expect(a).toMatchObject({ reportVersion: 1, marking: CASE_REPORT_MARKING, fictional: true, sandbox: true, generatedAt: ws.asOf, subject: { paymentId: id, scenario: sc } });
      expect(a.marking).toMatch(/FICTIONAL/);
      expect(a.disclaimer).toMatch(/TEST MODE/);
    });

  it("every amount is an exact decimal string with the currency's decimals (USDC 6), never a number", () => {
    for (const sc of SCENARIOS) {
      const r = report(ws, scenarioIntentId(ws, sc)!);
      const amounts = amountsIn(r);
      expect(amounts.length).toBeGreaterThan(2);
      for (const x of amounts) {
        expect(typeof x.value).toBe("string");
        expect(x.value).toMatch(x.currency === "USDC" ? /^-?\d+\.\d{6}$/ : /^-?\d+\.\d{2}$/);
      }
    }
    const s4 = report(ws, scenarioIntentId(ws, "s4_chain")!);
    expect(s4.summary.requested).toEqual({ value: "6427.830000", currency: "USDC" });
    const s5 = report(ws, scenarioIntentId(ws, "s5_funding")!);
    expect(s5.amounts.funding).toMatchObject({ principal: { value: "50000.00", currency: "SGD" }, repaid: { value: "30000.00", currency: "SGD" }, outstanding: { value: "20000.00", currency: "SGD" }, reference: "RPY-SEABRIGHT-0001" });
  });

  it("the three truths are reported separately, with their basis", () => {
    const s1 = report(ws, scenarioIntentId(ws, "s1_success")!);
    expect(s1.threeTruths.execution).toMatchObject({ state: "provider_reported_completed", label: "Provider reports completed", basis: "provider_claim", lastProviderEvent: "payout.completed" });
    expect(s1.threeTruths.settlement).toMatchObject({ state: "verified", scope: "bank_statement", independent: true });
    expect(s1.threeTruths.reconciliation).toMatchObject({ state: "matched", matched: { value: "24651.37", currency: "SGD" }, unreconciled: { value: "0.00", currency: "SGD" } });
    expect(s1.summary.headline).toBe("Provider reports completed · Settlement verified (Bank statement) · Matched");
    const s4 = report(ws, scenarioIntentId(ws, "s4_chain")!);
    expect(s4.threeTruths.settlement).toMatchObject({ state: "pending_finality", scope: "onchain_transfer", independent: true });
    expect(s4.threeTruths.reconciliation.state).not.toBe("matched");
  });

  it("the timeline lists every entry with its source and provenance, in time order", () => {
    for (const sc of SCENARIOS) {
      const r = report(ws, scenarioIntentId(ws, sc)!);
      expect(r.timeline.length).toBeGreaterThan(3);
      for (const e of r.timeline) {
        expect(e.source.length).toBeGreaterThan(0);
        expect(e.provenance.length).toBeGreaterThan(0);
        expect(typeof e.independent).toBe("boolean");
      }
      const at = r.timeline.map((e) => Date.parse(e.at));
      expect(at).toEqual([...at].sort((x, y) => x - y));
    }
    const s1 = report(ws, scenarioIntentId(ws, "s1_success")!);
    expect(s1.timeline.some((e) => e.kind === "statement_line" && e.independent && e.provenance === "bank_statement")).toBe(true);
    expect(s1.timeline.filter((e) => e.kind === "provider_event").every((e) => !e.independent)).toBe(true);
  });

  it("findings: returned payout states net movement and beneficiary unpaid; the hold names its reviewer; funding outstanding is an amount", () => {
    const s2 = report(ws, scenarioIntentId(ws, "s2_returned")!);
    // rc3 follow-up: the s2 sample now has the outgoing debit and the equal return credit on the statement.
    expect(s2.amounts.returnPosition).toMatchObject({ code: "RT_NET_ZERO", beneficiaryPaid: false, netMovementZero: true, debited: { value: "12784.90", currency: "USD" }, returnCredited: { value: "12784.90", currency: "USD" }, netMovement: { value: "0.00", currency: "USD" } });
    expect(s2.threeTruths.settlement).toMatchObject({ state: "contradicted", scope: "bank_statement" });
    expect(s2.findings.find((f) => f.code === "OS_RETURN_RECEIVED_SUPPLIER_UNPAID")).toMatchObject({ section: "outstanding", amount: { value: "12784.90", currency: "USD" } });
    const s3 = report(ws, scenarioIntentId(ws, "s3_hold")!);
    expect(s3.summary.whoActs).toMatchObject({ code: "WA_COMPLIANCE_REVIEWER" });
    const s5 = report(ws, scenarioIntentId(ws, "s5_funding")!);
    expect(s5.findings.find((f) => f.code === "OS_ADVANCE_OUTSTANDING")!.amount).toEqual({ value: "20000.00", currency: "SGD" });
    expect(s5.findings.find((f) => f.code === "OS_UNALLOCATED_RECEIPT")!.amount).toEqual({ value: "20000.00", currency: "SGD" });
  });

  it("contradictions and differences appear in findings and amounts", () => {
    let w = sampleWorkspace();
    const id = scenarioIntentId(w, "s1_success")!;
    w = sim(w, id, "contradictory").workspace;
    const ppid = w.instructions.find((x) => x.id === intent(w, id).instructionId)!.providerPaymentId!;
    w = run(w, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, amountMinor: 1_000_000, valueDate: "2026-11-12" }) }).workspace;
    const r = report(w, id);
    expect(r.findings.filter((f) => f.section === "contradiction").map((f) => f.code)).toEqual(expect.arrayContaining(["EV_IMPOSSIBLE_TRANSITION", "RC_UNDER_AMOUNT_REPORT"]));
    expect(r.amounts.differences).toContainEqual(expect.objectContaining({ code: "RC_UNDER_AMOUNT_REPORT", outstanding: true, expected: { value: "24651.37", currency: "SGD" }, reported: { value: "10000.00", currency: "SGD" }, difference: { value: "14651.37", currency: "SGD" } }));
  });

  it("errors: unknown id → not_found; empty ref → invalid_field", () => {
    expect(errorCode(buildCaseReport(ws, "pi_nope") as never)).toBe("not_found");
    expect(errorCode(buildCaseReport(ws, { caseId: scenarioIntentId(ws, "s1_success")! }) as never)).toBe("not_found");
    expect(errorCode(buildCaseReport(ws, "") as never)).toBe("invalid_field");
  });
});

describe("caseReportToJson / caseReportToCsv", () => {
  const ws = sampleWorkspace();

  it("JSON: sorted keys, parses back to the same report", () => {
    const r = report(ws, scenarioIntentId(ws, "s5_funding")!);
    const json = caseReportToJson(r);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(r)));
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([...keys].sort());
  });

  it("CSV: header, FICTIONAL marking row first, fixed column count, every section present, amounts as decimal strings", () => {
    for (const sc of SCENARIOS) {
      const csv = caseReportToCsv(report(ws, scenarioIntentId(ws, sc)!));
      expect(csv.endsWith("\r\n")).toBe(true);
      const rows = parseCsv(csv);
      expect(rows[0]).toEqual([...CASE_REPORT_CSV_COLUMNS]);
      expect(rows[1].slice(0, 3)).toEqual(["marking", "FICTIONAL_SANDBOX", "FICTIONAL / SANDBOX"]);
      for (const row of rows) expect(row).toHaveLength(CASE_REPORT_CSV_COLUMNS.length);
      const sections = new Set(rows.slice(1).map((r) => r[0]));
      for (const s of ["summary", "truth_execution", "truth_settlement", "truth_reconciliation", "timeline", "amount", "disclaimer"]) expect(sections.has(s)).toBe(true);
      for (const row of rows.slice(1)) if (row[6]) expect(row[6]).toMatch(/^-?\d+\.\d+$/);
    }
  });

  it("CSV never lets person-entered text become a spreadsheet formula or a new row", () => {
    let w = sampleWorkspace();
    const id = scenarioIntentId(w, "s2_returned")!;
    const caseId = intent(w, id).caseId!;
    const payload = "=cmd|' /C calc'!A0\r\n+SUM(A1) -1 @x";
    w = run(w, "usr_maya", { type: "attach_evidence", target: { kind: "case", id: caseId }, evidence: { kind: "document_metadata", description: payload } }).workspace;
    const r = report(w, id);
    expect(r.timeline.some((e) => e.title === payload)).toBe(true); // the payload reaches a cell start
    const rows = parseCsv(caseReportToCsv(r));
    expect(rows.some((row) => row.some((c) => c.startsWith("'=cmd")))).toBe(true);
    for (const row of rows) {
      expect(row).toHaveLength(CASE_REPORT_CSV_COLUMNS.length);
      for (const [i, c] of row.entries()) if (i !== 6) expect(c).not.toMatch(/^[=+\-@\t\r]/);
      for (const c of row) expect(c).not.toMatch(/[\r\n]/);
    }
  });
});

describe("review B-1: 'matched' comes from allocations, never from requested − outstanding (JSON and CSV)", () => {
  const csvAmount = (csv: string, section: string, code: string) => parseCsv(csv).find((r) => r[0] === section && r[1] === code)!.slice(6, 8);
  const check = (ws: Workspace, id: string, matched: string, unreconciled: string, currency = "SGD") => {
    const r = report(ws, id);
    expect(r.amounts.matched).toEqual({ value: matched, currency });
    expect(r.threeTruths.reconciliation.matched).toEqual({ value: matched, currency });
    expect(r.amounts.unreconciled).toEqual({ value: unreconciled, currency });
    const csv = caseReportToCsv(r);
    expect(csvAmount(csv, "amount", "MATCHED")).toEqual([matched, currency]);
    expect(csvAmount(csv, "amount", "UNRECONCILED")).toEqual([unreconciled, currency]);
    expect(parseCsv(csv).find((x) => x[0] === "truth_reconciliation")!.slice(6, 8)).toEqual([matched, currency]);
    return r;
  };
  const failed = (withDebit: boolean) => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 });
    ws = sim(ws, id).workspace;
    if (withDebit) ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E8`, type: "payout.failed", provider_payment_id: ppid, sequence: 8, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    return { ws, id };
  };

  it("created only (never sent): matched 0.00, nothing unreconciled", () => {
    const c = created({ amountMinor: 1_000_000 });
    check(c.ws, c.id, "0.00", "0.00"); // before the fix: matched 10000.00
  });
  it("failed with no evidence: matched 0.00", () => {
    const f = failed(false);
    expect(intent(f.ws, f.id).status).toMatchObject({ execution: "failed", settlement: "none" });
    check(f.ws, f.id, "0.00", "0.00"); // before the fix: matched 10000.00
  });
  it("failed after a matched debit: matched is the debit actually allocated (the money did leave), with the contradiction shown", () => {
    const f = failed(true);
    const r = check(f.ws, f.id, "10000.00", "0.00");
    expect(r.threeTruths.settlement.state).toBe("contradicted");
    expect(r.findings.some((x) => x.section === "contradiction" && x.code === "RC_DEBIT_FOR_FAILED_PAYOUT")).toBe(true);
  });
  it("s3 on hold (sent, no evidence): matched 0.00, the whole amount unreconciled; rejected (cancelled): matched 0.00, nothing unreconciled", () => {
    let ws = sampleWorkspace();
    const s3 = scenarioIntentId(ws, "s3_hold")!;
    check(ws, s3, "0.00", "8839.50");
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: ws.holds[0].id, documents: ["Supporting commercial invoice"] }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId: ws.holds[0].id, decision: "reject", reason: "Declined (fictional)" }).workspace;
    expect(intent(ws, s3).status.execution).toBe("cancelled");
    check(ws, s3, "0.00", "0.00"); // before the fix: matched 8839.50
  });
  it("partial bank line: matched 2500.00, unreconciled 7500.00; exact s1: 24651.37 / 0.00; returned s2: the debit 12784.90 / 0.00 (USD)", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 });
    ws = sim(sim(ws, id).workspace, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, amountMinor: 250_000 }) }).workspace;
    check(ws, id, "2500.00", "7500.00");
    const sample = sampleWorkspace();
    check(sample, scenarioIntentId(sample, "s1_success")!, "24651.37", "0.00");
    check(sample, scenarioIntentId(sample, "s2_returned")!, "12784.90", "0.00", "USD");
  });
});

describe("review m-5: the CSV formula guard covers a leading tab and a leading minus", () => {
  for (const payload of ["\t=1+1 tab-led", "-2+3 minus-led", "+SUM(A1) plus-led", "@x at-led"])
    it(`person text ${JSON.stringify(payload.slice(0, 5))} is prefixed with ' in every CSV cell`, () => {
      let w = sampleWorkspace();
      const id = scenarioIntentId(w, "s2_returned")!;
      w = run(w, "usr_maya", { type: "attach_evidence", target: { kind: "case", id: intent(w, id).caseId! }, evidence: { kind: "document_metadata", description: payload } }).workspace;
      const r = report(w, id);
      expect(r.timeline.some((e) => e.title === payload)).toBe(true);
      const cells = parseCsv(caseReportToCsv(r)).flatMap((row) => row.filter((_, i) => i !== 6));
      expect(cells).toContain("'" + payload);
      for (const c of cells) expect(c).not.toMatch(/^[=+\-@\t]/);
    });
});

// -------------------------------------------------------------------------------------------------
// Console final check: an accepted over-amount awaiting a second person's approval is not reported as "Resolved".
describe("case report: an acceptance awaiting a second approval", () => {
  /** A provider-completed SGD 10,000.00 payout with a bank debit of `lineMinor` naming it, the debit's exception accepted by usr_maya. */
  function accepted(lineMinor: number) {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: lineMinor, reference: `NORTHLINE PAYOUT ${ppid}` }) });
    ws = r.workspace;
    const excId = ws.exceptions.find((e) => e.statementLineId === r.createdIds[0])!.id;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: excId }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: excId }, evidence: { kind: "document_metadata", description: "Bank fee advice (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Bank fee accepted", acceptDifference: true }).workspace;
    return { ws, id, excId, caseId: intent(ws, id).caseId!, lineId: r.createdIds[0] };
  }
  const report = (ws: Parameters<typeof buildCaseReport>[0], caseId: string) => {
    const r = buildCaseReport(ws, caseId);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const csvRows = (csv: string, excId: string) => csv.split("\r\n").filter((l) => l.startsWith("exception") && l.includes(excId));

  it("above 1% and not yet approved: status accepted_awaiting_second_approval, labelled, naming the accepter and the pending approval (JSON and CSV)", () => {
    const a = accepted(1_050_000);
    expect(a.ws.exceptions.find((e) => e.id === a.excId)!.status).toBe("resolved"); // the engine's own status
    const r = report(a.ws, a.caseId);
    const e = r.exceptions.find((x) => x.id === a.excId)!;
    expect(e).toMatchObject({ status: "accepted_awaiting_second_approval", statusLabel: "Accepted — awaiting second approval", engineStatus: "resolved" });
    expect(e.acceptance).toMatchObject({ acceptedBy: "usr_maya", secondApproval: "pending", statementLineId: a.lineId, difference: { value: "500.00", currency: "SGD" } });
    expect(e.acceptance!.approvedBy).toBeUndefined();
    expect(e.acceptance!.text).toMatch(/Accepted by usr_maya .*second, different person's approval is still pending/);
    const json = JSON.parse(caseReportToJson(r));
    expect(json.exceptions.find((x: { id: string }) => x.id === a.excId)).toMatchObject({ status: "accepted_awaiting_second_approval", statusLabel: "Accepted — awaiting second approval", acceptance: { acceptedBy: "usr_maya", secondApproval: "pending" } });
    const rows = csvRows(caseReportToCsv(r), a.excId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/· Accepted — awaiting second approval/);
    expect(rows.join("\n")).not.toMatch(/Resolved|· resolved/);
    expect(rows[1]).toMatch(/^exception_acceptance,ACCEPTED_AWAITING_SECOND_APPROVAL,/);
    expect(rows[1].endsWith(`,${a.excId} ${a.lineId} usr_maya`)).toBe(true);
    expect(rows[1]).toMatch(/still pending/);
  });

  it("once a second person approves: Resolved, naming both people (JSON and CSV)", () => {
    const a = accepted(1_050_000);
    const ws = run(a.ws, "usr_sam", { type: "approve_acceptance", exceptionId: a.excId, note: "Checked the fee advice" }).workspace;
    const r = report(ws, a.caseId);
    const e = r.exceptions.find((x) => x.id === a.excId)!;
    expect(e).toMatchObject({ status: "resolved", statusLabel: "Resolved", engineStatus: "resolved" });
    expect(e.acceptance).toMatchObject({ acceptedBy: "usr_maya", secondApproval: "approved", approvedBy: "usr_sam", approvedAt: ws.asOf });
    expect(e.acceptance!.text).toBe("Accepted by usr_maya (the 500.00 SGD over-amount); approved by usr_sam.");
    const json = JSON.parse(caseReportToJson(r));
    expect(json.exceptions.find((x: { id: string }) => x.id === a.excId)).toMatchObject({ status: "resolved", acceptance: { acceptedBy: "usr_maya", approvedBy: "usr_sam", secondApproval: "approved" } });
    const rows = csvRows(caseReportToCsv(r), a.excId);
    expect(rows[0]).toMatch(/· Resolved,/);
    expect(rows[1]).toMatch(/^exception_acceptance,ACCEPTANCE_APPROVED,/);
    // the refs column names the exception, the line and both people
    expect(rows[1].endsWith(`,${a.excId} ${a.lineId} usr_maya usr_sam`)).toBe(true);
  });

  it("within 1%: Resolved with no second approval required; an exception without an acceptance carries none", () => {
    const a = accepted(1_005_000);
    const r = report(a.ws, a.caseId);
    const e = r.exceptions.find((x) => x.id === a.excId)!;
    expect(e).toMatchObject({ status: "resolved", statusLabel: "Resolved", acceptance: { acceptedBy: "usr_maya", secondApproval: "not_required" } });
    expect(csvRows(caseReportToCsv(r), a.excId)[1]).toMatch(/^exception_acceptance,ACCEPTANCE_NOT_REQUIRED,/);
    const ws = sampleWorkspace();
    for (const c of ws.cases) {
      const rr = buildCaseReport(ws, c.id);
      if (!rr.ok) continue;
      for (const x of rr.value.exceptions) {
        expect(x.acceptance).toBeUndefined();
        expect(x.status).toBe(x.engineStatus);
        expect(x.statusLabel).toBe(HUMAN_LABELS.exceptionStatus[x.engineStatus]);
      }
    }
  });

  it("after a reopen the acceptance is withdrawn: the report shows the reopened status and no acceptance", () => {
    const a = accepted(1_050_000);
    const ws = run(a.ws, "usr_daniel", { type: "reopen", target: { kind: "exception", id: a.excId }, reason: "Wrong advice" }).workspace;
    const e = report(ws, a.caseId).exceptions.find((x) => x.id === a.excId)!;
    expect(e.status).not.toBe("accepted_awaiting_second_approval");
    expect(e.status).toBe(e.engineStatus);
    expect(e.acceptance).toBeUndefined();
    // Defence in depth: even an object (never loaded) that still carries the acceptance on a non-resolved exception
    // reports no acceptance and its own status.
    const crafted = JSON.parse(JSON.stringify(a.ws)) as Workspace;
    crafted.exceptions.find((x) => x.id === a.excId)!.status = "in_review";
    const c = report(crafted, a.caseId).exceptions.find((x) => x.id === a.excId)!;
    expect(c).toMatchObject({ status: "in_review", statusLabel: "In review" });
    expect(c.acceptance).toBeUndefined();
  });
});
