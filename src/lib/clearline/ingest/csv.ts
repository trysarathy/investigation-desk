/**
 * RFC 4180 record splitting with a chosen delimiter: quoted fields, "" escapes, embedded newlines, CRLF or LF.
 * Real-world exports bend the rules, so a quote in the middle of an unquoted field is kept as text with a warning;
 * only an unterminated quoted field makes the file unreadable.
 */
import { IngestError, type IngestWarning } from "./errors";
import type { Delimiter } from "./sniff";

export interface RawRecord {
  /** 1-based physical line on which the record starts. */
  line: number;
  cells: string[];
}

export function splitRecords(text: string, delimiter: Delimiter, maxRecords: number): { records: RawRecord[]; warnings: IngestWarning[] } {
  const records: RawRecord[] = [];
  const warnings: IngestWarning[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  const strayLines: number[] = [];
  let stray = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    quoted = false;
    afterQuote = false;
  };
  const endRecord = () => {
    endCell();
    if (stray) strayLines.push(recordLine);
    records.push({ line: recordLine, cells });
    if (records.length > maxRecords) throw new IngestError("too_many_rows", `The file has more than ${maxRecords.toLocaleString("en-US")} rows. Split it into smaller files.`);
    cells = [];
    stray = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; afterQuote = true; }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      if (ch === '"' || afterQuote) stray = true;
      cell += ch;
    }
  }
  if (inQuotes) throw new IngestError("unterminated_quote", `A quoted value that starts on line ${quoteLine} is never closed, so the rest of the file cannot be read. Check for a missing " in that row.`, { row: quoteLine });
  if (cell !== "" || cells.length > 0 || quoted) endRecord();
  if (strayLines.length) {
    warnings.push({
      code: "stray_quote",
      message: `${strayLines.length} row(s) have a double quote inside an unquoted value (first: line ${strayLines[0]}); it was kept as text.`,
      row: strayLines[0],
    });
  }
  return { records, warnings };
}
