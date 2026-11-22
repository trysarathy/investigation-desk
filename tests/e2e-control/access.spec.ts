import { expect, test } from "@playwright/test";
import { api, CONTROL_PAGES, ORIGIN, paymentIdFor, REDWOOD, signIn } from "./helpers";
import { E2E } from "./env";

/* Unauthenticated access, CSRF, and tenant isolation between the two fictional organisations. */

test.describe("without a session", () => {
  test("every Control page redirects to sign-in (a real 307 before any content)", async ({ page }) => {
    for (const path of [...CONTROL_PAGES, "/control/payments/pi_00199"]) {
      const r = await page.request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(307);
      expect(r.headers().location, path).toMatch(/\/control\/sign-in$/);
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/control\/sign-in$/);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clearline Control");
    await expect(page.getByTestId("staging-label")).toHaveText("PRIVATE STAGING — FICTIONAL DATA (no real payments)");
    await expect(page.getByRole("link", { name: /sign ?up|register|create (an )?account/i })).toHaveCount(0);
  });

  test("the API answers 401, and a foreign Origin is refused with 403", async ({ page }) => {
    for (const path of ["/api/control/payments", "/api/control/payments/pi_00199", "/api/control/audit", "/api/control/approvals", "/api/control/payments/pi_00199/report?format=json"]) {
      expect((await api(page, "GET", path)).status(), path).toBe(401);
    }
    expect((await api(page, "POST", "/api/control/actions", { type: "add_note", target: { kind: "case", id: "case_00228" }, text: "x" })).status()).toBe(401);
    const foreign = await api(page, "POST", "/api/control/actions", { type: "add_note", target: { kind: "case", id: "case_00228" }, text: "x" }, { origin: "https://evil.example" });
    expect(foreign.status()).toBe(403);
    expect((await foreign.json()).error.code).toBe("CSRF_ORIGIN");
    expect((await api(page, "POST", "/api/auth/sign-in/email", { email: "ops@lumen.example", password: E2E.password }, { origin: "https://evil.example" })).status()).toBe(403);
  });

  test("a failed sign-in shows one generic message, whatever was wrong", async ({ page }, info) => {
    const messages: string[] = [];
    for (const [email, password] of [["ops@lumen.example", "wrong-password-123"], ["nobody@lumen.example", "wrong-password-123"]]) {
      await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.18.200.${messages.length + 1 + (info.project.name === "mobile" ? 10 : 0)}` });
      await page.goto("/control/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Sign-in failed");
      messages.push(await page.getByRole("main").getByRole("alert").innerText());
    }
    expect(messages[0]).toBe(messages[1]);
    await expect(page).toHaveURL(/\/control\/sign-in$/);
  });
});

test.describe("signed in", () => {
  test("a mutation from a foreign Origin is refused with 403 even with a valid session", async ({ page }, info) => {
    await signIn(page, "ops@lumen.example", info);
    const r = await api(page, "POST", "/api/control/actions", { type: "add_note", target: { kind: "case", id: "case_00228" }, text: "cross-site note" }, { origin: "https://evil.example" });
    expect(r.status()).toBe(403);
    const missingKey = await page.request.fetch("/api/control/actions", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, data: JSON.stringify({ type: "add_note", target: { kind: "case", id: "case_00228" }, text: "no key" }) });
    expect(missingKey.status()).toBe(400);
    expect((await missingKey.json()).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

test.describe("tenant isolation", () => {
  test("Harbour's ops cannot open Lumen's payment (not found) or select Lumen (404, no cookie)", async ({ browser }, info) => {
    const lumen = await browser.newPage();
    await signIn(lumen, "ops@lumen.example", info);
    const lumenId = await paymentIdFor(lumen, REDWOOD);
    const lumenUrl = `/control/payments/${lumenId}`;
    await lumen.goto(lumenUrl);
    await expect(lumen.getByTestId("org-name")).toHaveText("Lumen Cross-Border Payments (fictional)");
    await lumen.close();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, "ops@harbour.example", info);
    await expect(page.getByTestId("org-name")).toHaveText("Harbour Remit (fictional)");

    // selecting Lumen is refused and sets no cookie
    const sel = await api(page, "POST", "/api/control/org", { slug: "lumen-demo" });
    expect(sel.status()).toBe(404);
    expect(sel.headers()["set-cookie"]).toBeUndefined();
    expect((await ctx.cookies()).find((c) => c.name === "clearline_org")).toBeUndefined();
    // selecting its own organisation works (the cookie is only a selection)
    const own = await api(page, "POST", "/api/control/org", { slug: "harbour-demo" });
    expect(own.status()).toBe(200);
    expect((await ctx.cookies()).find((c) => c.name === "clearline_org")?.value).toBe("harbour-demo");

    // forging the cookie to name Lumen: Lumen's payment URL is not found, in the API (HTTP 404) and on the page.
    // The page is streamed under the root loading boundary (src/app/loading.tsx), so Next answers its not-found with
    // HTTP 200, the not-found page and a noindex robots tag; nothing of Lumen's is in the HTML.
    await ctx.addCookies([{ name: "clearline_org", value: "lumen-demo", url: ORIGIN }]);
    const res = await page.goto(lumenUrl);
    const html = (await res?.text()) ?? "";
    expect(html).not.toContain("Lumen Cross-Border");
    expect(html).not.toContain("Redwood Supplies");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(page.getByText("Lumen Cross-Border Payments (fictional)")).toHaveCount(0);
    expect((await api(page, "GET", `/api/control/payments/${lumenId}`)).status()).toBe(404);
    expect((await api(page, "GET", `/api/control/payments/${lumenId}/report?format=json`)).status()).toBe(404);
    expect((await api(page, "POST", "/api/control/actions", { type: "add_note", target: { kind: "case", id: "case_00228" }, text: "cross-tenant" })).status()).toBe(404);

    // the seeds share record ids on purpose: without the forged cookie the same id is Harbour's OWN record
    await ctx.addCookies([{ name: "clearline_org", value: "harbour-demo", url: ORIGIN }]);
    await page.goto(lumenUrl);
    await expect(page.getByTestId("org-name")).toHaveText("Harbour Remit (fictional)");
    await ctx.close();
  });
});
