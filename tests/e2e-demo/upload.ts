/**
 * The live upload of demo-files/ (step 11 of the demo journey, and upload.spec.ts on its own): map once, save the
 * provider layout as a template, validate, confirm (the bank statement by a second person, the Approver) and bring
 * into reconciliation, as a presenter does it in the browser. Demo · fictional data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { api, switchTo } from "./demo";
import { DEMO_E2E, DEMO_USERS } from "./env";

export const FILES = path.join(DEMO_E2E.root, "demo-files");
export const EXPECTED = JSON.parse(readFileSync(path.join(FILES, "expected-outcomes.json"), "utf8")) as {
  mappings: Record<"orders" | "provider", { columns: Record<string, { header?: string; constant?: string; statusValueMap?: Record<string, string> }> }>;
  decisionsAfter: Record<string, number>;
  decisionsBefore: Record<string, number>;
  rulesAfter: Record<string, number>;
  newOrders: Record<string, string>;
  uploads: Record<string, { rows: Record<string, number>; normalised: Record<string, number> }>;
  batches: Record<string, { tied: boolean; settlementVerified: boolean; bankLineLabel: string }>;
  run: { records: number; exceptions: number; runCounts: Record<string, number> };
};
export const file = (name: string) => ({ name, mimeType: "application/octet-stream", buffer: readFileSync(path.join(FILES, name)) });

const field = (page: Page, key: string) => page.getByTestId(`field-${key}`);
export async function upload(page: Page, entity: string, type: RegExp, f: ReturnType<typeof file>) {
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption(entity);
  await page.getByRole("radio", { name: type }).check();
  await page.getByLabel("File", { exact: true }).setInputFiles(f);
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page).toHaveURL(/\/control\/merchant\/uploads\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: /Stored “/ }).first()).toBeVisible();
  return page.url().split("/").pop()!;
}
/** Map every column as demo-files/expected-outcomes.json records it (the file Clearline has no template for). */
export async function mapColumns(page: Page, columns: Record<string, { header?: string; constant?: string; statusValueMap?: Record<string, string> }>) {
  // a suggestion for a field the recorded mapping leaves out is cleared (the person decides, never the guess)
  for (const row of await page.locator('[data-testid^="field-"]').all()) {
    const key = (await row.getAttribute("data-testid"))!.slice("field-".length);
    if (key in columns) continue;
    const box = row.getByRole("combobox").first();
    if ((await box.inputValue()) !== "" && (await box.locator('option[value=""]').count()) > 0) await box.selectOption("");
  }
  for (const [key, c] of Object.entries(columns)) {
    const row = field(page, key);
    if (c.header) await row.getByRole("combobox").first().selectOption(c.header);
    else if (c.constant) { await row.getByRole("combobox").first().selectOption("__constant__"); await row.getByRole("textbox").first().fill(c.constant); }
  }
  for (const tz of await page.getByLabel(/^Time zone of times in /).all()) await tz.selectOption({ label: "UTC+08:00" });
  for (const [key, c] of Object.entries(columns)) {
    if (!c.statusValueMap || !c.header) continue;
    const words = page.getByRole("group", { name: `What each word in ${c.header} means` });
    for (const [w, v] of Object.entries(c.statusValueMap)) {
      if ((await words.getByLabel(`“${w}”`, { exact: true }).count()) === 0) { await words.getByLabel(`Another word in ${c.header}`).fill(w); await words.getByRole("button", { name: "Add word" }).click(); }
      await words.getByLabel(`“${w}”`, { exact: true }).selectOption(v);
    }
    void key;
  }
}
export async function confirmMapping(page: Page) {
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Mapping confirmed/ }).first()).toBeVisible({ timeout: 30_000 });
}
export async function validate(page: Page, message: RegExp) {
  await page.getByRole("button", { name: /^Validate (every row|again)$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("Validated, awaiting confirmation");
}
export async function decide(page: Page, reason: string, message: RegExp) {
  await page.getByLabel("Reason for your decision").fill(reason);
  await page.getByRole("button", { name: "Confirm upload" }).click();
  await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeVisible({ timeout: 30_000 });
}
export async function bringIn(page: Page) {
  await page.getByRole("button", { name: "Bring into reconciliation" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Brought into reconciliation: \d+ row\(s\) added/ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("In reconciliation");
}
export async function status(page: Page, text: RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible({ timeout: 30_000 });
}


/**
 * Step 11: the three demo files through the real pipeline as Finance, the bank statement confirmed by the Approver
 * (a second person, through the switcher), then "Run reconciliation for NW-SG" as Finance. Ends signed in as Finance
 * on the reconciled provider upload. `check` runs the page checks (axe, overflow, label, errors) where the journey does.
 */
export async function liveUpload(page: Page, check: (where: string) => Promise<void>): Promise<{ orders: string; provider: string; bank: string }> {
  // orders (xlsx)
  const orders = await upload(page, "NW-SG", /^Orders or invoices/, file("northwind-sg-bookings-2026-12-08.xlsx"));
  await mapColumns(page, EXPECTED.mappings.orders.columns);
  await confirmMapping(page);
  await validate(page, /^Validated 24 rows: 24 accepted/);
  await decide(page, "Checked against the booking system (fictional).", /Confirmed: 24 row\(s\)/);
  await bringIn(page);
  // the provider's own layout, mapped once and saved as a template
  const provider = await upload(page, "NW-SG", /^Provider export/, file("provider-p-payments-2026-12-08.csv"));
  await expect(page.getByRole("region", { name: /^First 20 rows of / })).toBeVisible();
  await mapColumns(page, EXPECTED.mappings.provider.columns);
  await page.getByLabel("Template name").fill("Provider P payments (demo)");
  await page.getByRole("button", { name: "Save as template" }).click();
  await status(page, /Saved template “Provider P payments \(demo\)” version 1/);
  await confirmMapping(page);
  await check("provider export mapped");
  await validate(page, /^Validated 24 rows: /);
  await decide(page, "Totals agree with the provider portal (fictional).", /Confirmed: 24 row\(s\)/);
  await bringIn(page);
  // the camt.053 statement: Finance uploads it and cannot confirm it
  const bank = await upload(page, "NW-SG", /^Bank statement/, file("northwind-sgd-statement-2026-12-08.camt053.xml"));
  await validate(page, /^Validated 2 rows: 2 accepted/);
  await expect(page.getByTestId("second-person")).toContainText("Waiting for a second person");
  await expect(page.getByRole("button", { name: "Confirm upload" })).toHaveCount(0);
  const sum = (await (await api(page, "GET", `/api/control/merchant/uploads/${bank}`)).json()).upload as { contentSha256: string; rowsSha256: string };
  expect((await api(page, "POST", `/api/control/merchant/uploads/${bank}/decision`, { decision: "confirm", reason: "self confirmation attempt", contentSha256: sum.contentSha256, rowsSha256: sum.rowsSha256 })).status()).toBe(403);
  await check("bank statement waiting for a second person");
  // the Approver confirms it
  await switchTo(page, DEMO_USERS.approver);
  await page.goto(`/control/merchant/uploads/${bank}`);
  await expect(page.getByTestId("second-person")).toContainText("You are the second person");
  await decide(page, "Compared with the bank's online statement (fictional).", /Confirmed by a second person/);
  await bringIn(page);
  // Finance reconciles NW-SG now; the run shows its progress, then the results
  await switchTo(page, DEMO_USERS.finance);
  await page.goto(`/control/merchant/uploads/${provider}`);
  await expect(page.getByTestId("in-reconciliation")).toBeVisible();
  await page.getByRole("button", { name: "Run reconciliation for NW-SG" }).click();
  await expect(page.getByTestId("reconcile-progress-NW-SG")).toContainText("Reconciling NW-SG");
  await status(page, /Reconciled \d+ payments for /);
  await page.goto("/control/merchant/payments/BK-39021");
  await expect(page.getByTestId("decision-chip").first()).toHaveText("Exception");
  await expect(page.getByTestId("deciding-step")).toContainText("M4.tolerance.underpayment_beyond_band");
  const after = EXPECTED.decisionsAfter;
  for (const [result, n] of Object.entries(after)) {
    await page.goto(`/control/merchant/payments?entity=NW-SG&result=${result}`);
    await expect(page.getByTestId("payments-count"), result).toContainText(`${n} of `);
  }
  return { orders, provider, bank };
}
