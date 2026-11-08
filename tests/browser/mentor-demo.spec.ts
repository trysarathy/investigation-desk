import { test, expect } from "@playwright/test";

test("mentor can complete an entire simulated funding lifecycle", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/mentor-demo");
  await expect(page.getByRole("heading", { name: "Funding operations, in control." })).toBeVisible();
  await expect(page.getByText("SYNTHETIC DEMO")).toBeVisible();
  await expect(page.getByText("SGD 60,000.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Open advance review" }).click();
  await expect(page.getByRole("heading", { name: "Deterministic advance checks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare advance" })).toBeEnabled();
  await page.getByRole("button", { name: "Prepare advance" }).click();
  await expect(page.getByText("Advance prepared; now switch to treasury approver.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.getByLabel("Demo role").selectOption("approver");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Treasury approval recorded in synthetic timeline.")).toBeVisible();
  await page.getByRole("button", { name: "Outstanding ledger" }).click();
  await page.getByLabel("Demo role").selectOption("operator");
  await page.getByLabel("Replay date").fill("2026-11-10");
  await page.getByRole("button", { name: "Record supplier paid" }).click();
  await expect(page.getByText("Synthetic supplier payout recorded.")).toBeVisible();
  await page.getByLabel("Replay date").fill("2026-11-19");
  await page.getByRole("button", { name: "Record customer repayment" }).click();
  await expect(page.getByText("Receipt matched by reference and outstanding balance updated.")).toBeVisible();
  await page.getByRole("button", { name: /Exceptions/ }).click();
  await expect(page.getByText("Overdue customer repayment").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("mentor-demo-desktop-or-phone.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("mentor view has no login requirement or live monetary controls", async ({ page }) => {
  await page.goto("/mentor-demo");
  await expect(page.getByText("Northline Payments")).toBeVisible();
  await page.getByLabel("Demo role").selectOption("viewer");
  await page.getByRole("button", { name: "Open advance review" }).click();
  await expect(page.getByRole("button", { name: "Prepare advance" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Demo settings" }).click();
  await expect(page.getByText("Undrawn credit lines are excluded.")).toBeVisible();
  await expect(page.getByText(/browser-only mentor demonstration/)).toBeVisible();
});
