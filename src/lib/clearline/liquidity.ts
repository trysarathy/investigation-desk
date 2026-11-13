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
  const rows: LiquidityRow[] = ws.liquidity.map((snap) => {
    const committed = ws.intents
      .filter((i) => COMMITTED.includes(i.status.execution) && i.sourceCurrency === snap.currency)
      .filter((i) => {
        const instr = ws.instructions.find((x) => x.id === i.instructionId);
        return instr?.providerId === snap.providerId && instr.status !== "rejected";
      })
      .reduce((sum, i) => sum + i.amountMinor, 0);
    const bufferMinor = Math.max(policy.minBufferMinor[snap.currency] ?? 0, Math.floor((snap.eligibleMinor * policy.bufferBps) / 10000));
    const usableMinor = snap.eligibleMinor - snap.restrictedMinor - snap.safeguardedMinor - committed - bufferMinor;
    const ageMinutes = Math.max(0, minutesBetween(snap.asOf, at));
    const stale = ageMinutes > policy.maxAgeMinutes;
    return {
      ...snap,
      committedPayoutsMinor: committed,
      providerName: ws.routes.find((r) => r.providerId === snap.providerId)?.providerName ?? snap.providerId,
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
