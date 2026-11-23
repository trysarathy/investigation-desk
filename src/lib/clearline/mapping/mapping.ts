/**
 * A column mapping: which header (or headers, or a constant) holds each Clearline field of one file type, and how
 * its cells are read. A person confirms every mapping; nothing here confirms one. Pure.
 */
import { z } from "zod";
import { DATE_FORMATS } from "../ingest/dates";
import type { NetworkId } from "../merchant/types";
import { FILE_TYPES, SETTLEMENT_REQUIRED, SETTLEMENT_SHAPES, STATUS_TARGETS, fieldOf, fieldsOf, type FileType, type SettlementShape } from "./catalogue";

export const NETWORK_IDS: readonly NetworkId[] = ["tron", "ethereum", "polygon", "solana", "arbitrum_one", "ton", "base"];
const Text = (max: number) => z.string().min(1).max(max);
const ValueMap = (targets: z.ZodType<string>) => z.record(Text(80), targets).refine((m) => Object.keys(m).length <= 100, "at most 100 values");

export const ColumnMapping = z.object({
  header: Text(200).optional(),
  /** Several columns joined with one space, e.g. ["Date", "Time"], or for a credit/debit split [credit, debit]. */
  headers: z.array(Text(200)).min(2).max(3).optional(),
  constant: Text(200).optional(),
  decimalSeparator: z.enum([".", ","]).optional(),
  dateFormat: z.enum(DATE_FORMATS as unknown as [string, ...string[]]).optional(),
  /** Offset for a date-time written without one, minutes east of UTC. Without it such a value is refused. */
  defaultUtcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  /** Amount signs: one signed column (default), a credit column and a debit column, or the mapped direction field. */
  sign: z.enum(["signed", "credit_debit_columns", "direction_field"]).optional(),
  /** "major": 1,234.56 (default). "minor": whole minor units (cents, token base units) as written. */
  amountUnit: z.enum(["major", "minor"]).optional(),
  statusValueMap: ValueMap(Text(40)).optional(),
  networkValueMap: ValueMap(z.enum(NETWORK_IDS as unknown as [string, ...string[]])).optional(),
  directionValueMap: ValueMap(z.enum(["credit", "debit"])).optional(),
  /** Set on both fields to read one header for two fields (e.g. one date column for created and paid). */
  allowSharedHeader: z.boolean().optional(),
}).strict();
export type ColumnMapping = z.infer<typeof ColumnMapping>;

export const Mapping = z.object({
  fileType: z.enum(FILE_TYPES),
  /** Settlement reports only. */
  shape: z.enum(SETTLEMENT_SHAPES).optional(),
  columns: z.record(Text(64), ColumnMapping),
}).strict();
export type Mapping = z.infer<typeof Mapping>;

export interface MappingIssue { field?: string; header?: string; code: string; message: string }
export type MappingCheck = { ok: true; mapping: Mapping } | { ok: false; issues: MappingIssue[] };

const sources = (c: ColumnMapping) => [c.header, c.headers, c.constant].filter((x) => x !== undefined).length;
export const headersOf = (c: ColumnMapping): string[] => (c.header !== undefined ? [c.header] : c.headers ?? []);

/** The fields a mapping of this type (and settlement shape) must map. */
export function requiredFields(fileType: FileType, shape?: SettlementShape): string[] {
  const base = fieldsOf(fileType).filter((x) => x.required).map((x) => x.key);
  return fileType === "settlement_report" && shape ? [...base, ...SETTLEMENT_REQUIRED[shape]] : base;
}

/**
 * Check a mapping against the catalogue and, when given, the file's headers: every required field mapped, each field
 * from exactly one source, headers that exist, no header read for two fields unless both allow it, options that fit
 * the field's kind, and value maps whose targets are Clearline values.
 */
export function validateMapping(input: unknown, fileHeaders?: readonly string[]): MappingCheck {
  const parsed = Mapping.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.slice(-1).map(String)[0], code: "invalid_mapping", message: `${i.path.join(".")}: ${i.message}` })) };
  const m = parsed.data;
  const issues: MappingIssue[] = [];
  const add = (code: string, message: string, where: { field?: string; header?: string } = {}) => issues.push({ ...where, code, message });
  if (m.fileType === "settlement_report" && !m.shape) add("shape_required", "Choose whether the settlement report has one row per payment or one row per batch with totals.");
  if (m.fileType !== "settlement_report" && m.shape) add("shape_not_allowed", "Only settlement reports have a shape.");
  for (const key of requiredFields(m.fileType, m.shape)) if (!m.columns[key]) add("required_field_unmapped", `${fieldOf(m.fileType, key)?.label ?? key} must be mapped.`, { field: key });
  const used = new Map<string, string[]>();
  for (const [key, c] of Object.entries(m.columns)) {
    const def = fieldOf(m.fileType, key);
    if (!def) { add("unknown_field", `"${key}" is not a field of a ${m.fileType} file.`, { field: key }); continue; }
    if (sources(c) !== 1) { add("one_source", `${def.label}: choose exactly one of a column, several columns or a constant.`, { field: key }); continue; }
    if (c.constant !== undefined && !def.allowConstant) add("constant_not_allowed", `${def.label} must come from a column.`, { field: key });
    const split = c.sign === "credit_debit_columns";
    if (c.headers && !def.allowMultiple) add("multiple_not_allowed", `${def.label} reads one column.`, { field: key });
    if (c.headers && def.kind === "fiat_amount" && !split) add("multiple_not_allowed", `${def.label}: two amount columns are read only as a credit and a debit column.`, { field: key });
    if (split && c.headers?.length !== 2) add("split_needs_two_columns", `${def.label}: choose the credit column, then the debit column.`, { field: key });
    if (c.sign && (def.kind !== "fiat_amount" || m.fileType !== "bank_statement" || key !== "amount")) add("sign_not_allowed", `${def.label} has no sign option.`, { field: key });
    if (c.sign === "direction_field" && !m.columns.direction) add("direction_unmapped", "Map the direction column to read amount signs from it.", { field: key });
    if (c.decimalSeparator && !["fiat_amount", "token_amount", "rate"].includes(def.kind)) add("option_not_allowed", `${def.label} has no decimal separator.`, { field: key });
    if (c.amountUnit && !["fiat_amount", "token_amount"].includes(def.kind)) add("option_not_allowed", `${def.label} has no amount unit.`, { field: key });
    if ((c.dateFormat || c.defaultUtcOffsetMinutes !== undefined) && !["date", "datetime"].includes(def.kind)) add("option_not_allowed", `${def.label} is not a date.`, { field: key });
    if (c.networkValueMap && def.kind !== "network") add("option_not_allowed", `${def.label} is not a network.`, { field: key });
    if (c.directionValueMap && def.kind !== "direction") add("option_not_allowed", `${def.label} is not a direction.`, { field: key });
    if (c.statusValueMap) {
      const targets = STATUS_TARGETS[m.fileType]?.[key];
      if (!targets) add("option_not_allowed", `${def.label} has no status words.`, { field: key });
      else for (const [word, to] of Object.entries(c.statusValueMap)) if (!targets.includes(to)) add("invalid_status_target", `"${word}" is mapped to "${to}", which is not one of ${targets.join(", ")}.`, { field: key });
    } else if (def.kind === "status" && STATUS_TARGETS[m.fileType]?.[key] && c.constant === undefined) {
      add("status_words_unmapped", `${def.label}: say what each of the file's status words means.`, { field: key });
    }
    for (const h of headersOf(c)) {
      if (fileHeaders && !fileHeaders.includes(h)) add("header_not_in_file", `${def.label}: the file has no column "${h}".`, { field: key, header: h });
      used.set(h, [...(used.get(h) ?? []), key]);
    }
  }
  for (const [h, keys] of used) {
    if (keys.length > 1 && !keys.every((k) => m.columns[k].allowSharedHeader)) add("header_used_twice", `The column "${h}" is mapped to ${keys.join(" and ")}; allow sharing on both to read it twice.`, { header: h });
  }
  return issues.length ? { ok: false, issues } : { ok: true, mapping: m };
}
