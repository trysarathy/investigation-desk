import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

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
  // Separation of duties is checked before the role, so the maker sees maker_checker_violation.
  await expect(page.getByText(/not applied — .*\(maker_checker_violation\)/)).toBeVisible();
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
    await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/); // trial link uses scenarioIntentId
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
    await expect(page.getByTestId("last-event")).toContainText("payout.completed");
    await expect(page.getByTestId("last-verification")).not.toContainText("None yet");
  });

  test("scenario 2: returned payout — assign, note, resolve gated by the engine", async ({ page, request }) => {
    await open(page, await scenario(request, "s2_returned"));
    await expect(page.getByTestId("dim-execution")).toContainText("Returned");
    await expect(page.getByTestId("dim-reconciliation")).toContainText("Exception");
    await expect(page.getByTestId("return-status")).toContainText(/Return (reported by provider|confirmed by statement)/);
    const kase = page.locator("#case");
    await kase.getByLabel("Assign owner").selectOption("usr_maya");
    await kase.getByRole("button", { name: "Assign owner" }).click();
    await expect(kase.getByText("Owner assigned: recorded.")).toBeVisible();
    await kase.getByLabel("Add note").fill("Called the supplier; account name differs.");
    await kase.getByRole("button", { name: "Add note" }).click();
    await expect(kase.getByText("Called the supplier; account name differs.")).toBeVisible();
    await kase.getByLabel("Resolution note").fill("Trying to close early");
    // canResolveCase explains the block before any click.
    await expect(kase.getByTestId("resolve-blocked")).toContainText(/OPEN_EXCEPTIONS|OPEN_INFO_REQUESTS|HOLD_UNDECIDED/);
    await expect(kase.getByRole("button", { name: "Resolve" })).toBeDisabled();
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

  test("scenario 4: Base Sepolia finality delay advances to verified evidence", async ({ page, request }) => {
    await open(page, await scenario(request, "s4_chain"));
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

  test("no horizontal page overflow on any console page", async ({ page, request }) => {
    for (const path of ["/clearline", "/clearline/payments", await scenario(request, "s1_success"), await scenario(request, "s2_returned"),
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

test("breadcrumbs name the right section", async ({ page, request }) => {
  await page.goto("/clearline/control/funding");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("ConsoleControlFunding exposure");
  await page.goto(await scenario(request, "s2_returned"));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Payments");
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
  await load(page, ws, "/clearline/control/reconciliation?group=informational");
  const row = page.locator("#lines tr", { hasText: "PSR-E2E-0001" });
  await expect(row).toContainText("Provider report (not allocated)");
  await expect(row).toContainText("RC_PROVIDER_REPORT_ONLY");
  await open(page, "/clearline/control/reconciliation?group=exact");
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
  await expect(page.getByTestId("dim-execution")).toContainText("Returned");
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
