/** rc7 phase 3b: the pure parts of exports: the STORE zip writer and the draft journal layouts. Fictional values. */
import { describe, expect, it } from "vitest";
import { crc32, readStoreZip, storeZip } from "@/lib/clearline/exports/zip";
import { DRAFT_MARKING, draftable, journalDraftCsv, plainAmount, type DraftJournal } from "@/lib/clearline/exports/journal-drafts";

const J = (id: string, lines: DraftJournal["lines"], extra: Partial<DraftJournal> = {}): DraftJournal =>
  ({ id, pattern: "settlement", status: "proposed", postingRuleStatus: "pending_sign_off", entryDate: "2026-11-24", memo: "Batch B-1 settled (fictional)", lines, ...extra });
const SETL = J("JP-1", [{ side: "debit", account: "bank", amountMinor: "596124" }, { side: "debit", account: "payment_processing_fees", amountMinor: "6021" }, { side: "credit", account: "provider_clearing", amountMinor: "602145" }]);

describe("zip", () => {
  it("round-trips, is deterministic and has the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = storeZip([{ name: "a.csv", data: "x,y\r\n" }, { name: "dir/b.json", data: new Uint8Array([1, 2, 3]) }], "2026-11-30");
    expect(storeZip([{ name: "a.csv", data: "x,y\r\n" }, { name: "dir/b.json", data: new Uint8Array([1, 2, 3]) }], "2026-11-30")).toEqual(z);
    const r = readStoreZip(z);
    expect([...r.keys()]).toEqual(["a.csv", "dir/b.json"]);
    expect(new TextDecoder().decode(r.get("a.csv"))).toBe("x,y\r\n");
  });
  it("refuses traversal and repeated names", () => {
    for (const name of ["../x", "/x", "a/../b", ""]) expect(() => storeZip([{ name, data: "" }])).toThrow();
    expect(() => storeZip([{ name: "a", data: "" }, { name: "a", data: "" }])).toThrow();
  });
});

describe("draft journal files", () => {
  it("amounts are exact decimal text from minor units", () => {
    expect([plainAmount(596124n, "SGD"), plainAmount(-5n, "USD"), plainAmount(0n, "AED"), plainAmount(900719925474099327n, "SGD")]).toEqual(["5961.24", "-0.05", "0.00", "9007199254740993.27"]);
  });
  it("Xero: debit positive, credit negative, DD/MM/YYYY, DRAFT on every row", () => {
    const x = journalDraftCsv("xero", [SETL], "SGD", "2026-11-30");
    const rows = x.body.trim().split("\r\n").slice(1);
    expect(rows.map((r) => r.split(",").slice(-9, -4))).toEqual([["24/11/2026", "Bank (settlement)", "bank", "Tax Exempt", "5961.24"], ["24/11/2026", "Payment processing fees (settlement)", "payment_processing_fees", "Tax Exempt", "60.21"], ["24/11/2026", "Provider clearing (settlement)", "provider_clearing", "Tax Exempt", "-6021.45"]]);
    for (const r of rows) expect(r).toContain(DRAFT_MARKING);
  });
  it("QuickBooks: debits and credits columns", () => {
    const q = journalDraftCsv("quickbooks", [SETL], "SGD", "2026-11-30");
    expect(q.body.split("\r\n")[1].split(",").slice(0, 5)).toEqual(["DRAFT-1", "24/11/2026", "Bank", "5961.24", ""]);
    expect(q.body.split("\r\n")[3].split(",").slice(0, 5)).toEqual(["DRAFT-1", "24/11/2026", "Provider clearing", "", "6021.45"]);
  });
  it("drafts only proposed journals pending sign-off; an unbalanced journal is refused", () => {
    expect(draftable([SETL, { ...SETL, id: "JP-2", status: "approved" }, { ...SETL, id: "JP-3", status: "superseded" }]).map((j) => j.id)).toEqual(["JP-1"]);
    expect(() => draftable([J("JP-X", [{ side: "debit", account: "bank", amountMinor: "1" }])])).toThrow(/does not balance/);
  });
  it("formula cells in a memo are neutralised", () => {
    expect(journalDraftCsv("xero", [{ ...SETL, memo: "=HYPERLINK(1)" }], "SGD", "2026-11-30").body).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
