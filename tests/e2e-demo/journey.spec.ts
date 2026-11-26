import { expect, test } from "@playwright/test";
import { resetDemo } from "./demo";
import { runJourney } from "./journey";

/*
 * The 13-step demo journey (journey.ts) twice in a row on the DEMO build: from the seeded state (`npm run demo:reset`),
 * then, after the presenter's "Reset demo" button, all 13 steps again. Both passes must succeed: whatever the first
 * run changed (approvals, uploads, a reconciliation) the reset puts back. On the desktop project (1440 px) and the
 * phone project (iPhone 13). Demo · fictional data.
 */
test("the 13-step demo journey, then Reset demo, then the journey again", async ({ page }, info) => {
  test.setTimeout(1_800_000);
  resetDemo();
  await test.step("first pass", async () => { await runJourney(page, info); });
  await test.step("Reset demo (the button, as a presenter uses it)", async () => {
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("demo-reset-button").click();
    await expect(page.getByTestId("demo-reset").getByRole("status")).toContainText(/Demo reset in \d+\.\d s/, { timeout: 60_000 });
    await expect(page).toHaveURL(/\/control\/sign-in$/, { timeout: 30_000 });
  });
  await test.step("second pass", async () => { await runJourney(page, info); });
});
