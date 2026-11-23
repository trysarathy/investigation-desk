import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { IngestError, readTabular, readXlsx, sniffFile } from "@/lib/clearline/ingest";
import { xlsxNumberToText } from "@/lib/clearline/ingest/xlsx-cell";

async function book(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("xlsxNumberToText (the one float-to-text conversion)", () => {
  it("shortest round-trip strings, exponents expanded", () => {
    expect(xlsxNumberToText(1234.56)).toEqual({ text: "1234.56" });
    expect(xlsxNumberToText(-0.5)).toEqual({ text: "-0.5" });
    expect(xlsxNumberToText(1e21).text).toBe("1000000000000000000000");
    expect(xlsxNumberToText(1.5e-7).text).toBe("0.00000015");
    expect(xlsxNumberToText(100).text).toBe("100");
  });
  it("flags more than 15 significant digits", () => {
    expect(xlsxNumberToText(0.1 + 0.2)).toMatchObject({ text: "0.30000000000000004", precisionWarning: expect.stringContaining("15") });
    expect(xlsxNumberToText(123456789012345.6).precisionWarning).toBeDefined();
    expect(xlsxNumberToText(123456789012345).precisionWarning).toBeUndefined();
    expect(xlsxNumberToText(Number.NaN).precisionWarning).toBeDefined();
  });
});

describe("readXlsx", () => {
  it("numbers, dates, datetimes, formulas (cached result), rich text, booleans and blanks", async () => {
    const bytes = await book((wb) => {
      const ws = wb.addWorksheet("Payments");
      ws.addRow(["Fictional Merchant Pte — payout report"]);
      ws.addRow([]);
      ws.addRow(["Payment ID", "Date", "Settled at", "Amount", "Fee", "Net", "Memo", "Paid"]);
      ws.addRow(["P-1", new Date(Date.UTC(2026, 10, 2)), new Date(Date.UTC(2026, 10, 2, 9, 30, 15)), 1234.56, 0.1, { formula: "D4-E4", result: 1234.46 }, { richText: [{ text: "Inv " }, { text: "A-1", font: { bold: true } }] }, true]);
      ws.addRow([]);
      ws.addRow(["P-2", new Date(Date.UTC(2026, 10, 3)), null, 10, 0.2, { formula: "D6-E6", result: 9.8 }, "plain", false]);
      ws.getCell("B4").numFmt = "dd/mm/yyyy";
      ws.getCell("B6").numFmt = "dd/mm/yyyy";
      ws.getCell("C4").numFmt = "yyyy-mm-dd hh:mm:ss";
    });
    expect(sniffFile(bytes).kind).toBe("xlsx");
    const t = await readXlsx(bytes);
    expect(t).toMatchObject({ kind: "xlsx", sheet: "Payments", sheets: ["Payments"], headerRowNumber: 3, blankRowsSkipped: 1 });
    expect(t.headers).toEqual(["Payment ID", "Date", "Settled at", "Amount", "Fee", "Net", "Memo", "Paid"]);
    expect(t.rows).toEqual([
      { rowNumber: 4, cells: ["P-1", "2026-11-02", "2026-11-02T09:30:15", "1234.56", "0.1", "1234.46", "Inv A-1", "TRUE"] },
      { rowNumber: 6, cells: ["P-2", "2026-11-03", "", "10", "0.2", "9.8", "plain", "FALSE"] },
    ]);
    expect(t.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["title_rows_skipped", "blank_rows_skipped"]));
  });

  it("a formula whose result is a date-formatted serial becomes an ISO date", async () => {
    const bytes = await book((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["Ref", "Due"]);
      ws.addRow(["R1", { formula: "TODAY()", result: 46328 }]);
      ws.getCell("B2").numFmt = "yyyy-mm-dd";
    });
    expect((await readXlsx(bytes)).rows[0].cells).toEqual(["R1", "2026-11-02"]);
  });

  it("warns about >15 significant digits and error cells", async () => {
    const bytes = await book((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["Ref", "Amount", "Rate"]);
      ws.addRow(["R1", 0.1 + 0.2, { error: "#DIV/0!" }]);
    });
    const t = await readXlsx(bytes);
    expect(t.rows[0].cells).toEqual(["R1", "0.30000000000000004", ""]);
    expect(t.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["xlsx_precision", "xlsx_error_cell"]));
    expect(t.warnings.find((w) => w.code === "xlsx_precision")).toMatchObject({ row: 2, message: expect.stringContaining("B2") });
  });

  it("first non-empty sheet by default, a named sheet on request, a clear error for a missing one", async () => {
    const bytes = await book((wb) => {
      wb.addWorksheet("Cover");
      wb.addWorksheet("Data").addRows([["Ref", "Amount"], ["A", 1]]);
      wb.addWorksheet("Other").addRows([["Code", "Value"], ["Z", 2]]);
    });
    expect((await readXlsx(bytes)).sheet).toBe("Data");
    expect((await readXlsx(bytes, { sheet: "Other" })).rows[0].cells).toEqual(["Z", "2"]);
    await expect(readXlsx(bytes, { sheet: "Nope" })).rejects.toMatchObject({ code: "sheet_not_found", message: expect.stringContaining('"Data"') });
  });

  it("totals rows and duplicate headers are handled as in CSV", async () => {
    const bytes = await book((wb) => {
      wb.addWorksheet("S").addRows([["Ref", "Amount", "Amount"], ["A", 1.5, 1], ["B", 2.25, 2], ["Total", 3.75, 3]]);
    });
    const t = await readTabular(bytes);
    expect(t.headers).toEqual(["Ref", "Amount", "Amount (2)"]);
    expect(t.excludedRows.map((r) => r.rowNumber)).toEqual([4]);
  });

  it("damaged and empty workbooks", async () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("xl/workbook.xml garbage")]);
    await expect(readXlsx(broken)).rejects.toBeInstanceOf(IngestError);
    await expect(readXlsx(broken)).rejects.toMatchObject({ code: "invalid_xlsx" });
    const empty = await book((wb) => { wb.addWorksheet("Empty"); });
    await expect(readXlsx(empty)).rejects.toMatchObject({ code: "no_data" });
  });
});
