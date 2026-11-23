/**
 * rc7 Phase 5 blind test: the synthetic month the test runs on, and the files a finance user would have. Fixed seed;
 * October 2026 so that every transfer lies before the server's clock (the verify step reads chain data up to "now").
 * The provider export is the generator's shape D (src/lib/clearline/synthetic/blind.ts): this module renders it with
 * the generator's own function and never reads or names its fields. Every value is fictional.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MONTH_PRESET_PARAMS, computeTruth, generateWorld, renderFiles, type SyntheticFile, type SyntheticTruth, type SyntheticWorld } from "../../src/lib/clearline/synthetic";

export const BLIND = {
  seed: 20_261_100,
  month: "2026-10",
  org: { slug: "blindbay-live", name: "Blindbay Synthetic (fictional, live)" },
  users: [
    ["finance@blindbay-live.example", "finance", "Bea Lindt (fictional)"],
    ["approver@blindbay-live.example", "approver", "Arno Sato (fictional)"],
    ["admin@blindbay-live.example", "admin", "Aiko Brandt (fictional)"],
  ] as const,
} as const;

let cached: { world: SyntheticWorld; truth: SyntheticTruth } | undefined;
export function blindWorld(): { world: SyntheticWorld; truth: SyntheticTruth } {
  if (!cached) {
    const world = generateWorld(MONTH_PRESET_PARAMS({ seed: BLIND.seed, month: BLIND.month }));
    cached = { world, truth: computeTruth(world) };
  }
  return cached;
}

export interface BlindFiles {
  /** The provider's export (shape D, JSON). */
  provider: { path: string; name: string };
  /** The merchant's own order list (CSV), a format Clearline already reads. */
  orders: { path: string; name: string };
  /** One MT940 statement per bank account, keyed by entity id. */
  bank: Record<string, { path: string; name: string; account: string }>;
}

/** Writes the files to `dir` (a test-results folder; nothing real, nothing committed). */
export async function writeBlindFiles(dir: string): Promise<BlindFiles> {
  const { world } = blindWorld();
  const files = await renderFiles(world, { kinds: ["provider_export_blind", "order_list_csv", "bank_mt940"] });
  mkdirSync(dir, { recursive: true });
  const put = (f: SyntheticFile) => { const p = path.join(dir, f.name); writeFileSync(p, f.bytes); return { path: p, name: f.name }; };
  const bank: BlindFiles["bank"] = {};
  for (const e of world.entitySpecs) bank[e.id] = { ...put(files.find((f) => f.kind === "bank_mt940" && f.account === e.bankAccountId)!), account: e.bankAccountId };
  return { provider: put(files.find((f) => f.kind === "provider_export_blind")!), orders: put(files.find((f) => f.kind === "order_list_csv")!), bank };
}
