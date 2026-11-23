import { describe, expect, it } from "vitest";
import { IngestError, LIMITS, preview, readDelimited, readJson, readTabular } from "@/lib/clearline/ingest";
import { normaliseCell, rowHash, sha256Hex } from "@/lib/clearline/ingest/hash";

const utf8 = (s: string) => new TextEncoder().encode(s);
const codeOf = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof IngestError ? e.code : `other:${String(e)}`; }
  return "no error";
};
const asyncCodeOf = async (f: () => Promise<unknown>) => {
  try { await f(); } catch (e) { return e instanceof IngestError ? e.code : `other:${String(e)}`; }
  return "no error";
};

describe("readDelimited: RFC 4180", () => {
  it("quoted fields, escaped quotes, embedded newlines, CRLF", () => {
    const t = readDelimited(utf8('id,memo,amount\r\nP-1,"Invoice ""A"", part 1",10.00\r\nP-2,"line one\r\nline two",20.00\r\n'));
    expect(t.headers).toEqual(["id", "memo", "amount"]);
    expect(t.rows).toEqual([
      { rowNumber: 2, cells: ["P-1", 'Invoice "A", part 1', "10.00"] },
      { rowNumber: 3, cells: ["P-2", "line one\r\nline two", "20.00"] },
    ]);
    expect(t).toMatchObject({ kind: "csv", delimiter: ",", encoding: "utf-8", headerRowNumber: 1 });
  });
  it("row numbers are physical lines, also after a quoted newline (LF)", () => {
    const t = readDelimited(utf8('a,b\n"x\ny",1\nz,2\n'));
    expect(t.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });
  it("strips a UTF-8 BOM from the first header", () => {
    const t = readDelimited(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Date,Amount\n2026-11-02,1.00\n")]));
    expect(t.headers[0]).toBe("Date");
  });
  it("reads UTF-16 LE with BOM (Excel 'Unicode text')", () => {
    const s = "Date\tAmount\n2026-11-02\t1,00\n";
    const bytes = new Uint8Array(2 + s.length * 2);
    bytes[0] = 0xff; bytes[1] = 0xfe;
    for (let i = 0; i < s.length; i++) { bytes[2 + 2 * i] = s.charCodeAt(i); bytes[3 + 2 * i] = 0; }
    const t = readDelimited(bytes);
    expect(t).toMatchObject({ kind: "tsv", encoding: "utf-16le", headers: ["Date", "Amount"], rows: [{ cells: ["2026-11-02", "1,00"] }] });
  });
  it("semicolon files with decimal commas", () => {
    const t = readDelimited(utf8("Datum;Betrag;Ref\n02.11.2026;1.234,56;R1\n03.11.2026;-5,00;R2\n"));
    expect(t.delimiter).toBe(";");
    expect(t.rows[0].cells).toEqual(["02.11.2026", "1.234,56", "R1"]);
  });
  it("an unterminated quote is an error naming the line", () => {
    expect(codeOf(() => readDelimited(utf8('a,b\n1,"open\n2,3\n')))).toBe("unterminated_quote");
  });
  it("a stray quote inside an unquoted value is kept, with a warning", () => {
    const t = readDelimited(utf8('a,b\n5" pipe,1\n'));
    expect(t.rows[0].cells[0]).toBe('5" pipe');
    expect(t.warnings.map((w) => w.code)).toContain("stray_quote");
  });
  it("windows-1252 files are read with a warning", () => {
    const t = readDelimited(new Uint8Array([...utf8("Name,Amount\nCaf"), 0xe9, ...utf8(",1.00\n")]));
    expect(t.rows[0].cells[0]).toBe("Café");
    expect(t.warnings[0].code).toBe("encoding_windows_1252");
  });
});

describe("readDelimited: structure", () => {
  it("skips title rows above the header, counts blank rows", () => {
    const t = readDelimited(utf8("Fictional Bank statement\nAccount XX00FICT0000000001\n\nDate,Reference,Amount\n2026-11-02,R1,1.00\n\n,,\n2026-11-03,R2,2.00\n"));
    expect(t.headerRowNumber).toBe(4);
    expect(t.rows.map((r) => r.rowNumber)).toEqual([5, 8]);
    expect(t.blankRowsSkipped).toBe(2);
    expect(t.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["title_rows_skipped", "blank_rows_skipped"]));
  });
  it("an explicit header row overrides detection", () => {
    const t = readDelimited(utf8("x,y\na,b\n1,2\n"), { headerRow: 2 });
    expect(t.headers).toEqual(["a", "b"]);
    expect(t.rows).toEqual([{ rowNumber: 3, cells: ["1", "2"] }]);
  });
  it("duplicate and empty header names are disambiguated", () => {
    const t = readDelimited(utf8("Amount,amount,,Amount\n1,2,3,4\n"));
    expect(t.headers).toEqual(["Amount", "amount (2)", "Column 3", "Amount (3)"]);
    expect(t.warnings.map((w) => w.code)).toContain("duplicate_headers");
  });
  it("short rows are padded and wide rows get generated column names", () => {
    const t = readDelimited(utf8("a,b,c\n1\n1,2,3,4\n"));
    expect(t.headers).toEqual(["a", "b", "c", "Column 4"]);
    expect(t.rows.map((r) => r.cells)).toEqual([["1", "", "", ""], ["1", "2", "3", "4"]]);
  });
});

describe("trailing totals", () => {
  it("excludes a 'Total' row with an empty identifier and names its row", () => {
    const t = readDelimited(utf8("Payment ID,Date,Amount\nP-1,2026-11-02,10.00\nP-2,2026-11-03,5.50\n,,\nTotal,,15.50\n"));
    expect(t.rows.map((r) => r.cells[0])).toEqual(["P-1", "P-2"]);
    expect(t.excludedRows).toEqual([{ rowNumber: 5, reason: "total_row", cells: ["Total", "", "15.50"] }]);
    expect(t.warnings.find((w) => w.code === "total_row_excluded")).toMatchObject({ row: 5, message: expect.stringContaining("Row 5") });
  });
  it("subtotal + grand total (case-insensitive), and a sum row with no word", () => {
    const a = readDelimited(utf8("Ref,Amount\nA,1.00\nB,2.00\nSUBTOTAL,3.00\nGrand Total,3.00\n"));
    expect(a.excludedRows.map((r) => r.rowNumber)).toEqual([4, 5]);
    const b = readDelimited(utf8("Ref,Fee,Amount\nA,0.10,1.00\nB,0.20,2.00\nC,0.30,3.00\n,0.60,6.00\n"));
    expect(b.excludedRows.map((r) => r.rowNumber)).toEqual([5]);
    expect(b.rows).toHaveLength(3);
  });
  it("sums in decimal-comma columns are recognised", () => {
    const t = readDelimited(utf8("Ref;Betrag\nA;1.000,50\nB;2,50\n;1.003,00\n"));
    expect(t.excludedRows.map((r) => r.rowNumber)).toEqual([4]);
  });
  it("does not exclude a real row that merely mentions a total, or one with an identifier", () => {
    const a = readDelimited(utf8("Ref,Memo,Amount\nA,x,1.00\nB,total refund,2.00\n"));
    expect(a.excludedRows).toEqual([]);
    const b = readDelimited(utf8("Ref,Amount\nA,1.00\nB,2.00\nC,3.00\n"));
    expect(b.excludedRows).toEqual([]); // 3.00 = 1.00 + 2.00, but C is an identifier
  });
  it("can be switched off", () => {
    expect(readDelimited(utf8("Ref,Amount\nA,1\nTotal,1\n"), { detectTotals: false }).rows).toHaveLength(2);
  });
});

describe("readJson", () => {
  it("an array of objects, with nested objects flattened and scalar arrays joined", () => {
    const t = readJson(utf8(JSON.stringify([
      { id: "P-1", amount: "10.00", customer: { wallet: "TFictWallet0001", name: "Fictional Co" }, tags: ["a", "b"] },
      { id: "P-2", amount: "5.00", customer: { wallet: "TFictWallet0002" }, extra: true },
    ])));
    expect(t.headers).toEqual(["id", "amount", "customer.wallet", "customer.name", "tags", "extra"]);
    expect(t.rows).toEqual([
      { rowNumber: 1, cells: ["P-1", "10.00", "TFictWallet0001", "Fictional Co", "a;b", ""] },
      { rowNumber: 2, cells: ["P-2", "5.00", "TFictWallet0002", "", "", "true"] },
    ]);
    expect(t.kind).toBe("json");
  });
  it("keeps JSON numbers exactly as written (no double rounding)", () => {
    const t = readJson(utf8('[{"amount": 1234.567890123456789012, "big": 12345678901234567890123}]'));
    expect(t.rows[0].cells).toEqual(["1234.567890123456789012", "12345678901234567890123"]);
  });
  it("an object with one array property ({ data: [...] }, { payments: [...] })", () => {
    expect(readJson(utf8('{"data":[{"a":1}],"meta":{"page":1}}')).rows[0].cells).toEqual(["1"]);
    const t = readJson(utf8('{"payments":[{"a":"x"}]}'));
    expect(t.warnings[0]).toMatchObject({ code: "json_array_property" });
  });
  it("arrays of objects become indexed paths; null is empty", () => {
    const t = readJson(utf8('[{"lines":[{"sku":"S1"},{"sku":"S2"}],"note":null}]'));
    expect(t.headers).toEqual(["lines.0.sku", "lines.1.sku", "note"]);
    expect(t.rows[0].cells).toEqual(["S1", "S2", ""]);
  });
  it("errors for invalid or wrongly shaped JSON", () => {
    expect(codeOf(() => readJson(utf8("[{]")))).toBe("invalid_json");
    expect(codeOf(() => readJson(utf8('{"a":[1],"b":[2]}')))).toBe("json_shape");
    expect(readJson(utf8('{"a":[{"x":1}],"b":[{"y":2}]}'), { arrayProperty: "b" }).headers).toEqual(["y"]);
    expect(codeOf(() => readJson(utf8("42")))).toBe("json_shape");
    expect(codeOf(() => readJson(utf8("[1,2]")))).toBe("json_shape");
    expect(codeOf(() => readJson(utf8("[" + "[".repeat(100) + "]".repeat(100) + "]")))).toBe("invalid_json");
  });
  it("skips empty records", () => {
    const t = readJson(utf8('[{"a":"1"},{},{"a":""},{"a":"2"}]'));
    expect(t.rows.map((r) => r.rowNumber)).toEqual([1, 4]);
    expect(t.blankRowsSkipped).toBe(2);
  });
});

describe("readTabular dispatches on content", () => {
  it("csv named .txt and json named .csv", async () => {
    expect((await readTabular(utf8("a,b\n1,2\n"), { fileName: "x.txt" })).kind).toBe("csv");
    expect((await readTabular(utf8('[{"a":1}]'), { fileName: "x.csv" })).kind).toBe("json");
  });
  it("bank statements and unknown files are refused with a reason", async () => {
    expect(await asyncCodeOf(() => readTabular(utf8(":20:S\n:25:A\n:60F:C261101SGD0,00\n")))).toBe("unsupported_file");
    expect(await asyncCodeOf(() => readTabular(utf8("%PDF-1.4")))).toBe("unsupported_file");
  });
});

describe("limits", () => {
  it("defaults", () => expect(LIMITS).toEqual({ maxFileBytes: 20 * 1024 * 1024, maxDataRows: 100_000, maxColumns: 200, maxCellChars: 10_000 }));
  it("file too large (20 MB)", () => {
    const big = new Uint8Array(LIMITS.maxFileBytes + 1).fill(0x41);
    expect(codeOf(() => readDelimited(big))).toBe("file_too_large");
    expect(codeOf(() => readDelimited(new Uint8Array(0)))).toBe("file_empty");
  });
  it("too many rows (100,000)", () => {
    const text = "id,amount\n" + "x,1\n".repeat(100_001);
    expect(codeOf(() => readDelimited(utf8(text)))).toBe("too_many_rows");
    expect(readDelimited(utf8("id,amount\n" + "x,1\n".repeat(100_000)), { detectTotals: false }).rows).toHaveLength(100_000);
  });
  it("too many columns, cell too long, and stricter overrides", () => {
    expect(codeOf(() => readDelimited(utf8(Array.from({ length: 201 }, (_, i) => `c${i}`).join(",") + "\n")))).toBe("too_many_columns");
    expect(codeOf(() => readDelimited(utf8("a,b\n" + "x".repeat(10_001) + ",1\n")))).toBe("cell_too_long");
    expect(codeOf(() => readDelimited(utf8("a\n1\n2\n3\n"), { limits: { maxDataRows: 2 } }))).toBe("too_many_rows");
    expect(codeOf(() => readDelimited(utf8("a\n1\n"), { limits: { maxDataRows: 10_000_000 } }))).toBe("no error"); // cannot be raised
  });
  it("error messages are plain English", () => {
    try { readDelimited(utf8(Array.from({ length: 201 }, (_, i) => `c${i}`).join(",") + "\n")); } catch (e) {
      expect((e as Error).message).toBe("The file has 201 columns; at most 200 are accepted.");
    }
  });
  it("preview returns the first 20 rows", () => {
    const t = readDelimited(utf8("id\n" + Array.from({ length: 50 }, (_, i) => `r${i}`).join("\n")));
    const p = preview(t, 20);
    expect(p.rows).toHaveLength(20);
    expect(p.rows[19].cells).toEqual(["r19"]);
    expect(p.headers).toEqual(t.headers);
    expect(t.rows).toHaveLength(50);
  });
});

describe("hashes", () => {
  it("sha256 of raw bytes", () => {
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("row hash is stable over normalised cells and sensitive to cell boundaries", () => {
    expect(rowHash([" P-1 ", "Café", "a  b"])).toBe(rowHash(["P-1", "Café", "a b"]));
    expect(rowHash(["a,b"])).not.toBe(rowHash(["a", "b"]));
    expect(rowHash(["a", "b"])).not.toBe(rowHash(["b", "a"]));
    expect(rowHash(["x"])).toMatch(/^[0-9a-f]{64}$/);
    expect(normaliseCell(" x\ty ")).toBe("x y");
  });
});
