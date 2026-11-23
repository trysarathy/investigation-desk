/**
 * Clearline ingest: the bytes of a real-world file → rows a person can map, or bank-statement lines. Pure functions
 * (no database, disk, network, clock or randomness).
 *
 * Content hashes (sha256Hex, rowHash) live in "./hash" and are deliberately not re-exported here: hash.ts imports
 * node:crypto, and keeping it out of this entry point keeps the rest importable from browser code.
 *
 * Value parsers return a Result; file readers throw an IngestError with a stable `code` and a plain-English message.
 */
export { IngestError, type IngestErrorCode, type IngestWarning, type Result } from "./errors";
export { LIMITS, preview, resolveLimits, type IngestLimits } from "./limits";
export {
  decodeText, detectDelimiter, detectHeaderRow, sniffFile,
  type DecodedText, type Delimiter, type FileKind, type SniffResult, type TextEncoding,
} from "./sniff";
export {
  detectDecimalSeparator, formatMinor, parseAmount, MAX_PRECISION,
  type AmountErrorCode, type AmountOptions, type AmountResult, type DecimalSeparator, type DecimalStyleDetection,
} from "./decimal";
export {
  detectDateFormat, parseDate, parseDateColumn, DATE_FORMATS,
  type DateColumnResult, type DateDetection, type DateFormat, type DateOptions, type DateResult, type ParsedDate,
} from "./dates";
export {
  readDelimited, readJson, readTabular, readXlsx,
  type DelimitedOptions, type ExcludedRow, type JsonOptions, type ParsedTable, type ReadOptions, type TabularKind, type TabularRow, type XlsxOptions,
} from "./tabular";
export { parseMt940, type Mt940Options } from "./bank/mt940";
export { parseCamt053, type Camt053Options } from "./bank/camt053";
export { BANK_CURRENCY_DECIMALS, currencyPrecision } from "./bank/currency";
export {
  assignLineIds, expectedClosing,
  type BankDirection, type BankLine, type BankLineDraft, type BankParseResult, type BankSourceFormat, type BankStatement, type SkippedEntry, type StatedBalance,
} from "./bank/types";
