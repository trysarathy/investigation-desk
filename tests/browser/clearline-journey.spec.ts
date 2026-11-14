import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/*
 * The founder's acceptance journey (rc3): one end-to-end walk through all 20 steps in order, reached
 * only by clicking what a prospect would click, plus focused tests for the steps and the rc3 console
 * work (filters, owners, sources, case report, Funding Desk link, link reliability, error handling).
 * Runs in both projects: desktop 1440×900 and iPhone 13 (390×844).
 */

const WEBSITE = "https://clearline-marketing.vercel.app";
const WEBSITE_HOST = new URL(WEBSITE).hostname;
const CONTACT = "mailto:aashmiin.k.2025@accountancy.smu.edu.sg";
const ROLE_NOTE = "Simulated role — not sign-in or access control";
const API = "/api/clearline/test/v1";
const AUTH = { Authorization: "Bearer cl_test_demo" };

const ids = new Map<string, string>();
async function scenarioId(request: APIRequestContext, key: string): Promise<string> {
  if (!ids.size) {
    const r = await request.get(`${API}/intents`, { headers: AUTH });
    for (const i of (await r.json()).data as { id: string; scenario?: string }[]) if (i.scenario) ids.set(i.scenario, i.id);
  }
  const id = ids.get(key);
  if (!id) throw new Error(`no sample intent for scenario ${key}`);
  return id;
}

async function hydrated(page: Page) {
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}
async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

/** The prospect's website, served by the test (the real site is a separate deployment). */
async function fakeWebsite(page: Page, baseURL: string) {
  await page.route((u) => u.hostname === WEBSITE_HOST, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><title>Clearline — website (test double)</title><body><h1>Clearline website</h1>
      <a href="${baseURL}/clearline/trial">Try the console — no sign-up</a></body></html>`,
  }));
}

/** Console navigation the way a person uses it: on a phone the menu opens first. */
async function goNav(page: Page, label: string) {
  if (!(await page.locator("#cl-nav").isVisible())) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: label, exact: true }).click();
}

async function noHorizontalOverflow(page: Page, label = "") {
  const o = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > cw + 1).slice(0, 3)
      .map((e) => `${e.tagName}.${e.className}`);
    return { sw: document.documentElement.scrollWidth, cw, wide };
  });
  expect(o.sw, `${label}: scrollWidth ${o.sw} > clientWidth ${o.cw}; ${o.wide.join(" | ")}`).toBeLessThanOrEqual(o.cw);
}

function axeSource(): string | null {
  const req = createRequire(join(process.cwd(), "package.json"));
  const candidates = [process.env.CLEARLINE_AXE_PATH];
  try { candidates.push(req.resolve("axe-core/axe.min.js")); } catch { /* not installed in this repo */ }
  const found = candidates.find((p) => p && existsSync(p));
  return found ? readFileSync(found, "utf8") : null;
}
async function axeViolations(page: Page, axe: string): Promise<string[]> {
  await page.evaluate(axe); // evaluated over CDP: the nonce CSP (rc3) blocks injected inline <script> tags
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run({ resultTypes: ["violations"] });
    return r.violations.map((x) => `${x.id} (${x.impact}, ${x.nodes.length})`);
  });
}

/* ================================================================================================
 * The whole journey, in order.
 * ============================================================================================== */
test("founder acceptance journey: all 20 steps in order, by clicking", async ({ page, baseURL }) => {
  test.setTimeout(360_000); // ~60 interactions across 20 steps; a loaded machine once needed more than 240 s
  await fakeWebsite(page, baseURL!);
  const REF = "INV-JOURNEY-001";

  await test.step("1. arrive from the website", async () => {
    await page.goto(WEBSITE);
    await page.getByRole("link", { name: /Try the console/ }).click();
    await expect(page).toHaveURL(/\/clearline\/trial$/);
    await hydrated(page);
  });

  await test.step("2. understand the console quickly", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Follow five payments from instruction to evidence.");
    const oneMinute = page.locator("#overview");
    await expect(oneMinute.getByRole("heading", { name: "The product in one minute" })).toBeVisible();
    await expect(oneMinute).toContainText("three separate truths");
    await expect(page.getByTestId("test-mode-marker")).toHaveText("TEST MODE · FICTIONAL DATA");
  });

  await test.step("3. open it without sign-up", async () => {
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByText(/No sign-up/)).toBeVisible();
    await page.getByRole("link", { name: "Open the console" }).click();
    await expect(page).toHaveURL(/\/clearline$/);
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });

  await test.step("4. enter the fictional workspace", async () => {
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.getByText(/is fictional\./)).toBeVisible();
    await expect(page.getByRole("link", { name: /Payments in workspace\s*5/ })).toBeVisible();
  });

  let intentId = "";
  await test.step("5. create a synthetic payment intent", async () => {
    await page.getByRole("link", { name: "New payment intent" }).first().click();
    await expect(page).toHaveURL(/\/clearline\/routes\/new$/);
    await hydrated(page);
    await page.getByLabel("Customer reference").fill(REF);
    await expect(page.getByLabel("Idempotency key")).not.toHaveValue("");
    await page.getByRole("button", { name: "Create test intent" }).click();
    await expect(page.getByTestId("intent-id")).toBeVisible();
    intentId = (await page.getByTestId("intent-id").innerText()).trim();
    expect(intentId).toMatch(/^pi_\d+$/);
  });

  await test.step("6. compare fictional quotes", async () => {
    await page.getByRole("button", { name: "Request quotes" }).click();
    const routes = page.locator("#routes");
    await expect(routes.getByText("Indicative sandbox quote — not executable")).toBeVisible();
    expect(await routes.locator("tbody tr").count()).toBeGreaterThan(1);
    await expect(routes.getByText("Eligible", { exact: true }).first()).toBeVisible();
    await expect(routes.getByText("Not eligible", { exact: true }).first()).toBeVisible();
  });

  await test.step("7. select an eligible route", async () => {
    const choose = page.locator("#routes").getByRole("button", { name: /^Choose / });
    // An ineligible route cannot be chosen, and says why.
    const disabled = choose.and(page.locator(":disabled")).first();
    await expect(disabled).toBeDisabled();
    await expect(page.locator(`[id="${await disabled.getAttribute("aria-describedby")}"]`)).toContainText("Not eligible:");
    await choose.and(page.locator(":enabled")).first().click();
    await expect(page.getByRole("status").filter({ hasText: /chosen — recorded by the engine/ })).toBeVisible();
    await expect(page.locator("#routes").getByText("Selected", { exact: true })).toBeVisible();
  });

  await test.step("8. record a simulated approval", async () => {
    const approve = page.locator("#approve");
    await expect(approve.getByTestId("role-switch")).toContainText(ROLE_NOTE);
    await approve.locator("#checker").selectOption("usr_daniel");
    await approve.getByRole("button", { name: "Approve as checker" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Checker approval — recorded by the engine" })).toBeVisible();
  });

  await test.step("9. submit the instruction", async () => {
    await page.getByRole("button", { name: "Submit instruction" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Submission — recorded by the engine" })).toBeVisible();
  });

  await test.step("10. receive fictional partner events", async () => {
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${intentId}$`));
    await hydrated(page);
    for (let i = 0; i < 6; i++) {
      if (await page.getByTestId("dim-execution").locator('[data-api-value="provider_reported_completed"]').count()) break;
      await page.getByRole("button", { name: "Simulate next provider event" }).click();
      await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
    }
    await expect(page.getByTestId("dim-execution").locator('[data-api-value="provider_reported_completed"]')).toBeVisible();
  });

  await test.step("11. open the payment investigation", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(REF);
    await expect(page.getByTestId("payment-id")).toHaveText(intentId);
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
  });

  await test.step("12. see execution, settlement evidence and reconciliation separately", async () => {
    await expect(page.getByTestId("dim-execution")).toContainText("Provider reports completed");
    // The provider's claim is not settlement: evidence and reconciliation say so separately.
    await expect(page.getByTestId("dim-settlement").locator('[data-api-value="none"]')).toBeVisible();
    await expect(page.getByTestId("dim-reconciliation").locator("[data-api-value]")).not.toHaveAttribute("data-api-value", "matched");
    await expect(page.getByText(/payment successful/i)).toHaveCount(0);
  });

  await test.step("13. inspect the source-attributed event history", async () => {
    const rows = page.getByTestId("evidence-timeline").locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(3);
    for (const src of await rows.locator('td[data-label="Source"]').allInnerTexts()) expect(src.trim().length).toBeGreaterThan(3);
    await expect(page.getByTestId("evidence-timeline")).toContainText("Provider claim: it does not prove settlement on its own.");
    await expect(page.getByTestId("finding-known").getByTestId("finding-source").first()).toContainText(/Source: .+ — provider claim/);
  });

  await test.step("14. find an exception and its owner", async () => {
    await goNav(page, "Investigations");
    await expect(page).toHaveURL(/\/clearline\/investigations$/);
    await page.getByRole("navigation", { name: "Investigations pages" }).getByRole("link", { name: "Exceptions queue" }).click();
    await expect(page).toHaveURL(/\/clearline\/exceptions$/);
    await hydrated(page);
    await page.getByRole("search", { name: "Filter exceptions" }).getByLabel("Search").fill("returned");
    await expect(page).toHaveURL(/[?&]q=returned/);
    const row = page.locator("#queue tbody tr").first();
    await expect(page.locator("#queue tbody tr")).toHaveCount(1);
    await expect(row.getByTestId("owner-name")).toContainText("Maya Tan");
    await row.getByText("Change owner").click();
    await row.getByLabel("New owner").selectOption("usr_sam");
    await row.getByRole("button", { name: "Save owner" }).click();
    await expect(row.getByRole("status")).toContainText("recorded by the engine");
    await expect(row.getByTestId("owner-name")).toContainText("Sam Lee");
  });

  await test.step("15. examine a reconciliation difference", async () => {
    await goNav(page, "Reconciliation");
    await expect(page).toHaveURL(/\/clearline\/reconciliation$/);
    await hydrated(page);
    await page.getByRole("button", { name: `Short debit for ${REF} (90% of the amount)` }).click();
    await page.getByRole("button", { name: "Ingest statement line" }).click();
    await expect(page.locator("#ingest").getByRole("status")).toContainText("Line ingested");
    const diff = page.getByTestId("line-amount-difference").last();
    await expect(diff).toContainText(/Expected .+ · reported .+ · difference/);
    await page.locator("#lines").getByRole("link", { name: intentId }).last().click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${intentId}$`));
    await hydrated(page);
    await expect(page.getByTestId("finding-outstanding").getByTestId("amount-difference").first()).toBeVisible();
  });

  await test.step("16. view liquidity and funding exposure", async () => {
    await goNav(page, "Treasury & Funding");
    await expect(page).toHaveURL(/\/clearline\/treasury$/);
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "Liquidity", level: 1 })).toBeVisible();
    await expect(page.locator("#usable dd").first()).toContainText(/\d/);
    await page.getByRole("navigation", { name: "Treasury & Funding pages" }).getByRole("link", { name: "Funding exposure" }).click();
    await expect(page).toHaveURL(/\/clearline\/treasury\/funding$/);
    await hydrated(page);
    await expect(page.locator("#totals")).toContainText("SGD 20,000.00");
  });

  await test.step("17. explore the advance-and-repayment scenario", async () => {
    await expect(page.getByTestId("funding-principal").first()).toContainText("50,000.00");
    await expect(page.getByTestId("funding-repaid").first()).toContainText("30,000.00");
    await expect(page.getByTestId("funding-outstanding").first()).toContainText("20,000.00");
    await expect(page.getByTestId("allocation-source").first()).toContainText("Source: Bank statement");
    await expect(page.getByTestId("funding-exceptions").first()).toContainText("20,000.00");
    await page.getByTestId("funding-desk-panel").getByRole("link", { name: "Open the Funding Desk workflow" }).click();
    await expect(page).toHaveURL(/\/mentor-demo$/);
    await expect(page).toHaveTitle("Clearline Funding Desk | Interactive mentor demo");
    await page.goBack();
    await expect(page).toHaveURL(/\/clearline\/treasury\/funding$/);
    await hydrated(page);
  });

  await test.step("18. export or inspect a synthetic case report", async () => {
    // From the case list to the payment's investigation, where the engine's synthetic report lives.
    await goNav(page, "Investigations");
    await expect(page).toHaveURL(/\/clearline\/investigations$/);
    await hydrated(page);
    await page.locator("#cases tbody tr", { hasText: "Redwood" }).getByRole("link", { name: /Redwood/ }).click();
    await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+#case$/);
    await hydrated(page);
    await page.getByRole("button", { name: "View case report" }).click();
    const report = page.getByTestId("case-report");
    await expect(report.getByTestId("report-marking")).toContainText("FICTIONAL · SANDBOX");
    await expect(report).toContainText("Three separate truths");
    await expect(report).toContainText("Source:");
    const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download case report (.json)" }).click()]);
    const parsed = JSON.parse(readFileSync(await json.path(), "utf8"));
    expect(parsed).toMatchObject({ fictional: true, sandbox: true, reportVersion: 1 });
    expect(parsed.threeTruths.execution.state).toBe("returned");
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download case report (.csv)" }).click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    expect(readFileSync(await csv.path(), "utf8")).toContain("FICTIONAL");
  });

  await test.step("19. reset the workspace", async () => {
    // One case: the engine restores case 02 (the owner change from step 14 is undone); our own payment stays.
    await expect(page.locator("#exceptions")).toContainText("Sam Lee");
    await page.getByRole("button", { name: "Reset this guided case" }).click();
    await expect(page.getByTestId("reset-case").getByRole("status")).toContainText("recorded by the engine");
    await expect(page.locator("#exceptions")).toContainText("Maya Tan");
    await goNav(page, "Payments");
    await hydrated(page);
    await expect(page.getByText(REF)).toBeVisible();
    // The whole workspace.
    await goNav(page, "Settings");
    await hydrated(page);
    await page.getByRole("button", { name: "Reset to sample" }).click();
    await expect(page.getByText("Workspace reset to the sample")).toBeVisible();
    await goNav(page, "Payments");
    await hydrated(page);
    await expect(page.getByText(REF)).toHaveCount(0);
    await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(5);
  });

  await test.step("20. return to the website or contact the founder", async () => {
    await expect(page.locator(`main footer a[href^="${CONTACT}"]`)).toBeVisible();
    await page.getByRole("region", { name: "Test mode notice" }).getByRole("link", { name: "Clearline website" }).click();
    await expect(page).toHaveURL(new RegExp(`^${WEBSITE}/?$`));
    await expect(page.getByRole("heading", { name: "Clearline website" })).toBeVisible();
  });
});

/* ================================================================================================
 * Steps 1–4: arrival, understanding, no sign-up, fictional workspace.
 * ============================================================================================== */
test("steps 1–4: the website's console links answer without sign-up and land on a fictional workspace", async ({ page, request }) => {
  for (const p of ["/clearline/trial", "/clearline"]) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.status(), p).toBe(200);
    expect(r.headers()["set-cookie"] ?? "", p).toBe("");
  }
  await open(page, "/clearline");
  await expect(page.getByTestId("test-mode-marker")).toBeVisible();
  await expect(page.getByText(/Clearline does not move or hold funds/)).toBeVisible();
  // Every summary figure is a link to what is behind it.
  await page.getByRole("link", { name: /Open investigations/ }).click();
  await expect(page).toHaveURL(/\/clearline\/investigations$/);
});

test("step 2: the first screen of the console says what it is and where to start", async ({ page }) => {
  await open(page, "/clearline");
  await expect(page.getByText(/First time here\?/)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "guided trial", exact: true }).click();
  await expect(page).toHaveURL(/\/clearline\/trial$/);
  for (const n of ["01", "02", "03", "04", "05"]) await expect(page.getByRole("link", { name: new RegExp(`^Start case ${n}:`) })).toBeVisible();
});

/* ================================================================================================
 * Priority C: filters and search in the URL (Payments, Investigations, Exceptions).
 * ============================================================================================== */
test("Payments: filter by status, currency and text; the URL is shareable and Back restores the view", async ({ page, request }) => {
  await open(page, "/clearline/payments");
  const bar = page.getByRole("search", { name: "Filter payments" });
  const rows = page.locator('#payments a[href^="/clearline/payments/pi_"]');
  await expect(rows).toHaveCount(5);
  await bar.getByLabel("Execution").selectOption("provider_reported_completed");
  await expect(page).toHaveURL(/\?execution=provider_reported_completed$/);
  await expect(rows).toHaveCount(3);
  await bar.getByLabel("Currency").selectOption("SGD");
  await expect(page).toHaveURL(/execution=provider_reported_completed&currency=SGD$/);
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("filter-summary")).toContainText("Showing 2 of 5 payments");
  await bar.getByLabel("Search").fill("pacific");
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/q=pacific/);
  await expect(rows.first()).toHaveText(await scenarioId(request, "s5_funding"));
  // Back walks through the filters a person chose.
  await page.goBack();
  await expect(page).toHaveURL(/\?execution=provider_reported_completed$/);
  await expect(rows).toHaveCount(3);
  await expect(bar.getByLabel("Currency")).toHaveValue("");
  await page.goForward(); // search text replaced the currency entry, so Forward returns to the searched view
  await expect(page).toHaveURL(/currency=SGD&q=pacific$/);
  await expect(rows).toHaveCount(1);
  await expect(bar.getByLabel("Search")).toHaveValue("pacific");
  // A shared link opens the same view.
  await open(page, "/clearline/payments?settlement=pending_finality");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText(await scenarioId(request, "s4_chain"));
  await expect(page.getByRole("search", { name: "Filter payments" }).getByLabel("Settlement evidence")).toHaveValue("pending_finality");
  // Nothing matches: the empty state says so and Clear filters brings everything back.
  await page.getByRole("search", { name: "Filter payments" }).getByLabel("Search").fill("no such payment");
  await expect(page.locator("#payments")).toContainText("No payments match these filters.");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/clearline\/payments$/);
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole("search", { name: "Filter payments" }).getByLabel("Search")).toHaveValue("");
});

test("Payments: an unknown filter value from a link is shown, not silently dropped", async ({ page }) => {
  await open(page, "/clearline/payments?execution=bogus");
  await expect(page.getByRole("search", { name: "Filter payments" }).getByLabel("Execution")).toHaveValue("bogus");
  await expect(page.locator("#payments")).toContainText("No payments match these filters.");
});

test("Exceptions: filter by status view, severity, currency, owner and text", async ({ page }) => {
  await open(page, "/clearline/exceptions");
  const bar = page.getByRole("search", { name: "Filter exceptions" });
  const rows = page.locator("#queue tbody tr");
  await expect(rows).toHaveCount(4);
  await bar.getByLabel("Currency").selectOption("USD");
  await expect(page).toHaveURL(/currency=USD/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("PV_RETURNED_BENEFICIARY_REJECTED");
  await bar.getByLabel("Currency").selectOption("");
  await expect(page).not.toHaveURL(/currency=/);
  await bar.getByLabel("Owner").selectOption("unassigned");
  await expect(page).toHaveURL(/owner=unassigned/);
  await expect(rows).toHaveCount(2);
  for (const t of await rows.getByTestId("owner-name").allInnerTexts()) expect(t).toBe("Unassigned");
  await bar.getByLabel("Search").fill("RC_AMOUNT_ONLY");
  await expect(rows).toHaveCount(1);
  // The status view keeps the other filters.
  await page.getByRole("navigation", { name: "Exception filters" }).getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/view=all/);
  await expect(page).toHaveURL(/owner=unassigned/);
  await expect(page).toHaveURL(/q=RC_AMOUNT_ONLY/);
  await page.goBack();
  await expect(page).not.toHaveURL(/view=all/);
});

test("Investigations: filter cases by status, owner, currency and text", async ({ page }) => {
  await open(page, "/clearline/investigations");
  const bar = page.getByRole("search", { name: "Filter cases" });
  const rows = page.locator("#cases tbody tr");
  await expect(rows).toHaveCount(4);
  await bar.getByLabel("Owner").selectOption("usr_priya");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Eastport Trading");
  await bar.getByLabel("Owner").selectOption("");
  await expect(page).toHaveURL(/\/clearline\/investigations$/);
  await bar.getByLabel("Currency").selectOption("USDC");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Stonebridge");
  await bar.getByLabel("Currency").selectOption("");
  await expect(page).toHaveURL(/\/clearline\/investigations$/);
  await bar.getByLabel("Status").selectOption("resolved");
  await expect(page).toHaveURL(/status=resolved/);
  await expect(page.locator("#cases")).toContainText("No cases match these filters.");
  await page.goBack();
  await expect(rows).toHaveCount(4);
  await bar.getByLabel("Search").fill("redwood");
  await expect(rows).toHaveCount(1);
});

test("filters are operable by keyboard alone, with a visible focus ring", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard walk runs on desktop");
  await open(page, "/clearline/payments");
  const search = page.getByRole("search", { name: "Filter payments" }).getByLabel("Search");
  await search.focus();
  expect(await search.evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThan(0);
  await page.keyboard.type("stonebridge");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=stonebridge/);
  await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(1);
  await page.keyboard.press("Tab");
  const exec = page.getByRole("search", { name: "Filter payments" }).getByLabel("Execution");
  await expect(exec).toBeFocused();
  expect(await exec.evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThan(0);
});

/* ================================================================================================
 * Priority C: case assignment through the engine; action explanations in the engine's words.
 * ============================================================================================== */
test("case owner can be assigned and reassigned through the engine; a viewer is refused with the engine's reason", async ({ page }) => {
  await open(page, "/clearline/investigations");
  const row = page.locator("#cases tbody tr", { hasText: "Stonebridge" });
  await expect(row.getByTestId("owner-name")).toHaveText("Unassigned");
  await row.getByText("Change owner").click();
  await row.getByLabel("New owner").selectOption("usr_priya");
  await row.getByRole("button", { name: "Save owner" }).click();
  await expect(row.getByRole("status")).toContainText("recorded by the engine");
  await expect(row.getByTestId("owner-name")).toHaveText(/Priya Nair/);
  // Reassign, then confirm on the payment page and in the audit log.
  await row.getByLabel("New owner").selectOption("usr_sam");
  await row.getByRole("button", { name: "Save owner" }).click();
  await expect(row.getByTestId("owner-name")).toHaveText(/Sam Lee/);
  await row.getByRole("link", { name: /Stonebridge/ }).click();
  await hydrated(page);
  await expect(page.locator("#case")).toContainText("Sam Lee");
  // Choosing the current owner again is explained, not silently accepted.
  await open(page, "/clearline/investigations");
  const r2 = page.locator("#cases tbody tr", { hasText: "Eastport" });
  await r2.getByText("Change owner").click();
  await r2.getByLabel("New owner").selectOption("usr_priya");
  await expect(r2.getByRole("button", { name: "Save owner" })).toBeDisabled();
  await expect(r2.getByTestId("action-reason")).toHaveText("Choose a different person first.");
  // A viewer may not assign: disabled before the click, with the engine's words and code.
  await page.getByLabel("Acting as").first().selectOption("usr_alex");
  await r2.getByLabel("New owner").selectOption("usr_maya");
  await expect(r2.getByRole("button", { name: "Save owner" })).toBeDisabled();
  await expect(r2.getByTestId("action-reason")).toContainText("unauthorized_actor");
  expect((await r2.getByTestId("action-reason").innerText()).replace(/unauthorized_actor.*/, "").trim().length).toBeGreaterThan(10);
});

/* ================================================================================================
 * Priority C: source attribution, readability, accessible status labels.
 * ============================================================================================== */
test("every evidence item names its source: findings, timeline, case evidence, evidence register", async ({ page, request }) => {
  for (const sc of ["s1_success", "s2_returned", "s4_chain"]) {
    await open(page, `/clearline/payments/${await scenarioId(request, sc)}`);
    const known = page.getByTestId("finding-known").locator("li");
    const n = await known.count();
    expect(n, sc).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(known.nth(i).getByTestId("finding-source"), `${sc} finding ${i}`).toContainText(/^Source: .+ — (independent evidence|provider claim)/);
    for (const src of await page.locator('[data-testid="evidence-timeline"] td[data-label="Source"]').allInnerTexts()) {
      expect(src, sc).toMatch(/(Independent|Not independent)/);
      expect(src.split("\n")[0].trim().length, sc).toBeGreaterThan(2);
    }
  }
  // Evidence a person attaches carries its source on the case.
  await open(page, `/clearline/payments/${await scenarioId(request, "s2_returned")}`);
  const kase = page.locator("#case");
  await kase.getByLabel("Description").fill("Supplier confirmed the corrected account (fictional)");
  await kase.getByRole("button", { name: "Attach evidence metadata" }).click();
  await expect(kase.getByTestId("case-evidence")).toContainText("Supplier confirmed the corrected account (fictional)");
  await expect(kase.getByTestId("case-evidence")).toContainText("Source:");
  // The register lists every item with its source and whether it is independent.
  await goNav(page, "Reports");
  await expect(page).toHaveURL(/\/clearline\/reports$/);
  await hydrated(page);
  await expect(page.locator('#evidence td[data-label="Source"]').first()).toBeVisible();
  const sources = await page.locator('#evidence td[data-label="Source"]').allInnerTexts();
  expect(sources.length).toBeGreaterThan(10);
  for (const s of sources) expect(s).toMatch(/\n?(Independent evidence|Provider claim|Recorded by a person)$/);
});

test("status labels are text, not colour alone: every status chip has words and its API value", async ({ page }) => {
  for (const p of ["/clearline/payments", "/clearline/exceptions", "/clearline/investigations", "/clearline/reconciliation", "/clearline/holds"]) {
    await open(page, p);
    const chips = page.locator('main [class*="ui_chip__"]');
    const n = await chips.count();
    expect(n, p).toBeGreaterThan(0);
    for (const t of await chips.allInnerTexts()) expect(t.replace(/[○◇◆✕]/g, "").trim().length, `${p}: "${t}"`).toBeGreaterThan(1);
  }
});

test("payment detail: a jump list reaches every section; an unknown payment says so and offers a way back", async ({ page, request }) => {
  await open(page, `/clearline/payments/${await scenarioId(request, "s2_returned")}`);
  const jump = page.getByRole("navigation", { name: "On this page" });
  for (const [name, id] of [["D. Findings", "findings"], ["C. Evidence timeline", "timeline"], ["E. Actions", "actions"]] as const) {
    await jump.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  await open(page, "/clearline/payments/pi_99999");
  await expect(page.getByRole("heading", { name: "Payment not found", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to payments" }).click();
  await expect(page).toHaveURL(/\/clearline\/payments$/);
});

/* ================================================================================================
 * Step 18: case report — inspect in place and export.
 * ============================================================================================== */
test("step 18: the synthetic case report reads in place and exports as JSON and CSV; the case file still exports", async ({ page, request }) => {
  const id = await scenarioId(request, "s2_returned");
  await open(page, `/clearline/payments/${id}`);
  const view = page.getByRole("button", { name: "View case report" });
  await expect(view).toHaveAttribute("aria-expanded", "false");
  await view.click();
  await expect(page.getByRole("button", { name: "Hide case report" })).toHaveAttribute("aria-expanded", "true");
  const report = page.getByRole("group", { name: /^Case report case_/ });
  await expect(report).toContainText("FICTIONAL · SANDBOX");
  await expect(report).toContainText("Execution (provider claim)");
  await expect(report).toContainText("Return position");
  await expect(report.getByTestId("report-timeline")).toContainText("Source:");
  await noHorizontalOverflow(page, "case report open");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download case report (.json)" }).click()]);
  const parsed = JSON.parse(readFileSync(await json.path(), "utf8"));
  expect(parsed.subject.paymentId).toBe(id);
  expect(parsed.amounts.requested.value).toMatch(/^\d+\.\d{2}$/); // exact decimal string
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download case report (.csv)" }).click()]);
  const text = readFileSync(await csv.path(), "utf8");
  expect(text.split("\n").length).toBeGreaterThan(5);
  // The case file (notes and history) is still available for a payment with a case.
  const [txt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export case report (.txt)" }).click()]);
  expect(txt.suggestedFilename()).toMatch(/^case_\d+\.txt$/);
  // A payment without a case still has a synthetic report.
  await open(page, `/clearline/payments/${await scenarioId(request, "s1_success")}`);
  await expect(page.getByRole("button", { name: "Download case report (.json)" })).toBeEnabled();
  await page.getByRole("button", { name: "View case report" }).click();
  await expect(page.getByTestId("case-report")).toContainText("Settlement verified");
});

test("step 18 (Reports): each case's report can be viewed and exported as CSV", async ({ page }) => {
  await open(page, "/clearline/reports");
  const row = page.locator("#cases tbody tr[data-case]").first();
  const caseId = await row.getAttribute("data-case");
  await row.getByRole("button", { name: /^View report/ }).click();
  await expect(page.getByRole("group", { name: `Case report ${caseId}` })).toContainText("FICTIONAL · SANDBOX");
  const [dl] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: /^Export report.*\.csv/ }).click()]);
  expect(dl.suggestedFilename()).toBe(`clearline-case-report-${caseId}.csv`);
});

/* ---------- Step 19: per-case reset through the engine ---------- */
test("step 19: a guided case resets on its own; other cases and your records stay; a refused reset says why", async ({ page, request }) => {
  const s2 = await scenarioId(request, "s2_returned");
  // Change case 02 and case 04, and create a payment of our own.
  await open(page, `/clearline/payments/${s2}`);
  await page.locator("#case").getByLabel("Add note").fill("Note on case 02 before reset.");
  await page.locator("#case").getByRole("button", { name: "Add note" }).click();
  await expect(page.locator("#case")).toContainText("Note on case 02 before reset.");
  await open(page, `/clearline/payments/${await scenarioId(request, "s4_chain")}`);
  await page.locator("#case").getByLabel("Add note").fill("Note on case 04 stays.");
  await page.locator("#case").getByRole("button", { name: "Add note" }).click();
  await expect(page.locator("#case")).toContainText("Note on case 04 stays.");
  await open(page, "/clearline/trial");
  await page.getByRole("button", { name: "Reset case 02 to its starting state" }).click();
  await expect(page.locator("#case-02").getByRole("status")).toContainText("recorded by the engine");
  await open(page, `/clearline/payments/${s2}`);
  await expect(page.locator("#case")).not.toContainText("Note on case 02 before reset.");
  await open(page, `/clearline/payments/${await scenarioId(request, "s4_chain")}`);
  await expect(page.locator("#case")).toContainText("Note on case 04 stays.");
  // Refused: an advance (made through the v1 API) links to case 03's payment, so case 03 cannot be reset alone.
  let ws = (await (await request.get(`${API}/workspace`, { headers: AUTH })).json()).data;
  const held = ws.intents.find((i: { scenario?: string }) => i.scenario === "s3_hold");
  const r = await request.post(`${API}/funding-advances`, { headers: { ...AUTH, "X-Clearline-Actor": "usr_maya" }, data: { workspace: ws, input: {
    intentId: held.id, customerRef: "CUST-E2E-R19", customerName: "R19 Customer (fictional)", supplierName: "R19 Supplier (fictional)",
    invoiceRef: "INV-E2E-R19", dueDate: "2026-12-20", repaymentReference: "RPY-E2E-R19" } } });
  expect(r.ok()).toBe(true);
  ws = (await r.json()).workspace;
  await page.evaluate((t) => localStorage.setItem("clearline.console.workspace.v1", t), JSON.stringify(ws));
  await open(page, "/clearline/trial");
  const btn = page.getByRole("button", { name: "Reset case 03 to its starting state" });
  await expect(btn).toBeDisabled();
  const reason = page.locator(`[id="${await btn.getAttribute("aria-describedby")}"]`);
  await expect(reason).toContainText("REFERENCED_BY_OTHER_RECORDS");
  await expect(reason).toContainText("Other cases or your own records link to this case");
  await expect(page.getByRole("button", { name: "Reset case 01 to its starting state" })).toBeEnabled();
  // The whole-workspace reset is still there.
  await expect(page.getByRole("button", { name: "Reset the whole workspace" })).toHaveCount(1);
});

test("a returned payout states both facts: net movement and beneficiary unpaid", async ({ page, request }) => {
  await open(page, `/clearline/payments/${await scenarioId(request, "s2_returned")}`);
  const top = page.getByTestId("return-position-summary");
  await expect(top).toContainText("Net movement: zero on the statement");
  await expect(top).toContainText("Beneficiary paid: No");
  await expect(top).toContainText("RT_NET_ZERO");
  await expect(top).toContainText("The beneficiary was not paid.");
  await expect(page.getByTestId("dim-settlement").locator('[data-api-value="contradicted"]')).toBeVisible();
  const rp = page.getByTestId("return-position");
  await expect(rp).toContainText("Net movement:");
  await expect(rp).toContainText("Beneficiary paid: No");
  await expect(rp).toContainText(/RT_[A-Z_]+/);
});

/* ================================================================================================
 * Simulated roles and the Funding Desk link.
 * ============================================================================================== */
test("role switching is marked as a simulated role, not sign-in or access control, wherever it appears", async ({ page }) => {
  for (const p of ["/clearline", "/clearline/payments", "/clearline/holds", "/clearline/settings", "/clearline/treasury/funding"]) {
    await open(page, p);
    const switches = page.getByTestId("role-switch");
    const n = await switches.count();
    expect(n, p).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(switches.nth(i), p).toContainText(ROLE_NOTE);
    // The note is part of the control's description for screen readers.
    const sel = page.locator("#cl-actor-global");
    await expect(sel).toHaveAttribute("aria-describedby", "cl-actor-global-note");
    await expect(page.locator("#cl-actor-global-note")).toHaveText(ROLE_NOTE);
  }
  await expect(page.getByText("Simulated role — sandbox only")).toHaveCount(0);
});

test("Treasury & Funding links to the in-app Funding Desk workflow, clearly labelled; no link to the old static site", async ({ page }) => {
  for (const p of ["/clearline/treasury", "/clearline/treasury/funding"]) {
    await open(page, p);
    const panel = page.getByTestId("funding-desk-panel");
    await expect(page.getByRole("heading", { name: "Specialist workflow: Funding Desk" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Open the Funding Desk workflow" })).toHaveAttribute("href", "/mentor-demo");
    await expect(page.locator('a[href*="clearline-funding-desk"]')).toHaveCount(0);
  }
  await page.getByTestId("funding-desk-panel").getByRole("link", { name: "Open the Funding Desk workflow" }).click();
  await expect(page).toHaveTitle("Clearline Funding Desk | Interactive mentor demo");
  const nav = readFileSync("src/components/clearline/nav.ts", "utf8");
  expect(nav).not.toContain("FUNDING_DESK_URL");
  expect(nav).not.toContain("clearline-funding-desk.vercel.app");
  expect(nav).toContain('FUNDING_DESK_HREF = "/mentor-demo"');
});

/* ================================================================================================
 * Code review L1: link reliability on a slow server — no duplicate load.
 * ============================================================================================== */
test("a slow server response shows a pending state and loads the page once (no full-page fallback)", async ({ page, request }) => {
  const id = await scenarioId(request, "s1_success");
  await open(page, "/clearline/trial");
  let rsc = 0;
  let documents = 0;
  page.on("request", (r) => { if (r.resourceType() === "document" && r.url().includes(`/clearline/payments/${id}`)) documents++; });
  await page.route(`**/clearline/payments/${id}*`, async (route) => {
    if (!route.request().headers()["rsc"]) return route.continue();
    rsc++;
    await new Promise((r) => setTimeout(r, 5_000)); // twice the old 2.5 s fallback
    return route.continue();
  });
  const started = Date.now();
  await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
  await expect(page.getByTestId("nav-pending")).toHaveText("Loading page…", { timeout: 3_000 });
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`), { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByTestId("dim-execution")).toBeVisible();
  expect(Date.now() - started).toBeGreaterThan(4_500);
  expect(rsc, "the client navigation was made").toBeGreaterThan(0);
  expect(documents, "no duplicate full-page load").toBe(0);
  await expect(page.getByTestId("nav-pending")).toHaveText("");
  await expect(page.locator("main")).not.toHaveAttribute("aria-busy", "true");
});

test("a slow router push (filters) is not replaced by a full load either", async ({ page }) => {
  await open(page, "/clearline/payments");
  let documents = 0;
  page.on("request", (r) => { if (r.resourceType() === "document") documents++; });
  await page.route("**/clearline/payments?*", async (route) => {
    if (!route.request().headers()["rsc"]) return route.continue();
    await new Promise((r) => setTimeout(r, 4_000));
    return route.continue();
  });
  await page.getByRole("search", { name: "Filter payments" }).getByLabel("Currency").selectOption("USD");
  await expect(page).toHaveURL(/currency=USD/, { timeout: 15_000 });
  await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(2); // USD as source (s2) or destination (s3)
  expect(documents).toBe(0);
});

/* ================================================================================================
 * Error handling: invalid stored workspace, malformed input, unexpected responses, recovery.
 * ============================================================================================== */
test("a stored workspace that is valid JSON but not a valid workspace is explained, downloadable and replaceable", async ({ page, request }) => {
  const ws = (await (await request.get(`${API}/workspace`, { headers: AUTH })).json()).data;
  ws.intents[0].status.execution = "teleported";
  const bad = JSON.stringify(ws);
  await page.addInitScript((t) => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("clearline.console.workspace.v1", t); sessionStorage.setItem("seeded", "1"); } } catch { /* blocked */ } }, bad);
  await open(page, "/clearline/payments");
  const n = page.getByTestId("workspace-discarded");
  await expect(n).toContainText("Your saved workspace could not be read.");
  await expect(n).toContainText("intents[0].status.execution");
  // The sample is shown meanwhile, and the person can take the unreadable copy away.
  await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(5);
  const [dl] = await Promise.all([page.waitForEvent("download"), n.getByRole("button", { name: "Download the unreadable copy" }).click()]);
  expect(dl.suggestedFilename()).toBe("clearline-workspace-unreadable.json");
  expect(readFileSync(await dl.path(), "utf8")).toBe(bad);
  await n.getByRole("button", { name: /Replace it with the sample/ }).click();
  await expect(n).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("clearline.console.workspace.v1.unreadable-backup"))).toBe(bad);
});

test("malformed input in the payment form is refused field by field and creates nothing", async ({ page }) => {
  await open(page, "/clearline/routes/new");
  const amount = page.locator('input[name="amount"]');
  for (const v of ["12.345", "abc", "-5", "1e3", ""]) {
    await amount.fill(v);
    await page.getByRole("button", { name: "Create test intent" }).click();
    await expect(amount, v).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("status").filter({ hasText: "Fix the highlighted field." }), v).toBeVisible();
    await expect(page.getByTestId("intent-id"), v).toHaveCount(0);
  }
  await amount.fill("100.00");
  await page.getByLabel("Destination country (ISO)").fill("1");
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Intent not created/ })).toBeVisible();
  await expect(page.getByTestId("intent-id")).toHaveCount(0);
  // Recovery: correct the field and it goes through.
  await page.getByLabel("Destination country (ISO)").fill("PH");
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByTestId("intent-id")).toBeVisible();
});

test("malformed input in the statement-line form is refused with the reason next to the field", async ({ page }) => {
  await open(page, "/clearline/reconciliation");
  const before = await page.locator("#lines tbody tr").count();
  const form = page.getByRole("form", { name: "Ingest statement line" });
  await form.getByRole("textbox", { name: /^Amount/ }).fill("1,2,3");
  await form.getByRole("button", { name: "Ingest statement line" }).click();
  await expect(form.getByRole("textbox", { name: /^Amount/ })).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByRole("status")).toContainText("Line not ingested");
  await form.getByRole("textbox", { name: /^Amount/ }).fill("10.00");
  await form.getByLabel("Value date").fill("");
  await form.getByRole("button", { name: "Ingest statement line" }).click();
  await expect(form.getByRole("status")).toContainText("Line not ingested");
  expect(await page.locator("#lines tbody tr").count()).toBe(before);
  // Recovery.
  await form.getByLabel("Value date").fill("2026-11-12");
  await form.getByRole("button", { name: "Ingest statement line" }).click();
  await expect(form.getByRole("status")).toContainText("Line ingested");
  await expect(page.locator("#lines tbody tr")).toHaveCount(before + 1);
});

test("an unexpected server response during navigation still reaches the page", async ({ page, request }) => {
  const id = await scenarioId(request, "s2_returned");
  await open(page, "/clearline/payments");
  let failed = 0;
  await page.route(`**/clearline/payments/${id}*`, (route) => {
    if (route.request().headers()["rsc"]) { failed++; return route.fulfill({ status: 500, contentType: "text/plain", body: "upstream exploded" }); }
    return route.continue();
  });
  await page.locator("#payments").getByRole("link", { name: id }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`), { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByTestId("dim-execution")).toBeVisible();
  expect(failed).toBeGreaterThan(0);
});

/* ---------- Console error boundary (review rc3 m3): try again, reset with its own backup, quota failure ---------- */
/** Makes the workspace provider throw on its next render while window.__clBoom is set (it looks up the acting actor then). */
async function armableProviderFailure(page: Page) {
  await page.addInitScript(() => {
    const find = Array.prototype.find;
    Array.prototype.find = function (this: unknown[], ...args: Parameters<typeof find>) {
      const first = this[0] as { role?: string } | undefined;
      if ((globalThis as { __clBoom?: boolean }).__clBoom && first && first.role === "operator") throw new Error("simulated console failure");
      return find.apply(this, args);
    } as typeof find;
  });
}
async function crashConsole(page: Page) {
  await open(page, "/clearline/settings");
  await page.getByRole("button", { name: "Advance 1 hour" }).click(); // one change, so a workspace is saved
  await expect(page.getByRole("status").filter({ hasText: "Clock advanced" })).toBeVisible();
  await page.evaluate(() => { (globalThis as { __clBoom?: boolean }).__clBoom = true; });
  await page.locator("#cl-actor-global").selectOption("usr_sam"); // actor changes → provider re-renders → throws
  await expect(page.getByTestId("console-boundary")).toBeVisible();
  await expect(page.getByTestId("console-boundary")).toContainText("Nothing has been changed or reset.");
}
const MAIN_KEY = "clearline.console.workspace.v1";
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

test("console boundary: Try again recovers without touching the saved workspace", async ({ page }) => {
  await armableProviderFailure(page);
  await crashConsole(page);
  const saved = await stored(page, MAIN_KEY);
  expect(saved).toContain('"schemaVersion"');
  await page.evaluate(() => { (globalThis as { __clBoom?: boolean }).__clBoom = false; });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(await stored(page, MAIN_KEY)).toBe(saved);
});

test("console boundary: reset keeps a backup in its own slot, never over an earlier backup, and Settings can download it", async ({ page }) => {
  await armableProviderFailure(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) {
    localStorage.setItem("clearline.console.workspace.v1.unreadable-backup", "{earlier unreadable copy");
    localStorage.setItem("clearline.console.workspace.v1.boundary-backup", "{earlier boundary backup");
    sessionStorage.setItem("seeded", "1"); } } catch { /* blocked */ } });
  await crashConsole(page);
  const saved = await stored(page, MAIN_KEY);
  await page.getByRole("button", { name: "Reset saved workspace (keeps a backup)" }).click();
  await expect(page.getByTestId("console-boundary").getByRole("status")).toContainText("clearline.console.workspace.v1.boundary-backup.");
  await expect(page).toHaveURL(/\/clearline$/, { timeout: 10_000 });
  await hydrated(page);
  // The slot was taken, so the new backup went next to it: both earlier backups are intact.
  expect(await stored(page, "clearline.console.workspace.v1.boundary-backup")).toBe("{earlier boundary backup");
  const newKey = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("clearline.console.workspace.v1.boundary-backup.")));
  expect(newKey).toBeTruthy();
  expect(await stored(page, newKey!)).toBe(saved);
  expect(await stored(page, "clearline.console.workspace.v1.unreadable-backup")).toBe("{earlier unreadable copy");
  expect(await stored(page, MAIN_KEY)).toBeNull();
  await goNav(page, "Settings");
  await hydrated(page);
  const list = page.getByTestId("backup-list");
  await expect(list).toContainText("Saved workspace removed after a console error");
  await expect(list).toContainText("Unreadable saved workspace");
  const [dl] = await Promise.all([page.waitForEvent("download"), list.getByRole("button", { name: `Download ${newKey}` }).click()]);
  expect(readFileSync(await dl.path(), "utf8")).toBe(saved);
  // Restore puts it back (backing up the current workspace first).
  await list.getByRole("button", { name: new RegExp(`^Restore ${newKey!.replace(/[.]/g, "\\.")}`) }).click();
  await expect(page).toHaveURL(/\/clearline\/settings#backups$/);
  await hydrated(page);
  expect(await stored(page, MAIN_KEY)).toBe(saved);
});

test("console boundary: when the backup cannot be written, nothing is removed and the person can download, then remove", async ({ page }) => {
  await armableProviderFailure(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if ((globalThis as { __clQuota?: boolean }).__clQuota && k.includes("backup")) throw new DOMException("quota", "QuotaExceededError");
      return setItem.call(this, k, v);
    };
  });
  await crashConsole(page);
  const saved = await stored(page, MAIN_KEY);
  await page.evaluate(() => { (globalThis as { __clQuota?: boolean }).__clQuota = true; });
  await page.getByRole("button", { name: "Reset saved workspace (keeps a backup)" }).click();
  const failed = page.getByTestId("boundary-backup-failed");
  await expect(failed).toContainText("A backup could not be written");
  await expect(failed).toContainText("nothing was removed");
  await expect(failed).not.toContainText("blocked");
  expect(await stored(page, MAIN_KEY)).toBe(saved);
  const [dl] = await Promise.all([page.waitForEvent("download"), failed.getByRole("button", { name: "Download the saved copy" }).click()]);
  expect(readFileSync(await dl.path(), "utf8")).toBe(saved);
  await failed.getByRole("button", { name: "Remove it without a backup" }).click();
  await expect(page).toHaveURL(/\/clearline$/, { timeout: 10_000 });
  await hydrated(page);
  expect(await stored(page, MAIN_KEY)).toBeNull();
});

test("replacing an unreadable copy is refused when its backup cannot be written; replacing without a backup is explicit", async ({ page }) => {
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("clearline.console.workspace.v1", "{not json"); sessionStorage.setItem("seeded", "1"); } } catch { /* blocked */ }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.includes("backup")) throw new DOMException("quota", "QuotaExceededError");
      return setItem.call(this, k, v);
    };
  });
  await open(page, "/clearline");
  await page.getByRole("button", { name: /Replace it with the sample/ }).click();
  await expect(page.getByTestId("replace-failed")).toContainText("could not be written");
  await expect(page.getByTestId("workspace-discarded")).toBeVisible();
  expect(await stored(page, MAIN_KEY)).toBe("{not json"); // never overwritten without a backup
  await page.getByRole("button", { name: /Replace without a backup/ }).click();
  await expect(page.getByTestId("workspace-discarded")).toHaveCount(0);
  const now = await stored(page, MAIN_KEY);
  expect(now).toContain('"schemaVersion"'); // the sample, saved only after the explicit choice
  expect(now).not.toBe("{not json");
  // Settings reset follows the same rule; with nothing waiting it simply resets.
  await goNav(page, "Settings");
  await page.getByRole("button", { name: "Reset to sample" }).click();
  await expect(page.getByText("Workspace reset to the sample")).toBeVisible();
  expect(await stored(page, MAIN_KEY)).toContain('"schemaVersion"');
});

/* ================================================================================================
 * Every visible primary action has a tested result; no decorative controls.
 * ============================================================================================== */
const PRIMARY_RESULTS: Record<string, string> = {
  "New payment intent": "journey step 5 (Overview) and this test",
  "Guided trial": "this test",
  "Open the console": "journey step 3",
  "Start case 01: Successful payment": "clearline-console scenario 1",
  "Start case 02: Returned payout": "this test",
  "Start case 03: Compliance hold": "clearline-console scenario 3",
  "Start case 04: Base Sepolia finality delay": "this test",
  "Start case 05: Funding exposure": "clearline-console scenario 5",
  "Create test intent": "journey step 5",
  "Ingest statement line": "journey step 15",
  "Export workspace (.json)": "this test",
  "Reset to sample": "journey step 19",
  "Replace it with the sample (keeps a backup in this browser)": "clearline-console unreadable workspace test",
};
test("every visible primary action is known and has a meaningful result", async ({ page, request }) => {
  const pages = ["/clearline", "/clearline/payments", "/clearline/investigations", "/clearline/exceptions", "/clearline/reconciliation",
    "/clearline/treasury", "/clearline/treasury/funding", "/clearline/routes", "/clearline/routes/activity", "/clearline/routes/new",
    "/clearline/holds", "/clearline/reports", "/clearline/settings", "/clearline/trial",
    ...(await Promise.all(["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"].map(async (s) => `/clearline/payments/${await scenarioId(request, s)}`)))];
  const unknown: string[] = [];
  for (const p of pages) {
    await open(page, p);
    for (const t of await page.locator('main [class*="ui_primary__"]:visible').allInnerTexts()) if (!PRIMARY_RESULTS[t.trim()]) unknown.push(`${p}: ${t.trim()}`);
  }
  expect(unknown, unknown.join("\n")).toEqual([]);
  // Results not proven elsewhere.
  await open(page, "/clearline");
  await page.getByRole("main").getByRole("link", { name: "Guided trial", exact: true }).click();
  await expect(page).toHaveURL(/\/clearline\/trial$/);
  await page.getByRole("link", { name: "Start case 02: Returned payout" }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${await scenarioId(request, "s2_returned")}$`));
  await open(page, "/clearline/trial");
  await page.getByRole("link", { name: "Start case 04: Base Sepolia finality delay" }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${await scenarioId(request, "s4_chain")}$`));
  await open(page, "/clearline/payments");
  await page.getByRole("main").getByRole("link", { name: "New payment intent" }).click();
  await expect(page).toHaveURL(/\/clearline\/routes\/new$/);
  await open(page, "/clearline/reports");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export workspace (.json)" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^clearline-workspace-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(readFileSync(await dl.path(), "utf8")).schemaVersion).toBeTruthy();
});

test("statement-line presets load the form and say so (no silent buttons)", async ({ page }) => {
  await open(page, "/clearline/reconciliation");
  const form = page.getByRole("form", { name: "Ingest statement line" });
  await form.getByRole("button", { name: "Credit with no reference" }).click();
  await expect(form.getByRole("status")).toContainText("Preset loaded: Credit with no reference");
  await expect(form.getByLabel("Reference as printed")).toHaveValue("");
});

test("the trial page keeps one whole-workspace reset, labelled as such, that restores everything", async ({ page }) => {
  await open(page, "/clearline/routes/new");
  await page.getByLabel("Customer reference").fill("INV-TRIAL-RESET");
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByTestId("intent-id")).toBeVisible();
  await open(page, "/clearline/trial");
  await expect(page.getByRole("button", { name: "Reset the whole workspace" })).toHaveCount(1);
  await page.getByRole("button", { name: "Reset the whole workspace" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Workspace reset to the sample." })).toBeVisible();
  await open(page, "/clearline/payments");
  await expect(page.getByText("INV-TRIAL-RESET")).toHaveCount(0);
});

/* ================================================================================================
 * Responsive and accessibility: 1440 / 1024 / 768 / 390 / 320.
 * ============================================================================================== */
const ALL_PAGES = ["/clearline", "/clearline/payments", "s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding",
  "/clearline/investigations", "/clearline/exceptions", "/clearline/reconciliation", "/clearline/treasury", "/clearline/treasury/funding",
  "/clearline/routes", "/clearline/routes/activity", "/clearline/routes/new", "/clearline/holds", "/clearline/reports",
  "/clearline/docs", "/clearline/settings", "/clearline/trial"];
const pathOf = async (request: APIRequestContext, p: string) => (p.startsWith("/") ? p : `/clearline/payments/${await scenarioId(request, p)}`);

test("no horizontal page overflow on any console page at 320px, and axe finds no violations at 320 and 1024", async ({ page, request, isMobile }) => {
  test.skip(isMobile, "viewport widths set explicitly; runs once");
  test.setTimeout(180_000);
  const axe = axeSource();
  const report: string[] = [];
  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const p of ALL_PAGES) {
      const path = await pathOf(request, p);
      await open(page, path);
      await noHorizontalOverflow(page, `${path} @${width}`);
      if (axe) { const v = await axeViolations(page, axe); if (v.length) report.push(`${path} @${width}: ${v.join(", ")}`); }
    }
  }
  expect(report, report.join("\n")).toEqual([]);
  if (!axe) test.info().annotations.push({ type: "axe", description: "axe-core not installed; set CLEARLINE_AXE_PATH." });
});

test("new interactive states pass axe and do not overflow: filters set, owner editor open, case report open", async ({ page, request }) => {
  const axe = axeSource();
  const report: string[] = [];
  const check = async (label: string) => {
    await noHorizontalOverflow(page, label);
    if (axe) { const v = await axeViolations(page, axe); if (v.length) report.push(`${label}: ${v.join(", ")}`); }
  };
  await open(page, "/clearline/payments?execution=provider_reported_completed&currency=SGD&q=a");
  await check("payments filtered");
  await open(page, "/clearline/exceptions?view=all&owner=usr_maya");
  await page.locator("#queue tbody tr").first().getByText("Change owner").click();
  await check("exceptions owner editor");
  await open(page, "/clearline/investigations");
  await page.locator("#cases tbody tr").first().getByText("Change owner").click();
  await check("investigations owner editor");
  await open(page, `/clearline/payments/${await scenarioId(request, "s2_returned")}`);
  await page.getByRole("button", { name: "View case report" }).click();
  await check("case report open");
  await open(page, "/clearline/reports");
  await page.locator("#cases tbody tr[data-case]").first().getByRole("button", { name: /^View report/ }).click();
  await check("reports case report open");
  expect(report, report.join("\n")).toEqual([]);
});

test("console code links only to in-app or approved destinations (no stale Funding Desk site)", async () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  ["src/app/clearline", "src/components/clearline"].forEach(walk);
  const bad = files.filter((f) => /clearline-funding-desk\.vercel\.app|FUNDING_DESK_URL/.test(readFileSync(f, "utf8")));
  expect(bad).toEqual([]);
});

/* ================================================================================================
 * Code review rc3: M1 (never green while held or awaiting information), m5 (gates use typed text),
 * m1 (no silent full load when it would lose work).
 * ============================================================================================== */
const GREEN = "rgb(20, 108, 67)"; // --cl-success
test("M1: a held payout whose bank debit is matched never shows green, and says the supplier is not paid", async ({ page, request }) => {
  let ws = (await (await request.get(`${API}/workspace`, { headers: AUTH })).json()).data;
  const intent = ws.intents.find((i: { scenario?: string }) => i.scenario === "s3_hold");
  const instr = ws.instructions.find((x: { intentId: string }) => x.intentId === intent.id);
  const r = await request.post(`${API}/reconciliation/statement-lines`, { headers: AUTH, data: { workspace: ws, line: {
    lineId: "SIMBANK-E2E-M1", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "debit", kind: "payment",
    amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: `HARBOUR PAYOUT ${instr.providerPaymentId}`, counterparty: "Harbour FX (sandbox)", valueDate: "2026-11-12" } } });
  expect(r.ok()).toBe(true);
  ws = (await r.json()).workspace;
  const a = await request.post(`${API}/funding-advances`, { headers: { ...AUTH, "X-Clearline-Actor": "usr_maya" }, data: { workspace: ws, input: {
    intentId: intent.id, customerRef: "CUST-E2E-M1", customerName: "M1 Customer (fictional)", supplierName: "M1 Supplier (fictional)",
    invoiceRef: "INV-E2E-M1", dueDate: "2026-12-20", repaymentReference: "RPY-E2E-M1" } } });
  expect(a.ok()).toBe(true);
  ws = (await a.json()).workspace;
  expect(ws.intents.find((i: { id: string }) => i.id === intent.id).status).toMatchObject({ execution: "on_hold", settlement: "verified", settlementScope: "bank_statement" });
  await page.addInitScript((t) => { try { localStorage.setItem("clearline.console.workspace.v1", t); } catch { /* blocked */ } }, JSON.stringify(ws));

  await open(page, `/clearline/payments/${intent.id}`);
  const settle = page.getByTestId("dim-settlement");
  const chip = settle.locator('[data-api-value="verified"] [title^="API value:"]');
  await expect(chip).toContainText("supplier not paid (partner hold)");
  expect(await chip.evaluate((e) => getComputedStyle(e).color)).not.toBe(GREEN);
  expect(await settle.evaluate((e) => getComputedStyle(e).borderTopColor)).not.toBe(GREEN);

  await open(page, "/clearline/payments");
  const row = page.locator("#payments tr", { hasText: intent.id }).locator('[data-api-value="verified"] [title^="API value:"]');
  await expect(row).toContainText("partner hold");
  expect(await row.evaluate((e) => getComputedStyle(e).color)).not.toBe(GREEN);

  await open(page, "/clearline/treasury/funding");
  const card = page.locator("section", { has: page.getByTestId("supplier-payout-hold") }).first();
  const fchip = card.locator('[data-api-value="verified"] [title^="API value:"]');
  await expect(fchip).toContainText("supplier not paid (partner hold)");
  expect(await fchip.evaluate((e) => getComputedStyle(e).color)).not.toBe(GREEN);
  await expect(card.getByTestId("supplier-payout-hold")).toContainText("Partner holds the payout — supplier not paid");
});

test("M1: awaiting information with verified evidence is not green either (defence in depth)", async ({ page, request }) => {
  const ws = (await (await request.get(`${API}/workspace`, { headers: AUTH })).json()).data;
  const i = ws.intents.find((x: { scenario?: string }) => x.scenario === "s1_success");
  i.status = { ...i.status, execution: "awaiting_information", settlement: "verified", settlementScope: "bank_statement" };
  await page.addInitScript((t) => { try { localStorage.setItem("clearline.console.workspace.v1", t); } catch { /* blocked */ } }, JSON.stringify(ws));
  await open(page, `/clearline/payments/${i.id}`);
  await expect(page.getByTestId("workspace-discarded")).toHaveCount(0);
  const chip = page.getByTestId("dim-settlement").locator('[data-api-value="verified"] [title^="API value:"]');
  await expect(chip).toContainText("provider needs information");
  expect(await chip.evaluate((e) => getComputedStyle(e).color)).not.toBe(GREEN);
});

test("m5: action gates check what the person typed, not a placeholder", async ({ page, request }) => {
  await open(page, `/clearline/payments/${await scenarioId(request, "s2_returned")}`);
  const kase = page.locator("#case");
  await kase.getByLabel("Add note").fill("checked <b>bank</b>");
  const add = kase.getByRole("button", { name: "Add note" });
  await expect(add).toBeDisabled();
  await expect(page.locator(`[id="${await add.getAttribute("aria-describedby")}"]`)).toContainText("invalid_field");
  await kase.getByLabel("Add note").fill("Checked the bank statement.");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(kase.getByRole("status").first()).toContainText("Add note — recorded by the engine");
});

test("m1: with browser storage blocked, a stalled page change asks before a full load instead of reloading silently", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  const id = await scenarioId(request, "s1_success");
  await open(page, "/clearline/trial");
  let documents = 0;
  page.on("request", (r) => { if (r.resourceType() === "document" && r.url().includes(`/clearline/payments/${id}`)) documents++; });
  await page.route(`**/clearline/payments/${id}*`, (route) => { if (route.request().headers()["rsc"]) return; return route.continue(); }); // never answered
  await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
  const stuck = page.getByTestId("nav-stuck");
  await expect(stuck).toBeVisible({ timeout: 15_000 });
  await expect(stuck).toContainText("browser storage is unavailable");
  expect(documents, "no silent full load").toBe(0);
  await expect(page).toHaveURL(/\/clearline\/trial$/);
  await stuck.getByRole("button", { name: /Load the page fully/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
  await hydrated(page);
  expect(documents).toBe(1);
});
