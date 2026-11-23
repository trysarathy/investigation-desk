import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { resetMerchantDatabase } from "./db";
import { LABEL, api, expectNoAxeViolations, expectNoOverflow, shot, signIn, signOut } from "./helpers";
import { uploadFiles } from "./live-files";

/*
 * rc7 upload journeys on the real stack, for a fictional LIVE merchant ("Your data"): upload generator files through
 * the browser (file input, the keyboard path), check the preview and what was detected, map the columns (accept the
 * suggestions, fix the wrong ones by hand, answer the date-order question, save a template), and the refusals
 * (duplicate file, Viewer, another merchant). Every file comes from the synthetic generator: fictional values only.
 */

const FIN = "finance@kestrelbay-live.example";
const VIEWER = "viewer@kestrelbay-live.example";
const OTHER = "finance@otherbay-live.example";
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

test("live merchant: upload, preview, map with suggestions and fixes, save templates; same-shaped file reuses the template", async ({ page }, info) => {
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
  await shot(page, info, "rc7-mapping", { scrollTo: "#map" });
  await page.getByLabel("Template name").fill("Kestrel provider export");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved template “Kestrel provider export” version 1" })).toBeVisible();
  await confirmMapping(page);
  await expect(page.getByText(/Mapped with template “Kestrel provider export” v1/)).toBeVisible();
  await axeBoth(page, info, "provider export mapped");

  // 2. Settlement report (totals per batch, JSON)
  await upload(page, "ENT-SG-SYN", "Settlement report", f.settlementTotals);
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
  await upload(page, "ENT-US-SYN", "Bank statement", { name: f.mt940Us.name, bytes: f.mt940Us.bytes });
  await expect(page.getByText("MT940 and camt.053 statements need no column mapping")).toBeVisible();
  await expect(page.getByTestId("file-facts")).toContainText("MT940 statement");
  await axeBoth(page, info, "MT940 upload");

  // 5. A same-shaped file (the USD account's CSV) is offered the saved template, still to be checked and confirmed
  await upload(page, "ENT-US-SYN", "Bank statement", f.bankCsvUs);
  await expect(page.getByTestId("template-applied")).toHaveText("Mapping from template “Harbour bank CSV” v1 applied — check and confirm.");
  await expect(field(page, "value_date").getByRole("combobox")).toHaveValue("Value Date");
  await expect(page.getByTestId("upload-status")).toHaveText("Stored, needs mapping");
  await axeBoth(page, info, "template applied");

  // 6. The same file again is refused before anything is stored
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption("ENT-SG-SYN");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "again.csv", mimeType: "text/csv", buffer: Buffer.from(f.providerSg.bytes) });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This file was already uploaded for ENT-SG-SYN" })).toBeVisible();
  await expect(page.getByTestId("upload-row")).toHaveCount(5);
  await axeBoth(page, info, "uploads list");
  await signOut(page);

  // 7. A Viewer reads the list and the mapping, and cannot upload (screen and server)
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
  await signOut(page);

  // 8. Another merchant's user does not see the upload at all
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
