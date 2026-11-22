/**
 * rc6 phase 9: the public cases demo (/clearline/cases). The figures the pages display, checked from the engine
 * output through the same view model the pages render from; the CSV escaping; the PDF; the gate.
 */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { deploymentGate } from "@/middleware";
import { crumbsFor } from "@/components/clearline/nav";
import { CSV_COLUMNS, caseCsv, caseCsvRows, escapeCell } from "@/lib/clearline/merchant-cases/csv";
import { casePdf } from "@/lib/clearline/merchant-cases/pdf";
import { CASE_SLUGS, LABEL, POSTING_RULE_PENDING, caseModel, money, signedMoney, summaryFigures, waterfall, type Book } from "@/lib/clearline/merchant-cases/view";

const rec = (b: Book, id: string) => b.result.records.find((r) => r.orderId === id)!;
const fig = (b: Book, testId: string) => summaryFigures(b).find((f) => f.testId === testId)!.value;

describe("Case 1 page figures (from reconcile)", () => {
  const [b] = caseModel("amount-differences").books;
  it("BK-24817 matched_with_difference: sender_side_fee −1.35, write-off 1.35 proposed", () => {
    const r = rec(b, "BK-24817");
    expect(r.explanation.decision).toBe("matched_with_difference");
    expect(r.explanation.differences.map((d) => [d.type, signedMoney(d.amountMinor, d.currency)])).toEqual([["sender_side_fee", "SGD −1.35"]]);
    const wo = b.result.writeOffs.find((w) => w.orderId === "BK-24817")!;
    expect(money(wo.amountMinor, wo.currency)).toBe("SGD 1.35");
  });
  it("BK-24823 exception, 324.00 still owed", () => {
    const r = rec(b, "BK-24823");
    expect(r.explanation.decision).toBe("exception");
    expect(money(r.ledger.openBalanceMinor, "SGD")).toBe("SGD 324.00");
    expect(r.attention!.owner).toBe("Payment Operations");
  });
  it("BK-24830 exception, 145.80 customer-overpayment liability", () => {
    const r = rec(b, "BK-24830");
    expect(r.explanation.decision).toBe("exception");
    expect(money(r.ledger.customerOverpaymentMinor, "SGD")).toBe("SGD 145.80");
    expect(fig(b, "fig-liability")).toBe("SGD 145.80");
  });
  it("BK-24836 suggested_for_review, −9.00", () => {
    const r = rec(b, "BK-24836");
    expect(r.explanation.decision).toBe("suggested_for_review");
    expect(r.explanation.differences.map((d) => signedMoney(d.amountMinor, d.currency))).toEqual(["SGD −9.00"]);
  });
  it("net bank credit 5,961.24", () => {
    expect(fig(b, "fig-net")).toBe("SGD 5,961.24");
    expect(fig(b, "fig-fees")).toBe("SGD 60.21");
  });
});

describe("Case 2 page figures (from reconcile)", () => {
  const [sgd, usd] = caseModel("one-settlement").books;
  it("waterfall 44,412.30 / −2,970.00 / −1,200.00 / +1,620.00 / 41,862.30 / −418.62 / −1,215.00 / 40,228.68", () => {
    const br = sgd.result.bridges.find((x) => x.batchId === "B-1125-SGD")!;
    const w = waterfall(br);
    expect(w.lines.map((l) => l.display)).toEqual([
      "SGD 44,412.30", "SGD −2,970.00", "SGD −1,200.00", "SGD +1,620.00", "SGD 41,862.30", "SGD −418.62", "SGD −1,215.00", "SGD 40,228.68",
    ]);
    // Every line lists its payment IDs, and the running total ends at the net.
    for (const l of w.lines) expect(l.paymentIds.length).toBeGreaterThan(0);
    expect(w.lines.at(-1)!.endMinor).toBe(sgd.input.bankLines.find((l) => l.bankLineId === br.bankLineId)!.amountMinor);
    expect(w.lines[3].endMinor).toBe(w.lines[4].amountMinor); // merchant day ± timing = gross
    expect(w.lines[6].endMinor).toBe(w.lines[7].amountMinor); // gross − fee − refund = net
  });
  it("USD batch net 9,355.50", () => {
    expect(fig(usd, "fig-net")).toBe("USD 9,355.50");
    expect(waterfall(usd.result.bridges[0]).lines.at(-1)!.display).toBe("USD 9,355.50");
  });
  it("the held order BK-24871 is the one exception, owner Treasury", () => {
    expect(sgd.result.exceptions.map((e) => [e.orderId, e.owner])).toEqual([["BK-24871", "Treasury"]]);
  });
});

describe("Case 3 page figures (from reconcile)", () => {
  const m = caseModel("partial-payment");
  const [b] = m.books;
  it("credited 18,350.84; gap 14.16 = 12.86 + 1.30", () => {
    const r = b.result.records[0];
    expect(money(r.ledger.creditedMinor, "AED")).toBe("AED 18,350.84");
    expect(money(r.ledger.invoice.amountMinor - r.ledger.creditedMinor, "AED")).toBe("AED 14.16");
    expect(r.explanation.differences.map((d) => [d.type, money(-d.amountMinor, d.currency)])).toEqual([["underpayment", "AED 12.86"], ["rate_difference", "AED 1.30"]]);
  });
  it("open balance 7,347.50 after part 1 (part paid)", () => {
    const r1 = m.afterPart1!.result.records[0];
    expect(money(r1.ledger.openBalanceMinor, "AED")).toBe("AED 7,347.50");
    expect(r1.ledger.balanceLabel).toBe("part paid");
  });
});

describe("journal entries are all proposals pending sign-off", () => {
  it("every proposal on every case page is pending sign-off", () => {
    const all = CASE_SLUGS.flatMap((s) => caseModel(s).books.flatMap((b) => b.journals));
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((j) => j.status === "proposed" && j.postingRuleStatus === "pending_sign_off")).toBe(true);
    expect(POSTING_RULE_PENDING).toBe("Posting rule pending sign-off");
  });
});

describe("CSV", () => {
  it("escapes a cell starting with = + - @ or a tab with a leading ', then quotes per RFC 4180", () => {
    expect(escapeCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCell("+1")).toBe("'+1");
    expect(escapeCell("-1.35")).toBe("'-1.35");
    expect(escapeCell("@cmd")).toBe("'@cmd");
    expect(escapeCell("\tx")).toBe("'\tx");
    expect(escapeCell("=1,2")).toBe(`"'=1,2"`);
    expect(escapeCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(escapeCell("SGD -1.35")).toBe("SGD -1.35");
    expect(escapeCell("plain")).toBe("plain");
  });
  it("carries the label, the columns order, amounts, difference, type, result, rule, owner, and the expected rows", () => {
    const text = caseCsv("amount-differences");
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(LABEL);
    expect(lines[2]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS).toEqual(["order", "amounts", "difference", "type", "result", "rule", "owner"]);
    expect(caseCsvRows("amount-differences").map((r) => [r[0], r[2], r[3], r[4].split(" ")[0], r[5], r[6]])).toEqual([
      ["BK-24817", "SGD -1.35", "sender_side_fee", "matched_with_difference", "M4.tolerance.within_band", ""],
      ["BK-24823", "SGD -324.00", "underpayment", "exception", "M4.tolerance.underpayment_beyond_band", "Payment Operations"],
      ["BK-24830", "SGD 145.80", "overpayment", "exception", "M4.tolerance.overpayment_beyond_band", "Payment Operations"],
      ["BK-24836", "SGD -9.00", "requote_after_expiry", "suggested_for_review", "M4.tolerance.explained_outside_band", "Payment Operations"],
    ]);
    expect(caseCsvRows("one-settlement")).toHaveLength(35 + 7);
    expect(caseCsvRows("one-settlement").find((r) => r[0] === "BK-24871")!.slice(3)).toEqual(["none", "exception (Exception, step 3)", "M3.batch.held_by_provider", "Treasury"]);
    expect(caseCsvRows("partial-payment").map((r) => [r[2], r[3]])).toEqual([["AED -12.86", "underpayment"], ["AED -1.30", "rate_difference"]]);
    for (const s of CASE_SLUGS) for (const l of caseCsv(s).split("\r\n").slice(3)) expect(l).not.toMatch(/^[=+\-@\t]|,[=+\-@\t]/);
  });
});

describe("PDF", () => {
  it.each(CASE_SLUGS)("%s: starts with %%PDF, one page, labelled", async (slug) => {
    const bytes = await casePdf(slug);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain(LABEL);
    expect(Buffer.from(await casePdf(slug)).equals(Buffer.from(bytes))).toBe(true); // deterministic: no clock
  });
});

describe("served without sign-in, also in customer preview; the pilot never", () => {
  const preview = { CLEARLINE_CUSTOMER_PREVIEW: "1" };
  it.each(["/clearline/cases", "/clearline/cases/partial-payment", "/clearline/cases/one-settlement/download/csv", "/clearline/cases/amount-differences/download/pdf"])("%s is served", (p) => {
    expect(deploymentGate(p, null, preview)).toEqual({ action: "next", consoleShell: true });
    expect(deploymentGate(p, null, { PREVIEW_USER: "u", PREVIEW_PASSWORD: "p" })).toEqual({ action: "next", consoleShell: true });
  });
  it("the pilot stays refused", () => {
    expect(deploymentGate("/control", null, preview)).toEqual({ action: "not_found", noStore: true });
  });
  it("breadcrumbs", () => {
    expect(crumbsFor("/clearline/cases/one-settlement").map((c) => c.label)).toEqual(["Console", "Merchant cases", "Case 2 · One settlement, many payments"]);
  });
});

describe("no figure is typed into the demo code", () => {
  it("the view, components, CSV and PDF code contain none of the case figures", () => {
    const files = ["src/lib/clearline/merchant-cases/view.ts", "src/lib/clearline/merchant-cases/csv.ts", "src/lib/clearline/merchant-cases/pdf.ts", "src/components/clearline/cases/CaseView.tsx", "src/components/clearline/cases/CasesIndex.tsx"];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/5,961|40,228|44,412|41,862|9,355|18,350|7,347|14\.16|12\.86|324\.00|145\.80|1\.35\b|418\.62|1,215|2,970|1,620/);
  });
});
