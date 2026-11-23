/**
 * From a grid of cells to a table a person can map: header row found, header names made unique, blank rows skipped
 * (and counted), trailing total rows excluded (and named), limits enforced.
 */
import { detectDecimalSeparator, parseAmount } from "./decimal";
import { IngestError, type IngestWarning } from "./errors";
import { checkCell, checkColumnCount, checkRowCount, type IngestLimits } from "./limits";
import { detectHeaderRow } from "./sniff";

export interface TabularRow {
  /** 1-based position in the file: the physical line (CSV), the sheet row (XLSX) or the item number (JSON). */
  rowNumber: number;
  cells: string[];
}

export interface ExcludedRow { rowNumber: number; reason: "total_row"; cells: string[] }

export interface TableShape {
  headers: string[];
  rows: TabularRow[];
  /** Row number of the header row (0 for JSON, which has no header row). */
  headerRowNumber: number;
  blankRowsSkipped: number;
  excludedRows: ExcludedRow[];
  warnings: IngestWarning[];
}

export interface BuildOptions {
  /** 1-based row number of the header row; detected when omitted. */
  headerRow?: number;
  /** Look for trailing total rows (default true). */
  detectTotals?: boolean;
}

const isBlank = (cells: readonly string[]) => cells.every((c) => c.trim() === "");

/** "Amount", "Amount" → "Amount", "Amount (2)". Empty names become "Column N". */
export function uniqueHeaders(names: readonly string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  names.forEach((raw, i) => {
    const base = raw.replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    out.push(name);
  });
  return out;
}

export function buildTable(grid: readonly TabularRow[], limits: IngestLimits, opts: BuildOptions = {}): TableShape {
  const warnings: IngestWarning[] = [];
  if (grid.length === 0 || grid.every((r) => isBlank(r.cells))) throw new IngestError("no_data", "The file has no rows.");
  let headerIndex: number;
  if (opts.headerRow !== undefined) {
    headerIndex = grid.findIndex((r) => r.rowNumber === opts.headerRow);
    if (headerIndex < 0) throw new IngestError("no_header", `Row ${opts.headerRow} is not in the file.`);
  } else {
    headerIndex = detectHeaderRow(grid.map((r) => r.cells));
  }
  const headerRow = grid[headerIndex];
  const skippedTitles = grid.slice(0, headerIndex).filter((r) => !isBlank(r.cells));
  if (skippedTitles.length) {
    warnings.push({
      code: "title_rows_skipped",
      message: `${skippedTitles.length} row(s) above the header were skipped as titles (row${skippedTitles.length === 1 ? "" : "s"} ${skippedTitles.map((r) => r.rowNumber).join(", ")}).`,
      row: skippedTitles[0].rowNumber,
    });
  }
  let width = headerRow.cells.length;
  while (width > 0 && headerRow.cells[width - 1].trim() === "") width--;
  const data: TabularRow[] = [];
  let blank = 0;
  let widest = width;
  for (const r of grid.slice(headerIndex + 1)) {
    if (isBlank(r.cells)) { blank++; continue; }
    let w = r.cells.length;
    while (w > 0 && r.cells[w - 1].trim() === "") w--;
    if (w > widest) widest = w;
    data.push(r);
  }
  checkColumnCount(widest, limits, headerRow.rowNumber);
  checkRowCount(data.length, limits);
  const names = headerRow.cells.slice(0, width);
  if (widest > width) {
    for (let i = width; i < widest; i++) names.push("");
    warnings.push({ code: "extra_cells", message: `Some rows have more values than the header has names; the extra columns are named ${widest - width === 1 ? `"Column ${widest}"` : `"Column ${width + 1}" to "Column ${widest}"`}.` });
  }
  const headers = uniqueHeaders(names);
  const renamed = headers.filter((h, i) => h !== names[i].replace(/\s+/g, " ").trim() && names[i].trim() !== "");
  if (renamed.length) warnings.push({ code: "duplicate_headers", message: `Repeated column names were numbered: ${renamed.map((h) => `"${h}"`).join(", ")}.`, row: headerRow.rowNumber });
  headers.forEach((h) => checkCell(h, limits, headerRow.rowNumber));

  let short = 0;
  const rows: TabularRow[] = data.map((r) => {
    const cells = r.cells.slice(0, widest);
    if (cells.length < widest) short++;
    while (cells.length < widest) cells.push("");
    cells.forEach((c, i) => checkCell(c, limits, r.rowNumber, headers[i]));
    return { rowNumber: r.rowNumber, cells };
  });
  if (short) warnings.push({ code: "short_rows", message: `${short} row(s) have fewer values than there are columns; the missing values are empty.` });
  if (blank) warnings.push({ code: "blank_rows_skipped", message: `${blank} blank row(s) were skipped.` });

  const excludedRows = opts.detectTotals === false ? [] : excludeTotals(headers, rows);
  for (const x of excludedRows) {
    warnings.push({ code: "total_row_excluded", message: `Row ${x.rowNumber} looks like a total, not a transaction, and was left out.`, row: x.rowNumber });
  }
  return { headers, rows, headerRowNumber: headerRow.rowNumber, blankRowsSkipped: blank, excludedRows, warnings };
}

const TOTAL_WORDS = /\b(grand\s+total|sub-?\s?total|totals?|sum|summe|total\s+amount)\b/i;
const ID_HEADER = /\b(id|ids|ref|refs|reference|txn|tx|txid|hash|invoice|order|number|no|code|date|time)\b|_id$|^id_/i;
/** How many trailing rows (subtotal, tax, grand total…) are examined. */
const MAX_FOOTER_ROWS = 5;

/** Exact column sum of `values` when every one is an amount (precision 18), else undefined. */
function columnSum(values: readonly string[], decimal: "." | ","): bigint | undefined {
  let sum = 0n;
  let any = false;
  for (const v of values) {
    if (v.trim() === "") continue;
    const r = parseAmount(v, { precision: 18, decimalSeparator: decimal, allowDrCr: true });
    if (!r.ok) return undefined;
    sum += r.value;
    any = true;
  }
  return any ? sum : undefined;
}

/**
 * Trailing rows that are totals: their identifier-looking cells are empty and they either say total/sum/subtotal or
 * every amount in them equals the sum of its column above. Removes them from `rows` (mutates) and returns them.
 */
export function excludeTotals(headers: readonly string[], rows: TabularRow[]): ExcludedRow[] {
  const idCols = headers.map((h, i) => (ID_HEADER.test(h) ? i : -1)).filter((i) => i >= 0);
  const excluded: ExcludedRow[] = [];
  for (let k = 0; k < MAX_FOOTER_ROWS && rows.length > 1; k++) {
    const row = rows[rows.length - 1];
    const above = rows.slice(0, -1);
    const filled = row.cells.filter((c) => c.trim() !== "").length;
    const idsEmpty = idCols.length > 0
      ? idCols.every((i) => row.cells[i].trim() === "" || TOTAL_WORDS.test(row.cells[i]))
      : filled <= Math.ceil(row.cells.length / 2);
    if (!idsEmpty) break;
    let isTotal = row.cells.some((c) => TOTAL_WORDS.test(c));
    if (!isTotal && above.length >= 2) {
      let matched = 0;
      let mismatched = 0;
      row.cells.forEach((cell, i) => {
        if (cell.trim() === "" || idCols.includes(i)) return;
        const column = above.map((r) => r.cells[i]);
        const style = detectDecimalSeparator([...column, cell]);
        const decimal = style.status === "decided" ? style.decimalSeparator : ".";
        const own = parseAmount(cell, { precision: 18, decimalSeparator: decimal, allowDrCr: true });
        const sum = columnSum(column, decimal);
        if (own.ok && sum !== undefined && own.value === sum) matched++;
        else mismatched++;
      });
      isTotal = matched > 0 && mismatched === 0;
    }
    if (!isTotal) break;
    rows.pop();
    excluded.unshift({ rowNumber: row.rowNumber, reason: "total_row", cells: row.cells });
  }
  return excluded;
}
