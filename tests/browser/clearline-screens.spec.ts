import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Desktop project: 1440×900. Mobile project: iPhone 13, 390×844.
const SHOTS: [string, string][] = [
  ["overview", "/clearline"],
  ["investigation", "s2_returned"],
  ["exceptions", "/clearline/exceptions"],
  ["funding-exposure", "/clearline/control/funding"],
  ["trial", "/clearline/trial"],
];

test("screenshots for docs/trial/screenshots", async ({ page, request }, info) => {
  // Scenario keys resolve to engine intent ids through the v1 test API.
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const byScenario = new Map(((await r.json()).data as { id: string; scenario?: string }[]).map((i) => [i.scenario, i.id]));
  const dir = "docs/trial/screenshots";
  mkdirSync(dir, { recursive: true });
  const size = info.project.name === "desktop" ? "desktop-1440x900" : "phone-390x844";
  for (const [name, path] of SHOTS) {
    await page.goto(path.startsWith("/") ? path : `/clearline/payments/${byScenario.get(path)}`);
    await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("test-mode-marker")).toBeVisible();
    await page.screenshot({ path: `${dir}/${name}-${size}.png` });
  }
});
