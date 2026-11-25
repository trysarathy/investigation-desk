/**
 * Shared result, warning and error shapes for the ingest module. Value-level parsers (amounts, dates) return a
 * Result so a UI can show one message per cell; file-level readers throw an IngestError whose `code` is stable and
 * whose `message` is plain English for the person uploading.
 */

export type IngestErrorCode =
  | "file_empty" | "file_too_large" | "too_many_rows" | "too_many_columns" | "cell_too_long"
  | "binary_file" | "invalid_encoding" | "unsupported_file" | "unterminated_quote" | "no_header"
  | "invalid_json" | "json_shape" | "sheet_not_found" | "invalid_xlsx" | "no_data"
  | "invalid_mt940" | "invalid_camt053" | "invalid_camt054" | "invalid_bai2" | "multiple_accounts" | "unsafe_xml" | "unknown_currency" | "invalid_amount" | "invalid_date"
  | "invalid_option";

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  /** 1-based row (physical line, sheet row or JSON item) when the problem is confined to one place. */
  readonly row?: number;
  readonly column?: string;
  /** rc7 blind test: the choices the person must pick from to read the file (e.g. a JSON file's lists), never cell values. */
  readonly choices?: string[];
  constructor(code: IngestErrorCode, message: string, where: { row?: number; column?: string; choices?: string[] } = {}) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    if (where.row !== undefined) this.row = where.row;
    if (where.column !== undefined) this.column = where.column;
    if (where.choices !== undefined) this.choices = where.choices;
  }
}

/** Something the person should know about, which did not stop the file from being read. */
export interface IngestWarning {
  code: string;
  message: string;
  row?: number;
  column?: string;
}

export type Result<T, C extends string = string> =
  | { ok: true; value: T }
  | { ok: false; code: C; message: string };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const fail = <C extends string>(code: C, message: string): { ok: false; code: C; message: string } => ({ ok: false, code, message });

/** Small non-negative decimal integer from ASCII digits, digit by digit (dates, offsets and indices only; never amounts). */
export function smallInt(digits: string): number {
  let n = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return -1;
    n = n * 10 + d;
  }
  return digits.length === 0 ? -1 : n;
}

/** Truncate untrusted text before echoing it in a message. */
export const echo = (v: string, max = 60): string => (v.length > max ? v.slice(0, max) + "…" : v);
