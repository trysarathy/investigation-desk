import { expect, test } from "@playwright/test";
import { CONTROL_PAGES, expectNoAxeViolations, horizontalOverflow, paymentIdFor, REDWOOD, signIn } from "./helpers";

/* axe-core on every Control page with 0 violations, and no horizontal overflow at 320, 390, 768 and 1440 px. */

test("the sign-in page has no axe violations and no horizontal overflow", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/control/sign-in");
    const o = await horizontalOverflow(page);
    expect(o.scroll, `sign-in at ${width}px`).toBeLessThanOrEqual(o.client);
  }
  await page.setViewportSize(test.info().project.use.viewport!);
  await page.goto("/control/sign-in");
  await expectNoAxeViolations(page, "/control/sign-in");
});

for (const who of ["ops@lumen.example", "approver@lumen.example", "viewer@lumen.example"]) {
  test(`every Control page as ${who}: 0 axe violations`, async ({ page }, info) => {
    await signIn(page, who, info);
    const id = await paymentIdFor(page, REDWOOD);
    for (const path of [...CONTROL_PAGES, `/control/payments/${id}`]) {
      await page.goto(path);
      await expect(page.getByTestId("signed-in-as")).toBeVisible();
      await expectNoAxeViolations(page, `${path} as ${who}`);
    }
    await page.goto("/control/payments/pi_does_not_exist");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
    await expectNoAxeViolations(page, "not found");
  });
}

test("no horizontal overflow at 320, 390, 768 and 1440 px", async ({ page }, info) => {
  await signIn(page, "ops@lumen.example", info);
  const id = await paymentIdFor(page, REDWOOD);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [...CONTROL_PAGES, `/control/payments/${id}`]) {
      await page.goto(path);
      const o = await horizontalOverflow(page);
      expect(o.scroll, `${path} at ${width}px`).toBeLessThanOrEqual(o.client);
    }
  }
});
