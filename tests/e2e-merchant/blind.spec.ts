import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { resetMerchantDatabase } from "./db";
import { MERCHANT_E2E } from "./env";
import { settled, signIn } from "./helpers";
import { BLIND, blindWorld, writeBlindFiles, type BlindFiles } from "./blind-world";
import type { EntityVerdict } from "./blind-judge";

/*
 * rc7 Phase 5 BLIND test: a finance user reconciles a month (2,000 orders) from a provider export in a format Clearline
 * was never built for (the generator's shape D, JSON), using only the generic upload screens: the JSON list choice,
 * column mapping with suggestions, manual mapping and reusable templates. The test is that user: it reads the preview
 * on screen and decides each column from its VALUES and the user's own facts (its order ids, its deposit addresses,
 * its bank accounts), never from knowledge of the format; it does not name the format's fields. Every action goes
 * through the browser; the results are then read (read only) and judged against the generator's ground truth.
 *
 * Run separately: npm run e2e:blind (desktop). Results: test-results/blind/report.json. Fictional data only.
 */

test.skip(({ isMobile }) => isMobile, "desktop only: one person working at a desk");

const [FIN, APPROVER, ADMIN] = BLIND.users.map((u) => u[0]);
const OUT = path.resolve("test-results/blind");
type Verdict = { flag: Record<string, boolean>; entities: EntityVerdict[] };

function cli(cmd: "seed" | "judge"): string {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "tests/e2e-merchant/blind-cli.ts", cmd], {
    env: { ...process.env, DATABASE_URL: cmd === "seed" ? MERCHANT_E2E.ownerUrl : MERCHANT_E2E.runtimeUrl, CLEARLINE_SEED_PASSWORD: MERCHANT_E2E.password },
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`blind-cli ${cmd} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
const judge = (): Verdict => JSON.parse(cli("judge").trim().split("\n").pop()!) as Verdict;

/** Each person signs in once in their own browser context and never signs out (Better Auth's sign-out limit). */
async function person(browser: Browser, info: TestInfo, email: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: MERCHANT_E2E.origin, viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(page, email, info);
  return page;
}

// ------------------------------------------------------------------------------------------ what a person does

const notes: string[] = [];
const note = (x: string) => { if (!notes.includes(x)) notes.push(x); };

async function upload(page: Page, entity: string, type: string, file: { path: string; name: string }, list?: (choices: string[]) => string): Promise<string> {
  await page.goto("/control/merchant/uploads");
  await settled(page);
  await page.getByLabel("Entity").selectOption(entity);
  await page.getByRole("radio", { name: new RegExp(`^${type}`) }).check();
  // the form takes the file once its script has loaded (until then the input is inert): set it until it is shown
  await expect(async () => {
    await page.getByLabel("File", { exact: true }).setInputFiles({ name: file.name, mimeType: "application/octet-stream", buffer: readFileSync(file.path) });
    await expect(page.getByText(`Selected: ${file.name}`)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Upload file" }).click();
  if (list) {
    // the JSON file holds several lists: the screen names them and asks which one holds the records
    await expect(page.getByRole("alert").filter({ hasText: /several lists/ })).toBeVisible({ timeout: 30_000 });
    const choose = page.getByLabel("Which list holds the records?");
    const choices = (await choose.locator("option").allTextContents()).filter((x) => x !== "Choose a list");
    await choose.selectOption(list(choices));
    await page.getByRole("button", { name: "Upload file" }).click();
  }
  await expect(page).toHaveURL(/\/control\/merchant\/uploads\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: /Stored “/ }).first()).toBeVisible();
  return page.url().split("/").pop()!;
}

async function previewTable(page: Page): Promise<{ headers: string[]; rows: string[][] }> {
  return page.getByTestId("preview").evaluate((el) => ({
    headers: [...el.querySelectorAll("thead th")].slice(1).map((th) => th.textContent ?? ""),
    rows: [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent ?? "")),
  }));
}
const field = (page: Page, key: string) => page.getByTestId(`field-${key}`);
const source = (page: Page, key: string) => field(page, key).getByRole("combobox").first();
async function choose(page: Page, key: string, value: string) { await source(page, key).selectOption(value); }

async function saveTemplate(page: Page, name: string) {
  await page.getByLabel("Template name").fill(name);
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`Saved template “${name.replace(/[()]/g, "\\$&")}” version \\d+`) })).toBeVisible({ timeout: 30_000 });
}
async function confirmMapping(page: Page) {
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Mapping confirmed/ }).first()).toBeVisible({ timeout: 60_000 });
}
async function validate(page: Page): Promise<{ rows: number; accepted: number; warnings: number; rejected: number; duplicates: number }> {
  await page.getByRole("button", { name: /^Validate (every row|again)$/ }).click();
  const msg = page.getByRole("status").filter({ hasText: /^Validated \d+ rows/ }).first();
  await expect(msg).toBeVisible({ timeout: 120_000 });
  const m = /^Validated (\d+) rows: (\d+) accepted, (\d+) with warnings, (\d+) rejected, (\d+) duplicates/.exec((await msg.textContent()) ?? "")!;
  return { rows: +m[1], accepted: +m[2], warnings: +m[3], rejected: +m[4], duplicates: +m[5] };
}
async function confirmUpload(page: Page, reason: string) {
  await page.getByLabel("Reason for your decision").fill(reason);
  await page.getByRole("button", { name: "Confirm upload" }).click();
  await expect(page.getByTestId("upload-status")).toHaveText("Confirmed", { timeout: 60_000 });
}
async function bringIn(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Bring into reconciliation" }).click();
  const msg = page.getByRole("status").filter({ hasText: /^Brought into reconciliation: / }).first();
  await expect(msg).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("upload-status")).toHaveText("In reconciliation");
  return (await msg.textContent()) ?? "";
}
async function reconcile(page: Page, entity: string): Promise<string> {
  await page.goto("/control/merchant/runs");
  await page.getByRole("button", { name: `Run reconciliation for ${entity}` }).click();
  const msg = page.getByRole("status").filter({ hasText: /^(Reconciled \d+ payments|Nothing changed) for / }).first();
  await expect(msg).toBeVisible({ timeout: 180_000 });
  return (await msg.textContent()) ?? "";
}

/** Status words further down the file than the 20-row preview: the person looks them up in their own file. */
async function addMissingWords(page: Page, key: string, fileWords: string[]) {
  const group = field(page, key).getByRole("group", { name: /^What each word in / });
  for (const w of fileWords) {
    if ((await group.getByLabel(`“${w}”`, { exact: true }).count()) === 0) {
      note(`status words: the screen lists only the words in the first 20 rows; ${fileWords.length - (await group.getByRole("combobox").count())} more were found by opening the file outside Clearline and typed in with “Add word”`);
      await group.getByLabel(/^Another word in /).fill(w);
      await group.getByRole("button", { name: "Add word" }).click();
    }
  }
  for (const w of fileWords) {
    const v = await group.getByLabel(`“${w}”`, { exact: true }).inputValue();
    // a word that is not exactly a Clearline status is not guessed by this person either: it stays unmapped (row rejected)
    expect(v, `status word ${w}`).not.toBe("");
  }
}

// ------------------------------------------------------------------------------------------ reading columns by their values

const nonEmpty = (xs: string[]) => xs.map((x) => x.trim()).filter((x) => x !== "");
const col = (t: { headers: string[]; rows: string[][] }, h: string) => t.rows.map((r) => r[t.headers.indexOf(h)] ?? "");
const all = (xs: string[], p: (x: string) => boolean) => nonEmpty(xs).length > 0 && nonEmpty(xs).every(p);
const num = (x: string) => /^-?\d+(\.\d+)?$/.test(x);
const decimals = (x: string) => (x.split(".")[1] ?? "").length;

/** What the person concludes about each column of the payments list from its values and their own facts. */
function readPayments(t: { headers: string[]; rows: string[][] }, facts: { orders: Set<string>; deposit: Set<string> }) {
  const byValues = (p: (v: string[], h: string) => boolean, not: string[] = []) => t.headers.filter((h) => !not.includes(h) && p(col(t, h), h));
  const one = (hs: string[], what: string) => { expect(hs, `exactly one column holds ${what}`).toHaveLength(1); return hs[0]; };
  const orderCol = one(byValues((v) => all(v, (x) => facts.orders.has(x))), "our order ids");
  const addresses = byValues((v) => all(v, (x) => /^(T[1-9A-HJ-NP-Za-km-z]{33}|0x[0-9a-fA-F]{40})$/.test(x)));
  const depositCol = one(addresses.filter((h) => all(col(t, h), (x) => facts.deposit.has(x))), "our deposit addresses");
  const senderCol = one(addresses.filter((h) => h !== depositCol), "the payer's address");
  const networkCol = one(byValues((v) => all(v, (x) => /^(tron|ethereum)$/i.test(x))), "the network names");
  const symbolCol = one(byValues((v) => all(v, (x) => /^(USDT|USDC)$/.test(x))), "the token symbols");
  const currencyCol = one(byValues((v) => all(v, (x) => /^[A-Z]{3}$/.test(x)), [symbolCol]), "a currency code");
  const hashCol = one(byValues((v) => all(v, (x) => /^(0x)?[0-9a-fA-F]{64}$/.test(x))), "transaction hashes");
  const statusCol = one(byValues((v) => all(v, (x) => /^[A-Z_]+$/.test(x) && x.length > 3), [networkCol, symbolCol, currencyCol]), "status words");
  // a reference built from our order id (the quote or payment link the payment was made against)
  const refCol = one(byValues((v, h) => h !== orderCol && t.rows.every((r) => !r[t.headers.indexOf(h)] || r[t.headers.indexOf(h)].includes(r[t.headers.indexOf(orderCol)]))), "a reference built from our order id");
  // amounts: one token amount (6 decimals), one fiat amount (2 decimals) and one rate with token × rate ≈ fiat
  const numeric = byValues((v) => all(v, num), []).filter((h) => !all(col(t, h), (x) => /^\d{9,}$/.test(x)));
  const tokenCol = one(numeric.filter((h) => all(col(t, h), (x) => decimals(x) === 6)), "the token amount");
  const fiatCol = one(numeric.filter((h) => all(col(t, h), (x) => decimals(x) === 2)), "the credited fiat amount");
  const rateCol = one(numeric.filter((h) => h !== tokenCol && h !== fiatCol), "the rate");
  for (const r of t.rows) {
    const [a, f, x] = [tokenCol, fiatCol, rateCol].map((h) => Number(r[t.headers.indexOf(h)]));
    expect(Math.abs(a * x - f), "credited ≈ received × rate: the rate is the one the provider applied").toBeLessThan(Math.max(1, f * 0.001));
  }
  const epoch = byValues((v) => all(v, (x) => /^\d{9,11}$/.test(x)));
  const used = new Set([orderCol, depositCol, senderCol, networkCol, symbolCol, currencyCol, hashCol, statusCol, refCol, tokenCol, fiatCol, rateCol, ...epoch]);
  // what is left: the provider's payment id (unique per row) and the settlement batch (shared by many rows)
  const rest = t.headers.filter((h) => !used.has(h));
  const distinct = (h: string) => new Set(nonEmpty(col(t, h))).size;
  const paymentCol = one(rest.filter((h) => distinct(h) === nonEmpty(col(t, h)).length && nonEmpty(col(t, h)).length === t.rows.length), "a unique payment id");
  const batchCol = one(rest.filter((h) => h !== paymentCol && distinct(h) < t.rows.length / 3), "a settlement batch shared by many payments");
  return { orderCol, depositCol, senderCol, networkCol, symbolCol, currencyCol, hashCol, statusCol, refCol, tokenCol, fiatCol, rateCol, paymentCol, batchCol, epoch };
}

/** The file's own list, as the person sees it in a text editor (no Clearline code), to find values below row 20. */
function wordsInFile(file: string, list: string, column: string): string[] {
  const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>[]>;
  return [...new Set(j[list].map((r) => String(r[column] ?? "")).filter((x) => x))].sort();
}
/** The same for a plain CSV without quoted commas (the order list). */
function wordsInCsv(file: string, column: string): string[] {
  const [head, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l !== "");
  const i = head.split(",").indexOf(column);
  return [...new Set(lines.map((l) => l.split(",")[i]).filter((x) => x))].sort();
}
function listsBySize(file: string): string[] {
  const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return Object.keys(j).filter((k) => Array.isArray(j[k])).sort((a, b) => (j[b] as unknown[]).length - (j[a] as unknown[]).length);
}

// ------------------------------------------------------------------------------------------ the journey

test("blind: a month in a never-seen provider format, through the generic upload screens only, judged against the truth", async ({ browser }, info) => {
  test.setTimeout(1_800_000);
  await resetMerchantDatabase();
  cli("seed");
  const { world, truth } = blindWorld();
  const files: BlindFiles = await writeBlindFiles(path.join(OUT, "files"));
  const [paymentsList, payoutsList] = listsBySize(files.provider.path);
  const facts = { orders: new Set(world.orders.map((o) => o.orderId)), deposit: new Set(world.paymentMeta.map((m) => m.depositAddress)) };
  const fin = await person(browser, info, FIN);
  const started = Date.now();
  const steps: Record<string, number> = {};
  const lap = (k: string, t0: number) => { steps[k] = (steps[k] ?? 0) + (Date.now() - t0); };
  const uploads: Record<string, Record<string, unknown>> = {};
  const bankIds: Record<string, string> = {};

  for (const [i, spec] of world.entitySpecs.entries()) {
    const entity = spec.id;
    const first = i === 0;
    uploads[entity] = {};

    // 1. the merchant's own order list (a CSV layout Clearline already reads): header suggestions, a template
    let t0 = Date.now();
    await upload(fin, entity, "Orders or invoices", files.orders);
    if (first) {
      for (const g of await fin.getByRole("group", { name: /^Date order in / }).all()) await g.getByRole("radio", { name: /^Day\/month\/year/ }).check();
      for (const z of await fin.getByLabel(/^Time zone of times in /).all()) await z.selectOption({ label: "UTC+08:00" });
      await addMissingWords(fin, "status", wordsInCsv(files.orders.path, await source(fin, "status").inputValue()));
      await saveTemplate(fin, "Shop order list");
    } else await expect(fin.getByTestId("template-applied")).toContainText("Shop order list");
    await confirmMapping(fin);
    uploads[entity].orders = await validate(fin);
    await confirmUpload(fin, "Our own order list for October (fictional).");
    uploads[entity].ordersIn = await bringIn(fin);
    lap("orders", t0);

    // 2. the provider export: its payments list, mapped by hand
    t0 = Date.now();
    await upload(fin, entity, "Provider export", files.provider, (choices) => { expect(choices.sort()).toEqual([paymentsList, payoutsList].sort()); return paymentsList; });
    await expect(fin.getByTestId("json-list")).toContainText(paymentsList);
    const preview = await previewTable(fin);
    const c = readPayments(preview, facts);
    if (first) {
      // what the suggestions proposed, as the person found it
      const proposed: Record<string, string> = {};
      for (const k of ["order_id", "payment_id", "currency", "token_symbol", "tx_hash", "status", "deposit_address", "sender", "quoted_token_amount", "received_token_amount", "quote_rate", "executed_rate", "credited_fiat", "network", "batch_id", "quote_id", "payment_link_id"]) proposed[k] = await source(fin, k).inputValue();
      uploads[entity].suggested = proposed;
      const wrong: string[] = [];
      const want: Record<string, string> = { order_id: c.orderCol, payment_id: c.paymentCol, currency: c.currencyCol, token_symbol: c.symbolCol, tx_hash: c.hashCol, status: c.statusCol, deposit_address: c.depositCol, sender: c.senderCol,
        received_token_amount: c.tokenCol, executed_rate: c.rateCol, credited_fiat: c.fiatCol, network: c.networkCol, batch_id: c.batchCol, quote_id: c.refCol, quoted_token_amount: "", quote_rate: "", payment_link_id: "" };
      for (const [k, v] of Object.entries(want)) if (proposed[k] !== v) wrong.push(`${k}: suggested “${proposed[k] || "not in this file"}”, the values say “${v || "not in this file"}”`);
      uploads[entity].suggestionsFixed = wrong;
      // fix every field by hand from the values (a column read for another field first goes to "Not in this file")
      for (const k of ["quoted_token_amount", "quote_rate", "payment_link_id", "deposit_address", "sender", "paid_at", "created_at", "expires_at"]) await choose(fin, k, "");
      for (const [k, v] of Object.entries(want)) if (v) await choose(fin, k, v);
      await choose(fin, "token_contract", "__derive__");
      await addMissingWords(fin, "status", wordsInFile(files.provider.path, paymentsList, c.statusCol));
      if (c.epoch.length) note(`payment time: the only time column holds Unix epoch seconds (e.g. ${col(preview, c.epoch[0])[0]}); the mapping screen offers no such date format, so “Paid at” was left as “Not in this file”`);
      await saveTemplate(fin, "Provider payments (JSON)");
    } else {
      await expect(fin.getByTestId("template-applied")).toContainText("Provider payments (JSON)");
      note("template reuse: the saved mapping was applied to the second entity's upload of the same file, but the JSON list had to be chosen again at upload (a template does not remember it)");
    }
    await confirmMapping(fin);
    uploads[entity].payments = await validate(fin);
    await confirmUpload(fin, "Provider payments export for October (fictional).");
    uploads[entity].paymentsIn = await bringIn(fin);
    lap("provider_payments", t0);

    // 3. the same file's payouts list, as the settlement report (totals per batch)
    t0 = Date.now();
    await upload(fin, entity, "Settlement report", files.provider, (choices) => choices.find((x) => x === payoutsList)!);
    const pt = await previewTable(fin);
    if (first) {
      await expect(fin.getByRole("radio", { name: "One row per batch, with totals only" })).toBeChecked();
      const sug: Record<string, string> = {};
      for (const k of ["batch_id", "provider_day", "currency", "gross", "fee", "refund", "net", "payment_id", "bank_account"]) sug[k] = await source(fin, k).inputValue();
      uploads[entity].suggestedPayouts = sug;
      // the person checks the suggested totals add up on every previewed row: gross − fees − refunds = net
      for (const r of pt.rows) {
        const v = (k: string) => Math.round(Number(r[pt.headers.indexOf(sug[k])]) * 100);
        expect(v("gross") - v("fee") - v("refund"), "gross − fees − refunds = net").toBe(v("net"));
      }
      // the batch reference: the column whose values are the batches the payments list names (looked up in the file)
      const batches = new Set(wordsInFile(files.provider.path, paymentsList, c.batchCol));
      const batchCols = pt.headers.filter((h) => all(col(pt, h), (x) => batches.has(x)));
      expect(batchCols, "exactly one column holds the batch references").toHaveLength(1);
      const batchCol = batchCols[0];
      uploads[entity].payoutsFixed = sug.payment_id ? [`payment_id: suggested “${sug.payment_id}”, its values are batch references (the batch column of the payments list)`] : [];
      await choose(fin, "payment_id", "");
      await choose(fin, "batch_id", batchCol);
    } else await expect(fin.getByTestId("template-applied")).toContainText("Provider payouts (JSON)");
    // the file names no bank account; the person enters the account the payouts reach (for this entity)
    await choose(fin, "bank_account", "__constant__");
    await field(fin, "bank_account").getByLabel("Fixed bank account").fill(spec.bankAccountId);
    if (first) await saveTemplate(fin, "Provider payouts (JSON)");
    else note("template reuse: the payouts template carries the first entity's bank account as its fixed value; it had to be changed by hand for the second entity (a template cannot say “this entity's account”)");
    await confirmMapping(fin);
    uploads[entity].payouts = await validate(fin);
    await confirmUpload(fin, "Provider payout totals for October (fictional).");
    uploads[entity].payoutsIn = await bringIn(fin);
    lap("provider_payouts", t0);

    // 4. the bank statement (MT940: no mapping), to be confirmed by a second person
    t0 = Date.now();
    bankIds[entity] = await upload(fin, entity, "Bank statement", files.bank[entity]);
    uploads[entity].bank = await validate(fin);
    await expect(fin.getByTestId("second-person")).toContainText("Waiting for a second person");
    lap("bank_upload", t0);
  }

  // 5. the Approver (who did not upload them) confirms both statements and brings them in
  let t0 = Date.now();
  const appr = await person(browser, info, APPROVER);
  for (const [entity, id] of Object.entries(bankIds)) {
    await appr.goto(`/control/merchant/uploads/${id}`);
    await expect(appr.getByTestId("second-person")).toContainText("You are the second person");
    await appr.getByLabel("Reason for your decision").fill("Compared with the bank's online statement (fictional).");
    await appr.getByRole("button", { name: "Confirm upload" }).click();
    await expect(appr.getByRole("status").filter({ hasText: /Confirmed by a second person/ }).first()).toBeVisible({ timeout: 60_000 });
    uploads[entity].bankIn = await bringIn(appr);
  }
  lap("bank_second_person", t0);

  // 6. Finance runs reconciliation for each entity, then again (nothing may change)
  t0 = Date.now();
  const runs: Record<string, string[]> = {};
  for (const e of world.entitySpecs) runs[e.id] = [await reconcile(fin, e.id)];
  lap("reconcile", t0);
  const uiMinutes = (Date.now() - started) / 60_000;
  const off = judge();
  for (const e of world.entitySpecs) runs[e.id].push(await reconcile(fin, e.id));
  const offAgain = judge();

  // 7. what the screens show (read only)
  const screens: Record<string, string> = {};
  for (const e of world.entitySpecs) {
    await fin.goto(`/control/merchant/payments?entity=${e.id}`);
    screens[e.id] = (await fin.getByTestId("payments-count").textContent()) ?? "";
  }

  // 8. the Admin turns the imported-bank-line flag on for this check only, Finance re-runs; then the flag goes off again
  const admin = await person(browser, info, ADMIN);
  const setFlag = async (on: boolean) => {
    for (const e of world.entitySpecs) {
      await admin.goto("/control/merchant/settings");
      const panel = admin.getByRole("article").filter({ has: admin.getByRole("heading", { name: new RegExp(e.id) }) });
      const box = panel.getByLabel("Allow imported (not bank-authenticated) bank lines to verify settlement");
      if (on) await box.check(); else await box.uncheck();
      await panel.getByRole("button", { name: `Save policy for ${e.id}` }).click();
      await expect(admin.getByRole("status").filter({ hasText: new RegExp(`Saved: the matching policy of ${e.id} is now revision`) }).first()).toBeVisible({ timeout: 30_000 });
    }
  };
  await setFlag(true);
  for (const e of world.entitySpecs) runs[e.id].push(await reconcile(fin, e.id));
  const on = judge();
  for (const e of world.entitySpecs) runs[e.id].push(await reconcile(fin, e.id));
  const onAgain = judge();
  await setFlag(false);
  for (const e of world.entitySpecs) runs[e.id].push(await reconcile(fin, e.id));
  const back = judge();

  // ---------------------------------------------------------------- the report
  const summary = (v: Verdict) => {
    const s = { orders: 0, records: 0, matched: 0, matched_with_difference: 0, suggested_for_review: 0, exception: 0, unpaid: 0, abstainedForLackOfData: 0 };
    for (const e of v.entities) {
      s.orders += e.orders; s.records += e.records; s.unpaid += e.unpaid;
      for (const k of ["matched", "matched_with_difference", "suggested_for_review", "exception"] as const) s[k] += e.decisions[k] ?? 0;
      s.abstainedForLackOfData += Object.values(e.abstainedForLackOfData).reduce((a, b) => a + b, 0);
    }
    const pct = (n: number) => Math.round((10_000 * n) / s.records) / 100;
    return { ...s, rates: { autoMatch: pct(s.matched + s.matched_with_difference), review: pct(s.suggested_for_review), exception: pct(s.exception) } };
  };
  const report = {
    world: { seed: BLIND.seed, month: BLIND.month, orders: world.orders.length, providerPayments: world.providerRecords.length, batches: world.batches.length, bankLines: world.bankLines.length,
      truthDecisions: truth.orders.reduce<Record<string, number>>((a, o) => ({ ...a, [o.decision]: (a[o.decision] ?? 0) + 1 }), {}) },
    uploads, runs, screens, steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, Math.round(v / 1000)])), uiMinutes: Math.round(uiMinutes * 10) / 10,
    flagOff: { summary: summary(off), entities: off.entities }, flagOn: { summary: summary(on), entities: on.entities }, flagOffAgain: { summary: summary(back) }, notes,
    idempotent: { off: off.entities.map((e, i) => e.stateSha256 === offAgain.entities[i].stateSha256), on: on.entities.map((e, i) => e.stateSha256 === onAgain.entities[i].stateSha256) },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ---------------------------------------------------------------- the assertions
  for (const [v, flag] of [[off, false], [on, true], [back, false]] as const) {
    for (const e of v.entities) {
      expect(v.flag[e.entityId], "policy flag as set by the Admin").toBe(flag);
      expect(e.wrongMatches, `${e.entityId}: zero wrong matches`).toEqual([]);
      expect(e.mismatched, `${e.entityId}: every decision is the truth, a documented rule on it, or an abstention`).toEqual([]);
      expect(e.expected.truth + e.expected.rule + e.expected.abstain).toBe(e.orders);
      expect(e.bankLines.problems, `${e.entityId}: every bank line tied or explained`).toEqual([]);
      expect(e.bankLines.bridged + e.bankLines.explained).toBe(e.bankLines.total);
      expect(e.batches.clearingNonZero, `${e.entityId}: provider clearing nets to zero for every tied verified batch`).toEqual([]);
      expect(e.exceptions.missingOwnerReasonOrNextStep, `${e.entityId}: every exception has an owner, a reason and a next step`).toEqual([]);
      expect(e.storedEqualsComputed, `${e.entityId}: what is stored is what the engine computes`).toBe(true);
      if (!flag) expect(e.batches.tiedVerified, "flag off: an imported bank line never verifies settlement").toBe(0);
    }
  }
  // idempotent re-run: the second run of the same data changes nothing
  for (const id of Object.keys(runs)) {
    expect(runs[id][0]).toMatch(/^Reconciled \d+ payments for /);
    expect(runs[id][1], `${id}: re-run`).toMatch(/^Nothing changed for /);
    expect(runs[id][3], `${id}: re-run with the flag on`).toMatch(/^Nothing changed for /);
  }
  expect(report.idempotent).toEqual({ off: [true, true], on: [true, true] });
  // with the flag back off, the decisions are those of the first run
  expect(back.entities.map((e) => [e.decisions, e.rules])).toEqual(off.entities.map((e) => [e.decisions, e.rules]));
  // the screens read the same counts
  for (const e of off.entities) expect(screens[e.entityId]).toContain(`${e.records} of ${e.records} payments`);
});
