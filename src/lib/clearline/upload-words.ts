/**
 * rc7 upload screens: plain-English words for file types, statuses, reader warnings and validation reason codes.
 * Pure (importable from browser code). A reason never quotes a cell's value: the server stores codes only.
 */
import type { FileType } from "./mapping";

export const FILE_TYPE_LABELS: Readonly<Record<FileType, string>> = {
  provider_export: "Provider export",
  settlement_report: "Settlement report",
  orders_invoices: "Orders or invoices",
  bank_statement: "Bank statement",
  ledger_invoices: "Ledger invoices",
  settlement_payments: "Settlement, per payment",
};
export const FILE_TYPE_HINTS: Readonly<Record<FileType, string>> = {
  provider_export: "Your payment provider's list of quotes and payments (CSV, TSV, XLSX or JSON).",
  settlement_report: "What the provider paid out, per payment line or per batch (CSV, TSV, XLSX or JSON).",
  orders_invoices: "Your own orders or invoices (CSV, TSV, XLSX or JSON).",
  bank_statement: "A statement of your bank account (CSV, TSV, XLSX, MT940, camt.053, camt.054 or BAI2). A second person, an Approver who did not upload it, confirms it.",
  ledger_invoices: "Sales invoices from your accounting system (CSV, TSV, XLSX or JSON). Used for month-end comparison; never changes a match.",
  settlement_payments: "The provider's settlement, one row per payment: payment ID, gross, fee, net and batch (CSV, TSV, XLSX or JSON). A refund row names the original payment's ID and its own refund ID, with the amount returned as a negative gross and net. Upload the batch totals report first.",
};
export const ACCEPT = ".csv,.tsv,.txt,.xlsx,.json,.sta,.mt940,.940,.xml,.bai,.bai2";
export const LIMITS_TEXT = "CSV, TSV, XLSX or JSON tables, or MT940, camt.053, camt.054 and BAI2 bank statements. At most 20 MB, 100,000 rows and 200 columns per file.";

export const STATUS_LABELS: Readonly<Record<string, string>> = {
  stored: "Stored, needs mapping", mapped: "Mapped, needs validation", validated: "Validated, awaiting confirmation", confirmed: "Confirmed",
  normalised: "In reconciliation", rejected: "Declined", deleted: "Deleted",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

export const FORMAT_LABELS: Readonly<Record<string, string>> = { csv: "CSV", tsv: "TSV (tab separated)", xlsx: "Excel workbook (XLSX)", json: "JSON", mt940: "MT940 statement", camt053: "camt.053 statement", camt054: "camt.054 notification", bai2: "BAI2 statement" };

/** Structured bank-statement formats: read by the bank parsers, never column-mapped. */
export const STATEMENT_FORMATS = ["mt940", "camt053", "camt054", "bai2"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];
export const isStatementFormat = (f: string): f is StatementFormat => (STATEMENT_FORMATS as readonly string[]).includes(f);
export const DELIMITER_WORDS: Readonly<Record<string, string>> = { ",": "commas", ";": "semicolons", "\t": "tabs", "|": "vertical bars" };
export const ENCODING_WORDS: Readonly<Record<string, string>> = { "utf-8": "UTF-8", "utf-16le": "UTF-16 (little-endian)", "utf-16be": "UTF-16 (big-endian)", "windows-1252": "Windows-1252 (Western European)" };

const WARNINGS: Readonly<Record<string, string>> = {
  total_row_excluded: "A row at the end looks like a total, not a transaction, and was left out.",
  title_rows_skipped: "Rows above the header looked like titles and were skipped.",
  blank_rows_skipped: "Blank rows were skipped.",
  short_rows: "Some rows have fewer values than there are columns; the missing values are empty.",
  extra_cells: "Some rows have more values than the header has names; the extra columns got numbered names.",
  duplicate_headers: "Repeated column names were numbered.",
  stray_quote: "A quote mark in the file did not close as expected; check the rows around it.",
  extension_mismatch: "The file's name ending does not match its content; it was read by its content.",
  json_array_property: "The rows were read from the list inside the JSON file.",
  xlsx_error_cell: "Some spreadsheet cells hold an error value.",
  xlsx_formula_no_result: "Some spreadsheet formulas have no saved result; those cells are empty.",
  xlsx_precision: "Some spreadsheet numbers may have lost precision; check amounts.",
  xlsx_more_warnings: "The workbook has further warnings.",
  balance_mismatch: "Opening balance plus entries does not equal the closing balance.",
  missing_balance: "A statement has no opening or closing balance.",
  missing_closing_balance: "A statement has no closing balance.",
  entries_not_booked: "Some entries are not booked yet and were left out.",
  entry_currency_differs: "Some entries are in another currency than the account.",
  camt_version: "The camt.053 or camt.054 version is not the one usually seen; check the entries.",
  no_balances: "A camt.054 notification carries no balances, so its entries cannot be checked against a closing balance.",
  bai2_currency_defaulted: "The BAI2 file states no currency; BAI2's default, USD, was used.",
  bai2_summary_mismatch: "A BAI2 total-credits or total-debits summary does not equal its entries.",
  entries_not_read: "Some BAI2 transactions have a type code without a known direction and were left out.",
  total_rows_excluded: "Total rows at the end of the file were left out.",
  statement_not_balanced: "A statement's balances do not add up.",
  statement_entries_skipped: "Some statement entries were skipped.",
};
export const warningText = (code: string) => {
  const col = /^column:([a-z_]+):([a-z_]+)$/.exec(code);
  if (col) return `${col[1].replace(/_/g, " ")}: ${reasonText(col[2])}`;
  return WARNINGS[code] ?? code.replace(/_/g, " ");
};

const REASONS: Readonly<Record<string, string>> = {
  missing_value: "is empty but needed", currency_not_bank_account: "is not the currency of the statement's bank account", unknown_currency: "is not a currency code Clearline knows", unknown_network: "is not a network Clearline knows",
  unknown_direction: "is neither credit nor debit", unmapped_status: "has a word you did not map to a Clearline status", invalid_address: "is not a valid address for the row's network",
  invalid_tx_hash: "is not a valid transaction hash", rate_not_positive: "is not a positive rate", date_format_needed: "needs you to choose the date order",
  invalid_date: "is not a date in the chosen format", missing_time: "has no time of day", utc_offset_unknown: "has no time zone and none was chosen",
  negative_amount: "is negative", unknown_token: "is not a token Clearline knows for that network and contract", too_long: "is too long",
  not_an_integer: "is not a whole number", control_characters: "contains control characters", decimal_separator_needed: "needs you to choose the decimal separator",
  decimal_separator_conflict: "mixes decimal points and decimal commas", date_format_ambiguous: "could be day/month or month/day; choose the order",
  date_format_unknown: "is in a date format Clearline does not recognise", date_format_inconsistent: "is not written the same way on every row",
  currency_unknown_for_amount: "cannot be read without the row's currency", credit_and_debit_both_filled: "has both a credit and a debit",
  negative_credit: "has a negative credit", sign_conflicts_with_direction: "has a sign that contradicts the direction",
  quote_expires_before_created: "ends before the quote was created", log_index_missing_resolved_from_chain: "is not in the file; the transfer is found from chain data (never assumed)",
  token_symbol_ambiguous: "names a symbol shared by two configured tokens on this network", token_needs_network_and_symbol: "cannot be worked out without the row's network and token symbol", token_needs_symbol: "cannot be worked out: the network has several configured tokens and the file has no token symbol",
  deduction_line_positive: "is positive on a refund or fee line (the mapping says deductions are negative)", payment_line_negative: "is negative on a payment line",
  symbol_differs_from_contract: "differs from the token the contract identifies (the contract is used)", batch_id_needed_for_totals: "is needed for a totals row",
  totals_do_not_add_up: "does not equal gross minus fees minus refunds", zero_amount: "is zero",
  gross_less_fee_not_net: "does not equal gross minus fee",
  refund_amount_not_negative: "is not negative on a refund row (a refund row gives the money returned as a negative amount)", refund_fee_not_zero: "is not zero on a refund row",
  refund_id_on_payment_row: "is given on a payment row (only a refund row has a refund ID)", bank_reversal: "is marked by the bank as a reversal or return of an earlier entry; review it", two_pricing_modes: "is given together with a fiat amount (give one price only)", amount_not_positive: "is not more than zero",
  amount_not_a_number: "is not an amount", amount_too_many_decimals: "has more decimals than the currency or token allows", amount_empty: "is empty",
  amount_bad_grouping: "has thousand separators in the wrong places", amount_exponent: "is written with an exponent", amount_too_large: "is too large",
  amount_conflicting_signs: "has two signs", amount_dr_cr_disabled: "is marked DR or CR, which this field does not accept", amount_too_long: "is too long",
};
export const reasonText = (code: string) => REASONS[code] ?? code.replace(/^amount_/, "amount: ").replace(/_/g, " ");

/** v1: a bank account as people read it: its name, masked number and currency (never a full account number). */
export const bankAccountLabel = (a: { displayName: string; accountLast4: string; currency: string }) => `${a.displayName} (•••• ${a.accountLast4}, ${a.currency})`;
