/**
 * Regenerates marketing/lib/investigations.ts from the TESTED engine on the software branch.
 * The website's product view is rendered from this file, so it shows exactly what the console's
 * investigation page shows for the five fictional sample scenarios (s1–s5).
 *
 * Run (from a checkout of rc3/clearline-app at $ENGINE, with its node_modules):
 *   ENGINE=/path/to/clearline-app OUT=$PWD/lib/investigations.ts \
 *     npx --prefix "$ENGINE" vitest run --root "$PWD/scripts" --config scripts/engine-investigations.vitest.mjs
 * It changes nothing in the engine and writes only OUT.
 */
import { test } from "vitest";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
// Resolved through the alias in engine-investigations.vitest.mjs (ENGINE/src/lib/clearline).
import * as cl from "clearline-engine";

const L = cl.HUMAN_LABELS as unknown as Record<string, Record<string, string>>;
/** Console-only words (src/components/clearline/labels.tsx and pages/Investigation.tsx on rc3/clearline-app). */
const CONSOLE_SCOPE: Record<string, string> = { none: "no evidence yet", provider_report: "provider report only", bank_statement: "by bank statement", onchain_transfer: "by on-chain transfer (not a bank credit)" };
const CONSOLE_RAIL: Record<string, string> = { fiat_local: "Local fiat rail", fiat_correspondent: "Correspondent fiat rail", stablecoin_testnet: "Stablecoin (testnet)" };
const RETURN_STATUS: Record<string, string> = { provider_reported: "Return reported by provider", confirmed_by_statement: "Return confirmed by statement" };
const KEEP = new Set(["instruction_made", "instruction_checked", "provider_event", "statement_line", "allocation", "chain_observation", "hold_decision", "exception", "missing_evidence"]);
const sgt = (iso: string) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return d.toISOString().slice(11, 16) + " SGT"; };
const sgtDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
const actor = (ws: any, id?: string) => (id ? ws.actors.find((a: any) => a.id === id)?.name ?? id : "Unassigned");

test("generate", () => {
  const ws: any = cl.sampleWorkspace();
  const out: any[] = [];
  for (const scenario of Object.keys(cl.SAMPLE_SCENARIOS)) {
    const id = cl.intentForScenario(ws, scenario)!;
    const intent = ws.intents.find((i: any) => i.id === id);
    const res: any = cl.investigate(ws, id);
    if (!res.ok) throw new Error(scenario + ": " + res.error.message);
    const v = res.value;
    const quote = ws.quotes.find((q: any) => q.id === intent.selectedQuoteId);
    const timeline = cl.evidenceTimelineFor(ws, id).filter((e: any) => KEEP.has(e.kind)).map((e: any) => {
      let outcome = "Recorded", tone = "neutral", ref = "";
      if (e.kind === "provider_event") {
        const p = ws.providerEvents.find((x: any) => x.id === e.refs[0]);
        outcome = L.processingOutcome[p.processingOutcome]; tone = p.processingOutcome === "applied" || p.processingOutcome === "recorded_no_state_change" ? "neutral" : "danger";
        ref = p.normalizedType;
        return { time: sgt(e.at), kind: L.timelineKind[e.kind], event: L.eventType[p.normalizedType] ?? p.normalizedType, ref, source: e.source, independent: e.independent, outcome, tone, codes: e.codes };
      }
      if (e.kind === "statement_line") {
        const l = ws.statementLines.find((x: any) => x.id === e.refs[0]);
        outcome = L.statementLineStatus[l.status]; tone = l.status === "allocated" ? "success" : l.status === "exception" ? "danger" : "warning";
        return { time: sgt(e.at), kind: L.timelineKind[e.kind], event: `${L.statementSource[l.source]} ${l.direction} ${cl.formatMinor(l.amountMinor, l.currency)}`, ref: `${l.lineId} · ${l.reference || "no reference"}`, source: e.source, independent: e.independent, outcome, tone, codes: e.codes };
      }
      if (e.kind === "allocation") { outcome = "Allocated by trusted reference"; tone = "success"; }
      if (e.kind === "exception") { const x = ws.exceptions.find((y: any) => y.id === e.refs[0]); outcome = "Exception " + L.exceptionStatus[x.status].toLowerCase(); tone = x.status === "resolved" ? "neutral" : "danger";
        return { time: sgt(e.at), kind: L.timelineKind[e.kind], event: L.exceptionCategory[x.category], ref: x.category, source: e.source, independent: e.independent, outcome, tone, codes: e.codes }; }
      if (e.kind === "missing_evidence") { outcome = "Not yet received"; tone = "warning"; }
      if (e.kind === "chain_observation") { const o = ws.chainObservations.find((x: any) => x.id === e.refs[0]); outcome = L.chainObservationStatus[o.status]; tone = o.status === "final" ? "success" : "warning"; }
      if (e.kind === "instruction_made" || e.kind === "instruction_checked") { outcome = e.kind === "instruction_made" ? "Maker" : "Checker (different person)"; }
      return { time: e.kind === "missing_evidence" ? "Not yet received" : sgt(e.at), kind: L.timelineKind[e.kind], event: e.title, ref, source: e.source, independent: e.independent, outcome, tone, codes: e.codes };
    });
    out.push({
      scenario, intentId: id, reference: v.requested.internalReference, beneficiary: v.requested.beneficiaryName,
      amount: cl.formatMoney(v.requested.amount), destination: `${v.requested.destinationCountry} · ${v.requested.destinationCurrency}`,
      provider: v.provider ? `${v.provider.providerName} · ${CONSOLE_RAIL[v.provider.rail]}` : "No route chosen yet",
      recipientQuoted: quote?.eligible ? cl.formatMinor(quote.estimatedRecipientMinor, quote.destinationCurrency) : undefined,
      approval: v.approval ? `Maker ${actor(ws, v.approval.makerId)} · checker ${v.approval.checkerId ? actor(ws, v.approval.checkerId) : "not yet"}` : "Not prepared",
      status: v.status, returnStatus: intent.returnStatus, returnStatusText: intent.returnStatus ? RETURN_STATUS[intent.returnStatus] : undefined,
      summary: cl.describeStatus(v.status).summary, scopeText: CONSOLE_SCOPE[v.status.settlementScope],
      chain: v.chain ? `${v.chain.confirmations} of ${v.chain.finalityThreshold} confirmations on ${v.chain.network}; an on-chain transfer is not a bank credit.` : undefined,
      lastIndependent: v.lastIndependentVerificationAt ? sgtDate(v.lastIndependentVerificationAt) + " " + sgt(v.lastIndependentVerificationAt) : undefined,
      known: [...v.providerReported.findings, ...v.independentEvidence].map((f: any) => f.text),
      unknown: v.unknowns.map((f: any) => f.text), contradicts: v.contradictions.map((f: any) => f.text),
      outstanding: v.outstanding.map((o: any) => ({ amount: o.amount ? cl.formatMoney(o.amount) : undefined, text: o.text, code: o.code })),
      owner: { name: v.whoActs.ownerName ?? "Unassigned", role: v.whoActs.role, code: v.whoActs.code },
      nextActions: v.nextActions.map((f: any) => f.text),
      exceptions: v.exceptions.map((x: any) => ({ title: L.exceptionCategory[x.category], category: x.category, status: L.exceptionStatus[x.status], owner: actor(ws, x.ownerId), dueDate: x.dueDate, code: x.explanationCode })),
      timeline,
    });
  }
  const commit = execSync("git rev-parse --short HEAD", { cwd: process.env.ENGINE }).toString().trim();
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: process.env.ENGINE }).toString().trim();
  const src = `/* GENERATED by scripts/engine-investigations.gen.ts — do not edit by hand.
 * Source: the tested engine on ${branch} @ ${commit}: sampleWorkspace(), investigate(), evidenceTimelineFor(),
 * describeStatus() and HUMAN_LABELS, with the console's own scope, rail and return-status words
 * (src/components/clearline/labels.tsx, pages/Investigation.tsx). Times are the engine's simulated clock in SGT.
 * Every organisation, provider, person and amount is fictional. Nothing here is a customer record. */
import type { ExecState, ReconState, SettlementScope, SettlementState } from "@/components/Status";

export const ENGINE_SOURCE = ${JSON.stringify({ branch, commit })} as const;
export type Tone = "neutral" | "success" | "warning" | "danger";
export type TimelineEntry = { time: string; kind: string; event: string; ref: string; source: string; independent: boolean; outcome: string; tone: Tone; codes: string[] };
export type Investigation = {
  scenario: "s1_success" | "s2_returned" | "s3_hold" | "s4_chain" | "s5_funding"; intentId: string; reference: string; beneficiary: string;
  amount: string; destination: string; provider: string; recipientQuoted?: string; approval: string;
  status: { execution: ExecState; settlement: SettlementState; settlementScope: SettlementScope; reconciliation: ReconState };
  returnStatus?: "provider_reported" | "confirmed_by_statement"; returnStatusText?: string;
  summary: string; scopeText: string; chain?: string; lastIndependent?: string;
  known: string[]; unknown: string[]; contradicts: string[]; outstanding: { amount?: string; text: string; code: string }[];
  owner: { name: string; role: string; code: string }; nextActions: string[];
  exceptions: { title: string; category: string; status: string; owner: string; dueDate?: string; code: string }[];
  timeline: TimelineEntry[];
};
export const INVESTIGATIONS: Investigation[] = ${JSON.stringify(out, null, 2)};
`;
  writeFileSync(process.env.OUT!, src);
});
