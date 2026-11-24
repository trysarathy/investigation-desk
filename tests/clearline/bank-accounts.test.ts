/**
 * v1 bank accounts, pure rules (src/lib/clearline/bank-accounts.ts) and the demo's account rows: only a masked number
 * is ever accepted, a statement in another currency than its account is caught, and each demo entity has one account
 * in its own currency. Fictional values only.
 */
import { describe, expect, it } from "vitest";
import { LAST4, normaliseLast4, otherCurrencies, rejectOtherCurrency } from "@/lib/clearline/bank-accounts";
import { bankAccountLabel } from "@/lib/clearline/upload-words";
import { DEMO_BANK_ACCOUNTS, DEMO_ENTITIES } from "@/lib/clearline/demo/world";
import type { AppliedRow } from "@/lib/clearline/mapping";

const row = (n: number, currency: string | undefined, status: AppliedRow["status"] = "accepted"): AppliedRow =>
  ({ rowNumber: n, status, values: currency === undefined ? { amount: 100n } : { amount: 100n, currency }, errors: [], warnings: [] });

describe("masked account number", () => {
  it("accepts exactly four letters or digits (spaces removed, upper-cased)", () => {
    expect(normaliseLast4("4321")).toBe("4321");
    expect(normaliseLast4(" ab 12 ")).toBe("AB12");
  });
  it("refuses a full number or IBAN instead of truncating it, and anything else", () => {
    for (const v of ["GB82WEST12345698765432", "12345", "123", "", "12-4", "12.4"]) expect(normaliseLast4(v), v).toBeNull();
  });
  it("labels an account by name, masked number and currency, never more", () => {
    expect(bankAccountLabel({ displayName: "SGD operating", accountLast4: "4321", currency: "SGD" })).toBe("SGD operating (•••• 4321, SGD)");
  });
});

describe("statement currency = account currency", () => {
  it("names the other currencies of a structured statement (distinct, sorted); none when it fits", () => {
    expect(otherCurrencies([{ currency: "SGD" }, { currency: "SGD" }], "SGD")).toEqual([]);
    expect(otherCurrencies([{ currency: "USD" }, { currency: "SGD" }, { currency: "EUR" }, { currency: "USD" }], "SGD")).toEqual(["EUR", "USD"]);
  });
  it("rejects table rows in another currency with currency_not_bank_account and leaves the rest", () => {
    const out = rejectOtherCurrency([row(1, "USD"), row(2, "SGD"), row(3, undefined), row(4, "USD", "rejected"), row(5, "USD", "warning")], "USD");
    expect(out.map((r) => r.status)).toEqual(["accepted", "rejected", "accepted", "rejected", "warning"]);
    expect(out[1].errors).toEqual([{ field: "currency", code: "currency_not_bank_account" }]);
    expect(out[3].errors).toEqual([]); // already rejected for its own reason: not changed
  });
  it("changes nothing without an account (uploads from before accounts existed)", () => {
    const rows = [row(1, "USD"), row(2, "SGD")];
    expect(rejectOtherCurrency(rows, undefined)).toBe(rows);
  });
});

describe("demo bank accounts", () => {
  it("every demo entity has one account, in its own currency, with a masked number only", () => {
    expect(Object.keys(DEMO_BANK_ACCOUNTS).sort()).toEqual(DEMO_ENTITIES.map((e) => e.id).sort());
    for (const e of DEMO_ENTITIES) {
      const a = DEMO_BANK_ACCOUNTS[e.id];
      expect(LAST4.test(a.last4), e.id).toBe(true);
      expect(a.name).toContain(e.bankAccountId);
      expect(a.name).toContain(e.currency);
    }
  });
});
