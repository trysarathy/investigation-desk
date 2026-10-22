// Strict CSV reading (RFC 4180): UTF-8, one header row, comma-separated, double-quote escaping.
// Nothing is trimmed, coerced or guessed; anything malformed becomes an error the uploader sees.

export interface CsvRecord {
  /** 1-based line number of the record's first line in the file (the header is line 1). */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  header: string[];
  records: CsvRecord[];
  /** Problems that make the whole file unreadable. */
  fileErrors: string[];
  /** Problems confined to one record (e.g. a stray quote); that record is dropped. */
  recordErrors: { line: number; message: string }[];
  notes: string[];
}

export function decodeUtf8(bytes: Uint8Array): { text?: string; error?: string; bom: boolean } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    // fatal: invalid UTF-8 is an error, never replaced with U+FFFD.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text, bom };
  } catch {
    return { error: "File is not valid UTF-8.", bom };
  }
}

export function parseCsv(text: string): CsvParseResult {
  const out: CsvParseResult = { header: [], records: [], fileErrors: [], recordErrors: [], notes: [] };
  if (text.trim() === "") {
    out.fileErrors.push("File is empty.");
    return out;
  }

  const records: { line: number; cells: string[]; error?: string }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let recordLine = 1;
  let error: string | undefined;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    quotedCell = false;
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells, error });
    cells = [];
    error = undefined;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell === "" && !quotedCell) {
        inQuotes = true;
        quotedCell = true;
      } else {
        error ??= "Stray double quote inside an unquoted value.";
        cell += ch;
      }
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r" && text[i + 1] === "\n") {
      // CRLF line ending; the \n ends the record.
    } else if (ch === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      if (quotedCell) error ??= "Text after a closing quote.";
      cell += ch;
    }
  }
  if (inQuotes) {
    out.fileErrors.push(`Unterminated quoted value starting on line ${recordLine}.`);
    return out;
  }
  // A final newline is normal; anything after the last newline is a record.
  if (cell !== "" || cells.length > 0) endRecord();

  const [head, ...rest] = records;
  if (!head || head.error) {
    out.fileErrors.push(head?.error ? `Header row: ${head.error}` : "Missing header row.");
    return out;
  }
  out.header = head.cells;
  for (const r of rest) {
    // A completely empty line is not a record; report it rather than skip silently.
    if (r.cells.length === 1 && r.cells[0] === "") {
      out.notes.push(`Line ${r.line} is blank and was not read as a row.`);
      continue;
    }
    if (r.error) out.recordErrors.push({ line: r.line, message: r.error });
    else out.records.push({ line: r.line, cells: r.cells });
  }
  return out;
}
