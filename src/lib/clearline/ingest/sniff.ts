/**
 * What is this file? Encoding, kind, delimiter and header row, decided from the bytes and the text — never from the
 * file name alone. Pure: no disk, no clock.
 */
import { IngestError, type IngestWarning } from "./errors";

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export interface DecodedText { text: string; encoding: TextEncoding; bom: boolean; warnings: IngestWarning[] }

/** windows-1252 bytes 0x80–0x9F; 0 marks the five bytes the code page leaves undefined. */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function decodeCp1252(bytes: Uint8Array): string | undefined {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80 || b >= 0xa0) out += String.fromCharCode(b);
    else {
      const cp = CP1252_HIGH[b - 0x80];
      if (cp === 0) return undefined;
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

function strictDecode(label: "utf-8" | "utf-16le" | "utf-16be", bytes: Uint8Array): string | undefined {
  try {
    // fatal: an invalid sequence is an error, never silently replaced with U+FFFD. ignoreBOM: we strip it ourselves.
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Decode text bytes. A BOM decides UTF-8 or UTF-16 LE/BE. Without a BOM the bytes must be valid UTF-8; if they are not,
 * windows-1252 is tried and a warning says so. Anything else (or a NUL byte in 8-bit text) is refused.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const warnings: IngestWarning[] = [];
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = strictDecode("utf-16le", bytes.subarray(2));
    if (text === undefined) throw new IngestError("invalid_encoding", "The file starts with a UTF-16 (little-endian) marker but is not valid UTF-16.");
    return { text, encoding: "utf-16le", bom: true, warnings };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = strictDecode("utf-16be", bytes.subarray(2));
    if (text === undefined) throw new IngestError("invalid_encoding", "The file starts with a UTF-16 (big-endian) marker but is not valid UTF-16.");
    return { text, encoding: "utf-16be", bom: true, warnings };
  }
  if (bytes.indexOf(0) !== -1) throw new IngestError("binary_file", "The file contains NUL bytes, so it is not a text file (or it is UTF-16 without a byte-order mark). Save it as UTF-8 CSV.");
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const utf8 = strictDecode("utf-8", bom ? bytes.subarray(3) : bytes);
  if (utf8 !== undefined) return { text: utf8, encoding: "utf-8", bom, warnings };
  if (bom) throw new IngestError("invalid_encoding", "The file starts with a UTF-8 marker but is not valid UTF-8.");
  const legacy = decodeCp1252(bytes);
  if (legacy === undefined) throw new IngestError("invalid_encoding", "The file is neither valid UTF-8 nor windows-1252 text. Save it as UTF-8 CSV.");
  warnings.push({
    code: "encoding_windows_1252",
    message: "The file is not valid UTF-8; it was read as windows-1252 (the usual Excel encoding on Windows). Check accented letters and symbols such as € in the preview.",
  });
  return { text: legacy, encoding: "windows-1252", bom: false, warnings };
}

export type FileKind = "csv" | "tsv" | "xlsx" | "json" | "mt940" | "camt053";
export type SniffResult =
  | { kind: FileKind; reason: string; encoding?: TextEncoding; delimiter?: Delimiter; warnings: IngestWarning[] }
  | { kind: "unknown"; reason: string; warnings: IngestWarning[] };

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));

/** Does the zip contain an Excel workbook part? File names in a zip are stored uncompressed. */
function zipHasWorkbook(bytes: Uint8Array): boolean {
  const needle = [0x78, 0x6c, 0x2f, 0x77, 0x6f, 0x72, 0x6b, 0x62, 0x6f, 0x6f, 0x6b]; // "xl/workbook"
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** MT940 shape: a :20: reference and at least one balance or statement-line field. */
export const looksLikeMt940 = (text: string): boolean => /(^|[\r\n{]|\{4:\s*)\s*:20:/.test(text) && /(^|[\r\n]):(60[FM]|61|62[FM]):/.test(text);
export const looksLikeCamt053 = (text: string): boolean => /^\s*</.test(text) && /camt\.053\./.test(text);

/**
 * Decide the file kind from content. The file name never decides it: it only adds a warning when its extension
 * disagrees with the content.
 */
export function sniffFile(bytes: Uint8Array, fileName?: string): SniffResult {
  if (bytes.length === 0) return { kind: "unknown", reason: "The file is empty.", warnings: [] };
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return zipHasWorkbook(bytes)
      ? { kind: "xlsx", reason: "Zip container with an Excel workbook part.", warnings: [] }
      : { kind: "unknown", reason: "This is a zip file, but not an Excel (.xlsx) workbook.", warnings: [] };
  }
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return { kind: "unknown", reason: "This is an old-style Excel (.xls) file. Open it in Excel and save it as .xlsx or CSV.", warnings: [] };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "unknown", reason: "This is a PDF. Download the statement as CSV, Excel, MT940 or camt.053 instead.", warnings: [] };

  let decoded: DecodedText;
  try {
    decoded = decodeText(bytes);
  } catch (e) {
    return { kind: "unknown", reason: e instanceof Error ? e.message : String(e), warnings: [] };
  }
  const { text, encoding, warnings } = decoded;
  const head = text.slice(0, 65_536);
  const trimmed = head.trimStart();
  const named = (kind: FileKind): IngestWarning[] => {
    const ext = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    const expected: Record<string, FileKind[]> = { csv: ["csv", "tsv"], tsv: ["tsv", "csv"], txt: ["csv", "tsv", "mt940"], json: ["json"], xml: ["camt053"], sta: ["mt940"], mt940: ["mt940"], xlsx: ["xlsx"] };
    if (ext === undefined || !(ext in expected) || expected[ext].includes(kind)) return warnings;
    return [...warnings, { code: "extension_mismatch", message: `The file is named .${ext} but its content is ${kind.toUpperCase()}; it was read as ${kind.toUpperCase()}.` }];
  };
  if (looksLikeMt940(head)) return { kind: "mt940", reason: "SWIFT MT940 fields (:20:, :60F:, :61:).", encoding, warnings: named("mt940") };
  if (trimmed.startsWith("{")) return { kind: "json", reason: "Text starting with a JSON object.", encoding, warnings: named("json") };
  if (trimmed.startsWith("[")) return { kind: "json", reason: "Text starting with a JSON array.", encoding, warnings: named("json") };
  if (looksLikeCamt053(head)) return { kind: "camt053", reason: "ISO 20022 camt.053 XML.", encoding, warnings: named("camt053") };
  if (trimmed.startsWith("<")) return { kind: "unknown", reason: "This is XML or HTML, but not a camt.053 bank statement.", warnings };

  const delimiter = detectDelimiter(head);
  if (text.trim() === "") return { kind: "unknown", reason: "The file has no text.", warnings };
  if (delimiter === undefined) return { kind: "csv", reason: "Single-column text.", encoding, delimiter: ",", warnings: named("csv") };
  const kind: FileKind = delimiter === "\t" ? "tsv" : "csv";
  return { kind, reason: `Delimited text separated by ${DELIMITER_NAMES[delimiter]}.`, encoding, delimiter, warnings: named(kind) };
}

export type Delimiter = "," | ";" | "\t" | "|";
export const DELIMITERS: readonly Delimiter[] = [",", ";", "\t", "|"];
export const DELIMITER_NAMES: Readonly<Record<Delimiter, string>> = { ",": "commas", ";": "semicolons", "\t": "tabs", "|": "vertical bars" };

/** Count each candidate delimiter outside double quotes, per line, over the first lines of the text. */
function delimiterCounts(text: string, maxLines: number): Record<Delimiter, number[]> {
  const counts: Record<Delimiter, number[]> = { ",": [], ";": [], "\t": [], "|": [] };
  let current: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  let inQuotes = false;
  let lineHasText = false;
  let lines = 0;
  const flush = () => {
    if (lineHasText) {
      for (const d of DELIMITERS) counts[d].push(current[d]);
      lines++;
    }
    current = { ",": 0, ";": 0, "\t": 0, "|": 0 };
    lineHasText = false;
  };
  for (let i = 0; i < text.length && lines < maxLines; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) flush();
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t" || ch === "|")) current[ch]++;
    if (ch !== "\n" && ch !== "\r" && ch !== " ") lineHasText = true;
  }
  flush();
  return counts;
}

/**
 * The delimiter that splits the most lines into the same number of fields (title lines with none are ignored).
 * Ties go to the more fields, then to the order , ; tab |. Undefined when no candidate appears at all.
 */
export function detectDelimiter(text: string, maxLines = 50): Delimiter | undefined {
  const counts = delimiterCounts(text, maxLines);
  let best: { d: Delimiter; score: number; width: number } | undefined;
  for (const d of DELIMITERS) {
    const freq = new Map<number, number>();
    for (const c of counts[d]) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let score = 0;
    for (const [c, n] of freq) if (n > score || (n === score && c > mode)) { mode = c; score = n; }
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && mode > best.width)) best = { d, score, width: mode };
  }
  return best?.d;
}

const NUMERIC_LIKE = /^[\s()+\-−$€£¥]*[\d.,'\s:/\-]+[\s()\-A-Za-z]{0,4}$/;

/**
 * The index of the header row: the first row that spans (nearly) the full width of the table, is at least as wide as
 * the row after it, and is mostly labels rather than numbers or dates. Leading title and blank rows are skipped.
 * Falls back to the first non-blank row.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[], maxScan = 50): number {
  const nonEmpty = (r: readonly string[]) => r.filter((c) => c.trim() !== "").length;
  const scan = rows.slice(0, maxScan);
  const widths = scan.map(nonEmpty);
  const maxW = Math.max(0, ...widths);
  if (maxW === 0) return 0;
  const threshold = Math.ceil(maxW * 0.8);
  for (let i = 0; i < scan.length; i++) {
    if (widths[i] < threshold) continue;
    let next = i + 1;
    while (next < scan.length && widths[next] === 0) next++;
    if (next < scan.length && widths[next] > widths[i]) continue;
    const cells = scan[i].filter((c) => c.trim() !== "");
    const labels = cells.filter((c) => !NUMERIC_LIKE.test(c.trim())).length;
    if (labels / cells.length >= 0.7) return i;
  }
  const first = widths.findIndex((w) => w > 0);
  return first < 0 ? 0 : first;
}
