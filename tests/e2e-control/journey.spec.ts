import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resetDatabase } from "./db";
import { api, expectNoAxeViolations, openNav, REDWOOD, signIn, signOut } from "./helpers";

/*
 * The Redwood Supplies acceptance journey on the real stack: Better Auth sign-in, the /api/control route handlers,
 * PostgreSQL with row-level security, and the maker-checker approval. Runs in both projects (desktop 1440×900 and
 * iPhone 13); each run starts from a freshly migrated and seeded database.
 *
 * Set CONTROL_SCREENSHOT_DIR to save payment-detail screenshots (docs/product/screenshots-rc5 holds a committed set).
 */

const CONFIRMATION_REF = "NL-RET-0188";
const NOTE = "Statement shows the debit and the return credit; supplier unpaid (fictional).";
const NEXT_ACTION = "Ask Redwood for corrected bank details (fictional)";

async function shot(page: Page, name: string, fullPage: boolean) {
  const dir = process.env.CONTROL_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  // full pages as JPEG to keep the committed files small
  await page.screenshot(fullPage ? { path: join(dir, `${name}.jpg`), fullPage, type: "jpeg", quality: 60 } : { path: join(dir, `${name}.png`) });
}

async function expectPersistedState(page: Page) {
  const exception = page.getByTestId("exception-returned_payout");
  await expect(exception.getByTestId("exception-status")).toHaveText("Resolved");
  await expect(page.getByTestId("supplier-unpaid")).toHaveText("Supplier still unpaid");
  await expect(page.getByTestId("net-movement")).toHaveText("USD 0.00");
  await expect(page.getByTestId("case-priority")).toHaveText("High");
  await expect(page.getByTestId("case-next-action")).toHaveText(NEXT_ACTION);
  await expect(page.getByTestId("case-due")).toHaveText("2026-12-01");
  await expect(page.getByTestId("case-owner")).toHaveText("Priya Raman (fictional)");
  await expect(page.getByTestId("notes")).toContainText(NOTE);
  await expect(page.getByTestId("timeline")).toContainText("Northline confirms USD 12,784.90 returned: account invalid (fictional)");
  await expect(page.getByTestId("approval-approved")).toBeVisible();
}

test("ops investigates the Redwood return, an approver approves it, the report and the state persist", async ({ page }, info) => {
  test.setTimeout(300_000);
  await resetDatabase();

  // 1. Ops signs in, opens Payments and finds Redwood Supplies: returned, net 0.00, supplier still unpaid.
  await signIn(page, "ops@lumen.example", info);
  await expect(page.getByTestId("staging-label")).toHaveText("PRIVATE STAGING — FICTIONAL DATA (no real payments)");
  await expect(page.getByTestId("org-name")).toHaveText("Lumen Cross-Border Payments (fictional)");
  await expect(page.getByTestId("signed-in-as")).toContainText("Payment Operations");
  await openNav(page, "Payments");
  await expect(page).toHaveURL(/\/control\/payments$/);
  const row = page.locator(`tr[data-reference="${REDWOOD}"]`);
  await expect(row).toContainText("Redwood Supplies Ltd (fictional)");
  await expect(row).toContainText("USD 12,784.90");
  await expect(row.locator('[data-column="execution"]')).toHaveText("Provider reports returned");
  await expect(row.locator('[data-column="settlement"]')).not.toHaveText("Settlement verified");
  await row.getByRole("link", { name: REDWOOD }).click();
  await expect(page).toHaveURL(/\/control\/payments\/pi_/);
  const paymentUrl = page.url();
  await expect(page.getByTestId("state-execution")).toContainText("Provider reports returned");
  await expect(page.getByTestId("state-settlement")).not.toContainText("Settlement verified");
  await expect(page.getByTestId("net-movement")).toHaveText("USD 0.00");
  await expect(page.getByTestId("supplier-unpaid")).toHaveText("Supplier still unpaid");
  // the return position never claims the supplier was paid
  expect(await page.getByTestId("return-position").innerText()).not.toMatch(/(?<!un)paid/i);

  // 2. Assign, case details, note, funds-returned confirmation, resolution request with evidence.
  const exception = page.getByTestId("exception-returned_payout");
  await exception.getByRole("button", { name: "Assign this exception to me" }).click();
  await expect(exception.getByRole("status").first()).toContainText("you are now the owner");
  await expect(exception).toContainText("Owner: Priya Raman (fictional) (you)");
  await expect(exception.getByTestId("exception-status")).toHaveText("In review");

  const kase = page.getByTestId("case");
  await kase.getByRole("button", { name: "Assign this investigation to me" }).click();
  await expect(page.getByTestId("case-owner")).toHaveText("Priya Raman (fictional)");
  await kase.getByLabel("Priority").selectOption("high");
  await kase.getByLabel("Next action").fill(NEXT_ACTION);
  await kase.getByLabel("Due date").fill("2026-12-01");
  await kase.getByRole("button", { name: "Save case details" }).click();
  await expect(kase.getByText("Saved: priority, next action and due date updated.")).toBeVisible();
  await expect(page.getByTestId("case-priority")).toHaveText("High");
  await expect(page.getByTestId("case-next-action")).toHaveText(NEXT_ACTION);
  await expect(page.getByTestId("case-due")).toHaveText("2026-12-01");

  await page.getByLabel("Add a note").fill(NOTE);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Saved: the note is recorded.")).toBeVisible();
  await expect(page.getByTestId("notes")).toContainText(NOTE);

  // a refusal is shown with the server's own message (the engine refuses a resolution before the confirmation exists)
  const resolution = exception.locator("form").filter({ has: page.getByRole("button", { name: "Request approval" }) });
  await resolution.getByLabel("Proposed resolution").fill("Trying to resolve before the confirmation is attached.");
  await resolution.getByLabel(/SIMBANK-0189/).check();
  await resolution.getByRole("button", { name: "Request approval" }).click();
  await expect(resolution.getByRole("alert")).toContainText("Refused:");

  const evidence = exception.locator("form").filter({ has: page.getByRole("button", { name: "Attach evidence" }) });
  await expect(evidence.getByLabel("Evidence type")).toHaveValue("funds_returned_confirmation");
  await evidence.getByLabel("Description").fill("Northline confirms USD 12,784.90 returned: account invalid (fictional)");
  await evidence.getByLabel("Reference").fill(CONFIRMATION_REF);
  await evidence.getByRole("button", { name: "Attach evidence" }).click();
  await expect(evidence.getByText(/Saved: the evidence is attached/)).toBeVisible();
  await expect(page.getByTestId("timeline")).toContainText("Northline confirms USD 12,784.90 returned: account invalid (fictional)");
  await expect(page.getByTestId("timeline")).toContainText("Attached by a person — not independent");

  await resolution.getByLabel("Proposed resolution").fill(`Funds returned (confirmation ${CONFIRMATION_REF}); supplier still unpaid — re-pay after corrected details.`);
  await resolution.getByLabel(new RegExp(CONFIRMATION_REF)).check();
  await resolution.getByLabel(/SIMBANK-0189/).check();
  await resolution.getByRole("button", { name: "Request approval" }).click();
  await expect(resolution.getByText("Sent for approval: version 1 is waiting for an approver.")).toBeVisible();
  const pending = page.getByTestId("approval-pending");
  await expect(pending.getByTestId("approval-status")).toHaveText("Waiting for an approver");
  await expect(pending).toContainText("Only an approver can decide this request.");
  await expectNoAxeViolations(page, "payment detail (ops, forms open)");

  // 3. Ops has no approve button, and a direct API approval by ops is refused with 403.
  await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  const approvals = (await (await api(page, "GET", "/api/control/approvals")).json()).approvals as { id: string; status: string; payloadSha256: string }[];
  const req = approvals.find((a) => a.status === "pending")!;
  const direct = await api(page, "POST", `/api/control/approvals/${req.id}/decision`, { decision: "approve", reason: "ops approving their own request", payloadSha256: req.payloadSha256 });
  expect(direct.status()).toBe(403);
  expect((await direct.json()).error.code).toBe("FORBIDDEN");

  // 4. The approver signs in and approves with the hash shown; resolved, supplier still unpaid.
  await signOut(page);
  await signIn(page, "approver@lumen.example", info);
  await expect(page.getByTestId("signed-in-as")).toContainText("Approver");
  await page.goto(paymentUrl);
  const toDecide = page.getByTestId("approval-pending");
  await expect(toDecide.getByTestId("approval-hash")).toHaveText(req.payloadSha256);
  await expect(page.getByRole("button", { name: "Assign this exception to me" })).toHaveCount(0);
  await expectNoAxeViolations(page, "payment detail (approver, decision form)");
  await toDecide.getByLabel("Reason for your decision").fill("Debit, return credit and the funds-returned confirmation checked.");
  await toDecide.getByRole("button", { name: "Approve version 1" }).click();
  await expect(page.getByText("Approved version 1. The server applied the resolution.")).toBeVisible();
  await expect(page.getByTestId("exception-returned_payout").getByTestId("exception-status")).toHaveText("Resolved");
  await expect(page.getByTestId("approval-approved")).toBeVisible();
  await expect(page.getByTestId("supplier-unpaid")).toHaveText("Supplier still unpaid");
  await expect(page.getByTestId("state-settlement")).not.toContainText("Settlement verified");

  // 5. The approver downloads the JSON report: it holds the approval and the evidence references.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-json").click()]);
  expect(download.suggestedFilename()).toMatch(/^clearline-report-lumen-demo-pi_\w+\.json$/);
  const report = JSON.parse(readFileSync(await download.path(), "utf8"));
  const approved = report.approvals.find((a: { status: string }) => a.status === "approved");
  expect(approved.payloadSha256).toBe(req.payloadSha256);
  expect(approved.decisions).toEqual([expect.objectContaining({ decision: "approve", reason: "Debit, return credit and the funds-returned confirmation checked." })]);
  expect(approved.payload.note).toContain(CONFIRMATION_REF);
  const detail = await (await api(page, "GET", `/api/control/payments/${new URL(paymentUrl).pathname.split("/").pop()}`)).json();
  const confirmation = (detail.evidence as { id: string; reference?: string }[]).find((e) => e.reference === CONFIRMATION_REF)!;
  const returnLine = (detail.evidence as { id: string; reference?: string }[]).find((e) => e.reference === "SIMBANK-0189")!;
  expect(approved.payload.evidenceRefs).toEqual([confirmation.id, returnLine.id].sort());
  expect(report.exceptions.find((e: { category: string }) => e.category === "returned_payout").status).toBe("resolved");
  expect(report.amounts.returnPosition).toMatchObject({ beneficiaryPaid: false, netMovement: { value: "0.00", currency: "USD" } });
  await shot(page, `payment-detail-${info.project.name === "mobile" ? "390" : "1440"}-top`, false);
  await shot(page, `payment-detail-${info.project.name === "mobile" ? "390" : "1440"}-full`, true);

  // 6. Sign out and in again: everything persisted.
  await signOut(page);
  await signIn(page, "ops@lumen.example", info);
  await page.goto(paymentUrl);
  await expectPersistedState(page);

  // 7. Reload: still there.
  await page.reload();
  await expectPersistedState(page);
  await openNav(page, "Audit");
  await expect(page.getByTestId("audit-table")).toContainText("resolution_approved");
  await expect(page.getByTestId("audit-table")).toContainText("Daniel Koh (fictional)");
});
