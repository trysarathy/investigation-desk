import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectNoAxeViolations, expectNoOverflow } from "../e2e-merchant/helpers";
import { ONBOARDING_E2E } from "./env";
import { lastInvitation } from "../support/email-outbox";

/*
 * v1 phase 1.1, on desktop and on a phone: a platform operator creates a merchant and invites its first admin; the
 * admin accepts the emailed invitation (local outbox), signs in and completes the setup wizard step by step; a
 * Finance member the admin invited is refused the wizard; there is no sign-up. axe-core: 0 violations on every screen.
 * Fictional organisations and people only.
 */

let n = 0;
async function signIn(page: Page, email: string, password: string, info: TestInfo) {
  n += 1;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${info.project.name === "mobile" ? 1 : 0}.${n}` });
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/control\/sign-in$/);
}
async function signOut(page: Page) {
  await page.context().clearCookies();
}
/** The newest invitation email to `to` in the local outbox table (test-only read as the owner), and its one-time token. */
async function invitationTo(to: string) {
  const { message, token } = await lastInvitation(ONBOARDING_E2E.ownerUrl, to);
  return { subject: message.subject, token };
}
async function accept(page: Page, token: string, name: string, password: string) {
  await page.goto(`/control/invite#token=${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accept your invitation");
  await expectNoAxeViolations(page, "invitation page");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Choose a password").fill(password);
  await page.getByLabel("Repeat the password").fill(password);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByTestId("invite-accepted")).toContainText("Invitation accepted. Your account is ready.");
  expect(new URL(page.url()).hash).toBe(""); // the token is removed from the address bar
  await expectNoAxeViolations(page, "invitation accepted");
}
async function step(page: Page, key: string, heading: RegExp) {
  await page.goto(`/control/merchant/setup?step=${key}`);
  await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  await expectNoAxeViolations(page, `setup step ${key}`);
  await expectNoOverflow(page, `setup step ${key}`);
}
async function markDone(page: Page, key: string, label: string) {
  await page.getByRole("button", { name: `Mark "${label}" done` }).click();
  await expect(page.getByTestId(`step-link-${key}`)).toContainText("(done)");
  await expect(page.getByRole("button", { name: `Mark "${label}" done` })).toHaveCount(0);
}

test("platform console → invitation → setup wizard → finish; a non-admin is refused; no sign-up", async ({ page, request }, info) => {
  const p = info.project.name; // desktop | mobile: separate organisations in the shared database
  const slug = `e2e-merchant-${p}`, adminEmail = `admin-${p}@onboarding.example`, financeEmail = `finance-${p}@onboarding.example`;
  const pw = "fictional-e2e-pass-02";

  await test.step("there is no sign-up", async () => {
    for (const method of ["GET", "POST"] as const) {
      const r = await request.fetch("/api/auth/sign-up/email", { method, headers: { origin: ONBOARDING_E2E.origin, "content-type": "application/json" }, data: method === "POST" ? JSON.stringify({ email: "walk-in@onboarding.example", password: "a-long-password-01", name: "x" }) : undefined });
      expect(r.status(), method).toBe(404);
    }
  });

  await test.step("the platform operator creates the merchant and invites its first admin", async () => {
    await signIn(page, "operator@platform.example", ONBOARDING_E2E.password, info);
    await expect(page).toHaveURL(/\/control\/platform$/); // a person with no organisation lands on the console
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform console");
    await expectNoAxeViolations(page, "platform console");
    await expectNoOverflow(page, "platform console");
    const form = page.getByRole("region", { name: "New organisation" });
    await form.getByLabel("Kind").selectOption("merchant");
    await form.getByLabel("Organisation name").fill(`Fictional Merchant (${p})`);
    await form.getByLabel("Code (slug)").fill(slug);
    await form.getByLabel("Time zone").fill("Asia/Singapore");
    await form.getByLabel("First admin's email").fill(adminEmail);
    await form.getByRole("button", { name: "Create and send invitation" }).click();
    await expect(page.getByText("Created. The invitation email is on its way to the first admin.")).toBeVisible();
    const row = page.getByTestId("platform-org-row").filter({ hasText: slug });
    await expect(row).toContainText("Merchant");
    await expect(row).toContainText("Not finished");
    await expectNoAxeViolations(page, "platform console after create");
    expect((await invitationTo(adminEmail)).subject).toBe(`You are invited to Fictional Merchant (${p}) on Clearline`);
    await signOut(page);
  });

  await test.step("the first admin accepts the invitation and signs in", async () => {
    await accept(page, (await invitationTo(adminEmail)).token, `First Admin ${p} (fictional)`, pw);
    await signIn(page, adminEmail, pw, info);
    // a merchant member is not a platform operator: the console does not exist for them
    await page.goto("/control/platform");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  });

  await test.step("1. entities and currencies", async () => {
    await step(page, "entities", /Step 1: Entities and currencies/);
    await page.getByLabel("Entity code").fill("SG-OPS");
    await page.getByLabel("Legal name").fill(`Fictional Merchant ${p} Pte (fictional)`);
    await page.getByLabel("Functional currency").selectOption("SGD");
    await page.getByLabel("Time zone").fill("Asia/Singapore");
    await page.getByRole("button", { name: "Add entity" }).click();
    await expect(page.getByText("Saved: the entity and its default policy were created.")).toBeVisible();
    await expect(page.getByTestId("entity-row")).toContainText(["SG-OPS"]);
    await expectNoAxeViolations(page, "entities after add");
    await markDone(page, "entities", "Entities and currencies");
  });

  await test.step("2. ledger (a choice only)", async () => {
    await step(page, "ledger", /Step 2: Ledger/);
    await page.getByLabel("Ledger for SG-OPS").selectOption("xero");
    await page.getByRole("button", { name: "Save ledger for SG-OPS" }).click();
    await expect(page.getByTestId("ledger-SG-OPS")).toHaveText("Xero");
    await markDone(page, "ledger", "Ledger");
  });

  await test.step("3. bank accounts (last four only)", async () => {
    await step(page, "bank_accounts", /Step 3: Bank accounts/);
    await page.getByLabel("Account name").fill("Operating SGD");
    await page.getByLabel("Account currency").selectOption("SGD");
    await page.getByLabel("Last four characters of the account number").fill("123456789");
    await page.getByLabel("Bank", { exact: true }).fill("Fictional Bank");
    await page.getByRole("button", { name: "Add bank account" }).click();
    await expect(page.getByText(/Refused: Enter exactly the LAST FOUR/)).toBeVisible();
    await page.getByLabel("Last four characters of the account number").fill("6789");
    await page.getByRole("button", { name: "Add bank account" }).click();
    await expect(page.getByTestId("bank-account-row")).toContainText(["•••• 6789"]);
    await markDone(page, "bank_accounts", "Bank accounts");
  });

  await test.step("4. matching tolerance: the approved default", async () => {
    await step(page, "tolerance", /Step 4: Matching tolerance/);
    await expect(page.getByTestId("tolerance-row")).toContainText(["Larger of 0.50% or SGD 5.00"]);
    await expect(page.getByTestId("tolerance-row")).toContainText(["Default (revision 1)"]);
    await markDone(page, "tolerance", "Matching tolerance");
  });

  await test.step("5. payment provider", async () => {
    await step(page, "provider", /Step 5: Payment provider/);
    await expect(page.getByTestId("provider-none")).toBeVisible();
    await page.getByLabel("Provider code").fill("e2e-provider");
    await page.getByRole("button", { name: "Link provider" }).click();
    await expect(page.getByTestId("provider-linked")).toContainText("Fictional Provider (e2e)");
    await markDone(page, "provider", "Payment provider");
  });

  await test.step("6. mapping templates (optional)", async () => {
    await step(page, "mapping_templates", /Step 6: Mapping templates/);
    await page.getByLabel("File type").selectOption("bank_statement");
    await page.getByLabel("Template name").fill("Fictional Bank CSV");
    await page.getByLabel("Header row").fill("Value Date,Description,Amount,Currency,Bank Account,Reference");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByTestId("template-row")).toContainText(["Fictional Bank CSV"]);
    await markDone(page, "mapping_templates", "Mapping templates");
  });

  await test.step("7. users and roles", async () => {
    await step(page, "members", /Step 7: Users and roles/);
    await page.getByLabel("Email", { exact: true }).fill(financeEmail);
    await page.getByLabel("Role", { exact: true }).selectOption("finance");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByTestId("invitation-row")).toContainText([financeEmail]);
    await expectNoAxeViolations(page, "members with a pending invitation");
    await markDone(page, "members", "Users and roles");
  });

  await test.step("8. finish: the wizard becomes read-only", async () => {
    await step(page, "finish", /Step 8: Finish/);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByTestId("setup-finished")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add entity" })).toHaveCount(0);
    await expectNoAxeViolations(page, "setup finished");
    await signOut(page);
  });

  await test.step("the invited Finance member joins and is refused the wizard", async () => {
    await accept(page, (await invitationTo(financeEmail)).token, `Finance ${p} (fictional)`, pw);
    await signIn(page, financeEmail, pw, info);
    await page.goto("/control/merchant/setup");
    await expect(page.getByText("Only an Admin of this organisation runs its setup.")).toBeVisible();
    await expectNoAxeViolations(page, "setup as Finance");
    const r = await page.request.fetch("/api/control/merchant/setup/entity", { method: "POST", headers: { origin: ONBOARDING_E2E.origin, "content-type": "application/json", "idempotency-key": `e2e-${p}-refused` },
      data: JSON.stringify({ entityId: "NOPE", name: "No", currency: "SGD", timezone: "UTC" }) });
    expect(r.status()).toBe(403);
    await signOut(page);
  });
});
