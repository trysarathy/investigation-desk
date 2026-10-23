// The one CSV cell writer for every export (reconciled export, bulk results): exact amounts go out
// as numbers, signed ones included; anything else a spreadsheet would run is neutralised.

const AMOUNT = /^-?\d+(\.\d+)?$/;

/** A spreadsheet must never execute a cell: values starting with = + - @ or a control are quoted as text. */
export function csvCell(v: string | number | boolean | undefined | null): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exact amounts (signed too) as numbers; everything else through csvCell. */
export function csvValue(v: string | number | boolean | undefined | null): string {
  return typeof v === "string" && AMOUNT.test(v) ? v : csvCell(v);
}
