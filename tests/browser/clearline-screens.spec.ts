import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Desktop project: 1440×900. Mobile project: iPhone 13, 390×844.
const SHOTS: [string, string][] = [
  ["overview", "/clearline"],
  ["investigation", "/clearline/payments/pi_s2_returned"],
  ["exceptions", "/clearline/exceptions"],
  ["funding-exposure", "/clearline/control/funding"],
  ["trial", "/clearline/trial"],
];

test("screenshots for docs/trial/screenshots", async ({ page }, info) => {
  const dir = "docs/trial/screenshots";
  mkdirSync(dir, { recursive: true });
  const size = info.project.name === "desktop" ? "desktop-1440x900" : "phone-390x844";
  for (const [name, path] of SHOTS) {
    await page.goto(path);
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("test-mode-marker")).toBeVisible();
    await page.screenshot({ path: `${dir}/${name}-${size}.png` });
  }
});
