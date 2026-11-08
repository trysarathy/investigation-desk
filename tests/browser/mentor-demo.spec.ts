import { test, expect } from "@playwright/test";

async function navigate(page: import("@playwright/test").Page, info: import("@playwright/test").TestInfo, label: string) {
  if (info.project.name === "phone") {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  }
  await page.getByRole("button", { name: label }).click();
}

test("mentor can complete an entire simulated funding lifecycle", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/mentor-demo");
  await expect(page.getByRole("heading", { name: "Work queue" })).toBeVisible();
  await expect(page.getByText(/Pilot workspace — sandbox payouts/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Awaiting review/ })).toBeVisible();
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
  await navigate(page, info, "Outstanding ledger");
  await page.getByLabel("Demo role").selectOption("operator");
  await page.getByLabel("Replay date").fill("2026-11-10");
  await page.getByRole("button", { name: "Record supplier paid" }).click();
  await expect(page.getByText("Synthetic supplier payout recorded.")).toBeVisible();
  await page.getByLabel("Replay date").fill("2026-11-19");
  await page.getByRole("button", { name: "Record customer repayment" }).click();
  await expect(page.getByText("Receipt matched by reference and outstanding balance updated.")).toBeVisible();
  await navigate(page, info, "Exceptions");
  await expect(page.getByText("Overdue customer repayment").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("mentor-demo-desktop-or-phone.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("mentor view has no login requirement or live monetary controls", async ({ page }, info) => {
  await page.goto("/mentor-demo");
  await expect(page.getByRole("heading", { name: "Work queue" })).toBeVisible();
  await page.getByLabel("Demo role").selectOption("viewer");
  await page.getByRole("button", { name: "Open advance review" }).click();
  await expect(page.getByRole("button", { name: "Prepare advance" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await navigate(page, info, "Demo settings");
  await expect(page.getByText("Undrawn credit lines are excluded.")).toBeVisible();
  await expect(page.getByText(/Sandbox payouts are simulated; no live payments/).first()).toBeVisible();
});

test("pilot queue search, sample import and case creation are interactive", async ({ page }, info) => {
  await page.goto("/mentor-demo");
  await expect(page.getByRole("heading", { name: "Work queue" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search cases" }).fill("Seabright");
  await expect(page.getByRole("button", { name: /ADV-002 · Seabright Trading/ }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search cases" }).fill("");
  await page.getByRole("button", { name: "Import sample CSV" }).click();
  await expect(page.getByText("A new synthetic case was imported from the bundled sample CSV.")).toBeVisible();
  await expect(page.getByRole("button", { name: /ADV-004 · Northstar Components/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "New case", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "New advance case" })).toBeVisible();
  await page.getByRole("textbox", { name: "New case supplier" }).fill("Demonstration Supplier");
  await page.getByRole("textbox", { name: "New case invoice reference" }).fill("INV-NEW-900");
  await page.getByRole("spinbutton", { name: "New case amount" }).fill("25000");
  await page.getByRole("button", { name: "Create synthetic case" }).click();
  await expect(page.getByText("Synthetic case created. Run checks and prepare it for treasury review.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deterministic advance checks" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("pilot-queue-style.png"), fullPage: true });
});
