import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IngestError, parseBai2, readTabular, sniffFile } from "@/lib/clearline/ingest";
import { NORMAL, RETURNS, TWO_ACCOUNTS, buildBai2, type Bai2File } from "./bai2-builder";

const dir = join(__dirname, "fixtures", "bank-formats");
const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const text = (name: string) => readFileSync(join(dir, name), "utf8");
const enc = (s: string) => new TextEncoder().encode(s);
function errorOf(f: () => unknown): IngestError | undefined {
  try { f(); } catch (e) { if (e instanceof IngestError) return e; throw e; }
  return undefined;
}
const clone = (f: Bai2File): Bai2File => structuredClone(f);

describe("the fixture files are what the builder writes (trailers computed, not hand-typed)", () => {
  it.each([["bai2-normal.bai", NORMAL], ["bai2-returns.bai", RETURNS], ["bai2-two-accounts.bai", TWO_ACCOUNTS]] as const)("%s", (name, spec) => {
    expect(text(name)).toBe(buildBai2(spec));
  });
});

describe("BAI2 normal day (fictional)", () => {
  it("is detected by content (before CSV, although it is comma separated)", () => {
    expect(sniffFile(file("bai2-normal.bai"), "statement.bai").kind).toBe("bai2");
    expect(sniffFile(file("bai2-normal.bai"), "statement.txt").kind).toBe("bai2");
    expect(sniffFile(file("bai2-normal.bai"), "statement.csv").warnings.map((w) => w.code)).toContain("extension_mismatch");
    expect(sniffFile(enc("01,02,03\n02,03,04\n03,04,05\n"), "x.csv").kind).toBe("csv");
  });
  it("readTabular refuses it as a table", async () => {
    await expect(readTabular(file("bai2-normal.bai"))).rejects.toMatchObject({ code: "unsupported_file", message: expect.stringContaining("BAI2") });
  });

  it("reads every transaction, balances and summaries", () => {
    const r = parseBai2(file("bai2-normal.bai"));
    expect(r.sourceFormat).toBe("bai2");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]).toMatchObject({ sourceFormat: "bai2", account: "FICT00004321", currency: "SGD", statementId: "FICT-BAI-NORMAL", balanced: true,
      opening: { date: "2026-11-19", amountMinor: 100000n, currency: "SGD" }, closing: { date: "2026-11-19", amountMinor: 245000n, currency: "SGD" } });
    expect(r.lines).toEqual([
      { lineId: "bai2|FICT00004321|2026-11-19|C|125000|FICTBANK0001|0", account: "FICT00004321", currency: "SGD", valueDate: "2026-11-19", bookingDate: "2026-11-19", direction: "credit",
        amountMinor: 125000n, reference: "INV-1001", narrative: "INCOMING TRANSFER FICTIONAL PAYER PTE", bankReference: "FICTBANK0001", sourceFormat: "bai2", sourceRow: 4 },
      { lineId: "bai2|FICT00004321|2026-11-20|C|50000|FICTBANK0002|0", account: "FICT00004321", currency: "SGD", valueDate: "2026-11-20", bookingDate: "2026-11-19", direction: "credit",
        amountMinor: 50000n, reference: "INV-1002", narrative: "PAYOUT BATCH FICT-B-7,SETTLEMENT FOR 2026-11-18, FICTIONAL PROVIDER", bankReference: "FICTBANK0002", sourceFormat: "bai2", sourceRow: 5 },
      { lineId: "bai2|FICT00004321|2026-11-19|D|30000|FICTBANK0003|0", account: "FICT00004321", currency: "SGD", valueDate: "2026-11-19", bookingDate: "2026-11-19", direction: "debit",
        amountMinor: 30000n, reference: "FICTBANK0003", narrative: "OUTGOING TRANSFER FICTIONAL SUPPLIER", bankReference: "FICTBANK0003", sourceFormat: "bai2", sourceRow: 7 },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("LF line ends, trailing spaces (80-column padding) and JPY (no decimals) read the same way", () => {
    const lf = buildBai2({ ...NORMAL, eol: "\n" }).split("\n").map((l) => (l ? l.padEnd(80, " ") : l)).join("\n");
    expect(parseBai2(lf).lines.map((l) => l.amountMinor)).toEqual([125000n, 50000n, 30000n]);
    const jpy = clone(NORMAL);
    jpy.groups[0].currency = "JPY"; jpy.groups[0].accounts[0].currency = "JPY";
    const r = parseBai2(buildBai2(jpy));
    expect(r.statements[0].currency).toBe("JPY");
    expect(r.lines[0]).toMatchObject({ currency: "JPY", amountMinor: 125000n });
  });

  it("the account currency falls back to the group's, then to BAI2's default USD with a warning", () => {
    const g = clone(NORMAL); delete g.groups[0].accounts[0].currency;
    expect(parseBai2(buildBai2(g)).statements[0].currency).toBe("SGD");
    delete g.groups[0].currency;
    const r = parseBai2(buildBai2(g));
    expect(r.statements[0].currency).toBe("USD");
    expect(r.warnings.map((w) => w.code)).toEqual(["bai2_currency_defaulted"]);
  });

  it("a closing ledger that does not tie, and a summary that does not match, are warnings with both figures", () => {
    const g = clone(NORMAL);
    g.groups[0].accounts[0].status = [["010", 100000n], ["015", 245001n]];
    g.groups[0].accounts[0].summaries = [["100", 175000n, 3], ["400", 30000n, 1]];
    const r = parseBai2(buildBai2(g));
    expect(r.statements[0].balanced).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual(["balance_mismatch", "bai2_summary_mismatch"]);
    expect(r.warnings[0].message).toContain("2450.00 SGD, but the closing ledger (015) is 2450.01 SGD");
    expect(r.warnings[1].message).toContain("in 3 item(s), but the entries read give 1750.00 SGD in 2");
  });
});

describe("BAI2 returns and reversals (fictional)", () => {
  it("555 is flagged as a returned item; directions come from the type code; 910 is skipped, never guessed", () => {
    const r = parseBai2(file("bai2-returns.bai"));
    expect(r.lines.map((l) => [l.direction, l.amountMinor, l.reversal ?? false, l.reference])).toEqual([
      ["credit", 20000n, false, "INV-2001"],
      ["debit", 20000n, true, "INV-2001"],
      ["debit", 700n, false, "FICTBANK0103"],
      ["credit", 700n, false, "FICTBANK0104"],
    ]);
    expect(r.skipped).toEqual([{ sourceRow: 8, status: "910", reason: expect.stringContaining("bank-specific") }]);
    expect(r.warnings.map((w) => w.code)).toEqual(["entries_not_read"]);
    expect(r.statements[0].balanced).toBe(true);
  });
});

describe("BAI2 with several accounts (conservative: refused, not split)", () => {
  it("two accounts in one group are refused without echoing either number", () => {
    const e = errorOf(() => parseBai2(file("bai2-two-accounts.bai")));
    expect(e?.code).toBe("multiple_accounts");
    expect(e?.message).not.toMatch(/4321|9999/);
  });
  it("two groups for different accounts are refused too", () => {
    const g: Bai2File = { groups: [{ asOf: "261119", currency: "SGD", accounts: [TWO_ACCOUNTS.groups[0].accounts[0]] }, { asOf: "261120", currency: "SGD", accounts: [TWO_ACCOUNTS.groups[0].accounts[1]] }] };
    expect(errorOf(() => parseBai2(buildBai2(g)))?.code).toBe("multiple_accounts");
  });
  it("two days of the SAME account (two groups) are read as two statements", () => {
    const g: Bai2File = { groups: [{ asOf: "261119", currency: "SGD", accounts: [TWO_ACCOUNTS.groups[0].accounts[0]] }, { asOf: "261120", currency: "SGD", accounts: [{ ...TWO_ACCOUNTS.groups[0].accounts[1], account: "FICT00004321" }] }] };
    const r = parseBai2(buildBai2(g));
    expect(r.statements.map((s) => [s.account, s.sequence, s.lines.length])).toEqual([["FICT00004321", "2026-11-19", 1], ["FICT00004321", "2026-11-20", 1]]);
  });
});

describe("BAI2 strict validation: checksums, counts, structure", () => {
  const ok = text("bai2-normal.bai");
  const lines = ok.split("\r\n");
  const edit = (i: number, value: string) => { const l = [...lines]; l[i] = value; return l.join("\r\n"); };
  it.each([
    ["account control total off by one", edit(7, "49,755001,6/"), /account control total is 755001 but the amounts in the account add up to 755000/],
    ["account record count wrong", edit(7, "49,755000,5/"), /account trailer counts 5 records but the account has 6/],
    ["group control total wrong", edit(8, "98,755001,1,8/"), /group control total/],
    ["group account count wrong", edit(8, "98,755000,2,8/"), /counts 2 accounts but the group has 1/],
    ["group record count wrong", edit(8, "98,755000,1,7/"), /group trailer counts 7 records/],
    ["file control total wrong", edit(9, "99,755002,1,10/"), /file control total/],
    ["file group count wrong", edit(9, "99,755000,2,10/"), /counts 2 groups/],
    ["file record count wrong", edit(9, "99,755000,1,11/"), /file trailer counts 11 records but the file has 10/],
    ["a transaction amount changed", edit(3, "16,195,125001,0,FICTBANK0001,INV-1001,INCOMING TRANSFER FICTIONAL PAYER PTE"), /account control total is 755000 but .* add up to 755001/],
    ["a transaction removed (truncation)", [...lines.slice(0, 3), ...lines.slice(4)].join("\r\n"), /account control total/],
    ["the file trailer missing", lines.slice(0, 9).join("\r\n"), /99 file trailer was expected/],
    ["the account trailer missing", [...lines.slice(0, 7), ...lines.slice(8)].join("\r\n"), /no 49 account trailer/],
    ["records after the trailer", ok + "16,195,1,0,X,Y,Z\r\n", /records after the 99 file trailer|not a BAI2 record|99 file trailer was expected/],
    ["unknown record code", edit(4, "17,165,50000,0,FICTBANK0002,INV-1002,PAYOUT"), /not a BAI2 record code/],
    ["a blank line inside", edit(6, ""), /blank line/],
    ["a decimal point in an amount", edit(3, "16,195,1250.00,0,FICTBANK0001,INV-1001,X"), /not a BAI2 amount/],
    ["a signed transaction amount", edit(3, "16,195,-125000,0,FICTBANK0001,INV-1001,X"), /not a BAI2 amount/],
    ["a status code as a transaction", edit(3, "16,015,125000,0,FICTBANK0001,INV-1001,X"), /balance \(status\) code/],
    ["an unknown funds type", edit(3, "16,195,125000,Q,FICTBANK0001,INV-1001,X"), /funds type "Q"/],
    ["an impossible as-of date", edit(1, "02,FICTRECEIVER,FICTBANK,1,261131,2359,SGD,2/"), /not a real date/],
    ["a deletion group", edit(1, "02,FICTRECEIVER,FICTBANK,2,261119,2359,SGD,2/"), /group status is a deletion/],
    ["a test-only group", edit(1, "02,FICTRECEIVER,FICTBANK,4,261119,2359,SGD,2/"), /group status is test only/],
    ["version 3 (BTRS)", edit(0, "01,FICTSENDER,FICTRECEIVER,261120,0200,FICT-BAI-NORMAL,80,1,3/"), /only version 2 is read/],
    ["no account number", edit(2, "03,,SGD,010,100000,,,015,245000,,,100,175000,2,,400,30000,1,/"), /no account number/],
    ["an 88 with nothing before it", "88,X\r\n" + ok, /continuation \(88\) record has no record before it/],
    ["an overlong record", edit(3, "16,195,125000,0,FICTBANK0001,INV-1001," + "X".repeat(5000)), /at most 4,096/],
  ])("%s is refused (invalid_bai2)", (_name, input, message) => {
    const e = errorOf(() => parseBai2(input));
    expect(e?.code).toBe("invalid_bai2");
    expect(e?.message).toMatch(message);
  });
  it("an unknown currency is refused", () => {
    expect(errorOf(() => parseBai2(edit(2, lines[2].replace("SGD", "XYZ"))))?.code).toBe("unknown_currency");
  });
  it("a file without a 01 header is not BAI2", () => {
    expect(errorOf(() => parseBai2(lines.slice(1).join("\r\n")))?.code).toBe("invalid_bai2");
    expect(errorOf(() => parseBai2("hello,world\r\n"))?.code).toBe("invalid_bai2");
  });
  it("limits: size and transaction count", () => {
    expect(errorOf(() => parseBai2(file("bai2-normal.bai"), { limits: { maxFileBytes: 100 } }))?.code).toBe("file_too_large");
    expect(errorOf(() => parseBai2(file("bai2-normal.bai"), { limits: { maxDataRows: 2 } }))?.code).toBe("too_many_rows");
    expect(errorOf(() => parseBai2(new Uint8Array(0)))?.code).toBe("file_empty");
  });
});
