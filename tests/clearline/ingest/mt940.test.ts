import { describe, expect, it } from "vitest";
import { BANK_CURRENCY_DECIMALS, currencyPrecision, IngestError, parseMt940, sniffFile } from "@/lib/clearline/ingest";

const enc = (s: string) => new TextEncoder().encode(s);

/** Two statements in one SWIFT envelope each; every value is fictional. */
const TWO_STATEMENTS = [
  "{1:F01FICTXX00AXXX0000000000}{2:I940FICTXX00XXXXN}{4:",
  ":20:STMT-0001",
  ":25:XX00FICT0000000001",
  ":28C:00001/001",
  ":60F:C261031SGD1000,00",
  ":61:2611021102C1250,50NTRFINV-1001//FICTREF0001",
  "PAYOUT FROM FICTIONAL EXCHANGE",
  ":86:Settlement for order INV-1001",
  "Fictional Payer Pte",
  ":61:2611031103D100,NCHGNONREF//FICTREF0002",
  ":86:Monthly account fee",
  ":61:261104C0,75NMSCNONREF",
  ":62F:C261104SGD2151,25",
  ":64:C261104SGD2151,25",
  "-}",
  "{1:F01FICTXX00AXXX0000000000}{2:I940FICTXX00XXXXN}{4:",
  ":20:STMT-0002",
  ":25:FICTBANK/0000000002",
  ":28C:00002/001",
  ":60M:D261231USD50,00",
  ":61:2612311231RD20,00NTRFREVERSAL-7//FICTREF0003",
  ":61:2701020102RC5,00NTRFREVERSAL-8",
  ":61:2701020102C5,00NTRFREVERSAL-8",
  ":62M:D270102USD30,00",
  "-}",
].join("\r\n");

describe("parseMt940", () => {
  it("is detected by content", () => expect(sniffFile(enc(TWO_STATEMENTS), "statement.dat").kind).toBe("mt940"));

  it("reads multiple statements, :61: subfields and the following :86:", () => {
    const r = parseMt940(enc(TWO_STATEMENTS));
    expect(r.warnings).toEqual([]);
    expect(r.statements).toHaveLength(2);
    const [s1, s2] = r.statements;
    expect(s1).toMatchObject({ sourceFormat: "mt940", account: "XX00FICT0000000001", currency: "SGD", statementId: "STMT-0001", sequence: "00001/001", balanced: true,
      opening: { date: "2026-10-31", amountMinor: 100000n }, closing: { date: "2026-11-04", amountMinor: 215125n } });
    expect(s1.lines).toHaveLength(3);
    expect(s1.lines[0]).toEqual({
      lineId: "mt940|XX00FICT0000000001|2026-11-02|C|125050|FICTREF0001|0",
      account: "XX00FICT0000000001",
      currency: "SGD",
      valueDate: "2026-11-02",
      bookingDate: "2026-11-02",
      direction: "credit",
      amountMinor: 125050n,
      reference: "INV-1001",
      narrative: "PAYOUT FROM FICTIONAL EXCHANGE Settlement for order INV-1001 Fictional Payer Pte",
      bankReference: "FICTREF0001",
      sourceFormat: "mt940",
      sourceRow: 6,
    });
    // NONREF falls back to the :86: text; "100," has no decimals; no entry date; no :86:
    expect(s1.lines[1]).toMatchObject({ direction: "debit", amountMinor: 10000n, reference: "Monthly account fee", bankReference: "FICTREF0002" });
    expect(s1.lines[2]).toMatchObject({ valueDate: "2026-11-04", direction: "credit", amountMinor: 75n, reference: "" });
    expect(s1.lines[2].bookingDate).toBeUndefined();

    expect(s2).toMatchObject({ account: "FICTBANK/0000000002", currency: "USD", balanced: true, opening: { amountMinor: -5000n }, closing: { amountMinor: -3000n } });
    // RD (reversal of a debit) is a credit; RC (reversal of a credit) is a debit; the entry date crosses the year end
    expect(s2.lines.map((l) => [l.direction, l.amountMinor, l.valueDate, l.bookingDate])).toEqual([
      ["credit", 2000n, "2026-12-31", "2026-12-31"],
      ["debit", 500n, "2027-01-02", "2027-01-02"],
      ["credit", 500n, "2027-01-02", "2027-01-02"],
    ]);
    expect(r.lines).toHaveLength(6);
  });

  it("line ids are deterministic and tell identical entries apart by occurrence", () => {
    const text = [":20:S", ":25:XX00FICT0000000001", ":60F:C261101SGD0,00", ":61:261102C10,00NTRFSAME", ":61:261102C10,00NTRFSAME", ":62F:C261102SGD20,00"].join("\n");
    const a = parseMt940(text).lines.map((l) => l.lineId);
    expect(a).toEqual(["mt940|XX00FICT0000000001|2026-11-02|C|1000||0", "mt940|XX00FICT0000000001|2026-11-02|C|1000||1"]);
    expect(parseMt940(text).lines.map((l) => l.lineId)).toEqual(a);
  });

  it("a balance mismatch is a warning with both figures", () => {
    const text = [":20:STMT-9", ":25:XX00FICT0000000001", ":60F:C261101SGD100,00", ":61:261102C10,00NTRFREF1", ":62F:C261102SGD120,00"].join("\n");
    const r = parseMt940(text);
    expect(r.statements[0].balanced).toBe(false);
    expect(r.warnings).toEqual([{ code: "balance_mismatch", row: 5, message: "Statement STMT-9 for XX00FICT0000000001: opening 100.00 plus the entries gives 110.00 SGD, but the closing balance is 120.00 SGD." }]);
    expect(r.lines).toHaveLength(1);
  });

  it("a missing closing balance is reported", () => {
    const r = parseMt940([":20:S", ":25:A1", ":60F:C261101SGD0,00", ":61:261102C1,00NTRFX"].join("\n"));
    expect(r.warnings.map((w) => w.code)).toEqual(["missing_closing_balance"]);
    expect(r.statements[0].balanced).toBeUndefined();
  });

  it("JPY has no decimals; excess decimals are an error", () => {
    const ok = parseMt940([":20:J", ":25:A1", ":60F:C261101JPY1000,", ":61:261102C500,NTRFX", ":62F:C261102JPY1500,"].join("\n"));
    expect(ok.lines[0].amountMinor).toBe(500n);
    expect(() => parseMt940([":20:J", ":25:A1", ":60F:C261101JPY1000,", ":61:261102C500,5NTRFX", ":62F:C261102JPY1500,"].join("\n"))).toThrowError(/decimal place/);
    expect(() => parseMt940([":20:S", ":25:A1", ":60F:C261101SGD0,001"].join("\n"))).toThrowError(/decimal place/);
  });

  it("refuses malformed statements with the line number", () => {
    const bad = (lines: string[]) => { try { parseMt940(lines.join("\n")); } catch (e) { return e instanceof IngestError ? [e.code, e.row] : ["other"]; } return ["none"]; };
    expect(bad([":25:A1"])).toEqual(["invalid_mt940", undefined]);
    expect(bad([":20:S", ":60F:C261101SGD0,00"])).toEqual(["invalid_mt940", 1]);
    expect(bad([":20:S", ":25:A1"])).toEqual(["invalid_mt940", 1]);
    expect(bad([":20:S", ":25:A1", ":60F:C261101SGD0,00", ":61:garbage"])).toEqual(["invalid_mt940", 4]);
    expect(bad([":20:S", ":25:A1", ":60F:C261301SGD0,00"])).toEqual(["invalid_mt940", 3]);
    expect(bad([":20:S", ":25:A1", ":60F:C261101XXX0,00"])).toEqual(["unknown_currency", 3]);
    expect(bad([":20:S", ":25:A1", ":60F:C261101SGD0,00", ":62F:C261101USD0,00"])).toEqual(["invalid_mt940", 4]);
  });
});

describe("currency precision table", () => {
  it("uses the repo's decimals and adds GBP and JPY", () => {
    expect(BANK_CURRENCY_DECIMALS).toMatchObject({ SGD: 2, USD: 2, AED: 2, EUR: 2, GBP: 2, JPY: 0 });
    expect(currencyPrecision("jpy")).toEqual({ ok: true, value: 0 });
    expect(currencyPrecision("XYZ")).toMatchObject({ ok: false, code: "unknown_currency", message: expect.stringContaining("not supported") });
  });
});
