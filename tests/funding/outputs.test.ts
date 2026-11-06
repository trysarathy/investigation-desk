import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { columns, importCsv } from "../../src/lib/funding/imports";
import { emptyFunding, type ImportKind } from "../../src/lib/funding/model";
import {
  buildOutputs,
  digest,
  openColumns,
  outputTables,
} from "../../src/lib/funding/outputs";
import {
  assertBalanced,
  journals,
  localDate,
  netsuiteCsv,
  xeroCsv,
  type ExportSettings,
} from "../../src/lib/funding/outputs/journals";
import { workbook, zipStored } from "../../src/lib/funding/outputs/xlsx";
import { applyFundingEvent } from "../../src/lib/funding/review";
import { csvCell } from "../../src/lib/csv/cell";
const at = "2026-11-19T10:00:00Z";
const settings = () =>
  JSON.parse(
    readFileSync("fixtures/funding/export-settings.json", "utf8"),
  ) as ExportSettings;
const load = () =>
  Object.keys(columns).reduce(
    (d, k) =>
      importCsv(
        d,
        k as ImportKind,
        readFileSync(`fixtures/funding/${k}.csv`, "utf8"),
        undefined,
        k,
        at,
      ),
    emptyFunding(),
  );
describe("provider review files", () => {
  it("matches golden CSV, digests, ERP adapters and manifest", () => {
    const files = buildOutputs(load(), at, settings(), true);
    expect(
      Object.fromEntries(
        Object.entries(files).filter(([, body]) => typeof body === "string"),
      ),
    ).toMatchSnapshot();
  });
  it("matches golden worksheet XML and member checksums", () => {
    const { open } = outputTables(load(), at, true);
    const book = workbook(
      openColumns,
      open,
      new Set([
        "outstanding",
        "paid",
        "repaid",
        "written_off",
        "approved_amount",
        "remaining_commitment",
      ]),
    );
    expect(book.members).toMatchSnapshot();
    expect(book.manifest).toMatchSnapshot();
  });
  it("produces identical bytes on repeat export", () => {
    const a = buildOutputs(load(), at, settings(), true),
      b = buildOutputs(load(), at, settings(), true);
    for (const name of Object.keys(a)) expect(a[name]).toEqual(b[name]);
  });
  it("returns a one-line all-clear email and Slack body for no exceptions", () => {
    const result = digest(emptyFunding(), at);
    expect(result.email).toBe("All clear in the supplied records.");
    expect(result.slack).toBe(result.email);
    expect(result.payload.exceptions).toEqual([]);
  });
  it("distinguishes outstanding principal from an undrawn commitment", () => {
    const row = outputTables(load(), at).open[0];
    expect(row.outstanding).toBe("60000");
    expect(row.remaining_commitment).toBe("0");
    expect(openColumns).toContain("remaining_commitment");
  });
  it("only journals applied repayment, never excess", () => {
    const d = load();
    d.receipts[0].amount = "150000";
    const lines = journals(d, at, settings());
    const repayment = lines.filter((l) => l.event_id.startsWith("repayment:"));
    expect(repayment.map((l) => l.credit)).toEqual(["0", "100000"]);
    expect(repayment.map((l) => l.debit)).toEqual(["100000", "0"]);
  });
  it("does not journal an unmatched receipt", () => {
    const d = load();
    d.receipts[0].reference = "unknown";
    expect(journals(d, at, settings())).toHaveLength(2);
  });
  it("writes a named writeoff as expense rather than repayment", () => {
    let d = load();
    const base = {
      at,
      import_count: d.imports.length,
      base_revision: 0,
      actor_id: "treasury",
      advance_id: "advance-1",
      reason: "Reviewed loss",
    };
    d = applyFundingEvent(d, {
      ...base,
      action: "users",
      users: [{ id: "treasury", name: "Treasury", role: "approver" }],
    });
    d = applyFundingEvent(d, {
      ...base,
      action: "write_off",
      amount: "60000",
      users: [],
    });
    const lines = journals(d, at, settings());
    expect(
      lines
        .filter((l) => l.event_id.startsWith("writeoff:"))
        .map((l) => [l.account, l.debit, l.credit]),
    ).toEqual([
      ["6100", "60000", "0"],
      ["1300", "0", "60000"],
    ]);
    assertBalanced(lines);
  });
  it.each(["0.01", "99.99", "999999999999999.99"])(
    "balances exact event amounts %s",
    (value) => {
      const d = load();
      d.payouts[0].amount = value;
      d.receipts = [];
      const lines = journals(d, at, settings());
      expect(lines[0].debit).toBe(value);
      expect(lines[1].credit).toBe(value);
      expect(() => assertBalanced(lines)).not.toThrow();
    },
  );
  it("refuses globally balanced but per-journal unbalanced lines", () => {
    const lines = journals(load(), at, settings());
    lines[0].debit = "100001";
    lines[2].debit = "39999";
    expect(() => assertBalanced(lines)).toThrow(/Each journal/);
  });
  it("uses the mapped accounting timezone at month rollover and accepts UTC", () => {
    expect(localDate("2026-11-30T23:30:00Z", "Asia/Singapore")).toBe(
      "01/12/2026",
    );
    expect(localDate("2026-11-30T23:30:00Z", "UTC")).toBe("30/11/2026");
    expect(() => localDate(at, "Made/Up")).toThrow(/timezone/);
  });
  it("rejects missing accounts and nonboolean confirmations", () => {
    const s = settings();
    delete s.accounts.SGD;
    expect(() => journals(load(), at, s)).toThrow(/Map every account/);
    const bad = settings();
    (bad as unknown as Record<string, unknown>).policy_confirmed = "false";
    expect(() => journals(load(), at, bad)).toThrow(/controller/);
  });
  it("rejects foreign currency ERP files and Xero line overflow", () => {
    const s = settings(),
      lines = journals(load(), at, s);
    lines.forEach((l) => (l.currency = "USD"));
    expect(() => xeroCsv(lines, s)).toThrow(/base currency/);
    expect(() => netsuiteCsv(lines, s)).toThrow(/Foreign-currency/);
    const many = Array.from({ length: 76 }, (_, i) =>
      journals(load(), at, s).map((l) => ({
        ...l,
        journal_id: l.journal_id + i,
      })),
    ).flat();
    expect(() => xeroCsv(many, s)).toThrow(/300/);
  });
  it.each(["=1+1", "\ufeff=1+1", "\u200b@SUM(A1)", "  +SUM(A1)", "＝1+1"])(
    "neutralizes spreadsheet formula prefix %s",
    (value) => {
      expect(csvCell(value)).toBe("'" + value);
      const d = load();
      d.advances[0].invoice_ref = value;
      const table = outputTables(d, at).open;
      const book = workbook(openColumns, table, new Set());
      expect(book.members["xl/worksheets/sheet1.xml"]).not.toContain("<f>");
    },
  );
  it("retains generic files when optional ERP settings are unsupported", () => {
    const s = settings();
    s.xero!.mapping_confirmed = false;
    s.netsuite!.mapping_confirmed = false;
    const files = buildOutputs(load(), at, s);
    expect(files["open-advances.csv"]).toBeTypeOf("string");
    expect(files["journals-generic.csv"]).toBeTypeOf("string");
    expect(files["journals-xero.csv"]).toBeUndefined();
    expect(files["XERO-NOT-CREATED.txt"]).toContain(
      "Generic review files were retained",
    );
  });
  it("escapes Slack mentions and links supplied through imported references", () => {
    const d = load();
    d.receipts[0].id = "<!channel>";
    d.receipts[0].reference = "unknown";
    expect(digest(d, at).slack).toContain("&lt;!channel&gt;");
    expect(digest(d, at).slack).not.toContain("<!channel>");
  });
  it("keeps Xero credit amounts numeric rather than quoted text", () => {
    expect(xeroCsv(journals(load(), at, settings()), settings())).toContain(
      ",No Tax,-100000\r\n",
    );
  });
  it("rejects formula-like account mappings instead of changing account identities", () => {
    const s = settings();
    s.accounts.SGD!.receivable = "=HYPERLINK(1)";
    expect(() => journals(load(), at, s)).toThrow(/valid provider account/);
  });
  it("keeps CSV when XLSX precision is unsafe", () => {
    const d = load();
    d.payouts[0].amount = "999999999999999.99";
    const files = buildOutputs(d, at, settings());
    expect(files["open-advances.csv"]).toContain("999999999999999.99");
    expect(files["open-advances.xlsx"]).toBeUndefined();
    expect(files["XLSX-NOT-CREATED.txt"]).toContain("15-digit");
  });
  it("rejects invalid XML characters and archive traversal", () => {
    expect(() => workbook(["name"], [{ name: "\ufffe" }], new Set())).toThrow(
      /unsupported text/,
    );
    expect(() => zipStored({ "../bad": "x" })).toThrow(/Invalid archive/);
  });
});
