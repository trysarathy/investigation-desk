/**
 * v1 phase 2.1: CSV formula injection is neutralised in every export. Every CSV cell writer in the codebase is run
 * over a corpus of formula payloads (leading spaces, invisible characters, full-width signs, tab/CR prefixes, DDE)
 * and seeded random strings; what a spreadsheet reads back from the cell must never start a formula. A plain decimal
 * amount (optionally negative) may stay a number. All values fictional.
 */
import { describe, expect, it } from "vitest";
import { AMOUNT_TEXT, csvCell, csvValue, formulaSafe, isFormulaLike } from "@/lib/csv/cell";
import { csvCell as merchantCell } from "@/server/merchant-ui";
import { draftCell } from "@/lib/clearline/exports/journal-drafts";
import { ledgerPullCell } from "@/lib/accounting/ledger-pull";
import { csvCell as accountingCell } from "@/lib/clearline/accounting/exports";
import { caseReportCell } from "@/lib/clearline/report";
import { escapeCell } from "@/lib/clearline/merchant-cases/csv";
import { journalCsv, ledgerCsv } from "@/lib/mentor-demo/engine";

const PAYLOADS = [
  "=1+1", "+1+1", "-1+1", "@SUM(A1:A2)", "=cmd|' /C calc'!A0", "=HYPERLINK(\"http://example.invalid\",\"x\")",
  "\t=1", "\r=1", "\n=1", " =1", "   +1", "\u00a0=1", "\u200b=1", "\ufeff@x", "\u2028=1", "＝1+1", "＋1", "－1", "＠x",
  "\u3000=1", "-", "+", "=", "@",
];

/** What a spreadsheet would read from one CSV field: quotes removed and doubled quotes collapsed. */
const fieldValue = (out: string) => (out.startsWith('"') && out.endsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out);

function assertSafe(name: string, input: string, out: string) {
  const v = fieldValue(out);
  if (v.startsWith("'")) return;
  if (AMOUNT_TEXT.test(v)) return; // a plain number, not a formula
  expect(isFormulaLike(v), `${name}(${JSON.stringify(input)}) → ${JSON.stringify(out)}`).toBe(false);
}

const WRITERS: [string, (s: string) => string][] = [
  ["csvCell", (s) => csvCell(s)],
  ["csvValue", (s) => csvValue(s)],
  ["merchant-ui csvCell (evidence pack, access review)", (s) => merchantCell(s)],
  ["draftCell (draft journals, month-end pack)", draftCell],
  ["ledgerPullCell", ledgerPullCell],
  ["accounting exports csvCell", (s) => accountingCell(s)],
  ["caseReportCell", (s) => caseReportCell(s)],
  ["merchant-cases escapeCell", escapeCell],
  ["formulaSafe (then RFC 4180 quoting, as the funding export does)", (s) => `"${formulaSafe(s).replace(/"/g, '""')}"`],
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ALPHABET = ["=", "+", "-", "@", " ", "\t", "\r", "\n", "\u00a0", "\u200b", "＝", "＠", "a", "1", ".", ",", '"', "'", "|", "!", "(", ")"];

describe("CSV formula injection: every export cell writer", () => {
  for (const [name, write] of WRITERS) {
    it(`${name}: the payload corpus and 2,000 seeded random strings never start a formula`, () => {
      for (const p of PAYLOADS) assertSafe(name, p, write(p));
      const r = rng(0xf00 + name.length);
      for (let i = 0; i < 2_000; i++) {
        const s = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join("");
        assertSafe(name, s, write(s));
      }
    });
  }

  it("plain amounts stay numbers where the writer prints amounts", () => {
    expect(csvValue("-12.50")).toBe("-12.50");
    expect(draftCell("-12.50")).toBe("-12.50");
    expect(ledgerPullCell("100.00")).toBe("100.00");
  });

  it("the mentor demo files go through the same rule", () => {
    const demo = {
      asOf: "2026-11-25",
      customers: [{ id: "C1", name: "=Fictional Co", creditLimit: 1, terms: "", active: true }],
      advances: [{ id: "A1", customerId: "C1", supplier: "@Supplier", invoice: "+INV-1", amount: 10, currency: "SGD", due: "2026-12-01", payoutDate: "2026-11-02", stage: "supplier_paid",
        invoicePresent: true, termsOnFile: true, paid: 10, repaid: 0, writtenOff: 0 }],
    } as unknown as Parameters<typeof ledgerCsv>[0];
    for (const csv of [ledgerCsv(demo), journalCsv(demo)]) {
      for (const line of csv.trim().split("\r\n")) for (const f of line.split(",")) assertSafe("mentor", f, f);
    }
  });
});
