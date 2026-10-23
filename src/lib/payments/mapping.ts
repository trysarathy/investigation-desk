// Column mappings for payment-record imports. A mapping says which column in the company's (or
// provider's) file holds each canonical field, and how raw values translate (chain names,
// statuses, row types). Mappings are saved and versioned: an edit is a new version, and every
// imported record names the mapping version that read it. Nothing is guessed: a value outside
// the mapping is a row error, except a provider status or row type, which is kept raw as "unmapped".

import { createHash } from "node:crypto";
import { checkAddress, checkTimestamp, customerIdCheck, HASH, readTable, sha256Bytes, type Column, type RowError, type ValidationResult } from "../csv/files";
import { isDecimal } from "../decimal";
import { ALL_CHAINS } from "../types";
import { FIELDS, ROW_TYPES, STATUS_MEANINGS, type ColumnMapping, type FieldSpec } from "./fields";
import type { BankRecord, Identifier, InstructionRecord, PaymentRecord, ProviderRecord, ProviderRowType, ProviderStatusMeaning } from "./types";

export { FIELDS, ROW_TYPES, STATUS_MEANINGS, type ColumnMapping, type FieldSpec } from "./fields";

/** Problems that make a mapping unusable. Empty means it can be saved. */
export function checkMapping(m: ColumnMapping): string[] {
  const errs: string[] = [];
  const specs = FIELDS[m.kind];
  if (!specs) return [`Unknown import kind "${m.kind}".`];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(m.mappingId)) errs.push("Mapping ID must be lower-case letters, digits and dashes.");
  if (!m.name.trim()) errs.push("Mapping needs a name.");
  if (m.kind === "provider" && !m.provider?.trim()) errs.push("A provider mapping must name the provider.");
  for (const s of specs) if (s.required && !m.columns[s.field]) errs.push(`Required field "${s.label}" has no column.`);
  for (const f of Object.keys(m.columns)) if (!specs.some((s) => s.field === f)) errs.push(`Unknown field "${f}".`);
  const used = Object.entries(m.columns).filter(([, c]) => c);
  for (const [f, c] of used) {
    const other = used.find(([g, d]) => d === c && g !== f);
    if (other && f < other[0]) errs.push(`Column "${c}" is mapped to both "${f}" and "${other[0]}".`);
  }
  for (const [raw, v] of Object.entries(m.values?.chain ?? {})) if (!ALL_CHAINS.includes(v)) errs.push(`Chain value "${raw}" maps to unknown chain "${v}".`);
  for (const [raw, v] of Object.entries(m.values?.token ?? {})) if (!["USDT", "USDC"].includes(v)) errs.push(`Token value "${raw}" maps to unknown token "${v}".`);
  for (const [raw, v] of Object.entries(m.values?.status ?? {})) if (!STATUS_MEANINGS.includes(v)) errs.push(`Status "${raw}" maps to unknown meaning "${v}".`);
  for (const [raw, v] of Object.entries(m.values?.type ?? {})) if (!ROW_TYPES.includes(v)) errs.push(`Row type "${raw}" maps to unknown type "${v}".`);
  for (const [raw, v] of Object.entries(m.values?.direction ?? {})) if (v !== "credit" && v !== "debit") errs.push(`Direction "${raw}" must map to credit or debit.`);
  return errs;
}

const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ANY_ADDRESS = /^(T[1-9A-HJ-NP-Za-km-z]{33}|0x[0-9a-fA-F]{40})$/;
export const MAX_IMPORT_ROWS = 200_000;

export interface ImportContext {
  importId: string;
  fileName: string;
  now: Date;
}

/** Read one file with one mapping. Rows that break a rule are rejected and listed, never fixed. */
export function importWithMapping(bytes: Uint8Array, m: ColumnMapping, ctx: ImportContext): ValidationResult<PaymentRecord> {
  const mappingErrors = checkMapping(m);
  const specs = FIELDS[m.kind] ?? [];
  const col = (field: string) => m.columns[field];
  const columns: Column[] = specs.filter((s) => col(s.field)).map((s) => ({
    name: col(s.field)!, required: s.required, check: (v: string) => checkValue(s, v, m),
  }));
  if (mappingErrors.length) {
    return { sha256: "", fileErrors: mappingErrors.map((e) => `Mapping: ${e}`), rows: [], rowErrors: [], ignoredColumns: [], notes: [] };
  }
  const fileSha256 = sha256Bytes(bytes);
  const res = readTable<PaymentRecord>(bytes, columns, MAX_IMPORT_ROWS, (row, line) => {
    const get = (field: string) => (col(field) ? row[col(field)!] || undefined : undefined);
    const fields: Record<string, string | undefined> = Object.fromEntries(specs.map((s) => [s.field, get(s.field)]));
    const crossErr = crossCheck(m, fields, line);
    if (crossErr) return crossErr;
    return buildRecord(m, fields, row, { ...ctx, fileSha256, line });
  });
  if (!res.fileErrors.length && res.header) {
    for (const s of specs) {
      const c = col(s.field);
      if (c && !s.required && !res.header.includes(c)) res.notes.push(`Mapped column "${c}" (${s.label}) is not in this file, so that field is empty on every row.`);
    }
  }
  return res;
}

function checkValue(s: FieldSpec, v: string, m: ColumnMapping): string | undefined {
  switch (s.type) {
    case "id":
      // Identifiers are references, never personal data: same rule as customer IDs.
      return v.length > 200 ? "Longer than 200 characters." : customerIdCheck(v.slice(0, 100));
    case "text":
      return v.length > 1000 ? "Longer than 1000 characters." : undefined;
    case "raw":
      return v.length > 100 ? "Longer than 100 characters." : undefined;
    case "timestamp":
      if (m.timestampFormat === "epoch_ms") return /^\d{10,16}$/.test(v) ? undefined : "Not a Unix time in milliseconds.";
      return checkTimestamp(v);
    case "date": {
      const d = DATE.exec(v);
      if (!d) return "Not a date (YYYY-MM-DD).";
      const probe = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
      return probe.getUTCDate() === +d[3] && probe.getUTCMonth() === +d[2] - 1 ? undefined : "Not a real date.";
    }
    case "decimal":
      return isDecimal(v) ? undefined : "Not an exact decimal (digits and one optional point; no sign, exponent or separators).";
    case "signed_decimal":
      return SIGNED_DECIMAL.test(v) ? undefined : "Not an exact decimal (optional minus, digits, one optional point; no exponent or separators).";
    case "chain":
      return mapped(m.values?.chain, v, ALL_CHAINS, "chain");
    case "token":
      return mapped(m.values?.token, v, ["USDT", "USDC"], "token");
    case "direction":
      return mapped(m.values?.direction, v, ["credit", "debit"], "direction");
    case "address":
      return ANY_ADDRESS.test(v) ? undefined : "Not a Tron or EVM address.";
    case "hash":
      return HASH.test(v) ? undefined : "Not a transaction hash (64 hex characters, optional 0x).";
    case "index":
      return /^\d{1,9}$/.test(v) ? undefined : "Not a whole number of 0 or more.";
  }
}

function mapped(map: Record<string, string> | undefined, v: string, canonical: readonly string[], what: string): string | undefined {
  if (map) return v in map ? undefined : `Value "${v}" is not in this mapping's ${what} values (${Object.keys(map).join(", ")}).`;
  return canonical.includes(v) ? undefined : `Unknown ${what} "${v}" (expected ${canonical.join(", ")}, or add it to the mapping).`;
}

const translate = <T extends string>(map: Record<string, T> | undefined, v: string | undefined) =>
  v === undefined ? undefined : ((map ? map[v] : v) as T);

function crossCheck(m: ColumnMapping, f: Record<string, string | undefined>, line: number): RowError | undefined {
  const chain = translate(m.values?.chain, f.chain);
  if (f.to_address && chain) {
    const err = checkAddress(chain, f.to_address);
    if (err) return { line, column: m.columns.to_address, value: f.to_address, message: err };
  }
  if (f.transfer_index && !f.tx_hash) {
    return { line, column: m.columns.transfer_index, value: f.transfer_index, message: "A transfer index needs a transaction hash on the same row." };
  }
  if (m.kind === "instruction" && f.due_by && f.created_at && toIso(m, f.due_by) < toIso(m, f.created_at)) {
    return { line, column: m.columns.due_by, value: f.due_by, message: "Due before it was created." };
  }
  return undefined;
}

const toIso = (m: ColumnMapping, v: string) => (m.timestampFormat === "epoch_ms" ? new Date(Number(v)).toISOString() : v);
const canonHash = (h: string) => h.toLowerCase().replace(/^0x/, "");
const sha8 = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 12);

function buildRecord(m: ColumnMapping, f: Record<string, string | undefined>, row: Record<string, string>,
  ctx: ImportContext & { fileSha256: string; line: number }): PaymentRecord {
  const identifiers: Identifier[] = FIELDS[m.kind].filter((s) => s.role && f[s.field] !== undefined)
    .map((s) => ({ role: s.role!, sourceField: m.columns[s.field], value: f[s.field]! }));
  const source = { kind: "file" as const, importId: ctx.importId, fileName: ctx.fileName, fileSha256: ctx.fileSha256,
    line: ctx.line, mappingId: m.mappingId, mappingVersion: m.version };
  const base = { identifiers, observedTime: ctx.now.toISOString(), sources: [source], original: { ...row } };
  const index = f.transfer_index !== undefined ? Number(f.transfer_index) : undefined;
  const opt = <K extends string, V>(k: K, v: V | undefined) => (v === undefined ? {} : ({ [k]: v } as Record<K, V>));

  if (m.kind === "instruction") {
    const content = {
      instructionId: f.instruction_id!, amount: f.amount!,
      ...opt("chain", translate(m.values?.chain, f.chain)), ...opt("token", translate(m.values?.token, f.token)),
      ...opt("toAddress", f.to_address), ...opt("txHash", f.tx_hash && canonHash(f.tx_hash)), ...opt("transferIndex", index),
      ...opt("providerPaymentId", f.provider_payment_id), ...opt("dueBy", f.due_by && toIso(m, f.due_by)),
    };
    const eventTime = toIso(m, f.created_at!);
    return { ...base, ...content, kind: "instruction", eventTime, recordId: `ins:${content.instructionId}:${sha8([content, eventTime])}` } as InstructionRecord;
  }
  if (m.kind === "provider") {
    const statusRaw = f.status!;
    const content = {
      provider: m.provider!, providerPaymentId: f.provider_payment_id!, amount: f.amount!, statusRaw,
      statusMeaning: (m.values?.status?.[statusRaw] ?? "unmapped") as ProviderStatusMeaning,
      type: (f.type === undefined ? "principal" : m.values?.type?.[f.type] ?? "other") as ProviderRowType,
      ...opt("typeRaw", f.type), ...opt("merchantReference", f.merchant_reference),
      ...opt("txHash", f.tx_hash && canonHash(f.tx_hash)), ...opt("chain", translate(m.values?.chain, f.chain)),
      ...opt("transferIndex", index), ...opt("currency", f.currency), ...opt("fee", f.fee), ...opt("relatesTo", f.relates_to),
    };
    const eventTime = toIso(m, f.event_time!);
    return { ...base, ...content, kind: "provider", eventTime,
      recordId: `prv:${content.provider}:${content.providerPaymentId}:${sha8([content, eventTime])}` } as ProviderRecord;
  }
  const content = {
    bankReference: f.bank_reference!, bookedAt: toIso(m, f.booked_at!), amount: f.amount!, currency: f.currency!,
    direction: translate(m.values?.direction, f.direction)!, ...opt("valueDate", f.value_date),
    ...opt("instructionId", f.instruction_id), ...opt("providerPaymentId", f.provider_payment_id),
    ...opt("remittanceInfo", f.remittance_info), ...opt("returnOf", f.return_of),
  };
  return { ...base, ...content, kind: "bank", eventTime: content.bookedAt, recordId: `bnk:${content.bankReference}:${sha8(content)}` } as BankRecord;
}
