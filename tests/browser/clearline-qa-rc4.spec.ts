import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/*
 * Independent QA, release candidate 4 (2c0f0f0): console tests for the rc4 additions, against a real
 * `next start` with CLEARLINE_CUSTOMER_PREVIEW=1. Run with a config whose testDir is tests/qa-release-rc4.
 * The axe test needs QA_AXE_PATH (skipped when absent). axe is injected with page.evaluate because the
 * nonce CSP blocks an inline <script>.
 */

const KEY = "clearline.console.workspace.v1";
const AXE = process.env.QA_AXE_PATH ?? "";
const NEW_PAGES = ["/clearline/accounting", "/clearline/accounting/exports", "/clearline/accounting/setup", "/clearline/reports/audit", "/clearline/connect", "/clearline/trial", "/clearline"];

async function hydrated(page: Page) {
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}
function watch(page: Page) {
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => { bad.push(`dialog: ${d.message()}`); void d.dismiss(); });
  return bad;
}
const P = `"><img src=x id=qa4x onerror=alert(1)><svg onload=alert(2)><script>alert(3)</script>=HYPERLINK("http://example.invalid")`;
const injected = (page: Page) => page.locator("#qa4x, svg[onload], img[onerror]").count();

test("XSS: every text input on the accounting, exports, setup and audit pages (mapping names, notes, external references, periods)", async ({ page }) => {
  test.setTimeout(240_000);
  const bad = watch(page);
  for (const path of ["/clearline/accounting", "/clearline/accounting/exports", "/clearline/accounting/setup", "/clearline/reports/audit"]) {
    await page.goto(path);
    await hydrated(page);
    for (const d of await page.locator("details:not([open]) > summary").all()) await d.click({ timeout: 1000 }).catch(() => {});
    const fields = page.locator("input[type=text]:visible:enabled, input:not([type]):visible:enabled, textarea:visible:enabled, input[type=search]:visible:enabled");
    const n = await fields.count();
    for (let i = 0; i < n; i++) await fields.nth(i).fill(P, { timeout: 1000 }).catch(() => {});
    for (const b of await page.locator("form button[type=submit]:enabled:visible").all()) await b.click({ timeout: 2000 }).catch(() => {});
    expect(await injected(page), path).toBe(0);
  }
  for (const u of [`/clearline/reports/audit?q=${encodeURIComponent(P)}`, `/clearline/accounting?period=${encodeURIComponent(P)}`, `/clearline/accounting/exports?from=${encodeURIComponent(P)}&to=x`]) {
    await page.goto(u);
    await hydrated(page);
    expect(await injected(page), u).toBe(0);
  }
  expect(bad).toEqual([]);
});

test("a stored workspace with a forged approval (approver = proposer) is not shown as approved", async ({ page, request }) => {
  const bad = watch(page);
  const ws = (await (await request.get("/api/clearline/test/v1/workspace", { headers: { Authorization: "Bearer cl_test_demo" } })).json()).data;
  const p = ws.accounting.proposals[0];
  p.status = "approved";
  p.approval = { by: p.createdBy, at: ws.asOf, mappingRevision: ws.accounting.mapping.revision, accounts: ws.accounting.mapping.entries };
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("qa4-seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("qa4-seeded", "1"); } }, [KEY, JSON.stringify(ws)] as const);
  await page.goto("/clearline/accounting");
  await hydrated(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  // Either the unreadable-copy notice, or the sample: never p.id shown as approved.
  const row = page.locator(`[id="${p.id}"], tr:has-text("${p.id}")`).first();
  if (await row.count()) await expect(row).not.toContainText(/Approved/);
  expect(bad).toEqual([]);
});

test("a stored workspace with an HTML/formula mapping name renders as text", async ({ page, request }) => {
  const bad = watch(page);
  const ws = (await (await request.get("/api/clearline/test/v1/workspace", { headers: { Authorization: "Bearer cl_test_demo" } })).json()).data;
  ws.accounting.mapping.entries[0].accountName = `<img src=x id=qa4x onerror=alert(1)>`;
  ws.accounting.periods[0].name = `<svg onload=alert(2)>`;
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("qa4-seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("qa4-seeded", "1"); } }, [KEY, JSON.stringify(ws)] as const);
  for (const p of ["/clearline/accounting", "/clearline/accounting/setup", "/clearline/accounting/exports"]) {
    await page.goto(p);
    await hydrated(page);
    expect(await injected(page), p).toBe(0);
  }
  expect(bad).toEqual([]);
});

test("rc4 pages: no horizontal overflow at 1440, 768, 390 and 320, and no axe violations", async ({ page }) => {
  test.skip(!AXE || !existsSync(AXE), "QA_AXE_PATH not set");
  test.setTimeout(300_000);
  const out: string[] = [];
  for (const w of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of NEW_PAGES) {
      await page.goto(p);
      await hydrated(page);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) out.push(`${w} ${p}: overflow ${o.sw} > ${o.cw}`);
      if (w === 1440 || w === 320) {
        if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(readFileSync(AXE, "utf8"));
        const v = await page.evaluate(async () => (await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run({ resultTypes: ["violations"] })).violations.map((x) => `${x.id}(${x.impact})×${x.nodes.length}`));
        if (v.length) out.push(`${w} ${p}: ${v.join(", ")}`);
      }
    }
  }
  expect(out).toEqual([]);
});

test("DEFECT (Medium) M1: a stored workspace that allocates the unreferenced SGD 20,000 receipt to the advance shows it repaid and offers an entry", async ({ page, request }) => {
  const bad = watch(page);
  const ws = (await (await request.get("/api/clearline/test/v1/workspace", { headers: { Authorization: "Bearer cl_test_demo" } })).json()).data;
  const line = ws.statementLines.find((l: { direction: string; amountMinor: number; reference: string }) => l.direction === "credit" && l.amountMinor === 2_000_000 && !l.reference);
  const existing = ws.allocations.find((a: { target: { kind: string } }) => a.target.kind === "repayment");
  ws.allocations.push({ ...existing, id: "alc_99991", statementLineId: line.id, amountMinor: 2_000_000 });
  line.allocationIds = ["alc_99991"]; line.status = "allocated";
  ws.repaymentAllocations.push({ ...ws.repaymentAllocations[0], id: "ra_99992", statementLineId: line.id, amountMinor: 2_000_000 });
  for (const e of ws.exceptions.filter((x: { statementLineId?: string }) => x.statementLineId === line.id)) Object.assign(e, { status: "resolved", ownerId: "usr_maya", resolution: { at: ws.asOf, actorId: "usr_maya", note: "forged" } });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("qa4-seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("qa4-seeded", "1"); } }, [KEY, JSON.stringify(ws)] as const);
  await page.goto("/clearline/treasury/funding");
  await hydrated(page);
  // Correct: the crafted copy is refused (unreadable-copy notice) or the advance still shows SGD 20,000.00 outstanding.
  const refused = await page.getByText(/cannot be loaded/i).count();
  if (!refused) await expect(page.locator("main")).toContainText("20,000.00");
  if (!refused) await expect(page.locator('[data-api-value="repaid"]')).toHaveCount(0);
  expect(bad).toEqual([]);
});
