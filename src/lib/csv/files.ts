// Validation for the company's uploads (spec section 4) and the bulk-investigation CSV (5.3).
// Rules: reject the file if a required column is missing; reject a row if an amount isn't an
// exact decimal, a chain is unknown, or a timestamp has no offset; show row-level errors; never
// silently fix data (no trimming, no case folding, no guessing). Re-uploads dedupe on SHA-256.

import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { tronHexToBase58, tronToHex } from "../address";
import { isDecimal } from "../decimal";
import type { Chain, DepositAddressRow, DepositChain, LedgerRow, LedgerStatus, Token } from "../types";
import { ALL_CHAINS, DEPOSIT_CHAINS } from "../types";
import { decodeUtf8, parseCsv } from "./parse";

export interface RowError {
  /** Line in the file (the header is line 1). */
  line: number;
  column?: string;
  value?: string;
  message: string;
}

export interface ValidationResult<T> {
  sha256: string;
  /** The whole file is rejected; nothing from it is used. */
  fileErrors: string[];
  rows: T[];
  rowErrors: RowError[];
  /** Columns present but not part of the format; they are not read or stored. */
  ignoredColumns: string[];
  notes: string[];
  /** The file's header row, as read. */
  header?: string[];
}

const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = { A: 200_000, B: 500_000, bulk: 1_000 } as const;

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
export const HASH = /^(0x)?[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const sha256Bytes = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Timestamp with an explicit offset, and a real calendar date and time. */
export function checkTimestamp(v: string): string | undefined {
  const m = ISO_WITH_OFFSET.exec(v);
  if (!m) return /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v) ? "Timestamp has no UTC offset (add Z or +08:00)." : "Not an ISO 8601 timestamp with an offset.";
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s || 0));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59 || (s || 0) > 59) {
    return "Not a real date and time.";
  }
  if (m[7] !== "Z") {
    const [oh, om] = m[7].slice(1).split(":").map(Number);
    if (oh > 14 || om > 59) return "Offset out of range.";
  }
  return undefined;
}

/** EIP-55: an all-lowercase or all-uppercase address has no checksum; mixed case must match it. */
function eip55Ok(address: string): boolean {
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(body.toLowerCase())));
  return [...body].every((c, i) => (/[0-9]/.test(c) ? true : (parseInt(hash[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase())));
}

export function checkAddress(chain: Chain, v: string): string | undefined {
  if (chain === "tron") {
    if (!TRON_ADDRESS.test(v)) return "Not a Tron address (T followed by 33 base58 characters).";
    const hex = tronToHex(v);
    if (hex === v || tronHexToBase58(hex) !== v) return "Tron address checksum is wrong (likely a typo).";
    return undefined;
  }
  if (!EVM_ADDRESS.test(v)) return "Not an EVM address (0x followed by 40 hex characters).";
  if (!eip55Ok(v)) return "Mixed-case address fails its EIP-55 checksum (likely a typo).";
  return undefined;
}

export interface Column {
  name: string;
  required: boolean;
  /** Returns an error message, or undefined if the value is valid. Empty optional values skip this. */
  check?: (v: string, row: Record<string, string>) => string | undefined;
}

export function readTable<T>(bytes: Uint8Array, columns: Column[], maxRows: number,
  build: (row: Record<string, string>, line: number) => T | RowError): ValidationResult<T> {
  const res: ValidationResult<T> = { sha256: sha256Bytes(bytes), fileErrors: [], rows: [], rowErrors: [], ignoredColumns: [], notes: [] };
  if (bytes.length > MAX_BYTES) {
    res.fileErrors.push(`File is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    return res;
  }
  const decoded = decodeUtf8(bytes);
  if (decoded.error) {
    res.fileErrors.push(decoded.error);
    return res;
  }
  if (decoded.bom) res.notes.push("UTF-8 byte-order mark at the start of the file was not read as data.");
  const csv = parseCsv(decoded.text!);
  res.notes.push(...csv.notes);
  if (csv.fileErrors.length) {
    res.fileErrors.push(...csv.fileErrors);
    return res;
  }

  const header = csv.header;
  res.header = header;
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupes.length) res.fileErrors.push(`Duplicate column(s): ${[...new Set(dupes)].join(", ")}.`);
  const known = new Set(columns.map((c) => c.name));
  const missing = columns.filter((c) => c.required && !header.includes(c.name)).map((c) => c.name);
  if (missing.length) {
    const nearMiss = header.filter((h) => known.has(h.trim().toLowerCase()) && h !== h.trim().toLowerCase());
    res.fileErrors.push(`Missing required column(s): ${missing.join(", ")}.` +
      (nearMiss.length ? ` Column names must match exactly (found ${nearMiss.map((h) => `"${h}"`).join(", ")}).` : ""));
  }
  if (res.fileErrors.length) return res;
  res.ignoredColumns = header.filter((h) => !known.has(h));
  if (csv.records.length > maxRows) {
    res.fileErrors.push(`File has ${csv.records.length} rows; the limit is ${maxRows}.`);
    return res;
  }

  for (const e of csv.recordErrors) res.rowErrors.push({ line: e.line, message: e.message });
  for (const rec of csv.records) {
    if (rec.cells.length !== header.length) {
      res.rowErrors.push({ line: rec.line, message: `Row has ${rec.cells.length} values; the header has ${header.length}.` });
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = rec.cells[i]; });
    let bad: RowError | undefined;
    for (const col of columns) {
      const v = row[col.name] ?? "";
      if (v !== v.trim()) { bad = { line: rec.line, column: col.name, value: v, message: "Has leading or trailing spaces." }; break; }
      if (v === "") {
        if (col.required) { bad = { line: rec.line, column: col.name, message: "Required value is empty." }; break; }
        continue;
      }
      const msg = col.check?.(v, row);
      if (msg) { bad = { line: rec.line, column: col.name, value: v, message: msg }; break; }
    }
    if (bad) { res.rowErrors.push(bad); continue; }
    const built = build(row, rec.line);
    if ("message" in (built as object) && "line" in (built as object)) res.rowErrors.push(built as RowError);
    else res.rows.push(built as T);
  }
  res.rowErrors.sort((a, b) => a.line - b.line);
  return res;
}

export const oneOf = <T extends string>(allowed: readonly T[], what: string) => (v: string) =>
  (allowed as readonly string[]).includes(v) ? undefined : `Unknown ${what} "${v}" (expected ${allowed.join(", ")}).`;

export const customerIdCheck = (v: string) =>
  EMAIL.test(v) ? "Looks like an email address. Use the pseudonymous customer ID; emails and names are not accepted." :
  v.length > 100 ? "Longer than 100 characters." :
  /[\u0000-\u001f]/.test(v) ? "Contains control characters." : undefined;

// ---- File A: deposit addresses ----

export function validateFileA(bytes: Uint8Array): ValidationResult<DepositAddressRow> {
  const res = readTable<DepositAddressRow>(bytes, [
    { name: "address", required: true },
    { name: "chain", required: true, check: oneOf(DEPOSIT_CHAINS, "chain") },
    { name: "customer_id", required: true, check: customerIdCheck },
    { name: "assigned_at", required: true, check: checkTimestamp },
    { name: "retired_at", required: false, check: checkTimestamp },
  ], MAX_ROWS.A, (row, line) => {
    const chain = row.chain as DepositChain;
    const addrErr = checkAddress(chain, row.address);
    if (addrErr) return { line, column: "address", value: row.address, message: addrErr };
    if (row.retired_at && Date.parse(row.retired_at) <= Date.parse(row.assigned_at)) {
      return { line, column: "retired_at", value: row.retired_at, message: "retired_at is not after assigned_at." };
    }
    return { row: line, address: row.address, chain, customerId: row.customer_id, assignedAt: row.assigned_at,
      ...(row.retired_at ? { retiredAt: row.retired_at } : {}) };
  });

  // An address can be reassigned, but its periods can't overlap: then ownership would be ambiguous.
  const byKey = new Map<string, DepositAddressRow[]>();
  for (const r of res.rows) {
    const k = `${r.chain}:${r.chain === "tron" ? r.address : r.address.toLowerCase()}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const overlapping = new Set<number>();
  for (const rows of byKey.values()) {
    const sorted = [...rows].sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (!prev.retiredAt || Date.parse(prev.retiredAt) > Date.parse(sorted[i].assignedAt)) {
        overlapping.add(sorted[i].row);
        res.rowErrors.push({ line: sorted[i].row, column: "assigned_at", value: sorted[i].assignedAt,
          message: `Overlaps line ${prev.row} for the same address and chain (that row isn't retired before this one starts).` });
      }
    }
  }
  if (overlapping.size) {
    res.rows = res.rows.filter((r) => !overlapping.has(r.row));
    res.rowErrors.sort((a, b) => a.line - b.line);
  }
  return res;
}

// ---- File B: deposit ledger ----

const STATUSES: LedgerStatus[] = ["CREDITED", "PENDING", "HELD", "REVIEW", "REJECTED"];
const TOKENS: Token[] = ["USDT", "USDC"];

export function validateFileB(bytes: Uint8Array): ValidationResult<LedgerRow> {
  const seen = new Map<string, number>();
  return readTable<LedgerRow>(bytes, [
    { name: "deposit_id", required: true, check: (v) => (v.length > 100 ? "Longer than 100 characters." : undefined) },
    { name: "tx_hash", required: false, check: (v) => (HASH.test(v) ? undefined : "Not a transaction hash (64 hex characters, optional 0x).") },
    { name: "chain", required: true, check: oneOf(DEPOSIT_CHAINS, "chain") },
    { name: "token", required: true, check: oneOf(TOKENS, "token") },
    { name: "to_address", required: true },
    { name: "amount", required: true, check: (v) => (isDecimal(v) ? undefined : "Not an exact decimal (digits and one optional point; no sign, exponent or separators).") },
    { name: "status", required: true, check: oneOf(STATUSES, "status") },
    { name: "credited_at", required: false, check: checkTimestamp },
    { name: "customer_id", required: true, check: customerIdCheck },
    { name: "transfer_index", required: false, check: (v) => (/^\d{1,9}$/.test(v) ? undefined : "Not a whole number of 0 or more.") },
    { name: "reason_code", required: false, check: (v) => (v.length > 200 ? "Longer than 200 characters." : undefined) },
  ], MAX_ROWS.B, (row, line) => {
    const chain = row.chain as DepositChain;
    const addrErr = checkAddress(chain, row.to_address);
    if (addrErr) return { line, column: "to_address", value: row.to_address, message: addrErr };
    const first = seen.get(row.deposit_id);
    if (first !== undefined) return { line, column: "deposit_id", value: row.deposit_id, message: `Duplicate deposit_id (first on line ${first}).` };
    seen.set(row.deposit_id, line);
    return {
      row: line, depositId: row.deposit_id, chain, token: row.token as Token, toAddress: row.to_address,
      amount: row.amount, status: row.status as LedgerStatus, customerId: row.customer_id,
      ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
      ...(row.credited_at ? { creditedAt: row.credited_at } : {}),
      ...(row.transfer_index ? { transferIndex: Number(row.transfer_index) } : {}),
      ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    };
  });
}

// ---- Bulk investigation (5.3): tx_hash, chain (optional), customer_id (optional) ----

export interface BulkRow { line: number; txHash: string; chain?: Chain; customerId?: string }

export function validateBulk(bytes: Uint8Array): ValidationResult<BulkRow> {
  return readTable<BulkRow>(bytes, [
    { name: "tx_hash", required: true, check: (v) => (HASH.test(v) ? undefined : "Not a transaction hash (64 hex characters, optional 0x).") },
    { name: "chain", required: false, check: oneOf(ALL_CHAINS, "chain") },
    { name: "customer_id", required: false, check: customerIdCheck },
  ], MAX_ROWS.bulk, (row, line) => ({
    line, txHash: row.tx_hash,
    ...(row.chain ? { chain: row.chain as Chain } : {}),
    ...(row.customer_id ? { customerId: row.customer_id } : {}),
  }));
}

/**
 * The optional "Reporting customer" on a pasted hash (form field or `customer=` in the link).
 * Same rules as File A's customer_id: pseudonymous IDs only, never fixed up.
 */
export function parseReportingCustomer(raw: string | undefined): { customerId?: string; error?: string } {
  if (raw === undefined || raw === "") return {};
  if (raw !== raw.trim()) return { error: "Reporting customer has leading or trailing spaces." };
  const err = customerIdCheck(raw);
  return err ? { error: `Reporting customer: ${err}` } : { customerId: raw };
}
