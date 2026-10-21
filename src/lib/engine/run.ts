import { CATALOGUE_ORDER, RULE_VERSION } from "../catalogue";
import { formatDuration, formatTime, truncateMiddle } from "../format";
import type { Facts, RuleResult, Settings, Verdict } from "../types";
import { CHAIN_NAMES } from "../types";

function listChains(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
import { buildContext, type Ctx } from "./context";
import { buildEvidence } from "./evidence";
import { RULES } from "./rules";

/**
 * Spec 6, steps 3 and 4: run every rule in catalogue order, then pick the first High
 * match, else the first Medium match, else D99. All rules run even after a match so
 * the "Checks run" list is complete. Every other matched Medium rule is attached as a
 * finding for the analyst to confirm: a heuristic never replaces an established fact.
 */
export function investigate(facts: Facts, settings: Settings): Verdict {
  const ctx = buildContext(facts, settings);
  const evidence = buildEvidence(ctx);
  const base = {
    evidence,
    fill: fillValues(ctx),
    ruleVersion: RULE_VERSION,
    settingsVersion: settings.version,
    checkedAt: facts.checkedAt,
  };

  // A chain we could not reach means absence is unproven: pause instead of guessing.
  const pausedChains = facts.lookups.filter((l) => l.result === "error").map((l) => l.chain);
  if (!facts.tx && !facts.mempool && pausedChains.length > 0) {
    return { ...base, state: "paused", code: "D99", confidence: null, evidenceIds: [], findings: [], checks: [], pausedChains };
  }

  const checks: RuleResult[] = CATALOGUE_ORDER.map((code) => RULES[code as keyof typeof RULES](ctx));
  const winner = checks.find((c) => c.matched && c.confidence === "High") ??
    checks.find((c) => c.matched && c.confidence === "Medium");
  const findings = checks.filter((c) => c.matched && c.confidence === "Medium" && c !== winner);

  if (!winner) {
    return { ...base, state: "verdict", code: "D99", confidence: null, evidenceIds: evidence.map((e) => e.id), findings, checks, pausedChains };
  }
  return { ...base, state: "verdict", code: winner.code, confidence: winner.confidence!, evidenceIds: winner.evidenceIds, findings, checks, pausedChains };
}

function fillValues(ctx: Ctx): Record<string, string> {
  const { tx, transfer, settings, facts } = ctx;
  const fill: Record<string, string> = {};
  const checked = facts.lookups.filter((l) => l.result === "not_found").map((l) => CHAIN_NAMES[l.chain]);
  if (checked.length) fill.chains_checked = listChains(checked);
  if (facts.mempool) {
    fill.chain = CHAIN_NAMES[facts.mempool.chain];
    fill.window = formatDuration(settings.pendingWindowSec[facts.mempool.chain]).replace(/^about /, "");
  }
  if (tx) {
    fill.chain = CHAIN_NAMES[tx.chain];
    fill.found_chain = CHAIN_NAMES[tx.chain];
    if (tx.errorCode) fill.error = tx.errorCode;
  }
  if (transfer) {
    fill.token = transfer.tokenSymbol;
    fill.symbol = transfer.tokenSymbol;
    fill.amount = transfer.amount;
    fill.short_addr = truncateMiddle(transfer.to, 6, 6);
  }
  if (ctx.addrOtherChain) fill.expected_chain = CHAIN_NAMES[ctx.addrOtherChain.chain];
  if (ctx.confirmations !== undefined && ctx.threshold !== undefined && tx) {
    fill.n = String(Math.min(ctx.confirmations, ctx.threshold));
    fill.N = String(ctx.threshold);
    fill.eta = formatDuration(Math.max(0, ctx.threshold - ctx.confirmations) * settings.blockTimeSec[tx.chain]);
  }
  if (ctx.minimum) fill.min = ctx.minimum;
  if (ctx.ledgerMatch?.row.creditedAt) fill.credited_at = formatTime(ctx.ledgerMatch.row.creditedAt);
  fill.policy_sentence = settings.belowMinimumPolicy;
  return fill;
}
