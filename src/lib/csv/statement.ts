/**
 * The rc5 bank-statement CSV rules, as a pure parser: bytes in, validated statement lines or every error out. No
 * database, no disk, no clock. Moved verbatim from src/server/imports.ts (which re-exports it and documents the format
 * and the import service's guarantees) so that local tools, such as the rc6 Case Reconstruction CLI, apply exactly the
 * same rules without loading any server module.
 */
import { isCurrency, parseAmount } from "@/lib/clearline/money";
import type { CurrencyCode, StatementLineInput } from "@/lib/clearline/types";
import { decodeUtf8, parseCsv } from "./parse";

export const MAX_FILE_BYTES = 1_048_576;
/**
 * Rows per file. The engine re-derives the organisation's state per line (cost grows with the workspace): measured
 * 0.4 s for 100 lines and 2.4 s for 300 on the seed, so files are capped at 200 lines until a batch-ingest engine
 * action exists. Larger statements are split into several files.
 */
export const MAX_ROWS = 200;
/** Errors kept per rejected import (the total is always reported). */
export const MAX_STORED_ERRORS = 500;
const MAX_VALUE_ECHO = 80;

export const STATEMENT_COLUMNS = ["line_id", "account_ref", "value_date", "direction", "kind", "amount", "currency", "reference", "counterparty"] as const;
export type StatementColumn = (typeof STATEMENT_COLUMNS)[number];
type Column = StatementColumn;

export type ImportErrorCode =
  | "file_empty" | "file_too_large" | "nul_byte" | "invalid_utf8" | "unreadable_csv" | "too_many_rows" | "no_rows"
  | "missing_column" | "unknown_column" | "duplicate_column" | "malformed_row" | "wrong_column_count"
  | "missing_value" | "too_long" | "invalid_format" | "forbidden_character" | "invalid_amount" | "invalid_currency"
  | "invalid_date" | "unknown_direction" | "unknown_kind" | "duplicate_line_id" | "engine_refused";

export interface ImportError {
  /** 1-based physical line in the file (the header is line 1); null for a file-level error. */
  row: number | null;
  column: string | null;
  code: ImportErrorCode | string;
  message: string;
  /** The offending cell, truncated; raw text, never evaluated. */
  value?: string;
}

export interface ParsedStatementRow { row: number; line: StatementLineInput }

export type ParseResult =
  | { ok: true; rows: ParsedStatementRow[]; rowCount: number; notes: string[] }
  | { ok: false; errors: ImportError[]; errorCount: number; rowCount: number; notes: string[] };

export interface ParseOptions { maxBytes?: number; maxRows?: number }

const fileError = (code: ImportErrorCode, message: string, rowCount = 0): ParseResult =>
  ({ ok: false, errors: [{ row: null, column: null, code, message }], errorCount: 1, rowCount, notes: [] });

const echo = (v: string) => (v.length > MAX_VALUE_ECHO ? v.slice(0, MAX_VALUE_ECHO) + "…" : v);

// Character classes checked one code point at a time (no backtracking regex on untrusted input).
const LINE_ID_RE = /^[A-Za-z0-9_\-:.]{1,64}$/;
const ACCOUNT_RE = /^[\p{L}\p{N} ()/.,:;'_&#+-]{2,64}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function hasForbiddenText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3c || c === 0x3e) return true;                                 // < >
    if ((c < 0x20 && c !== 0x09) || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return true; // controls except TAB
    if (c === 0x2028 || c === 0x2029) return true;                              // line / paragraph separators
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f || c === 0x061c) return true; // bidi controls (spoofed references)
  }
  return false;
}
function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Pure, bounded parser: bytes in, validated engine inputs or every error out. No database, no disk, no clock.
 * Work is linear in the input, which is capped at `maxBytes` before decoding.
 */
export function parseStatementCsv(bytes: Uint8Array, opts: ParseOptions = {}): ParseResult {
  const maxBytes = Math.min(opts.maxBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
  const maxRows = Math.min(opts.maxRows ?? MAX_ROWS, MAX_ROWS);
  if (!(bytes instanceof Uint8Array)) return fileError("unreadable_csv", "The upload is not a file.");
  if (bytes.byteLength === 0) return fileError("file_empty", "The file is empty.");
  if (bytes.byteLength > maxBytes) return fileError("file_too_large", `The file is ${bytes.byteLength} bytes; the limit is ${maxBytes} bytes.`);
  if (bytes.indexOf(0) !== -1) return fileError("nul_byte", "The file contains a NUL byte; it is not a text CSV.");
  const decoded = decodeUtf8(bytes);
  if (decoded.text === undefined) return fileError("invalid_utf8", "The file is not valid UTF-8.");
  const text = decoded.text.startsWith("﻿") ? decoded.text.slice(1) : decoded.text;

  const csv = parseCsv(text);
  if (csv.fileErrors.length) return fileError("unreadable_csv", csv.fileErrors.join(" "));
  const rowCount = csv.records.length + csv.recordErrors.length;
  if (rowCount > maxRows) return fileError("too_many_rows", `The file has ${rowCount} rows; the limit is ${maxRows}.`, rowCount);

  // header: exactly the nine columns, any order
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();
  for (const h of csv.header) {
    seen.set(h, (seen.get(h) ?? 0) + 1);
    if (!(STATEMENT_COLUMNS as readonly string[]).includes(h)) errors.push({ row: 1, column: echo(h), code: "unknown_column", message: `Unknown column "${echo(h)}". Only ${STATEMENT_COLUMNS.join(", ")} are allowed.`, value: echo(h) });
  }
  for (const [h, n] of seen) if (n > 1) errors.push({ row: 1, column: echo(h), code: "duplicate_column", message: `Column "${echo(h)}" appears ${n} times.`, value: echo(h) });
  for (const c of STATEMENT_COLUMNS) if (!seen.has(c)) errors.push({ row: 1, column: c, code: "missing_column", message: `Required column "${c}" is missing.` });
  if (errors.length) return { ok: false, errors, errorCount: errors.length, rowCount, notes: csv.notes };
  if (rowCount === 0) return fileError("no_rows", "The file has a header but no statement lines.");

  const index = Object.fromEntries(STATEMENT_COLUMNS.map((c) => [c, csv.header.indexOf(c)])) as Record<Column, number>;
  let errorCount = 0;
  const push = (e: ImportError) => { errorCount++; if (errors.length < MAX_STORED_ERRORS) errors.push(e); };
  for (const r of csv.recordErrors) push({ row: r.line, column: null, code: "malformed_row", message: r.message });

  const rows: ParsedStatementRow[] = [];
  const keys = new Map<string, number>();
  for (const rec of csv.records) {
    if (rec.cells.length !== STATEMENT_COLUMNS.length) {
      push({ row: rec.line, column: null, code: "wrong_column_count", message: `Expected ${STATEMENT_COLUMNS.length} values, found ${rec.cells.length}.` });
      continue;
    }
    const cell = (c: Column) => rec.cells[index[c]];
    const bad = (column: Column, code: ImportErrorCode, message: string) => push({ row: rec.line, column, code, message, value: echo(cell(column)) });
    const before = errorCount;

    const lineId = cell("line_id");
    if (lineId === "") bad("line_id", "missing_value", "line_id is required.");
    else if (lineId.length > 64) bad("line_id", "too_long", "line_id is at most 64 characters.");
    else if (!LINE_ID_RE.test(lineId)) bad("line_id", "invalid_format", "line_id may contain only letters, digits and _ - : .");

    const accountRef = cell("account_ref");
    if (accountRef === "") bad("account_ref", "missing_value", "account_ref is required.");
    else if (accountRef.length > 64) bad("account_ref", "too_long", "account_ref is at most 64 characters.");
    else if (!ACCOUNT_RE.test(accountRef)) bad("account_ref", "invalid_format", "account_ref must be 2-64 letters, digits, spaces or ( ) / . , : ; ' _ & # + -");

    const valueDate = cell("value_date");
    if (valueDate === "") bad("value_date", "missing_value", "value_date is required.");
    else if (valueDate.length !== 10 || !isRealDate(valueDate)) bad("value_date", "invalid_date", "value_date must be a real calendar date written YYYY-MM-DD.");

    const direction = cell("direction");
    if (direction !== "debit" && direction !== "credit") bad("direction", direction === "" ? "missing_value" : "unknown_direction", "direction must be debit or credit.");

    const kind = cell("kind");
    if (kind !== "payment" && kind !== "return" && kind !== "reversal") bad("kind", kind === "" ? "missing_value" : "unknown_kind", "kind must be payment, return or reversal.");

    const currency = cell("currency");
    const currencyOk = isCurrency(currency);
    if (!currencyOk) bad("currency", currency === "" ? "missing_value" : "invalid_currency", "currency must be one of SGD, USD, PHP, EUR, USDC.");

    const amount = cell("amount");
    let amountMinor = 0;
    if (amount === "") bad("amount", "missing_value", "amount is required.");
    else if (amount.length > 32) bad("amount", "too_long", "amount is at most 32 characters.");
    else if (amount.trim() !== amount) bad("amount", "invalid_amount", "amount must not have leading or trailing spaces.");
    else if (currencyOk) {
      const p = parseAmount(amount, currency as CurrencyCode);
      if (p.ok) amountMinor = p.value;
      else bad("amount", "invalid_amount", `${p.error.message} (amount must be a positive plain decimal such as 1234.50: no sign, exponent or thousands separator)`);
    } else if (!/^\d{1,15}(\.\d{1,6})?$/.test(amount)) bad("amount", "invalid_amount", "amount must be a positive plain decimal such as 1234.50.");

    for (const [col, max] of [["reference", 140], ["counterparty", 120]] as const) {
      const v = cell(col);
      if (v.length > max) bad(col, "too_long", `${col} is at most ${max} characters.`);
      else if (hasForbiddenText(v)) bad(col, "forbidden_character", `${col} must be plain text: no < >, line breaks or control characters.`);
    }

    if (errorCount === before) {
      const key = `${accountRef}\u0000${lineId}`;
      const first = keys.get(key);
      if (first !== undefined) {
        bad("line_id", "duplicate_line_id", `line_id ${lineId} for account ${accountRef} already appears on line ${first}.`);
        continue;
      }
      keys.set(key, rec.line);
      rows.push({ row: rec.line, line: {
        lineId, source: "bank_statement", accountRef, direction: direction as "debit" | "credit", kind: kind as "payment" | "return" | "reversal",
        amountMinor, currency: currency as CurrencyCode, reference: cell("reference"), counterparty: cell("counterparty"), valueDate,
      } });
    }
  }
  if (errorCount) return { ok: false, errors, errorCount, rowCount, notes: csv.notes };
  return { ok: true, rows, rowCount, notes: csv.notes };
}
