import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, detectHeaderRow, IngestError, sniffFile } from "@/lib/clearline/ingest";

const utf8 = (s: string) => new TextEncoder().encode(s);
const utf16le = (s: string, bom = true) => {
  const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
  let o = 0;
  if (bom) { out[0] = 0xff; out[1] = 0xfe; o = 2; }
  for (let i = 0; i < s.length; i++) { out[o + 2 * i] = s.charCodeAt(i) & 0xff; out[o + 2 * i + 1] = s.charCodeAt(i) >> 8; }
  return out;
};
const utf16be = (s: string) => {
  const le = utf16le(s, false);
  const out = new Uint8Array(2 + le.length);
  out[0] = 0xfe; out[1] = 0xff;
  for (let i = 0; i < le.length; i += 2) { out[2 + i] = le[i + 1]; out[3 + i] = le[i]; }
  return out;
};

describe("decodeText", () => {
  it("UTF-8 without and with a BOM (stripped)", () => {
    expect(decodeText(utf8("a,b"))).toMatchObject({ text: "a,b", encoding: "utf-8", bom: false, warnings: [] });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("é,b")]))).toMatchObject({ text: "é,b", encoding: "utf-8", bom: true });
  });
  it("UTF-16 LE and BE by BOM", () => {
    expect(decodeText(utf16le("Montant;Réf"))).toMatchObject({ text: "Montant;Réf", encoding: "utf-16le", bom: true });
    expect(decodeText(utf16be("Amount,€"))).toMatchObject({ text: "Amount,€", encoding: "utf-16be", bom: true });
  });
  it("invalid UTF-8 falls back to windows-1252 with a warning, never U+FFFD", () => {
    const d = decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x80, 0x35])); // "Café,€5" in cp1252
    expect(d.text).toBe("Café,€5");
    expect(d.encoding).toBe("windows-1252");
    expect(d.warnings[0].code).toBe("encoding_windows_1252");
    expect(d.text).not.toContain("�");
  });
  it("refuses bytes undefined in windows-1252, NUL bytes, and a lying UTF-8 BOM", () => {
    expect(() => decodeText(new Uint8Array([0x41, 0x81, 0xff]))).toThrow(IngestError);
    expect(() => decodeText(new Uint8Array([0x41, 0x00, 0x42]))).toThrowError(/NUL/);
    expect(() => decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xe9]))).toThrowError(/UTF-8/);
  });
});

describe("sniffFile: by content, not by extension", () => {
  it("zip with a workbook part is xlsx; another zip is not", () => {
    const fakeXlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...utf8("....xl/workbook.xml....")]);
    expect(sniffFile(fakeXlsx, "statement.csv").kind).toBe("xlsx");
    expect(sniffFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])).kind).toBe("unknown");
  });
  it("json, mt940, camt053, tsv, csv", () => {
    expect(sniffFile(utf8('  [{"a":1}]'), "x.csv")).toMatchObject({ kind: "json", warnings: [{ code: "extension_mismatch" }] });
    expect(sniffFile(utf8('{"payments": []}')).kind).toBe("json");
    expect(sniffFile(utf8("{1:F01FICTXX00AXXX0000000000}{2:I940FICTXX00XXXXN}{4:\r\n:20:STMT1\r\n:25:XX00FICT0000000001\r\n:60F:C261101SGD0,00\r\n-}")).kind).toBe("mt940");
    expect(sniffFile(utf8(":20:STMT1\n:25:ACC\n:28C:1/1\n:60F:C261101SGD0,00\n:62F:C261101SGD0,00\n"), "statement.txt").kind).toBe("mt940");
    expect(sniffFile(utf8('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"></Document>')).kind).toBe("camt053");
    expect(sniffFile(utf8("<html><body>no</body></html>")).kind).toBe("unknown");
    expect(sniffFile(utf8("a\tb\tc\n1\t2\t3\n"), "data.csv")).toMatchObject({ kind: "tsv", delimiter: "\t" });
    expect(sniffFile(utf8("a;b;c\n1,5;2;3\n"))).toMatchObject({ kind: "csv", delimiter: ";" });
    expect(sniffFile(utf16le("a,b\n1,2\n"))).toMatchObject({ kind: "csv", encoding: "utf-16le" });
  });
  it("explains unsupported files", () => {
    expect(sniffFile(utf8("%PDF-1.7 ..."))).toMatchObject({ kind: "unknown", reason: expect.stringMatching(/PDF/) });
    expect(sniffFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toMatchObject({ kind: "unknown", reason: expect.stringMatching(/\.xls/) });
    expect(sniffFile(new Uint8Array([]))).toMatchObject({ kind: "unknown" });
  });
});

describe("detectDelimiter", () => {
  it.each([
    ["a,b,c\n1,2,3\n4,5,6", ","],
    ["a;b;c\n1,50;2,00;3\n4,00;5;6", ";"],
    ["a\tb\n1,5\t2\n", "\t"],
    ["a|b|c\n1|2|3", "|"],
    ['"x,y";b;c\n"1,2";3;4', ";"],
  ])("%j → %j", (text, d) => expect(detectDelimiter(text)).toBe(d));
  it("ignores a title line with no delimiter", () => expect(detectDelimiter("Statement of account\n\na;b;c\n1;2;3\n4;5;6")).toBe(";"));
  it("undefined for single-column text", () => expect(detectDelimiter("one\ntwo")).toBeUndefined());
});

describe("detectHeaderRow", () => {
  it("skips leading title and blank rows", () => {
    const rows = [["Fictional Bank — statement", "", "", ""], ["Account XX00FICT0000000001", "", "", ""], ["", "", "", ""], ["Date", "Description", "Amount", "Reference"], ["2026-11-02", "Payment", "10.00", "R1"]];
    expect(detectHeaderRow(rows)).toBe(3);
  });
  it("a narrower metadata row is not the header", () => {
    const rows = [["Account", "XX00FICT", "Currency", "SGD", ""], ["Date", "Description", "Debit", "Credit", "Balance"], ["2026-11-02", "x", "", "1.00", "1.00"]];
    expect(detectHeaderRow(rows)).toBe(1);
  });
  it("a numeric first row is not a header", () => {
    expect(detectHeaderRow([["1", "2", "3"], ["a", "b", "c"]])).toBe(1);
  });
});
