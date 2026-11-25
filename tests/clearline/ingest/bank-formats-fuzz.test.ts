/**
 * Property and fuzz tests for the camt.054 and BAI2 readers, with a seeded generator (deterministic: no Math.random).
 * - Generated valid files always read, and the lines are exactly what was generated.
 * - Any mutation of a valid file either reads or is refused with an IngestError: never another exception.
 * - BAI2 strictness: dropping or duplicating any one record, or changing any transaction amount, is always refused.
 * - XML safety: a DOCTYPE anywhere, or nesting deeper than the limit, is always refused as unsafe_xml.
 * Every value is fictional.
 */
import { describe, expect, it } from "vitest";
import { IngestError, parseBai2, parseCamt054 } from "@/lib/clearline/ingest";
import { MAX_XML_DEPTH } from "@/lib/clearline/ingest/bank/camt";
import { buildBai2, NORMAL, RETURNS, type Bai2File, type Bai2Txn } from "./bai2-builder";

/** mulberry32: a small seeded PRNG, so every run checks the same cases. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  return { next, int, pick };
}
type Rng = ReturnType<typeof rng>;
const SEEDS = Array.from({ length: 60 }, (_, i) => 7 + i * 104729);

/** Either a result or an IngestError; anything else fails the test. */
function readsOrRefuses(f: () => unknown): "read" | string {
  try { f(); return "read"; } catch (e) {
    if (e instanceof IngestError) return e.code;
    throw new Error(`a non-IngestError escaped: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
}

const CREDIT = ["115", "165", "195", "301", "399"];
const DEBIT = ["455", "475", "495", "555", "699"];
const SKIPPED = ["710", "910", "999"];

function randomBai2(r: Rng): { file: Bai2File; expected: { direction: string; amount: bigint; reversal: boolean }[]; skipped: number } {
  const currency = r.pick(["SGD", "USD", "AED", "JPY"]);
  const groups = r.int(1, 3);
  const expected: { direction: string; amount: bigint; reversal: boolean }[] = [];
  let skipped = 0;
  const file: Bai2File = { fileId: `FICT-FUZZ-${r.int(1, 9999)}`, eol: r.pick(["\r\n", "\n"]), groups: [] };
  for (let g = 0; g < groups; g++) {
    const txns: Bai2Txn[] = [];
    let balance = BigInt(r.int(-50000, 500000));
    const opening = balance;
    for (let k = r.int(0, 15); k > 0; k--) {
      const kind = r.next();
      const code = kind < 0.45 ? r.pick(CREDIT) : kind < 0.9 ? r.pick(DEBIT) : r.pick(SKIPPED);
      const amount = BigInt(r.int(0, 10_000_000));
      const t: Bai2Txn = { code, amount, bankRef: `FICTB${r.int(1, 99999)}`, customerRef: r.next() < 0.5 ? `INV-${r.int(1, 9999)}` : "", text: r.next() < 0.7 ? `FICTIONAL TEXT ${r.int(1, 999)}, WITH COMMA` : "" };
      if (r.next() < 0.2) t.funds = ["V", "261121", ""];
      if (r.next() < 0.2) t.funds = ["S", String(r.int(0, 100)), "", ""];
      if (r.next() < 0.1) t.funds = ["D", "2", "1", String(r.int(0, 100)), "2", String(r.int(0, 100))];
      if (r.next() < 0.2) t.continuation = [`CONTINUED ${r.int(1, 99)}`];
      txns.push(t);
      if (SKIPPED.includes(code)) { skipped++; continue; }
      const credit = CREDIT.includes(code);
      balance += credit ? amount : -amount;
      expected.push({ direction: credit ? "credit" : "debit", amount, reversal: code === "555" });
    }
    file.groups.push({ asOf: `2611${String(10 + g).padStart(2, "0")}`, currency, accounts: [{ account: "FICT00004321", status: [["010", opening], ["015", balance]], txns }] });
  }
  return { file, expected, skipped };
}

describe("BAI2 properties (60 seeds)", () => {
  it("a generated valid file always reads, and its lines are exactly the generated transactions", () => {
    for (const seed of SEEDS) {
      const { file, expected, skipped } = randomBai2(rng(seed));
      const res = parseBai2(buildBai2(file));
      expect(res.lines.map((l) => ({ direction: l.direction, amount: l.amountMinor, reversal: l.reversal === true }))).toEqual(expected);
      expect(res.skipped).toHaveLength(skipped);
      expect(res.statements.every((s) => s.balanced === true)).toBe(true);
      expect(new Set(res.lines.map((l) => l.lineId)).size).toBe(res.lines.length);
    }
  });

  it("dropping or duplicating any single record of a valid file is always refused", () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const { file } = randomBai2(rng(seed));
      const eol = file.eol!;
      const recs = buildBai2(file).split(eol).filter((l) => l !== "");
      for (let i = 0; i < recs.length; i++) {
        const dropped = [...recs.slice(0, i), ...recs.slice(i + 1)].join(eol) + eol;
        const doubled = [...recs.slice(0, i + 1), ...recs.slice(i)].join(eol) + eol;
        expect(readsOrRefuses(() => parseBai2(dropped)), `seed ${seed} drop ${i}`).not.toBe("read");
        expect(readsOrRefuses(() => parseBai2(doubled)), `seed ${seed} double ${i}`).not.toBe("read");
      }
    }
  });

  it("changing any transaction amount by one unit is always refused (control totals)", () => {
    for (const base of [NORMAL, RETURNS]) {
      const recs = buildBai2(base).split("\r\n");
      recs.forEach((l, i) => {
        if (!l.startsWith("16,")) return;
        const f = l.split(",");
        f[2] = (BigInt(f[2]) + 1n).toString();
        const changed = [...recs.slice(0, i), f.join(","), ...recs.slice(i + 1)].join("\r\n");
        expect(readsOrRefuses(() => parseBai2(changed))).toBe("invalid_bai2");
      });
    }
  });

  it("random character mutations: an IngestError or, if the file still reads, the same money or a flagged balance (2,000 mutants)", () => {
    const base = buildBai2(NORMAL);
    const money = (res: ReturnType<typeof parseBai2>) => res.lines.map((l) => `${l.direction}:${l.amountMinor}`).join("|");
    const original = money(parseBai2(base));
    const alphabet = "0123456789,/+-.ABCZV \r\n8";
    for (let k = 0; k < 2000; k++) {
      const r = rng(1 + k * 31);
      let s = base;
      for (let m = r.int(1, 3); m > 0; m--) {
        const at = r.int(0, s.length - 1);
        const op = r.int(0, 2);
        const ch = alphabet[r.int(0, alphabet.length - 1)];
        s = op === 0 ? s.slice(0, at) + ch + s.slice(at + 1) : op === 1 ? s.slice(0, at) + s.slice(at + 1) : s.slice(0, at) + ch + s.slice(at);
      }
      if (readsOrRefuses(() => parseBai2(s)) !== "read") continue;
      // Amounts and counts are checksummed; a type code is not (BAI2's own design), but the ledger balance check flags it.
      const res = parseBai2(s);
      if (money(res) !== original) expect(res.statements.some((x) => x.balanced !== true) || res.skipped.length > 0, `mutant ${k}`).toBe(true);
    }
  });
});

const NTFCTN = (entries: string, account = "XX00FICT00004321") => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>FICT-FUZZ</MsgId></GrpHdr>
<Ntfctn><Id>FICT-N</Id><Acct><Id><IBAN>${account}</IBAN></Id><Ccy>SGD</Ccy></Acct>${entries}</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

function randomCamt054(r: Rng): { xml: string; expected: { direction: string; amount: bigint; reversal: boolean }[]; skipped: number } {
  const expected: { direction: string; amount: bigint; reversal: boolean }[] = [];
  let skipped = 0;
  let entries = "";
  for (let k = r.int(0, 25); k > 0; k--) {
    const minor = BigInt(r.int(0, 100_000_000));
    const amount = `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
    const credit = r.next() < 0.5;
    const status = r.next() < 0.85 ? "BOOK" : r.pick(["PDNG", "INFO"]);
    const reversal = r.next() < 0.15;
    entries += `<Ntry><Amt Ccy="SGD">${amount}</Amt><CdtDbtInd>${credit ? "CRDT" : "DBIT"}</CdtDbtInd>${reversal ? "<RvslInd>true</RvslInd>" : ""}<Sts><Cd>${status}</Cd></Sts>`
      + `<ValDt><Dt>2026-11-${String(r.int(1, 30)).padStart(2, "0")}</Dt></ValDt><AcctSvcrRef>FICT-${r.int(1, 99999)}</AcctSvcrRef>`
      + `<NtryDtls><TxDtls><RmtInf><Ustrd>FICTIONAL &amp; TEXT ${r.int(1, 999)}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
    if (status !== "BOOK") { skipped++; continue; }
    expected.push({ direction: credit ? "credit" : "debit", amount: minor, reversal });
  }
  return { xml: NTFCTN(entries), expected, skipped };
}

describe("camt.054 properties (60 seeds)", () => {
  it("a generated notification always reads, and its lines are exactly the booked entries", () => {
    for (const seed of SEEDS) {
      const { xml, expected, skipped } = randomCamt054(rng(seed));
      const res = parseCamt054(xml);
      expect(res.lines.map((l) => ({ direction: l.direction, amount: l.amountMinor, reversal: l.reversal === true }))).toEqual(expected);
      expect(res.skipped).toHaveLength(skipped);
      expect(res.lines.every((l) => l.narrative?.includes("FICTIONAL & TEXT"))).toBe(true);
    }
  });

  it("a DOCTYPE inserted anywhere outside the root is always refused as unsafe_xml", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const r = rng(seed);
      const { xml } = randomCamt054(r);
      const at = r.int(0, xml.indexOf("<Document"));
      const bad = xml.slice(0, at) + `<!DOCTYPE d [<!ENTITY e "${"x".repeat(r.int(1, 9))}">]>` + xml.slice(at);
      expect(readsOrRefuses(() => parseCamt054(bad))).toBe("unsafe_xml");
    }
  });

  it("nesting one level past the limit is refused; at the limit it is not refused for depth", () => {
    const wrap = (n: number) => NTFCTN(`<Ntry><AddtlNtryInf>${"<X>".repeat(n)}${"</X>".repeat(n)}</AddtlNtryInf></Ntry>`);
    // Document > BkToCstmrDbtCdtNtfctn > Ntfctn > Ntry > AddtlNtryInf is 5 levels.
    expect(readsOrRefuses(() => parseCamt054(wrap(MAX_XML_DEPTH - 5 + 1)))).toBe("unsafe_xml");
    expect(readsOrRefuses(() => parseCamt054(wrap(MAX_XML_DEPTH - 5)))).not.toBe("unsafe_xml");
  });

  it("random character mutations never throw anything but an IngestError (1,500 mutants)", () => {
    const { xml } = randomCamt054(rng(42));
    const alphabet = "<>/&;\"'=!?DOCTYPE01.-CRDTBOOK ";
    for (let k = 0; k < 1500; k++) {
      const r = rng(9 + k * 17);
      let s = xml;
      for (let m = r.int(1, 4); m > 0; m--) {
        const at = r.int(0, s.length - 1);
        const ch = alphabet[r.int(0, alphabet.length - 1)];
        const op = r.int(0, 2);
        s = op === 0 ? s.slice(0, at) + ch + s.slice(at + 1) : op === 1 ? s.slice(0, at) + s.slice(at + 1) : s.slice(0, at) + ch + s.slice(at);
      }
      readsOrRefuses(() => parseCamt054(s));
    }
  });
});
