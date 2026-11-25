/**
 * v1 E1 (phase 5.2): fuzz tests for every input parser on this base that reads bytes or text a person or provider
 * supplies. Before this file no parser here had a fuzz test. Properties checked, per parser contract:
 *   - "value parsers return a Result": they never throw, whatever the input;
 *   - "file readers throw an IngestError": nothing else escapes (no TypeError/RangeError from the parser's insides);
 *   - every call finishes within a time bound (no catastrophic regex backtracking or quadratic blow-up on noise);
 *   - round trips hold where the format allows (amounts, exact JSON numbers), and JSON keys never pollute prototypes.
 * Inputs are random noise or mutated FICTIONAL samples. Reproduce a failure with the seed the message prints.
 */
import { describe, expect, it } from "vitest";
import { bytesCase, enc, fuzz, ITERATIONS, nastyText, randomBytes, textCase, thrown, type Rng } from "./harness";
import { decodeUtf8, parseCsv } from "@/lib/csv/parse";
import { parseStatementCsv } from "@/lib/csv/statement";
import { validateBulk, validateFileA, validateFileB, checkTimestamp } from "@/lib/csv/files";
import {
  detectDateFormat, detectDecimalSeparator, formatMinor, IngestError, parseAmount, parseCamt053, parseDate, parseDateColumn, parseMt940,
  readDelimited, readJson, readTabular, readXlsx, sniffFile, DATE_FORMATS, MAX_PRECISION,
} from "@/lib/clearline/ingest";
import { JsonNumber, parseJson } from "@/lib/clearline/ingest/json";
import { parseProviderBody } from "@/lib/clearline/connect/normalize";
import { CONNECT_DESCRIPTORS } from "@/lib/clearline/connect/descriptors";
import { parseReportText } from "@/lib/clearline/merchant/reconstruct/schema";
import { loadWorkspace, parseWorkspace } from "@/lib/clearline/serialize";
import { readFxRates } from "@/lib/clearline/merchant/adapters/fx";
import { readSettlementReports } from "@/lib/clearline/merchant/adapters/settlement";
import { parseRate } from "@/lib/clearline/merchant/amounts";
import { crc32, readStoreZip, storeZip } from "@/lib/clearline/exports/zip";

// ---- fictional seed samples ---------------------------------------------------------------------------------------
const CSV_SEEDS = [
  "a,b,c\n1,2,3\n",
  'name,amount,note\n"Fictional Co, Ltd","1,234.56","said ""hi"""\r\nOther,-5,\n',
  "line_id,account_ref,value_date,direction,kind,amount,currency,reference,counterparty\nL1,ACC-FICT-1,2026-11-02,credit,payment,1250.50,SGD,INV-1001,Fictional Payer\n",
  "address,chain,customer_id,assigned_at,retired_at\nTFICTIONALADDRESS000000000000000001,tron,C-1,2026-01-01T00:00:00Z,\n",
  "deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index,reason_code\nD1,0xabc,ethereum,USDT,0xdef,10.00,credited,2026-01-01T00:00:00Z,C-1,0,\n",
];
const MT940_SEED = [
  "{1:F01FICTXX00AXXX0000000000}{2:I940FICTXX00XXXXN}{4:", ":20:STMT-0001", ":25:XX00FICT0000000001", ":28C:00001/001",
  ":60F:C261031SGD1000,00", ":61:2611021102C1250,50NTRFINV-1001//FICTREF0001", "PAYOUT FROM FICTIONAL EXCHANGE",
  ":86:Settlement for order INV-1001", ":61:2611031103D100,NCHGNONREF//FICTREF0002", ":86:Monthly account fee",
  ":62F:C261103SGD2150,50", "-}",
].join("\r\n");
const CAMT_SEED = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
<GrpHdr><MsgId>FICT-MSG-1</MsgId><CreDtTm>2026-11-05T01:00:00</CreDtTm></GrpHdr>
<Stmt><Id>FICT-STMT-02</Id><Acct><Id><IBAN>XX00FICT0000000001</IBAN></Id><Ccy>SGD</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="SGD">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="SGD">2250.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-04</Dt></Dt></Bal>
<Ntry><NtryRef>FICT-NTRY-1</NtryRef><Amt Ccy="SGD">1250.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
<BookgDt><Dt>2026-11-02</Dt></BookgDt><ValDt><Dt>2026-11-03</Dt></ValDt>
<NtryDtls><TxDtls><Refs><EndToEndId>E2E-INV-1001</EndToEndId></Refs><RmtInf><Ustrd>INVOICE INV-1001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
const JSON_SEEDS = ['{"rows":[{"a":"1","amount":12.50,"__proto__":{"polluted":1}}]}', '[{"x":1e2,"y":null,"z":[true,false]}]', '{"a":{"b":{"c":[1,2,{"d":"e"}]}}}'];

const isIngestError = (e: unknown) => e === undefined || e instanceof IngestError;
function expectOnlyIngestError(e: unknown, what: string) {
  if (!isIngestError(e)) throw new Error(`${what} threw ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`);
}
function expectNoThrow(e: unknown, what: string) {
  if (e !== undefined) throw new Error(`${what} threw ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`);
}

describe("fuzz seeds are valid inputs (so mutations start from the parsers' real paths)", () => {
  it("the MT940, camt.053, CSV and JSON seeds parse", () => {
    expect(parseMt940(MT940_SEED).statements.length).toBe(1);
    expect(parseCamt053(CAMT_SEED).statements.length).toBe(1);
    const st = parseStatementCsv(enc(CSV_SEEDS[2]));
    expect(st.ok ? st.rows.length : st.errors).toBe(1);
    for (const j of JSON_SEEDS) expect(() => parseJson(j)).not.toThrow();
    expect(readDelimited(enc(CSV_SEEDS[1])).rows.length).toBe(2);
  });
});

describe("fuzz: legacy CSV parsers (src/lib/csv) never throw", () => {
  it("decodeUtf8 + parseCsv", () => fuzz("parseCsv", async (r) => {
    expectNoThrow(await thrown(() => decodeUtf8(bytesCase(r, CSV_SEEDS.map(enc)))), "decodeUtf8");
    const text = textCase(r, CSV_SEEDS);
    const e = await thrown(() => {
      const res = parseCsv(text);
      expect(Array.isArray(res.records)).toBe(true);
    });
    expectNoThrow(e, "parseCsv");
  }));
  it("parseStatementCsv, validateFileA/B and validateBulk", () => fuzz("statement+files", async (r) => {
    const bytes = bytesCase(r, CSV_SEEDS.map(enc));
    for (const [name, f] of [["parseStatementCsv", parseStatementCsv], ["validateFileA", validateFileA], ["validateFileB", validateFileB], ["validateBulk", validateBulk]] as const) {
      expectNoThrow(await thrown(() => (f as (b: Uint8Array) => unknown)(bytes)), name);
    }
    expectNoThrow(await thrown(() => checkTimestamp(nastyText(r, 40))), "checkTimestamp");
  }));
});

describe("fuzz: ingest value parsers return a Result and never throw", () => {
  it("parseAmount never throws, and every accepted amount is exact (format → parse round trip)", () => fuzz("parseAmount", async (r) => {
    const precision = r.int(MAX_PRECISION + 2) - (r.int(10) === 0 ? 1 : 0);
    const opts = { precision, decimalSeparator: r.pick([".", ","] as const), allowDrCr: r.int(2) === 0, allowTrailingZeros: r.int(2) === 0 };
    expectNoThrow(await thrown(() => parseAmount(textCase(r, ["1,234.56", "(12.00)", "-0.5 DR", "1 234,50", "€ 1.000,00"]), opts)), "parseAmount");
    if (precision >= 0 && precision <= MAX_PRECISION) {
      const digits = 1 + r.int(30);
      let m = 0n;
      for (let i = 0; i < digits; i++) m = m * 10n + BigInt(r.int(10));
      if (r.int(2)) m = -m;
      const text = formatMinor(m, precision);
      const back = parseAmount(text, { precision });
      if (back.ok) expect(back.value, text).toBe(m);
      else expect(back.code, text).toBe("too_large"); // the only reason a well-formed amount may be refused
    }
  }));
  it("detectDecimalSeparator, parseDate, detectDateFormat and parseDateColumn never throw", () => fuzz("dates+decimals", async (r) => {
    const samples = Array.from({ length: r.int(20) }, () => textCase(r, ["2026-11-02", "02/11/2026", "11/02/26", "2026-11-02T09:15:00+08:00", "1,234.50"]));
    expectNoThrow(await thrown(() => detectDecimalSeparator(samples)), "detectDecimalSeparator");
    expectNoThrow(await thrown(() => detectDateFormat(samples)), "detectDateFormat");
    expectNoThrow(await thrown(() => parseDateColumn(samples, { timeZone: r.pick(["UTC", "Asia/Singapore", "Nope/Zone"]) } as never)), "parseDateColumn");
    for (const s of samples) expectNoThrow(await thrown(() => parseDate(s, r.pick(DATE_FORMATS as readonly string[]) as never, { timeZone: "UTC" } as never)), "parseDate");
  }));
});

describe("fuzz: ingest file readers throw only IngestError", () => {
  it("sniffFile never throws; readDelimited / readJson / readTabular throw only IngestError", () => fuzz("tabular", async (r) => {
    const bytes = bytesCase(r, [...CSV_SEEDS, ...JSON_SEEDS].map(enc));
    expectNoThrow(await thrown(() => sniffFile(bytes, r.pick(["a.csv", "b.json", "c.xlsx", "d.txt", "e"]))), "sniffFile");
    expectOnlyIngestError(await thrown(() => readDelimited(bytes)), "readDelimited");
    expectOnlyIngestError(await thrown(() => readJson(bytes)), "readJson");
    expectOnlyIngestError(await thrown(() => readTabular(bytes, { fileName: r.pick(["a.csv", "b.json", "c.txt"]) })), "readTabular");
  }));
  it("readXlsx on noise and on mutated zip containers throws only IngestError", () => fuzz("xlsx", async (r) => {
    const zip = storeZip([{ name: "docProps/app.xml", data: enc("<Properties/>") }, { name: "xl/workbook.xml", data: enc("<workbook/>") }]);
    const bytes = r.int(2) ? randomBytes(r) : bytesCase(r, [zip]);
    expectOnlyIngestError(await thrown(() => readXlsx(bytes)), "readXlsx");
  }, { iterations: Math.max(20, Math.floor(ITERATIONS / 6)), maxMs: 5_000 }));
  it("parseMt940 throws only IngestError", () => fuzz("mt940", async (r) => {
    expectOnlyIngestError(await thrown(() => parseMt940(textCase(r, [MT940_SEED]))), "parseMt940");
    expectOnlyIngestError(await thrown(() => parseMt940(bytesCase(r, [enc(MT940_SEED)]))), "parseMt940 bytes");
  }));
  it("parseCamt053 throws only IngestError, including on entity-expansion and external-entity payloads", () => fuzz("camt053", async (r) => {
    expectOnlyIngestError(await thrown(() => parseCamt053(textCase(r, [CAMT_SEED]))), "parseCamt053");
    const bomb = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "${"x".repeat(1 + r.int(50))}">${Array.from({ length: 1 + r.int(8) }, (_, k) => `<!ENTITY a${k} "${"&a;".repeat(10)}">`).join("")}<!ENTITY ext SYSTEM "file:///etc/passwd">]>` + CAMT_SEED.replace(/^<\?xml[^>]*>/, "").replace("FICT-STMT-02", r.int(2) ? "&a7;&ext;" : "&a0;");
    const e = await thrown(() => {
      const res = parseCamt053(bomb);
      // Whatever it returns must not contain a file's contents.
      expect(JSON.stringify(res)).not.toMatch(/root:|\/bin\/(ba)?sh/);
    });
    expectOnlyIngestError(e, "parseCamt053 entities");
  }));
  it("parseJson throws only IngestError, keeps numbers exact and never pollutes a prototype", () => fuzz("parseJson", async (r) => {
    expectOnlyIngestError(await thrown(() => parseJson(textCase(r, JSON_SEEDS))), "parseJson");
    const deep = "[".repeat(1 + r.int(5000));
    expectOnlyIngestError(await thrown(() => parseJson(deep)), "parseJson deep");
    const n = `${r.int(2) ? "-" : ""}${r.int(1_000_000)}.${String(r.int(1e9)).padStart(9, "0")}${"7".repeat(r.int(20))}`;
    const v = parseJson(`{"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}},"n":${n}}`) as Record<string, unknown>;
    expect((v.n as JsonNumber).text).toBe(n);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null).toBe(true);
  }));
});

describe("fuzz: provider, report and workspace readers never throw", () => {
  it("parseProviderBody (every Connect descriptor) returns a Result", () => fuzz("provider-body", async (r) => {
    const d = r.pick(CONNECT_DESCRIPTORS);
    const seed = JSON.stringify({ id: "evt_fict_1", status: "completed", amount: "10.00", currency: "USD", reference: "pi_00001", occurred_at: "2026-11-02T00:00:00Z", data: { object: { id: "x", status: "settled" } } });
    expectNoThrow(await thrown(() => parseProviderBody(d, textCase(r, [seed, ...JSON_SEEDS]))), `parseProviderBody(${d.providerId})`);
  }));
  it("parseReportText, parseWorkspace and loadWorkspace return a Result", () => fuzz("report+workspace", async (r) => {
    const text = textCase(r, [...JSON_SEEDS, '{"format":"clearline.reconstruction.v1","notes":[],"assumptions":[]}', '{"version":1,"intents":[]}']);
    expectNoThrow(await thrown(() => parseReportText(text)), "parseReportText");
    expectNoThrow(await thrown(() => parseWorkspace(text)), "parseWorkspace");
    expectNoThrow(await thrown(() => loadWorkspace(text)), "loadWorkspace");
  }));
  it("merchant adapters collect bad rows as item errors instead of throwing", () => fuzz("adapters", async (r) => {
    const raw = (): unknown => { try { return JSON.parse(textCase(r, ['{"rates":[{"pair":"USDT/SGD","rate":"1.35","source":"fict","timestamp":"2026-11-02T00:00:00Z"}]}', '[{"a":1}]'])); } catch { return nastyText(r, 50); } };
    const src = (id: string) => ({ id, read: () => raw() });
    expectNoThrow(await thrown(() => readFxRates([src("fx")])), "readFxRates");
    expectNoThrow(await thrown(() => readSettlementReports([src("settlement")])), "readSettlementReports");
  }));
});

describe("fuzz: small exact parsers", () => {
  it("parseRate throws only RangeError and is exact for what it accepts", () => fuzz("parseRate", async (r: Rng) => {
    const s = textCase(r, ["1.35", "0.000001", "123456789012345.123456789012"]);
    const e = await thrown(() => parseRate(s));
    if (e !== undefined && !(e instanceof RangeError)) throw e;
    const whole = String(1 + r.int(1e6)), frac = String(r.int(1e6)).padStart(1 + r.int(6), "0");
    const q = parseRate(`${whole}.${frac}`);
    expect(q.num).toBe(BigInt(whole + frac));
    expect(q.den).toBe(10n ** BigInt(frac.length));
  }));
  it("readStoreZip terminates and throws only a plain Error on mutated archives; a valid archive round-trips", () => fuzz("zip", async (r) => {
    const files = Array.from({ length: 1 + r.int(4) }, (_, k) => ({ name: `f${k}.txt`, data: randomBytes(r, 64) }));
    const z = storeZip(files);
    const back = readStoreZip(z);
    for (const f of files) expect(back.get(f.name)).toEqual(f.data);
    expect(crc32(new Uint8Array())).toBe(0);
    const e = await thrown(() => readStoreZip(bytesCase(r, [z])));
    if (e !== undefined && (e as Error).constructor !== Error) throw e;
  }));
});
