/**
 * rc7: every organisation holds either SAMPLE data (seeded, fictional) or LIVE data (the merchant's own uploads),
 * never both. The UI picks its data label from the organisation's mode, never from where a row came from.
 */
import { TEST_MODE_LABEL } from "./merchant/types";

export const DATA_MODES = ["sample", "live"] as const;
export type DataMode = (typeof DATA_MODES)[number];
export const LIVE_DATA_LABEL = "Your data" as const;
export type DataLabel = typeof TEST_MODE_LABEL | typeof LIVE_DATA_LABEL;

/** "Test mode · illustrative data" for sample organisations; "Your data" for live ones (never the demo label). */
export function dataLabel(mode: DataMode): DataLabel {
  return mode === "live" ? LIVE_DATA_LABEL : TEST_MODE_LABEL;
}
export const isDataMode = (v: unknown): v is DataMode => v === "sample" || v === "live";
