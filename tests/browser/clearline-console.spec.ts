import { test, expect, type Page } from "@playwright/test";

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
  await open(page, "/clearline/connect");
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
  // Maker tries to approve their own instruction: the engine refuses.
  await page.locator("#checker").selectOption("usr_maya");
  await page.getByRole("button", { name: "Approve as checker" }).click();
  // The engine refuses: a non-approver (role check) or the maker themself (maker ≠ checker).
  await expect(page.getByText(/not applied — .*\((unauthorized_actor|maker_checker_violation)\)/)).toBeVisible();
  await page.locator("#checker").selectOption("usr_daniel");
  await page.getByRole("button", { name: "Approve as checker" }).click();
  await page.getByRole("button", { name: "Submit instruction" }).click();
  await expect(page.getByRole("button", { name: "Simulate next provider event" })).toBeVisible();
  return id;
}

test.describe("Clearline console", () => {
  test("shell: test-mode marker, navigation, breadcrumbs, website and contact links", async ({ page }) => {
    await open(page, "/clearline");
    await expect(page.getByTestId("test-mode-marker")).toHaveText("TEST MODE · FICTIONAL DATA");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.locator('a[href="https://clearline-marketing.vercel.app"]').first()).toBeAttached();
    await expect(page.locator('a[href^="mailto:aashmiin.k.2025@accountancy.smu.edu.sg"]').first()).toBeAttached();
    // Every summary metric is a link to its underlying cases.
    const metrics = page.getByRole("link", { name: /View|Open exceptions queue/ });
    expect(await metrics.count()).toBeGreaterThanOrEqual(8);
    await page.getByRole("link", { name: /Open exceptions.*Open exceptions queue/ }).click();
    await expect(page).toHaveURL(/\/clearline\/exceptions/);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Workspace");
  });

  test("scenario 1: successful payment keeps three separate dimensions", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
    await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/); // documented scenario id resolves to the engine id
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("dim-execution")).toContainText("Provider reports completed");
    await expect(page.getByTestId("dim-settlement")).toBeVisible();
    await expect(page.getByTestId("dim-reconciliation")).toContainText("Matched");
    await expect(page.getByText(/payment successful/i)).toHaveCount(0);
    const tl = page.getByTestId("evidence-timeline");
    await expect(tl).toContainText("Source:");
    await expect(tl).toContainText("Statement record");
    await expect(tl).toContainText("Matching decision");
    await expect(page.getByTestId("explanation")).toContainText("Known");
  });

  test("scenario 2: returned payout — assign, note, resolve gated by the engine", async ({ page }) => {
    await open(page, "/clearline/payments/pi_s2_returned");
    await expect(page.getByTestId("dim-execution")).toContainText("Returned");
    const kase = page.locator("#case");
    await kase.getByLabel("Assign owner").selectOption("usr_maya");
    await kase.getByRole("button", { name: "Assign owner" }).click();
    await expect(kase.getByText("Owner assigned: recorded.")).toBeVisible();
    await kase.getByLabel("Add note").fill("Called the supplier; account name differs.");
    await kase.getByRole("button", { name: "Add note" }).click();
    await expect(kase.getByText("Called the supplier; account name differs.")).toBeVisible();
    await kase.getByLabel("Resolution note").fill("Trying to close early");
    await kase.getByRole("button", { name: "Resolve" }).click();
    await expect(kase.getByText(/Resolve not applied — .*\(/)).toBeVisible();
    await page.getByRole("link", { name: /Returned payout/ }).first().click();
    await expect(page).toHaveURL(/\/clearline\/exceptions/);
  });

  test("scenario 3: compliance hold — reviewer decision recorded, never auto-released", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 03: Compliance hold" }).click();
    await expect(page).toHaveURL(/\/clearline\/control\/holds$/);
    await expect(page.getByRole("button", { name: /^Release/ })).toHaveCount(0);
    const hold = page.locator('section[id^="hold_"]').first();
    await hold.getByRole("button", { name: "Submit documents" }).click();
    await expect(hold.getByText("Documents submitted: recorded.")).toBeVisible();
    await hold.getByLabel("Assign reviewer").selectOption("usr_priya");
    await page.getByLabel("Acting as").first().selectOption("usr_priya");
    await hold.getByRole("button", { name: "Assign reviewer" }).click();
    await expect(hold.getByText("Reviewer assigned: recorded.")).toBeVisible();
    await hold.getByLabel("Reason (required)").fill("Invoice matches purchase order; request partner's release note.");
    await hold.getByRole("button", { name: "Record reviewer decision" }).click();
    await expect(hold.getByText("Reviewer decision: recorded.")).toBeVisible();
    await expect(hold).toContainText("Request more");
  });

  test("scenario 4: Base Sepolia finality delay advances to verified evidence", async ({ page }) => {
    await open(page, "/clearline/payments/pi_s4_chain");
    await expect(page.getByTestId("dim-settlement")).toContainText(/Pending finality|Evidence observed/);
    await expect(page.locator("#chain")).toContainText("not a bank credit");
    for (let i = 0; i < 20; i++) {
      if (/Evidence verified/.test(await page.getByTestId("dim-settlement").innerText())) break;
      await page.getByRole("button", { name: "Simulate next provider event" }).click();
      await expect(page.getByRole("status").filter({ hasText: /Provider event processed|No event simulated/ })).toBeVisible();
    }
    await expect(page.getByTestId("dim-settlement")).toContainText("Evidence verified");
    await expect(page.getByTestId("dim-settlement")).toContainText("on-chain transfer");
  });

  test("scenario 5: funding exposure 50,000 → 30,000 repaid → 20,000 outstanding", async ({ page }) => {
    await open(page, "/clearline/trial");
    await page.getByRole("link", { name: "Start case 05: Funding exposure" }).click();
    await expect(page).toHaveURL(/\/clearline\/control\/funding$/);
    await expect(page.getByTestId("funding-principal").first()).toContainText("50,000.00");
    await expect(page.getByTestId("funding-repaid").first()).toContainText("30,000.00");
    await expect(page.getByTestId("funding-outstanding").first()).toContainText("20,000.00");
    await expect(page.getByTestId("funding-exceptions").first()).toContainText("20,000.00");
    await expect(page.getByRole("link", { name: "/mentor-demo" })).toBeVisible();
  });

  test("Connect: create → quote → maker/checker → submit → event → investigation", async ({ page }) => {
    const id = await connectToSubmitted(page, "INV-E2E-301");
    await page.getByRole("button", { name: "Simulate next provider event" }).click();
    await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("INV-E2E-301");
    await expect(page.getByTestId("evidence-timeline")).toContainText("Instruction prepared (maker)");
    await expect(page.getByTestId("evidence-timeline")).toContainText("Checker decision: approved");
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
      await expect(page.locator("#simulate").getByRole("status")).toContainText(/Provider event processed|No event simulated/);
    }
    await expect(page.getByTestId("evidence-timeline")).toContainText(/Duplicate ignored|Contradiction|Late, stored/);
  });

  test("reset to sample restores the five scenarios and drops user data", async ({ page }) => {
    await open(page, "/clearline/connect");
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

  test("works when browser storage is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await open(page, "/clearline/settings");
    await expect(page.getByText(/Unavailable — changes last until you reload/)).toBeVisible();
    await open(page, "/clearline/payments/pi_s1_success");
    await expect(page.getByTestId("dim-execution")).toBeVisible();
  });

  test("investigation page is operable by keyboard alone with visible focus", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard walk runs on desktop");
    await open(page, "/clearline/payments/pi_s4_chain");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    let reached = false;
    for (let i = 0; i < 60; i++) {
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
    await expect(page.locator("#simulate").getByRole("status")).toContainText(/Provider event processed|No event simulated/);
  });

  test("no horizontal page overflow on any console page", async ({ page }) => {
    for (const path of ["/clearline", "/clearline/payments", "/clearline/payments/pi_s1_success", "/clearline/payments/pi_s2_returned",
      "/clearline/investigations", "/clearline/exceptions", "/clearline/connect", "/clearline/connect/quotes", "/clearline/connect/activity",
      "/clearline/docs", "/clearline/control/reconciliation", "/clearline/control/liquidity", "/clearline/control/funding",
      "/clearline/control/holds", "/clearline/control/reports", "/clearline/settings", "/clearline/trial"]) {
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
    expect((await request.get("/api/clearline/test/health")).status()).toBe(200);
    expect((await request.get("/mentor-demo")).status()).toBe(200);
    await open(page, "/clearline/docs");
    await expect(page.getByRole("heading", { name: "Build on one payment lifecycle." })).toBeVisible();
  });
});
