import { describe, expect, it } from "vitest";
import { IngestError, parseCamt053, sniffFile } from "@/lib/clearline/ingest";

const enc = (s: string) => new TextEncoder().encode(s);

/** camt.053.001.02: Sts is a plain code; party names sit directly under Dbtr/Cdtr. All values fictional. */
const V02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>FICT-MSG-1</MsgId><CreDtTm>2026-11-05T01:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>FICT-STMT-02</Id>
      <ElctrncSeqNb>7</ElctrncSeqNb>
      <Acct><Id><IBAN>XX00FICT0000000001</IBAN></Id><Ccy>SGD</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="SGD">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="SGD">2150.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-04</Dt></Dt></Bal>
      <Ntry>
        <NtryRef>FICT-NTRY-1</NtryRef>
        <Amt Ccy="SGD">1250.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-02</Dt></BookgDt>
        <ValDt><Dt>2026-11-03</Dt></ValDt>
        <AcctSvcrRef>FICTBANKREF-1</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>E2E-INV-1001</EndToEndId></Refs>
          <RltdPties><Dbtr><Nm>Fictional Payer &amp; Sons</Nm></Dbtr><Cdtr><Nm>Fictional Merchant Pte</Nm></Cdtr></RltdPties>
          <RmtInf><Ustrd>INVOICE INV-1001</Ustrd><Ustrd>ORDER 77</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="SGD">100.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><DtTm>2026-11-04T09:15:00+08:00</DtTm></BookgDt>
        <ValDt><DtTm>2026-11-04T09:15:00+08:00</DtTm></ValDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
          <RltdPties><Cdtr><Nm>Fictional Supplier Ltd</Nm></Cdtr></RltdPties>
          <RmtInf><Ustrd>SUPPLIER PAYMENT 5</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="SGD">999.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <ValDt><Dt>2026-11-05</Dt></ValDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

/** camt.053.001.08: Sts/Cd, party names under Dbtr/Pty/Nm, Othr/Id account, a namespace prefix, two statements. */
const V08 = `<?xml version="1.0" encoding="UTF-8"?>
<c:Document xmlns:c="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <c:BkToCstmrStmt>
    <c:GrpHdr><c:MsgId>FICT-MSG-8</c:MsgId></c:GrpHdr>
    <c:Stmt>
      <c:Id>FICT-STMT-08A</c:Id>
      <c:Acct><c:Id><c:Othr><c:Id>FICT-ACCT-0002</c:Id></c:Othr></c:Id><c:Ccy>JPY</c:Ccy></c:Acct>
      <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>OPBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt Ccy="JPY">500</c:Amt><c:CdtDbtInd>DBIT</c:CdtDbtInd><c:Dt><c:Dt>2026-11-01</c:Dt></c:Dt></c:Bal>
      <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>CLBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt Ccy="JPY">9500</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Dt><c:Dt>2026-11-02</c:Dt></c:Dt></c:Bal>
      <c:Ntry>
        <c:Amt Ccy="JPY">10000</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Sts><c:Cd>BOOK</c:Cd></c:Sts>
        <c:BookgDt><c:Dt>2026-11-02</c:Dt></c:BookgDt><c:ValDt><c:Dt>2026-11-02</c:Dt></c:ValDt>
        <c:AcctSvcrRef>FICTBANKREF-8</c:AcctSvcrRef>
        <c:NtryDtls><c:TxDtls>
          <c:Refs><c:EndToEndId>E2E-JP-1</c:EndToEndId></c:Refs>
          <c:RltdPties><c:Dbtr><c:Pty><c:Nm>Fictional Buyer KK</c:Nm></c:Pty></c:Dbtr></c:RltdPties>
        </c:TxDtls></c:NtryDtls>
      </c:Ntry>
      <c:Ntry>
        <c:Amt Ccy="JPY">1</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Sts><c:Cd>INFO</c:Cd></c:Sts><c:ValDt><c:Dt>2026-11-02</c:Dt></c:ValDt>
      </c:Ntry>
    </c:Stmt>
    <c:Stmt>
      <c:Id>FICT-STMT-08B</c:Id>
      <c:Acct><c:Id><c:IBAN>XX00FICT0000000003</c:IBAN></c:Id><c:Ccy>EUR</c:Ccy></c:Acct>
      <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>OPBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt Ccy="EUR">0.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Dt><c:Dt>2026-11-01</c:Dt></c:Dt></c:Bal>
      <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>CLBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt Ccy="EUR">10.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Dt><c:Dt>2026-11-02</c:Dt></c:Dt></c:Bal>
      <c:Ntry>
        <c:Amt Ccy="EUR">12.34</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Sts><c:Cd>BOOK</c:Cd></c:Sts><c:ValDt><c:Dt>2026-11-02</c:Dt></c:ValDt>
        <c:NtryRef>FICT-NTRY-B1</c:NtryRef>
      </c:Ntry>
    </c:Stmt>
  </c:BkToCstmrStmt>
</c:Document>`;

describe("parseCamt053 .001.02", () => {
  it("is detected by content", () => expect(sniffFile(enc(V02), "statement.txt").kind).toBe("camt053"));

  it("maps booked entries and reports the others", () => {
    const r = parseCamt053(enc(V02));
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]).toMatchObject({ account: "XX00FICT0000000001", currency: "SGD", statementId: "FICT-STMT-02", sequence: "7", balanced: true,
      opening: { amountMinor: 100000n, date: "2026-11-01" }, closing: { amountMinor: 215050n, date: "2026-11-04" } });
    expect(r.lines).toEqual([
      {
        lineId: "camt053|XX00FICT0000000001|2026-11-03|C|125050|FICTBANKREF-1|0",
        account: "XX00FICT0000000001", currency: "SGD", valueDate: "2026-11-03", bookingDate: "2026-11-02", direction: "credit", amountMinor: 125050n,
        reference: "E2E-INV-1001", narrative: "INVOICE INV-1001 ORDER 77", counterparty: "Fictional Payer & Sons", bankReference: "FICTBANKREF-1",
        sourceFormat: "camt053", sourceRow: 1,
      },
      {
        lineId: "camt053|XX00FICT0000000001|2026-11-04|D|10000||0",
        account: "XX00FICT0000000001", currency: "SGD", valueDate: "2026-11-04", bookingDate: "2026-11-04", direction: "debit", amountMinor: 10000n,
        reference: "SUPPLIER PAYMENT 5", narrative: "SUPPLIER PAYMENT 5", counterparty: "Fictional Supplier Ltd", sourceFormat: "camt053", sourceRow: 2,
      },
    ]);
    expect(r.skipped).toEqual([{ sourceRow: 3, status: "PDNG", reason: expect.stringContaining("PDNG") }]);
    expect(r.warnings.map((w) => w.code)).toEqual(["entries_not_booked"]);
  });

  it("a balance mismatch is a warning with both figures", () => {
    const r = parseCamt053(V02.replace(">2150.50<", ">2150.00<"));
    expect(r.statements[0].balanced).toBe(false);
    expect(r.warnings.find((w) => w.code === "balance_mismatch")?.message).toBe(
      "Statement FICT-STMT-02 for XX00FICT0000000001: opening 1000.00 plus the booked entries gives 2150.50 SGD, but the closing balance (CLBD) is 2150.00 SGD.");
  });

  it("excess decimals in an amount are an error", () => {
    expect(() => parseCamt053(V02.replace(">100.00<", ">100.001<"))).toThrowError(/decimal place/);
  });
});

describe("parseCamt053 .001.08", () => {
  it("reads Sts/Cd, Pty/Nm, Othr/Id, prefixed tags and several statements", () => {
    const r = parseCamt053(V08);
    expect(r.statements.map((s) => [s.account, s.currency, s.balanced])).toEqual([["FICT-ACCT-0002", "JPY", true], ["XX00FICT0000000003", "EUR", false]]);
    expect(r.lines[0]).toMatchObject({ account: "FICT-ACCT-0002", currency: "JPY", amountMinor: 10000n, direction: "credit", counterparty: "Fictional Buyer KK", reference: "E2E-JP-1", bankReference: "FICTBANKREF-8", sourceRow: 1 });
    expect(r.statements[0].opening?.amountMinor).toBe(-500n);
    expect(r.lines[1]).toMatchObject({ account: "XX00FICT0000000003", amountMinor: 1234n, reference: "FICT-NTRY-B1", sourceRow: 3 });
    expect(r.skipped).toEqual([{ sourceRow: 2, status: "INFO", reason: expect.any(String) }]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["balance_mismatch", "entries_not_booked"]);
  });
});

describe("XML safety and shape", () => {
  it("refuses a DOCTYPE with an external entity (XXE)", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE Document [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>&xxe;</Id></Stmt></BkToCstmrStmt></Document>`;
    let err: unknown;
    try { parseCamt053(enc(xxe)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).code).toBe("unsafe_xml");
    expect((err as Error).message).not.toContain("root:");
  });
  it("refuses an entity-expansion bomb", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><x>&lol2;</x></Document>`;
    expect(() => parseCamt053(bomb)).toThrowError(expect.objectContaining({ code: "unsafe_xml" }));
  });
  it("never expands an undeclared entity reference", () => {
    const r = parseCamt053(V02.replace("INVOICE INV-1001", "INVOICE &custom; INV-1001"));
    expect(r.lines[0].narrative).toContain("&custom;");
  });
  it("rejects malformed XML, other messages and statements without accounts", () => {
    expect(() => parseCamt053("<Document><unclosed></Document>")).toThrowError(expect.objectContaining({ code: "invalid_camt053" }));
    expect(() => parseCamt053('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn/></Document>')).toThrowError(expect.objectContaining({ code: "invalid_camt053" }));
    expect(() => parseCamt053(V02.replace(/<Acct>.*?<\/Acct>/s, ""))).toThrowError(/no account/);
    expect(() => parseCamt053(V02.replace(/Ccy="SGD">1250.50/, 'Ccy="XYZ">1250.50'))).toThrowError(expect.objectContaining({ code: "unknown_currency" }));
  });
  it("an unlisted camt.053 version is read with a warning", () => {
    expect(parseCamt053(V02.replace("camt.053.001.02", "camt.053.001.04")).warnings.map((w) => w.code)).toContain("camt_version");
  });
});
