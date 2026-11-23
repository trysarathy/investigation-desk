/**
 * Excel (.xlsx) reading through exceljs. Every cell becomes text: numbers via the shortest round-trip string
 * (xlsx-cell.ts), dates as ISO strings without an offset (Excel stores none), formulas as their cached result.
 */
import ExcelJS from "exceljs";
import { parseDate } from "./dates";
import { IngestError, type IngestWarning } from "./errors";
import type { IngestLimits } from "./limits";
import type { TabularRow } from "./table";
import { xlsxNumberToText } from "./xlsx-cell";

export interface SheetGrid { sheet: string; sheets: string[]; grid: TabularRow[]; warnings: IngestWarning[] }

const pad = (n: number, w = 2) => n.toString().padStart(w, "0");

/**
 * A spreadsheet date has no time zone; exceljs builds it as if it were UTC, so the UTC fields are the wall-clock
 * value. Rounded to the second, because Excel's day fractions rarely land on an exact millisecond.
 */
export function excelDateToIso(d: Date): string {
  const t = d.getTime();
  const ms = ((t % 1000) + 1000) % 1000;
  const rounded = new Date(t - ms + (ms >= 500 ? 1000 : 0));
  const date = `${pad(rounded.getUTCFullYear(), 4)}-${pad(rounded.getUTCMonth() + 1)}-${pad(rounded.getUTCDate())}`;
  const h = rounded.getUTCHours(), m = rounded.getUTCMinutes(), s = rounded.getUTCSeconds();
  return h === 0 && m === 0 && s === 0 ? date : `${date}T${pad(h)}:${pad(m)}:${pad(s)}`;
}

const DATE_FORMAT = /(^|[^"\\])(y{2,4}|d{1,4}|m{1,5}|h{1,2})/i;
const looksLikeDateFormat = (numFmt: string | undefined) =>
  !!numFmt && numFmt !== "General" && DATE_FORMAT.test(numFmt.replace(/"[^"]*"|\[[^\]]*\]/g, ""));

interface CellLike { value: ExcelJS.CellValue; numFmt?: string; address: string }

function cellText(cell: CellLike, warn: (w: IngestWarning) => void, row: number): string {
  const fromNumber = (n: number): string => {
    if (looksLikeDateFormat(cell.numFmt)) {
      const t = xlsxNumberToText(n).text;
      const d = parseDate(t, "excel_serial", { utcOffsetMinutes: 0 });
      if (d.ok) return d.value.time ? `${d.value.date}T${d.value.time}` : d.value.date;
    }
    const r = xlsxNumberToText(n);
    if (r.precisionWarning) warn({ code: "xlsx_precision", message: `Cell ${cell.address}: ${r.precisionWarning}`, row });
    return r.text;
  };
  const scalar = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return fromNumber(v);
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v instanceof Date) return excelDateToIso(v);
    if (typeof v === "object" && "error" in v) {
      warn({ code: "xlsx_error_cell", message: `Cell ${cell.address} shows the error ${String((v as { error: unknown }).error)}; it was read as empty.`, row });
      return "";
    }
    return "";
  };
  const v = cell.value;
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === undefined) warn({ code: "xlsx_formula_no_result", message: `Cell ${cell.address} has a formula with no saved result; open and save the file in Excel, then upload it again.`, row });
      return scalar(result);
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join("");
    if ("hyperlink" in v) return scalar((v as ExcelJS.CellHyperlinkValue).text);
  }
  return scalar(v);
}

/** Load the workbook and return the chosen sheet as rows of text: the named sheet, else the first non-empty one. */
export async function readXlsxGrid(bytes: Uint8Array, limits: IngestLimits, sheetName?: string): Promise<SheetGrid> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs accepts any binary JSZip accepts; its type says Buffer.
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new IngestError("invalid_xlsx", "The Excel file could not be opened; it may be damaged or password-protected.");
  }
  const sheets = workbook.worksheets.map((w) => w.name);
  const hasCells = (w: ExcelJS.Worksheet) => {
    let any = false;
    w.eachRow((row) => { row.eachCell(() => { any = true; }); });
    return any;
  };
  const sheet = sheetName !== undefined ? workbook.worksheets.find((w) => w.name === sheetName) : workbook.worksheets.find(hasCells);
  if (!sheet) {
    if (sheetName !== undefined) throw new IngestError("sheet_not_found", `There is no sheet named "${sheetName}". The sheets are: ${sheets.map((s) => `"${s}"`).join(", ")}.`);
    throw new IngestError("no_data", "Every sheet in the workbook is empty.");
  }
  const warnings: IngestWarning[] = [];
  let warned = 0;
  const warn = (w: IngestWarning) => { if (warned++ < 50) warnings.push(w); };
  const grid: TabularRow[] = [];
  let width = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Rows with no cells at all are not visited; keep them as blank rows so they are counted, not lost.
    const last = grid.length ? grid[grid.length - 1].rowNumber : 0;
    for (let n = last + 1; n < rowNumber && grid.length <= limits.maxDataRows + 1_000; n++) grid.push({ rowNumber: n, cells: [] });
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > limits.maxColumns) throw new IngestError("too_many_columns", `The sheet has more than ${limits.maxColumns} columns.`, { row: rowNumber });
      cells[col - 1] = cellText(cell, warn, rowNumber);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    width = Math.max(width, cells.length);
    grid.push({ rowNumber, cells });
    if (grid.length > limits.maxDataRows + 1_000) throw new IngestError("too_many_rows", `The sheet has more than ${limits.maxDataRows.toLocaleString("en-US")} data rows. Split it into smaller files.`);
  });
  for (const r of grid) while (r.cells.length < width) r.cells.push("");
  if (warned > 50) warnings.push({ code: "xlsx_more_warnings", message: `${warned - 50} more cell warning(s) were not listed.` });
  return { sheet: sheet.name, sheets, grid, warnings };
}
