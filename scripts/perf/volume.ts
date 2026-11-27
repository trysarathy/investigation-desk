/**
 * v1 phase 3: the volume world. One fictional merchant (the synthetic generator's two entities, SGD and USD) with
 * `payments` payments in one month and about `bankLines` bank lines (the settlement lines plus everyday fictional
 * non-settlement lines). Seeded: the same arguments always give the same world. Synthetic data only.
 */
import { MONTH_PRESET_PARAMS, generateWorld, type SyntheticWorld } from "../../src/lib/clearline/synthetic";

export interface VolumeOptions { payments?: number; bankLines?: number; seed?: number; month?: string }
export const VOLUME_TARGET = { payments: 100_000, bankLines: 5_000 } as const;

export function volumeWorld(o: VolumeOptions = {}): SyntheticWorld {
  const params = MONTH_PRESET_PARAMS({ seed: o.seed ?? 20_261_001, month: o.month ?? "2026-10", overrides: { paymentCount: o.payments ?? VOLUME_TARGET.payments } });
  // settlement lines are one per batch (entity × provider day), so a small probe of the same month counts them
  const probe = generateWorld({ ...params, paymentCount: 2_000 });
  const extra = Math.max(0, (o.bankLines ?? VOLUME_TARGET.bankLines) - probe.bankLines.length);
  return generateWorld({ ...params, otherBankLines: extra });
}
