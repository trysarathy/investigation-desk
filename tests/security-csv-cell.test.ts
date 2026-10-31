// SECURITY BUG (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27):
// `csvCell` (`src/lib/csv/cell.ts`, the one writer for the reconciled and bulk exports) neutralises
// only ASCII = + - @ TAB CR at the start of a cell. OWASP's CSV Injection page also lists the
// full-width forms ＝ ＋ － ＠ and warns that a separator such as ';' can start a new cell in
// locales/apps that split on it. A leading zero-width space or BOM hides an ASCII '=' from the
// check too. Values reach exports from imported files and customer references, so an attacker who
// can get text into an import controls the first character of an exported cell.
//
// Manual reproduction:
//   sed 's/it\.fails(/it(/' tests/security-csv-cell.test.ts > tests/tmp-csv.test.ts && npx vitest run tests/tmp-csv.test.ts
//   # 8 failures, each printing csvCell's output unchanged and unquoted (e.g. "＝1+1"); then rm tests/tmp-csv.test.ts
//   In the app (live mode): import a payment file whose reference starts with ＝, export
//   /api/payments/export.csv?actor=QA and open it in a spreadsheet.
//
// SECURITY BUG: remove .fails when fixed. (The ASCII cases are covered and pass in inbox-review.test.ts and bulk.test.ts.)

import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv/cell";

/** What a safe cell looks like: text, never something a spreadsheet would evaluate. */
const neutralised = (out: string) => out.startsWith("'") || out.startsWith("\"'");

describe("security: CSV injection beyond ASCII = + - @", () => {
  for (const [name, v] of [
    ["full-width equals ＝", "＝1+1"],
    ["full-width plus ＋", "＋1+1"],
    ["full-width minus －", "－1+1"],
    ["full-width at ＠", "＠SUM(A1:A9)"],
    ["zero-width space then =", "​=1+1"],
    ["BOM / zero-width no-break space then =", "﻿=1+1"],
    ["leading semicolon", ";=1+1"],
  ] as const) {
    // SECURITY BUG: remove .fails when fixed
    it.fails(`${name} is neutralised`, () => {
      expect(neutralised(csvCell(v)), `csvCell(${JSON.stringify(v)}) = ${JSON.stringify(csvCell(v))}`).toBe(true);
    });
  }

  // SECURITY BUG: remove .fails when fixed
  it.fails("a cell containing ';' is quoted, so a ';'-splitting spreadsheet can't start a new cell with '=1+1'", () => {
    expect(csvCell("a;=1+1")).toBe("\"a;=1+1\"");
  });
});
