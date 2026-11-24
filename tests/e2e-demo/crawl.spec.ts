import { expect, test, type Page } from "@playwright/test";
import { axeSource } from "../browser/axe-source";
import { expectNoAxeViolations, expectNoOverflow } from "../e2e-merchant/helpers";
import { expectDemoLabel, resetDemo, settled, signIn } from "./demo";
import { DEMO_E2E, DEMO_USERS } from "./env";

/*
 * The crawl: for every demo login (Finance, Approver, Viewer, Admin, Provider ops), every screen reachable from the
 * navigation and from links on the pages, same-origin only, bounded (at most PER_SHAPE pages of the same shape: the
 * same path with ids replaced and the same query keys, and at most MAX_PAGES per login). On every page: no 5xx, no
 * console error, no uncaught page error, no unlabelled interactive control (axe's name and label rules, plus our own
 * check of every visible control), no visible "TODO", "coming soon" or "lorem", the data label, and no horizontal
 * scroll. Then every button that does not change data is clicked (toggles, disclosures, Cancel/Close, filter forms
 * that only GET), and the page must still be error-free. Downloads (/api/ links) are fetched, not opened, and must not
 * answer 5xx. Destructive or changing actions are never clicked: sign out, reset, the switcher, approvals, uploads,
 * runs, saves and the like. Full axe (WCAG 2.2 AA) at 1280 and 390 px runs on the first page of each shape.
 * Demo · fictional data.
 */
const PER_SHAPE = 2;
const MAX_PAGES = 90;
const MAX_CLICKS = 10;
/** Buttons whose name says they change something (or leave the session): never clicked. */
const DO_NOT_CLICK = /reset|sign ?out|switch|go there|save|approve|reject|delete|confirm|propose|run|upload|assign|add |add$|attach|mark|acknowledge|revoke|invite|send|retry|validate|bring|download|export|keep it|try again|reconcile|apply to|use template|remove/i;
const BAD_TEXT = /\bTODO\b|coming soon|lorem/i;
const ROLES = ["finance", "approver", "viewer", "admin", "ops"] as const;

const shapeOf = (u: URL) => {
  const p = u.pathname
    .replace(/\/(payments|exceptions|batches|uploads|merchants|reconstruct)\/[^/]+/g, "/$1/:id")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid");
  return `${p}?${[...new Set([...u.searchParams.keys()])].sort().join("&")}`;
};

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console on ${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(DEMO_E2E.origin)) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return problems;
}

/** Every visible interactive control has an accessible name (our own check, besides axe's rules). */
async function unlabelled(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const nameOf = (e: Element): string => {
      const aria = e.getAttribute("aria-label") ?? "";
      const by = (e.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const labels = "labels" in e ? [...((e as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? "").join(" ") : "";
      const text = e.tagName === "INPUT" || e.tagName === "SELECT" || e.tagName === "TEXTAREA" ? "" : (e as HTMLElement).innerText ?? "";
      const alt = [...e.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join(" ");
      const value = e.tagName === "INPUT" && ["submit", "button", "reset"].includes((e as HTMLInputElement).type) ? (e as HTMLInputElement).value : "";
      return `${aria} ${by} ${labels} ${text} ${alt} ${value} ${e.getAttribute("title") ?? ""}`.trim();
    };
    for (const e of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], summary')) {
      if (!shown(e)) continue;
      if (!nameOf(e)) out.push(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} ${(e as HTMLElement).outerHTML.slice(0, 120)}`);
    }
    return out;
  });
}

async function nameRules(page: Page): Promise<unknown[]> {
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "rule", values: ["button-name", "link-name", "label", "select-name", "input-button-name", "aria-input-field-name", "aria-command-name", "summary-name", "frame-title"] } });
    return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
}

async function checkPage(page: Page, where: string, problems: string[], full: boolean, project: string) {
  await settled(page);
  const text = await page.locator("body").innerText();
  const bad = BAD_TEXT.exec(text);
  expect(bad?.[0] ?? null, `visible placeholder text on ${where}`).toBeNull();
  expect(await unlabelled(page), `unlabelled controls on ${where}`).toEqual([]);
  expect(await nameRules(page), `axe name/label rules on ${where}`).toEqual([]);
  if (!/\/control\/sign-in/.test(page.url())) await expectDemoLabel(page);
  if (full) {
    const back = page.viewportSize();
    for (const width of project === "mobile" ? [390] : [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page, `${where} at ${width}px`);
      await expectNoOverflow(page, `${where} at ${width}px`);
    }
    if (back) await page.setViewportSize(back);
  }
  expect(problems, problems.join("\n")).toEqual([]);
}

/** Click every button on the page that only shows, hides or filters; reload between clicks. */
async function clickSafe(page: Page, url: string, problems: string[]): Promise<number> {
  const candidates = await page.evaluate((deny) => {
    const re = new RegExp(deny, "i");
    const shown = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const out: { i: number; name: string }[] = [];
    [...document.querySelectorAll("button, summary, input[type=submit]")].forEach((e, i) => {
      if (!shown(e) || (e as HTMLButtonElement).disabled) return;
      const name = (e.getAttribute("aria-label") || (e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim();
      if (re.test(name)) return;
      const form = e.closest("form");
      const type = e.tagName === "SUMMARY" ? "summary" : (e.getAttribute("type") ?? "submit");
      const getForm = !!form && (form.getAttribute("method") ?? "get").toLowerCase() === "get" && !!form.getAttribute("action");
      if (type === "button" || type === "summary" || (type === "submit" && getForm)) out.push({ i, name });
    });
    return out;
  }, DO_NOT_CLICK.source);
  let n = 0;
  for (const c of candidates.slice(0, MAX_CLICKS)) {
    const el = page.locator("button, summary, input[type=submit]").nth(c.i);
    if (!(await el.isVisible())) continue;
    await el.click({ timeout: 15_000 });
    await page.waitForLoadState("load");
    await settled(page).catch(() => undefined);
    n++;
    expect(problems, `after clicking “${c.name}” on ${url}:\n${problems.join("\n")}`).toEqual([]);
    // back to the page as it was: a panel opened by a click (the presenter guide remembers "open" for the tab) is closed
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* none */ } });
    await page.goto(url);
    await settled(page);
  }
  return n;
}

for (const role of ROLES) {
  test(`crawl as ${role}: every reachable screen and every safe button`, async ({ page }, info) => {
    test.setTimeout(900_000);
    if (role === "finance") resetDemo();
    await page.context().clearCookies();
    const problems = watch(page);
    await signIn(page, DEMO_USERS[role]);
    const start = new URL(page.url());
    const queue: string[] = [start.pathname + start.search];
    const shapes = new Map<string, number>();
    const visited = new Set<string>();
    const fetched = new Set<string>();
    let clicks = 0;
    while (queue.length && visited.size < MAX_PAGES) {
      const href = queue.shift()!;
      if (visited.has(href)) continue;
      const u = new URL(href, DEMO_E2E.origin);
      const shape = shapeOf(u);
      const seen = shapes.get(shape) ?? 0;
      if (seen >= PER_SHAPE) continue;
      shapes.set(shape, seen + 1);
      visited.add(href);
      const res = await page.goto(href, { waitUntil: "load" });
      expect(res?.status() ?? 0, href).toBeLessThan(500);
      await checkPage(page, `${href} as ${role}`, problems, seen === 0, info.project.name);
      const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href));
      for (const l of links) {
        const lu = new URL(l);
        if (lu.origin !== DEMO_E2E.origin) continue;
        const rel = lu.pathname + lu.search;
        if (lu.pathname.startsWith("/api/")) {
          if (fetched.has(rel)) continue;
          fetched.add(rel);
          const r = await page.request.get(rel, { maxRedirects: 0 });
          expect(r.status(), `download ${rel} as ${role}`).toBeLessThan(500);
          continue;
        }
        if (!lu.pathname.startsWith("/control/merchant")) continue;
        if (!visited.has(rel)) queue.push(rel);
      }
      if (seen === 0) clicks += await clickSafe(page, href, problems);
      // still signed in as the same person (nothing above signs out or switches)
      await expect(page.getByTestId("signed-in-as")).toContainText(DEMO_USERS[role]);
    }
    console.log(`crawl ${info.project.name} ${role}: ${visited.size} pages, ${shapes.size} shapes, ${fetched.size} downloads fetched, ${clicks} safe clicks`);
    console.log(`  shapes: ${[...shapes.keys()].join("  ")}`);
    // the provider console has three screens (merchants, onboarding, pilot metrics) and no merchant record
    expect(visited.size).toBeGreaterThanOrEqual(role === "ops" ? 3 : 20);
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
