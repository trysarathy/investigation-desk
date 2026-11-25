import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./env";
import { ownerQuery } from "./db";
import { api, expectNoAxeViolations, forgetUsedCodes, horizontalOverflow, signIn, signOut, totp } from "./helpers";

/**
 * v1 phase 1.2 — login security in the browser, desktop and mobile, axe 0 on every new page. Fictional people only.
 * Each test first puts its fictional user back into a known state through the owner connection (test-only), because
 * the desktop and mobile projects share one database.
 */
let k = 0;
const from = (p: Page) => p.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.19.${(k = (k + 1) % 250)}.${Math.floor(Math.random() * 250) + 1}` });

async function passwordOnly(page: Page, email: string, password: string = E2E.password) {
  await from(page);
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
const base32decode = (s: string) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out).toString("utf8");
};
const lastMail = async (to: string, subject: RegExp) => {
  const rows = await ownerQuery<{ subject: string; text_body: string }>("select subject, text_body from email_outbox where to_address = $1 order by id desc", [to]);
  const m = rows.find((r) => subject.test(r.subject));
  if (!m) throw new Error(`no e-mail "${subject}" for ${to} in the outbox`);
  return /(http\S+#token=\S+)/.exec(m.text_body)![1];
};

test.beforeEach(async () => {
  await ownerQuery("delete from auth_rate_events");
  await ownerQuery("delete from login_failures");
});

test("an Admin without MFA is blocked until enrolled; enrols TOTP; then signs in with TOTP", async ({ page }) => {
  // known state: admin@lumen.example has no MFA and no sessions
  await ownerQuery("delete from two_factors where user_id = (select id from users where email = 'admin@lumen.example')");
  await ownerQuery("update users set two_factor_enabled = false where email = 'admin@lumen.example'");
  await ownerQuery("delete from sessions where user_id = (select id from users where email = 'admin@lumen.example')");

  await passwordOnly(page, "admin@lumen.example");
  await expect(page).toHaveURL(/\/control\/security\?required=enrol$/);
  await expect(page.getByTestId("mfa-required")).toContainText("Set up multi-factor sign-in to continue");
  await expectNoAxeViolations(page, "security page, enrolment required");
  const o = await horizontalOverflow(page);
  expect(o.scroll).toBeLessThanOrEqual(o.client);
  // every page and API stays closed
  await page.goto("/control/payments");
  await expect(page).toHaveURL(/\/control\/security\?required=enrol$/);
  const r = await api(page, "GET", "/api/control/payments");
  expect(r.status()).toBe(403);
  expect((await r.json()).error.code).toBe("MFA_ENROLLMENT_REQUIRED");

  // enrol: password, scan (here: read the key), confirm with a code
  await page.getByLabel("Your password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That password is not right." })).toBeVisible();
  await page.getByLabel("Your password").fill(E2E.password);
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  const secret = base32decode((await page.getByTestId("totp-secret").textContent())!.trim());
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expectNoAxeViolations(page, "security page, scanning the code");
  await page.getByLabel("6-digit code from the app").fill(totp(secret, Date.now() + 5 * 60_000));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /code is not right/ })).toBeVisible();
  await page.getByLabel("6-digit code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("recovery-codes")).toBeVisible();
  await expect(page.getByTestId("recovery-codes").getByRole("listitem")).toHaveCount(10);
  await expectNoAxeViolations(page, "security page, recovery codes");
  await page.getByRole("button", { name: "I have saved them" }).click();
  await expect(page.getByTestId("mfa-status")).toContainText("On: authenticator app");
  await page.getByRole("link", { name: "Continue to Clearline Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(page.getByTestId("signed-in-as")).toContainText("admin@lumen.example");

  // sign out, then sign in with the password AND the code
  await signOut(page);
  await forgetUsedCodes();
  await passwordOnly(page, "admin@lumen.example");
  await expect(page).toHaveURL(/\/control\/sign-in\/two-factor$/);
  await expectNoAxeViolations(page, "second step of sign-in");
  await page.getByLabel("6-digit code from your authenticator app").fill(totp(secret, Date.now() + 10 * 60_000));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("not right");
  await page.getByLabel("6-digit code from your authenticator app").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(page.getByTestId("signed-in-as")).toContainText("admin@lumen.example");
});

test("password reset through the local outbox (after verifying the e-mail address); the link works once", async ({ page }) => {
  const email = "finance@lumen.example";
  const newPassword = "fictional-e2e-reset-02";
  await ownerQuery("update users set email_verified = false where email = $1", [email]);
  await signIn(page, email, test.info());
  await page.goto("/control/security");
  await expect(page.getByTestId("email-status")).toContainText("not verified");
  await page.getByRole("button", { name: "Send a verification link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "verification link is on its way" })).toBeVisible();
  const verify = await lastMail(email, /Verify/);
  await page.goto(verify);
  await expect(page).toHaveURL(/\/control\/sign-in\/verify-email$/); // the token left the address bar
  await expectNoAxeViolations(page, "verify e-mail page");
  await page.getByRole("button", { name: "Verify my e-mail address" }).click();
  await expect(page.getByRole("status")).toContainText("Your e-mail address is verified.");
  await page.goto("/control/security");
  await signOut(page);

  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/control\/sign-in\/forgot$/);
  await expectNoAxeViolations(page, "forgot password page");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("reset link is on its way");
  const link = await lastMail(email, /Reset/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/control\/sign-in\/reset$/);
  await expectNoAxeViolations(page, "reset password page");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("New password again").fill(newPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status")).toContainText("Your password is changed");
  // the same link again: refused
  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("fictional-e2e-reset-03");
  await page.getByLabel("New password again").fill("fictional-e2e-reset-03");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("alert")).toContainText("not valid");
  // the old password no longer works; the new one does
  await passwordOnly(page, email, E2E.password);
  await expect(page.getByRole("alert")).toContainText("Sign-in failed");
  await signIn(page, email, test.info(), newPassword);
  await signOut(page);
  // put the fictional user back (the other project runs the same test): a second reset, through the API
  const r = await api(page, "POST", "/api/auth/request-password-reset", { email });
  expect(r.status()).toBe(200);
  const back = new URL(await lastMail(email, /Reset/)).hash.replace("#token=", "");
  expect((await api(page, "POST", "/api/auth/reset-password", { token: decodeURIComponent(back), newPassword: E2E.password })).status()).toBe(200);
});

test("the session list: revoke another session; it stops working at once", async ({ page, browser }) => {
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2, "ops@lumen.example", test.info());
  await signIn(page, "ops@lumen.example", test.info());
  await page.goto("/control/security");
  await expect(page.getByTestId("session-current")).toHaveCount(1);
  await expectNoAxeViolations(page, "security page, sessions");
  const o = await horizontalOverflow(page);
  expect(o.scroll).toBeLessThanOrEqual(o.client);
  await page.getByRole("button", { name: "Sign out all other sessions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Every other session is signed out." })).toBeVisible();
  await expect(page.getByTestId("session-other")).toHaveCount(0);
  await p2.goto("/control/payments");
  await expect(p2).toHaveURL(/\/control\/sign-in$/);
  // revoke ONE session
  await signIn(p2, "ops@lumen.example", test.info());
  await page.reload();
  await expect(page.getByTestId("session-other")).toHaveCount(1);
  await page.getByTestId("session-other").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Session revoked." })).toBeVisible();
  await p2.goto("/control");
  await expect(p2).toHaveURL(/\/control\/sign-in$/);
  await page.goto("/control");
  await expect(page.getByTestId("signed-in-as")).toContainText("ops@lumen.example");
  await other.close();
});

test("rate limit trips: after 5 failed sign-ins the account is refused, even with the right password", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await passwordOnly(page, "viewer@lumen.example", "wrong-password-123");
    await expect(page.getByRole("alert")).toContainText("Sign-in failed");
  }
  await passwordOnly(page, "viewer@lumen.example", "wrong-password-123");
  await expect(page.getByRole("alert")).toContainText("Too many sign-in attempts");
  await passwordOnly(page, "viewer@lumen.example", E2E.password);
  await expect(page.getByRole("alert")).toContainText("Too many sign-in attempts");
  await expectNoAxeViolations(page, "sign-in page with the rate-limit message");
  await ownerQuery("delete from login_failures");
});

test("rate limit trips for the second factor: 5 wrong codes, then even the right code is refused", async ({ page }) => {
  await ownerQuery("update two_factors set failed_verification_count = 0, locked_until = null");
  for (let i = 0; i < 6; i++) {
    await passwordOnly(page, "approver@lumen.example");
    await expect(page).toHaveURL(/\/two-factor$/);
    await page.getByLabel("6-digit code from your authenticator app").fill(totp(E2E.totpSecret, Date.now() + (20 + i) * 60_000));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText(i < 5 ? "not right" : "Too many");
  }
  await forgetUsedCodes();
  await passwordOnly(page, "approver@lumen.example");
  await page.getByLabel("6-digit code from your authenticator app").fill(totp());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Too many");
  await ownerQuery("delete from auth_rate_events");
  await ownerQuery("update two_factors set failed_verification_count = 0, locked_until = null");
});
