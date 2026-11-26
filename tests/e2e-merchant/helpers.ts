import { expect, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { axeSource } from "../browser/axe-source";
import { MERCHANT_E2E } from "./env";
import { enrolFictionalTotp, forgetUsedCodes, totp } from "../support/totp";

export const LABEL = "Test mode · illustrative data";

let n = 0;
/** Each sign-in from its own documentation-range address (RFC 5737), so the per-address sign-in limit never throttles the suite. */
function testAddress(info: TestInfo) {
  n += 1;
  return `198.19.${(info.project.name === "mobile" ? 128 : 0) + (info.workerIndex % 64)}.${(n % 250) + 1}`;
}

/**
 * Sign in; a merchant member lands on the daily report, a provider member on the provider console. v1 1.2: an Admin or
 * Approver needs a second factor; the fictional ones (including any a spec granted later) get the suite's test
 * authenticator (tests/support/totp.ts) and enter its code, exactly as a person would.
 */
export async function signIn(page: Page, email: string, info: TestInfo, landing: RegExp = /\/control\/merchant(\/provider)?$/) {
  await enrolFictionalTotp(MERCHANT_E2E.ownerUrl, MERCHANT_E2E.authSecret, { emails: [email] });
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": testAddress(info) });
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(MERCHANT_E2E.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/control\/sign-in$/);
  if (/\/control\/sign-in\/two-factor$/.test(page.url())) {
    await forgetUsedCodes(MERCHANT_E2E.ownerUrl);
    await page.waitForLoadState("networkidle"); // hydrated: the form submits through the client handler
    await page.getByLabel("6-digit code from your authenticator app").fill(totp());
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(landing);
  await expect(page.getByTestId("signed-in-as")).toContainText(email);
}

export async function signOut(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/control\/sign-in$/);
}

export async function nav(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: /Merchant reconciliation|Provider console/ });
  await menu.getByRole("link", { name: label, exact: true }).click();
}

/** A same-origin API call with the browser context's cookies (Origin and Idempotency-Key as the UI sends them). */
export function api(page: Page, method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<APIResponse> {
  const h: Record<string, string> = method === "GET" ? { ...headers } : { origin: MERCHANT_E2E.origin, "idempotency-key": `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`, "content-type": "application/json", ...headers };
  return page.request.fetch(path, { method, headers: h, data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
}

/** Waits until the streamed page is on screen (a visible h1, no visible loading state). */
export async function settled(page: Page) {
  await page.waitForFunction(() => {
    const shown = (e: Element) => (e as HTMLElement).offsetParent !== null;
    return [...document.querySelectorAll("h1")].some(shown) && ![...document.querySelectorAll('[aria-busy="true"]')].some(shown);
  });
}

export async function expectNoAxeViolations(page: Page, where: string) {
  await settled(page);
  await page.evaluate(axeSource());
  const v = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe;
    const r = await axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.slice(0, 5).map((y) => `${y.target.join(" ")} — ${y.failureSummary ?? ""}`) }));
  });
  expect(v, `axe violations on ${where}: ${JSON.stringify(v, null, 2)}`).toEqual([]);
}

export async function expectNoOverflow(page: Page, where: string) {
  await settled(page);
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `horizontal overflow on ${where}`).toBeLessThanOrEqual(o.client);
}

/** Saves a screenshot to MERCHANT_SCREENSHOT_DIR (desktop-*.jpg at 1440 px, mobile-*.jpg at 390 px). */
export async function shot(page: Page, info: TestInfo, name: string, opts: { fullPage?: boolean; locator?: string; scrollTo?: string } = {}) {
  const dir = process.env.MERCHANT_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await settled(page);
  const path = join(dir, `${info.project.name === "mobile" ? "390" : "1440"}-${name}.jpg`);
  if (opts.locator) { await page.locator(opts.locator).first().screenshot({ path, type: "jpeg", quality: 70, scale: "css" }); return; }
  if (opts.scrollTo) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start" }), opts.scrollTo);
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, type: "jpeg", quality: 65, fullPage: opts.fullPage ?? false, scale: "css" });
}

/** Click and wait for the full reload that follows a server-confirmed change, then for the server's confirmation. */
export async function submitAndConfirm(page: Page, click: () => Promise<void>, confirmation: RegExp) {
  await click();
  await expect(page.getByRole("status").filter({ hasText: confirmation }).first()).toBeVisible({ timeout: 30_000 });
}

export async function download(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await d.path();
  const { readFileSync } = await import("node:fs");
  return { name: d.suggestedFilename(), bytes: readFileSync(path!) };
}
