import { expect, test, type TestInfo, type Page } from "@playwright/test";
import { api, expectNoAxeViolations, expectNoOverflow, signIn } from "./helpers";
import { resetMerchantDatabase } from "./db";

/* rc7 phase 3a: the Runs page. Reconcile now records a run ("No change" on the same data); a daily run is set for an
   entity; the page is labelled with the sample label and passes axe with no horizontal scroll at 1280 and 390 px.
   One sign-in and no sign-out: the suite shares the server's per-path auth rate limit (Better Auth resets a bucket
   only after a quiet window). Read-only roles see the page in a11y.spec.ts. */

async function axeBoth(page: Page, info: TestInfo, where: string) {
  const back = page.viewportSize();
  for (const width of info.project.name === "mobile" ? [390] : [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page, `${where} at ${width}px`);
    await expectNoOverflow(page, `${where} at ${width}px`);
  }
  if (back) await page.setViewportSize(back);
}

test("runs: reconcile now records a run, the same data says 'No change', a daily run is set", async ({ page }, info) => {
  test.setTimeout(300_000);
  await resetMerchantDatabase();
  await signIn(page, "ops@straits-demo.example", info);
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: e })).status()).toBe(200);
  await page.goto("/control/merchant/runs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Runs");
  await expect(page.getByTestId("demo-label")).toHaveText("Test mode · illustrative data");
  await expect(page.getByTestId("rule-set-version")).toHaveText(/^rc6-merchant-engine\/1#[0-9a-f]{12}$/);
  await expect(page.getByTestId("run-row")).toHaveCount(3);
  await expect(page.getByTestId("run-status")).toHaveText(["Changed", "Changed", "Changed"]);
  await page.getByRole("button", { name: "Run reconciliation for ENT-SG-01" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Nothing changed for/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("run-row")).toHaveCount(4);
  await expect(page.getByTestId("run-row").first()).toContainText("ENT-SG-01");
  await expect(page.getByTestId("run-status").first()).toHaveText("No change");
  await expect(page.getByTestId("schedule-ENT-SG-02")).toHaveText(/No daily run/);
  await page.getByLabel("Run ENT-SG-02 every day").check();
  await page.getByRole("button", { name: "Save daily run for ENT-SG-02" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved: ENT-SG-02 runs every day at 02:00 merchant time." }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("schedule-ENT-SG-02")).toHaveText(/^Every day at 02:00 merchant time \(UTC\+08:00\), run for /);
  await axeBoth(page, info, "runs (ops)");
  // no sign-out: the next test starts in a new browser context, and the server's sign-out bucket is shared by the suite
});
