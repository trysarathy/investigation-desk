/**
 * Presets. `monthPreset`: one month, 2,000 orders, every situation and difference type, TRON + Ethereum, SGD + USD
 * bank accounts, two entities (an SGD book and a USD book). `smallPreset`: about 40 orders over 8 days for fast tests.
 * Each returns the world, every rendered file and the ground truth.
 */
import { renderFiles, type SyntheticFile } from "./files";
import { TARGET_POLICY, type SyntheticPolicy } from "./policy";
import { computeTruth, type SyntheticTruth } from "./truth";
import { generateWorld, type SyntheticWorld, type WorldParams } from "./world";

export interface Preset { world: SyntheticWorld; truth: SyntheticTruth; files: SyntheticFile[] }

export interface PresetOptions { seed?: number; month?: string; policy?: SyntheticPolicy; overrides?: Partial<WorldParams> }

export const MONTH_PRESET_PARAMS = (o: PresetOptions = {}): WorldParams => ({
  seed: o.seed ?? 20_261_100, month: o.month ?? "2026-11", paymentCount: 2_000, chains: ["tron", "ethereum"], policy: o.policy ?? TARGET_POLICY, ...(o.overrides ?? {}),
});
export const SMALL_PRESET_PARAMS = (o: PresetOptions = {}): WorldParams => ({
  seed: o.seed ?? 40, month: o.month ?? "2026-11", paymentCount: 40, activeDays: 8, chains: ["tron", "ethereum"], policy: o.policy ?? TARGET_POLICY, ...(o.overrides ?? {}),
});

export function monthWorld(o: PresetOptions = {}): SyntheticWorld { return generateWorld(MONTH_PRESET_PARAMS(o)); }
export function smallWorld(o: PresetOptions = {}): SyntheticWorld { return generateWorld(SMALL_PRESET_PARAMS(o)); }

async function preset(world: SyntheticWorld): Promise<Preset> {
  return { world, truth: computeTruth(world), files: await renderFiles(world) };
}
export const monthPreset = (o: PresetOptions = {}): Promise<Preset> => preset(monthWorld(o));
export const smallPreset = (o: PresetOptions = {}): Promise<Preset> => preset(smallWorld(o));
