/**
 * rc7 mapping options for real provider exports and settlement reports: quote terms that are not required (the
 * engine abstains instead), the token contract as a confirmed mapping default from (network, token symbol) via the
 * configured token table, and settlement fee lines and negative deductions. Fictional values only.
 */
import { describe, expect, it } from "vitest";
import { CATALOGUE, applyMapping, validateMapping, type Mapping } from "@/lib/clearline/mapping";
import { USDC_ETHEREUM, USDT_TRON } from "@/lib/clearline/merchant/config";
import type { TokenConfig } from "@/lib/clearline/merchant/types";

const table = (headers: string[], rows: string[][]) => ({ headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) });
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const TOKENS: TokenConfig[] = [
  { network: "tron", contract: USDT_TRON, symbol: "USDT", decimals: 6 },
  { network: "ethereum", contract: USDC_ETHEREUM, symbol: "USDC", decimals: 6 },
  { network: "ethereum", contract: USDT_ETH, symbol: "USDT", decimals: 6 },
];
const ADDR_T = "TJFz1aHgM1mrcDbbRrxAK38hDjSAtdZgv8", ADDR_E = "0x1111111111111111111111111111111111111111";

describe("provider export: what is truly required", () => {
  it("quote id, invoice amount, quoted amount, quoted rate, rate source and quote window are optional; order, currency, network, deposit address and token are not", () => {
    const req = CATALOGUE.provider_export.filter((f) => f.required).map((f) => f.key).sort();
    expect(req).toEqual(["currency", "deposit_address", "network", "order_id", "token_contract"]);
  });

  const H = ["Order", "Asset", "Chain", "Address", "Payment", "Received", "Credited", "Rate", "Status"];
  const M = (contract: Mapping["columns"][string]): Mapping => ({
    fileType: "provider_export", columns: {
      order_id: { header: "Order" }, currency: { constant: "SGD" }, token_symbol: { header: "Asset" }, network: { header: "Chain" }, deposit_address: { header: "Address" },
      payment_id: { header: "Payment" }, received_token_amount: { header: "Received" }, credited_fiat: { header: "Credited" }, executed_rate: { header: "Rate" },
      status: { header: "Status", statusValueMap: { Paid: "paid" } }, token_contract: contract,
    },
  });
  const rows = [["O-1", "USDT", "TRON", ADDR_T, "P-1", "10", "13.50", "1.35", "Paid"], ["O-2", "usdt", "Ethereum", ADDR_E, "P-2", "10", "13.50", "1.35", "Paid"], ["O-3", "USDC", "Ethereum", ADDR_E, "P-3", "10", "13.50", "1.35", "Paid"], ["O-4", "DAI", "Ethereum", ADDR_E, "P-4", "10", "13.50", "1.35", "Paid"]];

  it("the token contract can be the confirmed default 'from network and symbol': the one configured token per (network, symbol)", () => {
    const r = applyMapping(table(H, rows), M({ derive: "network_and_symbol" }), { tokens: TOKENS });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows.map((x) => [x.status, x.values.token_contract ?? x.errors[0].code])).toEqual([
      ["accepted", USDT_TRON], ["accepted", USDT_ETH], ["accepted", USDC_ETHEREUM], ["rejected", "unknown_token"],
    ]);
    expect(r.rows[1].values.received_token_amount).toBe(10_000_000n); // read at USDT's 6 decimals
  });

  it("a symbol two configured tokens share on one network is refused per row, never guessed", () => {
    const twoUsdt = [...TOKENS, { network: "ethereum" as const, contract: "0x2222222222222222222222222222222222222222", symbol: "USDT", decimals: 6 }];
    const r = applyMapping(table(H, rows.slice(0, 2)), M({ derive: "network_and_symbol" }), { tokens: twoUsdt });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows.map((x) => [x.status, x.errors.find((e) => e.field === "token_contract")?.code ?? null])).toEqual([["accepted", null], ["rejected", "token_symbol_ambiguous"]]);
  });

  it("without a symbol column, only a network with one configured token resolves (TRON); Ethereum rows are refused, never guessed", () => {
    const { token_symbol: _s, ...noSymbol } = M({ derive: "network_and_symbol" }).columns;
    void _s;
    const r = applyMapping(table(H, rows.slice(0, 3)), { fileType: "provider_export", columns: noSymbol }, { tokens: TOKENS });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows.map((x) => [x.status, x.values.token_contract ?? x.errors.find((e) => e.field === "token_contract")?.code])).toEqual([["accepted", USDT_TRON], ["rejected", "token_needs_symbol"], ["rejected", "token_needs_symbol"]]);
  });

  it("the default must be chosen explicitly and is only for the token contract", () => {
    const { token_contract: _t, ...none } = M({ derive: "network_and_symbol" }).columns;
    void _t;
    const codes = (m: unknown) => { const v = validateMapping(m, H); return v.ok ? [] : v.issues.map((i) => `${i.field}:${i.code}`); };
    expect(codes({ fileType: "provider_export", columns: none })).toContain("token_contract:required_field_unmapped");
    expect(codes({ fileType: "provider_export", columns: { ...M({ derive: "network_and_symbol" }).columns, network: { derive: "network_and_symbol" } } })).toContain("network:option_not_allowed");
    expect(codes({ fileType: "provider_export", columns: { ...M({ header: "Asset", derive: "network_and_symbol" }).columns } })).toContain("token_contract:one_source");
  });
});

describe("settlement report lines: fee lines and negative deductions", () => {
  const H = ["Batch", "Day", "Type", "Payment", "Refund", "Order", "Amount"];
  const M = (deductionSign?: "negative" | "positive"): Mapping => ({
    fileType: "settlement_report", shape: "per_payment_lines", columns: {
      batch_id: { header: "Batch" }, provider_day: { header: "Day" }, currency: { constant: "SGD" }, bank_account: { constant: "ACC-1" }, payment_id: { header: "Payment" },
      refund_id: { header: "Refund" }, order_id: { header: "Order" }, line_type: { header: "Type", statusValueMap: { payment: "payment", refund: "refund", fee: "fee" } },
      line_amount: { header: "Amount", ...(deductionSign ? { deductionSign } : {}) },
    },
  });
  const rows = [["B-1", "2026-11-02", "payment", "P-1", "", "O-1", "100.00"], ["B-1", "2026-11-02", "refund", "", "R-1", "O-9", "-20.00"], ["B-1", "2026-11-02", "fee", "", "", "", "-1.00"]];

  it("with 'deductions are negative', a refund and a fee line are read as their size; a fee line names no payment", () => {
    const r = applyMapping(table(H, rows), M("negative"));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.rows.map((x) => [x.status, x.values.line_type, x.values.line_amount])).toEqual([["accepted", "payment", 10000n], ["accepted", "refund", 2000n], ["accepted", "fee", 100n]]);
  });
  it("without it, negative amounts are refused (the earlier behaviour); with it, a positive fee or a negative payment is refused", () => {
    const plain = applyMapping(table(H, rows), M());
    if (!plain.ok) throw new Error("mapping");
    expect(plain.rows.map((x) => x.errors.map((e) => e.code).join())).toEqual(["", "negative_amount", "negative_amount"]);
    const wrong = applyMapping(table(H, [["B-1", "2026-11-02", "payment", "P-1", "", "O-1", "-100.00"], ["B-1", "2026-11-02", "fee", "", "", "", "1.00"]]), M("negative"));
    if (!wrong.ok) throw new Error("mapping");
    expect(wrong.rows.map((x) => x.errors.map((e) => e.code).join())).toEqual(["payment_line_negative", "deduction_line_positive"]);
  });
  it("the sign option belongs to the settlement line amount only", () => {
    const v = validateMapping({ fileType: "bank_statement", columns: { bank_account: { constant: "A" }, value_date: { header: "d" }, currency: { constant: "SGD" }, amount: { header: "a", deductionSign: "negative" } } });
    expect(v.ok ? [] : v.issues.map((i) => `${i.field}:${i.code}`)).toContain("amount:option_not_allowed");
  });
});
