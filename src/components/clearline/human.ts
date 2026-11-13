/**
 * Human-readable words for engine values, codes and errors. The engine owns the words
 * (ENGINE_API.md CHANGE 5: HUMAN_LABELS, describeCode, describeError, describeStatus); this module
 * only gives the console one place to read them, with a sentence-cased fallback so a label is never empty.
 */
import {
  HUMAN_LABELS, describeCode as engineDescribeCode, describeError as engineDescribeError, describeStatus,
  type EngineError, type HumanError, type StatusDimensions, type Workspace,
} from "@/lib/clearline";

type LabelTable = Record<string, Record<string, string> | undefined>;
const TABLES = HUMAN_LABELS as unknown as LabelTable;

export function sentence(code: string): string {
  return code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** HUMAN_LABELS[table][value] when the engine provides it. */
export function engineLabel(table: string, value: string): string | undefined {
  return TABLES[table]?.[value];
}

/** HUMAN_LABELS[table][value], else a sentence-cased value. */
export function label(table: string, value: string): string {
  return engineLabel(table, value) ?? sentence(value);
}

/** Engine explanation code → words. */
export function describeCode(code: string): string {
  return engineDescribeCode(code);
}

/** Engine error → human words. Never empty; the exact code stays available separately. */
export function describeError(err: EngineError, ws?: Workspace): HumanError {
  return engineDescribeError(err, ws);
}

/**
 * canResolveCase / canResolveException refusal → the engine's words, e.g.
 * "Payment cannot be closed. Settlement evidence is still missing."
 */
export function describeResolution(code: string, reason: string, ws: Workspace, entityId: string): string {
  return engineDescribeError({ code: "resolution_not_permitted", message: `${code}: ${reason}`, entityId }, ws).text;
}

/** The engine's one-line operational summary of the three dimensions. */
export function statusSummary(s: StatusDimensions): string {
  return describeStatus(s).summary;
}
