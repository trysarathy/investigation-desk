/**
 * rc3 feature (b): deterministic synthetic case report — buildCaseReport + caseReportToJson / caseReportToCsv.
 */
import { describe, expect, it } from "vitest";
import {
  CASE_REPORT_CSV_COLUMNS, CASE_REPORT_MARKING, SAMPLE_SCENARIOS, buildCaseReport, caseReportToCsv, caseReportToJson, sampleWorkspace,
  scenarioIntentId, serializeWorkspace, type SampleScenario, type SyntheticCaseReport, type Workspace,
} from "@/lib/clearline";
import { debitLine, errorCode, intent, run, sim } from "./helpers";

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
    expect(s2.amounts.returnPosition).toMatchObject({ code: "RT_DEBIT_NOT_ON_STATEMENT", beneficiaryPaid: false, netMovementZero: false, returnCredited: { value: "12784.90", currency: "USD" } });
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
