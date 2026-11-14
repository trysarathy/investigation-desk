/**
 * R2 in real browsers on a production build: the nonce Content-Security-Policy produces zero violations
 * and zero console errors across the console, the guided trial, the docs and the mentor demo; client
 * navigation and hydration still work; and an injected inline script without the nonce is blocked.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { scriptSrc, startServer, type Server } from "./server";

type Violation = { directive: string; blocked: string; sample: string; url: string };
declare global { interface Window { __csp?: Violation[]; __pwned?: number; __marker?: string } }

/** Records securitypolicyviolation events (from before any page script runs), console errors and page errors. */
async function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp!.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, url: location.pathname }));
  });
  const violations = async () => (await page.evaluate(() => window.__csp ?? []).catch(() => [])) as Violation[];
  return { consoleErrors, pageErrors, violations };
}

async function hydrated(page: Page) {
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}

async function scenarioPath(request: APIRequestContext, key: string) {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const i = ((await r.json()).data as { id: string; scenario?: string }[]).find((x) => x.scenario === key);
  return `/clearline/payments/${i!.id}`;
}

const CONSOLE_PAGES = [
  "/clearline", "/clearline/payments", "/clearline/investigations", "/clearline/exceptions", "/clearline/reconciliation",
  "/clearline/treasury", "/clearline/treasury/funding", "/clearline/routes", "/clearline/routes/activity", "/clearline/routes/new",
  "/clearline/holds", "/clearline/reports", "/clearline/settings", "/clearline/trial", "/clearline/docs",
];
const SCENARIOS = ["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"];

test.describe("customer preview (CLEARLINE_CUSTOMER_PREVIEW=1)", () => {
  test.describe.configure({ mode: "serial" });
  let server: Server;
  test.beforeAll(async () => { server = await startServer({ CLEARLINE_CUSTOMER_PREVIEW: "1" }); });
  test.afterAll(async () => server?.stop());

  test("every console page, every sample payment, a moved URL and a 404: nonce CSP, zero violations, zero console errors", async ({ page, request }) => {
    const w = await watch(page);
    const pages = [...CONSOLE_PAGES];
    for (const s of SCENARIOS) pages.push(await scenarioPath(request, s));
    let seen = 0;
    for (const p of [...pages, "/clearline/control/liquidity"]) {
      const res = await page.goto(p); // the moved URL arrives here after its 308
      expect(scriptSrc(res!.headers()["content-security-policy"]), p).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'$/);
      await hydrated(page);
      seen++;
    }
    const errorsBefore404 = [...w.consoleErrors];
    const nf = await page.goto("/clearline/no-such-page");
    expect(nf!.status()).toBe(404);
    expect(scriptSrc(nf!.headers()["content-security-policy"])).toMatch(/'nonce-[^']+' 'strict-dynamic'$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const v = await w.violations();
    console.log(`[R2] preview: ${seen + 1} documents, ${v.length} CSP violations, ${errorsBefore404.length} console errors, ${w.pageErrors.length} page errors`);
    expect(v).toEqual([]);
    expect(errorsBefore404).toEqual([]);
    // The only console error after the 404 is Chrome's own note that the document answered 404.
    expect(w.consoleErrors.slice(errorsBefore404.length).filter((e) => !/status of 404/.test(e))).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });

  test("guided trial: cases 01, 03 and 05 and a new payment from create to investigation, with zero violations", async ({ page }) => {
    const w = await watch(page);
    await page.goto("/clearline/trial");
    await hydrated(page);
    await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
    await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/);
    await hydrated(page);
    await expect(page.getByTestId("dim-execution")).toContainText("Provider reports completed");

    await page.goto("/clearline/trial");
    await hydrated(page);
    await page.getByRole("link", { name: "Start case 03: Compliance hold" }).click();
    await expect(page).toHaveURL(/\/clearline\/holds$/);
    const hold = page.locator('section[id^="hold_"]').first();
    await hold.getByRole("button", { name: "Submit documents" }).click();
    await expect(hold.getByRole("status")).toContainText("Submit documents — recorded by the engine");

    await page.goto("/clearline/trial");
    await hydrated(page);
    await page.getByRole("link", { name: "Start case 05: Funding exposure" }).click();
    await expect(page).toHaveURL(/\/clearline\/treasury\/funding$/);
    await expect(page.getByTestId("funding-outstanding").first()).toContainText("20,000.00");

    await page.goto("/clearline/routes/new");
    await hydrated(page);
    await page.getByLabel("Customer reference").fill("INV-CSP-001");
    await expect(page.getByLabel("Idempotency key")).not.toHaveValue("");
    await page.getByRole("button", { name: "Create test intent" }).click();
    await expect(page.getByTestId("intent-id")).toBeVisible();
    const id = (await page.getByTestId("intent-id").innerText()).trim();
    await page.getByRole("button", { name: "Request quotes" }).click();
    await page.getByRole("button", { name: /^Choose / }).and(page.locator(":enabled")).first().click();
    await page.locator("#checker").selectOption("usr_daniel");
    await page.getByRole("button", { name: "Approve as checker" }).click();
    await page.getByRole("button", { name: "Submit instruction" }).click();
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
    await expect(page.getByTestId("evidence-timeline")).toContainText("Instruction approved (checker");

    const v = await w.violations();
    console.log(`[R2] guided trial: ${v.length} CSP violations, ${w.consoleErrors.length} console errors, ${w.pageErrors.length} page errors`);
    expect(v).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });

  test("client navigation stays in the same document (no full reload) and hydration works", async ({ page, isMobile }) => {
    const w = await watch(page);
    await page.goto("/clearline");
    await hydrated(page);
    await page.evaluate(() => { window.__marker = "same-document"; });
    if (isMobile) await page.getByRole("button", { name: /menu|navigation/i }).first().click();
    await page.getByRole("link", { name: "Payments", exact: true }).first().click();
    await expect(page).toHaveURL(/\/clearline\/payments$/);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Payments");
    expect(await page.evaluate(() => window.__marker)).toBe("same-document");
    expect(await w.violations()).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });

  test("the API reference and the mentor demo work under the nonce policy", async ({ page }, info) => {
    const w = await watch(page);
    await page.goto("/clearline/docs");
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "Test-mode API v1", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "OpenAPI 3.1 (YAML)" })).toHaveAttribute("href", "/clearline/docs/openapi.yaml");

    const res = await page.goto("/mentor-demo");
    expect(scriptSrc(res!.headers()["content-security-policy"])).toMatch(/'nonce-[^']+' 'strict-dynamic'$/);
    await expect(page.getByRole("heading", { name: "Work queue" })).toBeVisible();
    await page.getByRole("button", { name: "Open advance review" }).click();
    await page.getByRole("button", { name: "Prepare advance" }).click();
    await expect(page.getByText("Advance prepared; now switch to treasury approver.")).toBeVisible();
    await page.getByLabel("Demo role").selectOption("approver");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Treasury approval recorded in synthetic timeline.")).toBeVisible();
    if (info.project.name !== "mobile") {
      await page.getByRole("button", { name: "Outstanding ledger" }).click();
      await page.getByLabel("Demo role").selectOption("operator");
      await page.getByLabel("Replay date").fill("2026-11-10");
      await page.getByRole("button", { name: "Record supplier paid" }).click();
      await expect(page.getByText("Synthetic supplier payout recorded.")).toBeVisible();
    }
    const v = await w.violations();
    console.log(`[R2] docs + mentor demo: ${v.length} CSP violations, ${w.consoleErrors.length} console errors, ${w.pageErrors.length} page errors`);
    expect(v).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });

  test("an injected inline script or inline event handler without the nonce is blocked; the page still hydrates", async ({ page }) => {
    const w = await watch(page);
    // Simulates stored HTML injection: the server's own HTML with attacker markup added (no nonce).
    await page.route("**/clearline/payments", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace("<body>", '<body><script>window.__pwned=1</script><img src="/x.png" onerror="window.__pwned=2">');
      await route.fulfill({ response: res, body: html });
    });
    await page.goto("/clearline/payments");
    await hydrated(page);
    expect(await page.evaluate(() => window.__pwned ?? null), "neither injected script ran").toBeNull();
    // Not tested: a <script> created at runtime by an already-running script. 'strict-dynamic' trusts it
    // by design (CSP3), so it is only reachable by an attacker who already runs script. Also not tested
    // at runtime: eval, because Chrome exempts DevTools-driven code (page.evaluate) from CSP; the header
    // check below shows script-src has neither 'unsafe-eval' nor 'unsafe-inline'.
    expect(scriptSrc((await page.request.get("/clearline/payments")).headers()["content-security-policy"])).not.toMatch(/unsafe-eval|unsafe-inline/);
    const v = await w.violations();
    console.log(`[R2] injection: ${v.length} violations reported: ${JSON.stringify(v.map((x) => `${x.directive}:${x.blocked}`))}`);
    expect(v.filter((x) => x.blocked === "inline").length, "the parser-inserted <script> and the onerror handler are both blocked").toBeGreaterThanOrEqual(2);
    expect(v.every((x) => x.directive.startsWith("script-src"))).toBe(true);
    expect(w.pageErrors).toEqual([]);
  });
});

test.describe("full app (investigation desk; no deployment mode set)", () => {
  test.describe.configure({ mode: "serial" });
  let server: Server;
  test.beforeAll(async () => { server = await startServer({}); });
  test.afterAll(async () => server?.stop());

  test("legacy pages render under the nonce policy; the root layout's inline theme script runs with its nonce", async ({ page }) => {
    const w = await watch(page);
    await page.addInitScript(() => { try { localStorage.setItem("desk.theme", "dark"); } catch { /* storage blocked */ } });
    let n = 0;
    for (const p of ["/requests", "/requests/new", "/requests/all", "/payments", "/inbox", "/books", "/settings", "/investigate", "/bulk", "/funding", "/mentor-demo", "/clearline"]) {
      const res = await page.goto(p);
      expect(res!.status(), p).toBeLessThan(500);
      expect(scriptSrc(res!.headers()["content-security-policy"]), p).toMatch(/'nonce-[^']+' 'strict-dynamic'$/);
      await page.waitForLoadState("networkidle");
      if (!p.startsWith("/clearline") && p !== "/mentor-demo") expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), `theme script ran on ${p}`).toBe("dark");
      n++;
    }
    const v = await w.violations();
    console.log(`[R2] full app: ${n} documents, ${v.length} CSP violations, ${w.consoleErrors.length} console errors, ${w.pageErrors.length} page errors`);
    expect(v).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
});

test.describe("funding-only deployment (CLEARLINE_FUNDING_ONLY=1)", () => {
  test.describe.configure({ mode: "serial" });
  let server: Server;
  test.beforeAll(async () => { server = await startServer({ CLEARLINE_FUNDING_ONLY: "1" }); });
  test.afterAll(async () => server?.stop());

  test("the funding desk renders under the nonce policy with zero violations", async ({ page }) => {
    const w = await watch(page);
    const res = await page.goto("/funding");
    expect(res!.status()).toBe(200);
    expect(scriptSrc(res!.headers()["content-security-policy"])).toMatch(/'nonce-[^']+' 'strict-dynamic'$/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toBeEmpty();
    expect(await w.violations()).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
});
