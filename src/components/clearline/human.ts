/**
 * Human-readable words for engine values, codes and errors. The engine owns the words
 * (ENGINE_API.md CHANGE 5: HUMAN_LABELS, describeCode, describeError); this module only
 * reaches them and keeps a plain fallback so the console never shows an empty label.
 */
import * as engine from "@/lib/clearline";
import { RECONCILIATION_CODE_TEXT, type EngineError, type StatusDimensions, type Workspace } from "@/lib/clearline";

type HumanError = { code: string; reasonCode?: string; headline: string; detail: string; text: string };
type LabelTable = Record<string, Record<string, string> | undefined>;

// Read by key so the build does not depend on the exact moment the engine lands CHANGE 5.
const api = engine as unknown as Record<string, unknown>;
const pick = <T,>(name: string): T | undefined => api[name] as T | undefined;

export function sentence(code: string): string {
  return code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** HUMAN_LABELS[table][value] when the engine provides it. */
export function engineLabel(table: string, value: string): string | undefined {
  return pick<LabelTable>("HUMAN_LABELS")?.[table]?.[value];
}

/** HUMAN_LABELS[table][value], else a sentence-cased value. */
export function label(table: string, value: string): string {
  const t = pick<LabelTable>("HUMAN_LABELS")?.[table];
  return t?.[value] ?? sentence(value);
}

/** Engine explanation code → words (describeCode), else the reconciliation text, else the code itself. */
export function describeCode(code: string): string {
  const f = pick<(c: string) => string>("describeCode");
  if (f) return f(code);
  return RECONCILIATION_CODE_TEXT[code as keyof typeof RECONCILIATION_CODE_TEXT] ?? sentence(code);
}

/** Engine error → human words (describeError). Never empty; the exact code stays available separately. */
export function describeError(err: EngineError, ws?: Workspace): HumanError {
  const f = pick<(e: EngineError, w?: Workspace) => HumanError>("describeError");
  if (f) return f(err, ws);
  const m = /^([A-Z_]+):\s*(.*)$/.exec(err.message);
  const detail = m ? m[2] : err.message;
  return { code: err.code, reasonCode: m?.[1], headline: "Not applied.", detail, text: detail };
}

/** canResolveCase / canResolveException result → words. */
export function describeResolution(code: string, reason: string): string {
  const t = pick<LabelTable>("HUMAN_LABELS")?.resolutionCode;
  const head = t?.[code];
  return head && !reason.startsWith(head) ? `${head} ${reason}` : reason;
}

export const engineHasHumanLabels = (): boolean => Boolean(pick("HUMAN_LABELS") && pick("describeError"));

/** The engine's one-line operational summary of the three dimensions (describeStatus), when available. */
export function statusSummary(s: StatusDimensions): string | undefined {
  return pick<(x: StatusDimensions) => { summary?: string }>("describeStatus")?.(s)?.summary || undefined;
}
