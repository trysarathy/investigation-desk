import type { CurrencyCode, ExecutionState, LiquidityRow, LiquidityView, Workspace } from "./types";
import { minutesBetween } from "./tx";

/** Execution states whose amount is committed against provider liquidity. */
const COMMITTED: readonly ExecutionState[] = ["approved", "submitted", "in_transit", "on_hold", "awaiting_information"];

/**
 * usable = eligible − restricted − safeguarded − committed payouts − buffer
 * under the workspace's explicit, labelled provider-defined policy. Stale snapshots are
 * flagged and excluded from "current" totals. Totals are per currency only.
 */
export function computeLiquidity(ws: Workspace, at: string = ws.asOf): LiquidityView {
  const policy = ws.liquidityPolicy;
  // QA M3: linear in workspace size — one pass builds committed totals per provider and currency.
  const instructions = new Map(ws.instructions.map((x) => [x.id, x]));
  const providerNames = new Map(ws.routes.map((r) => [r.providerId, r.providerName]));
  const committedBy = new Map<string, number>();
  for (const i of ws.intents) {
    if (!COMMITTED.includes(i.status.execution)) continue;
    const instr = i.instructionId ? instructions.get(i.instructionId) : undefined;
    if (!instr || instr.status === "rejected") continue;
    const key = `${instr.providerId}|${i.sourceCurrency}`;
    committedBy.set(key, (committedBy.get(key) ?? 0) + i.amountMinor);
  }
  const rows: LiquidityRow[] = ws.liquidity.map((snap) => {
    const committed = committedBy.get(`${snap.providerId}|${snap.currency}`) ?? 0;
    const bufferMinor = Math.max(policy.minBufferMinor[snap.currency] ?? 0, Math.floor((snap.eligibleMinor * policy.bufferBps) / 10000));
    const usableMinor = snap.eligibleMinor - snap.restrictedMinor - snap.safeguardedMinor - committed - bufferMinor;
    const rawAge = minutesBetween(snap.asOf, at);
    // M8: an age that cannot be computed (invalid instant) is stale, never fresh.
    const ageMinutes = Number.isFinite(rawAge) ? Math.max(0, rawAge) : Number.POSITIVE_INFINITY;
    const stale = !(ageMinutes <= policy.maxAgeMinutes);
    return {
      ...snap,
      committedPayoutsMinor: committed,
      providerName: providerNames.get(snap.providerId) ?? snap.providerId,
      bufferMinor,
      usableMinor,
      ageMinutes,
      stale,
      freshness: stale ? "stale" : "fresh",
      policyId: policy.id,
      policyLabel: policy.label,
      formula: "usable = eligible − restricted − safeguarded − committed payouts − buffer",
    };
  });
  const currentUsableByCurrency: Partial<Record<CurrencyCode, number>> = {};
  for (const r of rows) if (!r.stale) currentUsableByCurrency[r.currency] = (currentUsableByCurrency[r.currency] ?? 0) + r.usableMinor;
  return { asOf: at, policy, rows, currentUsableByCurrency, staleExcluded: rows.filter((r) => r.stale).map((r) => r.id) };
}
