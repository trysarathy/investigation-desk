/**
 * Phase 0.5: why a payment did not auto-match. Pure: reads only a match record's own explanation (deciding rule,
 * history, attention) and names the rule plus the specific condition that failed, in plain words with no order IDs,
 * amounts or addresses, so reasons can be counted. Used by scripts/blind/breakdown.ts. Synthetic data only.
 */
import type { MatchRecord } from "../../src/lib/clearline/merchant";

export interface BlockingReason { ruleId: string; condition: string }

const CLOSING = new Set(["matched", "matched_with_difference"]);
export const isAutoMatched = (r: Pick<MatchRecord, "explanation">): boolean => CLOSING.has(r.explanation.decision);

/** The first condition of rc8 decision 1 (M4.exact.no_quote_terms) that failed, from its history note. */
function decisionOneBlocker(detail: string): string {
  const d = detail.replace(/^Not closed without quote terms: /, "").replace(/\.$/, "");
  if (/transfers reached this order's addresses/.test(d)) {
    const m = /^(\d+) transfers reached this order's addresses \((\d+) final\)/.exec(d);
    if (m && m[1] === "1" && m[2] === "0") return "not final: the one transfer is still pending";
    return m && Number(m[1]) > 1 ? "more than one transfer reached the order's addresses; exactly one final transfer is needed" : d;
  }
  if (/provider records name this order/.test(d)) return "not exactly one provider record names the order (re-quote or several records)";
  if (/no provider record names this transfer/.test(d)) return "no provider record names the transfer";
  if (/not linked to this transfer by the order's own reference/.test(d)) return "provider record not linked to the transfer by the order's own reference";
  if (/not a fact Clearline read from the chain/.test(d)) return "transfer not read by Clearline's own chain client";
  if (/not a final inbound transfer on the configured contract/.test(d)) return "not a final inbound transfer on the configured contract";
  const st = /the provider's status is (\w+), not paid/.exec(d);
  if (st) return `provider status "${st[1]}", not "paid"`;
  if (/balance payment link/.test(d)) return "part payment (a balance payment link)";
  if (/a refund is recorded/.test(d)) return "a refund is recorded for the order";
  if (/invoice is void/.test(d)) return "the invoice is void";
  if (/credited currency/.test(d)) return "credited currency not given or not the invoice's";
  const ex = /^credited (.+) is not exactly the invoice (.+)$/.exec(d);
  if (ex) return "credit is not exactly the invoice (any difference, no quote terms to type it)";
  return d;
}

/** Strips IDs and amounts from a free-text reason so it can be counted. */
const generic = (s: string): string => s.replace(/\b(0x)?[A-Za-z0-9]{20,}\b/g, "<address>").replace(/\b[A-Z]{1,6}-[A-Z0-9-]+\b/g, "<id>").replace(/[0-9][0-9,]*(\.[0-9]+)?/g, "<n>").replace(/\s+/g, " ").trim();

/** Rule ID and the specific failed condition for a payment that did not auto-match (undefined when it did). */
export function blockingReason(r: Pick<MatchRecord, "explanation" | "attention" | "bank">): BlockingReason | undefined {
  if (isAutoMatched(r)) return undefined;
  const e = r.explanation;
  const rule = e.ruleId;
  const step4 = e.history.find((h) => h.ruleId === "M4.exact.no_quote_terms");
  const closedAt4 = step4?.outcome === "pass";
  const tag = closedAt4 ? " (exact by reference at step 4: decision 1 passed)" : "";
  switch (rule) {
    case "M3.quote.terms_unknown":
      return { ruleId: rule, condition: `quote terms unknown; decision 1 failed: ${step4 ? decisionOneBlocker(step4.detail) : "not evaluated"}` };
    case "M5.grouping.proposed_needs_confirmation":
      return { ruleId: rule, condition: `batch totals only, no payment linked to a batch: the grouping is only proposed${tag}` };
    case "M5.bank.imported_not_verified":
      return { ruleId: rule, condition: `batch ties, but its bank line is imported, not bank-authenticated (flag off)${tag}` };
    case "M5.batch.not_tied": {
      const failed = /\(([^)]*)\)\.?$/.exec(r.attention?.reason ?? "")?.[1] ?? "unknown check";
      return { ruleId: rule, condition: `the batch does not tie to the cent (failed: ${failed})${tag}` };
    }
    case "M1.finality.pending": return { ruleId: rule, condition: "not final: fewer confirmations than the network's finality rule" };
    case "M1.identity.lookalike_token": return { ruleId: rule, condition: "look-alike token: the symbol of a configured token on another contract" };
    case "M1.identity.unknown_token": return { ruleId: rule, condition: "the (network, contract) pair is not a configured token" };
    case "M1.identity.network_disabled": return { ruleId: rule, condition: "the transfer is on a network that is not enabled" };
    case "M1.chain.unavailable": return { ruleId: rule, condition: "chain data could not be read" };
    case "M3.batch.held_by_provider": return { ruleId: rule, condition: "shown as completed, held for review by the provider, in no settlement" };
    case "M3.batch.unknown_batch": return { ruleId: rule, condition: "the provider names a settlement batch that is not in the settlement report" };
    case "M2.reference.no_chain_transfer": return { ruleId: rule, condition: "no chain transfer reached the order's deposit address" };
    case "M2.reference.provider_ref_mismatch": return { ruleId: rule, condition: "provider record names another quote or link than the deposit address" };
    case "M4.tolerance.unexplained": {
      const credit = e.differences.some((d) => d.ruleId === "M4.provider.credit_mismatch");
      return { ruleId: rule, condition: credit ? "provider credit is not received × executed rate (unexplained difference)" : "difference with no typed explanation" };
    }
    default:
      return { ruleId: rule, condition: generic(r.attention?.reason ?? e.history.at(-1)?.detail ?? "no reason recorded") };
  }
}

export interface Breakdown {
  payments: number;
  decisions: Record<string, number>;
  /** `${ruleId} | ${condition}` → count, for every payment that did not auto-match. */
  reasons: Record<string, number>;
  /** Of the payments that did not auto-match: those decision 1 had closed at step 4 and step 5 reopened. */
  reopenedAtStep5: number;
}

export function breakdownOf(records: readonly Pick<MatchRecord, "explanation" | "attention" | "bank">[]): Breakdown {
  const b: Breakdown = { payments: 0, decisions: {}, reasons: {}, reopenedAtStep5: 0 };
  for (const r of records) {
    b.payments++;
    b.decisions[r.explanation.decision] = (b.decisions[r.explanation.decision] ?? 0) + 1;
    const why = blockingReason(r);
    if (!why) continue;
    const k = `${why.ruleId} | ${why.condition}`;
    b.reasons[k] = (b.reasons[k] ?? 0) + 1;
    if (r.explanation.decidingStep === 5 && r.explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass")) b.reopenedAtStep5++;
  }
  return b;
}

const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(2)} %` : "–");

/** A Markdown section for one or more entities' breakdowns. */
export function renderBreakdown(title: string, entities: { entityId: string; b: Breakdown }[]): string {
  const out: string[] = [`### ${title}`, "", "| entity | payments | auto-match (matched + with difference) | review | exception |", "|---|---|---|---|---|"];
  const tot: Breakdown = { payments: 0, decisions: {}, reasons: {}, reopenedAtStep5: 0 };
  for (const { entityId, b } of entities) {
    const am = (b.decisions.matched ?? 0) + (b.decisions.matched_with_difference ?? 0);
    out.push(`| ${entityId} | ${b.payments} | ${am} (${pct(am, b.payments)}) | ${b.decisions.suggested_for_review ?? 0} (${pct(b.decisions.suggested_for_review ?? 0, b.payments)}) | ${b.decisions.exception ?? 0} (${pct(b.decisions.exception ?? 0, b.payments)}) |`);
    tot.payments += b.payments; tot.reopenedAtStep5 += b.reopenedAtStep5;
    for (const [k, v] of Object.entries(b.decisions)) tot.decisions[k] = (tot.decisions[k] ?? 0) + v;
    for (const [k, v] of Object.entries(b.reasons)) tot.reasons[k] = (tot.reasons[k] ?? 0) + v;
  }
  const am = (tot.decisions.matched ?? 0) + (tot.decisions.matched_with_difference ?? 0);
  out.push(`| **all** | ${tot.payments} | ${am} (${pct(am, tot.payments)}) | ${tot.decisions.suggested_for_review ?? 0} (${pct(tot.decisions.suggested_for_review ?? 0, tot.payments)}) | ${tot.decisions.exception ?? 0} (${pct(tot.decisions.exception ?? 0, tot.payments)}) |`);
  out.push("", "Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):", "");
  const ids = entities.map((e) => e.entityId);
  out.push(`| rule | condition that failed | ${ids.join(" | ")} | all |`, `|---|---|${ids.map(() => "---|").join("")}---|`);
  for (const k of Object.keys(tot.reasons).sort((a, b) => tot.reasons[b] - tot.reasons[a] || (a < b ? -1 : 1))) {
    const [rule, cond] = k.split(" | ");
    out.push(`| \`${rule}\` | ${cond} | ${entities.map((e) => e.b.reasons[k] ?? 0).join(" | ")} | ${tot.reasons[k]} |`);
  }
  const blocked = Object.values(tot.reasons).reduce((a, b) => a + b, 0);
  out.push(`| | **total not auto-matched** | ${entities.map((e) => Object.values(e.b.reasons).reduce((a, b) => a + b, 0)).join(" | ")} | ${blocked} |`);
  out.push("", `Closed at step 4 by decision 1 and reopened at step 5: ${tot.reopenedAtStep5}.`, "");
  return out.join("\n");
}
