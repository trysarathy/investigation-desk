import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, expectNoOverflow, signIn, signOut } from "./helpers";
import { MERCHANT_PAGES, reconciledDemo } from "./setup";

/* axe-core with 0 violations on every merchant page for three roles, keyboard reachability, and no horizontal overflow at 390, 1280 and 1440 px. */

test("every merchant page: 0 axe violations as Payment Operations, Finance and an Approver", async ({ page }, info) => {
  test.setTimeout(600_000);
  await reconciledDemo(page, info);
  for (const who of ["ops@straits-demo.example", "finance@straits-demo.example", "approver@straits-demo.example"]) {
    await signIn(page, who, info);
    for (const path of MERCHANT_PAGES) {
      await page.goto(path);
      await expect(page.getByTestId("demo-label")).toHaveText("Test mode · illustrative data");
      await expectNoAxeViolations(page, `${path} as ${who}`);
    }
    await signOut(page);
  }
  await signIn(page, "approver@straits-demo.example", info);
  await page.goto("/control/merchant/payments/BK-99999");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  await expectNoAxeViolations(page, "not found");
});

test("keyboard: the skip link and every control of the approval form are reachable with Tab", async ({ page }, info) => {
  test.setTimeout(300_000);
  await signIn(page, "approver@straits-demo.example", info);
  await page.goto("/control/merchant/approvals");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Approvals");
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    seen.add(await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? `${e.tagName}:${e.getAttribute("name") ?? ""}:${(e.textContent ?? "").trim().slice(0, 40)}` : ""; }));
  }
  const all = [...seen].join("\n");
  expect(all).toMatch(/A::Skip to content/);
  expect(all).toMatch(/TEXTAREA:reason/);
  expect(all).toMatch(/BUTTON:decision:Approve version 1/);
  expect(all).toMatch(/BUTTON:decision:Reject/);
});

test("no horizontal overflow at 390, 1280 and 1440 px", async ({ page }, info) => {
  test.setTimeout(600_000);
  await signIn(page, "finance@straits-demo.example", info);
  for (const width of [390, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of MERCHANT_PAGES) {
      await page.goto(path);
      await expectNoOverflow(page, `${path} at ${width}px`);
    }
  }
});
