/**
 * The tolerance policy the synthetic ground truth is computed under. It is a generator INPUT, so the truth can be
 * recomputed when the engine's policy changes. The target policy (per the engine change in progress) is:
 * band = the LARGER of 0.5% of the invoice and a fixed amount per currency (SGD 5.00, USD 5.00, AED 20.00), and the
 * write-off threshold equals that fixed amount. The rc6 engine as shipped uses the SMALLER of the two; `bandRule`
 * lets the same world be judged under either.
 */
import { bpsOf } from "../merchant/amounts";
import type { FiatCurrency, MerchantPolicy } from "../merchant/types";

export type BandRule = "larger" | "smaller";

export interface SyntheticPolicy {
  /** Percentage part of the band, in basis points (50 = 0.5%). */
  toleranceBps: number;
  /** Fixed part of the band per currency, in minor units. */
  fixedMinor: Readonly<Record<FiatCurrency, bigint>>;
  bandRule: BandRule;
  /** Write-off threshold per currency, in minor units (target: equal to fixedMinor). */
  writeoffThresholdMinor: Readonly<Record<FiatCurrency, bigint>>;
  /** Network-fee bound for a sender-side fee, token base units (6 decimals). */
  senderFeeBoundBaseUnits: bigint;
  approverRoles: readonly string[];
}

const FIXED: Readonly<Record<FiatCurrency, bigint>> = { SGD: 500n, USD: 500n, AED: 2000n };

/** The policy the engine is moving to: larger of 0.5% or the fixed amount; write-off threshold = the fixed amount. */
export const TARGET_POLICY: SyntheticPolicy = {
  toleranceBps: 50,
  fixedMinor: FIXED,
  bandRule: "larger",
  writeoffThresholdMinor: FIXED,
  senderFeeBoundBaseUnits: 2_000_000n,
  approverRoles: ["finance_approver"],
};

/** The same numbers under the shipped rc6 rule (smaller of the two). */
export const RC6_SHIPPED_POLICY: SyntheticPolicy = { ...TARGET_POLICY, bandRule: "smaller" };

export function withBandRule(policy: SyntheticPolicy, bandRule: BandRule): SyntheticPolicy {
  return { ...policy, bandRule };
}

/** The tolerance band for one invoice under a policy. */
export function bandFor(policy: SyntheticPolicy, invoiceMinor: bigint, currency: FiatCurrency): bigint {
  const pct = bpsOf(invoiceMinor, policy.toleranceBps);
  const fixed = policy.fixedMinor[currency];
  if (policy.bandRule === "larger") return pct > fixed ? pct : fixed;
  return pct < fixed ? pct : fixed;
}

/**
 * The engine's MerchantPolicy for one entity currency. The rc6 engine reads toleranceAbsMinor as the fixed part and
 * applies its own band rule (smaller, as shipped); bandRule itself has no field there yet.
 */
export function toEnginePolicy(policy: SyntheticPolicy, currency: FiatCurrency): MerchantPolicy {
  return {
    tolerancePct: policy.toleranceBps,
    toleranceAbsMinor: policy.fixedMinor[currency],
    toleranceCombine: policy.bandRule,
    writeoffThresholdMinor: policy.writeoffThresholdMinor[currency],
    approverRoles: policy.approverRoles,
    allowImportedBankLinesAsVerified: false,
    senderFeeBoundBaseUnits: policy.senderFeeBoundBaseUnits,
  };
}
