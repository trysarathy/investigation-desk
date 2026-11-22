import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { closeOwner, ownerDb, principal, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { can } from "../../src/server/authz";
import { listPayments, paymentDetail } from "../../src/server/control";
import { REDWOOD_REFERENCE } from "../../src/server/seed";
import { RequestRefused } from "../../src/server/errors";
import {
  decideStatementImport, evidenceProvenance, importErrorReport, importErrorReportCsv, importStatementCsv, listImports, MAX_FILE_BYTES, MAX_ROWS,
  parseStatementCsv, STATEMENT_COLUMNS, type ImportAccepted, type ImportRejected,
} from "../../src/server/imports";

const FIX = path.join(__dirname, "fixtures", "statements");
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIX, name)));
const enc = (s: string) => new TextEncoder().encode(s);
const HEADER = STATEMENT_COLUMNS.join(",");
const row = (o: Partial<Record<(typeof STATEMENT_COLUMNS)[number], string>> = {}) => {
  const d = { line_id: "SIMBANK-T-0001", account_ref: "SIMBANK-SGD-OPS (fictional)", value_date: "2026-11-13", direction: "credit", kind: "payment", amount: "10.00", currency: "SGD", reference: "INV-FICT-T", counterparty: "Test Payer (fictional)", ...o };
  return STATEMENT_COLUMNS.map((c) => d[c]).join(",");
};
const csv = (...rows: string[]) => enc([HEADER, ...rows].join("\n") + "\n");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function codes(r: ReturnType<typeof parseStatementCsv>) {
  if (r.ok) throw new Error("expected the parser to refuse the file");
  return r.errors.map((e) => `${e.column ?? "-"}:${e.code}`);
}

let ids: Record<string, string>;
const ctx = (email: string, org = email.endsWith("harbour.example") ? "harbour-demo" : "lumen-demo") => resolveTenant(principal(ids, email), org);
let k = 0;
const key = () => `imp-key-${++k}-${Date.now()}`;

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return e; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return e; }
    if (e instanceof ZodError) { expect("INVALID_REQUEST").toMatch(code); return e; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

/** Upload (staged, nothing ingested) and then confirm as a DIFFERENT person: an approver of the same organisation. */
async function importConfirmed(fin: TenantContext, input: { fileName: string; bytes: Uint8Array }, k1: string) {
  const r = await importStatementCsv(fin, input, k1);
  if (r.status !== 201) return r;
  const b = r.body as ImportAccepted;
  expect(b.status).toBe("pending_confirmation");
  const appr = await ctx(fin.orgSlug === "harbour-demo" ? "approver@harbour.example" : "approver@lumen.example", fin.orgSlug);
  const d = await decideStatementImport(appr, b.importId, { decision: "confirm", reason: "Checked the file against the statement (fictional)", fileSha256: b.fileSha256, linesSha256: b.linesSha256 }, key());
  return { ...r, body: { ...b, status: "imported", acceptedCount: (d.body as { acceptedCount: number }).acceptedCount } as unknown as ImportAccepted };
}

async function ownerRows(q: ReturnType<typeof sql>) { return (await ownerDb().execute(q)).rows as Record<string, unknown>[]; }
async function auditFor(orgId: string, action: string) {
  return ownerRows(sql`select actor_user_id, entity_id, summary, details from audit_events where org_id = ${orgId} and action = ${action} order by seq`);
}
async function countLines(orgId: string) {
  return Number((await ownerRows(sql`select count(*)::int as n from settlement_evidence where org_id = ${orgId} and kind = 'statement_line'`))[0].n);
}

// ---------------------------------------------------------------------------------------------
// Pure parser (no database)
// ---------------------------------------------------------------------------------------------

describe("parseStatementCsv: format and schema", () => {
  it("parses the valid fixture into exact integer minor units, source bank_statement, raw text kept", () => {
    const r = parseStatementCsv(fixture("valid-small.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rowCount).toBe(3);
    expect(r.rows.map((x) => [x.row, x.line.lineId, x.line.amountMinor, x.line.currency, x.line.source])).toEqual([
      [2, "SIMBANK-CSV-1001", 125_000, "SGD", "bank_statement"],
      [3, "SIMBANK-CSV-1002", 31_025, "USD", "bank_statement"],
      [4, "SIMBANK-CSV-1003", 9_990, "EUR", "bank_statement"],
    ]);
    expect(r.rows[2].line.reference).toBe("");
    expect(r.rows[2].line.counterparty).toBe("Brightwater Studio, Ltd (fictional)");
    expect(Object.keys(r.rows[0].line).sort()).toEqual(["accountRef", "amountMinor", "counterparty", "currency", "direction", "kind", "lineId", "reference", "source", "valueDate"]);
  });

  it("accepts the columns in any order (references-redwood has reference first) and a UTF-8 BOM", () => {
    const r = parseStatementCsv(fixture("references-redwood.csv"));
    expect(r.ok && r.rows[0].line.reference).toContain("NLPO-7AF439CFB9");
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...csv(row())]);
    expect(parseStatementCsv(bom).ok).toBe(true);
  });

  it("USDC takes 6 decimals; amounts are exact with no float rounding, up to the engine's limit", () => {
    const r = parseStatementCsv(csv(row({ currency: "USDC", amount: "6427.830001" }), row({ line_id: "SIMBANK-T-2", amount: "9999999999999.99", currency: "USD" }), row({ line_id: "SIMBANK-T-3", amount: "0.07" })));
    expect(r.ok && r.rows.map((x) => x.line.amountMinor)).toEqual([6_427_830_001, 999_999_999_999_999, 7]);
    expect(codes(parseStatementCsv(csv(row({ amount: "99999999999999.99", currency: "USD" }))))).toEqual(["amount:invalid_amount"]);
  });

  it("refuses a missing column (fixture), an extra column and a duplicate column", () => {
    expect(codes(parseStatementCsv(fixture("missing-column.csv")))).toEqual(["counterparty:missing_column"]);
    expect(codes(parseStatementCsv(enc(`${HEADER},verified\n${row()},yes\n`)))).toEqual(["verified:unknown_column"]);
    expect(codes(parseStatementCsv(enc(`${HEADER},line_id\n${row()},X\n`)))).toEqual(["line_id:duplicate_column"]);
  });

  it("no column can claim provenance, verification or bank authentication", () => {
    for (const c of ["provenance", "verified", "bank_authenticated", "source", "status", "import_id", "receivedAt", "Line_ID", " line_id"]) {
      const r = parseStatementCsv(enc(`${HEADER},${c}\n${row()},x\n`));
      expect(r.ok, c).toBe(false);
      expect(codes(r).some((x) => x.endsWith(":unknown_column")), c).toBe(true);
    }
  });

  it("refuses every malformed amount in the fixture (negative, too many decimals, exponent, empty, comma) and imports none of the rows", () => {
    const r = parseStatementCsv(fixture("malformed-amount.csv"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [3, "amount", "invalid_amount"], [4, "amount", "invalid_amount"], [5, "amount", "invalid_amount"], [6, "amount", "missing_value"], [7, "amount", "invalid_amount"],
    ]);
    expect(r.errors[1].message).toMatch(/at most 2 decimal/);
    expect(r).not.toHaveProperty("rows");
  });

  it.each([["0.00"], ["+5.00"], [" 5.00"], ["5.00 "], ["5."], [".5"], ["0x10"], ["1_000"], ["NaN"], ["Infinity"], ["１２"], ["5,00"], ["10000000000000000"]])("refuses amount %j", (amount) => {
    expect(codes(parseStatementCsv(csv(row({ amount: amount.includes(",") ? `"${amount}"` : amount }))))).toEqual(["amount:invalid_amount"]);
  });

  it("refuses invalid currencies, impossible dates and unknown direction or kind", () => {
    expect(codes(parseStatementCsv(csv(row({ currency: "sgd" }))))).toEqual(["currency:invalid_currency"]);
    expect(codes(parseStatementCsv(csv(row({ currency: "BTC" }))))).toEqual(["currency:invalid_currency"]);
    for (const d of ["2026-02-30", "2026-13-01", "2026-2-03", "26-11-13", "2026-11-13T00:00", "2025-02-29"]) expect(codes(parseStatementCsv(csv(row({ value_date: d })))), d).toEqual(["value_date:invalid_date"]);
    expect(parseStatementCsv(csv(row({ value_date: "2028-02-29" }))).ok).toBe(true);
    expect(codes(parseStatementCsv(csv(row({ direction: "DEBIT" }))))).toEqual(["direction:unknown_direction"]);
    expect(codes(parseStatementCsv(csv(row({ kind: "fee" }))))).toEqual(["kind:unknown_kind"]);
    expect(codes(parseStatementCsv(csv(row({ direction: "" }))))).toEqual(["direction:missing_value"]);
  });

  it("enforces per-field length and character limits", () => {
    expect(codes(parseStatementCsv(csv(row({ line_id: "L".repeat(65) }))))).toEqual(["line_id:too_long"]);
    expect(codes(parseStatementCsv(csv(row({ line_id: "bad id!" }))))).toEqual(["line_id:invalid_format"]);
    expect(codes(parseStatementCsv(csv(row({ account_ref: "A".repeat(65) }))))).toEqual(["account_ref:too_long"]);
    expect(codes(parseStatementCsv(csv(row({ account_ref: "X" }))))).toEqual(["account_ref:invalid_format"]);
    expect(codes(parseStatementCsv(csv(row({ reference: "R".repeat(141) }))))).toEqual(["reference:too_long"]);
    expect(codes(parseStatementCsv(csv(row({ counterparty: "C".repeat(121) }))))).toEqual(["counterparty:too_long"]);
    expect(codes(parseStatementCsv(csv(row({ reference: "<script>x</script>" }))))).toEqual(["reference:forbidden_character"]);
    expect(codes(parseStatementCsv(csv(row({ counterparty: '"two\nlines"' }))))).toEqual(["counterparty:forbidden_character"]);
    expect(codes(parseStatementCsv(csv(row({ reference: "bell\u0007" }))))).toEqual(["reference:forbidden_character"]);
    expect(codes(parseStatementCsv(csv(row({ amount: "1".repeat(33) }))))).toEqual(["amount:too_long"]);
    expect(parseStatementCsv(csv(row({ reference: "R".repeat(140), counterparty: "C".repeat(120), line_id: "L".repeat(64) }))).ok).toBe(true);
  });

  it("refuses duplicate (account_ref, line_id) within a file, and wrong column counts", () => {
    const r = parseStatementCsv(csv(row(), row({ amount: "11.00" })));
    expect(r.ok === false && r.errors.map((e) => [e.row, e.column, e.code])).toEqual([[3, "line_id", "duplicate_line_id"]]);
    expect(parseStatementCsv(csv(row(), row({ account_ref: "SIMBANK-USD-OPS (fictional)" }))).ok).toBe(true);
    expect(codes(parseStatementCsv(csv(row() + ",extra")))).toEqual(["-:wrong_column_count"]);
    expect(codes(parseStatementCsv(csv("a,b")))).toEqual(["-:wrong_column_count"]);
    expect(codes(parseStatementCsv(csv(row({ reference: 'IN"V' }))))).toEqual(["-:malformed_row"]);
  });

  it("reports every error with row number, column, code and message", () => {
    const r = parseStatementCsv(csv(row({ amount: "-1" }), row({ line_id: "SIMBANK-T-2", currency: "XXX", kind: "x" })));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCount).toBe(3);
    for (const e of r.errors) {
      expect(typeof e.row).toBe("number");
      expect(e.column).toBeTruthy();
      expect(e.code).toBeTruthy();
      expect(e.message.length).toBeGreaterThan(5);
    }
  });
});

describe("parseStatementCsv: bounded and hostile input", () => {
  it("enforces the 1 MiB size limit before decoding", () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0xff); // invalid UTF-8 too: the size check must come first
    expect(codes(parseStatementCsv(big))).toEqual(["-:file_too_large"]);
    expect(codes(parseStatementCsv(new Uint8Array(0)))).toEqual(["-:file_empty"]);
    expect(codes(parseStatementCsv(csv(row()), { maxBytes: 10 }))).toEqual(["-:file_too_large"]);
  });

  it("an options object cannot raise the limits", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => row({ line_id: `SIMBANK-R-${i}` }));
    expect(codes(parseStatementCsv(csv(...rows), { maxRows: 1_000_000 }))).toEqual(["-:too_many_rows"]);
  });

  it("accepts exactly MAX_ROWS (200) rows and refuses one more", () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => row({ line_id: `SIMBANK-R-${i}` }));
    const ok = parseStatementCsv(csv(...rows));
    expect(ok.ok && ok.rows.length).toBe(MAX_ROWS);
    expect(codes(parseStatementCsv(csv(...rows, row({ line_id: "SIMBANK-R-X" }))))).toEqual(["-:too_many_rows"]);
  });

  it("refuses NUL bytes and invalid UTF-8", () => {
    expect(codes(parseStatementCsv(enc(`${HEADER}\n${row({ reference: "A\u0000B" })}\n`)))).toEqual(["-:nul_byte"]);
    const bad = new Uint8Array([...enc(`${HEADER}\n`), ...enc(row({ reference: "X" })).slice(0, -5), 0xc3, 0x28, ...enc("\n")]);
    expect(codes(parseStatementCsv(bad))).toEqual(["-:invalid_utf8"]);
    expect(codes(parseStatementCsv(new Uint8Array([0xed, 0xa0, 0x80])))).toEqual(["-:invalid_utf8"]); // lone surrogate
  });

  it("refuses an unterminated quote, an empty file and a header-only file", () => {
    expect(codes(parseStatementCsv(enc(`${HEADER}\nSIMBANK-1,"unterminated\n`)))).toEqual(["-:unreadable_csv"]);
    expect(codes(parseStatementCsv(enc("   \n")))).toEqual(["-:unreadable_csv"]);
    expect(codes(parseStatementCsv(enc(`${HEADER}\n`)))).toEqual(["-:no_rows"]);
  });

  it("stays fast on adversarial input near the size limit (no catastrophic backtracking)", () => {
    const longCell = "9".repeat(MAX_FILE_BYTES - HEADER.length - 200);
    const t0 = Date.now();
    expect(codes(parseStatementCsv(enc(`${HEADER}\n${row({ amount: longCell })}\n`)))).toEqual(["amount:too_long"]);
    const quotes = `${HEADER}\n"${'""'.repeat((MAX_FILE_BYTES - HEADER.length - 10) / 2)}"\n`;
    parseStatementCsv(enc(quotes));
    const commas = `${HEADER}\n${",".repeat(MAX_FILE_BYTES - HEADER.length - 5)}\n`;
    expect(codes(parseStatementCsv(enc(commas)))).toEqual(["-:wrong_column_count"]);
    const refs = Array.from({ length: 4000 }, (_, i) => row({ line_id: `SIMBANK-A-${i}`, account_ref: "(".repeat(60) + "!!", reference: "a".repeat(100) }));
    parseStatementCsv(csv(...refs));
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("formula-looking cells are kept as raw text (never evaluated) and the file is still valid", () => {
    const r = parseStatementCsv(fixture("formula-injection.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].line.reference).toBe('=HYPERLINK("https://example.invalid/fictional","Click for refund")');
    expect(r.rows[0].line.counterparty).toBe('=HYPERLINK("https://example.invalid/fictional","Kestrel Foods")');
    expect(r.rows[1].line.reference).toBe("+SUM(1+1)");
    expect(r.rows[1].line.counterparty).toBe("@SUM(A1:A2)");
    expect(r.rows[2].line.reference).toBe("-2+3+cmd|calc");
    expect(r.rows[2].line.counterparty).toBe("\ttab-led counterparty (fictional)");
  });

  it("the import error report prefixes = + - @ TAB CR cells with ' (formula injection)", () => {
    const report = importErrorReportCsv([
      { row: 2, column: "line_id", code: "invalid_format", message: "x", value: '=HYPERLINK("https://example.invalid","x")' },
      { row: 3, column: "reference", code: "forbidden_character", message: "=1+1", value: "+SUM(1)" },
      { row: 4, column: "counterparty", code: "too_long", message: "m", value: "@cmd" },
      { row: 5, column: "amount", code: "invalid_amount", message: "m", value: "-1" },
      { row: 6, column: "reference", code: "x", message: "m", value: "\t=1" },
      { row: 7, column: "reference", code: "x", message: "m", value: "\r=1" },
      { row: 8, column: "reference", code: "x", message: "m", value: " =1" },
    ]);
    const lines = report.split("\r\n");
    expect(lines[0]).toBe("row,column,code,message,value");
    expect(lines[1]).toContain(`"'=HYPERLINK(""https://example.invalid"",""x"")"`);
    expect(lines[2]).toContain("'=1+1");
    expect(lines[2]).toContain("'+SUM(1)");
    expect(lines[3]).toContain("'@cmd");
    expect(lines[4]).toContain("'-1");
    expect(lines[5]).toContain("'\t=1");
    expect(report).toContain("'\r=1");
    expect(report).toContain("' =1");
    // no cell in the report starts with a formula trigger
    for (const l of lines.slice(1).filter(Boolean)) for (const cell of l.split(",")) expect(cell.replace(/^"/, "")).not.toMatch(/^[=+\-@\t]/);
  });
});

// ---------------------------------------------------------------------------------------------
// Database-backed (real PostgreSQL 16, RLS, runtime role)
// ---------------------------------------------------------------------------------------------

describe("importStatementCsv against PostgreSQL", () => {
  let finance: TenantContext;
  let lumen: string;
  let harbour: string;

  beforeAll(async () => {
    ids = await resetAndSeed();
    finance = await ctx("finance@lumen.example");
    lumen = finance.orgId;
    harbour = (await ctx("ops@harbour.example")).orgId;
  });
  afterAll(async () => { await closeDatabase(); await closeOwner(); });

  it("authorization: only Finance may import; viewer, payment_ops, approver and admin are refused and nothing is written", async () => {
    expect(can("finance", "import_statement")).toBe(true);
    for (const r of ["payment_ops", "viewer", "approver", "admin"] as const) expect(can(r, "import_statement"), r).toBe(false);
    for (const who of ["viewer@lumen.example", "ops@lumen.example", "approver@lumen.example", "admin@lumen.example", "ops@harbour.example"]) {
      await refused(importStatementCsv(await ctx(who), { fileName: "valid-small.csv", bytes: fixture("valid-small.csv") }, key()), "ACCESS_403");
    }
    expect(Number((await ownerRows(sql`select count(*)::int as n from statement_imports`))[0].n)).toBe(0);
  });

  it("authentication: a principal who is not a member cannot obtain a context to import with", async () => {
    await refused(resolveTenant({ userId: "usr_not_a_member", name: "x", email: "x@nowhere.example" }, "lumen-demo"), "ACCESS_403");
    await refused(resolveTenant(principal(ids, "finance@lumen.example"), "harbour-demo"), "ACCESS_404");
  });

  it("imports the valid file in ctx.orgId only, with provenance csv_import and the import id, and audits it", async () => {
    const before = await countLines(lumen);
    const harbourBefore = await countLines(harbour);
    const bytes = fixture("valid-small.csv");
    const r = await importConfirmed(finance, { fileName: "valid-small.csv", bytes }, key());
    expect(r.status).toBe(201);
    const body = r.body as ImportAccepted;
    expect(body).toMatchObject({ status: "imported", rowCount: 3, acceptedCount: 3, fileSha256: sha(bytes), sizeBytes: bytes.byteLength });
    expect(await countLines(lumen)).toBe(before + 3);
    expect(await countLines(harbour)).toBe(harbourBefore);
    const rows = await ownerRows(sql`select org_id, provenance, import_id, record from settlement_evidence where import_id = ${body.importId}`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const x of rows) { expect(x.org_id).toBe(lumen); expect(x.provenance).toBe("csv_import"); }
    const stl = rows.filter((x) => (x.record as { source?: string }).source === "bank_statement");
    expect(stl.map((x) => (x.record as { lineId: string }).lineId).sort()).toEqual(["SIMBANK-CSV-1001", "SIMBANK-CSV-1002", "SIMBANK-CSV-1003"]);
    const [imp] = await ownerRows(sql`select * from statement_imports where id = ${body.importId}`);
    expect(imp).toMatchObject({ org_id: lumen, status: "imported", file_sha256: sha(bytes), row_count: 3, accepted_count: 3, rejected_count: 0, imported_by: finance.userId });
    // staged by the importer, accepted by a different person (the approver), both recorded
    const [s] = await auditFor(lumen, "statement_import_staged");
    expect(s.actor_user_id).toBe(finance.userId);
    expect(s.details).toMatchObject({ fileSha256: sha(bytes), rowCount: 3, stagedCount: 3, actor: finance.userId });
    const [a] = await auditFor(lumen, "statement_import_accepted");
    expect(a.actor_user_id).toBe(ids["approver@lumen.example"]);
    expect(a.details).toMatchObject({ fileSha256: sha(bytes), acceptedCount: 3, importedBy: finance.userId, confirmedBy: ids["approver@lumen.example"] });
    expect(imp.confirmed_by).toBe(ids["approver@lumen.example"]);
  });

  it("tenant isolation: another organisation cannot list or read the imports, even with this org forced into the context", async () => {
    const mine = await listImports(finance);
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ status: "imported", importedBy: finance.userId });
    expect(await listImports(await ctx("ops@harbour.example"))).toEqual([]);
    const opsB = await ctx("ops@harbour.example");
    const n = await withTenant({ userId: opsB.userId, orgId: lumen }, async (tx) => (await tx.execute(sql`select count(*)::int as n from statement_imports`)).rows[0].n);
    expect(n).toBe(0);
    await refused(importErrorReport(opsB, mine[0].id), "ACCESS_404");
    expect((await listImports(await ctx("viewer@lumen.example"))).length).toBe(1); // read is for every Lumen role
  });

  it("refuses the same file again with 409 (same SHA-256, same org), audits the duplicate, and writes nothing else", async () => {
    const before = await countLines(lumen);
    const bytes = fixture("valid-small.csv");
    await refused(importStatementCsv(finance, { fileName: "renamed.csv", bytes }, key()), "DUPLICATE_FILE");
    const e = await importStatementCsv(finance, { fileName: "renamed.csv", bytes }, key()).catch((x) => x);
    expect(e).toBeInstanceOf(RequestRefused);
    expect((e as RequestRefused).status).toBe(409);
    expect(await countLines(lumen)).toBe(before);
    const dups = await auditFor(lumen, "statement_import_duplicate");
    expect(dups.length).toBe(2);
    expect(dups[0].details).toMatchObject({ fileSha256: sha(bytes), actor: finance.userId });
    expect((await listImports(finance)).length).toBe(1);
  });

  it("a different organisation may upload a file with the same bytes (sha is unique per org, not global)", async () => {
    // Harbour has no finance member in the seed; grant one for this check
    const { createUser, grantMembership } = await import("../../src/server/admin");
    ids["finance@harbour.example"] = await createUser(ownerDb(), { email: "finance@harbour.example", name: "finance (fictional)", password: "fictional-test-pass-01" });
    await grantMembership(ownerDb(), { orgSlug: "harbour-demo", email: "finance@harbour.example", role: "finance" });
    const fin = await ctx("finance@harbour.example", "harbour-demo");
    const r = await importConfirmed(fin, { fileName: "valid-small.csv", bytes: fixture("valid-small.csv") }, key());
    expect(r.status).toBe(201);
    const rows = await ownerRows(sql`select distinct org_id from settlement_evidence where import_id = ${(r.body as ImportAccepted).importId}`);
    expect(rows.map((x) => x.org_id)).toEqual([harbour]);
  });

  it("idempotency: the same key replays the stored response; the same key with a different file is refused", async () => {
    const bytes = csv(row({ line_id: "SIMBANK-IDEM-1" }));
    const kk = key();
    const a = await importStatementCsv(finance, { fileName: "idem.csv", bytes }, kk);
    const b = await importStatementCsv(finance, { fileName: "idem.csv", bytes }, kk);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    await refused(importStatementCsv(finance, { fileName: "idem.csv", bytes: csv(row({ line_id: "SIMBANK-IDEM-2" })) }, kk), "IDEMPOTENCY_KEY_REUSED");
    await refused(importStatementCsv(finance, { fileName: "idem.csv", bytes }, "short"), "INVALID_REQUEST");
  });

  it("all-or-nothing: the malformed-amount file imports NOTHING (not even its valid row), records a rejected import with per-row errors, and audits it", async () => {
    const before = await countLines(lumen);
    const bytes = fixture("malformed-amount.csv");
    const r = await importStatementCsv(finance, { fileName: "malformed-amount.csv", bytes }, key());
    expect(r.status).toBe(422);
    const body = r.body as ImportRejected;
    expect(body.status).toBe("rejected");
    expect(body.rowCount).toBe(6);
    expect(body.rejectedCount).toBe(5);
    expect(body.errors.map((e) => [e.row, e.column, e.code])).toEqual([[3, "amount", "invalid_amount"], [4, "amount", "invalid_amount"], [5, "amount", "invalid_amount"], [6, "amount", "missing_value"], [7, "amount", "invalid_amount"]]);
    expect(await countLines(lumen)).toBe(before);
    expect((await ownerRows(sql`select count(*)::int as n from settlement_evidence where record->>'lineId' = 'SIMBANK-CSV-2001'`))[0].n).toBe(0);
    const [imp] = await ownerRows(sql`select status, accepted_count, rejected_count, errors from statement_imports where id = ${body.importId}`);
    expect(imp).toMatchObject({ status: "rejected", accepted_count: 0, rejected_count: 5 });
    expect((imp.errors as { errors: { row: number; column: string; code: string; message: string }[] }).errors[0]).toMatchObject({ row: 3, column: "amount", code: "invalid_amount" });
    const [a] = await auditFor(lumen, "statement_import_rejected");
    expect(a.details).toMatchObject({ fileSha256: sha(bytes), rowCount: 6, acceptedCount: 0, rejectedCount: 5, actor: finance.userId });
  });

  it("all-or-nothing when the ENGINE refuses one line (already ingested): every other line is rolled back", async () => {
    const before = await countLines(lumen);
    const bytes = csv(row({ line_id: "SIMBANK-NEW-7001" }), row({ line_id: "SIMBANK-CSV-1001", account_ref: "SIMBANK-SGD-OPS (fictional)", amount: "1250.00" }), row({ line_id: "SIMBANK-NEW-7002" }));
    const r = await importStatementCsv(finance, { fileName: "partly-seen.csv", bytes }, key());
    expect(r.status).toBe(422);
    const body = r.body as ImportRejected;
    expect(body.errors).toEqual([expect.objectContaining({ row: 3, code: "engine_refused", message: expect.stringMatching(/duplicate_statement_line/) })]);
    expect(await countLines(lumen)).toBe(before);
    expect((await ownerRows(sql`select count(*)::int as n from settlement_evidence where record->>'lineId' like 'SIMBANK-NEW-700%'`))[0].n).toBe(0);
    expect((await ownerRows(sql`select count(*)::int as n from audit_events where org_id = ${lumen} and source = 'engine' and summary like '%SIMBANK-NEW-700%'`))[0].n).toBe(0);
  });

  it("a missing column is rejected with a recorded error and nothing imported", async () => {
    const r = await importStatementCsv(finance, { fileName: "missing-column.csv", bytes: fixture("missing-column.csv") }, key());
    expect(r.status).toBe(422);
    expect((r.body as ImportRejected).errors).toEqual([expect.objectContaining({ row: 1, column: "counterparty", code: "missing_column" })]);
  });

  it("an oversized or empty file is refused before parsing and audited; no import row (the table only holds 1..1 MiB)", async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41);
    await refused(importStatementCsv(finance, { fileName: "huge.csv", bytes: huge }, key()), "FILE_TOO_LARGE");
    await refused(importStatementCsv(finance, { fileName: "empty.csv", bytes: new Uint8Array(0) }, key()), "FILE_EMPTY");
    const audits = await auditFor(lumen, "statement_import_rejected");
    expect(audits.some((a) => (a.details as { code?: string }).code === "FILE_TOO_LARGE" && (a.details as { sizeBytes: number }).sizeBytes === MAX_FILE_BYTES + 1)).toBe(true);
    expect((await ownerRows(sql`select count(*)::int as n from statement_imports where file_name in ('huge.csv','empty.csv')`))[0].n).toBe(0);
  });

  it("NUL bytes and invalid UTF-8 are rejected and recorded", async () => {
    const r1 = await importStatementCsv(finance, { fileName: "nul.csv", bytes: enc(`${HEADER}\n${row({ reference: "A\u0000" })}\n`) }, key());
    expect((r1.body as ImportRejected).errors[0].code).toBe("nul_byte");
    const r2 = await importStatementCsv(finance, { fileName: "latin1.csv", bytes: new Uint8Array([...enc(HEADER + "\n"), 0xe9, 0x0a]) }, key());
    expect((r2.body as ImportRejected).errors[0].code).toBe("invalid_utf8");
  });

  it("file names are display-only: path separators, control characters and non-.csv names are refused", async () => {
    for (const fileName of ["../../etc/passwd.csv", "a\\b.csv", "evil\n.csv", "statement.xlsx", "x.csv.exe", "<b>.csv"]) {
      await refused(importStatementCsv(finance, { fileName, bytes: csv(row()) }, key()), "INVALID_REQUEST");
    }
  });

  it("formula injection: =HYPERLINK in reference and counterparty is stored as raw text, and the error report neutralises it", async () => {
    const r = await importConfirmed(finance, { fileName: "formula-injection.csv", bytes: fixture("formula-injection.csv") }, key());
    expect(r.status).toBe(201);
    const [line] = await ownerRows(sql`select record from settlement_evidence where kind = 'statement_line' and record->>'lineId' = 'SIMBANK-CSV-3001'`);
    expect((line.record as { reference: string }).reference).toBe('=HYPERLINK("https://example.invalid/fictional","Click for refund")');
    expect((line.record as { counterparty: string }).counterparty).toBe('=HYPERLINK("https://example.invalid/fictional","Kestrel Foods")');

    const bad = csv(row({ line_id: "=1+1" }), row({ line_id: "SIMBANK-F-2", reference: '"=HYPERLINK(""https://example.invalid"",""<b>pay</b>"")"', counterparty: '"=HYPERLINK(""https://example.invalid"",""x"")"', amount: "-5" }));
    const rej = await importStatementCsv(finance, { fileName: "formula-bad.csv", bytes: bad }, key());
    expect(rej.status).toBe(422);
    const rep = await importErrorReport(finance, (rej.body as ImportRejected).importId);
    expect(rep.body).toContain("'=1+1");
    expect(rep.body).toContain(`"'=HYPERLINK(""https://example.invalid"",""<b>pay</b>"")"`);
    expect(rep.body).toContain("'-5");
    for (const l of rep.body.split("\r\n").slice(1).filter(Boolean)) expect(l.split(",").every((c) => !/^"?[=+\-@\t\r]/.test(c))).toBe(true);
    expect((await auditFor(lumen, "statement_import_error_report_exported")).length).toBe(1);
  });

  it("the engine still decides matching: an amount-only line (no reference) allocates and settles NOTHING", async () => {
    const ops = await ctx("ops@lumen.example");
    const paysBefore = await listPayments(ops);
    const allocBefore = Number((await ownerRows(sql`select count(*)::int as n from reconciliation_records where org_id = ${lumen}`))[0].n);
    const r = await importConfirmed(finance, { fileName: "amount-only-match.csv", bytes: fixture("amount-only-match.csv") }, key());
    expect(r.status).toBe(201);
    const body = r.body as ImportAccepted;
    expect(body.lines[0].outcome).toBe("exception_raised");
    expect(Number((await ownerRows(sql`select count(*)::int as n from reconciliation_records where org_id = ${lumen}`))[0].n)).toBe(allocBefore);
    const [line] = await ownerRows(sql`select record from settlement_evidence where kind = 'statement_line' and record->>'lineId' = 'SIMBANK-CSV-5001'`);
    expect(line.record).toMatchObject({ status: "exception", allocationIds: [], explanationCodes: ["RC_AMOUNT_ONLY_CANDIDATES"] });
    const paysAfter = await listPayments(ops);
    expect(paysAfter.map((p) => [p.id, p.execution, p.settlement, p.reconciliation])).toEqual(paysBefore.map((p) => [p.id, p.execution, p.settlement, p.reconciliation]));
  });

  it("the engine matches a line by the payment's provider payment id (Redwood), and the result is labelled as imported, not a bank feed", async () => {
    const ops = await ctx("ops@lumen.example");
    const redwood = (await listPayments(ops)).find((p) => p.reference === REDWOOD_REFERENCE)!;
    const ppid = (await ownerRows(sql`select record->>'providerPaymentId' as p from engine_records where org_id = ${lumen} and collection = 'instructions' and record->>'intentId' = ${redwood.id}`))[0].p as string;
    expect(new TextDecoder().decode(fixture("references-redwood.csv"))).toContain(ppid); // the fixture names the seeded Redwood payout
    const excBefore = (await paymentDetail(ops, redwood.id)).exceptions.length;

    const r = await importConfirmed(finance, { fileName: "references-redwood.csv", bytes: fixture("references-redwood.csv") }, key());
    expect(r.status).toBe(201);
    const body = r.body as ImportAccepted;
    const stlId = body.lines[0].statementLineId;
    const detail = await paymentDetail(ops, redwood.id);
    // the engine attributes the line to Redwood by reference (an allocation or an exception naming the payment)
    const allocs = await ownerRows(sql`select intent_id from reconciliation_records where org_id = ${lumen} and line_id = ${stlId}`);
    const attributed = allocs.some((a) => a.intent_id === redwood.id) || detail.exceptions.some((e) => e.statementLineId === stlId && e.intentId === redwood.id);
    expect(attributed).toBe(true);
    // Redwood's debit is already allocated, so the engine refuses to count it twice (it does not allocate on its own say-so)
    expect(detail.exceptions.find((e) => e.statementLineId === stlId)).toMatchObject({ intentId: redwood.id, explanationCode: "RC_DUPLICATE_SUSPECTED" });
    expect(detail.exceptions.length).toBeGreaterThanOrEqual(excBefore);
    expect(detail.view.status.settlement).not.toBe("verified"); // a returned payout never becomes verified

    const prov = await evidenceProvenance(ops, redwood.id);
    const mine = prov.find((p) => p.evidenceId === stlId)!;
    expect(mine).toMatchObject({ kind: "statement_line", lineId: "SIMBANK-CSV-6001", provenance: "csv_import", importId: body.importId, fileSha256: sha(fixture("references-redwood.csv")), importedBy: finance.userId });
    expect(mine.label).toBe(`Imported by ${mine.importedByName} from ${body.fileSha256} — not an authenticated bank feed`);
    expect(mine.label).toMatch(/— not an authenticated bank feed$/);
    expect(mine.label).not.toMatch(/verified/i);

    // seeded lines stay labelled as seed data
    expect(prov.filter((p) => p.lineId === "SIMBANK-0188").map((p) => p.provenance)).toEqual(["seed_fictional"]);
    await refused(evidenceProvenance(await ctx("ops@harbour.example"), "pi_does_not_exist"), "ACCESS_404");
  });

  it("a line naming a payment's provider payment id, with its amount and currency, is ALLOCATED by the engine (and labelled imported)", async () => {
    const ops = await ctx("ops@lumen.example");
    const p = (await listPayments(ops)).find((x) => x.reference === "INV-2026-145")!; // Eastport Trading (fictional), no statement line yet
    const ppid = (await ownerRows(sql`select record->>'providerPaymentId' as p from engine_records where org_id = ${lumen} and collection = 'instructions' and record->>'intentId' = ${p.id}`))[0].p as string;
    const bytes = csv(row({ line_id: "SIMBANK-CSV-8001", direction: "debit", amount: "8839.50", currency: "SGD", reference: `HOLDFAST PAYOUT ${ppid}`, counterparty: "Holdfast Payments (sandbox)" }));
    const r = await importConfirmed(finance, { fileName: "eastport.csv", bytes }, key());
    expect(r.status).toBe(201);
    const line = (r.body as ImportAccepted).lines[0];
    expect(line.outcome).toBe("allocated");
    const allocs = await ownerRows(sql`select intent_id from reconciliation_records where org_id = ${lumen} and line_id = ${line.statementLineId}`);
    expect(allocs.map((x) => x.intent_id)).toEqual([p.id]);
    const after = (await listPayments(ops)).find((x) => x.id === p.id)!;
    // KNOWN LIMITATION (reported): the engine has no notion of provenance, so a CSV line uploaded by one Finance user
    // moves settlement to "verified" exactly as an authenticated bank feed would. The UI must show the provenance label.
    expect(after.settlement).toBe("verified");
    const prov = (await evidenceProvenance(ops, p.id)).find((x) => x.evidenceId === line.statementLineId)!;
    expect(prov).toMatchObject({ provenance: "csv_import", importId: (r.body as ImportAccepted).importId });
    expect(prov.label).toMatch(/^Imported by .+ from [0-9a-f]{64} — not an authenticated bank feed$/);
  });

  it("provenance only takes the three server-side values (no 'verified' or 'bank_authenticated' can be stored)", async () => {
    const [x] = await ownerRows(sql`select id from settlement_evidence where provenance = 'csv_import' and org_id = ${lumen} limit 1`);
    for (const v of ["bank_authenticated", "verified", "bank_feed"]) {
      await expect(ownerDb().execute(sql`update settlement_evidence set provenance = ${v} where id = ${x.id as string} and org_id = ${lumen}`)).rejects.toThrow();
    }
  });

  it("nothing is written to disk: the import path imports no filesystem, process or temp-file module", () => {
    for (const f of ["src/server/imports.ts", "src/lib/csv/statement.ts", "src/lib/csv/parse.ts", "src/lib/csv/cell.ts"]) {
      const src = readFileSync(path.join(__dirname, "..", "..", f), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)|require\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const m of imports) expect(m, `${f} imports ${m}`).not.toMatch(/^(node:)?(fs|fs\/promises|os|child_process|worker_threads|tmp|multer|formidable|busboy)$/);
    }
  });
});

describe("second-person confirmation: an uploaded file is not evidence until an Approver confirms it", () => {
  it("an upload is staged only: nothing is ingested, no payment changes, and it is audited as staged", async () => {
    const fin = await ctx("finance@lumen.example");
    const before = await countLines(fin.orgId);
    const bytes = csv(row({ line_id: "SIMBANK-STAGE-1" }), row({ line_id: "SIMBANK-STAGE-2" }));
    const r = await importStatementCsv(fin, { fileName: "staged.csv", bytes }, key());
    expect(r.status).toBe(201);
    expect((r.body as ImportAccepted).status).toBe("pending_confirmation");
    expect(await countLines(fin.orgId)).toBe(before);
    expect((await auditFor(fin.orgId, "statement_import_staged")).length).toBeGreaterThan(0);
  });

  it("the importer's role cannot confirm, other roles cannot confirm, a wrong hash is refused, and an approver can decline", async () => {
    const fin = await ctx("finance@lumen.example");
    const bytes = csv(row({ line_id: "SIMBANK-STAGE-3" }));
    const r = await importStatementCsv(fin, { fileName: "staged-3.csv", bytes }, key());
    const b = r.body as ImportAccepted;
    for (const who of ["finance@lumen.example", "ops@lumen.example", "viewer@lumen.example", "admin@lumen.example"]) {
      await refused(decideStatementImport(await ctx(who), b.importId, { decision: "confirm", reason: "not allowed", fileSha256: b.fileSha256, linesSha256: b.linesSha256 }, key()), "ACCESS_403");
    }
    const appr = await ctx("approver@lumen.example");
    await refused(decideStatementImport(appr, b.importId, { decision: "confirm", reason: "wrong file", fileSha256: "a".repeat(64), linesSha256: b.linesSha256 }, key()), "VERSION_MISMATCH");
    const before = await countLines(fin.orgId);
    const d = await decideStatementImport(appr, b.importId, { decision: "decline", reason: "Does not match the bank portal (fictional)", fileSha256: b.fileSha256, linesSha256: b.linesSha256 }, key());
    expect(d.body).toMatchObject({ status: "declined", acceptedCount: 0 });
    expect(await countLines(fin.orgId)).toBe(before);
    await refused(decideStatementImport(appr, b.importId, { decision: "confirm", reason: "second decision", fileSha256: b.fileSha256, linesSha256: b.linesSha256 }, key()), "IMPORT_CLOSED");
  });

  it("another organisation's approver cannot confirm this organisation's import (404)", async () => {
    const fin = await ctx("finance@lumen.example");
    const r = await importStatementCsv(fin, { fileName: "staged-4.csv", bytes: csv(row({ line_id: "SIMBANK-STAGE-4" })) }, key());
    const b = r.body as ImportAccepted;
    await refused(decideStatementImport(await ctx("approver@harbour.example", "harbour-demo"), b.importId, { decision: "confirm", reason: "cross-tenant", fileSha256: b.fileSha256, linesSha256: b.linesSha256 }, key()), "ACCESS_404");
  });

  it("the database refuses a self-confirmation and a confirmation by a non-approver, even bypassing the service", async () => {
    const fin = await ctx("finance@lumen.example");
    const r = await importStatementCsv(fin, { fileName: "staged-5.csv", bytes: csv(row({ line_id: "SIMBANK-STAGE-5" })) }, key());
    const id = (r.body as ImportAccepted).importId;
    await expect(ownerDb().execute(sql`update statement_imports set status = 'imported', confirmed_by = imported_by where id = ${id}`)).rejects.toThrow();
    await expect(ownerDb().execute(sql`update statement_imports set status = 'imported', confirmed_by = ${ids["ops@lumen.example"]} where id = ${id}`)).rejects.toThrow();
    const [row1] = await ownerRows(sql`select status from statement_imports where id = ${id}`);
    expect(row1.status).toBe("pending_confirmation");
  });

  it("evidence provenance and import id are immutable once written (even to another allowed value)", async () => {
    const [x] = await ownerRows(sql`select id, org_id from settlement_evidence where provenance = 'csv_import' limit 1`);
    expect(x).toBeDefined();
    await expect(ownerDb().execute(sql`update settlement_evidence set provenance = 'engine_action' where id = ${x.id as string} and org_id = ${x.org_id as string}`)).rejects.toThrow();
    await expect(ownerDb().execute(sql`update settlement_evidence set import_id = null where id = ${x.id as string} and org_id = ${x.org_id as string}`)).rejects.toThrow();
  });
});

