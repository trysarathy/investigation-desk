import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Sample scenario intent ids come from the engine (via the v1 test API), never hard-coded. */
const ids = new Map<string, string>();
async function scenario(request: APIRequestContext, key: string): Promise<string> {
  if (!ids.size) {
    const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
    for (const i of (await r.json()).data as { id: string; scenario?: string }[]) if (i.scenario) ids.set(i.scenario, i.id);
  }
  const id = ids.get(key);
  if (!id) throw new Error(`no sample intent for scenario ${key}`);
  return `/clearline/payments/${id}`;
}

/** Fresh browser context per test = fresh localStorage = the deterministic sample workspace. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
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

/** Create → quote → choose (maker) → approve (checker ≠ maker) → submit. Returns the intent id. */
async function connectToSubmitted(page: Page, ref: string, outcome = "success") {
  await open(page, "/clearline/routes/new");
  await page.getByLabel("Customer reference").fill(ref);
  await page.getByLabel("Sandbox outcome").selectOption(outcome);
  await expect(page.getByLabel("Idempotency key")).not.toHaveValue("");
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByTestId("intent-id")).toBeVisible();
  const id = (await page.getByTestId("intent-id").innerText()).trim();
  await expect(page.getByTestId("idempotency-key")).toContainText("idem_");
  await page.getByRole("button", { name: "Request quotes" }).click();
  await expect(page.getByText("Indicative sandbox quote — not executable").first()).toBeVisible();
  await expect(page.getByText("Not eligible").first()).toBeVisible();
  await page.getByRole("button", { name: /^Choose / }).and(page.locator(":enabled")).first().click();
  // Maker as checker: the engine's dry run refuses, so the button is disabled and says why.
  await page.locator("#checker").selectOption("usr_maya");
  await expect(page.getByRole("button", { name: "Approve as checker" })).toBeDisabled();
  await expect(page.locator("#approve").getByTestId("action-reason").first()).toContainText("maker_checker_violation");
  await expect(page.locator("#approve").getByTestId("action-reason").first()).toContainText("The same person cannot prepare and approve");
  await page.locator("#checker").selectOption("usr_daniel");
  await page.getByRole("button", { name: "Approve as checker" }).click();
  await page.getByRole("button", { name: "Submit instruction" }).click();
  await expect(page.getByRole("button", { name: "Simulate next provider event" })).toBeVisible();
  return id;
}

const SCENARIOS = ["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"] as const;
const NAV_EXPECTED: Record<string, [string, string][]> = {
  Operations: [["Overview", "/clearline"], ["Payments", "/clearline/payments"], ["Investigations", "/clearline/investigations"], ["Reconciliation", "/clearline/reconciliation"], ["Treasury & Funding", "/clearline/treasury"]],
  "Set-up and reference": [["Routes & Providers", "/clearline/routes"], ["Compliance Holds", "/clearline/holds"], ["Reports", "/clearline/reports"], ["Developers", "/clearline/docs"], ["Settings", "/clearline/settings"]],
};
const REDIRECTS: Record<string, string> = {
  "/clearline/connect": "/clearline/routes/new",
  "/clearline/connect/quotes": "/clearline/routes",
  "/clearline/connect/activity": "/clearline/routes/activity",
  "/clearline/control": "/clearline/reconciliation",
  "/clearline/control/reconciliation": "/clearline/reconciliation",
  "/clearline/control/liquidity": "/clearline/treasury",
  "/clearline/control/funding": "/clearline/treasury/funding",
  "/clearline/control/holds": "/clearline/holds",
  "/clearline/control/reports": "/clearline/reports",
};

test.describe("Clearline console", () => {
  test("shell: test-mode marker, two-level navigation, breadcrumbs, website and contact links", async ({ page, isMobile }) => {
    await open(page, "/clearline");
    await expect(page.getByTestId("test-mode-marker")).toHaveText("TEST MODE · FICTIONAL DATA");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.locator('a[href="https://clearline-marketing.vercel.app"]').first()).toBeAttached();
    await expect(page.locator('a[href^="mailto:aashmiin.k.2025@accountancy.smu.edu.sg"]').first()).toBeAttached();
    if (isMobile) {
      await expect(page.locator("#cl-nav")).toBeHidden();
      await page.getByRole("button", { name: "Menu" }).click();
    } else {
      await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    }
    const nav = page.getByRole("navigation", { name: "Console" });
    for (const [group, labels] of Object.entries(NAV_EXPECTED)) {
      const list = nav.getByRole("list", { name: group });
      await expect(list.getByRole("link")).toHaveText(labels.map(([l]) => l));
      for (const [l, href] of labels) await expect(list.getByRole("link", { name: l, exact: true })).toHaveAttribute("href", href);
    }
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
    // Every summary metric is a link to its underlying cases.
    const metrics = page.getByRole("link", { name: /View|Open exceptions queue/ });
    expect(await metrics.count()).toBeGreaterThanOrEqual(8);
    await page.getByRole("link", { name: /Open exceptions.*Open exceptions queue/ }).click();
    await expect(page).toHaveURL(/\/clearline\/exceptions/);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("ConsoleInvestigationsExceptions queue");
    await expect(page.getByRole("navigation", { name: "Investigations pages" }).getByRole("link", { name: "Exceptions queue" })).toHaveAttribute("aria-current", "page");
  });

  test("every nav destination loads with one h1, the right breadcrumb and an active nav item", async ({ page }) => {
    for (const [label, href] of Object.values(NAV_EXPECTED).flat()) {
      await open(page, href);
      await expect(page.locator("main h1")).toHaveCount(1);
      if (href !== "/clearline") await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(label === "Developers" ? "Developers" : label);
      await expect(page.locator(`#cl-nav a[href="${href}"]`)).toHaveAttribute("aria-current", "page");
    }
    for (const [href, crumbs] of [
      ["/clearline/treasury/funding", "ConsoleTreasury & FundingFunding exposure"],
      ["/clearline/routes/activity", "ConsoleRoutes & ProvidersProvider activity"],
      ["/clearline/routes/new", "ConsoleRoutes & ProvidersNew payment intent"],
      ["/clearline/trial", "ConsoleGuided trial"],
    ] as const) {
      await open(page, href);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(crumbs);
    }
  });

  test("moved URLs answer 308 to their new home, keep the query, and land on a working page", async ({ page, request }) => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      const r = await request.get(from + "?probe=1", { maxRedirects: 0 });
      expect(r.status(), from).toBe(308);
      expect(new URL(r.headers()["location"], "http://x").pathname + new URL(r.headers()["location"], "http://x").search, from).toBe(`${to}?probe=1`);
      expect((await request.get(from)).status(), `${from} followed`).toBe(200);
    }
    await page.goto("/clearline/control/reconciliation?group=exact#lines");
    await expect(page).toHaveURL(/\/clearline\/reconciliation\?group=exact#lines$/);
    await expect(page.getByRole("heading", { name: "Reconciliation", level: 1 })).toBeVisible();
    await page.goto("/clearline/connect");
    await expect(page).toHaveURL(/\/clearline\/routes\/new$/);
    await expect(page.getByRole("heading", { name: "New payment intent", level: 1 })).toBeVisible();
  });

  for (const sc of SCENARIOS) {
    test(`investigation ${sc}: sections A–E, three separate truths with human labels and exact API values`, async ({ page, request }) => {
      await open(page, await scenario(request, sc));
      for (const t of ["section-a", "section-b", "section-c", "explanation", "section-e"]) await expect(page.getByTestId(t)).toBeVisible();
      const a = page.getByTestId("section-a");
      for (const dt of ["Payment ID", "Customer reference", "Origin → destination", "Amount sent", "Provider and route", "Last update"]) await expect(a.getByText(dt, { exact: true })).toBeVisible();
      await expect(page.getByTestId("operational-status")).toContainText(" · ");
      // B: three panels, each a human label with the exact API value beside it.
      for (const dim of ["dim-execution", "dim-settlement", "dim-reconciliation"]) {
        const d = page.getByTestId(dim);
        const tag = d.locator("[data-api-value]").first();
        const value = await tag.getAttribute("data-api-value");
        expect(value, dim).toMatch(/^[a-z_]+$/);
        await expect(d.locator("code").first(), dim).toHaveText(value!);
        await expect(d.locator('[title^="API value:"]'), dim).toHaveCount(1);
        const human = (await tag.locator('[title^="API value:"]').innerText()).trim();
        expect(human.length, `${dim} human label`).toBeGreaterThan(3);
        expect(human, `${dim} human label`).not.toBe(value);
      }
      await expect(page.getByText(/payment successful/i)).toHaveCount(0);
      // C: timeline columns.
      const tl = page.getByTestId("evidence-timeline");
      for (const h of ["Time (SGT)", "Source", "Event", "Processing outcome", "Supporting reference", "Why it matters"]) await expect(tl.getByRole("columnheader", { name: h })).toBeAttached();
      expect(await tl.locator("tbody tr").count()).toBeGreaterThan(2);
      // D: findings.
      for (const t of ["finding-known", "finding-unknown", "finding-contradicts", "finding-outstanding", "finding-owner"]) await expect(page.getByTestId(t)).toBeVisible();
    });
  }

  test("every action on every scenario's investigation either works or shows the engine's reason", async ({ page, request }) => {
    for (const sc of SCENARIOS) {
      await open(page, await scenario(request, sc));
      const actions = page.getByTestId("section-e").locator("button[data-action]");
      const n = await actions.count();
      expect(n, sc).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < n; i++) {
        const b = actions.nth(i);
        const name = await b.getAttribute("data-action");
        if (await b.isDisabled()) {
          const rid = await b.getAttribute("aria-describedby");
          expect(rid, `${sc} ${name} has a reason`).toBeTruthy();
          await expect(page.locator(`[id="${rid}"]`), `${sc} ${name}`).not.toHaveText("");
        }
      }
      // An enabled action, clicked, reports what the engine recorded (no silent success).
      const sim = page.getByRole("button", { name: "Simulate next provider event" });
      if (await sim.isEnabled()) {
        await sim.click();
        await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
      }
    }
    // A viewer may not act: everything the engine refuses says so.
    await open(page, await scenario(request, "s2_returned"));
    await page.getByLabel("Acting as").first().selectOption("usr_alex");
    await expect(page.getByRole("button", { name: "Assign owner" })).toBeDisabled();
    await expect(page.locator("#case").getByTestId("action-reason").first()).toContainText("unauthorized_actor");
  });

  test("scenario 1: successful payment keeps three separate truths", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
    await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/); // trial link uses scenarioIntentId
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("dim-execution")).toContainText("Provider reports completed");
    await expect(page.getByTestId("dim-execution")).toContainText("provider_reported_completed");
    await expect(page.getByTestId("dim-settlement").locator('[data-api-value="verified"]')).toBeVisible();
    await expect(page.getByTestId("dim-settlement")).toContainText("bank_statement");
    await expect(page.getByTestId("dim-reconciliation").locator('[data-api-value="matched"]')).toBeVisible();
    const tl = page.getByTestId("evidence-timeline");
    await expect(tl).toContainText("Independent evidence");
    await expect(tl).toContainText("RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW");
    await expect(tl).toContainText("Provider claim: it does not prove settlement on its own.");
    await expect(page.getByTestId("last-event")).toContainText("payout.completed");
    await expect(page.getByTestId("last-verification")).not.toContainText("None yet");
    // No case on a clean payment: export says why instead of pretending.
    await expect(page.getByRole("button", { name: "Export case report (.txt)" })).toBeDisabled();
    await expect(page.locator("#payment-actions")).toContainText("No investigation case is open for this payment.");
    // Cancelling after submission is refused by the engine, in words.
    await expect(page.getByRole("button", { name: "Cancel payment" })).toBeDisabled();
    await expect(page.locator("#payment-actions")).toContainText("invalid_transition");
  });

  test("scenario 2: returned payout — assign, note, resolve gated by the engine", async ({ page, request }) => {
    await open(page, await scenario(request, "s2_returned"));
    await expect(page.getByTestId("dim-execution").locator('[data-api-value="returned"]')).toBeVisible();
    await expect(page.getByTestId("dim-reconciliation").locator('[data-api-value="exception"]')).toBeVisible();
    await expect(page.getByTestId("return-status")).toContainText(/Return (reported by (the )?provider|confirmed (by|on the) statement)/) // engine HUMAN_LABELS.returnStatus (rc3);
    const kase = page.locator("#case");
    await kase.getByLabel("Assign owner").selectOption("usr_maya");
    await kase.getByRole("button", { name: "Assign owner" }).click();
    await expect(kase.getByRole("status")).toContainText("Assign owner — recorded by the engine");
    await kase.getByLabel("Add note").fill("Called the supplier; account name differs.");
    await kase.getByRole("button", { name: "Add note" }).click();
    await expect(kase.getByText("Called the supplier; account name differs.")).toBeVisible();
    await kase.getByLabel("Resolution note").fill("Trying to close early");
    // The engine's words explain the block before any click.
    const gate = kase.getByTestId("resolve-gate");
    await expect(gate.getByRole("button", { name: "Resolve" })).toBeDisabled();
    await expect(gate.getByTestId("action-reason")).toContainText(/^Payment cannot be closed\./);
    await expect(gate.getByTestId("action-reason")).toContainText(/OPEN_EXCEPTIONS|OPEN_INFO_REQUESTS|HOLD_UNDECIDED/);
    await page.locator("#exceptions").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/clearline\/exceptions/);
  });

  test("scenario 3: compliance hold — reviewer decision recorded, never auto-released", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 03: Compliance hold" }).click();
    await expect(page).toHaveURL(/\/clearline\/holds$/);
    await expect(page.getByRole("button", { name: /^Release/ })).toHaveCount(0);
    const hold = page.locator('section[id^="hold_"]').first();
    await hold.getByRole("button", { name: "Submit documents" }).click();
    await expect(hold.getByRole("status")).toContainText("Submit documents — recorded by the engine");
    // As an operator, assigning a reviewer is refused before the click, with the reason.
    await expect(hold.getByRole("button", { name: "Assign reviewer" })).toBeDisabled();
    await expect(hold.getByTestId("action-reason").first()).toContainText("unauthorized_actor");
    await hold.getByLabel("Assign reviewer").selectOption("usr_priya");
    await page.getByLabel("Acting as").first().selectOption("usr_priya");
    await hold.getByRole("button", { name: "Assign reviewer" }).click();
    await expect(hold.getByRole("status")).toContainText("Assign reviewer — recorded by the engine");
    await hold.getByLabel("Reason (required)").fill("Invoice matches purchase order; request partner's release note.");
    await hold.getByRole("button", { name: "Record reviewer decision" }).click();
    await expect(hold.getByRole("status")).toContainText("Record reviewer decision — recorded by the engine");
    await expect(hold).toContainText("Request more");
  });

  test("scenario 4: Base Sepolia finality delay advances to verified evidence", async ({ page, request }) => {
    await open(page, await scenario(request, "s4_chain"));
    await expect(page.getByTestId("dim-settlement").locator('[data-api-value="pending_finality"], [data-api-value="observed"]')).toBeVisible();
    await expect(page.getByTestId("dim-settlement")).toContainText("not a bank credit");
    for (let i = 0; i < 20; i++) {
      if (await page.getByTestId("dim-settlement").locator('[data-api-value="verified"]').count()) break;
      await page.getByRole("button", { name: "Simulate next provider event" }).click();
      await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
    }
    await expect(page.getByTestId("dim-settlement").locator('[data-api-value="verified"]')).toBeVisible();
    await expect(page.getByTestId("dim-settlement")).toContainText("onchain_transfer");
  });

  test("scenario 5: funding exposure 50,000 → 30,000 repaid → 20,000 outstanding", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 05: Funding exposure" }).click();
    await expect(page).toHaveURL(/\/clearline\/treasury\/funding$/);
    await expect(page.getByTestId("funding-principal").first()).toContainText("50,000.00");
    await expect(page.getByTestId("funding-repaid").first()).toContainText("30,000.00");
    await expect(page.getByTestId("funding-outstanding").first()).toContainText("20,000.00");
    await expect(page.getByTestId("funding-exceptions").first()).toContainText("20,000.00");
    await expect(page.getByTestId("supplier-paid-basis").first()).toContainText(/provider_reported|verified_settlement|none/);
    await expect(page.getByRole("link", { name: "/mentor-demo" })).toBeVisible();
    await page.getByRole("navigation", { name: "Treasury & Funding pages" }).getByRole("link", { name: "Liquidity" }).click();
    await expect(page).toHaveURL(/\/clearline\/treasury$/);
    await expect(page.getByRole("heading", { name: "Liquidity", level: 1 })).toBeVisible();
  });

  test("New payment intent: create → quote → maker/checker → submit → event → investigation", async ({ page }) => {
    const id = await connectToSubmitted(page, "INV-E2E-301");
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("INV-E2E-301");
    await expect(page.getByTestId("evidence-timeline")).toContainText("Instruction prepared (maker");
    await expect(page.getByTestId("evidence-timeline")).toContainText("Instruction approved (checker");
    await expect(page.getByTestId("evidence-timeline")).toContainText("Provider event");
  });

  test("failure injection: duplicate and contradictory events are recorded, not applied blindly", async ({ page }) => {
    const id = await connectToSubmitted(page, "INV-E2E-302");
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    for (const inj of ["duplicate", "contradictory"]) {
      await page.getByLabel("Failure injection").selectOption(inj);
      await page.getByRole("button", { name: "Simulate next provider event" }).click();
      await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
    }
    await expect(page.getByTestId("evidence-timeline")).toContainText(/PE_DUPLICATE_IGNORED|PE_CONTRADICTORY_EXCEPTION_RAISED|PE_STORED_LATE_NO_REGRESSION/);
  });

  test("reset to sample restores the five scenarios and drops user data", async ({ page }) => {
    await open(page, "/clearline/routes/new");
    await page.getByLabel("Customer reference").fill("INV-RESET-1");
    await page.getByRole("button", { name: "Create test intent" }).click();
    await expect(page.getByTestId("intent-id")).toBeVisible();
    await open(page, "/clearline/payments");
    await expect(page.getByText("INV-RESET-1")).toBeVisible(); // persisted across navigation + reload
    await page.reload();
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByText("INV-RESET-1")).toBeVisible();
    await open(page, "/clearline/settings");
    await page.getByRole("button", { name: "Reset to sample" }).click();
    await expect(page.getByText("Workspace reset to the sample")).toBeVisible();
    await open(page, "/clearline/payments");
    await expect(page.getByText("INV-RESET-1")).toHaveCount(0);
    await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(5);
  });

  test("works when browser storage is unavailable", async ({ page, request }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await open(page, "/clearline/settings");
    await expect(page.getByText(/Unavailable — changes last until you reload/)).toBeVisible();
    await open(page, await scenario(request, "s1_success"));
    await expect(page.getByTestId("dim-execution")).toBeVisible();
  });

  test("investigation page is operable by keyboard alone with visible focus", async ({ page, isMobile, request }) => {
    test.skip(isMobile, "keyboard walk runs on desktop");
    await open(page, await scenario(request, "s4_chain"));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    let reached = false;
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const cs = el ? getComputedStyle(el) : null;
        return { text: el?.textContent?.trim() ?? "", outline: cs ? parseFloat(cs.outlineWidth) : 0, tag: el?.tagName ?? "" };
      });
      expect(info.tag).not.toBe("BODY");
      expect(info.outline, `focus ring on ${info.text}`).toBeGreaterThan(0);
      if (info.text === "Simulate next provider event") { reached = true; break; }
    }
    expect(reached).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("#simulate").getByRole("status")).toContainText(/recorded by the engine|not applied/);
  });

  test("no horizontal page overflow on any console page", async ({ page, request }) => {
    for (const path of ["/clearline", "/clearline/payments", await scenario(request, "s1_success"), await scenario(request, "s2_returned"),
      await scenario(request, "s3_hold"), await scenario(request, "s4_chain"), await scenario(request, "s5_funding"),
      "/clearline/investigations", "/clearline/exceptions", "/clearline/routes/new", "/clearline/routes", "/clearline/routes/activity",
      "/clearline/docs", "/clearline/reconciliation", "/clearline/treasury", "/clearline/treasury/funding",
      "/clearline/holds", "/clearline/reports", "/clearline/settings", "/clearline/trial"]) {
      await open(page, path);
      await noHorizontalOverflow(page, path);
    }
  });

  test("customer preview only serves allowed routes", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/clearline$/);
    for (const p of ["/requests", "/funding", "/inbox", "/settings", "/api/funding", "/books"]) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect(r.status(), p).toBe(404);
    }
    expect((await request.get("/api/clearline/test/v1/health")).status()).toBe(200);
    // The legacy unversioned API passes the preview middleware but is retired (410).
    const legacy = await request.get("/api/clearline/test/health");
    expect(legacy.status()).toBe(410);
    expect((await legacy.json()).error.code).toBe("endpoint_retired");
    expect((await request.get("/mentor-demo")).status()).toBe(200);
    await open(page, "/clearline/docs");
    await expect(page.getByRole("heading", { name: "Test-mode API v1", level: 1 })).toBeVisible();
    const spec = await request.get("/clearline/docs/openapi.yaml");
    expect(spec.status()).toBe(200);
    expect(spec.headers()["content-type"]).toContain("yaml");
    expect(await spec.text()).toMatch(/^openapi: 3\.1/);
  });

  test("API reference documents v1 with real examples and the engine's enums", async ({ page, request }) => {
    await open(page, "/clearline/docs");
    await expect(page.getByRole("link", { name: "OpenAPI 3.1 (YAML)" })).toHaveAttribute("href", "/clearline/docs/openapi.yaml");
    for (const v of ["provider_reported_completed", "pending_finality", "onchain_transfer", "partially_matched", "stored_late_no_regression", "maker_checker_violation"])
      await expect(page.locator("main").getByText(v, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("example-webhook-late")).toContainText('"processingOutcome": "stored_late_no_regression"');
    await expect(page.getByTestId("example-webhook-duplicate")).toContainText('"outcome": "duplicate_ignored"');
    await expect(page.getByTestId("example-webhook-stale")).toContainText('"processingOutcome": "rejected_signature"');
    await expect(page.getByTestId("example-self-approve")).toContainText("HTTP 403");
    await expect(page.locator("#legacy")).toContainText("endpoint_retired");
    // The live API still answers the way the captured example says.
    const live = await request.post("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" }, data: { input: { amountMinor: 12.5 } } });
    expect(live.status()).toBe(422);
  });

  test("exceptions queue shows engine due dates", async ({ page }) => {
    await open(page, "/clearline/exceptions");
    const due = page.locator('#queue td[data-label="Due"]');
    await expect(due.first()).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    expect(await due.filter({ hasText: "—" }).count()).toBe(0);
  });
});

test("breadcrumbs name the right section, also after a redirect from an old URL", async ({ page, request }) => {
  await page.goto("/clearline/control/funding");
  await expect(page).toHaveURL(/\/clearline\/treasury\/funding$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("ConsoleTreasury & FundingFunding exposure");
  const id = (await scenario(request, "s2_returned")).split("/").pop();
  await page.goto(await scenario(request, "s2_returned"));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(`ConsolePayments${id}`);
});

test("no hex colour (or rgb/hsl literal) in console code outside tokens.css; tokens.css is the v2 copy", async () => {
  const roots = ["src/app/clearline", "src/components/clearline"];
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css|mjs|js)$/.test(f)) files.push(p); } };
  roots.forEach(walk);
  expect(files.length).toBeGreaterThan(30);
  const bad: string[] = [];
  for (const f of files) {
    if (f.endsWith("src/app/clearline/tokens.css")) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      // Colour literals only: a # followed by 3/4/6/8 hex digits and not part of an id/fragment, or rgb()/hsl().
      if (/(^|[\s:("'`,])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![-_\w])/.test(line) || /\b(rgba?|hsla?)\(/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  expect(bad, bad.join("\n")).toEqual([]);
  const tokens = readFileSync("src/app/clearline/tokens.css", "utf8");
  expect(tokens).toContain("Midnight & Electric Blue");
  for (const t of ["--cl-midnight: #101827", "--cl-blue: #376BEB", "--cl-canvas: #F8FAFC", "--cl-ice: #DCE7FF"]) expect(tokens).toContain(t);
  for (const retired of ["#F5F1E8", "#D04B31", "#A93A24"]) expect(tokens).not.toContain(retired);
});

test("rendered console uses the v2 brand: midnight sidebar, canvas workspace, Electric Blue primary action and focus", async ({ page, isMobile }) => {
  test.skip(isMobile, "computed styles checked once at desktop size");
  await open(page, "/clearline");
  const css = await page.evaluate(() => {
    const g = (sel: string, prop: string) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(prop);
    return { sidebar: g("aside", "background-color"), page: g(".cl", "background-color"), primary: g('a[href="/clearline/routes/new"]', "background-color") };
  });
  expect(css).toEqual({ sidebar: "rgb(16, 24, 39)", page: "rgb(248, 250, 252)", primary: "rgb(55, 107, 235)" });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineColor)).toBe("rgb(55, 107, 235)");
});

test("an unreadable saved workspace is kept untouched until the person chooses, then backed up and replaced", async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("clearline.console.workspace.v1", "{not json"); sessionStorage.setItem("seeded", "1"); } } catch { /* blocked */ } });
  await open(page, "/clearline");
  const n = page.getByTestId("workspace-discarded");
  await expect(n).toContainText("Your saved workspace could not be read.");
  await expect(n).toContainText("The saved copy has not been changed");
  await expect(n).toContainText("Reason:");
  const stored = () => page.evaluate(() => ({ main: localStorage.getItem("clearline.console.workspace.v1"), backup: localStorage.getItem("clearline.console.workspace.v1.unreadable-backup") }));
  // Acting in the console does not overwrite the unreadable copy.
  await open(page, "/clearline/routes/new");
  await page.getByLabel("Customer reference").fill("INV-NOT-SAVED");
  await page.getByRole("button", { name: "Create test intent" }).click();
  await expect(page.getByTestId("intent-id")).toBeVisible();
  expect(await stored()).toEqual({ main: "{not json", backup: null });
  await page.reload();
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("workspace-discarded")).toBeVisible(); // still undecided: notice again
  // The person decides: backup kept, sample saved, notice gone for good.
  await page.getByRole("button", { name: /Replace it with the sample/ }).click();
  await expect(page.getByTestId("workspace-discarded")).toHaveCount(0);
  const after = await stored();
  expect(after.backup).toBe("{not json");
  expect(after.main).toContain('"schemaVersion"');
  await page.reload();
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("workspace-discarded")).toHaveCount(0);
});

test("a moved URL missing from the redirect table can never send Location: undefined", async ({ request }) => {
  for (const from of Object.keys(REDIRECTS)) {
    const r = await request.get(from, { maxRedirects: 0 });
    expect(r.headers()["location"] ?? "", from).not.toContain("undefined");
  }
});

/* ---------- Engine CHANGE 4: states built through the real v1 API, then loaded into the browser ---------- */
const API = "/api/clearline/test/v1";
const AUTH = { Authorization: "Bearer cl_test_demo" };
type Ws = { intents: { id: string; scenario?: string; amountMinor: number; sourceCurrency: string }[]; instructions: { intentId: string; providerId: string; providerPaymentId?: string }[]; exceptions: { id: string; intentId?: string; status: string }[]; asOf: string };
async function v1(request: APIRequestContext, path: string, body: Record<string, unknown>): Promise<Ws> {
  const r = await request.post(API + path, { headers: AUTH, data: body });
  const j = await r.json();
  expect(r.ok(), `${path}: ${JSON.stringify(j.error)}`).toBe(true);
  return j.workspace as Ws;
}
async function sample(request: APIRequestContext): Promise<Ws> {
  return (await (await request.get(API + "/workspace", { headers: AUTH })).json()).data as Ws;
}
const pick = (ws: Ws, scenario: string) => {
  const intent = ws.intents.find((i) => i.scenario === scenario)!;
  return { intent, instr: ws.instructions.find((x) => x.intentId === intent.id)! };
};
async function load(page: Page, ws: Ws, path: string) {
  await page.addInitScript((text) => { try { window.localStorage.setItem("clearline.console.workspace.v1", text); } catch { /* storage blocked */ } }, JSON.stringify(ws));
  await open(page, path);
}

test("provider settlement report is labelled as not allocated and grouped as informational, never exact", async ({ page, request }) => {
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s1_success");
  ws = await v1(request, "/reconciliation/statement-lines", { workspace: ws, line: {
    lineId: "PSR-E2E-0001", source: "provider_settlement_report", accountRef: "Northline settlement report (fictional)", direction: "debit", kind: "payment",
    amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: instr.providerPaymentId, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  await load(page, ws, "/clearline/reconciliation?group=informational");
  const row = page.locator("#lines tr", { hasText: "PSR-E2E-0001" });
  await expect(row).toContainText("Provider report (not allocated)");
  await expect(row).toContainText("RC_PROVIDER_REPORT_ONLY");
  await open(page, "/clearline/reconciliation?group=exact");
  await expect(page.locator("#lines")).not.toContainText("PSR-E2E-0001");
});

test("returned payout with debit and confirmed return both allocated shows net zero, supplier unpaid", async ({ page, request }) => {
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s2_returned");
  ws = await v1(request, "/reconciliation/statement-lines", { workspace: ws, line: {
    lineId: "DBS-E2E-9001", source: "bank_statement", accountRef: "BANK-USD-OPS (fictional)", direction: "debit", kind: "payment",
    amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: `NORTHLINE PAYOUT ${instr.providerPaymentId}`, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  for (const e of ws.exceptions.filter((x) => x.intentId === intent.id && x.status !== "resolved")) {
    ws = await v1(request, `/exceptions/${e.id}/assign`, { workspace: ws, ownerId: "usr_maya" });
    ws = await v1(request, `/exceptions/${e.id}/evidence`, { workspace: ws, evidence: { kind: "funds_returned_confirmation", description: "Return credit on the bank statement (fictional)" } });
    ws = await v1(request, `/exceptions/${e.id}/resolve`, { workspace: ws, note: "Return confirmed; correction intent to follow." });
  }
  await load(page, ws, `/clearline/payments/${intent.id}`);
  await expect(page.getByTestId("dim-execution").locator('[data-api-value="returned"]')).toBeVisible();
  await expect(page.getByTestId("dim-reconciliation")).toContainText("Returned — net zero");
  await expect(page.getByTestId("dim-reconciliation")).not.toContainText(/^Matched/);
  await expect(page.getByTestId("return-status")).toContainText("supplier is still unpaid");
  await expect(page.getByTestId("dim-settlement")).toContainText("No settlement evidence");
});

test("a terminal provider event during a compliance hold is held, not applied, and titled for a person", async ({ page, request }) => {
  const { createHmac } = await import("node:crypto");
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s3_hold");
  const t = Math.floor(Date.parse(ws.asOf) / 1000);
  const rawBody = JSON.stringify({ id: "evt_e2e_return_on_hold", type: "payout.returned", provider_payment_id: instr.providerPaymentId, sequence: 9, occurred_at: ws.asOf });
  const sig = `t=${t},v1=${createHmac("sha256", `test_whsec_${instr.providerId}_public_example`).update(`${t}.${rawBody}`).digest("hex")}`;
  const r = await request.post(API + "/events/webhook", { headers: { ...AUTH, "X-Sandbox-Signature": sig }, data: { workspace: ws, providerId: instr.providerId, rawBody } });
  const j = await r.json();
  expect(j.outcome).toBe("contradictory_exception_raised");
  ws = j.workspace;
  await load(page, ws, `/clearline/payments/${intent.id}`);
  await expect(page.getByTestId("dim-execution")).not.toContainText("Returned");
  await expect(page.getByTestId("evidence-timeline")).toContainText("Held: not applied");
  await expect(page.locator("#exceptions")).toContainText("Payout returned or failed during a compliance hold (not applied)");
  await open(page, "/clearline/exceptions");
  await expect(page.locator("#queue")).toContainText("EV_TERMINAL_EVENT_WHILE_ON_HOLD");
});

/* ---------- Engine CHANGE 5: F1 / F2 visible in the console ---------- */
test("F2: an under-amount provider report through the v1 API shows expected, reported and difference", async ({ page, request }) => {
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s1_success");
  const short = intent.amountMinor - 12_345;
  ws = await v1(request, "/reconciliation/statement-lines", { workspace: ws, line: {
    lineId: "PSR-E2E-F2", source: "provider_settlement_report", accountRef: "Northline settlement report (fictional)", direction: "debit", kind: "payment",
    amountMinor: short, currency: intent.sourceCurrency, reference: instr.providerPaymentId, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  await load(page, ws, `/clearline/payments/${intent.id}`);
  const fmt = (m: number) => `${intent.sourceCurrency} ${(m / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const d = page.getByTestId("finding-outstanding").getByTestId("amount-difference").first();
  await expect(d.getByTestId("diff-expected")).toHaveText(fmt(intent.amountMinor));
  await expect(d.getByTestId("diff-reported")).toHaveText(fmt(short));
  await expect(d.getByTestId("diff-difference")).toHaveText(fmt(12_345));
  await expect(d).toContainText("RC_UNDER_AMOUNT_REPORT");
  await expect(d).toContainText("provider_settlement_report");
  await expect(page.getByTestId("finding-contradicts")).toContainText("RC_UNDER_AMOUNT_REPORT");
  await expect(page.getByTestId("dim-reconciliation").locator('[data-api-value="exception"]')).toBeVisible();
  await open(page, "/clearline/exceptions");
  await expect(page.getByTestId("exception-amount-difference").first()).toContainText(fmt(12_345));
});

test("F1: a provider settlement report on a returned payout is shown as a contradiction", async ({ page, request }) => {
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s2_returned");
  ws = await v1(request, "/reconciliation/statement-lines", { workspace: ws, line: {
    lineId: "PSR-E2E-F1", source: "provider_settlement_report", accountRef: "Northline settlement report (fictional)", direction: "debit", kind: "payment",
    amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: instr.providerPaymentId, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  await load(page, ws, `/clearline/payments/${intent.id}`);
  await expect(page.getByTestId("finding-contradicts")).toContainText("RC_REPORT_ON_TERMINAL_PAYOUT");
  await expect(page.getByTestId("evidence-timeline")).toContainText("PSR-E2E-F1");
  await expect(page.getByTestId("dim-execution").locator('[data-api-value="returned"]')).toBeVisible();
});

test("a link click is never swallowed: if client navigation stalls, the page loads the target in full", async ({ page }) => {
  await open(page, "/clearline/trial");
  // Stall every client-side (RSC) fetch for the payment page: the soft navigation starts but never commits
  // (an aborted fetch would make Next fall back to a full load by itself and prove nothing).
  let blocked = 0;
  await page.route("**/clearline/payments/**", (route) => {
    if (route.request().headers()["rsc"]) { blocked++; return; } // never answered
    return route.continue();
  });
  await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
  await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/, { timeout: 15_000 });
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("dim-execution")).toBeVisible();
  expect(blocked, "the soft navigation was attempted and blocked").toBeGreaterThan(0);
});

/* ---------- QA v2: overflow at tablet / small-laptop widths (L2) and unique landmarks + axe (L4) ---------- */
const CONSOLE_PAGES = ["/clearline", "/clearline/payments", "s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding",
  "/clearline/investigations", "/clearline/exceptions", "/clearline/reconciliation", "/clearline/treasury", "/clearline/treasury/funding",
  "/clearline/routes", "/clearline/routes/activity", "/clearline/routes/new", "/clearline/holds", "/clearline/reports",
  "/clearline/docs", "/clearline/settings", "/clearline/trial"];
const pathOf = async (request: APIRequestContext, p: string) => (p.startsWith("/") ? p : scenario(request, p));

for (const width of [768, 1024]) {
  test(`no horizontal page overflow on any console page at ${width}px`, async ({ page, request, isMobile }) => {
    test.skip(isMobile, "viewport widths set explicitly; runs once");
    await page.setViewportSize({ width, height: 900 });
    for (const p of CONSOLE_PAGES) {
      const path = await pathOf(request, p);
      await open(page, path);
      await noHorizontalOverflow(page, `${path} @${width}`);
    }
  });
}

/** Landmarks of the same role must have unique accessible names (axe landmark-unique), checked without dependencies. */
async function duplicateLandmarks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Accessible-name text: aria-hidden subtrees are not part of a name (review rc3 m4).
    const visibleText = (n: Node): string => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
      if (!(n instanceof Element) || n.getAttribute("aria-hidden") === "true") return "";
      return [...n.childNodes].map(visibleText).join("");
    };
    const nameOf = (el: Element) => {
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => { const t = document.getElementById(id); return t ? visibleText(t).replace(/\s+/g, " ").trim() : ""; }).join(" ").trim();
      return (el.getAttribute("aria-label") ?? "").trim();
    };
    const hidden = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const st = getComputedStyle(e); if (st.display === "none" || st.visibility === "hidden" || e.getAttribute("aria-hidden") === "true") return true; } return false; };
    const roleOf = (el: Element): string | null => {
      const r = el.getAttribute("role");
      if (r) return ["region", "navigation", "main", "complementary", "banner", "contentinfo", "form", "search"].includes(r) ? r : null;
      const t = el.tagName.toLowerCase();
      if (t === "nav") return "navigation";
      if (t === "main") return "main";
      if (t === "aside") return "complementary";
      if (t === "section") return nameOf(el) ? "region" : null;
      if (t === "form") return nameOf(el) ? "form" : null;
      if (t === "header" || t === "footer") return el.closest("main, section, article, aside, nav") ? null : t === "header" ? "banner" : "contentinfo";
      return null;
    };
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("body *")) {
      const r = roleOf(el);
      if (!r) continue;
      if (hidden(el)) continue;
      const k = `${r}: "${nameOf(el)}"`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  });
}

function axeSource(): string | null {
  const req = createRequire(join(process.cwd(), "package.json"));
  const candidates = [process.env.CLEARLINE_AXE_PATH];
  try { candidates.push(req.resolve("axe-core/axe.min.js")); } catch { /* not installed in this repo */ }
  const found = candidates.find((p) => p && existsSync(p));
  return found ? readFileSync(found, "utf8") : null;
}

test("every console page has unique landmarks; axe finds no violations when axe-core is available", async ({ page, request }) => {
  const axe = axeSource();
  const report: string[] = [];
  for (const p of CONSOLE_PAGES) {
    const path = await pathOf(request, p);
    await open(page, path);
    const dup = await duplicateLandmarks(page);
    expect(dup, `${path} duplicate landmarks`).toEqual([]);
    if (axe) {
      await page.addScriptTag({ content: axe });
      const v = await page.evaluate(async () => {
        const r = await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run({ resultTypes: ["violations"] });
        return r.violations.map((x) => `${x.id} (${x.impact}, ${x.nodes.length})`);
      });
      if (v.length) report.push(`${path}: ${v.join(", ")}`);
    }
  }
  expect(report, report.join("\n")).toEqual([]);
  if (!axe) test.info().annotations.push({ type: "axe", description: "axe-core not installed; set CLEARLINE_AXE_PATH to run the full axe check. Landmark uniqueness was still checked." });
});

test("defence in depth: settlement `verified` is never green when execution is returned, failed, cancelled, expired, on hold or awaiting information", async ({ page, request }) => {
  // The engine never produces this state; a hand-edited workspace does, so the console's own guard is what is tested.
  const base = await sample(request) as unknown as { intents: { scenario?: string; status: Record<string, string> }[] };
  const green = "rgb(20, 108, 67)"; // --cl-success
  // rc3: the engine's parseWorkspace now refuses a terminal payout carrying verified settlement, so for those
  // states the stronger guarantee holds (never rendered at all); on_hold / awaiting_information are valid
  // engine states (review rc3 M1) and keep exercising the console's own guard.
  let guarded = 0;
  for (const exec of ["returned", "failed", "cancelled", "expired", "on_hold", "awaiting_information"]) {
    const ws = JSON.parse(JSON.stringify(base));
    const i = ws.intents.find((x: { scenario?: string }) => x.scenario === "s1_success");
    i.status = { ...i.status, execution: exec, settlement: "verified", settlementScope: "bank_statement" };
    await page.context().clearCookies();
    await page.goto("/clearline");
    await page.evaluate((t) => localStorage.setItem("clearline.console.workspace.v1", t), JSON.stringify(ws));
    await open(page, `/clearline/payments/${(await scenario(request, "s1_success")).split("/").pop()}`);
    if (await page.getByTestId("workspace-discarded").count()) {
      expect(["returned", "failed", "cancelled", "expired"], `${exec} must not be refused`).toContain(exec);
      await expect(page.getByTestId("workspace-discarded"), exec).toContainText("status.settlement");
      // The refused state is never rendered: the page shows the sample's own payment instead.
      await expect(page.getByTestId("dim-execution").locator(`[data-api-value="${exec}"]`), exec).toHaveCount(0);
      continue;
    }
    guarded++;
    const chip = page.getByTestId("dim-settlement").locator('[data-api-value="verified"] [title^="API value:"]');
    await expect(chip, exec).toBeVisible();
    expect(await chip.evaluate((e) => getComputedStyle(e).color), exec).not.toBe(green);
    expect(await page.getByTestId("dim-settlement").evaluate((e) => getComputedStyle(e).borderTopColor), exec).not.toBe(green);
    await open(page, "/clearline/payments");
    const row = page.locator('#payments [data-api-value="verified"] [title^="API value:"]').first();
    expect(await row.evaluate((e) => getComputedStyle(e).color), `${exec} list`).not.toBe(green);
  }
  expect(guarded, "on_hold and awaiting_information exercise the console guard").toBeGreaterThanOrEqual(2);
  // Control: a normal verified payment is green.
  await page.evaluate(() => localStorage.removeItem("clearline.console.workspace.v1"));
  await open(page, await scenario(request, "s1_success"));
  expect(await page.getByTestId("dim-settlement").locator('[data-api-value="verified"] [title^="API value:"]').evaluate((e) => getComputedStyle(e).color)).toBe(green);
});

test("Funding: an advance on a payout the partner holds says so next to settlement, with a link to the hold", async ({ page, request }) => {
  let ws = await sample(request);
  const { intent, instr } = pick(ws, "s3_hold");
  // C1: the bank debit for the held payout is matched, so settlement is verified, yet the partner holds the money.
  ws = await v1(request, "/reconciliation/statement-lines", { workspace: ws, line: {
    lineId: "DBS-E2E-HOLD1", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "debit", kind: "payment",
    amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: `HARBOUR PAYOUT ${instr.providerPaymentId}`, counterparty: "Harbour FX (sandbox)", valueDate: "2026-11-12" } });
  expect((ws as unknown as { intents: { id: string; status: { execution: string; settlement: string } }[] }).intents.find((i) => i.id === intent.id)!.status).toMatchObject({ execution: "on_hold", settlement: "verified" });
  const r = await request.post(API + "/funding-advances", { headers: { ...AUTH, "X-Clearline-Actor": "usr_maya" }, data: { workspace: ws, input: {
    intentId: intent.id, customerRef: "CUST-E2E-HOLD", customerName: "Hold Customer (fictional)", supplierName: "Hold Supplier (fictional)",
    invoiceRef: "INV-E2E-HOLD", dueDate: "2026-12-20", repaymentReference: "RPY-E2E-HOLD1" } } });
  const j = await r.json();
  expect(r.ok(), JSON.stringify(j.error)).toBe(true);
  ws = j.workspace;
  const advanceId = (j.createdIds ?? j.value?.createdIds ?? [])[0] ?? (ws as unknown as { advances: { id: string; intentId: string }[] }).advances.find((a) => a.intentId === intent.id)!.id;
  const d = await request.post(`${API}/funding-advances/${advanceId}/decision`, { headers: { ...AUTH, "X-Clearline-Actor": "usr_daniel" }, data: { workspace: ws, outcome: "approve", reason: "Within limit (fictional review)." } });
  expect(d.ok(), JSON.stringify((await d.json()).error ?? null)).toBe(true);
  ws = (await d.json()).workspace;
  await load(page, ws, "/clearline/treasury/funding");
  const held = page.locator(`[id="${advanceId}"]`).getByTestId("supplier-payout-hold");
  await expect(held).toContainText("Partner holds the payout — supplier not paid");
  await expect(held.getByRole("link", { name: "Open the hold" })).toHaveAttribute("href", /^\/clearline\/holds#hold_/);
  await expect(page.locator(`[id="${advanceId}"]`).getByTestId("supplier-paid-basis")).toContainText("none");
  // Only the held payout's advance carries the notice; the sample's own advance is not held.
  await expect(page.getByTestId("supplier-payout-hold")).toHaveCount(1);
});
