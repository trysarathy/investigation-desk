/**
 * rc7: every organisation holds either SAMPLE data (seeded, fictional) or LIVE data (the merchant's own uploads),
 * never both. The UI picks its data label from the organisation's mode, never from where a row came from.
 *
 * Demo build (migration 0031): a third mode, DEMO. A demo organisation holds fictional data only (the seeded demo
 * world, `npm run demo`), but goes through the same pipeline as a live one: uploads, confirmations and chain
 * verification. Its label is "Demo · fictional data" on every screen; it is never "Your data" and never the sample
 * label. Recorded chain data for it is honoured only in a demo build (src/server/demo-build.ts).
 */
import { TEST_MODE_LABEL } from "./merchant/types";

export const DATA_MODES = ["sample", "live", "demo"] as const;
export type DataMode = (typeof DATA_MODES)[number];
export const LIVE_DATA_LABEL = "Your data" as const;
export const DEMO_DATA_LABEL = "Demo · fictional data" as const;
export type DataLabel = typeof TEST_MODE_LABEL | typeof LIVE_DATA_LABEL | typeof DEMO_DATA_LABEL;

/** "Test mode · illustrative data" for sample organisations; "Your data" for live ones; "Demo · fictional data" for demo ones. */
export function dataLabel(mode: DataMode): DataLabel {
  return mode === "live" ? LIVE_DATA_LABEL : mode === "demo" ? DEMO_DATA_LABEL : TEST_MODE_LABEL;
}
export const isDataMode = (v: unknown): v is DataMode => v === "sample" || v === "live" || v === "demo";

/**
 * Organisations whose data comes through the upload pipeline (and so is verified against chain data before a run):
 * live ones, and demo ones. Sample organisations keep their seeded facts.
 */
export const usesUploadPipeline = (mode: DataMode): boolean => mode === "live" || mode === "demo";
/** The same question asked of a label (read models that carry only the label). */
export const labelUsesUploadPipeline = (label: DataLabel): boolean => label === LIVE_DATA_LABEL || label === DEMO_DATA_LABEL;
