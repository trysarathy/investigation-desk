import "server-only";
import type { Tx } from "../db/client";
import { FieldCryptoError, type IndexDomain, type OrgCipher } from "./envelope";
import { cipherFor } from "./org-keys";

/**
 * v1 Phase 5.3: which columns hold wallet addresses and customer references, and how each is encrypted.
 *
 * Expand phase (migration 0084, was 0072; docs/security/ENCRYPTION_V1.md): every column below keeps its plaintext column and
 * gains `<column>_enc` (sealed value) and, where it is compared, `<column>_bidx` (blind index). Writes fill all of
 * them; reads take the value from `_enc` (falling back to the plaintext only while a row is not backfilled yet) and
 * refuse a row whose sealed value does not agree with its plaintext copy. The contract step (documented, not run)
 * drops the plaintext columns.
 *
 * `rowId` is the row's identity inside its organisation, bound into each sealed value (AAD). For address_facts the
 * address itself is part of the key, so its blind index stands in for it.
 */
export interface EncryptedColumn { prop: string; column: string; encProp: string; encColumn: string; bidxProp?: string; bidxColumn?: string; domain?: IndexDomain; json?: true }
export interface EncryptedTable { table: string; key: { prop: string; column: string }[]; rowId: (r: Row) => string; columns: EncryptedColumn[] }
type Row = Record<string, unknown>;

const col = (prop: string, column: string, domain?: IndexDomain): EncryptedColumn => ({
  prop, column, encProp: `${prop}Enc`, encColumn: `${column}_enc`, ...(domain ? { bidxProp: `${prop}Bidx`, bidxColumn: `${column}_bidx`, domain } : {}),
});
const json = (prop: string, column: string): EncryptedColumn => ({ prop, column, encProp: `${prop}Enc`, encColumn: `${column}_enc`, json: true });
const k = (prop: string, column: string) => ({ prop, column });

/**
 * A jsonb value as PostgreSQL returns it: object keys ordered by length, then bytewise (jsonb's own order), so a value
 * opened from its sealed copy is exactly the value read from the jsonb column (the engine's input hash is unchanged).
 */
export function jsonbOrdered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrdered);
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object).sort((a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length - y.length || Buffer.compare(x, y); });
    return Object.fromEntries(keys.map((key) => [key, jsonbOrdered((v as Record<string, unknown>)[key])]));
  }
  return v;
}
const present = (v: unknown) => v !== null && v !== undefined;
const asText = (c: EncryptedColumn, v: unknown): string | null => (!present(v) ? null : c.json ? JSON.stringify(jsonbOrdered(v)) : typeof v === "string" ? v : null);

export const ENCRYPTED_TABLES = {
  merchant_quotes: { table: "merchant_quotes", key: [k("quoteId", "quote_id")], rowId: (r) => String(r.quoteId), columns: [col("depositAddress", "deposit_address", "address")] },
  payment_links: { table: "payment_links", key: [k("linkId", "link_id")], rowId: (r) => String(r.linkId), columns: [col("depositAddress", "deposit_address", "address")] },
  chain_transfers: {
    table: "chain_transfers", key: [k("network", "network"), k("txHash", "tx_hash"), k("logIndex", "log_index"), k("source", "source")],
    rowId: (r) => `${r.network}|${r.txHash}|${r.logIndex}|${r.source}`,
    columns: [col("fromAddress", "from_address", "address"), col("toAddress", "to_address", "address"), json("priorHops", "prior_hops")],
  },
  address_facts: {
    table: "address_facts", key: [k("network", "network"), k("address", "address"), k("fact", "fact")],
    rowId: (r) => `${r.network}|${r.fact}|${r.addressBidx}`, columns: [col("address", "address", "address")],
  },
  chain_reads: { table: "chain_reads", key: [k("id", "id"), k("at", "at")], rowId: (r) => String(r.id), columns: [col("address", "address", "address")] },
  ledger_invoices: {
    table: "ledger_invoices", key: [k("entityId", "entity_id"), k("invoiceNumber", "invoice_number")], rowId: (r) => `${r.entityId}|${r.invoiceNumber}`,
    columns: [col("orderRef", "order_ref", "order_ref"), col("contact", "contact")],
  },
} satisfies Record<string, EncryptedTable>;
export type EncryptedTableName = keyof typeof ENCRYPTED_TABLES;
export const isEncryptedTable = (name: string): name is EncryptedTableName => name in ENCRYPTED_TABLES;

/** The sealed and index columns of one row, from its plaintext values (blind indexes first: a row id may use one). */
export function sealOne(cipher: OrgCipher, spec: EncryptedTable, row: Row): Row {
  const out: Row = { ...row };
  for (const c of spec.columns) if (c.bidxProp) { const v = asText(c, row[c.prop]); out[c.bidxProp] = v === null ? null : cipher.blindIndex(c.domain!, v); }
  const id = spec.rowId(out);
  for (const c of spec.columns) { const v = asText(c, row[c.prop]); out[c.encProp] = v === null ? null : cipher.seal(spec.table, c.column, id, v); }
  return out;
}

/**
 * Rows ready to insert: with field encryption on, each gets its sealed values and blind indexes; with it off (no KMS,
 * local only) they are returned unchanged. Pass `cipher` when the caller already has it (bulk paths).
 */
export async function sealRows<T extends Row>(tx: Tx, orgId: string, table: EncryptedTableName, rows: T[], cipher?: OrgCipher | null): Promise<T[]> {
  if (!rows.length) return rows;
  const c = cipher === undefined ? await cipherFor(tx, orgId, "write") : cipher;
  if (!c) return rows;
  const spec = ENCRYPTED_TABLES[table] as EncryptedTable;
  return rows.map((r) => sealOne(c, spec, r) as T);
}

/** One row's plaintext values from its sealed values (plaintext columns are used only where no sealed value exists). */
export function openOne(cipher: OrgCipher | null, spec: EncryptedTable, row: Row): Row {
  let out: Row | undefined;
  for (const c of spec.columns) {
    const sealed = row[c.encProp];
    if (sealed === null || sealed === undefined) continue;
    if (!cipher) throw new FieldCryptoError(`${spec.table}.${c.column}: this value is encrypted and no KMS is configured (CLEARLINE_KMS_KEYS).`);
    const text = cipher.open(spec.table, c.column, spec.rowId(row), sealed as string);
    // expand phase: both copies exist; a difference means one of them was changed outside the application
    if (c.prop in row && present(row[c.prop]) && asText(c, row[c.prop]) !== text) {
      throw new FieldCryptoError(`${spec.table}.${c.column}: the sealed value does not agree with the plaintext copy.`);
    }
    out ??= { ...row };
    out[c.prop] = c.json ? JSON.parse(text) : text;
  }
  return out ?? row;
}

/** Rows as read from the database → the same rows with their plaintext values taken from the sealed columns. */
export async function openRows<T extends Row>(tx: Tx, orgId: string, table: EncryptedTableName, rows: T[], cipher?: OrgCipher | null): Promise<T[]> {
  const spec = ENCRYPTED_TABLES[table] as EncryptedTable;
  if (!rows.some((r) => spec.columns.some((c) => r[c.encProp] !== null && r[c.encProp] !== undefined))) return rows;
  const c = cipher === undefined ? await cipherFor(tx, orgId, "read") : cipher;
  return rows.map((r) => openOne(c, spec, r) as T);
}
