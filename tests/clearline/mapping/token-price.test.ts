/**
 * v1 Phase 0 (approval-only draft): an orders file may price an order directly in a token. The mapping maps a fiat
 * amount or a token price (with its network and token contract); each row gives exactly one pricing mode, on a
 * configured token, in exact base units. Fictional values; the public USDT (TRON) contract only.
 */
import { describe, expect, it } from "vitest";
import { applyMapping, validateMapping, type Mapping } from "@/lib/clearline/mapping";
import { USDT_TRON } from "@/lib/clearline/merchant/config";

const table = (headers: string[], rows: string[][]) => ({ headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) });
const HEADERS = ["Order", "Amount", "Currency", "Token price", "Network", "Contract"];
const MAPPING: Mapping = {
  fileType: "orders_invoices",
  columns: {
    order_id: { header: "Order" }, invoice_amount: { header: "Amount" }, currency: { header: "Currency" },
    price_token_amount: { header: "Token price" }, network: { header: "Network" }, token_contract: { header: "Contract" },
  },
};

describe("token-priced orders: mapping", () => {
  it("a fiat-only orders mapping is valid exactly as before", () => {
    expect(validateMapping({ fileType: "orders_invoices", columns: { order_id: { header: "Order" }, invoice_amount: { header: "Amount" }, currency: { header: "Currency" } } }, HEADERS).ok).toBe(true);
  });
  it("a token-price-only mapping is valid with its network and contract; without them it is refused", () => {
    const tokenOnly = { fileType: "orders_invoices", columns: { order_id: { header: "Order" }, currency: { constant: "SGD" }, price_token_amount: { header: "Token price" }, network: { constant: "tron" }, token_contract: { derive: "network_and_symbol" } } };
    expect(validateMapping(tokenOnly, HEADERS).ok).toBe(true);
    const r = validateMapping({ ...tokenOnly, columns: { order_id: { header: "Order" }, currency: { constant: "SGD" }, price_token_amount: { header: "Token price" } } }, HEADERS);
    expect(r.ok ? [] : r.issues.map((i) => `${i.code}:${i.field}`).sort()).toEqual(["required_field_unmapped:network", "required_field_unmapped:token_contract"]);
  });
  it("neither a fiat amount nor a token price: refused with the rc7 code", () => {
    const r = validateMapping({ fileType: "orders_invoices", columns: { order_id: { header: "Order" }, currency: { header: "Currency" } } }, HEADERS);
    expect(r.ok ? [] : r.issues.map((i) => `${i.code}:${i.field}`)).toEqual(["required_field_unmapped:invoice_amount"]);
  });
});

describe("token-priced orders: rows", () => {
  const rows = applyMapping(table(HEADERS, [
    ["O-1", "1350.00", "SGD", "", "", ""], // fiat
    ["O-2", "", "SGD", "1250.00", "tron", USDT_TRON], // 1,250.00 USDT = 1250000000 base units
    ["O-3", "", "SGD", "1250.000001", "tron", USDT_TRON], // one base unit more
    ["O-4", "10.00", "SGD", "1250.00", "tron", USDT_TRON], // both: refused
    ["O-5", "", "SGD", "", "", ""], // neither: refused
    ["O-6", "", "SGD", "1250.00", "tron", "TXYZfictionalcontractAAAAAAAAAAAAA"], // not a configured token: refused
    ["O-7", "", "SGD", "1250.0000001", "tron", USDT_TRON], // finer than the token's 6 decimals: refused, never rounded
    ["O-8", "", "SGD", "0", "tron", USDT_TRON], // zero: refused
  ]), MAPPING);
  if (!rows.ok) throw new Error("mapping refused");
  const byOrder = Object.fromEntries(rows.rows.map((r) => [r.values.order_id, r]));
  it("fiat and token rows are read exactly, in minor units and base units", () => {
    expect(byOrder["O-1"]).toMatchObject({ status: "accepted", values: { invoice_amount: 135000n } });
    expect(byOrder["O-2"]).toMatchObject({ status: "accepted", values: { price_token_amount: 1_250_000_000n, network: "tron", token_contract: USDT_TRON } });
    expect(byOrder["O-3"].values.price_token_amount).toBe(1_250_000_001n);
  });
  it("both, neither, an unconfigured token, extra decimals or zero: the row is refused", () => {
    expect(byOrder["O-4"].errors).toContainEqual({ field: "price_token_amount", code: "two_pricing_modes" });
    expect(byOrder["O-5"].errors).toContainEqual({ field: "invoice_amount", code: "missing_value" });
    for (const o of ["O-4", "O-5", "O-6", "O-7", "O-8"]) expect(byOrder[o].status, o).toBe("rejected");
    expect(byOrder["O-6"].errors.map((e: { field: string }) => e.field)).toContain("token_contract");
  });
});
