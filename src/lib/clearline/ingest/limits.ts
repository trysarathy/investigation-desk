/** Upload limits. Every reader enforces them; a caller may lower a limit but never raise it. */
import { IngestError } from "./errors";

export interface IngestLimits {
  maxFileBytes: number;
  maxDataRows: number;
  maxColumns: number;
  maxCellChars: number;
}

/** 20 MB is 20 × 1024 × 1024 bytes [ASSUMPTION: binary megabytes]. */
export const LIMITS: Readonly<IngestLimits> = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxDataRows: 100_000,
  maxColumns: 200,
  maxCellChars: 10_000,
});

/** The effective limits: each override is honoured only when it is stricter than the default. */
export function resolveLimits(overrides: Partial<IngestLimits> = {}): IngestLimits {
  const pick = (k: keyof IngestLimits) => {
    const v = overrides[k];
    return typeof v === "number" && v > 0 && v < LIMITS[k] ? v : LIMITS[k];
  };
  return { maxFileBytes: pick("maxFileBytes"), maxDataRows: pick("maxDataRows"), maxColumns: pick("maxColumns"), maxCellChars: pick("maxCellChars") };
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function checkFileSize(bytes: Uint8Array, limits: IngestLimits): void {
  if (!(bytes instanceof Uint8Array)) throw new IngestError("unsupported_file", "The upload is not a file.");
  if (bytes.byteLength === 0) throw new IngestError("file_empty", "The file is empty.");
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new IngestError("file_too_large", `The file is ${mb(bytes.byteLength)}; the largest file accepted is ${mb(limits.maxFileBytes)}. Split it into smaller files.`);
  }
}

export function checkRowCount(count: number, limits: IngestLimits): void {
  if (count > limits.maxDataRows) {
    throw new IngestError("too_many_rows", `The file has more than ${limits.maxDataRows.toLocaleString("en-US")} data rows. Split it into smaller files.`);
  }
}

export function checkColumnCount(count: number, limits: IngestLimits, row?: number): void {
  if (count > limits.maxColumns) {
    throw new IngestError("too_many_columns", `The file has ${count} columns; at most ${limits.maxColumns} are accepted.`, { row });
  }
}

export function checkCell(value: string, limits: IngestLimits, row: number, column?: string): void {
  if (value.length > limits.maxCellChars) {
    throw new IngestError("cell_too_long", `A value in row ${row}${column ? ` (column "${column}")` : ""} is ${value.length.toLocaleString("en-US")} characters long; at most ${limits.maxCellChars.toLocaleString("en-US")} are accepted.`, { row, column });
  }
}

/** The first `n` data rows (default 20), everything else unchanged. */
export function preview<T extends { rows: readonly unknown[] }>(parsed: T, n = 20): T {
  return { ...parsed, rows: parsed.rows.slice(0, Math.max(0, Math.floor(n))) };
}
