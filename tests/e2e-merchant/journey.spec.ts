import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resetMerchantDatabase } from "./db";
import { LABEL, api, download, expectNoAxeViolations, expectNoOverflow, nav, shot, signIn, signOut, submitAndConfirm } from "./helpers";

/*
 * One full journey per case on the real stack (Better Auth sign-in, /api/control/merchant, PostgreSQL with forced
 * RLS, the rc5 two-person approval with hash binding): seed → reconcile → daily report → open the exception or the
 * difference → propose a resolution or a write-off → a second user approves the exact hash → export the evidence pack
 * or the journal file. Each journey starts from a freshly migrated and seeded database. Test mode · illustrative data.
 */

async function reconcile(page: Page, entityId: string, records: number) {
  await submitAndConfirm(page, () => page.getByRole("button", { name: `Run reconciliation for ${entityId}` }).click(), new RegExp(`Reconciled ${records} payments`));
}

async function showReport(page: Page, entityId: string, date: string) {
  await page.getByLabel("Entity", { exact: true }).selectOption(entityId);
  await page.getByRole("button", { name: "Show report" }).click();
  await page.getByLabel("Date (merchant day)").selectOption(date);
  await page.getByRole("button", { name: "Show report" }).click();
  await expect(page).toHaveURL(new RegExp(`entity=${entityId}.*date=${date}`));
}

/** Attach evidence and propose a resolution; returns the hash the server bound. */
async function proposeResolution(page: Page, exceptionId: string, evidence: string, reference: string, note: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Exception ${exceptionId}`);
  const attach = page.locator("div").filter({ has: page.getByRole("heading", { name: "Attach evidence", level: 3 }) }).last();
  await attach.getByLabel("Evidence description").fill(evidence);
  await attach.getByLabel("Reference (optional)").fill(reference);
  await submitAndConfirm(page, () => attach.getByRole("button", { name: "Attach evidence" }).click(), /the evidence is attached/);
  await expect(page.getByText(evidence).first()).toBeVisible();
  await page.getByLabel("Proposed resolution", { exact: true }).fill(note);
  await expect(page.getByRole("checkbox", { name: new RegExp(reference) })).toBeChecked();
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Propose resolution for approval" }).click(), /Sent for approval: version 1/);
  await expect(page.getByTestId("exception-status")).toContainText("In review");
}

/** The preparer sees the request but no way to approve it; the server refuses a direct call too. */
async function preparerCannotApprove(page: Page, what: "resolution" | "write-off") {
  await nav(page, "Approvals");
  const req = page.getByTestId("approval-request").first();
  await expect(req.getByTestId("preparer-note")).toHaveText(`You prepared this ${what}, so you cannot approve it. A different approver must decide.`);
  await expect(req.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  const list = await (await api(page, "GET", "/api/control/merchant/approvals")).json();
  const pending = list.requests.find((r: { status: string }) => r.status === "pending");
  const r = await api(page, "POST", `/api/control/merchant/approvals/${pending.id}/decision`, { decision: "approve", reason: "self approval attempt", payloadSha256: pending.payloadSha256 });
  expect(r.status()).toBe(403);
  return pending.payloadSha256 as string;
}

/** A different approver reviews the payload and submits its exact hash with the decision. */
async function approveByHash(page: Page, expectedHash: string, what: string) {
  await nav(page, "Approvals");
  const req = page.getByTestId("approval-request").first();
  await expect(req.getByTestId("approval-hash")).toHaveValue(expectedHash);
  await req.getByLabel("Reason for your decision").fill("Reviewed the payload and the cited evidence (fictional).");
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/api\/control\/merchant\/approvals\/.+\/decision$/.test(r.url()));
  await req.getByRole("button", { name: "Approve version 1" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ decision: "approve", payloadSha256: expectedHash });
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`Approved ${what} version 1`) }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("approval-request")).toHaveCount(0);
}

function check(page: Page, info: TestInfo, where: string) {
  return Promise.all([expectNoAxeViolations(page, `${where} (${info.project.name})`), expectNoOverflow(page, `${where} (${info.project.name})`)]);
}

test("Case 1 (SGD, B-1124-001): reconcile, report, the underpayment exception resolved by two people, evidence pack", async ({ page }, info) => {
  test.setTimeout(300_000);
  await resetMerchantDatabase();
  await signIn(page, "ops@straits-demo.example", info);
  await expect(page.getByTestId("demo-label")).toHaveText(LABEL);
  await expect(page.getByTestId("brand-name")).toHaveText("Northwind Pay (fictional)");
  await expect(page.getByText("powered by Clearline")).toBeVisible();
  await expect(page.getByText("Nothing has been reconciled yet.")).toBeVisible();
  await reconcile(page, "ENT-SG-01", 4);

  await showReport(page, "ENT-SG-01", "2026-11-24");
  await expect(page.getByTestId("daily-summary")).toHaveText("4 payments · 1 settlement tied · 2 exceptions · 1 write-off awaiting approval");
  await expect(page.getByTestId("cutoff-note")).toContainText("provider day = UTC");
  await check(page, info, "daily report");
  await shot(page, info, "01-daily-report-summary");

  await nav(page, "Exceptions");
  await expect(page.getByRole("region", { name: "Open exceptions table" })).toContainText("SGD 324.00");
  await page.getByRole("link", { name: "EX-BK-24823" }).click();
  await expect(page.getByTestId("exception-reason")).toContainText("1,760.00 USDT of 2,000.00 USDT");
  await page.getByLabel("Owner", { exact: true }).selectOption({ label: "Ravi Pillai (fictional) (Payment Operations)" });
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Save owner" }).click(), /Ravi Pillai \(fictional\) owns this exception/);
  await expect(page.getByTestId("exception-owner")).toHaveText("Ravi Pillai (fictional)");
  await check(page, info, "exception");
  await shot(page, info, "02-exception-opened");
  await proposeResolution(page, "EX-BK-24823", "Customer paid the SGD 324.00 balance through balance link BL-24823 (fictional).", "BL-24823", "Balance received through link BL-24823; the order is fully paid.");
  const hash = await preparerCannotApprove(page, "resolution");
  await signOut(page);

  await signIn(page, "approver@straits-demo.example", info);
  await approveByHash(page, hash, "resolution");
  await page.goto("/control/merchant/exceptions/EX-BK-24823");
  await expect(page.getByTestId("exception-status")).toHaveText("Resolved");
  await page.goto("/control/merchant/payments/BK-24823");
  await expect(page.getByTestId("part-chain")).toBeVisible();
  for (const p of ["part-provider", "part-bank", "part-ledger", "part-explanation"]) await expect(page.getByTestId(p)).toBeVisible();
  await expect(page.getByTestId("deciding-step")).toContainText("Decided at step 4 (Explained tolerance)");
  await check(page, info, "payment detail");
  await shot(page, info, "03-payment-detail", { fullPage: true });
  const pdf = await download(page, () => page.getByRole("link", { name: "Download PDF summary" }).click());
  expect(pdf.name).toBe("clearline-evidence-straits-demo-sg-BK-24823.pdf");
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const json = await download(page, () => page.getByRole("link", { name: "Download JSON" }).click());
  const pack = JSON.parse(json.bytes.toString("utf8"));
  expect(pack).toMatchObject({ label: LABEL, approvals: [{ kind: "merchant_resolution", status: "approved", payloadSha256: hash }] });
  expect(pack.chainProof.length).toBe(1);
});

test("Case 2 (one settlement, many payments): the bridge ties, the held payment resolved by two people, journal file", async ({ page }, info) => {
  test.setTimeout(300_000);
  await resetMerchantDatabase();
  await signIn(page, "ops@straits-demo.example", info);
  await reconcile(page, "ENT-SG-02", 35);
  await showReport(page, "ENT-SG-02", "2026-11-25");
  await expect(page.getByTestId("daily-summary")).toContainText("payments · 1 settlement tied · 1 exception · 0 write-offs awaiting approval");

  await nav(page, "Batches");
  await page.getByRole("link", { name: "B-1125-SGD" }).click();
  await expect(page.getByTestId("batch-tied")).toHaveText("Tied to the cent");
  const bridge = page.getByRole("region", { name: "Batch bridge table" });
  await expect(bridge).toContainText("SGD 41,862.30");
  await expect(bridge).toContainText("SGD 40,228.68");
  await check(page, info, "batch bridge");
  await shot(page, info, "04-batch-bridge", { fullPage: true });
  await bridge.getByRole("link", { name: "33 payments" }).click();
  await expect(page.getByTestId("payments-count")).toContainText("33 of 35 payments");
  await page.goBack();
  await bridge.getByRole("link", { name: "BK-24871" }).click();
  await expect(page).toHaveURL(/\/payments\/BK-24871$/);
  await page.getByRole("link", { name: "EX-BK-24871" }).click();
  await expect(page.getByTestId("exception-reason")).toHaveText("Shown as completed, in no settlement, held for review.");
  await proposeResolution(page, "EX-BK-24871", "Provider ticket NW-5521 confirms the hold is released (fictional).", "NW-5521", "Provider released the hold; the payment settles in the next batch.");
  const hash = await preparerCannotApprove(page, "resolution");
  await signOut(page);

  await signIn(page, "approver2@straits-demo.example", info);
  await approveByHash(page, hash, "resolution");
  await signOut(page);

  await signIn(page, "finance@straits-demo.example", info);
  await nav(page, "Month-end");
  await page.getByLabel("Entity", { exact: true }).selectOption("ENT-SG-02");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("region", { name: "Receivable from the provider table" })).toContainText("BK-24871");
  await check(page, info, "month-end");
  await shot(page, info, "05-month-end", { fullPage: true });
  await nav(page, "Accounting export");
  await page.getByLabel("Entity", { exact: true }).selectOption("ENT-SG-02");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByTestId("sandbox-note")).toContainText("Sandbox/demo company only; posting rules pending sign-off.");
  const entries = page.getByTestId("journal-entry");
  await expect(entries.first()).toBeVisible();
  expect(await page.getByTestId("pending-sign-off").count()).toBeGreaterThanOrEqual(await entries.count());
  await check(page, info, "accounting export");
  await shot(page, info, "06-journal-entries-preview", { scrollTo: "#preview" });
  const f = await download(page, () => page.getByRole("link", { name: "Download journal CSV (sandbox)" }).click());
  expect(f.name).toBe("clearline-journals-straits-demo-sg-ENT-SG-02-2026-11.csv");
  const csv = f.bytes.toString("utf8");
  expect(csv).toContain("SANDBOX-JP-SETL-B-1125-SGD");
  expect(csv).toContain("pending_sign_off");
  expect(csv).toContain("sandbox/demo company only; posting rules pending sign-off");
});

test("Case 3 (AED, two chains, two links): the 14.16 write-off proposed by Finance, approved by a second person, evidence and journals", async ({ page }, info) => {
  test.setTimeout(300_000);
  await resetMerchantDatabase();
  await signIn(page, "ops@dunehaven-demo.example", info);
  await reconcile(page, "ENT-AE-03", 1);
  await signOut(page);

  await signIn(page, "finance@dunehaven-demo.example", info);
  await expect(page.getByTestId("daily-summary")).toContainText("write-off awaiting approval");
  await nav(page, "Payments");
  await page.getByRole("link", { name: "BK-25102" }).click();
  await expect(page.getByTestId("part-chain")).toContainText("tron");
  await expect(page.getByTestId("part-chain")).toContainText("ethereum");
  await expect(page.getByRole("region", { name: "Differences table" })).toContainText("Underpayment");
  await submitAndConfirm(page, () => page.getByRole("button", { name: "Submit write-off of AED 14.16 for approval" }).click(), /Sent for approval: write-off AED 14.16 v1/);
  const hash = await preparerCannotApprove(page, "write-off");
  await signOut(page);

  await signIn(page, "approver@dunehaven-demo.example", info);
  await approveByHash(page, hash, "write-off");
  await check(page, info, "approvals");
  await nav(page, "Evidence packs");
  const pack = JSON.parse((await download(page, () => page.getByRole("link", { name: "Download JSON" }).click())).bytes.toString("utf8"));
  expect(pack.scope).toEqual({ kind: "month", entityId: "ENT-AE-03", month: "2026-12" });
  expect(pack.writeoffs).toEqual([expect.objectContaining({ orderId: "BK-25102", amountMinor: "1416", status: "approved" })]);
  expect(pack.approvals[0]).toMatchObject({ kind: "merchant_writeoff", status: "approved", payloadSha256: hash });
  const csv = (await download(page, () => page.getByRole("link", { name: "Download CSV" }).click())).bytes.toString("utf8");
  expect(csv.split("\r\n")[0]).toBe("section,id,order_id,field_1,field_2,field_3,field_4,detail,marking");
  expect(csv).not.toMatch(/(^|,)[=+@-]/m);
  await check(page, info, "evidence packs");
  await signOut(page);

  await signIn(page, "finance@dunehaven-demo.example", info);
  await nav(page, "Accounting export");
  await expect(page.getByTestId("journal-entry").filter({ hasText: "Write-off (after approval)" })).toBeVisible();
  const j = JSON.parse((await download(page, () => page.getByRole("link", { name: "Download journal JSON (sandbox)" }).click())).bytes.toString("utf8"));
  expect(j).toMatchObject({ label: LABEL, marking: "sandbox/demo company only; posting rules pending sign-off", entity: { id: "ENT-AE-03" } });
});
