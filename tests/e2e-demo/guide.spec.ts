import { expect, test } from "@playwright/test";
import { a11y, expectDemoLabel, guard, resetDemo, settled, signIn } from "./demo";
import { DEMO_USERS } from "./env";
import { GUIDE_LOGINS, GUIDE_STEPS } from "../../src/lib/clearline/demo/guide";

/*
 * The presenter guide (demo build only): a side panel with the 13 journey steps, each with two or three talking
 * points and "Go there", which switches to the step's demo login through the role switcher when needed. Keyboard
 * only (open, Escape, focus back), axe-clean with the panel open at 1280 px and 390 px, and every "Go there" lands on
 * its screen signed in as the right person. Demo · fictional data.
 */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the presenter guide: keyboard, axe, and every Go there", async ({ page }, info) => {
  test.setTimeout(600_000);
  resetDemo();
  const g = guard(page);
  await signIn(page, DEMO_USERS.finance);
  await page.waitForLoadState("networkidle"); // hydrated: the toggle has its handler
  const toggle = page.getByTestId("guide-toggle");
  const panel = page.getByTestId("guide-panel");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // keyboard: Enter opens and moves focus into the panel; Escape closes and returns focus to the toggle
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Go there/ }) })).toHaveCount(13);
  for (const s of GUIDE_STEPS) {
    const item = page.getByTestId(`guide-step-${s.n}`);
    await expect(item).toContainText(s.title);
    await expect(item.getByRole("listitem")).toHaveCount(s.points.length);
  }
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("guide-close")).toBeFocused();
  await a11y(page, info, "dashboard with the presenter guide open");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  g.check();

  // every step's "Go there", in order (the panel stays open across pages in this tab)
  await toggle.click();
  for (const s of GUIDE_STEPS) {
    await page.waitForLoadState("networkidle");
    const who = GUIDE_LOGINS[s.as];
    await expect(panel).toBeVisible();
    await page.getByTestId(`guide-go-${s.n}`).click();
    await expect(page).toHaveURL(new RegExp(`${escape(s.path)}$`), { timeout: 30_000 });
    await settled(page);
    await expect(page.getByTestId("signed-in-as"), s.title).toContainText(who.email);
    await expectDemoLabel(page);
    if (s.n === 6 || s.n === 12) await a11y(page, info, `step ${s.n} with the guide open`);
    g.check();
  }
});
