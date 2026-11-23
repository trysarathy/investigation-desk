/**
 * rc6 phase 10: Case Reconstruction. The bundled sample reproduces Case 1; the incomplete sample lists its unmappable
 * fields and questions; CSV and HTML escaping; the CLI's local-only refusals; purge deletes only what the tool
 * created; identical runs give byte-identical output. No network, no database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { proposeJournals, reconcile } from "@/lib/clearline/merchant";
import { stableJson } from "@/lib/clearline/merchant/adapters";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { reconstructDay, type InputFile } from "@/lib/clearline/merchant/reconstruct/build";
import { CSV_COLUMNS, reportCsv, reportHtml, reportJson } from "@/lib/clearline/merchant/reconstruct/render";
import { parseReportText } from "@/lib/clearline/merchant/reconstruct/schema";
import { REAL_LABEL, SAMPLE_LABEL, type ReconstructionReport } from "@/lib/clearline/merchant/reconstruct/types";
import { MANIFEST, main } from "../../../scripts/reconstruct/cli";

const REPO = resolve(__dirname, "../../..");
const SAMPLE_ROOT = join(REPO, "scripts/reconstruct/sample");
const sampleFiles = (name: string): InputFile[] =>
  readdirSync(join(SAMPLE_ROOT, name)).sort().map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(join(SAMPLE_ROOT, name, n))) }));

// Local only: any network call during these tests fails loudly.
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network is not allowed in the reconstruction tool"); });
afterAll(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

describe("bundled sample: Case 1", async () => {
  const { report, engine, bankConfirmed } = await reconstructDay(sampleFiles("case1"), { sample: true });
  const want = reconcile(case1());

  it("once the bank line is confirmed, every record, bridge and journal is exactly Case 1's", () => {
    expect(stableJson(bankConfirmed.result)).toBe(stableJson(want));
    expect(stableJson(bankConfirmed.journals)).toBe(stableJson(proposeJournals(case1(), want)));
  });

  it("per item: Case 1's result, rule and deciding step; as imported only BK-24817 waits for the bank feed", () => {
    const rows = report.items.map((i) => [i.orderId, i.result, i.rule, i.decidingStep, i.difference, i.owner]);
    expect(rows).toEqual([
      ["BK-24817", "suggested_for_review", "M5.bank.imported_not_verified", 5, "SGD -1.35", "Treasury"],
      ["BK-24823", "exception", "M4.tolerance.underpayment_beyond_band", 4, "SGD -324.00", "Payment Operations"],
      ["BK-24830", "exception", "M4.tolerance.overpayment_beyond_band", 4, "SGD 145.80", "Payment Operations"],
      ["BK-24836", "suggested_for_review", "M4.tolerance.explained_outside_band", 4, "SGD -9.00", "Payment Operations"],
    ]);
    expect(report.items.map((i) => [i.orderId, i.onceBankConfirmed.result, i.onceBankConfirmed.rule, i.onceBankConfirmed.decidingStep])).toEqual(
      want.records.map((r) => [r.orderId, r.explanation.decision, r.explanation.ruleId, r.explanation.decidingStep]));
    expect(report.items[0].onceBankConfirmed).toMatchObject({ result: "matched_with_difference", rule: "M4.tolerance.within_band", decidingStep: 4 });
    expect(report.items.map((i) => i.differences.map((d) => d.type))).toEqual([["sender_side_fee"], ["underpayment"], ["overpayment"], ["requote_after_expiry"]]);
    expect(engine.input.bankLines.every((l) => l.source === "csv_import")).toBe(true);
  });

  it("figures: credited 6,021.45; fee 60.21; batch B-1124-001 net 5,961.24 tied to the 25 Nov bank line", () => {
    const fig = Object.fromEntries(report.figures.map((f) => [f.key, [f.value, f.onceBankConfirmed ?? null]]));
    expect(fig).toEqual({
      orders: ["4", null], invoiced: ["SGD 6,210.00", null], credited: ["SGD 6,021.45", null], fees: ["SGD 60.21", null], net: ["SGD 5,961.24", null],
      owed: ["SGD 334.35", null], liability: ["SGD 145.80", null], writeOffs: ["SGD 0.00", "SGD 1.35"], exceptions: ["2", null], verified: ["0 of 1", "1 of 1"],
    });
    expect(report.bridges).toHaveLength(1);
    const b = report.bridges[0];
    expect(b).toMatchObject({ batchId: "B-1124-001", bankLineId: "BL-SG-1125-01", tied: true, settlementVerified: false, settlementVerifiedOnceBankConfirmed: true, bankLineLabel: "imported, not bank-authenticated" });
    expect(b.lines.map((l) => [l.kind, l.amount])).toEqual([["merchant_day", "SGD 6,021.45"], ["gross", "SGD 6,021.45"], ["provider_fee", "SGD -60.21"], ["net", "SGD 5,961.24"]]);
  });

  it("journal proposals are all marked posting rule pending sign-off", () => {
    expect(report.journals.map((j) => j.id)).toEqual(["JP-CONF-PP-24817", "JP-CONF-PP-24823", "JP-CONF-PP-24830", "JP-CONF-PP-24836"]);
    expect(report.journalsOnceBankConfirmed.map((j) => j.id)).toEqual([...report.journals.map((j) => j.id), "JP-SETL-B-1124-001"]); // Document A: the write-off sits inside JP-CONF-PP-24817
    for (const j of [...report.journals, ...report.journalsOnceBankConfirmed]) expect([j.status, j.postingRule]).toEqual(["proposed", "Posting rule pending sign-off"]);
    expect(reportHtml(report)).toContain("posting rule pending sign-off");
  });

  it("the complete sample has no gaps and carries the test-mode label everywhere", () => {
    expect([report.unmappable, report.questions, report.rejected, report.notes]).toEqual([[], [], [], []]);
    expect(report.label).toBe(SAMPLE_LABEL);
    expect(reportCsv(report).split("\r\n")[0]).toBe(`﻿${SAMPLE_LABEL}`);
    expect(reportCsv(report).split("\r\n")[2]).toBe(CSV_COLUMNS.join(","));
    expect(reportHtml(report).split(SAMPLE_LABEL).length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe("bundled sample: incomplete", async () => {
  const { report } = await reconstructDay(sampleFiles("incomplete"), { sample: true });

  it("lists the unmappable fields: unmapped columns and missing required fields", () => {
    expect(report.unmappable.map((u) => [u.source, u.field, u.kind, u.records])).toEqual([
      ["mapping", "Tx hash", "mapped_column_absent", null],
      ["mapping", "Log index", "mapped_column_absent", null],
      ["mapping", "Batch", "mapped_column_absent", null],
      ["provider export", "Settlement batch", "unmapped_column", null],
      ["provider export", "Merchant reference", "unmapped_column", null],
      ["provider export", "Internal note", "unmapped_column", null],
      ["provider export", "quoteDepositAddress", "missing_required", 2],
      ["provider export", "txHash", "missing_required", 4],
      ["settlement report", "payoutChannel", "unmapped_column", 1],
      ["settlement report", "totals.settlementRef", "unmapped_column", 1],
      ["bank lines", "balance", "unmapped_column", null],
    ]);
  });

  it("generates the questions to ask the provider, deterministically", async () => {
    expect(report.questions.map((q) => q.text)).toEqual([
      "The export has 3 columns with no mapping (Settlement batch, Merchant reference, Internal note) — what do they contain, and does any of them carry a field Clearline needs?",
      "No deposit address on 2 records — which field carries it?",
      "No transaction hash on 4 payment records — can the export include the transaction hash and log index for each payment?",
      "The settlement report has 2 fields Clearline does not read (payoutChannel, totals.settlementRef) — what do they contain?",
      "Settlement report has totals only — can you export per-payment lines with batch ID?",
      "Provider day boundary/time zone not stated — which time zone and cut-off time define a settlement day?",
    ]);
    const again = await reconstructDay([...sampleFiles("incomplete")].reverse(), { sample: true });
    expect(reportJson(again.report)).toBe(reportJson(report));
  });

  it("rejected rows name the physical CSV line; the totals-only settlement is only a grouping; the bank file is refused under rc5 rules", () => {
    expect(report.rejected.map((r) => [r.source, r.row, r.code])).toEqual([["provider-export.csv", 3, "invalid"], ["provider-export.csv", 4, "invalid"]]);
    expect(report.items.map((i) => i.orderId)).toEqual(["BK-24817", "BK-24836"]);
    expect(report.bridges).toEqual([]);
    expect(report.groupings[0]).toMatchObject({ status: "needs_confirmation", providerDay: "2026-11-24" });
    expect(report.notes).toEqual(["bank-lines.csv does not meet the rc5 statement CSV rules (1 error); under those rules the whole file is refused, so no bank line was used."]);
  });
});

describe("gaps without a mapping or a settlement report", () => {
  it("asks for the mapping, the settlement and the export when they are missing", async () => {
    const files = sampleFiles("case1").filter((f) => !["mapping.json", "settlement.json"].includes(f.name));
    const { report } = await reconstructDay(files, { sample: false });
    expect(report.label).toBe(REAL_LABEL);
    expect(report.questions.map((q) => q.id)).toEqual(["no-mapping", ...[
      "orderId", "orderAmount", "orderCurrency", "quoteId", "quoteNetwork", "quoteTokenContract", "quoteDepositAddress", "quotedAmount", "quoteRate", "quoteRateSource", "quoteRateAt", "quoteCreatedAt", "quoteExpiresAt",
    ].map((f) => `missing-${f}`), "missing-providerPaymentId", "no-settlement"]);
    expect(report.unmappable.filter((u) => u.kind === "unmapped_column")).toHaveLength(31);
    const none = await reconstructDay([], { sample: false });
    expect(none.report.questions.map((q) => q.id)).toEqual(["no-export", "no-settlement"]);
  });
});

describe("escaping", () => {
  const hostile = async (): Promise<ReconstructionReport> => {
    const { report } = await reconstructDay(sampleFiles("case1"), { sample: true });
    const it0 = report.items[0];
    report.items = [
      { ...it0, orderId: "=HYPERLINK(\"http://x.invalid\",\"y\")", owner: "@SUM(1)" },
      { ...it0, orderId: "+1-2", owner: "-3", differences: [], difference: "\tx" },
      { ...it0, orderId: " =1+1", owner: "​=cmd", differences: [] },
      { ...it0, orderId: "<script>alert('x')</script>&", owner: "Payment \"Ops\", Inc." },
    ];
    report.title = "</title><script>alert(1)</script>";
    return report;
  };

  it("CSV: formula cells are neutralised with ' and quotes are doubled (rc5 csvCell)", async () => {
    const lines = reportCsv(await hostile()).split("\r\n");
    expect(lines[3].startsWith(`"'=HYPERLINK(""http://x.invalid"",""y"")"`)).toBe(true);
    expect(lines[3].endsWith(",'@SUM(1)")).toBe(true);
    expect(lines[4].startsWith("'+1-2,")).toBe(true);
    expect(lines[4]).toContain(",'\tx,none,");
    expect(lines[4].endsWith(",'-3")).toBe(true);
    expect(lines[5].startsWith("' =1+1,")).toBe(true);
    expect(lines[5].endsWith(",'​=cmd")).toBe(true);
    expect(lines[6].endsWith(`,"Payment ""Ops"", Inc."`)).toBe(true);
    expect(lines[1]).toBe("</title><script>alert(1)</script>");
  });

  it("HTML: every value is escaped and the page is self-contained (no script, link, image or external URL)", async () => {
    const html = reportHtml(await hostile());
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/\s(src|href|srcset|action)=/i);
    expect(html).not.toMatch(/url\(|@import|<link|<img|<iframe|<object/i);
    expect(html).toContain("default-src 'none'");
  });
});

describe("the CLI", () => {
  let tmp: string;
  const io = () => { const out: string[] = []; const err: string[] = []; return { out, err, deps: (env: Record<string, string | undefined> = {}) => ({ env, sampleRoot: SAMPLE_ROOT, cwd: REPO, out: (l: string) => out.push(l), err: (l: string) => err.push(l) }) }; };
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "clearline-recon-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));
  const files = (dir: string) => readdirSync(dir).sort().map((n) => [n, readFileSync(join(dir, n), "utf8")]);

  it("refuses to run when CI is set, whatever the arguments", async () => {
    for (const ci of ["true", "1", ""]) {
      const x = io();
      expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "o")], x.deps({ CI: ci }))).toBe(1);
      expect(x.err.join("\n")).toContain("CI is set");
    }
    expect(existsSync(join(tmp, "o"))).toBe(false);
  });

  it("refuses an input or output inside the repository but outside reconstruction-data/", async () => {
    const a = io();
    expect(await main(["--in", "scripts/reconstruct", "--out", join(tmp, "o")], a.deps())).toBe(1);
    expect(a.err.join("\n")).toMatch(/Refusing the input: it is inside the git repository .* but not under .*reconstruction-data/);
    const b = io();
    expect(await main(["--in", "docs", "--out", join(tmp, "o")], b.deps())).toBe(1);
    const c = io();
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", "scripts/reconstruct/out"], c.deps())).toBe(1);
    expect(c.err.join("\n")).toContain("Refusing the output");
    expect(existsSync(join(REPO, "scripts/reconstruct/out"))).toBe(false);
    expect(existsSync(join(tmp, "o"))).toBe(false);
  });

  it("accepts data under the git-ignored reconstruction-data/ (and outside the repository); real data carries the not-for-distribution label", async () => {
    expect(readFileSync(join(REPO, ".gitignore"), "utf8").split("\n")).toContain("reconstruction-data/");
    const dataDir = join(REPO, "reconstruction-data");
    const made = !existsSync(dataDir);
    const base = join(dataDir, `vitest-${process.pid}`);
    try {
      cpSync(join(SAMPLE_ROOT, "case1"), join(base, "input"), { recursive: true });
      const x = io();
      expect(await main(["--in", join(base, "input"), "--out", join(base, "report")], x.deps())).toBe(0);
      const [csv, html, json] = ["report.csv", "report.html", "report.json"].map((n) => readFileSync(join(base, "report", n), "utf8"));
      for (const body of [csv, html, json]) { expect(body).toContain(REAL_LABEL); expect(body).not.toContain(SAMPLE_LABEL); }
      expect(JSON.parse(readFileSync(join(base, "report", MANIFEST), "utf8")).label).toBe(REAL_LABEL);
      const y = io();
      cpSync(join(SAMPLE_ROOT, "case1"), join(tmp, "in"), { recursive: true });
      expect(await main(["--in", join(tmp, "in"), "--out", join(tmp, "out")], y.deps())).toBe(0);
    } finally { rmSync(made ? dataDir : base, { recursive: true, force: true }); }
  });

  it("writes only inside --out and refuses an --out holding files it did not write", async () => {
    const out = join(tmp, "o");
    mkdirSync(out);
    writeFileSync(join(out, "mine.txt"), "x");
    const x = io();
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", out], x.deps())).toBe(1);
    expect(files(out).map(([n]) => n)).toEqual(["mine.txt"]);
    const y = io();
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "no", "such")], y.deps())).toBe(1);
    expect(readdirSync(tmp)).toEqual(["o"]);
    const z = io();
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "p")], z.deps())).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(["o", "p"]);
    expect(files(join(tmp, "p")).map(([n]) => n)).toEqual([MANIFEST, "report.csv", "report.html", "report.json"]);
  });

  it("an identical run gives byte-identical output; --generated-at is the only time in it", async () => {
    for (const o of ["a", "b"]) expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, o), "--generated-at", "2026-11-25T09:00:00Z"], io().deps())).toBe(0);
    expect(files(join(tmp, "a"))).toEqual(files(join(tmp, "b")));
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "a"), "--generated-at", "2026-11-25T09:00:00Z"], io().deps())).toBe(0);
    expect(files(join(tmp, "a"))).toEqual(files(join(tmp, "b")));
    expect(JSON.parse(readFileSync(join(tmp, "a", "report.json"), "utf8")).generatedAt).toBe("2026-11-25T09:00:00Z");
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "c")], io().deps())).toBe(0);
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", join(tmp, "d")], io().deps())).toBe(0);
    expect(files(join(tmp, "c"))).toEqual(files(join(tmp, "d")));
    expect(JSON.parse(readFileSync(join(tmp, "c", "report.json"), "utf8")).generatedAt).toBeNull();
  });

  it("purge: nothing without --yes; then only the files it created and left unchanged; never a directory it did not create", async () => {
    const out = join(tmp, "o");
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", out], io().deps())).toBe(0);
    const dry = io();
    expect(await main(["--purge", out], dry.deps())).toBe(2);
    expect(dry.out.join("\n")).toContain("Nothing was deleted");
    expect(readdirSync(out)).toHaveLength(4);
    writeFileSync(join(out, "my-notes.txt"), "kept");
    const x = io();
    expect(await main(["--purge", out, "--yes"], x.deps())).toBe(0);
    expect(readdirSync(out)).toEqual(["my-notes.txt"]);
    rmSync(join(out, "my-notes.txt"));

    // A directory the tool did not create stays, even when empty.
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", out], io().deps())).toBe(0);
    expect(await main(["--purge", out, "--yes"], io().deps())).toBe(0);
    expect(readdirSync(out)).toEqual([]);

    // A changed output is kept (with the manifest), the unchanged ones go, and a directory it created is removed once empty.
    const out2 = join(tmp, "o2");
    expect(await main(["--in", "scripts/reconstruct/sample/case1", "--out", out2], io().deps())).toBe(0);
    writeFileSync(join(out2, "report.csv"), "edited by a person");
    expect(await main(["--purge", out2, "--yes"], io().deps())).toBe(1);
    expect(readdirSync(out2).sort()).toEqual([MANIFEST, "report.csv"]);
    rmSync(join(out2, "report.csv"));
    expect(await main(["--purge", out2, "--yes"], io().deps())).toBe(0);
    expect(existsSync(out2)).toBe(false);
    expect(readdirSync(tmp)).toEqual(["o"]);
  });

  it("purge refuses a directory without its manifest, a forged manifest, and data inside the repository outside reconstruction-data/", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, "provider.csv"), "x");
    expect(await main(["--purge", plain, "--yes"], io().deps())).toBe(1);
    writeFileSync(join(plain, MANIFEST), JSON.stringify({ tool: "clearline-reconstruct", version: 1, label: "x", createdDir: true, files: [{ path: "../escape.txt", bytes: 1, sha256: "0" }] }));
    const x = io();
    expect(await main(["--purge", plain, "--yes"], x.deps())).toBe(1);
    expect(x.err.join("\n")).toContain("is not a manifest this tool wrote");
    expect(readdirSync(plain).sort()).toEqual([MANIFEST, "provider.csv"]);
    const y = io();
    expect(await main(["--purge", "scripts/reconstruct/sample/case1", "--yes"], y.deps())).toBe(1);
    expect(y.err.join("\n")).toContain("Refusing to purge");
    expect(readdirSync(join(SAMPLE_ROOT, "case1"))).toHaveLength(7);
  });

  it("runs as npx tsx scripts/reconstruct/reconstruct.ts (a real process), and refuses when CI is set", () => {
    const env = { ...process.env };
    delete env.CI;
    const run = (e: NodeJS.ProcessEnv, out: string) => spawnSync(join(REPO, "node_modules/.bin/tsx"), ["scripts/reconstruct/reconstruct.ts", "--in", "scripts/reconstruct/sample/case1", "--out", out], { cwd: REPO, env: e, encoding: "utf8" });
    const ok = run(env, join(tmp, "o"));
    expect([ok.status, ok.stdout.split("\n")[0]]).toEqual([0, SAMPLE_LABEL]);
    expect(readdirSync(join(tmp, "o")).sort()).toEqual([MANIFEST, "report.csv", "report.html", "report.json"]);
    const ci = run({ ...env, CI: "true" }, join(tmp, "p"));
    expect(ci.status).toBe(1);
    expect(ci.stderr).toContain("CI is set");
    expect(existsSync(join(tmp, "p"))).toBe(false);
  }, 30_000);

  it("is local only: no network, database or server module anywhere in its sources", () => {
    const sources = [
      "scripts/reconstruct/reconstruct.ts", "scripts/reconstruct/cli.ts", "src/lib/csv/statement.ts", "src/lib/csv/parse.ts", "src/lib/csv/cell.ts",
      ...readdirSync(join(REPO, "src/lib/clearline/merchant/reconstruct")).map((n) => `src/lib/clearline/merchant/reconstruct/${n}`),
    ];
    for (const f of sources) {
      const text = readFileSync(join(REPO, f), "utf8");
      expect(text, f).not.toMatch(/from "(node:)?(http|https|http2|net|tls|dgram|dns|child_process)"|fetch\(|XMLHttpRequest|WebSocket|from "pg"|drizzle|@\/server|server-only|process\.env\.DATABASE_URL/);
    }
  });
});

describe("pilot screen: the report is read in the browser", async () => {
  const { report } = await reconstructDay(sampleFiles("case1"), { sample: true });
  it("accepts the CLI's report.json and refuses anything else", () => {
    expect(parseReportText(reportJson(report))).toEqual({ ok: true, report: JSON.parse(reportJson(report)) });
    expect(parseReportText("{").ok).toBe(false);
    expect(parseReportText(JSON.stringify({ ...report, label: "Anything" })).ok).toBe(false);
    expect(parseReportText(JSON.stringify({ ...report, extra: 1 })).ok).toBe(false);
  });
});
