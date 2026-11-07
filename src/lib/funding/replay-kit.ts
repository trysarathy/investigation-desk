import { createHash } from "node:crypto";
import { parseCsv } from "../csv/parse";
import { csvCell } from "../csv/cell";
import { emptyFunding, instant, type ImportKind } from "./model";
import { importCsv, columns, validateRow } from "./imports";
import { applyFundingEvent, reviewAdvance } from "./review";
import { fundingLedger } from "./ledger";

export interface ReplayCase {
  id: string; title: string; advance_id: string;
  review_at: string; reconcile_at: string;
  historical_decision: "approve" | "decline" | "not_recorded";
  historical_reason: string; observed_outcome: string;
  inputs: Partial<Record<ImportKind, string>>;
}
export interface ReplayManifest { version: 1; synthetic: boolean; cases: ReplayCase[] }
const order: ImportKind[] = ["customers", "advances", "cash", "payouts", "receipts"];
export function validateManifest(m: ReplayManifest): ReplayManifest {
  if (m?.version !== 1 || typeof m.synthetic !== "boolean" ||
      !Array.isArray(m.cases) || m.cases.length < 1 || m.cases.length > 5)
    throw Error("Use a version 1 replay manifest with one to five cases.");
  const ids = new Set<string>();
  for (const c of m.cases) {
    for (const value of [c.id, c.title, c.advance_id, c.historical_reason, c.observed_outcome])
      if (typeof value !== "string" || !value.trim() || value.length > 500)
        throw Error("Case fields must contain short plain text.");
    if (ids.has(c.id)) throw Error("Case IDs must be unique.");
    ids.add(c.id);
    instant(c.review_at); instant(c.reconcile_at);
    if (instant(c.reconcile_at) < instant(c.review_at))
      throw Error("Reconciliation must not precede the decision.");
    if (!["approve", "decline", "not_recorded"].includes(c.historical_decision))
      throw Error("Choose approve, decline or not_recorded.");
    if (!c.inputs?.customers || !c.inputs.advances || !c.inputs.cash)
      throw Error("Every case needs customer, advance and cash evidence.");
    for (const [kind, file] of Object.entries(c.inputs))
      if (!order.includes(kind as ImportKind) ||
          typeof file !== "string" || !/^[a-zA-Z0-9._/-]+\.csv$/.test(file) ||
          file.startsWith("/") || file.includes("//") || file.split("/").filter((x) => x === "..").length > 1)
        throw Error("Use relative CSV paths inside the case folder.");
  }
  return m;
}
function partition(kind: ImportKind, raw: string, asOf: string) {
  const parsed = parseCsv(raw);
  if (parsed.fileErrors.length || parsed.recordErrors.length ||
      parsed.header.length !== columns[kind].length ||
      columns[kind].some((field) => !parsed.header.includes(field)))
    throw Error(kind + ": expected a valid canonical CSV file.");
  const past: string[][] = [], future: string[][] = [];
  for (const row of parsed.records) {
    if (row.cells.length !== parsed.header.length)
      throw Error(kind + ": wrong column count on row " + row.line);
    const fields = Object.fromEntries(parsed.header.map((key, i) => [key, row.cells[i]]));
    try { validateRow(kind, fields); }
    catch (e) { throw Error(kind + ": row " + row.line + ": " + String(e)); }
    const cutoff = Math.max(instant(fields.known_at), instant(fields.effective_at));
    (cutoff <= instant(asOf) ? past : future).push(row.cells);
  }
  const format = (rows: string[][]) => rows.length
    ? [parsed.header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
    : undefined;
  return { past: format(past), future: format(future) };
}
const roster = [
  { id: "maker", name: "Simulated maker", role: "operator" as const },
  { id: "checker", name: "Simulated treasury", role: "approver" as const },
];
export function replayCase(c: ReplayCase, raw: Partial<Record<ImportKind, string>>) {
  let data = emptyFunding();
  const future: Partial<Record<ImportKind, string>> = {};
  const hashes: Record<string, string> = {};
  for (const kind of order) {
    if (raw[kind] === undefined) continue;
    hashes[kind] = createHash("sha256").update(raw[kind]).digest("hex");
    const split = partition(kind, raw[kind], c.review_at);
    if (split.past)
      data = importCsv(data, kind, split.past, undefined, c.id + "-" + kind + ".csv", c.review_at);
    future[kind] = split.future;
  }
  if (!data.advances.some((a) => a.id === c.advance_id))
    throw Error(c.id + ": the advance was not known at the original review time.");
  const checks = reviewAdvance(data, c.advance_id, c.review_at).checks;
  const action = (type: "users" | "prepare" | "approve" | "decline", actor: string) => {
    data = applyFundingEvent(data, {
      action: type, actor_id: actor,
      advance_id: type === "users" ? "" : c.advance_id, at: c.review_at,
      reason: "Simulation only: " + c.historical_reason,
      users: type === "users" ? roster : [], import_count: data.imports.length,
      base_revision: data.revision,
    });
  };
  action("users", "maker"); action("prepare", "maker");
  let treatment = "Treasury decision not recorded in supplied history.";
  if (c.historical_decision === "decline") {
    action("decline", "checker");
    treatment = "Historical decline represented by fictional replay actors.";
  }
  if (c.historical_decision === "approve") {
    if (checks.every((check) => check.status === "pass")) {
      action("approve", "checker");
      treatment = "Historical approval represented by fictional replay actors.";
    } else treatment = "Reported approval fails cutoff checks; not replayed as valid approval.";
  }
  for (const kind of order) if (future[kind]) {
    const rawFuture = partition(kind, future[kind], c.reconcile_at).past;
    if (rawFuture)
      data = importCsv(data, kind, rawFuture, undefined, c.id + "-later-" + kind + ".csv", c.reconcile_at);
  }
  const dates = new Set([c.review_at, c.reconcile_at]);
  for (const advance of data.advances) dates.add(advance.due_at);
  for (const kind of ["payouts", "receipts"] as const)
    for (const record of data[kind]) dates.add(record.known_at);
  const first = new Map<string, { code: string; at: string; reason: string }>();
  for (const at of [...dates].filter((v) => instant(v) >= instant(c.review_at) &&
      instant(v) <= instant(c.reconcile_at)).sort()) {
    for (const e of fundingLedger(data, at).exceptions)
      if (!first.has(e.code)) first.set(e.code, { code: e.code, at, reason: e.reason });
  }
  const snapshot = fundingLedger(data, c.reconcile_at);
  const row = snapshot.rows.find((r) => r.advance_id === c.advance_id)!;
  return { id: c.id, title: c.title, review_at: c.review_at,
    reconcile_at: c.reconcile_at, historical_decision: c.historical_decision,
    treatment, observed_outcome: c.observed_outcome, checks,
    first_flags: [...first.values()], currency: row.currency, paid: row.paid,
    repaid: row.repaid, outstanding: row.outstanding, state: row.state,
    source_hashes: hashes };
}
export function replayReport(results: ReturnType<typeof replayCase>[], synthetic: boolean) {
  const lines = ["# Clearline Funding Desk — five-case replay", "",
    synthetic ? "**Synthetic cases only. No funds move.**" :
      "**Redacted provider cases; reported outcomes are not independently verified.**",
    "", "Checks support a human decision. Replay actors are fictional, not authenticated historical approvers.",
    "No savings, financial returns or adoption claims are established."];
  for (const r of results) {
    lines.push("", "## " + r.title, "", "Original review: " + r.review_at,
      "Later checkpoint: " + r.reconcile_at,
      "Historically reported decision: " + r.historical_decision,
      "Replay treatment: " + r.treatment, "", "Checks at the original cutoff:");
    for (const check of r.checks)
      lines.push("- " + check.code + ": " + check.status + " — " + check.reason);
    lines.push("", "Exceptions first visible:");
    if (!r.first_flags.length) lines.push("- No exceptions in supplied records.");
    for (const e of r.first_flags)
      lines.push("- " + e.at + " — " + e.code + ": " + e.reason);
    lines.push("", "At the later checkpoint: paid " + r.currency + " " + r.paid +
      ", repaid " + r.currency + " " + r.repaid +
      ", still owed " + r.currency + " " + r.outstanding + " (" + r.state + ").",
      "Observed outcome (case owner report): " + r.observed_outcome);
  }
  return lines.join("\n") + "\n";
}
