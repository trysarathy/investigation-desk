import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IngestError, parseCamt053, parseCamt054, sniffFile } from "@/lib/clearline/ingest";

const dir = join(__dirname, "fixtures", "bank-formats");
const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const text = (name: string) => readFileSync(join(dir, name), "utf8");
const codeOf = (f: () => unknown): string | undefined => { try { f(); } catch (e) { return e instanceof IngestError ? e.code : `not an IngestError: ${String(e)}`; } return undefined; };

describe("camt.054 normal notification (fictional)", () => {
  it("is detected by content, whatever the file is called", () => {
    expect(sniffFile(file("camt054-normal.xml"), "notification.xml").kind).toBe("camt054");
    expect(sniffFile(file("camt054-normal.xml"), "x.txt").kind).toBe("camt054");
    expect(sniffFile(file("camt054-normal.xml"), "x.sta").warnings.map((w) => w.code)).toContain("extension_mismatch");
  });

  it("reads booked entries, skips the pending one and says there are no balances", () => {
    const r = parseCamt054(file("camt054-normal.xml"));
    expect(r.sourceFormat).toBe("camt054");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]).toMatchObject({ sourceFormat: "camt054", account: "XX00FICT00004321", currency: "SGD", statementId: "FICT-NTFCTN-1", sequence: "41" });
    expect(r.statements[0].balanced).toBeUndefined();
    expect(r.lines).toEqual([
      { lineId: "camt054|XX00FICT00004321|2026-11-19|C|125000|FICTBANK-054-1|0", account: "XX00FICT00004321", currency: "SGD", valueDate: "2026-11-19", bookingDate: "2026-11-19",
        direction: "credit", amountMinor: 125000n, reference: "INV-1001", narrative: "INVOICE INV-1001", counterparty: "Fictional Payer Pte", bankReference: "FICTBANK-054-1", sourceFormat: "camt054", sourceRow: 1 },
      { lineId: "camt054|XX00FICT00004321|2026-11-20|C|50000|FICTBANK-054-2|0", account: "XX00FICT00004321", currency: "SGD", valueDate: "2026-11-20", bookingDate: "2026-11-19",
        direction: "credit", amountMinor: 50000n, reference: "PAYOUT BATCH FICT-B-7", narrative: "PAYOUT BATCH FICT-B-7", bankReference: "FICTBANK-054-2", sourceFormat: "camt054", sourceRow: 2 },
      { lineId: "camt054|XX00FICT00004321|2026-11-19|D|30000|FICTBANK-054-3|0", account: "XX00FICT00004321", currency: "SGD", valueDate: "2026-11-19", bookingDate: "2026-11-19",
        direction: "debit", amountMinor: 30000n, reference: "SUPPLIER PAYMENT 5", narrative: "SUPPLIER PAYMENT 5", counterparty: "Fictional Supplier Ltd", bankReference: "FICTBANK-054-3", sourceFormat: "camt054", sourceRow: 3 },
    ]);
    expect(r.skipped).toEqual([{ sourceRow: 4, status: "PDNG", reason: expect.stringContaining("PDNG") }]);
    expect(r.warnings.map((w) => w.code)).toEqual(["no_balances", "entries_not_booked"]);
  });

  it("is deterministic: the same bytes give the same lines and ids", () => {
    expect(parseCamt054(file("camt054-normal.xml"))).toEqual(parseCamt054(file("camt054-normal.xml")));
  });

  it("the camt.053 reader refuses a camt.054 file and the camt.054 reader a camt.053 file (never read as the other)", () => {
    expect(codeOf(() => parseCamt053(text("camt054-normal.xml")))).toBe("invalid_camt053");
    const stmt053 = text("camt054-normal.xml").replace("xsd:camt.054.001.08", "xsd:camt.053.001.08").replace(/BkToCstmrDbtCdtNtfctn/g, "BkToCstmrStmt").replace(/Ntfctn>/g, "Stmt>");
    expect(parseCamt053(stmt053).lines).toHaveLength(3);
    expect(codeOf(() => parseCamt054(stmt053))).toBe("invalid_camt054");
  });
});

describe("camt.054 reversals and returns (fictional)", () => {
  it("keeps the direction the bank states and flags RvslInd true / 1 for review; nothing is netted", () => {
    const r = parseCamt054(file("camt054-reversal.xml"));
    expect(r.lines.map((l) => [l.direction, l.amountMinor, l.reversal ?? false, l.reference])).toEqual([
      ["credit", 20000n, false, "INV-2001"],
      ["debit", 20000n, true, "INV-2001"],
      ["credit", 7500n, true, "RETURN OF OUTGOING PAYMENT, CREDITOR ACCOUNT CLOSED"],
    ]);
    expect(r.lines[0].counterparty).toBe("Fictional Buyer Inc");
    expect(r.lines[2].valueDate).toBe("2026-11-21");
  });
  it("RvslInd false is not a reversal", () => {
    const r = parseCamt054(text("camt054-reversal.xml").replace("<RvslInd>true</RvslInd>", "<RvslInd>false</RvslInd>"));
    expect(r.lines[1].reversal).toBeUndefined();
  });
  it("a camt.053 entry with RvslInd is flagged the same way (shared reader)", () => {
    const stmt = text("camt054-reversal.xml").replace("xsd:camt.054.001.02", "xsd:camt.053.001.02").replace(/BkToCstmrDbtCdtNtfctn/g, "BkToCstmrStmt").replace(/Ntfctn>/g, "Stmt>");
    expect(parseCamt053(stmt).lines.map((l) => l.reversal ?? false)).toEqual([false, true, true]);
  });
});

describe("camt.054 with several accounts (conservative: refused, not split)", () => {
  it("refuses a file naming two accounts, without echoing either account number", () => {
    let err: unknown;
    try { parseCamt054(file("camt054-two-accounts.xml")); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).code).toBe("multiple_accounts");
    expect((err as Error).message).not.toMatch(/4321|9999/);
  });
  it("two notifications for the SAME account are read (two days of one account)", () => {
    const same = text("camt054-two-accounts.xml").replace("XX00FICT00009999", "XX00FICT00004321");
    const r = parseCamt054(same);
    expect(r.statements).toHaveLength(2);
    expect(r.lines.map((l) => l.amountMinor)).toEqual([1000n, 2000n]);
  });
});

describe("camt.054 malformed and hostile files", () => {
  const ok = text("camt054-normal.xml");
  it.each([
    ["not well-formed", "<Document><unclosed></Document>", "invalid_camt054"],
    ["no namespace", ok.replace(' xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"', ""), "invalid_camt054"],
    ["no notifications", ok.replace(/<Ntfctn>[\s\S]*<\/Ntfctn>/, ""), "invalid_camt054"],
    ["no account", ok.replace(/<Acct>.*?<\/Acct>/s, ""), "invalid_camt054"],
    ["no currency", ok.replace("<Ccy>SGD</Ccy>", "").replace(/ Ccy="SGD"/g, ""), "invalid_camt054"],
    ["unknown currency", ok.replace('Ccy="SGD">1250.00', 'Ccy="XYZ">1250.00'), "unknown_currency"],
    ["bad indicator", ok.replace("<CdtDbtInd>CRDT</CdtDbtInd>", "<CdtDbtInd>CREDIT</CdtDbtInd>"), "invalid_camt054"],
    ["negative amount", ok.replace(">1250.00<", ">-1250.00<"), "invalid_amount"],
    ["too many decimals", ok.replace(">1250.00<", ">1250.001<"), "invalid_amount"],
    ["no date", ok.replace(/<BookgDt><Dt>2026-11-19<\/Dt><\/BookgDt>\s*<ValDt><Dt>2026-11-19<\/Dt><\/ValDt>/, ""), "invalid_camt054"],
    ["XXE", ok.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]>'), "unsafe_xml"],
    ["billion laughs", ok.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>'), "unsafe_xml"],
    ["ELEMENT declaration", ok.replace("<Document", "<!ELEMENT x ANY><Document"), "unsafe_xml"],
    ["deep nesting", ok.replace("<GrpHdr>", "<X>".repeat(200) + "</X>".repeat(200) + "<GrpHdr>"), "unsafe_xml"],
  ])("%s → %s", (_name, xml, code) => {
    expect(codeOf(() => parseCamt054(xml))).toBe(code);
  });
  it("an entry over the row limit is refused (too_many_rows)", () => {
    expect(codeOf(() => parseCamt054(file("camt054-normal.xml"), { limits: { maxDataRows: 2 } }))).toBe("too_many_rows");
  });
  it("a file over the size limit is refused before parsing", () => {
    expect(codeOf(() => parseCamt054(file("camt054-normal.xml"), { limits: { maxFileBytes: 100 } }))).toBe("file_too_large");
  });
  it("an unlisted version is read with a warning", () => {
    expect(parseCamt054(ok.replace("xsd:camt.054.001.08", "xsd:camt.054.001.04")).warnings.map((w) => w.code)).toContain("camt_version");
  });
});
