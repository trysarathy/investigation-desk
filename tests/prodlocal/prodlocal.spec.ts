import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { providerExportWithQuotes } from "../fixtures/synthetic/quote-export";
import { smallPreset } from "../../src/lib/clearline/synthetic";
import { PRODLOCAL as P } from "./env";

/*
 * v1 phase 6 proof: the production-like local stack end to end (docs/ops/PROD_LOCAL.md). A plain production build,
 * NODE_ENV=production, CLEARLINE_DEPLOY_ENV=local, uploads in the S3 stand-in, the separate job worker, a private
 * PostgreSQL 16 cluster. No chain keys are configured (as on a fresh deployment): every chain read is unavailable, so
 * nothing may be matched. Fictional people and synthetic files only.
 */

function totp(at = Date.now()): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", Buffer.from(P.totpSecret, "utf8")).update(buf).digest();
  return String((h.readUInt32BE(h[h.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function owner<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: P.ownerUrl });
  try { return (await pool.query(q, params)).rows as T[]; } finally { await pool.end(); }
}
let n = 0;
async function signIn(page: Page, email: string, mfa: boolean) {
  n += 1;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${n}` }); // RFC 5737 documentation range
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (mfa) {
    await expect(page).toHaveURL(/\/control\/sign-in\/two-factor$/);
    await owner("delete from auth_rate_events where scope = 'totp_used'"); // test-only: the replay guard across runs
    await page.waitForLoadState("networkidle");
    await page.getByLabel("6-digit code from your authenticator app").fill(totp());
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/control(\/merchant)?$/);
  await expect(page.getByRole("banner").getByTestId("signed-in-as")).toContainText(email);
}
async function signOut(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/control\/sign-in$/);
}
const field = (page: Page, key: string) => page.getByTestId(`field-${key}`);
const choose = (page: Page, key: string, value: string) => field(page, key).getByRole("combobox").first().selectOption(value);

async function upload(page: Page, type: string, f: { name: string; bytes: Uint8Array }) {
  await page.goto("/control/merchant/uploads");
  await page.getByLabel("Entity").selectOption(P.entity);
  await page.getByRole("radio", { name: new RegExp(`^${type}`) }).check();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: f.name, mimeType: "application/octet-stream", buffer: Buffer.from(f.bytes) });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page).toHaveURL(/\/control\/merchant\/uploads\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}
async function confirmMapping(page: Page) {
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByTestId("upload-status")).toHaveText("Mapped, needs validation", { timeout: 30_000 });
}
async function validateConfirmBringIn(page: Page, id: string) {
  await page.goto(`/control/merchant/uploads/${id}`);
  await page.getByRole("button", { name: /^Validate (every row|again)$/ }).click();
  await expect(page.getByTestId("upload-status")).toHaveText("Validated, awaiting confirmation", { timeout: 30_000 });
  await page.getByLabel("Reason for your decision").fill("Checked against the provider portal (fictional).");
  await page.getByRole("button", { name: "Confirm upload" }).click();
  await expect(page.getByTestId("upload-status")).toHaveText("Confirmed", { timeout: 30_000 });
  await page.getByRole("button", { name: "Bring into reconciliation" }).click();
  await expect(page.getByTestId("upload-status")).toHaveText("In reconciliation", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test("MFA: an Admin needs the authenticator code; a wrong code is refused; the right one signs in", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.200" });
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(P.people.admin);
  await page.getByLabel("Password").fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/control\/sign-in\/two-factor$/);
  // without the second step, Control is not reachable
  expect((await page.request.get("/api/control/merchant/daily", { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(400);
  await page.waitForLoadState("networkidle");
  const wrong = String((Number(totp()) + 500_000) % 1_000_000).padStart(6, "0");
  await page.getByLabel("6-digit code from your authenticator app").fill(wrong);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/\S/);
  await expect(page).toHaveURL(/\/control\/sign-in\/two-factor$/);
  await page.context().clearCookies();
  await signIn(page, P.people.admin, true);
  await signOut(page);
});

test("upload (stored encrypted in object storage), reconcile, month-end, on the production build", async ({ page }) => {
  const { world, files } = await smallPreset();
  const sg = world.entitySpecs[0];
  const provider = providerExportWithQuotes(world, sg.id);
  const settlement = files.find((f) => f.kind === "settlement_totals")!;
  const before = new Set(listObjects());

  // Finance uploads the provider export and the settlement report, maps, validates, confirms, brings both in
  await signIn(page, P.people.finance, false);
  await page.goto("/control/merchant/uploads");
  await expect(page.getByTestId("data-label")).toHaveText("Your data");
  const providerId = await upload(page, "Provider export", provider);
  await choose(page, "quote_rate", "Quote Rate");
  await choose(page, "executed_rate", "Rate");
  await choose(page, "credited_fiat", "Credited (SGD)");
  await choose(page, "batch_id", "Settled In");
  await choose(page, "paid_at", "Created (SGT)");
  for (const fs of await page.getByRole("group", { name: /^Date order in / }).all()) if ((await fs.getByRole("radio", { checked: true }).count()) === 0) await fs.getByRole("radio", { name: /^Day\/month\/year/ }).check();
  for (const fs of await page.getByRole("group", { name: /^Decimal separator in / }).all()) if ((await fs.getByRole("radio", { checked: true }).count()) === 0) await fs.getByRole("radio", { name: /^Decimal point/ }).check();
  for (const tz of await page.getByLabel(/^Time zone of times in /).all()) await tz.selectOption({ label: "UTC+08:00" });
  const status = page.getByRole("group", { name: "What each word in Status means" });
  await status.getByLabel("“Completed”").selectOption("paid");
  for (const w of provider.statuses) if ((await status.getByLabel(`“${w}”`, { exact: true }).count()) === 0) { await status.getByLabel("Another word in Status").fill(w); await status.getByRole("button", { name: "Add word" }).click(); }
  await confirmMapping(page);
  const settlementId = await upload(page, "Settlement report", settlement);
  await choose(page, "line_amount", "");
  await choose(page, "payment_id", "");
  await confirmMapping(page);
  await validateConfirmBringIn(page, providerId);
  await validateConfirmBringIn(page, settlementId);

  // the files are in the object store, sealed (AES-256-GCM, "CLU1"): no fictional order id appears in the bytes
  const stored = listObjects().filter((f) => !before.has(f));
  expect(stored.length).toBe(2);
  for (const f of stored) {
    const raw = readFileSync(f);
    expect(raw.subarray(0, 4).toString()).toBe("CLU1");
    expect(raw.includes(Buffer.from(world.orders[0].orderId))).toBe(false);
  }
  const rows = await owner<{ n: string }>("select count(*)::text as n from uploads where storage_key is not null");
  expect(Number(rows[0].n)).toBeGreaterThanOrEqual(2);
  await signOut(page);

  // Payment Operations reconcile; without chain access nothing is matched (every chain read is unavailable)
  await signIn(page, P.people.ops, false);
  await page.goto(`/control/merchant/uploads/${providerId}`);
  await page.getByRole("button", { name: `Run reconciliation for ${P.entity}` }).click();
  await expect(page.getByRole("status").filter({ hasText: /Reconciled \d+ payments for/ }).first()).toBeVisible({ timeout: 60_000 });
  await page.goto(`/control/merchant/payments?entity=${P.entity}`);
  await expect(page.getByTestId("payments-count")).toContainText(/[1-9]\d* of [1-9]\d* payments/);
  const chips = await page.getByTestId("decision-chip").allTextContents();
  expect(chips.length).toBeGreaterThan(0);
  expect(chips.filter((c) => /^Matched/.test(c.trim()))).toEqual([]);
  await signOut(page);

  // Finance: the month-end page and the month-end pack
  await signIn(page, P.people.finance, false);
  await page.goto(`/control/merchant/month-end?entity=${P.entity}&month=${P.month}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("month-end-pack")).toBeVisible();
  const pack = await page.request.get(`/api/control/merchant/exports/month-end?entity=${P.entity}&month=${P.month}`);
  expect(pack.status()).toBe(200);
  expect((await pack.body()).length).toBeGreaterThan(100);
  await signOut(page);
});

test("the separate worker process runs on the jobs login and completes passes over the queue", async () => {
  const log = readFileSync(path.join(P.state, "run", "worker.log"), "utf8");
  expect(log).not.toMatch(/JOBS_LOGIN_REFUSED|worker_failed/);
  expect(log).toMatch(/"event":"pass"/);
  const pid = Number(readFileSync(path.join(P.state, "run", "worker.pid"), "utf8"));
  expect(() => process.kill(pid, 0)).not.toThrow();
});

function listObjects(): string[] {
  const root = path.join(P.state, "objects");
  const out: string[] = [];
  const walk = (d: string) => { let names: string[] = []; try { names = readdirSync(d); } catch { return; } for (const x of names) { const p = path.join(d, x); if (statSync(p).isDirectory()) walk(p); else out.push(p); } };
  walk(root);
  return out;
}
