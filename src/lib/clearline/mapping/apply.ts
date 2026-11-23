/**
 * applyMapping: a parsed table + a confirmed mapping → one typed record per row, each accepted, rejected (with reason
 * codes per field) or accepted with warnings. Amounts are exact BigInt minor units: fiat at the currency's precision,
 * tokens at the decimals of the token identified by (network, contract) — never by symbol. Pure: no floats, no clock.
 *
 * Reason codes never carry a cell's value, so a validation report can be stored and logged without file contents.
 */
import { currencyPrecision } from "../ingest/bank/currency";
import { detectDateFormat, parseDate, type DateFormat } from "../ingest/dates";
import { detectDecimalSeparator, formatMinor, parseAmount, type DecimalSeparator } from "../ingest/decimal";
import { TOKENS, normAddress } from "../merchant/config";
import type { NetworkId, TokenConfig } from "../merchant/types";
import { fieldOf, type FieldDef } from "./catalogue";
import { headersOf, validateMapping, type ColumnMapping, type Mapping, type MappingIssue } from "./mapping";

export interface TableLike { headers: readonly string[]; rows: readonly { rowNumber: number; cells: readonly string[] }[] }
/** Text for ids, codes, dates (YYYY-MM-DD), instants (ISO, Z) and rates; bigint for amounts; number for indices. */
export type MappedValue = string | bigint | number;
export interface RowIssue { field: string; code: string }
export interface AppliedRow {
  rowNumber: number;
  status: "accepted" | "rejected" | "warning";
  values: Record<string, MappedValue>;
  errors: RowIssue[];
  warnings: RowIssue[];
}
export interface ColumnIssue { field: string; code: string }
export type ApplyResult =
  | { ok: true; mapping: Mapping; rows: AppliedRow[]; columnIssues: ColumnIssue[]; counts: { accepted: number; rejected: number; warning: number } }
  | { ok: false; issues: MappingIssue[] };
export interface ApplyOptions { tokens?: readonly TokenConfig[] }

const EVM: readonly NetworkId[] = ["ethereum", "polygon", "arbitrum_one", "base"];
const NETWORK_WORDS: Readonly<Record<string, NetworkId>> = {
  tron: "tron", trx: "tron", trc20: "tron", "trc-20": "tron", ethereum: "ethereum", eth: "ethereum", erc20: "ethereum", "erc-20": "ethereum",
  polygon: "polygon", matic: "polygon", solana: "solana", sol: "solana", arbitrum: "arbitrum_one", "arbitrum one": "arbitrum_one", arbitrum_one: "arbitrum_one", ton: "ton", base: "base",
};
const DIRECTION_WORDS: Readonly<Record<string, "credit" | "debit">> = {
  credit: "credit", cr: "credit", c: "credit", "+": "credit", in: "credit", incoming: "credit", deposit: "credit", received: "credit",
  debit: "debit", dr: "debit", d: "debit", "-": "debit", out: "debit", outgoing: "debit", withdrawal: "debit",
};
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;

class Bad extends Error { constructor(readonly code: string) { super(code); } }
const lookup = <T>(map: Readonly<Record<string, T>> | undefined, word: string): T | undefined => {
  if (!map) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, word)) return map[word];
  const k = Object.keys(map).find((x) => x.trim().toLowerCase() === word.toLowerCase());
  return k === undefined ? undefined : map[k];
};

/** Per-column decisions taken once from all of a column's values (never a per-row guess). */
interface ColumnPlan { decimal?: DecimalSeparator; decimalUndecided?: boolean; dateFormat?: DateFormat; dateUndecided?: boolean }

function plan(key: string, def: FieldDef, c: ColumnMapping, values: string[], columnIssues: ColumnIssue[]): ColumnPlan {
  const p: ColumnPlan = {};
  if (["fiat_amount", "token_amount", "rate"].includes(def.kind) && c.amountUnit !== "minor") {
    if (c.decimalSeparator) p.decimal = c.decimalSeparator;
    else {
      const d = detectDecimalSeparator(values);
      if (d.status === "decided") p.decimal = d.decimalSeparator;
      else if (d.status === "no_separators") p.decimal = ".";
      else { p.decimalUndecided = true; columnIssues.push({ field: key, code: d.status === "conflict" ? "decimal_separator_conflict" : "decimal_separator_needed" }); }
    }
  }
  if (def.kind === "date" || def.kind === "datetime") {
    if (c.dateFormat) p.dateFormat = c.dateFormat as DateFormat;
    else {
      const d = detectDateFormat(values);
      if (d.status === "decided") p.dateFormat = d.format;
      else if (d.status === "inconsistent" && d.best) { p.dateFormat = d.best; columnIssues.push({ field: key, code: "date_format_inconsistent" }); }
      else if (d.status !== "empty") { p.dateUndecided = true; columnIssues.push({ field: key, code: d.status === "ambiguous" ? "date_format_ambiguous" : "date_format_unknown" }); }
    }
  }
  return p;
}

const rateText = (minor: bigint) => formatMinor(minor, 12).replace(/0+$/, "").replace(/\.$/, "");

export function applyMapping(table: TableLike, mappingInput: unknown, opts: ApplyOptions = {}): ApplyResult {
  const check = validateMapping(mappingInput, table.headers);
  if (!check.ok) return { ok: false, issues: check.issues };
  const mapping = check.mapping;
  const tokens = opts.tokens ?? TOKENS;
  const index = new Map(table.headers.map((h, i) => [h, i]));
  const cellsOf = (c: ColumnMapping, cells: readonly string[]) => headersOf(c).map((h) => cells[index.get(h)!] ?? "");
  const textOf = (c: ColumnMapping, cells: readonly string[]) => (c.constant !== undefined ? c.constant : cellsOf(c, cells).map((x) => x.trim()).filter((x) => x !== "").join(" "));
  // Evaluation order: what other fields need first (currency for fiat precision, network + contract for tokens).
  const order = ["currency", "network", "token_contract", "direction"];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const keys = Object.keys(mapping.columns).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const columnIssues: ColumnIssue[] = [];
  const plans = new Map(keys.map((k) => {
    const c = mapping.columns[k];
    const values = c.sign === "credit_debit_columns" ? table.rows.flatMap((r) => cellsOf(c, r.cells)) : table.rows.map((r) => textOf(c, r.cells));
    return [k, plan(k, fieldOf(mapping.fileType, k)!, c, values, columnIssues)] as const;
  }));

  const rows = table.rows.map((r): AppliedRow => {
    const values: Record<string, MappedValue> = {};
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const network = () => values.network as NetworkId | undefined;
    const amount = (text: string, precision: number, p: ColumnPlan, c: ColumnMapping, allowDrCr = false): bigint => {
      if (p.decimalUndecided) throw new Bad("decimal_separator_needed");
      const res = parseAmount(text, { precision: c.amountUnit === "minor" ? 0 : precision, decimalSeparator: p.decimal ?? ".", allowDrCr });
      if (!res.ok) throw new Bad(`amount_${res.code}`);
      return res.value;
    };
    const read = (key: string, def: FieldDef, c: ColumnMapping, p: ColumnPlan): MappedValue | undefined => {
      if (c.sign === "credit_debit_columns") {
        const [credit, debit] = cellsOf(c, r.cells).map((x) => x.trim());
        if (credit === "" && debit === "") return undefined;
        const prec = precisionOf();
        const cr = credit === "" ? 0n : amount(credit, prec, p, c);
        const db = debit === "" ? 0n : amount(debit, prec, p, c);
        if (cr !== 0n && db !== 0n) throw new Bad("credit_and_debit_both_filled");
        if (cr < 0n) throw new Bad("negative_credit");
        values.direction = cr !== 0n || db === 0n ? "credit" : "debit";
        return cr !== 0n ? cr : db < 0n ? -db : db;
      }
      const text = textOf(c, r.cells);
      if (text === "") return undefined;
      if (CONTROL.test(text)) throw new Bad("control_characters");
      switch (def.kind) {
        case "id": case "batch_id": if (text.length > 128) throw new Bad("too_long"); return text;
        case "text": if (text.length > 500) throw new Bad("too_long"); return text;
        case "token_symbol": if (text.length > 16) throw new Bad("too_long"); return text.toUpperCase();
        case "integer": if (!/^\d{1,9}$/.test(text)) throw new Bad("not_an_integer"); return Number(text);
        case "currency": {
          const code = text.toUpperCase();
          if (!/^[A-Z]{3}$/.test(code) || !currencyPrecision(code).ok) throw new Bad("unknown_currency");
          return code;
        }
        case "network": {
          const n = lookup(c.networkValueMap, text) ?? NETWORK_WORDS[text.toLowerCase()];
          if (!n) throw new Bad("unknown_network");
          return n;
        }
        case "direction": {
          const d = lookup(c.directionValueMap, text) ?? DIRECTION_WORDS[text.toLowerCase()];
          if (!d) throw new Bad("unknown_direction");
          return d;
        }
        case "status": {
          const s = lookup(c.statusValueMap, text);
          if (s === undefined) throw new Bad("unmapped_status");
          values[`${key}_text`] = text.slice(0, 60);
          return s;
        }
        case "address": {
          const n = network();
          if (n === "tron" ? !TRON_ADDRESS.test(text) : n && EVM.includes(n) ? !EVM_ADDRESS.test(text) : !/^[A-Za-z0-9:_-]{20,100}$/.test(text)) throw new Bad("invalid_address");
          return text;
        }
        case "tx_hash": {
          const n = network();
          if (n === "tron" || (n && EVM.includes(n))) {
            if (!HEX64.test(text)) throw new Bad("invalid_tx_hash");
            const hex = text.replace(/^0x/, "").toLowerCase();
            return n === "tron" ? hex : `0x${hex}`;
          }
          if (!/^[A-Za-z0-9_+/=-]{20,128}$/.test(text)) throw new Bad("invalid_tx_hash");
          return text;
        }
        case "rate": {
          const v = amount(text, 12, p, c);
          if (v <= 0n) throw new Bad("rate_not_positive");
          return rateText(v);
        }
        case "date": case "datetime": {
          if (p.dateUndecided) throw new Bad("date_format_needed");
          const res = parseDate(text, p.dateFormat ?? "iso", { utcOffsetMinutes: c.defaultUtcOffsetMinutes ?? 0 });
          if (!res.ok) throw new Bad("invalid_date");
          if (def.kind === "date") return res.value.date;
          if (!res.value.instant) throw new Bad("missing_time");
          if (res.value.offsetSource === "default" && c.defaultUtcOffsetMinutes === undefined) throw new Bad("utc_offset_unknown");
          return res.value.instant;
        }
        case "fiat_amount": {
          const v = amount(text, precisionOf(), p, c, key === "amount" && mapping.fileType === "bank_statement");
          if (mapping.fileType === "bank_statement" && key === "amount") {
            if (c.sign === "direction_field") return v < 0n ? -v : v;
            const dir = v < 0n ? "debit" : "credit";
            if (values.direction !== undefined && values.direction !== dir && v !== 0n) throw new Bad("sign_conflicts_with_direction");
            values.direction = dir;
            return v < 0n ? -v : v;
          }
          if (v < 0n) throw new Bad("negative_amount");
          return v;
        }
        case "token_amount": {
          const tok = tokenOf();
          if (!tok) throw new Bad("unknown_token");
          const v = amount(text, tok.decimals, p, c);
          if (v < 0n) throw new Bad("negative_amount");
          return v;
        }
      }
    };
    const precisionOf = (): number => {
      const cur = values.currency;
      if (typeof cur !== "string") throw new Bad("currency_unknown_for_amount");
      const pr = currencyPrecision(cur);
      if (!pr.ok) throw new Bad("unknown_currency");
      return pr.value;
    };
    const tokenOf = (): TokenConfig | undefined => {
      const n = network(), contract = values.token_contract;
      if (!n || typeof contract !== "string") return undefined;
      return tokens.find((t) => t.network === n && normAddress(n, t.contract) === normAddress(n, contract));
    };
    for (const key of keys) {
      const def = fieldOf(mapping.fileType, key)!;
      try {
        const v = read(key, def, mapping.columns[key], plans.get(key)!);
        if (v === undefined) { if (def.required) errors.push({ field: key, code: "missing_value" }); continue; }
        values[key] = v;
        if (key === "token_contract" && !tokenOf()) errors.push({ field: key, code: "unknown_token" });
      } catch (e) {
        if (!(e instanceof Bad)) throw e;
        errors.push({ field: key, code: e.code });
      }
    }
    crossChecks(mapping, values, errors, warnings, tokenOf());
    return { rowNumber: r.rowNumber, status: errors.length ? "rejected" : warnings.length ? "warning" : "accepted", values, errors, warnings };
  });
  const counts = { accepted: 0, rejected: 0, warning: 0 };
  for (const r of rows) counts[r.status]++;
  return { ok: true, mapping, rows, columnIssues, counts };
}

/** Checks between fields of one row, per file type. */
function crossChecks(m: Mapping, v: Record<string, MappedValue>, errors: RowIssue[], warnings: RowIssue[], token: TokenConfig | undefined) {
  const has = (k: string) => v[k] !== undefined || errors.some((e) => e.field === k);
  if (m.fileType === "provider_export") {
    if (typeof v.created_at === "string" && typeof v.expires_at === "string" && Date.parse(v.expires_at) <= Date.parse(v.created_at)) errors.push({ field: "expires_at", code: "quote_expires_before_created" });
    if (has("tx_hash") && !has("log_index")) warnings.push({ field: "log_index", code: "log_index_missing_assumed_0" });
    if (has("token_symbol") && token && v.token_symbol !== token.symbol.toUpperCase()) warnings.push({ field: "token_symbol", code: "symbol_differs_from_contract" });
    if (has("payment_id") && !has("received_token_amount")) errors.push({ field: "received_token_amount", code: "missing_value" });
    if (has("payment_id") && !has("status")) errors.push({ field: "status", code: "missing_value" });
  }
  if (m.fileType === "settlement_report" && m.shape === "per_payment_lines") {
    const refund = v.line_type === "refund";
    if (!refund && !has("payment_id")) errors.push({ field: "payment_id", code: "missing_value" });
    if (refund && !has("refund_id")) errors.push({ field: "refund_id", code: "missing_value" });
  }
  if (m.fileType === "settlement_report" && m.shape === "batch_totals" && typeof v.gross === "bigint" && typeof v.net === "bigint") {
    const fee = typeof v.fee === "bigint" ? v.fee : 0n, refund = typeof v.refund === "bigint" ? v.refund : 0n;
    if (v.gross - fee - refund !== v.net) errors.push({ field: "net", code: "totals_do_not_add_up" });
  }
  if (m.fileType === "bank_statement" && v.amount === 0n) warnings.push({ field: "amount", code: "zero_amount" });
  if (m.fileType === "bank_statement" && m.columns.amount?.sign === "direction_field" && !has("direction") && has("amount")) errors.push({ field: "direction", code: "missing_value" });
}
