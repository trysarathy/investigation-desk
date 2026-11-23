/**
 * rc7 column mapping (pure): catalogue, header suggestions, mapping validation and applyMapping on quirky values.
 * Every value is fictional except the two public token contracts.
 */
import { describe, expect, it } from "vitest";
import { CATALOGUE, FIELD_KINDS, FILE_TYPES, applyMapping, headerTokens, normalisedHeaderList, suggestMapping, validateMapping, type Mapping } from "@/lib/clearline/mapping";
import { USDC_ETHEREUM, USDT_TRON } from "@/lib/clearline/merchant/config";
import { readDelimited } from "@/lib/clearline/ingest";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A fictional, well-formed TRON address (base58, 34 characters). */
const tron = (n: number) => "T" + Array.from({ length: 33 }, (_, i) => B58[(n * 7 + i * 13) % 58]).join("");
const evm = (n: number) => "0x" + n.toString(16).padStart(40, "a");
const hash = (n: number) => n.toString(16).padStart(64, "c");
const table = (headers: string[], rows: string[][]) => ({ headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) });

describe("catalogue", () => {
  it("every file type has unique keys of known kinds and the fields rc7 names", () => {
    for (const ft of FILE_TYPES) {
      const keys = CATALOGUE[ft].map((f) => f.key);
      expect(new Set(keys).size, ft).toBe(keys.length);
      for (const f of CATALOGUE[ft]) expect(FIELD_KINDS).toContain(f.kind);
    }
    const pe = CATALOGUE.provider_export.map((f) => f.key);
    for (const k of ["order_id", "quote_id", "payment_id", "payment_link_id", "invoice_amount", "currency", "quoted_token_amount", "received_token_amount", "credited_fiat",
      "executed_rate", "token_symbol", "token_contract", "network", "tx_hash", "log_index", "deposit_address", "sender", "status", "batch_id", "fee", "created_at", "paid_at"]) expect(pe).toContain(k);
    expect(CATALOGUE.settlement_report.map((f) => f.key)).toEqual(expect.arrayContaining(["batch_id", "provider_day", "settlement_date", "bank_account", "fee", "refund", "gross", "net"]));
    expect(CATALOGUE.bank_statement.map((f) => f.key)).toEqual(expect.arrayContaining(["bank_account", "value_date", "amount", "direction", "reference", "counterparty"]));
    // a token is identified by its contract: the contract is required, the symbol is not
    expect(CATALOGUE.provider_export.find((f) => f.key === "token_contract")?.required).toBe(true);
    expect(CATALOGUE.provider_export.find((f) => f.key === "token_symbol")?.required).toBe(false);
  });
});

describe("header suggestions", () => {
  const prop = (headers: string[], ft: Parameters<typeof suggestMapping>[1] = "provider_export") => Object.fromEntries(Object.entries(suggestMapping(headers, ft).proposal).map(([k, v]) => [k, v.header]));
  it("tokenises camelCase, snake_case, punctuation, accents and abbreviations", () => {
    expect(headerTokens("orderNo")).toEqual(["order", "id"]);
    expect(headerTokens("ORDER_NO.")).toEqual(["order", "id"]);
    expect(headerTokens("Tx Hash (on-chain)")).toEqual(["tx", "hash", "chain"]);
    expect(headerTokens("Référence")).toEqual(["reference"]);
    expect(headerTokens("Amt #")).toEqual(["amount", "id"]);
  });
  it("proposes the expected headers for differently styled exports", () => {
    expect(prop(["Order No.", "Quote ID", "Amount (SGD)", "Ccy", "Crypto Amt", "TxID", "Deposit Addr", "Status", "Created", "Expiry", "Rate"])).toMatchObject({
      order_id: "Order No.", quote_id: "Quote ID", invoice_amount: "Amount (SGD)", currency: "Ccy", quoted_token_amount: "Crypto Amt", tx_hash: "TxID",
      deposit_address: "Deposit Addr", status: "Status", created_at: "Created", expires_at: "Expiry", quote_rate: "Rate",
    });
    expect(prop(["orderId", "quoteId", "invoiceAmount", "currency", "quotedAmount", "receivedAmount", "txHash", "walletAddress", "paymentStatus", "createdAt", "expiresAt"])).toMatchObject({
      order_id: "orderId", invoice_amount: "invoiceAmount", received_token_amount: "receivedAmount", deposit_address: "walletAddress", status: "paymentStatus",
    });
    expect(prop(["ORDER_REF", "QUOTATION_ID", "TOTAL", "CUR", "EXPECTED_AMOUNT", "TRANSACTION_HASH", "PAY_TO_ADDRESS", "STATE", "DATE_CREATED", "VALID_UNTIL", "FX_RATE"])).toMatchObject({
      order_id: "ORDER_REF", quote_id: "QUOTATION_ID", currency: "CUR", tx_hash: "TRANSACTION_HASH", expires_at: "VALID_UNTIL", quote_rate: "FX_RATE",
    });
    expect(prop(["Buchungsdatum", "Value Date", "Amount", "CCY", "Reference", "Remitter", "DR/CR"], "bank_statement")).toMatchObject({
      value_date: "Value Date", amount: "Amount", currency: "CCY", reference: "Reference", counterparty: "Remitter", direction: "DR/CR",
    });
    expect(prop(["Payout ID", "Settlement Day", "Gross Amount", "Total Fees", "Refunds", "Net Payout"], "settlement_report")).toMatchObject({
      batch_id: "Payout ID", provider_day: "Settlement Day", gross: "Gross Amount", fee: "Total Fees", refund: "Refunds",
    });
  });
  it("ranks with a confidence and a reason, deterministically, never confirmed, never one header twice", () => {
    const headers = ["Ordr ID", "order id", "Amount", "Amount"];
    const a = suggestMapping(headers, "orders_invoices");
    expect(a).toEqual(suggestMapping(headers, "orders_invoices"));
    expect(a.confirmed).toBe(false);
    const order = a.fields.find((f) => f.field === "order_id")!;
    expect(order.candidates[0]).toEqual({ header: "order id", confidence: 1, why: 'header matches "order id"' });
    expect(order.candidates[1].header).toBe("Ordr ID");
    expect(order.candidates[1].confidence).toBeLessThan(1);
    const used = Object.values(a.proposal).map((p) => p.header);
    expect(new Set(used).size).toBe(used.length);
  });
  it("normalises header lists for signatures: order, case and spacing do not matter", () => {
    expect(normalisedHeaderList([" Order  ID", "AMOUNT"])).toEqual(normalisedHeaderList(["amount", "order id"]));
  });
});

const PE: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "Order" }, quote_id: { header: "Quote" }, invoice_amount: { header: "Amount" }, currency: { constant: "SGD" },
    quoted_token_amount: { header: "Quoted" }, received_token_amount: { header: "Received" }, quote_rate: { header: "Rate" }, rate_source: { constant: "provider quote" },
    token_contract: { header: "Contract" }, network: { header: "Chain", networkValueMap: { "Tron (TRC20)": "tron" } }, token_symbol: { header: "Token" },
    deposit_address: { header: "Address" }, tx_hash: { header: "Hash" }, status: { header: "Status", statusValueMap: { Completed: "paid", "Short paid": "underpaid" } },
    payment_id: { header: "Payment" }, credited_fiat: { header: "Credited" }, executed_rate: { header: "Exec" },
    created_at: { header: "Created", dateFormat: "dmy", defaultUtcOffsetMinutes: 480 }, expires_at: { header: "Expires", dateFormat: "dmy", defaultUtcOffsetMinutes: 480 },
  },
};
const PE_HEADERS = ["Order", "Quote", "Payment", "Credited", "Exec", "Amount", "Quoted", "Received", "Rate", "Contract", "Chain", "Token", "Address", "Hash", "Status", "Created", "Expires"];
const peRow = (o: Partial<Record<string, string>>) => PE_HEADERS.map((h) => o[h] ?? ({
  Order: "ORD-1", Quote: "Q-1", Payment: "P-1", Credited: "1,349.33", Exec: "1.35", Amount: "1,350.00", Quoted: "1,000.000000", Received: "999.5", Rate: "1.3500", Contract: USDT_TRON, Chain: "Tron (TRC20)",
  Token: "usdt", Address: tron(1), Hash: "0x" + hash(1).toUpperCase(), Status: "Completed", Created: "03/11/2026 09:15", Expires: "03/11/2026 09:45",
} as Record<string, string>)[h]);

describe("validateMapping", () => {
  const issues = (m: unknown, headers?: string[]) => { const r = validateMapping(m, headers); return r.ok ? [] : r.issues.map((i) => `${i.field ?? i.header}:${i.code}`); };
  it("accepts a complete mapping and refuses missing, duplicated, unknown or ill-fitting columns", () => {
    expect(issues(PE, PE_HEADERS)).toEqual([]);
    const { order_id: _o, ...noOrder } = PE.columns;
    void _o;
    expect(issues({ ...PE, columns: noOrder })).toContain("order_id:required_field_unmapped");
    expect(issues({ ...PE, columns: { ...PE.columns, payment_id: { header: "Quote" } } }, PE_HEADERS)).toContain("Quote:header_used_twice");
    expect(issues({ ...PE, columns: { ...PE.columns, payment_id: { header: "Quote", allowSharedHeader: true }, quote_id: { header: "Quote", allowSharedHeader: true } } }, PE_HEADERS)).toEqual([]);
    expect(issues({ ...PE, columns: { ...PE.columns, order_id: { header: "Nope" } } }, PE_HEADERS)).toContain("order_id:header_not_in_file");
    expect(issues({ ...PE, columns: { ...PE.columns, order_id: { constant: "ORD-1" } } })).toContain("order_id:constant_not_allowed");
    expect(issues({ ...PE, columns: { ...PE.columns, status: { header: "Status" } } })).toContain("status:status_words_unmapped");
    expect(issues({ ...PE, columns: { ...PE.columns, status: { header: "Status", statusValueMap: { Completed: "settled" } } } })).toContain("status:invalid_status_target");
    expect(issues({ ...PE, columns: { ...PE.columns, order_id: { header: "Order", constant: "x" } } })).toContain("order_id:one_source");
    expect(issues({ ...PE, columns: { ...PE.columns, made_up: { header: "Order" } } })).toContain("made_up:unknown_field");
    expect(issues({ fileType: "settlement_report", columns: { provider_day: { header: "d" }, currency: { constant: "SGD" }, bank_account: { constant: "ACC-1" } } })).toContain("undefined:shape_required");
    expect(issues({ fileType: "bank_statement", columns: { bank_account: { constant: "A" }, value_date: { header: "d" }, currency: { constant: "SGD" }, amount: { headers: ["Credit", "Debit"], sign: "credit_debit_columns" } } })).toEqual([]);
    expect(issues({ fileType: "bank_statement", columns: { bank_account: { constant: "A" }, value_date: { header: "d" }, currency: { constant: "SGD" }, amount: { header: "x", sign: "credit_debit_columns" } } })).toContain("amount:split_needs_two_columns");
  });
});

describe("applyMapping", () => {
  it("reads a provider export exactly: thousand separators, DD/MM with a default offset, token by contract, status claims, hash case", () => {
    const r = applyMapping(table(PE_HEADERS, [peRow({})]), PE);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows[0]).toMatchObject({ status: "warning", errors: [], warnings: [{ field: "log_index", code: "log_index_missing_assumed_0" }] });
    expect(r.rows[0].values).toMatchObject({
      invoice_amount: 135000n, currency: "SGD", quoted_token_amount: 1_000_000_000n, received_token_amount: 999_500_000n, quote_rate: "1.35", network: "tron",
      token_contract: USDT_TRON, token_symbol: "USDT", status: "paid", status_text: "Completed", tx_hash: hash(1), created_at: "2026-11-03T01:15:00.000Z", expires_at: "2026-11-03T01:45:00.000Z",
    });
  });
  it("never identifies a token by its symbol: a look-alike contract is rejected even when it says USDT", () => {
    const r = applyMapping(table(PE_HEADERS, [peRow({ Contract: tron(99) })]), PE);
    if (!r.ok) throw new Error("mapping");
    expect(r.rows[0].status).toBe("rejected");
    expect(r.rows[0].errors).toEqual(expect.arrayContaining([{ field: "token_contract", code: "unknown_token" }, { field: "quoted_token_amount", code: "unknown_token" }]));
    const wrongSymbol = applyMapping(table(PE_HEADERS, [peRow({ Token: "USDC" })]), PE);
    if (!wrongSymbol.ok) throw new Error("mapping");
    expect(wrongSymbol.rows[0].warnings).toContainEqual({ field: "token_symbol", code: "symbol_differs_from_contract" });
    const eth = applyMapping(table(PE_HEADERS, [peRow({ Contract: USDC_ETHEREUM.toLowerCase(), Chain: "ERC20", Address: evm(7), Hash: hash(2) })]), PE);
    if (!eth.ok) throw new Error("mapping");
    expect(eth.rows[0].values).toMatchObject({ network: "ethereum", tx_hash: "0x" + hash(2) });
  });
  it("rejects rows with reason codes and no cell values: unmapped status, too many decimals, missing offset, bad window, missing value", () => {
    const marker = "ZQX-MARKER-7731";
    const rows = [peRow({ Status: marker }), peRow({ Quoted: "1000.0000001" }), peRow({ Expires: "03/11/2026 09:00" }), peRow({ Order: "" }), peRow({ Hash: marker })];
    const r = applyMapping(table(PE_HEADERS, rows), PE);
    if (!r.ok) throw new Error("mapping");
    expect(r.rows.map((x) => x.errors.map((e) => `${e.field}:${e.code}`))).toEqual([
      ["status:unmapped_status"], ["quoted_token_amount:amount_too_many_decimals"], ["expires_at:quote_expires_before_created"], ["order_id:missing_value"], ["tx_hash:invalid_tx_hash"],
    ]);
    expect(r.counts).toEqual({ accepted: 0, rejected: 5, warning: 0 });
    const noOffset = applyMapping(table(PE_HEADERS, [peRow({})]), { ...PE, columns: { ...PE.columns, created_at: { header: "Created", dateFormat: "dmy" } } });
    if (!noOffset.ok) throw new Error("mapping");
    expect(noOffset.rows[0].errors).toContainEqual({ field: "created_at", code: "utc_offset_unknown" });
    expect(JSON.stringify(r.rows.map((x) => [x.errors, x.warnings]))).not.toContain(marker);
  });
  it("decides a date column's format from all its values, and asks when it cannot", () => {
    const m = { ...PE, columns: { ...PE.columns, created_at: { header: "Created", defaultUtcOffsetMinutes: 0 }, expires_at: { header: "Expires", defaultUtcOffsetMinutes: 0 } } };
    const ambiguous = applyMapping(table(PE_HEADERS, [peRow({ Created: "03/11/2026 09:15", Expires: "03/11/2026 09:45" })]), m);
    if (!ambiguous.ok) throw new Error("mapping");
    expect(ambiguous.columnIssues).toEqual([{ field: "created_at", code: "date_format_ambiguous" }, { field: "expires_at", code: "date_format_ambiguous" }]);
    expect(ambiguous.rows[0].errors).toContainEqual({ field: "created_at", code: "date_format_needed" });
    const decided = applyMapping(table(PE_HEADERS, [peRow({ Created: "03/11/2026 09:15", Expires: "03/11/2026 09:45" }), peRow({ Quote: "Q-2", Created: "25/11/2026 10:00", Expires: "25/11/2026 10:30" })]), m);
    if (!decided.ok) throw new Error("mapping");
    expect(decided.columnIssues).toEqual([]);
    expect(decided.rows[0].values.created_at).toBe("2026-11-03T09:15:00.000Z");
  });
  it("bank statements: decimal comma, bracket negatives, DR/CR, a credit/debit split and a direction column", () => {
    const signed: Mapping = { fileType: "bank_statement", columns: { bank_account: { constant: "ACC-FICTIONAL-1" }, value_date: { header: "Datum", dateFormat: "dmy" }, currency: { header: "Ccy" }, amount: { header: "Betrag", decimalSeparator: "," }, reference: { header: "Ref" } } };
    const t1 = readDelimited(new TextEncoder().encode("Datum;Betrag;Ccy;Ref\n02.11.2026;1.234,56;EUR;R-1\n03.11.2026;(12,00);EUR;R-2\n04.11.2026;99,50 DR;EUR;R-3\n05.11.2026;0,00;EUR;R-4\n"));
    const a = applyMapping(t1, signed);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    expect(a.rows.map((r) => [r.values.value_date, r.values.amount, r.values.direction, r.status])).toEqual([
      ["2026-11-02", 123456n, "credit", "accepted"], ["2026-11-03", 1200n, "debit", "accepted"], ["2026-11-04", 9950n, "debit", "accepted"], ["2026-11-05", 0n, "credit", "warning"],
    ]);
    const split: Mapping = { fileType: "bank_statement", columns: { bank_account: { header: "Acct" }, value_date: { header: "Date" }, currency: { constant: "USD" }, amount: { headers: ["In", "Out"], sign: "credit_debit_columns" } } };
    const b = applyMapping(table(["Acct", "Date", "In", "Out"], [["A-1", "2026-11-02", "1,000.00", ""], ["A-1", "2026-11-02", "", "25.10"], ["A-1", "2026-11-02", "5.00", "5.00"]]), split);
    if (!b.ok) throw new Error(JSON.stringify(b.issues));
    expect(b.rows.map((r) => [r.values.amount, r.values.direction, r.errors.map((e) => e.code).join()])).toEqual([[100000n, "credit", ""], [2510n, "debit", ""], [undefined, undefined, "credit_and_debit_both_filled"]]);
    const dir: Mapping = { fileType: "bank_statement", columns: { bank_account: { constant: "A" }, value_date: { header: "Date" }, currency: { constant: "SGD" }, amount: { header: "Amt", sign: "direction_field" }, direction: { header: "Type", directionValueMap: { Gutschrift: "credit" } } } };
    const c = applyMapping(table(["Date", "Amt", "Type"], [["2026-11-02", "10.00", "Gutschrift"], ["2026-11-02", "10.00", "DR"], ["2026-11-02", "10.00", "??"]]), dir);
    if (!c.ok) throw new Error(JSON.stringify(c.issues));
    expect(c.rows.map((r) => r.values.direction ?? r.errors[0].code)).toEqual(["credit", "debit", "unknown_direction"]);
  });
  it("settlement totals must add up; amounts in minor units; an unknown currency is refused", () => {
    const m: Mapping = { fileType: "settlement_report", shape: "batch_totals", columns: { batch_id: { header: "B" }, provider_day: { header: "Day" }, currency: { header: "Cur" }, bank_account: { constant: "ACC-F" }, gross: { header: "G", amountUnit: "minor" }, fee: { header: "F", amountUnit: "minor" }, net: { header: "N", amountUnit: "minor" } } };
    const r = applyMapping(table(["B", "Day", "Cur", "G", "F", "N"], [["B-1", "2026-11-02", "SGD", "602145", "6021", "596124"], ["B-2", "2026-11-02", "SGD", "100", "1", "98"], ["B-3", "2026-11-02", "XYZ", "1", "0", "1"]]), m);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows[0].values).toMatchObject({ gross: 602145n, fee: 6021n, net: 596124n });
    expect(r.rows[1].errors).toEqual([{ field: "net", code: "totals_do_not_add_up" }]);
    expect(r.rows[2].errors.map((e) => e.code)).toContain("unknown_currency");
  });
  it("an invalid mapping applies nothing and says why", () => {
    const r = applyMapping(table(["a"], [["1"]]), { fileType: "orders_invoices", columns: { order_id: { header: "a" } } });
    expect(r.ok).toBe(false);
  });
});
