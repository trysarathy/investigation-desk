import { expect, test } from "@playwright/test";
import { MERCHANT_E2E } from "./env";
import { api, signIn } from "./helpers";

/* The merchant surface behind rc5 auth: session required, exact Origin, Idempotency-Key, roles, tenant isolation. */

test("signed out: pages redirect to sign-in, APIs answer 401", async ({ page }) => {
  const r = await page.request.get("/control/merchant/payments", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(r.headers().location).toMatch(/\/control\/sign-in$/);
  expect((await api(page, "GET", "/api/control/merchant/payments")).status()).toBe(401);
  expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: "ENT-SG-01" })).status()).toBe(401);
});

test("mutations need the exact Origin and an Idempotency-Key; roles and tenants are enforced by the server", async ({ page }, info) => {
  await signIn(page, "ops@straits-demo.example", info);
  expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: "ENT-SG-01" }, { origin: "https://evil.example" })).status()).toBe(403);
  const noKey = await page.request.fetch("/api/control/merchant/reconcile", { method: "POST", headers: { origin: MERCHANT_E2E.origin, "content-type": "application/json" }, data: JSON.stringify({ entityId: "ENT-SG-01" }) });
  expect(noKey.status()).toBe(400);
  expect((await noKey.json()).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  // Payment Operations may not export (rc8 decision 3: Finance, an Approver or an Admin) nor decide approvals (Approver)
  for (const path of ["/api/control/merchant/journals/export?entity=ENT-SG-01&month=2026-11&format=csv", "/api/control/merchant/evidence?order=BK-24817&format=json",
    "/api/control/merchant/evidence?entity=ENT-SG-01&month=2026-11&format=csv", "/api/control/merchant/exports/month-end?entity=ENT-SG-01&month=2026-11",
    "/api/control/merchant/exports/journal-draft?entity=ENT-SG-01&month=2026-11&tool=quickbooks"]) expect((await api(page, "GET", path)).status(), path).toBe(403);
  // and the links are not shown
  await page.goto("/control/merchant/payments/BK-24817");
  await expect(page.getByTestId("export-not-allowed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF summary" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Evidence packs" })).toHaveCount(0);
  // another merchant's payment, exception and entity do not exist for this user
  expect((await api(page, "GET", "/api/control/merchant/payments/BK-25102")).status()).toBe(404);
  await page.goto("/control/merchant/payments/BK-25102");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: "ENT-AE-03" })).status()).toBe(404);
  // rc8 decision 3: the role check comes first, so another merchant's evidence is a 403 to Payment Operations (no lookup)
  expect((await api(page, "GET", "/api/control/merchant/evidence?entity=ENT-AE-03&month=2026-12&format=json")).status()).toBe(403);
});

test("a provider user is refused every merchant URL (page and API)", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "198.19.200.7" });
  const s = await page.request.post("/api/auth/sign-in/email", { headers: { origin: MERCHANT_E2E.origin, "content-type": "application/json" }, data: JSON.stringify({ email: "admin@northwind-pay.example", password: MERCHANT_E2E.password }) });
  expect(s.status()).toBe(200);
  for (const path of ["/control/merchant", "/control/merchant/payments", "/control/merchant/payments/BK-24817", "/control/merchant/exceptions/EX-BK-24823", "/control/merchant/approvals", "/control/merchant/accounting"]) {
    // the root loading boundary streams, so the page answers with the not-found screen (the API answers 403 below)
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
    await expect(page.getByText("BK-24817")).toHaveCount(0);
  }
  for (const path of ["/api/control/merchant/payments", "/api/control/merchant/payments/BK-24817", "/api/control/merchant/exceptions", "/api/control/merchant/approvals", "/api/control/merchant/evidence?order=BK-24817&format=json"]) {
    expect((await api(page, "GET", path)).status(), path).toBe(403);
  }
});
