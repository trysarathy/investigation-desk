/**
 * rc6 phase 9: the public merchant-reconciliation cases (/clearline/cases), no sign-in, in customer-preview mode.
 * Figures here are the founder's case figures; the page renders them from the engine (see
 * tests/clearline/merchant/cases-demo.test.ts for the engine-side check).
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { axeSource } from "./axe-source";

const LABEL = "Test mode · illustrative data";
const MINUS = "−";

const CASES: { slug: string; h1: string; figures: string[]; csvRows: RegExp[] }[] = [
  {
    slug: "amount-differences", h1: "Case 1: Amount differences",
    figures: ["BK-24817", "matched_with_difference", "sender_side_fee", `SGD ${MINUS}1.35`, "SGD 1.35", "BK-24823", "SGD 324.00", "BK-24830", "SGD 145.80", "BK-24836", "suggested_for_review", `SGD ${MINUS}9.00`, "SGD 5,961.24"],
    csvRows: [
      /^BK-24817,"Invoice SGD 1,350\.00; credited SGD 1,348\.65",SGD -1\.35,sender_side_fee,"matched_with_difference \(Matched with a difference, step 4\)",M4\.tolerance\.within_band,$/m,
      /^BK-24823,.*,SGD -324\.00,underpayment,"exception \(Exception, step 4\)",M4\.tolerance\.underpayment_beyond_band,Payment Operations$/m,
      /^BK-24830,.*,SGD 145\.80,overpayment,"exception \(Exception, step 4\)",M4\.tolerance\.overpayment_beyond_band,Payment Operations$/m,
      /^BK-24836,.*,SGD -9\.00,requote_after_expiry,"suggested_for_review \(Suggested for review, step 4\)",M4\.tolerance\.explained_outside_band,Payment Operations$/m,
    ],
  },
  {
    slug: "one-settlement", h1: "Case 2: One settlement, many payments",
    figures: ["SGD 44,412.30", `SGD ${MINUS}2,970.00`, `SGD ${MINUS}1,200.00`, "SGD +1,620.00", "SGD 41,862.30", `SGD ${MINUS}418.62`, `SGD ${MINUS}1,215.00`, "SGD 40,228.68", "USD 9,355.50", "BK-24871"],
    csvRows: [
      /^BK-24871,.*,SGD 0\.00,none,"exception \(Exception, step 3\)",M3\.batch\.held_by_provider,Treasury$/m,
      /^BK-24901,"Invoice USD 1,000\.00; credited USD 1,000\.00",USD 0\.00,none,"matched \(Matched, step 5\)",M5\.batch\.tied_verified,$/m,
    ],
  },
  {
    slug: "partial-payment", h1: "Case 3: Partial payment across chains",
    figures: ["AED 18,350.84", "AED 14.16", "AED 12.86", "AED 1.30", "AED 7,347.50", "PL-1", "PL-2", "Registered wallet", "Intermediate wallet", "Exchange hot wallet"],
    csvRows: [
      /^BK-25102,"Invoice AED 18,365\.00; credited AED 18,350\.84",AED -12\.86,underpayment,"matched_with_difference \(Matched with a difference, step 4\)",M4\.tolerance\.within_band,$/m,
      /^BK-25102,.*,AED -1\.30,rate_difference,/m,
    ],
  },
];

/** Navigate and wait until the streamed page has replaced the root loading fallback and the console has hydrated. */
async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(200);
  await expect(page.getByTestId(path === "/clearline/cases" ? "cases-index" : "case-page")).toBeVisible();
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}

async function noHorizontalOverflow(page: Page, label: string) {
  const o = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > cw + 1).slice(0, 3).map((e) => `${e.tagName}.${e.className}`);
    return { sw: document.documentElement.scrollWidth, cw, wide };
  });
  expect(o.sw, `${label}: scrollWidth ${o.sw} > clientWidth ${o.cw}; ${o.wide.join(" | ")}`).toBeLessThanOrEqual(o.cw);
}

test.describe("public merchant cases (no sign-in)", () => {
  test("the index lists the three cases with the label", async ({ page }) => {
    await open(page, "/clearline/cases");
    await expect(page.getByTestId("cases-label")).toContainText(LABEL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Three reconciliation cases, step by step");
    for (const c of CASES) await expect(page.getByTestId(`case-card-${c.slug}`).getByRole("link")).toHaveAttribute("href", `/clearline/cases/${c.slug}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("ConsoleMerchant cases");
  });

  for (const c of CASES) {
    test(`${c.slug}: renders its key figures and the label (server-rendered)`, async ({ page, request }) => {
      // Server-rendered: the figures are in the HTML before any script runs.
      const html = await (await request.get(`/clearline/cases/${c.slug}`)).text();
      expect(html).toContain(LABEL);
      for (const f of c.figures) expect(html, f).toContain(f.replace(/&/g, "&amp;"));
      await open(page, `/clearline/cases/${c.slug}`);
      await expect(page.getByTestId("cases-label")).toBeVisible();
      await expect(page.getByTestId("cases-label")).toContainText(LABEL);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(c.h1);
      const text = await page.getByTestId("case-page").innerText();
      for (const f of c.figures) expect(text, f).toContain(f);
      expect(text).toContain("(fictional)");
      const pending = page.getByTestId("posting-pending");
      expect(await pending.count()).toBeGreaterThan(0);
      for (const t of await pending.allInnerTexts()) expect(t).toBe("Posting rule pending sign-off");
      expect(await page.locator("article[data-testid^='journal-']").count()).toBe(await pending.count());
    });

    test(`${c.slug}: the CSV and PDF downloads work and carry the label`, async ({ page }) => {
      await open(page, `/clearline/cases/${c.slug}`);
      const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-csv").click()]);
      expect(csvDl.suggestedFilename()).toMatch(new RegExp(`^clearline-case-\\d-${c.slug}-test-mode\\.csv$`));
      const csv = await page.request.get(`/clearline/cases/${c.slug}/download/csv`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-type"]).toContain("text/csv");
      const body = (await csv.text()).replace(/^﻿/, "").replace(/\r\n/g, "\n");
      const lines = body.split("\n");
      expect(lines[0]).toBe(LABEL);
      expect(lines[2]).toBe("order,amounts,difference,type,result,rule,owner");
      for (const r of c.csvRows) expect(body).toMatch(r);
      const [pdfDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
      expect(pdfDl.suggestedFilename()).toMatch(/\.pdf$/);
      const pdf = await page.request.get(`/clearline/cases/${c.slug}/download/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      const bytes = await pdf.body();
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toContain(LABEL);
    });

    test(`${c.slug}: axe finds no violations`, async ({ page }) => {
      await open(page, `/clearline/cases/${c.slug}`);
      await page.evaluate(axeSource()); // over CDP: the nonce CSP blocks an injected inline <script>
      const v = await page.evaluate(async () => {
        const r = await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: unknown }[] }[] }> } }).axe.run({ resultTypes: ["violations"] });
        return r.violations.map((x) => `${x.id} (${x.impact}, ${x.nodes.length}: ${JSON.stringify(x.nodes.slice(0, 2).map((n) => n.target))})`);
      });
      expect(v, v.join("\n")).toEqual([]);
    });

    test(`${c.slug}: keyboard Tab reaches both download links`, async ({ page }) => {
      await open(page, `/clearline/cases/${c.slug}`);
      const reached = new Set<string>();
      for (let i = 0; i < 80 && reached.size < 2; i++) {
        await page.keyboard.press("Tab");
        const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
        if (id === "download-csv" || id === "download-pdf") {
          reached.add(id);
          expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe("none");
        }
      }
      expect([...reached].sort()).toEqual(["download-csv", "download-pdf"]);
      // Enter on a focused download link starts the download.
      await page.getByTestId("download-csv").focus();
      const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
      expect(dl.suggestedFilename()).toMatch(/\.csv$/);
    });
  }

  test("no horizontal overflow at 320, 390, 768, 1280 and 1440", async ({ page, isMobile }) => {
    test.skip(isMobile, "viewport widths set explicitly; runs once");
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of ["/clearline/cases", ...CASES.map((c) => `/clearline/cases/${c.slug}`)]) {
        await open(page, p);
        await noHorizontalOverflow(page, `${p} @${width}`);
      }
    }
  });

  test("on a phone the page fits and the label is the first thing in the content", async ({ page, isMobile }) => {
    test.skip(!isMobile, "iPhone 13 project only");
    for (const c of CASES) {
      await open(page, `/clearline/cases/${c.slug}`);
      await noHorizontalOverflow(page, `${c.slug} (iPhone 13)`);
      const first = await page.evaluate(() => document.querySelector("[data-testid='case-page']")?.firstElementChild?.getAttribute("data-testid"));
      expect(first).toBe("cases-label");
    }
  });

  test("an unknown case shows the console's not-found page; the pilot is never served here", async ({ page, request }) => {
    // The root loading boundary streams the response, so an unknown case renders not-found inside a 200 (as any console page).
    await page.goto("/clearline/cases/not-a-case");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    expect((await request.get("/clearline/cases/not-a-case/download/csv")).status()).toBe(404);
    expect((await request.get("/control")).status()).toBe(404);
  });

  test("screenshots at 1440 and 390 (written only with CLEARLINE_CASES_SCREENSHOTS=1)", async ({ page, isMobile }) => {
    test.skip(isMobile || process.env.CLEARLINE_CASES_SCREENSHOTS !== "1", "documentation screenshots, on request");
    const dir = "docs/product/screenshots-rc6";
    mkdirSync(dir, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const c of CASES) {
        await open(page, `/clearline/cases/${c.slug}`);
        await page.screenshot({ path: `${dir}/case-${c.slug}-${width}.png`, fullPage: true });
      }
    }
  });
});
