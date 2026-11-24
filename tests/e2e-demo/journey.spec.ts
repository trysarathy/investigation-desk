import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { a11y, api, expectDemoLabel, guard, nav, resetDemo, settled, signIn, switchTo } from "./demo";
import { DEMO_E2E, DEMO_LABEL, DEMO_USERS } from "./env";

/*
 * The 13-step demo journey on the DEMO build (CLEARLINE_DEMO_BUILD=1) with the seeded demo world, as a presenter runs
 * it: Northwind Travel (demo) and Provider P (demo), every value fictional. Each run starts from the seeded state
 * (the demo reset). Every page is checked for the data label, console errors, server errors, axe (WCAG 2.2 AA) at
 * 1280 px and 390 px (390 px on the phone project) and horizontal overflow. Role changes go through the demo role
 * switcher, which signs in as the seeded user (a real session): the second-person rule is proved to hold through it.
 * Demo · fictional data.
 */

const FILES = path.join(DEMO_E2E.root, "demo-files");
const EXPECTED = JSON.parse(readFileSync(path.join(FILES, "expected-outcomes.json"), "utf8")) as {
  mappings: Record<"orders" | "provider", { columns: Record<string, { header?: string; constant?: string; statusValueMap?: Record<string, string> }> }>;
  decisionsAfter: Record<string, number>;
};
const file = (name: string) => ({ name, mimeType: "application/octet-stream", buffer: readFileSync(path.join(FILES, name)) });

const field = (page: Page, key: string) => page.getByTestId(`field-${key}`);
async function upload(page: Page, entity: string, type: RegExp, f: ReturnType<typeof file>) {
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption(entity);
  await page.getByRole("radio", { name: type }).check();
  await page.getByLabel("File", { exact: true }).setInputFiles(f);
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page).toHaveURL(/\/control\/merchant\/uploads\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: /Stored “/ }).first()).toBeVisible();
  return page.url().split("/").pop()!;
}
/** Map every column as demo-files/expected-outcomes.json records it (the file Clearline has no template for). */
async function mapColumns(page: Page, columns: Record<string, { header?: string; constant?: string; statusValueMap?: Record<string, string> }>) {
  // a suggestion for a field the recorded mapping leaves out is cleared (the person decides, never the guess)
  for (const row of await page.locator('[data-testid^="field-"]').all()) {
    const key = (await row.getAttribute("data-testid"))!.slice("field-".length);
    if (key in columns) continue;
    const box = row.getByRole("combobox").first();
    if ((await box.inputValue()) !== "" && (await box.locator('option[value=""]').count()) > 0) await box.selectOption("");
  }
  for (const [key, c] of Object.entries(columns)) {
    const row = field(page, key);
    if (c.header) await row.getByRole("combobox").first().selectOption(c.header);
    else if (c.constant) { await row.getByRole("combobox").first().selectOption("__constant__"); await row.getByRole("textbox").first().fill(c.constant); }
  }
  for (const tz of await page.getByLabel(/^Time zone of times in /).all()) await tz.selectOption({ label: "UTC+08:00" });
  for (const [key, c] of Object.entries(columns)) {
    if (!c.statusValueMap || !c.header) continue;
    const words = page.getByRole("group", { name: `What each word in ${c.header} means` });
    for (const [w, v] of Object.entries(c.statusValueMap)) {
      if ((await words.getByLabel(`“${w}”`, { exact: true }).count()) === 0) { await words.getByLabel(`Another word in ${c.header}`).fill(w); await words.getByRole("button", { name: "Add word" }).click(); }
      await words.getByLabel(`“${w}”`, { exact: true }).selectOption(v);
    }
    void key;
  }
}
async function confirmMapping(page: Page) {
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Mapping confirmed/ }).first()).toBeVisible({ timeout: 30_000 });
}
async function validate(page: Page, message: RegExp) {
  await page.getByRole("button", { name: /^Validate (every row|again)$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("Validated, awaiting confirmation");
}
async function decide(page: Page, reason: string, message: RegExp) {
  await page.getByLabel("Reason for your decision").fill(reason);
  await page.getByRole("button", { name: "Confirm upload" }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 30_000 });
}
async function bringIn(page: Page) {
  await page.getByRole("button", { name: "Bring into reconciliation" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Brought into reconciliation: \d+ row\(s\) added/ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("In reconciliation");
}
async function status(page: Page, text: RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible({ timeout: 30_000 });
}

test("the 13-step demo journey", async ({ page }, info) => {
  test.setTimeout(900_000);
  resetDemo();
  const g = guard(page);
  const check = async (where: string) => { await a11y(page, info, where); g.check(); };

  await test.step("1. Overview: the five records and Start demo", async () => {
    await signIn(page, DEMO_USERS.finance);
    await expectDemoLabel(page);
    await nav(page, "Overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How Clearline works");
    const flow = page.getByTestId("overview-flow").getByRole("listitem");
    await expect(flow).toHaveCount(5);
    for (const [i, name] of ["Provider record", "Chain transfer", "Order", "Settlement batch", "Bank line"].entries()) await expect(flow.nth(i)).toContainText(name);
    await expect(page.getByTestId("overview-flow")).toContainText("1,500");
    await check("overview");
    await page.getByTestId("start-demo").click();
    await expect(page).toHaveURL(/\/control\/merchant\?date=2026-12-07$/);
  });

  await test.step("2. Daily report: any of the 30 demo days", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Daily report");
    await expect(page.getByRole("heading", { name: "Summary for 2026-12-07" })).toBeVisible();
    const dates = page.getByLabel("Date (merchant day)");
    const days = await dates.locator("option").allTextContents();
    for (let d = Date.parse("2026-11-08"); d <= Date.parse("2026-12-07"); d += 86_400_000) expect(days).toContain(new Date(d).toISOString().slice(0, 10));
    await page.getByLabel("Entity", { exact: true }).selectOption("NW-SG");
    await dates.selectOption("2026-11-25");
    await page.getByRole("button", { name: "Show report" }).click();
    await expect(page).toHaveURL(/entity=NW-SG&date=2026-11-25/);
    await expect(page.getByTestId("daily-summary")).toContainText(/\d+ payments · \d+ settlements? tied · /);
    await expect(page.getByTestId("cutoff-note")).toContainText("NW-SG merchant day = Asia/Singapore (UTC+08:00)");
    await check("daily report");
  });

  await test.step("3. Payments: filters and search", async () => {
    await nav(page, "Payments");
    await expect(page.getByTestId("payments-count")).toContainText("1471 of 1471 payments");
    await expect(page.getByTestId("payments-pager")).toContainText("Showing 1–100 of 1471");
    await check("payments");
    const filter = async (f: Record<string, string>) => {
      await page.goto("/control/merchant/payments");
      for (const [label, v] of Object.entries(f)) {
        const el = page.getByLabel(label, { exact: true });
        if ((await el.evaluate((e) => e.tagName)) === "SELECT") await el.selectOption(v); else await el.fill(v);
      }
      await page.getByRole("button", { name: "Apply filters" }).click();
      await settled(page);
      return page.getByTestId("payments-count").textContent();
    };
    const n = async (f: Record<string, string>) => { const t = (await filter(f)) ?? ""; const m = /^(\d+) of (\d+) payments/.exec(t); expect(m, t).not.toBeNull(); return Number(m![1]); };
    const sets: Record<string, string>[] = [{ Result: "exception", Network: "tron", Token: "USDT" }, { "Difference type": "underpayment", Entity: "NW-SG" }, { "Age at least (days)": "20", "Age at most (days)": "30" }];
    for (const f of sets) {
      const k = await n(f);
      expect(k, JSON.stringify(f)).toBeGreaterThan(0);
      expect(k, JSON.stringify(f)).toBeLessThan(1471);
    }
    expect(await n({ "Settlement batch": "B-1125-SGD" })).toBe(31);
    for (const q of ["BK-24823", "fict_tron_tx_24823", "T_FICTIONAL_DEP_BK-24823"]) {
      expect(await n({ "Search order, tx hash or deposit address": q }), q).toBe(1);
      await expect(page.getByRole("link", { name: "BK-24823", exact: true })).toBeVisible();
    }
    await check("payments filtered");
  });

  await test.step("4. Payment BK-24823: five records, rule, typed difference, timeline, audit", async () => {
    await page.getByRole("link", { name: "BK-24823", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("BK-24823");
    for (const p of ["chain", "provider", "bank", "ledger", "explanation"]) await expect(page.getByTestId(`part-${p}`)).toBeVisible();
    await expect(page.getByTestId("part-chain")).toContainText("1,760.00 USDT");
    await expect(page.getByTestId("part-chain")).toContainText("TRON");
    await expect(page.getByTestId("part-chain")).toContainText(/2026-11-24 10:15 SGT/);
    await expect(page.getByTestId("deciding-step")).toContainText("M4.tolerance.underpayment_beyond_band");
    await expect(page.getByTestId("difference-row").first()).toContainText("Underpayment");
    await expect(page.getByTestId("difference-row").first()).toContainText("SGD -324.00");
    await expect(page.getByRole("heading", { name: "Evidence timeline" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Audit history table" })).toContainText("Finance (demo)");
    await check("payment BK-24823");
  });

  await test.step("5. Exception: assign to me, note, evidence, propose a resolution", async () => {
    await page.getByRole("link", { name: "EX-BK-24823" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exception EX-BK-24823");
    await expect(page.getByTestId("exception-reason")).toContainText("12.0% short");
    // the seed assigned it to Finance; unassign it, then take it back with "Assign to me"
    await page.getByLabel("Owner", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Save owner" }).click();
    await status(page, /the exception is unassigned/);
    await expect(page.getByTestId("exception-owner")).toHaveText("Unassigned");
    await page.getByRole("button", { name: "Assign to me" }).click();
    await status(page, /Finance \(demo\) owns this exception/);
    await expect(page.getByTestId("exception-owner")).toHaveText("Finance (demo)");
    const note = page.locator("div").filter({ has: page.getByRole("heading", { name: "Add a note", level: 3 }) }).last();
    await note.getByLabel("Note").fill("Called the customer; they will pay the balance through a link (fictional).");
    await note.getByRole("button", { name: "Add note" }).click();
    await status(page, /note/i);
    const attach = page.locator("div").filter({ has: page.getByRole("heading", { name: "Attach evidence", level: 3 }) }).last();
    await attach.getByLabel("Evidence description").fill("Balance payment link PL-24823-B sent to the customer (fictional).");
    await attach.getByLabel("Reference (optional)").fill("PL-24823-B");
    await attach.getByRole("button", { name: "Attach evidence" }).click();
    await status(page, /the evidence is attached/);
    await page.getByLabel("Proposed resolution", { exact: true }).fill("Customer pays the SGD 324.00 balance through link PL-24823-B; close when it arrives.");
    await expect(page.getByRole("checkbox", { name: /PL-24823-B/ })).toBeChecked();
    await page.getByRole("button", { name: "Propose resolution for approval" }).click();
    await status(page, /Sent for approval: version 1/);
    await expect(page.getByTestId("exception-status")).toContainText("In review");
    await check("exception EX-BK-24823");
  });

  await test.step("6. Role switcher: Approver approves; Finance cannot approve her own", async () => {
    // Finance sees her request but no way to approve it, and the server refuses a direct call
    await nav(page, "Approvals");
    const mine = page.getByTestId("approval-request").filter({ hasText: "Resolution of EX-BK-24823" });
    await expect(mine.getByTestId("preparer-note")).toHaveText("You prepared this resolution, so you cannot approve it. A different approver must decide.");
    await expect(mine.getByRole("button", { name: /Approve/ })).toHaveCount(0);
    const list = (await (await api(page, "GET", "/api/control/merchant/approvals")).json()) as { requests: { id: string; status: string; subjectId: string; payloadSha256: string }[] };
    const req = list.requests.find((r) => r.status === "pending" && r.subjectId === "EX-BK-24823")!;
    expect((await api(page, "POST", `/api/control/merchant/approvals/${req.id}/decision`, { decision: "approve", reason: "self approval attempt", payloadSha256: req.payloadSha256 })).status()).toBe(403);
    await check("approvals as Finance");

    // switch to the Approver (a real session for approver@northwind.demo) and approve the exact version
    await switchTo(page, DEMO_USERS.approver);
    await expect(page.getByTestId("signed-in-as")).toContainText("Approver");
    await nav(page, "Approvals");
    const theirs = page.getByTestId("approval-request").filter({ hasText: "Resolution of EX-BK-24823" });
    await expect(theirs.getByTestId("approval-hash")).toHaveValue(req.payloadSha256);
    await theirs.getByLabel("Reason for your decision").fill("Reviewed the evidence and the payload (fictional).");
    await theirs.getByRole("button", { name: "Approve version 1" }).click();
    await status(page, /Approved resolution version 1/);
    await page.goto("/control/merchant/exceptions/EX-BK-24823");
    await expect(page.getByTestId("exception-status")).toHaveText("Resolved");
    const requests = page.getByRole("region", { name: "Resolution requests table" });
    await expect(requests).toContainText("Finance (demo)");
    await expect(requests).toContainText("Approved by Approver (demo)");
    await check("exception resolved");
    // the payment's audit history names both people
    await page.goto("/control/merchant/payments/BK-24823");
    const audit = page.getByRole("region", { name: "Audit history table" });
    await expect(audit.getByRole("row").filter({ hasText: "Finance (demo)" }).first()).toBeVisible();
    await expect(audit.getByRole("row").filter({ hasText: "Approver (demo)" }).first()).toBeVisible();

    // back to Finance through the switcher: still the same person, so a write-off she prepared stays hers to wait on
    await switchTo(page, DEMO_USERS.finance);
    const again = (await (await api(page, "GET", "/api/control/merchant/approvals")).json()) as { requests: { id: string; status: string; kind: string; requestedByName: string; payloadSha256: string }[] };
    const wo = again.requests.find((r) => r.status === "pending" && r.kind === "merchant_writeoff" && r.requestedByName === "Finance (demo)")!;
    expect(wo).toBeTruthy();
    const refused = await api(page, "POST", `/api/control/merchant/approvals/${wo.id}/decision`, { decision: "approve", reason: "self approval through the switcher", payloadSha256: wo.payloadSha256 });
    expect(refused.status()).toBe(403);
  });

  await test.step("7. Batch bridge B-1125-SGD: waterfall, bars open their payments, BK-24871 held", async () => {
    await page.goto("/control/merchant/batches/B-1125-SGD");
    await expect(page.getByTestId("batch-tied")).toHaveText("Tied to the cent");
    const steps = page.getByTestId("waterfall-step");
    await expect(steps.first()).toContainText("SGD 44,412.30");
    await expect(steps.last()).toContainText("SGD 40,228.68");
    await expect(page.getByTestId("bridge-exceptions")).toContainText("EX-BK-24871");
    await check("batch bridge");
    await page.getByRole("link", { name: /^33 orders, merchant day 2026-11-25.*33 payments$/ }).click();
    await expect(page.getByTestId("payments-count")).toContainText("33 of 1471 payments");
    await page.goBack();
    await page.getByRole("link", { name: /^Held for review \(BK-24871\).*payment BK-24871$/ }).click();
    await expect(page).toHaveURL(/\/payments\/BK-24871$/);
    await page.goBack();
    await page.getByTestId("bridge-exceptions").getByRole("link", { name: "EX-BK-24871" }).click();
    await expect(page.getByTestId("exception-reason")).toHaveText("Shown as completed, in no settlement, held for review.");
  });

  await test.step("8. Case 3, BK-25102: two parts on two chains, the AED 14.16 explained", async () => {
    await page.goto("/control/merchant/payments/BK-25102");
    await expect(page.getByRole("heading", { name: "Paid in 2 parts on 2 chains" })).toBeVisible();
    const parts = page.getByTestId("part");
    await expect(parts).toHaveCount(2);
    await expect(parts.nth(0)).toContainText("3,000.00 USDT on TRON");
    await expect(parts.nth(1)).toContainText("1,996.50 USDC on Ethereum");
    const gap = page.getByTestId("parts-gap");
    await expect(gap).toContainText("The AED 14.16 still open is underpayment of AED 12.86");
    await expect(gap).toContainText("rate difference of AED 1.30");
    await check("payment BK-25102");
  });

  await test.step("9. Month-end: receivable by batch, exceptions by age, journals pending sign-off", async () => {
    await page.goto("/control/merchant/month-end?entity=NW-SG&month=2026-11");
    await expect(page.getByRole("heading", { name: /Confirmed but not settled/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Open exceptions by age/ })).toBeVisible();
    await expect(page.getByTestId("pending-sign-off").first()).toBeVisible();
    await check("month-end");
  });

  await test.step("10. Exports: Xero and QuickBooks drafts, evidence pack, month-end pack; not for a Viewer", async () => {
    const get = async (url: string, type: RegExp) => { const r = await api(page, "GET", url); expect(r.status(), url).toBe(200); expect(r.headers()["content-type"], url).toMatch(type); return r; };
    await get("/api/control/merchant/exports/journal-draft?entity=NW-SG&month=2026-11&tool=xero", /csv/);
    await get("/api/control/merchant/exports/journal-draft?entity=NW-AE&month=2026-12&tool=quickbooks", /csv/);
    await get("/api/control/merchant/evidence?order=BK-24823&format=pdf", /pdf/);
    await get("/api/control/merchant/evidence?order=BK-24823&format=csv", /csv/);
    await get("/api/control/merchant/evidence?order=BK-24823&format=json", /json/);
    await get("/api/control/merchant/exports/month-end?entity=NW-SG&month=2026-11", /zip/);
    await page.goto("/control/merchant/month-end?entity=NW-SG&month=2026-11");
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("month-end-pack").click()]);
    expect(d.suggestedFilename()).toMatch(/\.zip$/);
    await switchTo(page, DEMO_USERS.viewer);
    await page.goto("/control/merchant/month-end?entity=NW-SG&month=2026-11");
    await expect(page.getByTestId("export-not-allowed")).toBeVisible();
    expect((await api(page, "GET", "/api/control/merchant/exports/month-end?entity=NW-SG&month=2026-11")).status()).toBe(403);
    expect((await api(page, "GET", "/api/control/merchant/evidence?order=BK-24823&format=pdf")).status()).toBe(403);
    await check("month-end as Viewer");
    await switchTo(page, DEMO_USERS.finance);
  });

  await test.step("11. Live upload of demo-files: map once, template, validate, second-person bank statement, reconcile", async () => {
    // orders (xlsx)
    const orders = await upload(page, "NW-SG", /^Orders or invoices/, file("northwind-sg-bookings-2026-12-08.xlsx"));
    await mapColumns(page, EXPECTED.mappings.orders.columns);
    await confirmMapping(page);
    await validate(page, /^Validated 24 rows: 24 accepted/);
    await decide(page, "Checked against the booking system (fictional).", /Confirmed: 24 row\(s\)/);
    await bringIn(page);
    // the provider's own layout, mapped once and saved as a template
    const provider = await upload(page, "NW-SG", /^Provider export/, file("provider-p-payments-2026-12-08.csv"));
    await expect(page.getByRole("region", { name: /^First 20 rows of / })).toBeVisible();
    await mapColumns(page, EXPECTED.mappings.provider.columns);
    await page.getByLabel("Template name").fill("Provider P payments (demo)");
    await page.getByRole("button", { name: "Save as template" }).click();
    await status(page, /Saved template “Provider P payments \(demo\)” version 1/);
    await confirmMapping(page);
    await check("provider export mapped");
    await validate(page, /^Validated 24 rows: /);
    await decide(page, "Totals agree with the provider portal (fictional).", /Confirmed: 24 row\(s\)/);
    await bringIn(page);
    // the camt.053 statement: Finance uploads it and cannot confirm it
    const bank = await upload(page, "NW-SG", /^Bank statement/, file("northwind-sgd-statement-2026-12-08.camt053.xml"));
    await validate(page, /^Validated 2 rows: 2 accepted/);
    await expect(page.getByTestId("second-person")).toContainText("Waiting for a second person");
    await expect(page.getByRole("button", { name: "Confirm upload" })).toHaveCount(0);
    const sum = (await (await api(page, "GET", `/api/control/merchant/uploads/${bank}`)).json()).upload as { contentSha256: string; rowsSha256: string };
    expect((await api(page, "POST", `/api/control/merchant/uploads/${bank}/decision`, { decision: "confirm", reason: "self confirmation attempt", contentSha256: sum.contentSha256, rowsSha256: sum.rowsSha256 })).status()).toBe(403);
    await check("bank statement waiting for a second person");
    // the Approver confirms it
    await switchTo(page, DEMO_USERS.approver);
    await page.goto(`/control/merchant/uploads/${bank}`);
    await expect(page.getByTestId("second-person")).toContainText("You are the second person");
    await decide(page, "Compared with the bank's online statement (fictional).", /Confirmed by a second person/);
    await bringIn(page);
    // Finance reconciles NW-SG now; the run shows its progress, then the results
    await switchTo(page, DEMO_USERS.finance);
    await page.goto(`/control/merchant/uploads/${provider}`);
    await expect(page.getByTestId("in-reconciliation")).toBeVisible();
    await page.getByRole("button", { name: "Run reconciliation for NW-SG" }).click();
    await expect(page.getByTestId("reconcile-progress-NW-SG")).toContainText("Reconciling NW-SG");
    await status(page, /Reconciled \d+ payments for /);
    await page.goto("/control/merchant/payments/BK-39021");
    await expect(page.getByTestId("decision-chip").first()).toHaveText("Exception");
    await expect(page.getByTestId("deciding-step")).toContainText("M4.tolerance.underpayment_beyond_band");
    const after = EXPECTED.decisionsAfter;
    for (const [result, n] of Object.entries(after)) {
      await page.goto(`/control/merchant/payments?entity=NW-SG&result=${result}`);
      await expect(page.getByTestId("payments-count"), result).toContainText(`${n} of `);
    }
    void orders;
  });

  await test.step("12. Provider console as ops@providerp.demo: aggregates and pilot metrics only", async () => {
    await switchTo(page, DEMO_USERS.ops, /\/control\/merchant\/provider$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Merchants");
    await expect(page.getByTestId("merchant-row")).toHaveCount(1);
    await expect(page.getByTestId("aggregates-only")).toBeVisible();
    await expect(page.getByRole("link", { name: "View payments" })).toHaveCount(0);
    await check("provider merchants");
    await nav(page, "Pilot metrics");
    await expect(page.getByTestId("total-auto")).toHaveText(/^\d+(\.\d)?%$/);
    await expect(page.getByTestId("total-wrong")).toHaveText("Not measured yet");
    await expect(page.getByTestId("total-per100")).toHaveText(/^\d+(\.\d)?$/);
    await expect(page.getByTestId("total-median")).toHaveText(/(min|h)$/);
    await expect(page.getByTestId("total-tied")).toHaveText(/^\d+ of \d+$/);
    await check("provider pilot metrics");
    // no merchant record is reachable from the provider console
    for (const url of ["/control/merchant/payments/BK-24823", "/control/merchant/payments", "/control/merchant/exceptions/EX-BK-24823"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 }), url).toHaveText("Not found");
    }
    expect([403, 404]).toContain((await api(page, "GET", "/api/control/merchant/payments/BK-24823")).status());
  });

  await test.step("13. Settings: tolerance policy read-only, white-label theme preview", async () => {
    await page.goto("/control/merchant/provider");
    await switchTo(page, DEMO_USERS.finance);
    await nav(page, "Settings");
    await expect(page.getByText("Read-only for Finance").first()).toBeVisible();
    await expect(page.getByText(/Band = the larger of 50 bps and SGD 5\.00/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save policy/i })).toHaveCount(0);
    const theme = page.getByTestId("theme-preview");
    await expect(theme).toContainText("Provider P (demo)");
    await expect(theme).toContainText(DEMO_LABEL);
    await check("settings");
  });
});
