import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/*
 * Independent QA, release candidate 3 (3e66fa7): console tests against a real `next start`
 * (CLEARLINE_CUSTOMER_PREVIEW=1). Run with a config whose testDir is tests/qa-release-rc3 (see
 * QA_SECURITY_REVIEW_RC3.md). "DEFECT (...)" tests assert the correct behaviour and FAIL on 3e66fa7.
 * The axe test needs axe-core: set QA_AXE_PATH to axe.min.js (skipped when absent).
 *
 * Copied unchanged from QA's scratch spec (qa3/tests/qa-release-rc3/console-rc3.spec.ts) into the console suite,
 * except one selector: the acceptance form's test id is "accept-difference" since 25a1a33, which generalised the
 * form to late-dated and approved acceptances (was "accept-over-amount"). No assertion was changed.
 */

const KEY = "clearline.console.workspace.v1";
const AXE = process.env.QA_AXE_PATH ?? "";
const PAGES = ["/clearline", "/clearline/trial", "/clearline/payments", "/clearline/payments/pi_00027", "/clearline/payments/pi_00090", "/clearline/exceptions",
  "/clearline/investigations", "/clearline/reconciliation", "/clearline/holds", "/clearline/treasury", "/clearline/treasury/funding", "/clearline/routes",
  "/clearline/routes/new", "/clearline/routes/activity", "/clearline/reports", "/clearline/settings", "/clearline/docs", "/mentor-demo"];

async function hydrated(page: Page) {
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}
async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}
function watch(page: Page) {
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => { bad.push(`dialog: ${d.message()}`); void d.dismiss(); });
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) bad.push(`csp: ${m.text().slice(0, 160)}`); });
  return bad;
}
async function goNav(page: Page, label: string) {
  if (!(await page.locator("#cl-nav").isVisible())) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: label, exact: true }).click();
}

async function completedPayout(page: Page, ref: string): Promise<string> {
  await open(page, "/clearline/routes/new");
  await page.getByLabel("Customer reference").fill(ref);
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByTestId("intent-id")).toBeVisible();
  const id = (await page.getByTestId("intent-id").innerText()).trim();
  await page.getByRole("button", { name: "Request quotes" }).click();
  await page.locator("#routes").getByRole("button", { name: /^Choose / }).and(page.locator(":enabled")).first().click();
  await page.locator("#checker").selectOption("usr_daniel");
  await page.getByRole("button", { name: "Approve as checker" }).click();
  await page.getByRole("button", { name: "Submit instruction" }).click();
  await page.getByRole("button", { name: "Simulate next provider event" }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
  await hydrated(page);
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId("dim-execution").locator('[data-api-value="provider_reported_completed"]').count()) break;
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
  }
  return id;
}

async function overAmountException(page: Page, ref: string, factor: number) {
  await goNav(page, "Reconciliation");
  await hydrated(page);
  const form = page.getByRole("form", { name: "Ingest statement line" });
  await form.getByRole("button", { name: `Debit for ${ref} (by provider reference)` }).click();
  const amount = form.getByRole("textbox", { name: /^Amount/ });
  const base = Number((await amount.inputValue()).replace(/,/g, ""));
  await amount.fill((Math.round(base * factor * 100) / 100).toFixed(2));
  await form.getByRole("button", { name: "Ingest statement line" }).click();
  await expect(form.getByRole("status")).toContainText("RC_OVERPAYMENT");
  await open(page, "/clearline/exceptions?q=RC_OVERPAYMENT");
  const row = page.locator("#queue tbody tr").filter({ hasText: "RC_OVERPAYMENT" }).last();
  const excId = (await row.getByRole("link").first().getAttribute("href"))!.slice(1);
  const panel = page.locator(`section[id="${excId}"]`);
  await panel.getByText("Work this exception").click();
  await panel.getByRole("button", { name: "Assign owner" }).click();
  await expect(panel.getByRole("status").first()).toContainText("Assign owner — recorded by the engine");
  await panel.getByLabel("Description").fill("Bank fee advice for the over-amount (fictional)");
  await panel.getByRole("button", { name: "Attach evidence metadata" }).click();
  await expect(panel.getByRole("status").first()).toContainText("Attach evidence — recorded by the engine");
  return { panel, excId };
}

test("DEFECT (Medium) M2: a 5% over-amount the console lets one person accept leaves the case with no way to close in the console", async ({ page }) => {
  test.setTimeout(180_000);
  const id = await completedPayout(page, "INV-QA3-5PCT");
  const { panel, excId } = await overAmountException(page, "INV-QA3-5PCT", 1.05);
  const accept = panel.getByTestId("accept-difference");
  await accept.getByLabel("Why the over-amount is accepted").fill("Bank fee of 5% (fictional).");
  const btn = accept.getByRole("button", { name: "Accept the over-amount" });
  // The hint says "up to 1%"; at 3e66fa7 the engine's dry run allows 5% (a second person must approve).
  if (await btn.isEnabled()) {
    await btn.click();
    await expect(page.locator(`section[id="${excId}"]`)).toHaveCount(0); // resolved: it leaves the open queue
    await open(page, `/clearline/payments/${id}`);
    await page.getByRole("button", { name: "Assign owner" }).first().click();
    // The engine refuses to close the case until a second person approves …
    await expect(page.getByText(/SECOND_APPROVAL_REQUIRED|second person/).first()).toBeVisible();
    // Correct: the console offers the second person's approval (approve_acceptance) somewhere a person can reach.
    await expect(page.getByRole("button", { name: /approve.*(acceptance|over-amount|difference)/i })).toHaveCount(1);
  } else {
    // If the console refuses, the hint and the engine agree (this branch passes).
    await expect(page.locator(`[id="${await btn.getAttribute("aria-describedby")}"]`)).toContainText("DIFFERENCE_NOT_ACCEPTABLE");
  }
});

test("DEFECT (Medium) M1: reopening an accepted over-amount exception breaks the workspace (next action and reload refuse it)", async ({ page }) => {
  test.setTimeout(180_000);
  const bad = watch(page);
  await completedPayout(page, "INV-QA3-REOPEN");
  const { panel, excId } = await overAmountException(page, "INV-QA3-REOPEN", 1.005);
  const accept = panel.getByTestId("accept-difference");
  await accept.getByLabel("Why the over-amount is accepted").fill("Bank fee of 0.5% (fictional).");
  await accept.getByRole("button", { name: "Accept the over-amount" }).click();
  await open(page, `/clearline/exceptions?view=all&q=${excId}`);
  const done = page.locator(`section[id="${excId}"]`);
  await done.getByText("Work this exception").click();
  await done.getByLabel("Reason to reopen").fill("The fee advice belonged to another payment.");
  await done.getByRole("button", { name: "Reopen" }).click();
  await expect(done.getByRole("status").first()).toContainText(/Reopen — recorded by the engine/);
  // Every action gate on this workspace now reads "This workspace cannot be loaded … Reset to the sample".
  await expect(page.getByText(/This workspace cannot be loaded/)).toHaveCount(0, { timeout: 5000 });
  await page.reload();
  await hydrated(page);
  await expect(page.getByText(/cannot be loaded/i)).toHaveCount(0);
  expect(bad).toEqual([]);
});

test("XSS: payloads in URL parameters and in every text field of the payment and statement forms never execute", async ({ page }) => {
  test.setTimeout(300_000);
  const bad = watch(page);
  const P = `"><img src=x id=qa3x onerror=alert(1)><svg onload=alert(2)><script>alert(3)</script>javascript:alert(4)`;
  const enc = encodeURIComponent(P);
  for (const u of [`/clearline/payments?q=${enc}`, `/clearline/exceptions?q=${enc}&severity=${enc}`, `/clearline/investigations?q=${enc}&owner=${enc}`,
    `/clearline/payments/${enc}`, `/clearline/payments?status=${enc}&currency=${enc}`]) {
    await page.goto(u);
    await hydrated(page);
    expect(await page.locator("#qa3x, svg[onload], img[onerror]").count(), u).toBe(0);
  }
  for (const path of ["/clearline/routes/new", "/clearline/reconciliation", "/clearline/holds", "/clearline/exceptions", "/clearline/investigations"]) {
    await open(page, path);
    for (const d of await page.locator("details:not([open]) > summary").all()) await d.click({ timeout: 1000 }).catch(() => {});
    const fields = page.locator("input[type=text]:visible:enabled, input:not([type]):visible:enabled, textarea:visible:enabled, input[type=search]:visible:enabled");
    const n = await fields.count();
    for (let i = 0; i < n; i++) await fields.nth(i).fill(P, { timeout: 1000 }).catch(() => {});
    for (const b of await page.locator("form button[type=submit]:enabled:visible").all()) await b.click({ timeout: 2000 }).catch(() => {});
    expect(await page.locator("#qa3x, svg[onload], img[onerror]").count(), path).toBe(0);
  }
  expect(bad.filter((x) => !x.startsWith("csp:"))).toEqual([]);
});

const CRAFTED: [string, () => string][] = [
  ["not JSON", () => "{not json"],
  ["JSON null", () => "null"],
  ["array", () => "[]"],
  ["huge string (3 MB)", () => JSON.stringify({ schemaVersion: 1, mode: "sandbox", label: "A".repeat(3_000_000) })],
  ["deep nesting", () => "[".repeat(50_000) + "]".repeat(50_000)],
  ["proto pollution", () => '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"schemaVersion":1}'],
  ["schemaVersion 2 (future)", () => JSON.stringify({ schemaVersion: 2, mode: "sandbox" })],
];

for (const [name, raw] of CRAFTED) {
  test(`crafted stored workspace (${name}) is explained, not executed, and the console still works`, async ({ page }) => {
    const bad = watch(page);
    await page.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("qa3-seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("qa3-seeded", "1"); } } catch { /* quota */ } }, [KEY, raw()] as const);
    await page.goto("/clearline/payments");
    await hydrated(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();
    expect(bad.filter((x) => x.startsWith("pageerror") || x.startsWith("dialog"))).toEqual([]);
  });
}

test("crafted stored workspace with an HTML actor name renders as text", async ({ page, request }) => {
  const bad = watch(page);
  const ws = (await (await request.get("/api/clearline/test/v1/workspace", { headers: { Authorization: "Bearer cl_test_demo" } })).json()).data;
  ws.actors.push({ id: "usr_qa3", name: `<img src=x id=qa3x onerror=alert(1)>`, role: "operator" });
  ws.cases[0].ownerId = "usr_qa3";
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("qa3-seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("qa3-seeded", "1"); } }, [KEY, JSON.stringify(ws)] as const);
  for (const p of ["/clearline/investigations", "/clearline/settings", `/clearline/payments/${ws.cases[0].intentId}`]) {
    await open(page, p);
    expect(await page.locator("#qa3x").count(), p).toBe(0);
  }
  expect(bad.filter((x) => !x.startsWith("csp:"))).toEqual([]);
});

test("no horizontal overflow and no axe violations on every console page", async ({ page }) => {
  test.skip(!AXE || !existsSync(AXE), "QA_AXE_PATH not set");
  test.setTimeout(240_000);
  const out: string[] = [];
  for (const p of PAGES) {
    await page.goto(p);
    if (p !== "/mentor-demo") await hydrated(page);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (o.sw > o.cw + 1) out.push(`${p}: overflow ${o.sw} > ${o.cw}`);
    // page.evaluate runs through DevTools, which the nonce CSP does not block (an inline <script> would be).
    if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(readFileSync(AXE, "utf8"));
    const v = await page.evaluate(async () => (await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run({ resultTypes: ["violations"] })).violations.map((x) => `${x.id}(${x.impact})×${x.nodes.length}`));
    if (v.length) out.push(`${p}: ${v.join(", ")}`);
  }
  expect(out).toEqual([]);
});
