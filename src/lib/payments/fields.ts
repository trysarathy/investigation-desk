// Canonical fields per import kind and the column-mapping shape. No Node imports: the import
// screen uses these in the browser to check a file's header before sending it.

import type { Chain, Token } from "../types";
import type { ImportKind, ProviderRowType, ProviderStatusMeaning } from "./types";

export type FieldType = "id" | "text" | "timestamp" | "date" | "decimal" | "signed_decimal" | "chain" | "token" | "address" | "hash" | "index" | "raw" | "direction";

export interface FieldSpec {
  field: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Set for identifiers: kept on the record under this role, with the source column name. */
  role?: string;
}

export const FIELDS: Record<ImportKind, FieldSpec[]> = {
  instruction: [
    { field: "instruction_id", label: "Instruction ID", type: "id", required: true, role: "instruction_id" },
    { field: "created_at", label: "Created at (event time)", type: "timestamp", required: true },
    { field: "amount", label: "Amount", type: "decimal", required: true },
    { field: "chain", label: "Chain", type: "chain", required: false },
    { field: "token", label: "Token", type: "token", required: false },
    { field: "to_address", label: "Destination address", type: "address", required: false },
    { field: "tx_hash", label: "Transaction hash", type: "hash", required: false, role: "tx_hash" },
    { field: "transfer_index", label: "Transfer index", type: "index", required: false, role: "transfer_index" },
    { field: "provider_payment_id", label: "Provider payment ID", type: "id", required: false, role: "provider_payment_id" },
    { field: "due_by", label: "Due by (agreed deadline)", type: "timestamp", required: false },
  ],
  provider: [
    { field: "provider_payment_id", label: "Provider payment ID", type: "id", required: true, role: "provider_payment_id" },
    { field: "status", label: "Status (kept raw)", type: "raw", required: true },
    { field: "amount", label: "Amount", type: "signed_decimal", required: true },
    { field: "event_time", label: "Event time", type: "timestamp", required: true },
    { field: "merchant_reference", label: "Merchant reference (our instruction ID)", type: "id", required: false, role: "merchant_reference" },
    { field: "provider_uuid", label: "Provider internal UUID", type: "id", required: false, role: "provider_uuid" },
    { field: "tx_hash", label: "Transaction hash", type: "hash", required: false, role: "tx_hash" },
    { field: "chain", label: "Chain", type: "chain", required: false },
    { field: "transfer_index", label: "Transfer index", type: "index", required: false, role: "transfer_index" },
    { field: "type", label: "Row type (kept raw)", type: "raw", required: false },
    { field: "currency", label: "Currency", type: "text", required: false },
    { field: "fee", label: "Fee", type: "signed_decimal", required: false },
    { field: "relates_to", label: "Related provider payment ID (fee or return rows)", type: "id", required: false, role: "relates_to" },
    { field: "description", label: "Description", type: "text", required: false },
  ],
  bank: [
    { field: "bank_reference", label: "Bank reference", type: "id", required: true, role: "bank_reference" },
    { field: "booked_at", label: "Booked at (event time)", type: "timestamp", required: true },
    { field: "amount", label: "Amount", type: "decimal", required: true },
    { field: "currency", label: "Currency", type: "text", required: true },
    { field: "direction", label: "Direction (credit or debit)", type: "direction", required: true },
    { field: "value_date", label: "Value date", type: "date", required: false },
    { field: "instruction_id", label: "Instruction ID", type: "id", required: false, role: "instruction_id" },
    { field: "provider_payment_id", label: "Provider payment ID", type: "id", required: false, role: "provider_payment_id" },
    { field: "remittance_info", label: "Remittance information (free text)", type: "text", required: false },
    { field: "return_of", label: "Return of (original bank reference)", type: "id", required: false, role: "return_of" },
  ],
};

export const STATUS_MEANINGS: ProviderStatusMeaning[] = [
  "pending", "awaiting_approval", "processing", "on_hold", "provider_reports_complete",
  "cancelled", "expired", "underpaid", "overpaid", "returned",
];
export const ROW_TYPES: ProviderRowType[] = ["principal", "fee", "return", "other"];

export interface ColumnMapping {
  /** Stable across versions. */
  mappingId: string;
  version: number;
  kind: ImportKind;
  name: string;
  /** Provider imports only: whose report this reads. */
  provider?: string;
  createdAt: string;
  /** Canonical field -> column header in the file, matched exactly. */
  columns: Record<string, string>;
  /** Raw value -> canonical value. Without a map, a chain or token must be spelled canonically. */
  values?: {
    chain?: Record<string, Chain>;
    token?: Record<string, Token>;
    direction?: Record<string, "credit" | "debit">;
    status?: Record<string, ProviderStatusMeaning>;
    type?: Record<string, ProviderRowType>;
  };
  timestampFormat: "iso8601_offset" | "epoch_ms";
  /** Where each part of the format came from (docs URLs), for a provider reference format. */
  sources?: { about: string; url: string }[];
  notes?: string[];
}

