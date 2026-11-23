/**
 * rc7 column mapping: field catalogue, header suggestions, mapping validation and applyMapping. Pure functions (no
 * database, disk, network or clock), importable from browser code.
 */
export {
  CATALOGUE, FIELD_KINDS, FILE_TYPES, SETTLEMENT_REQUIRED, SETTLEMENT_SHAPES, STATUS_TARGETS, fieldOf, fieldsOf,
  type FieldDef, type FieldKind, type FileType, type SettlementShape,
} from "./catalogue";
export { ColumnMapping, Mapping, NETWORK_IDS, headersOf, requiredFields, validateMapping, type MappingCheck, type MappingIssue } from "./mapping";
export { headerTokens, suggestMapping, type FieldSuggestion, type HeaderCandidate, type MappingSuggestion } from "./suggest";
export { applyMapping, type AppliedRow, type ApplyOptions, type ApplyResult, type ColumnIssue, type MappedValue, type RowIssue, type TableLike } from "./apply";

/**
 * The header list as compared for auto-applying a template: each header NFC-normalised, trimmed, inner whitespace
 * collapsed and lower-cased, then sorted (column order may change between exports). The server hashes this.
 */
export function normalisedHeaderList(headers: readonly string[]): string[] {
  return headers.map((h) => h.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase()).sort();
}
