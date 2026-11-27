// The one CSV cell writer for every export (reconciled export, bulk results): exact amounts go out
// as numbers, signed ones included; anything else a spreadsheet would run is neutralised.

const AMOUNT = /^-?\d+(\.\d+)?$/;

/**
 * v1 phase 2.1: the ONE rule every CSV export uses to decide whether a cell could run as a spreadsheet formula. True
 * when the text starts with a tab, CR or LF, or when, after Unicode compatibility folding (full-width ＝ becomes =)
 * and dropping leading spaces and invisible format characters (a spreadsheet ignores both), it starts with = + - or @.
 * A writer that prints exact signed amounts as numbers checks those separately (AMOUNT_TEXT) before calling this.
 */
export function isFormulaLike(s: string): boolean {
  if (/^[\t\r\n]/.test(s)) return true;
  return /^[=+\-@]/.test(s.normalize("NFKC").replace(/^[\p{White_Space}\p{Cf}]+/u, ""));
}

/** A plain decimal amount (optionally negative): written as a number, never quoted as text. */
export const AMOUNT_TEXT = AMOUNT;

/** The text, prefixed with ' when it could run as a formula (callers then apply their own quoting). */
export const formulaSafe = (s: string): string => (isFormulaLike(s) ? `'${s}` : s);

/** A spreadsheet must never execute a cell: values starting with = + - @ or a control are quoted as text. */
export function csvCell(
  v: string | number | boolean | undefined | null,
): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (isFormulaLike(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exact amounts (signed too) as numbers; everything else through csvCell. */
export function csvValue(
  v: string | number | boolean | undefined | null,
): string {
  return typeof v === "string" && AMOUNT.test(v) ? v : csvCell(v);
}
