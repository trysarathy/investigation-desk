import { expect, test } from "@playwright/test";
import { api, expectNoAxeViolations, expectNoOverflow, nav, shot, signIn, signOut, submitAndConfirm } from "./helpers";
import { PROVIDER_PAGES, reconciledDemo } from "./setup";

/*
 * The provider console (screens 10-12) for Provider Admin and Provider Ops: aggregates only without a grant, a
 * merchant URL refused, rows only under the merchant Admin's full grant, onboarding (column mapping, proposed policy
 * defaults the merchant's Admin may adopt, invitation records), theme preview, and pilot metrics fed by the
 * merchant's reviewers. axe 0 violations and no overflow on every provider page.
 */

test("provider console: aggregates only without a grant; merchant URLs refused; rows only under a full grant", async ({ page }, info) => {
  test.setTimeout(400_000);
  await reconciledDemo(page, info);
  await signIn(page, "ops@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  await expect(page.getByTestId("brand-name")).toHaveText("Northwind Pay (fictional)");
  await expect(page.getByTestId("merchant-row")).toHaveCount(2);
  await expect(page.getByTestId("aggregates-only")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Merchants table" })).toContainText("91.3%");
  expect(await page.locator("main").innerText()).not.toMatch(/BK-\d/);
  await expectNoAxeViolations(page, `provider merchants (${info.project.name})`);
  await shot(page, info, "07-provider-merchants");
  const merchants = (await (await api(page, "GET", "/api/control/merchant/provider/merchants")).json()).merchants as { merchantOrgId: string; name: string }[];
  const sg = merchants.find((m) => m.name.startsWith("Straits"))!;
  expect((await api(page, "GET", `/api/control/merchant/provider/merchants/${sg.merchantOrgId}/payments`)).status()).toBe(403);
  await page.goto(`/control/merchant/provider/merchants/${sg.merchantOrgId}`);
  await expect(page.getByTestId("no-grant")).toBeVisible();
  for (const path of ["/control/merchant/payments/BK-24817", "/control/merchant/exceptions/EX-BK-24823", "/control/merchant"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  }
  expect((await api(page, "GET", "/api/control/merchant/payments/BK-24817")).status()).toBe(403);
  expect((await api(page, "POST", `/api/control/merchant/provider/onboarding/${sg.merchantOrgId}/invitations`, { email: "x@y.example", role: "viewer" })).status()).toBe(403);
  await signOut(page);

  // the merchant's Admin grants full access; the provider then sees rows (read-only); revoking takes them back
  await signIn(page, "admin@straits-demo.example", info);
  await nav(page, "Settings");
  await expect(page.getByTestId("grant-scope")).toContainText("Aggregates only");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Grant the provider full read access" }).click(), /your provider can now read/);
  await signOut(page);
  await signIn(page, "ops@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  await page.getByRole("link", { name: "View payments" }).click();
  await expect(page.getByRole("region", { name: "Merchant payments table" })).toContainText("BK-24817");
  await signOut(page);
  await signIn(page, "admin@straits-demo.example", info);
  await nav(page, "Settings");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Revoke full access (aggregates only)" }).click(), /aggregates only again/);
  await signOut(page);
  await signIn(page, "ops@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  expect((await api(page, "GET", `/api/control/merchant/provider/merchants/${sg.merchantOrgId}/payments`)).status()).toBe(403);
});

test("onboarding: column mapping, proposed defaults adopted by the merchant's Admin, an invitation record, theme preview", async ({ page }, info) => {
  test.setTimeout(400_000);
  await signIn(page, "admin@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  await nav(page, "Onboarding");
  await page.getByLabel("Merchant", { exact: true }).selectOption({ label: "Straits Demo Group (fictional)" });
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("theme-preview")).toContainText("Northwind Pay (fictional)");
  const editor = page.getByLabel("Column mapping (JSON)");
  await editor.fill("{ not json");
  await page.getByRole("button", { name: "Save column mapping" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Not sent: This is not valid JSON" })).toBeVisible();
  await editor.fill(JSON.stringify({ provider: "Northwind Pay (fictional)", columns: { "Order": "orderId" } }));
  await page.getByRole("button", { name: "Save column mapping" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "mapping has no column for orderAmount" })).toBeVisible();
  await page.reload();
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Save column mapping" }).click(), /Saved: 31 columns mapped \(revision 1\)/);
  await page.getByLabel("Tolerance cap (entity currency)").fill("4.00");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Propose these defaults" }).click(), /Proposed \(revision 2\)/);
  await page.getByLabel("Email").fill("new.analyst@straits-demo.example");
  await page.getByLabel("Role at the merchant").selectOption("viewer");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Record invitation" }).click(), /Invitation recorded for new.analyst@straits-demo.example/);
  await expect(page.getByTestId("invitation-command")).toContainText("scripts/control/admin.ts accept-invitation ");
  await expectNoAxeViolations(page, `onboarding (${info.project.name})`);
  await shot(page, info, "08-provider-onboarding", { fullPage: true });
  await signOut(page);

  await signIn(page, "ops@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  await nav(page, "Onboarding");
  await expect(page.getByRole("button", { name: "Save column mapping" })).toHaveCount(0);
  await expect(page.getByText("You are Provider Ops")).toBeVisible();
  await signOut(page);

  await signIn(page, "admin@straits-demo.example", info);
  await nav(page, "Settings");
  await expect(page.getByTestId("provider-proposal")).toContainText("capped at 4.00");
  const sg01 = page.getByRole("article").filter({ hasText: "ENT-SG-01" });
  await sg01.getByLabel("Tolerance cap (entity currency)").fill("4.00");
  await submitAndConfirm(page, () => sg01.getByRole("button", { name: "Save policy for ENT-SG-01" }).click(), /policy of ENT-SG-01 is now revision 2/);
  await expectNoAxeViolations(page, `merchant settings (${info.project.name})`);
  await signOut(page);
  await signIn(page, "finance@straits-demo.example", info);
  await nav(page, "Settings");
  await expect(page.getByRole("button", { name: /Save policy/ })).toHaveCount(0);
});

test("pilot metrics: a reviewer marks sampled matches, minutes are logged, the provider sees the totals only", async ({ page }, info) => {
  test.setTimeout(400_000);
  await signIn(page, "finance@straits-demo.example", info);
  await nav(page, "Pilot metrics");
  const rows = page.getByRole("region", { name: "Reviewed sample table" }).locator("tbody tr");
  await submitAndConfirm(page, () => rows.nth(0).getByRole("button", { name: /correct$/ }).click(), /you marked .* correct/);
  await submitAndConfirm(page, () => rows.nth(1).getByRole("button", { name: /wrong$/ }).click(), /you marked .* wrong/);
  await expect(page.getByTestId("metric-wrong")).toHaveText("1 of 2");
  await page.getByLabel("Minutes spent on reconciliation").fill("35");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Log minutes" }).click(), /your minutes are logged/);
  await expect(page.getByTestId("metric-minutes")).toHaveText("35");
  await expectNoAxeViolations(page, `merchant pilot (${info.project.name})`);
  await signOut(page);
  await signIn(page, "admin@northwind-pay.example", info, /\/control\/merchant\/provider$/);
  await nav(page, "Pilot metrics");
  const t = page.getByRole("region", { name: "Pilot metrics per merchant table" });
  await expect(t).toContainText("1 of 2");
  await expect(t).toContainText("35");
  expect(await page.locator("main").innerText()).not.toMatch(/BK-\d/);
  await shot(page, info, "09-provider-pilot-metrics");
  for (const path of PROVIDER_PAGES) {
    await page.goto(path);
    await expectNoAxeViolations(page, `${path} (${info.project.name})`);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page, `${path} at ${width}px`);
    }
    await page.setViewportSize(info.project.use.viewport!);
  }
});
