import { expect, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import { axeSource } from "../browser/axe-source";
import { E2E } from "./env";

export const REDWOOD = "INV-2026-188";
export const ORIGIN = E2E.origin;

let n = 0;
/**
 * Each sign-in comes from its own documentation-range address (RFC 5737), so Better Auth's per-address sign-in rate
 * limit (5 per 15 minutes) does not throttle a suite that signs in dozens of times. Test-only: see the security note
 * in the report about trusting a client-supplied x-forwarded-for.
 */
function testAddress(info: TestInfo) {
  n += 1;
  return `198.18.${(info.project.name === "mobile" ? 128 : 0) + (info.workerIndex % 64)}.${(n % 250) + 1}`;
}

export async function signIn(page: Page, email: string, info: TestInfo, password: string = E2E.password) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": testAddress(info) });
  await page.goto("/control/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(page.getByTestId("signed-in-as")).toContainText(email);
}

export async function signOut(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/control\/sign-in$/);
}

export async function openNav(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Clearline Control" }).getByRole("link", { name: label, exact: true }).click();
}

/** A same-origin API call with the browser context's cookies (Origin and Idempotency-Key as the UI sends them). */
export function api(page: Page, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<APIResponse> {
  const h: Record<string, string> = method === "GET" ? { ...headers } : { origin: ORIGIN, "idempotency-key": `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`, "content-type": "application/json", ...headers };
  return page.request.fetch(path, { method, headers: h, data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
}

export async function paymentIdFor(page: Page, reference: string): Promise<string> {
  const r = await api(page, "GET", "/api/control/payments");
  expect(r.status()).toBe(200);
  const p = ((await r.json()).payments as { id: string; reference: string }[]).find((x) => x.reference === reference);
  if (!p) throw new Error(`no payment ${reference}`);
  return p.id;
}

/**
 * Waits until the streamed page is on screen: React reveals the streamed content (and removes the loading
 * fallback) shortly after the load event, so checks that read the whole page wait for that first.
 */
export async function settled(page: Page) {
  await page.waitForFunction(() => {
    const shown = (e: Element) => (e as HTMLElement).offsetParent !== null;
    return [...document.querySelectorAll("h1")].some(shown) && ![...document.querySelectorAll('[aria-busy="true"]')].some(shown);
  });
}

/** axe-core (pinned devDependency; the loader throws if it is missing) evaluated over CDP: the nonce CSP blocks inline scripts. */
export async function axeViolations(page: Page) {
  await settled(page);
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe;
    const r = await axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((x) => `${x.target.join(" ")} — ${x.failureSummary ?? ""}`) }));
  });
}

export async function expectNoAxeViolations(page: Page, where: string) {
  const v = await axeViolations(page);
  expect(v, `axe violations on ${where}: ${JSON.stringify(v, null, 2)}`).toEqual([]);
}

export async function horizontalOverflow(page: Page) {
  await settled(page);
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
}

export const CONTROL_PAGES = ["/control", "/control/payments", "/control/investigations", "/control/reconciliation", "/control/accounting", "/control/audit", "/control/settings"] as const;
