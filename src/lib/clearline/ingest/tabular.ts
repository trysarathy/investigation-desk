/**
 * Readers for tabular files: CSV/TSV, XLSX and JSON → headers plus rows of text cells, ready for a column-mapping
 * screen. Nothing is interpreted yet: amounts and dates stay as written (see decimal.ts and dates.ts).
 */
import { splitRecords } from "./csv";
import { IngestError, type IngestWarning } from "./errors";
import { parseJson, JsonNumber, type JsonValue } from "./json";
import { checkCell, checkColumnCount, checkFileSize, checkRowCount, resolveLimits, type IngestLimits } from "./limits";
import { decodeText, detectDelimiter, sniffFile, type Delimiter, type TextEncoding } from "./sniff";
import { buildTable, uniqueHeaders, type ExcludedRow, type TabularRow } from "./table";
import { readXlsxGrid } from "./xlsx";

export type { ExcludedRow, TabularRow } from "./table";
export type TabularKind = "csv" | "tsv" | "xlsx" | "json";

export interface ParsedTable {
  kind: TabularKind;
  headers: string[];
  rows: TabularRow[];
  warnings: IngestWarning[];
  /** XLSX: the sheet that was read. */
  sheet?: string;
  /** XLSX: every sheet name, so the UI can offer a choice. */
  sheets?: string[];
  /** Row number of the header row (0 for JSON). */
  headerRowNumber: number;
  blankRowsSkipped: number;
  /** Trailing total rows that were left out, with their cells, so the UI can show them. */
  excludedRows: ExcludedRow[];
  encoding?: TextEncoding;
  /** CSV/TSV: the file started with a byte-order mark. */
  bom?: boolean;
  delimiter?: Delimiter;
}

export interface ReadOptions {
  limits?: Partial<IngestLimits>;
  /** 1-based row number of the header row; detected when omitted (CSV/TSV/XLSX). */
  headerRow?: number;
  /** Look for and exclude trailing total rows (default true; CSV/TSV/XLSX). */
  detectTotals?: boolean;
}

export interface DelimitedOptions extends ReadOptions { delimiter?: Delimiter }
export interface XlsxOptions extends ReadOptions { sheet?: string }
export interface JsonOptions extends ReadOptions {
  /** Property holding the array, when the top-level object has more than one array. */
  arrayProperty?: string;
}

/** CSV or TSV bytes → table. The delimiter is detected unless given. */
export function readDelimited(bytes: Uint8Array, opts: DelimitedOptions = {}): ParsedTable {
  const limits = resolveLimits(opts.limits);
  checkFileSize(bytes, limits);
  const decoded = decodeText(bytes);
  const delimiter = opts.delimiter ?? detectDelimiter(decoded.text.slice(0, 65_536)) ?? ",";
  // Header and title rows come on top of the data rows; allow some room before declaring the file too long.
  const { records, warnings } = splitRecords(decoded.text, delimiter, limits.maxDataRows + 1_000);
  const grid = records.map((r) => ({ rowNumber: r.line, cells: r.cells }));
  const table = buildTable(grid, limits, opts);
  return {
    kind: delimiter === "\t" ? "tsv" : "csv",
    ...table,
    warnings: [...decoded.warnings, ...warnings, ...table.warnings],
    encoding: decoded.encoding,
    bom: decoded.bom,
    delimiter,
  };
}

/** XLSX bytes → table, from the named sheet or the first non-empty one. */
export async function readXlsx(bytes: Uint8Array, opts: XlsxOptions = {}): Promise<ParsedTable> {
  const limits = resolveLimits(opts.limits);
  checkFileSize(bytes, limits);
  const { sheet, sheets, grid, warnings } = await readXlsxGrid(bytes, limits, opts.sheet);
  const table = buildTable(grid, limits, opts);
  return { kind: "xlsx", ...table, warnings: [...warnings, ...table.warnings], sheet, sheets };
}

const isObject = (v: JsonValue): v is { [key: string]: JsonValue } => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumber);
const scalarText = (v: JsonValue): string =>
  v === null ? "" : v instanceof JsonNumber ? v.text : typeof v === "boolean" ? (v ? "true" : "false") : typeof v === "string" ? v : "";
const isScalar = (v: JsonValue) => v === null || typeof v !== "object" || v instanceof JsonNumber;

/** Nested objects → dot paths ("customer.wallet"); arrays of scalars → joined with ";"; arrays of objects → "items.0.sku". */
function flatten(value: JsonValue, prefix: string, out: Map<string, string>): void {
  if (isScalar(value)) { out.set(prefix, scalarText(value)); return; }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) { out.set(prefix, value.map(scalarText).join(";")); return; }
    value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0 && prefix) { out.set(prefix, ""); return; }
  for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
}

/** JSON bytes → table: an array of objects, or an object with one array property ({ "data": [...] }). */
export function readJson(bytes: Uint8Array, opts: JsonOptions = {}): ParsedTable {
  const limits = resolveLimits(opts.limits);
  checkFileSize(bytes, limits);
  const decoded = decodeText(bytes);
  const root = parseJson(decoded.text);
  let items: JsonValue[];
  const warnings: IngestWarning[] = [...decoded.warnings];
  if (Array.isArray(root)) items = root;
  else if (isObject(root)) {
    const arrays = Object.keys(root).filter((k) => Array.isArray(root[k]));
    const key = opts.arrayProperty ?? (arrays.length === 1 ? arrays[0] : undefined);
    if (key === undefined || !Array.isArray(root[key])) {
      throw new IngestError("json_shape", arrays.length === 0
        ? "The JSON file has no list of records. Expected an array of objects, or an object such as { \"data\": [ ... ] }."
        : `The JSON file has several lists (${arrays.map((a) => `"${a}"`).join(", ")}); choose which one holds the records.`);
    }
    items = root[key] as JsonValue[];
    warnings.push({ code: "json_array_property", message: `Records were read from the "${key}" list.` });
  } else {
    throw new IngestError("json_shape", "The JSON file holds a single value, not a list of records.");
  }
  checkRowCount(items.length, limits);
  const flat: Map<string, string>[] = [];
  const order = new Map<string, number>();
  let blank = 0;
  items.forEach((item, i) => {
    if (!isObject(item)) throw new IngestError("json_shape", `Record ${i + 1} is not an object.`, { row: i + 1 });
    const m = new Map<string, string>();
    flatten(item, "", m);
    if ([...m.values()].every((v) => v.trim() === "")) { blank++; flat.push(m); return; }
    for (const k of m.keys()) if (!order.has(k)) order.set(k, order.size);
    flat.push(m);
  });
  const keys = [...order.keys()];
  checkColumnCount(keys.length, limits);
  if (keys.length === 0) throw new IngestError("no_data", "The JSON records have no fields.");
  const headers = uniqueHeaders(keys);
  const rows: TabularRow[] = [];
  flat.forEach((m, i) => {
    if (m.size === 0 || [...m.values()].every((v) => v.trim() === "")) return;
    const cells = keys.map((k) => m.get(k) ?? "");
    cells.forEach((c, j) => checkCell(c, limits, i + 1, headers[j]));
    rows.push({ rowNumber: i + 1, cells });
  });
  if (blank) warnings.push({ code: "blank_rows_skipped", message: `${blank} empty record(s) were skipped.` });
  return { kind: "json", headers, rows, warnings, headerRowNumber: 0, blankRowsSkipped: blank, excludedRows: [], encoding: decoded.encoding };
}

/** Sniff the bytes and read them with the matching reader. MT940 and camt.053 go to the bank parsers instead. */
export async function readTabular(bytes: Uint8Array, opts: DelimitedOptions & XlsxOptions & JsonOptions & { fileName?: string } = {}): Promise<ParsedTable> {
  checkFileSize(bytes, resolveLimits(opts.limits));
  const sniff = sniffFile(bytes, opts.fileName);
  const prepend = (t: ParsedTable): ParsedTable => {
    const extra = sniff.warnings.filter((w) => !t.warnings.some((x) => x.code === w.code));
    return extra.length ? { ...t, warnings: [...extra, ...t.warnings] } : t;
  };
  switch (sniff.kind) {
    case "xlsx": return prepend(await readXlsx(bytes, opts));
    case "json": return prepend(readJson(bytes, opts));
    case "csv":
    case "tsv": return prepend(readDelimited(bytes, { ...opts, delimiter: opts.delimiter ?? sniff.delimiter }));
    case "mt940":
    case "camt053": throw new IngestError("unsupported_file", `This is a ${sniff.kind === "mt940" ? "SWIFT MT940" : "camt.053"} bank statement, not a table; read it as a bank statement.`);
    default: throw new IngestError("unsupported_file", sniff.reason);
  }
}
