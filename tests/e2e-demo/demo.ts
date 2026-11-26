/**
 * Helpers for the demo build's browser suite: sign-in with the shared demo password, the demo role switcher, a reset
 * to the seeded state, the accessibility and overflow checks, and a guard that fails a test on any console error or
 * server error response. Demo · fictional data.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectNoAxeViolations, expectNoOverflow, settled } from "../e2e-merchant/helpers";
import { DEMO_E2E, DEMO_LABEL, demoPassword, demoTotpSecret } from "./env";
import { totp } from "../support/totp";

/** Back to the seeded state (`npm run demo:reset`): every session ends, so sign in again afterwards. */
export function resetDemo(): string {
  return execFileSync(path.join(DEMO_E2E.root, "node_modules/.bin/tsx"), ["--conditions=react-server", path.join(DEMO_E2E.root, "scripts/demo/reset.ts")], { cwd: DEMO_E2E.root, encoding: "utf8" });
}

/** Fails the test on a console error, an uncaught page error or a 5xx answer from the app. Call once per page. */
export function guard(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(DEMO_E2E.origin)) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return { check: () => expect(problems, problems.join("\n")).toEqual([]) };
}

/** The 30-second step each login last used a code in: a code works once, so the next sign-in waits for a new one. */
const usedStep = new Map<string, number>();
export async function signIn(page: Page, email: string, landing: RegExp = /\/control\/merchant(\/provider)?$/) {
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/control\/sign-in$/);
  if (/\/control\/sign-in\/two-factor$/.test(page.url())) {
    // v1 wave 1: the demo Admin and Approver have the demo authenticator (the MFA rule is unchanged)
    while (usedStep.get(email) === Math.floor(Date.now() / 30_000)) await page.waitForTimeout(1_000);
    usedStep.set(email, Math.floor(Date.now() / 30_000));
    await page.waitForLoadState("networkidle");
    await page.getByLabel("6-digit code from your authenticator app").fill(totp(demoTotpSecret()));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(landing);
  await expect(page.getByTestId("signed-in-as")).toContainText(email);
}

/** The demo role switcher: signs out and signs in as `email` (a real session for that user). */
export async function switchTo(page: Page, email: string, landing: RegExp = /\/control\/merchant(\/provider)?$/) {
  const sw = page.getByTestId("demo-switcher");
  await sw.getByLabel("Sign in as").selectOption(email);
  await sw.getByRole("button", { name: "Switch" }).click();
  await expect(page).toHaveURL(landing);
  await expect(page.getByTestId("signed-in-as")).toContainText(email);
}

export async function nav(page: Page, label: string) {
  await page.getByRole("navigation", { name: /Merchant reconciliation|Provider console/ }).getByRole("link", { name: label, exact: true }).click();
  await settled(page);
}

/** Every demo screen carries the data label. */
export async function expectDemoLabel(page: Page, label: string | RegExp = DEMO_LABEL) {
  await expect(page.getByTestId("data-label")).toHaveText(label);
}

/** axe (WCAG 2.2 AA) and no horizontal scroll: at 1280 px and 390 px on the desktop project, at 390 px on the phone. */
export async function a11y(page: Page, info: TestInfo, where: string, o: { label?: string | RegExp } = {}) {
  const back = page.viewportSize();
  for (const width of info.project.name === "mobile" ? [390] : [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page, `${where} at ${width}px`);
    await expectNoOverflow(page, `${where} at ${width}px`);
  }
  if (back) await page.setViewportSize(back);
  await expectDemoLabel(page, o.label);
}

/** A same-origin API call with the page's cookies, as the UI sends it. */
export function api(page: Page, method: "GET" | "POST", url: string, body?: unknown) {
  const headers: Record<string, string> = method === "GET" ? {} : { origin: DEMO_E2E.origin, "idempotency-key": `demo-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`, "content-type": "application/json" };
  return page.request.fetch(url, { method, headers, data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
}

export { settled };
