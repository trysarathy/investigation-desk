import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { resetMerchantDatabase } from "./db";
import { LABEL, api, expectNoAxeViolations, expectNoOverflow, shot, signIn, signOut } from "./helpers";
import { uploadFiles } from "./live-files";

/*
 * rc7 upload journeys on the real stack, for a fictional LIVE merchant ("Your data"): upload generator files through
 * the browser (file input, the keyboard path), check the preview and what was detected, map the columns (accept the
 * suggestions, fix the wrong ones by hand, answer the date-order question, save a template), validate, confirm (a
 * second person for bank statements, bound to the file and report hashes), bring into reconciliation, reconcile, and
 * read the decisions labelled "Your data"; retention, delete, and the refusals (duplicate file, Viewer, another
 * merchant). Every file comes from the synthetic generator: fictional values only.
 */

const FIN = "finance@kestrelbay-live.example";
const VIEWER = "viewer@kestrelbay-live.example";
const OTHER = "finance@otherbay-live.example";
const APPROVER = "approver@kestrelbay-live.example";
const OPS = "ops@kestrelbay-live.example";
const ADMIN = "admin@kestrelbay-live.example";
const LIVE_LABEL = "Your data";

type File = { name: string; bytes: Uint8Array };

async function upload(page: Page, entity: string, type: string, f: File) {
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption(entity);
  await page.getByRole("radio", { name: new RegExp(`^${type}`) }).check();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: f.name, mimeType: "application/octet-stream", buffer: Buffer.from(f.bytes) });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page).toHaveURL(/\/control\/merchant\/uploads\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: /Stored “/ }).first()).toBeVisible();
  return page.url().split("/").pop()!;
}

const field = (page: Page, key: string) => page.getByTestId(`field-${key}`);
async function choose(page: Page, key: string, value: string) {
  await field(page, key).getByRole("combobox").first().selectOption(value);
}
/** Answer every question the mapping asks because the first rows cannot decide (never guessed by the screen). */
async function answer(page: Page, opts: { date: RegExp; decimal: RegExp; offset?: string }) {
  for (const fs of await page.getByRole("group", { name: /^Date order in / }).all()) if (!(await anyChecked(fs))) await fs.getByRole("radio", { name: opts.date }).check();
  for (const fs of await page.getByRole("group", { name: /^Decimal separator in / }).all()) if (!(await anyChecked(fs))) await fs.getByRole("radio", { name: opts.decimal }).check();
  if (opts.offset) for (const tz of await page.getByLabel(/^Time zone of times in /).all()) await tz.selectOption({ label: opts.offset });
}
const anyChecked = async (fs: Locator) => (await fs.getByRole("radio", { checked: true }).count()) > 0;

async function confirmMapping(page: Page) {
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Mapping confirmed/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("Mapped, needs validation");
}

async function validate(page: Page, message: string | RegExp) {
  await page.getByRole("button", { name: /^Validate (every row|again)$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("Validated, awaiting confirmation");
}
async function decide(page: Page, reason: string, message: RegExp) {
  await page.getByLabel("Reason for your decision").fill(reason);
  await page.getByRole("button", { name: "Confirm upload" }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("Confirmed");
}
async function bringIn(page: Page) {
  await page.getByRole("button", { name: "Bring into reconciliation" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Brought into reconciliation: \d+ row\(s\) added/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("In reconciliation");
}

const CHIP: Record<string, string> = { matched: "Matched", matched_with_difference: "Matched with difference", suggested_for_review: "Suggested for review", exception: "Exception" };

async function axeBoth(page: Page, info: TestInfo, where: string) {
  const back = page.viewportSize();
  for (const width of info.project.name === "mobile" ? [390] : [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page, `${where} at ${width}px`);
    await expectNoOverflow(page, `${where} at ${width}px`);
  }
  if (back) await page.setViewportSize(back);
}

async function expectLiveLabel(page: Page) {
  await expect(page.getByTestId("data-label")).toHaveText(LIVE_LABEL);
  await expect(page.getByTestId("demo-label")).toHaveCount(0);
  await expect(page.getByText(LABEL)).toHaveCount(0);
}

test("live merchant: upload, map, validate, confirm (bank by a second person), reconcile; templates, delete, retention, refusals", async ({ page }, info) => {
  test.setTimeout(600_000);
  await resetMerchantDatabase();
  const f = await uploadFiles();
  await signIn(page, FIN, info);
  await page.goto("/control/merchant/uploads");
  await expectLiveLabel(page);
  await expect(page.getByText(/20 MB, 100,000 rows and 200 columns/)).toBeVisible();
  await expect(page.getByText("No uploads yet.")).toBeVisible();
  await axeBoth(page, info, "uploads (empty)");

  // 1. Provider export, shape A: UTF-8 with BOM, commas, DD/MM dates, a TOTAL row
  const providerId = await upload(page, "ENT-SG-SYN", "Provider export", f.providerSg);
  const facts = page.getByTestId("file-facts");
  await expect(facts).toContainText("UTF-8, with a byte-order mark (removed)");
  await expect(facts).toContainText("commas");
  await expect(facts).toContainText(`${f.providerSg.rows} data rows; 1 total row left out`);
  await expect(page.getByTestId("read-warnings")).toContainText("looks like a total");
  const preview = page.getByRole("region", { name: /^First 20 rows of / });
  await expect(preview).toHaveAttribute("tabindex", "0");
  await expect(preview.locator("tbody tr")).toHaveCount(20);
  await expect(page.getByText("Nothing is used until you press")).toBeVisible();
  // suggestions are preselected, with their reason, and nothing is confirmed yet
  await expect(field(page, "order_id").getByRole("combobox")).toHaveValue("Order Ref");
  await expect(field(page, "order_id")).toContainText(/Suggested because the header/);
  await expect(field(page, "order_id")).toContainText("Required");
  await expect(page.getByTestId("upload-status")).toHaveText("Stored, needs mapping");
  // the screen asks rather than guesses: dates in the first rows read either way
  await expect(page.getByRole("group", { name: "Date order in Quote Created (SGT)" })).toContainText("could be day/month or month/day");
  await expect(page.getByRole("group", { name: "Date order in Quote Created (SGT)" }).getByRole("radio", { checked: true })).toHaveCount(0);
  // confirming with the question unanswered is refused in plain English
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Quote created at: choose the date order." })).toBeVisible();
  // fix the wrong suggestions by hand
  await choose(page, "quote_rate", "Quote Rate");
  await choose(page, "executed_rate", "Rate");
  await choose(page, "credited_fiat", `Credited (SGD)`);
  await choose(page, "batch_id", "Settled In");
  await choose(page, "paid_at", "Created (SGT)");
  await expect(field(page, "quote_rate")).toContainText("Chosen by you.");
  await expect(field(page, "currency").getByLabel("Fixed currency")).toHaveValue("SGD");
  await answer(page, { date: /^Day\/month\/year/, decimal: /^Decimal point/, offset: "UTC+08:00" });
  const status = page.getByRole("group", { name: "What each word in Status means" });
  await expect(status.getByLabel("“Paid”")).toHaveValue("paid");
  await status.getByLabel("“Completed”").selectOption("paid");
  // a word that only appears further down the file is added by hand (the screen shows the first 20 rows only)
  const shown = await status.getByRole("combobox").count();
  for (const w of f.providerSg.statuses) if ((await status.getByLabel(`“${w}”`, { exact: true }).count()) === 0) { await status.getByLabel("Another word in Status").fill(w); await status.getByRole("button", { name: "Add word" }).click(); }
  expect(await status.getByRole("combobox").count()).toBe(f.providerSg.statuses.length);
  expect(shown).toBeLessThanOrEqual(f.providerSg.statuses.length);
  for (const w of f.providerSg.statuses) expect(await status.getByLabel(`“${w}”`, { exact: true }).inputValue(), w).not.toBe("");
  await shot(page, info, "rc7-mapping", { scrollTo: "#map" });
  await page.getByLabel("Template name").fill("Kestrel provider export");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved template “Kestrel provider export” version 1" })).toBeVisible();
  await confirmMapping(page);
  await expect(page.getByText(/Mapped with template “Kestrel provider export” v1/)).toBeVisible();
  await axeBoth(page, info, "provider export mapped");

  // 2. Settlement report (totals per batch, JSON)
  const settlementId = await upload(page, "ENT-SG-SYN", "Settlement report", f.settlementTotals);
  await expect(page.getByRole("radio", { name: "One row per batch, with totals only" })).toBeChecked();
  await choose(page, "line_amount", "");
  await choose(page, "payment_id", "");
  await confirmMapping(page);

  // 3. Bank statement, CSV with semicolons, DD.MM.YYYY and decimal commas; one account for the whole file
  const bankId = await upload(page, "ENT-SG-SYN", "Bank statement", f.bankCsvSg);
  await expect(page.getByTestId("file-facts")).toContainText("semicolons");
  await shot(page, info, "rc7-upload-preview");
  await choose(page, "value_date", "Value Date");
  await choose(page, "booking_date", "Booking Date");
  await choose(page, "bank_account", "__constant__");
  await field(page, "bank_account").getByLabel("Fixed bank account").fill(f.bankCsvSg.account!);
  await answer(page, { date: /^Day\/month\/year/, decimal: /^Decimal comma/ });
  await page.getByLabel("Template name").fill("Harbour bank CSV");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved template “Harbour bank CSV” version 1" })).toBeVisible();
  await confirmMapping(page);
  await axeBoth(page, info, "bank statement mapped");

  // 4. MT940 (no column mapping)
  const mt940Id = await upload(page, "ENT-US-SYN", "Bank statement", { name: f.mt940Us.name, bytes: f.mt940Us.bytes });
  await expect(page.getByText("MT940 and camt.053 statements need no column mapping")).toBeVisible();
  await expect(page.getByTestId("file-facts")).toContainText("MT940 statement");
  await axeBoth(page, info, "MT940 upload");

  // 5. A same-shaped file (the USD account's CSV) is offered the saved template, still to be checked and confirmed
  await upload(page, "ENT-US-SYN", "Bank statement", f.bankCsvUs);
  await expect(page.getByTestId("template-applied")).toHaveText("Mapping from template “Harbour bank CSV” v1 applied — check and confirm.");
  await expect(field(page, "value_date").getByRole("combobox")).toHaveValue("Value Date");
  await expect(page.getByTestId("upload-status")).toHaveText("Stored, needs mapping");
  await axeBoth(page, info, "template applied");
  // ...and is deleted again, with a confirmation step (its mapping was never confirmed)
  await page.getByRole("button", { name: "Delete upload" }).click();
  await expect(page.getByRole("group", { name: /^Delete “/ })).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Keep it" }).click();
  await page.getByRole("button", { name: "Delete upload" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page).toHaveURL(/\/control\/merchant\/uploads$/);
  await expect(page.getByRole("status").filter({ hasText: /^Deleted “/ })).toBeVisible();

  // 6. The same file again is refused before anything is stored
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption("ENT-SG-SYN");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "again.csv", mimeType: "text/csv", buffer: Buffer.from(f.providerSg.bytes) });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This file was already uploaded for ENT-SG-SYN" })).toBeVisible();
  await expect(page.getByTestId("upload-row")).toHaveCount(4);
  await axeBoth(page, info, "uploads list");

  // 7. Validate, confirm and bring the provider export and the settlement report into reconciliation
  await page.goto(`/control/merchant/uploads/${providerId}`);
  // USDT on Ethereum is a configured token (founder decision, rc7), so no row is rejected; every row warns that the
  // file has no log index (the transfer is found from chain data, never assumed)
  await validate(page, `Validated ${f.providerSg.rows} rows: 0 accepted, ${f.providerSg.rows} with warnings, 0 rejected, 0 duplicates.`);
  await page.getByRole("navigation", { name: "Filter rows by status" }).getByRole("link", { name: "Accepted with a warning" }).click();
  await expect(page.getByTestId("report-row")).toHaveCount(f.providerSg.rows);
  await expect(page.getByTestId("report-row").first()).toContainText("Log index is not in the file; the transfer is found from chain data (never assumed)");
  await expect(page.getByTestId("report-range")).toContainText(`Rows 1–${f.providerSg.rows} of ${f.providerSg.rows} (accepted with a warning)`);
  await shot(page, info, "rc7-validation-report", { scrollTo: "#report" });
  await axeBoth(page, info, "validation report");
  await page.goto(`/control/merchant/uploads/${providerId}`);
  await decide(page, "Checked the totals against the provider portal (fictional).", /Confirmed: \d+ row\(s\) can now be brought into reconciliation/);
  await bringIn(page);
  await page.goto(`/control/merchant/uploads/${settlementId}`);
  await validate(page, "Validated 14 rows: 14 accepted, 0 with warnings, 0 rejected, 0 duplicates.");
  await decide(page, "Batch totals match the provider's payout list (fictional).", /Confirmed: 14 row\(s\)/);
  await bringIn(page);

  // 8. Bank statements wait for a second person: the uploader sees no confirm button, and the server refuses one
  await page.goto(`/control/merchant/uploads/${bankId}`);
  await validate(page, /^Validated 11 rows: 11 accepted/);
  await expect(page.getByTestId("second-person")).toContainText("Waiting for a second person (an Approver who did not upload it).");
  await expect(page.getByRole("button", { name: "Confirm upload" })).toHaveCount(0);
  await shot(page, info, "rc7-awaiting-second-person", { scrollTo: "#confirm" });
  await axeBoth(page, info, "awaiting second person");
  const bankSummary = (await (await api(page, "GET", `/api/control/merchant/uploads/${bankId}`)).json()).upload;
  expect((await api(page, "POST", `/api/control/merchant/uploads/${bankId}/decision`, { decision: "confirm", reason: "self confirmation attempt", contentSha256: bankSummary.contentSha256, rowsSha256: bankSummary.rowsSha256 })).status()).toBe(403);
  await page.goto(`/control/merchant/uploads/${mt940Id}`);
  await validate(page, /^Validated \d+ rows/);
  await expect(page.getByTestId("second-person")).toContainText("Waiting for a second person");
  await signOut(page);

  // 9. A Viewer reads the list and the mapping, and cannot upload (screen and server)
  await signIn(page, VIEWER, info);
  await page.goto("/control/merchant/uploads");
  await expectLiveLabel(page);
  await expect(page.getByTestId("read-only-note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(0);
  await page.goto(`/control/merchant/uploads/${providerId}`);
  await expect(page.getByTestId("mapping-summary")).toContainText("Credited (SGD)");
  await expect(page.getByRole("button", { name: "Confirm mapping" })).toHaveCount(0);
  await axeBoth(page, info, "upload as Viewer");
  expect((await api(page, "POST", `/api/control/merchant/uploads/${bankId}/validate`, {})).status()).toBe(403);
  await page.goto(`/control/merchant/uploads/${bankId}`);
  await expect(page.getByTestId("second-person")).toContainText("Waiting for a second person");
  await signOut(page);

  // 10. An Approver who did not upload it confirms the exact file and report, then brings both statements in
  await signIn(page, APPROVER, info);
  for (const id of [bankId, mt940Id]) {
    await page.goto(`/control/merchant/uploads/${id}`);
    await expect(page.getByTestId("second-person")).toContainText("You are the second person");
    const sum = (await (await api(page, "GET", `/api/control/merchant/uploads/${id}`)).json()).upload;
    await expect(page.getByTestId("content-hash")).toHaveText(sum.contentSha256);
    await expect(page.getByTestId("report-hash")).toHaveText(sum.rowsSha256);
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/uploads/${id}/decision`));
    await decide(page, "Compared with the bank's online statement (fictional).", /Confirmed by a second person/);
    expect((await sent).postDataJSON()).toMatchObject({ decision: "confirm", contentSha256: sum.contentSha256, rowsSha256: sum.rowsSha256 });
    await bringIn(page);
  }
  await signOut(page);

  // 11. Payment Operations reconcile; the daily report and the payments show the decisions, labelled "Your data"
  await signIn(page, OPS, info);
  await page.goto(`/control/merchant/uploads/${providerId}`);
  await expect(page.getByTestId("in-reconciliation")).toBeVisible();
  await page.getByRole("button", { name: "Run reconciliation for ENT-SG-SYN" }).click();
  // the decisions come from the generator's ground truth for these files (truth-expect.ts), never pinned
  const expected = [...f.expectedSg.entries()].filter(([, e]) => !(e.kind === "abstain" && e.noRecord));
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`Reconciled ${expected.length} payments for`) }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("in-reconciliation").getByRole("link", { name: "daily report" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Daily report");
  await expectLiveLabel(page);
  await expect(page.getByTestId("daily-summary")).toContainText(/\d+ payments? · /);
  await axeBoth(page, info, "daily report (live)");
  await page.goto("/control/merchant/payments?entity=ENT-SG-SYN");
  await expectLiveLabel(page);
  await expect(page.getByTestId("payments-count")).toContainText(`${expected.length} of ${expected.length} payments`);
  const chip = (order: string) => page.getByRole("row").filter({ hasText: order }).getByTestId("decision-chip");
  for (const [order, e] of expected) {
    if (e.kind !== "abstain" || e.decision) await expect(chip(order), `${order} (${e.kind === "truth" ? "truth" : e.why})`).toHaveText(CHIP[e.decision!]);
    else await expect(chip(order), `${order} must not be closed: ${e.why}`).toHaveText(/^(Suggested for review|Exception)$/);
  }
  // the counts per decision follow from the same expectations
  for (const [d, label] of Object.entries(CHIP)) {
    const n = expected.filter(([, e]) => e.kind !== "abstain" ? e.decision === d : e.decision === d).length;
    if (expected.every(([, e]) => e.kind !== "abstain" || e.decision)) await expect(page.getByTestId("decision-chip").filter({ hasText: new RegExp(`^${label}$`) }), label).toHaveCount(n);
  }
  await axeBoth(page, info, "payments (live)");
  await signOut(page);

  // 12. The Admin sets retention on the settings page; each upload shows its delete-after date
  await signIn(page, ADMIN, info);
  await page.goto("/control/merchant/settings");
  await expect(page.getByTestId("retention-days")).toContainText("90 days");
  await page.getByLabel("Keep uploads for (days)").fill("30");
  await page.getByRole("button", { name: "Save retention" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved: new uploads are deleted after 30 days." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("retention-days")).toContainText("30 days");
  await axeBoth(page, info, "settings with retention");
  await page.goto("/control/merchant/uploads");
  await expect(page.getByTestId("upload-row").first()).toContainText(/\d{4}-\d{2}-\d{2}$/);
  await signOut(page);

  // 13. Another merchant's user does not see the upload at all
  await signIn(page, OTHER, info);
  await page.goto(`/control/merchant/uploads/${providerId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
  expect((await api(page, "GET", `/api/control/merchant/uploads/${providerId}`)).status()).toBe(404);
  expect((await api(page, "GET", `/api/control/merchant/uploads/${providerId}/preview`)).status()).toBe(404);
  await page.goto("/control/merchant/uploads");
  await expect(page.getByText("No uploads yet.")).toBeVisible();
});

test("a sample organisation keeps the demo label and offers no upload", async ({ page }, info) => {
  await signIn(page, "finance@straits-demo.example", info);
  await page.goto("/control/merchant/uploads");
  await expect(page.getByTestId("demo-label")).toHaveText(LABEL);
  await expect(page.getByTestId("data-label")).toHaveCount(0);
  await expect(page.getByText(/This organisation holds sample data/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(0);
  await axeBoth(page, info, "sample uploads");
});

test("keyboard: the upload form works without drag and drop (file input, entity, file type, submit)", async ({ page }, info) => {
  await signIn(page, OPS, info);
  await page.goto("/control/merchant/uploads");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uploads");
  await page.getByRole("heading", { level: 1 }).click();
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    seen.add(await page.evaluate(() => { const e = document.activeElement as HTMLInputElement | null; return e ? `${e.tagName}:${e.type ?? ""}:${e.name ?? ""}:${(e.textContent ?? "").trim().slice(0, 30)}` : ""; }));
  }
  const all = [...seen].join("\n");
    expect(all).toMatch(/SELECT:select-one:entityId/);
  expect(all).toMatch(/INPUT:radio:fileType/);
  expect(all).toMatch(/INPUT:file:file/);
  expect(all).toMatch(/BUTTON:submit::Upload file/);
  // a file that is too large is refused in the browser before anything is sent
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "too-big.csv", mimeType: "text/csv", buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 0x41) });
  await expect(page.getByRole("alert").filter({ hasText: "the largest file accepted is 20.0 MB" })).toBeVisible();
  // an unreadable file is refused by the server with its plain-English reason
  await page.getByLabel("Entity").selectOption("ENT-SG-SYN");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("\n\n") });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /^Refused: / })).toBeVisible();
});
