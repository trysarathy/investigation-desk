/**
 * rc7 column mapping: the Clearline fields a person maps a file's columns to, per file type. Pure data.
 *
 * A field's `kind` decides how its cells are read (src/lib/clearline/mapping/apply.ts). Synonyms feed the header
 * suggestions (suggest.ts); they are lower-case word sequences, never provider names. MT940 and camt.053 statements
 * need no column mapping (the bank parsers read them); only CSV/XLSX statements are mapped.
 */

export const FILE_TYPES = ["provider_export", "settlement_report", "orders_invoices", "bank_statement"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FIELD_KINDS = [
  "id", "fiat_amount", "token_amount", "currency", "token_symbol", "network", "tx_hash", "address", "status", "datetime", "date",
  "batch_id", "rate", "text", "integer", "direction",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** The value may be a constant for the whole file (e.g. one currency or one bank account). */
  allowConstant?: boolean;
  /** The value may come from two columns joined with a space (e.g. a date column and a time column). */
  allowMultiple?: boolean;
  /** Fiat amounts: the field whose value is this amount's currency. Token amounts: read with the row's token. */
  currencyField?: string;
  synonyms: readonly string[];
}

const f = (key: string, label: string, kind: FieldKind, required: boolean, synonyms: readonly string[], extra: Partial<FieldDef> = {}): FieldDef =>
  ({ key, label, kind, required, synonyms, ...extra });

const ORDER_ID = f("order_id", "Order ID", "id", true, ["order id", "order", "order reference", "merchant order id", "merchant reference", "invoice id", "invoice number", "invoice"]);
const CURRENCY = f("currency", "Currency", "currency", true, ["currency", "fiat currency", "invoice currency", "order currency", "currency code"], { allowConstant: true });

export const CATALOGUE: Readonly<Record<FileType, readonly FieldDef[]>> = {
  provider_export: [
    ORDER_ID,
    f("quote_id", "Quote ID", "id", true, ["quote id", "quote", "quotation id", "checkout id", "session id"]),
    f("payment_id", "Payment ID", "id", false, ["payment id", "provider payment id", "transaction id", "provider reference", "payment reference"]),
    f("payment_link_id", "Payment link ID", "id", false, ["payment link id", "link id", "payment link", "invoice link id"]),
    f("invoice_amount", "Invoice amount", "fiat_amount", true, ["invoice amount", "order amount", "amount", "fiat amount", "price", "total"], { currencyField: "currency" }),
    CURRENCY,
    f("quoted_token_amount", "Quoted token amount", "token_amount", true, ["quoted amount", "crypto amount", "token amount", "expected amount", "amount due", "quoted crypto amount"]),
    f("received_token_amount", "Received token amount", "token_amount", false, ["received amount", "amount received", "paid amount", "received crypto amount", "actual amount"]),
    f("credited_fiat", "Credited fiat amount", "fiat_amount", false, ["credited amount", "credited fiat", "settled amount", "merchant amount", "credit amount"], { currencyField: "currency" }),
    f("quote_rate", "Quoted rate", "rate", true, ["quote rate", "quoted rate", "exchange rate", "rate", "fx rate"]),
    f("rate_source", "Rate source", "text", true, ["rate source", "price source", "fx source"], { allowConstant: true }),
    f("executed_rate", "Executed rate", "rate", false, ["executed rate", "execution rate", "settlement rate", "conversion rate"]),
    f("token_symbol", "Token symbol", "token_symbol", false, ["token", "asset", "coin", "crypto currency", "cryptocurrency", "token symbol", "symbol"]),
    f("token_contract", "Token contract", "address", true, ["token contract", "contract", "contract address", "token address", "asset contract"], { allowConstant: true }),
    f("network", "Network", "network", true, ["network", "chain", "blockchain", "protocol"], { allowConstant: true }),
    f("tx_hash", "Transaction hash", "tx_hash", false, ["tx hash", "transaction hash", "txid", "tx id", "hash", "blockchain transaction"]),
    f("log_index", "Log index", "integer", false, ["log index", "event index", "transfer index"]),
    f("deposit_address", "Deposit address", "address", true, ["deposit address", "wallet address", "pay to address", "receiving address", "address", "destination address"]),
    f("sender", "Sender address", "address", false, ["sender", "from address", "sender address", "payer address", "from"]),
    f("status", "Status", "status", false, ["status", "payment status", "state"]),
    f("batch_id", "Settlement batch ID", "batch_id", false, ["batch id", "settlement id", "settlement batch", "payout id", "batch"]),
    f("fee", "Fee", "fiat_amount", false, ["fee", "fees", "provider fee", "processing fee", "commission"], { currencyField: "currency" }),
    f("created_at", "Quote created at", "datetime", true, ["created at", "created", "quote created", "creation time", "date created"], { allowMultiple: true }),
    f("expires_at", "Quote expires at", "datetime", true, ["expires at", "expiry", "expiration", "quote expiry", "valid until"], { allowMultiple: true }),
    f("paid_at", "Paid at", "datetime", false, ["paid at", "payment time", "completed at", "confirmed at", "paid date"], { allowMultiple: true }),
  ],
  settlement_report: [
    f("batch_id", "Settlement batch ID", "batch_id", false, ["batch id", "settlement id", "settlement batch", "payout id", "batch"]),
    f("provider_day", "Provider day", "date", true, ["provider day", "settlement day", "business day", "report date", "day"]),
    f("settlement_date", "Settlement date", "date", false, ["settlement date", "payout date", "value date", "transfer date"]),
    f("currency", "Settlement currency", "currency", true, ["currency", "settlement currency", "payout currency"], { allowConstant: true }),
    f("bank_account", "Bank account", "text", true, ["bank account", "account", "payout account", "destination account", "iban", "account number"], { allowConstant: true }),
    // per-payment lines
    f("payment_id", "Payment ID", "id", false, ["payment id", "provider payment id", "transaction id", "payment reference"]),
    f("refund_id", "Refund ID", "id", false, ["refund id", "refund reference"]),
    f("order_id", "Order ID", "id", false, ["order id", "order", "merchant reference", "invoice id"]),
    f("line_amount", "Line amount", "fiat_amount", false, ["amount", "line amount", "payment amount"], { currencyField: "currency" }),
    f("line_type", "Line type (payment or refund)", "status", false, ["type", "line type", "kind", "transaction type"]),
    // batch totals
    f("gross", "Gross", "fiat_amount", false, ["gross", "gross amount", "total gross", "sales"], { currencyField: "currency" }),
    f("fee", "Fees", "fiat_amount", false, ["fee", "fees", "total fees", "provider fee", "commission"], { currencyField: "currency" }),
    f("refund", "Refunds", "fiat_amount", false, ["refund", "refunds", "total refunds", "refund amount"], { currencyField: "currency" }),
    f("net", "Net", "fiat_amount", false, ["net", "net amount", "payout", "payout amount", "net settlement"], { currencyField: "currency" }),
  ],
  orders_invoices: [
    ORDER_ID,
    f("invoice_amount", "Invoice amount", "fiat_amount", true, ["invoice amount", "amount", "total", "order amount", "amount due"], { currencyField: "currency" }),
    CURRENCY,
    f("status", "Invoice status", "status", false, ["status", "invoice status", "state"]),
    f("issued_at", "Issued at", "datetime", false, ["issued at", "invoice date", "created at", "date", "order date"], { allowMultiple: true }),
  ],
  bank_statement: [
    f("bank_account", "Bank account", "text", true, ["account", "bank account", "account number", "iban", "account no"], { allowConstant: true }),
    f("value_date", "Value date", "date", true, ["value date", "date", "transaction date", "posting date", "booking date"]),
    f("booking_date", "Booking date", "date", false, ["booking date", "entry date", "posted date"]),
    f("amount", "Amount", "fiat_amount", true, ["amount", "transaction amount", "credit", "deposit", "value"], { currencyField: "currency", allowMultiple: true }),
    f("currency", "Currency", "currency", true, ["currency", "ccy", "currency code"], { allowConstant: true }),
    f("direction", "Direction (credit or debit)", "direction", false, ["direction", "credit debit", "dr cr", "cr dr", "type", "debit credit indicator"]),
    f("reference", "Reference", "text", false, ["reference", "payment reference", "customer reference", "end to end id", "remittance information"]),
    f("counterparty", "Counterparty", "text", false, ["counterparty", "payer", "remitter", "beneficiary", "name", "from"]),
    f("bank_reference", "Bank reference", "id", false, ["bank reference", "transaction id", "bank transaction id", "statement reference"]),
    f("description", "Description", "text", false, ["description", "narrative", "details", "memo", "particulars", "text"]),
  ],
};

export function fieldsOf(fileType: FileType): readonly FieldDef[] {
  return CATALOGUE[fileType];
}

export function fieldOf(fileType: FileType, key: string): FieldDef | undefined {
  return CATALOGUE[fileType].find((x) => x.key === key);
}

/**
 * What a status column's words may be mapped to. Provider statuses are CLAIMS (never proof); an unmapped word rejects
 * its row rather than being guessed.
 */
export const STATUS_TARGETS: Readonly<Partial<Record<FileType, Readonly<Record<string, readonly string[]>>>>> = {
  provider_export: { status: ["paid", "underpaid", "overpaid", "held_for_review", "re_quoted", "partially_paid", "pending"] },
  orders_invoices: { status: ["open", "void"] },
  settlement_report: { line_type: ["payment", "refund"] },
};

/** Settlement reports come as one row per payment line, or as one row per batch with totals only. */
export const SETTLEMENT_SHAPES = ["per_payment_lines", "batch_totals"] as const;
export type SettlementShape = (typeof SETTLEMENT_SHAPES)[number];

/** Fields a settlement report of each shape must map, on top of the catalogue's always-required fields. */
export const SETTLEMENT_REQUIRED: Readonly<Record<SettlementShape, readonly string[]>> = {
  per_payment_lines: ["batch_id", "order_id", "line_amount"],
  batch_totals: ["gross", "net"],
};
