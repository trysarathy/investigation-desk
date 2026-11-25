import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery } from "./db";
import { MERCHANT_E2E } from "./env";
import { api, expectNoAxeViolations, expectNoOverflow, nav, signIn, signOut } from "./helpers";
import { reconciledDemo } from "./setup";

/*
 * v1 phase 1.3–1.4: a member limited to one entity sees only that entity in the UI (other entities are hidden, and
 * their pages are "not found"); an Approver limited to another entity does not see the write-off waiting for approval;
 * the merchant Admin's access review lists every membership with its entity scope, downloads as CSV and PDF (both
 * audited), with 0 axe violations and no horizontal overflow. Fictional data only.
 */

const ENTS = ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"];

function admin(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", ...args], { env: { ...process.env, DATABASE_URL: MERCHANT_E2E.ownerUrl, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`admin ${args[0]} failed: ${r.stderr || r.stdout}`);
}

async function bodyText(page: Page) { return (await page.locator("body").innerText()).replace(/\s+/g, " "); }

test("a scoped Finance member sees one entity; a scoped Approver does not see another entity's write-off; the access review", async ({ page }, info) => {
  test.setTimeout(600_000);
  await reconciledDemo(page, info);
  const [wo] = await ownerQuery<{ id: string; entity_id: string; order_id: string }>(`select w.id, i.entity_id, w.order_id from writeoff_proposals w join invoices i on i.org_id = w.org_id and i.order_id = w.order_id
    join organizations o on o.id = w.org_id where o.slug = 'straits-demo-sg' and w.status = 'awaiting_approval' limit 1`);
  const mine = ENTS.find((e) => e !== wo.entity_id)!;
  const others = ENTS.filter((e) => e !== mine);
  for (const [email, role] of [["scoped-finance@straits-demo.example", "finance"], ["scoped-approver@straits-demo.example", "approver"]] as const) {
    admin(["create-user", email, `${role} limited to ${mine} (fictional)`], { CLEARLINE_NEW_PASSWORD: MERCHANT_E2E.password });
    admin(["grant", "straits-demo-sg", email, role, "--entities", mine]);
  }
  const [theirs] = await ownerQuery<{ order_id: string }>(`select i.order_id from invoices i join organizations o on o.id = i.org_id join match_records m on m.org_id = i.org_id and m.order_id = i.order_id
    where o.slug = 'straits-demo-sg' and i.entity_id = $1 order by i.order_id limit 1`, [wo.entity_id]);

  // Finance limited to one entity
  await signIn(page, "scoped-finance@straits-demo.example", info);
  await expect(page.getByTestId("entity-scope")).toHaveText(`for ${mine} only`);
  for (const path of ["/control/merchant", "/control/merchant/payments", "/control/merchant/batches", "/control/merchant/exceptions", "/control/merchant/runs", "/control/merchant/uploads", "/control/merchant/month-end", "/control/merchant/accounting"]) {
    await page.goto(path);
    const text = await bodyText(page);
    for (const e of others) expect(text, `${path} shows ${e}`).not.toContain(e);
    await expectNoAxeViolations(page, `${path} as a scoped Finance member`);
  }
  await page.goto("/control/merchant/payments");
  await expect(page.locator("#f-entity option")).toHaveText(["All", mine]);
  await page.goto(`/control/merchant/payments/${theirs.order_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  expect((await api(page, "GET", `/api/control/merchant/payments/${theirs.order_id}`)).status()).toBe(404);
  expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: wo.entity_id })).status()).toBe(404);
  expect((await api(page, "GET", `/api/control/merchant/exports/month-end?entity=${wo.entity_id}&month=2026-11`)).status()).toBe(404);
  await page.goto("/control/merchant/access-review");
  await expect(page.getByRole("main")).toContainText("Only an Admin with access to every entity");
  await signOut(page);

  // Approver limited to another entity than the waiting write-off's
  await signIn(page, "scoped-approver@straits-demo.example", info);
  await page.goto("/control/merchant/approvals");
  expect(await bodyText(page)).not.toContain(wo.id);
  const reqs = await (await api(page, "GET", "/api/control/merchant/approvals")).json() as { requests: { subjectId: string }[] };
  expect(reqs.requests.some((r) => r.subjectId === wo.id)).toBe(false);
  await signOut(page);

  // the merchant Admin's access review
  await signIn(page, "admin@straits-demo.example", info);
  await nav(page, "Access review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access review");
  const row = page.getByTestId("access-row").filter({ hasText: "scoped-finance@straits-demo.example" });
  await expect(row.getByTestId("access-scope")).toHaveText(mine);
  await expect(page.getByTestId("access-row").filter({ hasText: "finance@straits-demo.example" }).first()).toBeVisible();
  await expectNoAxeViolations(page, "access review");
  await expectNoOverflow(page, `access review (${info.project.name})`);
  for (const format of ["csv", "pdf"] as const) {
    const r = await api(page, "GET", `/api/control/merchant/access-review/export?format=${format}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-disposition"]).toMatch(new RegExp(`clearline-access-review-straits-demo-sg-.*\\.${format}`));
    if (format === "csv") expect(await r.text()).toContain(`scoped-finance@straits-demo.example,Finance,active,${mine}`);
    else expect((await r.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  const audited = await ownerQuery<{ n: number }>(`select count(*)::int as n from audit_events a join organizations o on o.id = a.org_id where o.slug = 'straits-demo-sg' and a.action = 'access_review_exported'`);
  expect(audited[0].n).toBeGreaterThanOrEqual(2);
  await signOut(page);

  // a Provider Admin reviews the provider's own members
  await signIn(page, "admin@northwind-pay.example", info);
  await nav(page, "Access review");
  await expect(page.getByTestId("access-row")).toHaveCount(2);
  await expectNoAxeViolations(page, "provider access review");
  await expectNoOverflow(page, `provider access review (${info.project.name})`);
});
