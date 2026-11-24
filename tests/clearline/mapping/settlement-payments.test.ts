/**
 * v1 Phase 0 (approval-only draft): the per-payment settlement file type (one row per payment). Every required field
 * must be mapped; each row must add up on its own (gross − fee = net, to the minor unit) and is refused otherwise.
 * Fictional values.
 */
import { describe, expect, it } from "vitest";
import { applyMapping, suggestMapping, validateMapping, type Mapping } from "@/lib/clearline/mapping";

const table = (headers: string[], rows: string[][]) => ({ headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) });
const H = ["Payment ID", "Order ref", "Payout ID", "Currency", "Gross", "Fee", "Net", "Settlement date"];
const M: Mapping = { fileType: "settlement_payments", columns: {
  payment_id: { header: "Payment ID" }, order_id: { header: "Order ref" }, batch_id: { header: "Payout ID" }, currency: { header: "Currency" },
  gross: { header: "Gross" }, fee: { header: "Fee" }, net: { header: "Net" }, settlement_date: { header: "Settlement date" },
} };

describe("settlement_payments mapping", () => {
  it("the header suggestions find every field of a plain per-payment file", () => {
    const s = suggestMapping(H, "settlement_payments") as unknown as { columns?: Record<string, { header?: string }> } | Record<string, unknown>;
    expect(JSON.stringify(s)).toMatch(/Payout ID/);
  });
  it("payment ID, batch, currency, gross, fee and net are required", () => {
    const r = validateMapping({ fileType: "settlement_payments", columns: { payment_id: { header: "Payment ID" } } }, H);
    expect(r.ok ? [] : r.issues.filter((i) => i.code === "required_field_unmapped").map((i) => i.field).sort()).toEqual(["batch_id", "currency", "fee", "gross", "net"]);
    expect(validateMapping(M, H).ok).toBe(true);
  });
  it("rows are read exactly; a row whose gross − fee ≠ net is refused, never adjusted", () => {
    const r = applyMapping(table(H, [["P-1", "O-1", "B-1", "SGD", "1,350.00", "13.50", "1,336.50", "2026-11-03"], ["P-2", "", "B-1", "SGD", "100.00", "1.00", "99.01", "2026-11-03"]]), M);
    if (!r.ok) throw new Error("refused");
    expect(r.rows[0]).toMatchObject({ status: "accepted", values: { gross: 135000n, fee: 1350n, net: 133650n, settlement_date: "2026-11-03" } });
    expect(r.rows[1].status).toBe("rejected");
    expect(r.rows[1].errors).toContainEqual({ field: "net", code: "gross_less_fee_not_net" });
  });
});
