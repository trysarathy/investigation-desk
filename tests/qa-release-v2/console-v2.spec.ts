/**
 * QA v2 browser checks for release/clearline-v2-20261113 @ c498da6. Fictional sandbox data only.
 * "DEFECT …" tests assert the correct behaviour and fail until fixed.
 */
import { expect, test, type Page } from "@playwright/test";

const KEY = "clearline.console.workspace.v1";
const hydrated = (page: Page) => page.waitForSelector('[data-hydrated="true"]');
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [768, 1024]) {
  test(`DEFECT (Low) /clearline/payments has no horizontal page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/clearline/payments");
    await hydrated(page);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test("old console URLs answer 308 with a same-origin relative Location, query kept", async ({ request }) => {
  const r = await request.get("/clearline/control/holds?x=https://evil.example", { maxRedirects: 0 });
  expect(r.status()).toBe(308);
  expect(r.headers()["location"]).toBe("/clearline/holds?x=https%3A%2F%2Fevil.example");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("a disabled engine-gated action cannot be forced: removing `disabled` and clicking still goes through the engine and is refused", async ({ page }) => {
  await page.goto("/clearline/payments/pi_00001");
  await hydrated(page);
  await page.fill("#inv-cancel-reason", "QA forced click");
  const btn = page.getByRole("button", { name: "Cancel payment" });
  await expect(btn).toBeDisabled();
  await page.evaluate(() => document.querySelectorAll("button[disabled]").forEach((b) => b.removeAttribute("disabled")));
  await btn.click();
  await expect(page.getByText(/Cancel payment — not applied/)).toBeVisible();
  await expect(page.getByTestId("operational-status")).toContainText("Provider reports completed");
  const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (stored) expect(JSON.parse(stored).intents.find((i: { id: string }) => i.id === "pi_00001").status.execution).toBe("provider_reported_completed");
});

test("a forced hold release by a non-reviewer is refused by the engine", async ({ page }) => {
  await page.goto("/clearline/holds");
  await hydrated(page);
  await page.getByRole("combobox").filter({ hasText: "Request more information" }).first().selectOption("release");
  await page.getByLabel("Reason (required)").first().fill("QA forced release");
  await page.evaluate(() => document.querySelectorAll("button[disabled]").forEach((b) => b.removeAttribute("disabled")));
  await page.getByRole("button", { name: "Record reviewer decision" }).first().click();
  await expect(page.getByText(/Record reviewer decision — not applied/)).toBeVisible();
  const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (stored) expect(JSON.parse(stored).holds[0].status).not.toBe("released");
});
