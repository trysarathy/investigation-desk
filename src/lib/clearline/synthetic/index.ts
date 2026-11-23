/**
 * Clearline rc7 seeded synthetic-data generator. Pure and deterministic (seeded PRNG, injected dates). Every value is
 * fictional except the three public token contracts. Nothing here reads a clock, the network or the file system.
 */
export { SYNTHETIC_LABEL, ALLOWED_REAL_CONTRACTS, USDT_TRON_CONTRACT, USDC_ETH_CONTRACT, USDT_ETH_CONTRACT, tronChecksumValid, eip55Valid } from "./fictional";
export { createRng, type Rng } from "./prng";
export { TARGET_POLICY, RC6_SHIPPED_POLICY, bandFor, toEnginePolicy, withBandRule, type BandRule, type SyntheticPolicy } from "./policy";
export {
  generateWorld, transferKey, SCENARIOS, EXTRAS, DEFAULT_MIX, DEFAULT_EXTRAS, DEFAULT_ENTITIES, DEFAULT_BANK_ACCOUNTS,
  type Scenario, type Extra, type WorldParams, type SyntheticWorld, type WorldOrder, type OrderDesign, type PaymentMeta, type TransferMeta,
} from "./world";
export {
  computeTruth, coverage, pairKey, DIFFERENCE_TYPES, SITUATIONS,
  type SyntheticTruth, type OrderTruth, type BatchTruth, type TransferTruth, type BankLineTruth, type ExpectedDecision, type Coverage, type Situation,
} from "./truth";
export { toReconcileInput, toReconcileInputs } from "./toReconcileInput";
export { renderFiles, fileName, type SyntheticFile, type SyntheticFileKind } from "./files";
export { monthPreset, smallPreset, monthWorld, smallWorld, MONTH_PRESET_PARAMS, SMALL_PRESET_PARAMS, type Preset, type PresetOptions } from "./month";
export { statementFor, type Statement } from "./writers/bank";
export { zipEntries } from "./writers/zip";
