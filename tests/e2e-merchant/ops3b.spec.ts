import { expect, test, type TestInfo, type Page } from "@playwright/test";
import { api, expectNoAxeViolations, expectNoOverflow, signIn } from "./helpers";

/* rc7 phase 3b: the notification bell and list, and the organisation Admin page (members, roles, sign a member out,
   audit log with ids only). rc8 founder decision 3: an Admin may export (Finance, an Approver or an Admin). Axe 0 and no horizontal
   scroll at 1280 and 390 px. One sign-in and no sign-out (the suite shares the server's auth rate limit). */

async function axeBoth(page: Page, info: TestInfo, where: string) {
  const back = page.viewportSize();
  for (const width of info.project.name === "mobile" ? [390] : [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page, `${where} at ${width}px`);
    await expectNoOverflow(page, `${where} at ${width}px`);
  }
  if (back) await page.setViewportSize(back);
}

test("admin: members and audit log; notifications page; an Admin exports (rc8 decision 3)", async ({ page }, info) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@straits-demo.example", info);
  await expect(page.getByTestId("bell")).toHaveAccessibleName(/^Notifications \d+ unread$/);

  await page.goto("/control/merchant/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin");
  await expect(page.getByTestId("member-row")).toHaveCount(5);
  await expect(page.getByTestId("member-row").filter({ hasText: "(you)" })).toContainText("Admin");
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await axeBoth(page, info, "admin");

  await page.goto("/control/merchant/notifications");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notifications");
  await expect(page.getByTestId("unread-count")).toHaveText(/\d+ unread\./);
  await axeBoth(page, info, "notifications");

  const m = await api(page, "GET", "/api/control/merchant/exports/month-end?entity=ENT-SG-01&month=2026-11");
  expect(m.status()).toBe(200);
  const d = await api(page, "GET", "/api/control/merchant/exports/journal-draft?entity=ENT-SG-01&month=2026-11&tool=xero");
  expect(d.status()).toBe(200);
  for (const path of ["/api/control/merchant/evidence?order=BK-24817&format=json", "/api/control/merchant/journals/export?entity=ENT-SG-01&month=2026-11&format=csv"]) expect((await api(page, "GET", path)).status(), path).toBe(200);
  await page.goto("/control/merchant/month-end?entity=ENT-SG-01&month=2026-11");
  await expect(page.getByTestId("month-end-pack")).toBeVisible();
  const audit = await api(page, "GET", "/api/control/merchant/admin/audit?pageSize=5");
  expect(audit.status()).toBe(200);
  const body = await audit.json() as { events: Record<string, unknown>[] };
  for (const e of body.events) expect(Object.keys(e).sort()).toEqual(["action", "actorUserId", "at", "entityId", "entityType", "seq", "source"]);
});
