/**
 * v1 phase 2.1: hardened parsers. Property/fuzz tests (seeded, so a failure reproduces) for every reader: random and
 * malformed inputs never crash the process (only an IngestError is thrown) and never run beyond a time limit; plus
 * targeted zip-bomb, lying-header, encrypted-part and XML-entity cases for XLSX and camt.053. All data fictional.
 */
import ExcelJS from "exceljs";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { IngestError, parseCamt053, parseMt940, readDelimited, readJson, readTabular, readXlsx, sniffFile } from "@/lib/clearline/ingest";
import { checkZipContainer } from "@/lib/clearline/ingest/zip-guard";

/** mulberry32: a small deterministic generator, so every fuzz case is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const enc = (s: string) => new TextEncoder().encode(s);
/** Cases per reader and kind; CLEARLINE_FUZZ_RUNS raises it for a longer local run (the seed stays fixed). */
const RUNS = Number(process.env.CLEARLINE_FUZZ_RUNS) || 150;

const CSV = enc("Payment ID,Date,Amount,Currency,Memo\nP-1,2026-11-02,1234.56,SGD,\"Fictional, quoted\"\nP-2,2026-11-03,-10.00,USD,=SUM(A1)\n");
const JSON_DOC = enc(JSON.stringify({ data: [{ id: "P-1", amount: "1.00", nested: { a: [1, 2] } }, { id: "P-2", amount: "2.50" }] }));
const MT940 = enc(":20:FICT-REF\r\n:25:FICT0001/SGD\r\n:28C:1/1\r\n:60F:C261101SGD1000,00\r\n:61:2611021102C1250,50NTRFINV-1001//FICT1\r\n:86:FICTIONAL PAYER\r\n:62F:C261102SGD2250,50\r\n");
const CAMT = enc(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>M</MsgId></GrpHdr><Stmt><Id>S</Id>
<Acct><Id><IBAN>XX00FICT0000000001</IBAN></Id><Ccy>SGD</Ccy></Acct>
<Ntry><Amt Ccy="SGD">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><ValDt><Dt>2026-11-02</Dt></ValDt>
<NtryDtls><TxDtls><Refs><EndToEndId>E2E-1</EndToEndId></Refs></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`);

async function xlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payments");
  ws.addRow(["Payment ID", "Amount", "Memo"]);
  for (let i = 1; i <= 20; i++) ws.addRow([`P-${i}`, i * 1.25, i % 3 === 0 ? "=HYPERLINK(\"x\")" : "fictional"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** A random mutation of valid bytes: flips, truncation, splices of hostile fragments, duplication. */
function mutate(src: Uint8Array, r: () => number): Uint8Array {
  const bytes = Array.from(src);
  const hostile = ["\u0000", "\"", "\r", "\n", "<!DOCTYPE x [<!ENTITY a \"aaaa\">]>", "&a;", "{", "[", "]]>", "\uFEFF", ":61:", "<Ntry>", "\\u0000", "9".repeat(400), "\uD800"];
  const ops = 1 + Math.floor(r() * 6);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * (bytes.length + 1));
    const op = Math.floor(r() * 5);
    if (op === 0 && bytes.length) bytes[Math.min(at, bytes.length - 1)] ^= 1 << Math.floor(r() * 8);
    else if (op === 1) bytes.length = Math.max(1, Math.min(bytes.length, at));
    else if (op === 2) bytes.splice(at, 0, ...enc(hostile[Math.floor(r() * hostile.length)]));
    else if (op === 3) bytes.splice(at, Math.floor(r() * 16));
    else bytes.splice(at, 0, ...bytes.slice(at, at + Math.floor(r() * 64)));
  }
  return new Uint8Array(bytes.length ? bytes : [0x20]);
}

function randomBytes(r: () => number): Uint8Array {
  const n = Math.floor(r() * 2048) + 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(r() * 256);
  // a few cases start with a real signature, so the deeper readers are reached
  const heads = [[0x50, 0x4b, 0x03, 0x04], [0x3c, 0x3f, 0x78, 0x6d], [0x7b], [0x3a, 0x32, 0x30, 0x3a]];
  if (r() < 0.5) out.set(heads[Math.floor(r() * heads.length)].slice(0, n));
  return out;
}

/** Runs a reader on one input: it returns, or throws an IngestError; anything else is a crash. Time-bounded. */
async function survives(name: string, run: () => unknown | Promise<unknown>, limitMs: number) {
  const start = performance.now();
  try {
    await run();
  } catch (e) {
    if (!(e instanceof IngestError)) throw new Error(`${name} threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
  const ms = performance.now() - start;
  if (ms > limitMs) throw new Error(`${name} took ${Math.round(ms)} ms (limit ${limitMs} ms)`);
}

const READERS: [string, (b: Uint8Array) => unknown, Uint8Array | (() => Promise<Uint8Array>)][] = [
  ["readDelimited", (b) => readDelimited(b), CSV],
  ["readJson", (b) => readJson(b), JSON_DOC],
  ["parseMt940", (b) => parseMt940(b), MT940],
  ["parseCamt053", (b) => parseCamt053(b), CAMT],
  ["readXlsx", (b) => readXlsx(b), xlsx],
  ["readTabular", (b) => readTabular(b, { fileName: "fuzz.csv" }), CSV],
  ["sniffFile", (b) => sniffFile(b, "fuzz.xlsx"), CSV],
];

describe("fuzz: random and malformed inputs never crash a parser and never hang", () => {
  for (const [name, read, sample] of READERS) {
    it(`${name}: ${RUNS} random inputs and ${RUNS} mutations of a valid file (seeded)`, async () => {
      const valid = typeof sample === "function" ? await sample() : sample;
      await survives(`${name}(valid)`, () => read(valid), 5_000);
      const r = rng(0xc1 + name.length);
      for (let i = 0; i < RUNS; i++) await survives(`${name}(random #${i})`, () => read(randomBytes(r)), 2_000);
      for (let i = 0; i < RUNS; i++) await survives(`${name}(mutation #${i})`, () => read(mutate(valid, r)), 2_000);
    }, 600_000);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Zip containers built by hand, so headers can lie.
// ---------------------------------------------------------------------------------------------------------------

interface Part { name: string; data: Buffer; declaredSize?: number; method?: 0 | 8; flags?: number }

function zip(parts: Part[]): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const p of parts) {
    const method = p.method ?? 8;
    const body = method === 8 ? deflateRawSync(p.data) : p.data;
    const name = Buffer.from(p.name, "latin1");
    const size = p.declaredSize ?? p.data.length;
    const crc = crc32(p.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(p.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(p.flags ?? 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const WB = { name: "xl/workbook.xml", data: Buffer.from('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>') };
const code = async (p: unknown | Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof IngestError ? e.code : `not an IngestError: ${String(e)}`; }
  return "accepted";
};

describe("XLSX containers: zip bombs, lying headers and XML entities are refused before Excel parsing", () => {
  it("a real workbook passes the container check", async () => {
    const entries = checkZipContainer(await xlsx());
    expect(entries.some((e) => e.name === "xl/workbook.xml")).toBe(true);
  });

  it("an entry that inflates beyond its declared size (lying header) is refused", async () => {
    const bytes = zip([WB, { name: "xl/sharedStrings.xml", data: Buffer.alloc(5_000_000, 0x41), declaredSize: 1_000 }]);
    expect(sniffFile(bytes).kind).toBe("xlsx");
    expect(await code(readXlsx(bytes))).toBe("unsafe_zip");
  });

  it("an honest entry whose declared size is over the cap is refused without inflating it", () => {
    const bytes = zip([WB, { name: "xl/worksheets/sheet1.xml", data: Buffer.from("x"), declaredSize: 200 * 1024 * 1024 }]);
    expect(() => checkZipContainer(bytes)).toThrow(expect.objectContaining({ code: "unsafe_zip" }));
  });

  it("a high-ratio bomb (many entries, total over the cap) is refused", () => {
    const part = Buffer.alloc(1_000_000, 0);
    const bytes = zip([WB, ...Array.from({ length: 12 }, (_, i) => ({ name: `xl/media/p${i}.bin`, data: part }))]);
    expect(bytes.byteLength).toBeLessThan(100_000); // ~12 MB inflated from a few kilobytes
    expect(() => checkZipContainer(bytes, { maxEntries: 2_000, maxEntryBytes: 8_000_000, maxTotalBytes: 10_000_000 })).toThrow(expect.objectContaining({ code: "unsafe_zip" }));
    expect(checkZipContainer(bytes).length).toBe(13); // under the real caps it is a plain (if odd) container
  });

  it("too many entries, encrypted parts, unknown methods and duplicate names are refused", () => {
    const many = zip([WB, ...Array.from({ length: 30 }, (_, i) => ({ name: `xl/p${i}.xml`, data: Buffer.from("<a/>") }))]);
    expect(() => checkZipContainer(many, { maxEntries: 10, maxEntryBytes: 1e6, maxTotalBytes: 1e6 })).toThrow(/at most 10/);
    expect(() => checkZipContainer(zip([{ ...WB, flags: 1 }]))).toThrow(/Encrypted/);
    const stored = zip([{ ...WB, method: 0 }]);
    expect(checkZipContainer(stored)[0].size).toBe(WB.data.length);
    expect(() => checkZipContainer(zip([WB, WB]))).toThrow(/same name/);
  });

  it("a macro-enabled workbook (vbaProject.bin) is refused", async () => {
    const bytes = zip([WB, { name: "xl/vbaProject.bin", data: Buffer.from("fictional macro bytes") }]);
    expect(await code(readXlsx(bytes))).toBe("unsafe_zip");
  });

  it("a DOCTYPE or ENTITY inside any workbook XML part (billion laughs) is refused", async () => {
    const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><sst>&lol2;</sst>';
    const bytes = zip([WB, { name: "xl/sharedStrings.xml", data: Buffer.from(laughs) }]);
    expect(await code(readXlsx(bytes))).toBe("unsafe_xml");
    const rels = zip([WB, { name: "_rels/.rels", data: Buffer.from('<!DOCTYPE r SYSTEM "file:///etc/passwd"><Relationships/>') }]);
    expect(await code(readXlsx(rels))).toBe("unsafe_xml");
  });

  it("damaged containers (no directory, truncated) are refused as invalid, not crashes", async () => {
    const good = await xlsx();
    expect(await code(readXlsx(good.subarray(0, good.length - 30)))).toBe("invalid_xlsx");
    expect(await code(readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])))).toMatch(/invalid_xlsx|unsupported_file/);
  });
});

describe("camt.053 XML: entity and nesting attacks", () => {
  it("billion laughs and external entities are refused before parsing", () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">&b;</Document>`;
    expect(() => parseCamt053(enc(lol))).toThrow(expect.objectContaining({ code: "unsafe_xml" }));
    const xxe = `<?xml version="1.0"?><!DOCTYPE d SYSTEM "http://example.invalid/x.dtd"><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"/>`;
    expect(() => parseCamt053(enc(xxe))).toThrow(expect.objectContaining({ code: "unsafe_xml" }));
  });

  it("very deep nesting is refused with an IngestError (never a stack overflow), quickly", async () => {
    const depth = 50_000;
    const deep = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">${"<a>".repeat(depth)}${"</a>".repeat(depth)}</Document>`;
    await survives("parseCamt053(deep)", () => parseCamt053(enc(deep)), 5_000);
    expect(() => parseCamt053(enc(deep))).toThrow(IngestError);
  });
});

describe("text readers: encodings and limits", () => {
  it("an unterminated quote over a large file is refused, not hung on", async () => {
    await survives("readDelimited(open quote)", () => readDelimited(enc(`a,b\n"${"x,".repeat(2_000_000)}`)), 5_000);
  });
  it("more rows than the limit are refused", () => {
    expect(() => readDelimited(enc("a\n" + "1\n".repeat(101_500)))).toThrow(expect.objectContaining({ code: "too_many_rows" }));
  });
  it("UTF-16 with a BOM is read; UTF-16 without one, or NUL bytes, is refused as binary", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b\n1,2\n", "utf16le")]);
    expect(readDelimited(new Uint8Array(le)).encoding).toBe("utf-16le");
    expect(() => readDelimited(new Uint8Array(Buffer.from("a,b\n1,2\n", "utf16le")))).toThrow(expect.objectContaining({ code: "binary_file" }));
  });
  it("deeply nested JSON is refused with an IngestError", () => {
    expect(() => readJson(enc("[".repeat(10_000) + "]".repeat(10_000)))).toThrow(expect.objectContaining({ code: "invalid_json" }));
  });
});
