import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { MERCHANT_E2E, merchantServerEnv } from "./env";
import { settled, signIn, signOut } from "./helpers";
import { MERCHANT_PAGES, reconciledDemo } from "./setup";

/*
 * SPEED MEASUREMENT (measurement only: it prints and attaches JSON and asserts nothing beyond the run completing).
 * Runs only with CLEARLINE_SPEED=1 (playwright.merchant.config.ts ignores it otherwise), desktop project, on the
 * production build (`next start`) with the seeded, reconciled sample data:
 *   (a) page load: median of 5 full navigations per merchant page, navigation start until settled (as perf.spec.ts);
 *   (b) interactions (INP-style): a PerformanceObserver on 'event' entries (durationThreshold 16, buffered) in every
 *       document; per interaction the max entry duration (0 = every entry under the 16 ms threshold), median of 5,
 *       plus the wall time from the action until its result is on screen ("doneMs");
 *   (c) tables at scale: a SEPARATE database (CLEARLINE_SPEED_10K_OWNER_URL / _RUNTIME_URL; default the suite's
 *       database name + "_10k") seeded with 10,000 synthetic payments through the volume bench's path
 *       (speed-seed-cli.ts), a second `next start` on port+1; time to render the payments list and the frame-time
 *       p95 (requestAnimationFrame deltas) while scrolling it.
 * Selectors fall back gracefully: an interaction whose control does not exist on this revision is recorded "n/a".
 * Output: test-results/speed/report.json. Fictional data only.
 */

test.skip(!process.env.CLEARLINE_SPEED, "speed measurement: run with CLEARLINE_SPEED=1");
test.skip(({ isMobile }) => isMobile, "measured once, at desktop size");

const OUT = path.resolve("test-results/speed");
const ROWS = Number(process.env.SPEED_ROWS ?? 10_000);
const SPEED_USER = "finance@speed-10k.example";
const dbSwap = (url: string, suffix: string) => url.replace(/\/([^/?]+)(\?|$)/, (_, db: string, q: string) => `/${db}${suffix}${q}`);
const BIG = {
  port: MERCHANT_E2E.port + 1,
  origin: `http://127.0.0.1:${MERCHANT_E2E.port + 1}`,
  ownerUrl: process.env.CLEARLINE_SPEED_10K_OWNER_URL ?? dbSwap(MERCHANT_E2E.ownerUrl, "_10k"),
  runtimeUrl: process.env.CLEARLINE_SPEED_10K_RUNTIME_URL ?? dbSwap(MERCHANT_E2E.runtimeUrl, "_10k"),
};

const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => (xs.length ? sortNum(xs)[Math.floor(xs.length / 2)] : null);
const pct = (xs: number[], p: number) => (xs.length ? sortNum(xs)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] : null);
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** Installed in every document: event-timing entries ≥ 16 ms, kept in sessionStorage so they survive a full navigation. */
const OBSERVER = () => {
  const KEY = "__speed_events";
  const push = (list: PerformanceEntry[]) => {
    if (!list.length) return;
    try {
      const prev = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown[];
      for (const e of list as (PerformanceEventTiming & { interactionId?: number })[]) prev.push({ name: e.name, duration: e.duration, start: e.startTime, interactionId: e.interactionId ?? 0, url: location.pathname });
      sessionStorage.setItem(KEY, JSON.stringify(prev));
    } catch { /* storage unavailable: nothing recorded */ }
  };
  try {
    const po = new PerformanceObserver((l) => push(l.getEntries()));
    po.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    addEventListener("pagehide", () => push(po.takeRecords()));
  } catch { /* no event timing */ }
};

async function clearEvents(page: Page) { await page.evaluate(() => { try { sessionStorage.removeItem("__speed_events"); } catch { /* none */ } }); }
async function maxEvent(page: Page): Promise<{ max: number; names: string[] }> {
  await page.waitForTimeout(250); // let the observer deliver the entries of the last paint
  return page.evaluate(() => {
    const xs = JSON.parse(sessionStorage.getItem("__speed_events") ?? "[]") as { name: string; duration: number; interactionId: number }[];
    const ys = xs.filter((x) => x.interactionId > 0 || ["click", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "input", "change"].includes(x.name));
    return { max: ys.reduce((m, x) => Math.max(m, x.duration), 0), names: [...new Set(ys.map((x) => x.name))] };
  });
}
async function firstVisible(cands: Locator[]): Promise<Locator | null> {
  for (const c of cands) {
    const n = await c.count();
    for (let i = 0; i < Math.min(n, 20); i++) if (await c.nth(i).isVisible()) return c.nth(i);
  }
  return null;
}

type Interaction = { id: string; what: string; status: "ok" | "n/a" | "error"; note?: string; inpSamples: number[]; doneSamples: number[]; inpP50: number | null; inpMax: number | null; doneP50: number | null; eventNames: string[] };

/**
 * One interaction, five times. `prepare` brings the page to its starting state and returns the control (or null:
 * "n/a"); `act` performs it; `done` waits until its result is on screen.
 */
async function measureInteraction(page: Page, id: string, what: string, prepare: (i: number) => Promise<Locator | null>, act: (el: Locator, i: number) => Promise<void>, done: (i: number) => Promise<void>): Promise<Interaction> {
  const r: Interaction = { id, what, status: "ok", inpSamples: [], doneSamples: [], inpP50: null, inpMax: null, doneP50: null, eventNames: [] };
  try {
    for (let i = 0; i < 6; i++) { // the first run is a warm-up
      const el = await prepare(i);
      if (!el) { r.status = "n/a"; r.note = "control not found on this revision"; break; }
      await clearEvents(page);
      const t0 = Date.now();
      await act(el, i);
      await done(i);
      const doneMs = Date.now() - t0;
      const ev = await maxEvent(page);
      if (i === 0) continue;
      r.inpSamples.push(r1(ev.max)!);
      r.doneSamples.push(doneMs);
      for (const n of ev.names) if (!r.eventNames.includes(n)) r.eventNames.push(n);
    }
  } catch (e) {
    r.status = r.inpSamples.length ? "ok" : "error";
    r.note = `stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300)}`;
  }
  r.inpP50 = median(r.inpSamples); r.inpMax = r.inpSamples.length ? Math.max(...r.inpSamples) : null; r.doneP50 = median(r.doneSamples);
  return r;
}

async function pageLoads(page: Page, paths: readonly string[], n = 5) {
  const rows: { path: string; samples: number[]; median: number | null }[] = [];
  for (const p of paths) {
    await page.goto(p); // warm-up
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      await page.goto(p);
      await settled(page);
      samples.push(Date.now() - t0);
    }
    rows.push({ path: p, samples, median: median(samples) });
  }
  return rows;
}

const menu = (page: Page) => page.getByRole("navigation", { name: /Merchant reconciliation|Provider console/ });
const h1 = (page: Page, name: RegExp) => page.locator("h1").filter({ hasText: name }).first().waitFor({ state: "visible" });

async function interactions(page: Page): Promise<Interaction[]> {
  const out: Interaction[] = [];

  // 1. the Exceptions link in the menu, from the daily report, until the Exceptions page is on screen
  out.push(await measureInteraction(page, "nav-exceptions", "click the 'Exceptions' menu link on the daily report; done = Exceptions h1 on screen and settled",
    async () => { await page.goto("/control/merchant"); await settled(page); return firstVisible([menu(page).getByRole("link", { name: "Exceptions", exact: true }), page.getByRole("link", { name: "Exceptions", exact: true })]); },
    (el) => el.click(), async () => { await page.waitForURL(/\/control\/merchant\/exceptions$/); await h1(page, /^Exceptions$/); await settled(page); }));

  // 2. sort a table (a sort control in a column header) if any; else type in the payments search box
  {
    let mode = "";
    out.push(await measureInteraction(page, "sort-or-filter", "payments table: click a column-header sort control if one exists, else type 'BK-248' into the search box",
      async () => {
        await page.goto("/control/merchant/payments"); await settled(page);
        const sort = await firstVisible([page.getByRole("columnheader").getByRole("button"), page.locator("th[aria-sort] button, th button")]);
        if (sort) { mode = `sort: header button '${((await sort.textContent()) ?? "").trim().slice(0, 40)}'`; return sort; }
        const box = await firstVisible([page.getByRole("searchbox"), page.getByLabel(/Search|Filter/i)]);
        if (box) { mode = "type into search box"; await box.fill(""); }
        return box;
      },
      async (el) => { if (mode.startsWith("sort")) await el.click(); else await el.pressSequentially("BK-248", { delay: 30 }); },
      async () => { await page.waitForTimeout(100); await settled(page); }));
    out[out.length - 1].what += mode ? ` [used: ${mode}]` : "";
  }

  // 2b. filter: Result = Exception, then Apply (or the change alone, if the filter applies itself)
  out.push(await measureInteraction(page, "filter-result", "payments: choose Result = Exception and click 'Apply filters' (if present); done = the count/rows updated and settled",
    async () => { await page.goto("/control/merchant/payments"); await settled(page); return firstVisible([page.getByLabel("Result", { exact: true })]); },
    async (el) => {
      await el.selectOption("exception");
      const apply = await firstVisible([page.getByRole("button", { name: /^Apply( filters)?$/ })]);
      if (apply) await apply.click();
    },
    async () => { await page.waitForURL(/result=exception/, { timeout: 5_000 }).catch(() => undefined); await settled(page); }));

  // 3. open an exception's detail from the exceptions list
  out.push(await measureInteraction(page, "open-exception", "exceptions list: click the first exception id link; done = the exception's h1 on screen and settled",
    async () => {
      await page.goto("/control/merchant/exceptions"); await settled(page);
      return firstVisible([page.getByRole("region", { name: /Open exceptions/ }).getByRole("link", { name: /^EX-/ }), page.getByRole("link", { name: /^EX-/ })]);
    },
    (el) => el.click(), async () => { await page.waitForURL(/\/control\/merchant\/exceptions\/[^/]+$/); await settled(page); }));

  // 4. assign an exception to a fictional member (alternating between two, so each save is a change)
  out.push(await measureInteraction(page, "assign-exception", "exception EX-BK-24823: choose a fictional owner in 'Owner' and click 'Save owner'; done = the server's 'owns this exception' confirmation",
    async () => {
      await page.goto("/control/merchant/exceptions/EX-BK-24823"); await settled(page);
      const sel = await firstVisible([page.getByLabel("Owner", { exact: true })]);
      if (!sel) return null;
      return firstVisible([page.getByRole("button", { name: "Save owner" })]);
    },
    async (el, i) => {
      const sel = page.getByLabel("Owner", { exact: true }).first();
      const opts = (await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })))).filter((o) => o.v && /fictional/.test(o.t));
      await sel.selectOption(opts[i % Math.min(2, opts.length)].v);
      await el.click();
    },
    async () => { await page.getByRole("status").filter({ hasText: /owns this exception/ }).first().waitFor({ state: "visible", timeout: 30_000 }); }));

  // 5. open a menu or disclosure: a collapsed menu button if one is visible, else the approvals page's <details>
  {
    let used = "";
    out.push(await measureInteraction(page, "open-disclosure", "open a collapsed menu button (aria-expanded=false) on the daily report if visible, else the first <summary> on Approvals; done = expanded/open",
      async () => {
        await page.goto("/control/merchant"); await settled(page);
        const btn = await firstVisible([page.getByRole("banner").locator('button[aria-expanded="false"]'), page.locator('button[aria-expanded="false"]')]);
        if (btn) { used = `menu button '${((await btn.getAttribute("aria-label")) ?? (await btn.textContent()) ?? "").trim().slice(0, 40)}'`; return btn; }
        await page.goto("/control/merchant/approvals"); await settled(page);
        const sum = await firstVisible([page.locator("details:not([open]) > summary")]);
        if (sum) used = `<summary> '${((await sum.textContent()) ?? "").trim().slice(0, 40)}'`;
        return sum;
      },
      (el) => el.click(),
      async () => { await page.waitForFunction(() => !!document.querySelector('[aria-expanded="true"], details[open]')); }));
    out[out.length - 1].what += used ? ` [used: ${used}]` : "";
  }

  // 6. toggle: a theme toggle if one exists, else a checkbox/switch on Settings (clicked, never saved)
  {
    let used = "";
    out.push(await measureInteraction(page, "toggle", "toggle a theme switch if one exists (daily report), else the first checkbox/switch on Settings, Runs or exception EX-BK-24823 (clicked, never saved); done = state flipped",
      async () => {
        await page.goto("/control/merchant"); await settled(page);
        const theme = await firstVisible([page.getByRole("button", { name: /theme|dark|light/i }), page.getByRole("switch", { name: /theme|dark|light/i }), page.getByRole("checkbox", { name: /theme|dark|light/i })]);
        if (theme) { used = `theme toggle '${((await theme.getAttribute("aria-label")) ?? (await theme.textContent()) ?? "").trim().slice(0, 40)}'`; return theme; }
        for (const p of ["/control/merchant/settings", "/control/merchant/runs", "/control/merchant/exceptions/EX-BK-24823"]) {
          await page.goto(p); await settled(page);
          const box = await firstVisible([page.getByRole("switch"), page.getByRole("checkbox")]);
          if (box) { used = `${p} control '${((await box.getAttribute("name")) ?? "").slice(0, 40)}'`; return box; }
        }
        return null;
      },
      (el) => el.click(), async () => { await page.waitForTimeout(50); }));
    out[out.length - 1].what += used ? ` [used: ${used}]` : "";
  }
  return out;
}

// ------------------------------------------------------------------------------------------ (c) 10,000 rows

function seedBig(): Record<string, unknown> {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "tests/e2e-merchant/speed-seed-cli.ts"], {
    env: { ...process.env, DATABASE_URL: BIG.runtimeUrl, SPEED_OWNER_URL: BIG.ownerUrl, CLEARLINE_SEED_PASSWORD: MERCHANT_E2E.password, SPEED_ROWS: String(ROWS) },
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`speed seed failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as Record<string, unknown>;
}

async function startBig(): Promise<ChildProcess> {
  const proc = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(BIG.port)], { env: { ...process.env, ...merchantServerEnv(), DATABASE_URL: BIG.runtimeUrl, CLEARLINE_ORIGIN: BIG.origin }, stdio: "ignore", detached: true });
  for (let i = 0; i < 120; i++) {
    try { const res = await fetch(`${BIG.origin}/control/sign-in`); if (res.ok) return proc; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the 10k server did not start");
}

/** Scrolls the page's main scroller (an inner scroll container when the list has one, else the document) frame by frame. */
async function scrollFrames(page: Page) {
  return page.evaluate(async () => {
    const vScroll = (e: Element) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight - e.clientHeight > 200; };
    const inner = [...document.querySelectorAll("*")].filter(vScroll).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    const doc = document.scrollingElement ?? document.documentElement;
    const el = inner && inner.scrollHeight - inner.clientHeight > doc.scrollHeight - doc.clientHeight ? inner : doc;
    const range = el.scrollHeight - el.clientHeight;
    el.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const deltas: number[] = [];
    const step = Math.max(40, Math.ceil(range / 240)); // about 240 frames from top to bottom (at least 40 px a frame)
    await new Promise<void>((resolve) => {
      let last = performance.now();
      let frames = 0;
      const tick = (t: number) => {
        deltas.push(t - last); last = t; frames += 1;
        el.scrollTop = Math.min(range, el.scrollTop + step);
        if (frames >= 600 || (el.scrollTop >= range - 1 && frames > 30)) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
    });
    return { scroller: el === doc ? "document" : `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]` : ""}`, rangePx: range, stepPx: step, deltas };
  });
}

async function bigTable(browser: import("@playwright/test").Browser, info: TestInfo) {
  const seed = process.env.CLEARLINE_SPEED_10K_SEEDED ? { reused: true } : seedBig();
  const server = await startBig();
  const ctx = await browser.newContext({ baseURL: BIG.origin, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `198.19.200.${(info.workerIndex % 200) + 1}` } });
  try {
    const page = await ctx.newPage();
    await page.goto("/control/sign-in");
    await page.getByLabel("Email").fill(SPEED_USER);
    await page.getByLabel("Password").fill(MERCHANT_E2E.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !/\/control\/sign-in/.test(u.pathname));
    const pages = ["/control/merchant/payments", "/control/merchant/exceptions"];
    const runs: { path: string; renderMs: number[]; renderP50: number | null; rowsInDom: number; countText: string | null; frames: { scroller: string; rangePx: number; stepPx: number; n: number; p50: number | null; p95: number | null; max: number | null; over50: number }[]; frameP95: number | null }[] = [];
    for (const p of pages) {
      await page.goto(p); await settled(page); // warm-up
      const renderMs: number[] = [];
      for (let i = 0; i < 5; i++) { const t0 = Date.now(); await page.goto(p); await settled(page); renderMs.push(Date.now() - t0); }
      const rowsInDom = await page.locator("tbody tr, [role=row]").count();
      const countText = (await page.getByTestId("payments-count").first().textContent({ timeout: 1_000 }).catch(() => null))?.trim().slice(0, 160) ?? null;
      const frames = [];
      for (let i = 0; i < 3; i++) {
        const f = await scrollFrames(page);
        const d = f.deltas.slice(2); // the first frames include the scroll reset
        frames.push({ scroller: f.scroller, rangePx: f.rangePx, stepPx: f.stepPx, n: d.length, p50: r1(pct(d, 50)), p95: r1(pct(d, 95)), max: r1(d.length ? Math.max(...d) : null), over50: d.filter((x) => x > 50).length });
      }
      runs.push({ path: p, renderMs, renderP50: median(renderMs), rowsInDom, countText, frames, frameP95: median(frames.map((f) => f.p95 ?? 0)) });
    }
    return { db: BIG.runtimeUrl.replace(/:[^:@/]+@/, ":***@"), rows: ROWS, seed, pages: runs };
  } finally {
    await ctx.close();
    try { process.kill(-server.pid!, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  }
}

test("speed: page load, interactions and a 10,000-row table (measurement only)", async ({ page, browser }, info) => {
  test.setTimeout(1_800_000);
  const started = new Date().toISOString();
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim() || "unknown";
  await page.addInitScript(OBSERVER);
  await reconciledDemo(page, info);

  await signIn(page, "finance@straits-demo.example", info);
  const loads = await pageLoads(page, MERCHANT_PAGES);
  await signOut(page);

  await signIn(page, "ops@straits-demo.example", info);
  const inter = await interactions(page);

  let big: unknown;
  try { big = await bigTable(browser, info); } catch (e) { big = { status: "error", note: (e instanceof Error ? e.message : String(e)).slice(0, 500) }; }

  const report = {
    revision: rev, started, finished: new Date().toISOString(), baseURL: MERCHANT_E2E.origin, viewport: "1440x900 (Desktop Chrome, headless)",
    method: {
      pageLoad: "median of 5 full navigations after one warm-up; navigation start until a visible h1 and no visible aria-busy=true",
      interactions: "PerformanceObserver 'event' entries (durationThreshold 16, buffered) in every document, kept across navigations; per interaction the max entry duration (0 = all under 16 ms); 1 warm-up + 5 samples; doneMs = action until its result is on screen",
      table: "separate database with synthetic payments (volume bench path); render = full navigation until settled, median of 5; scroll = requestAnimationFrame deltas while moving the main scroller top to bottom (~240 frames), 3 passes, p95 per pass and the median of the passes",
    },
    pageLoad: loads,
    interactions: inter,
    table10k: big,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await info.attach("speed-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`page load (median of 5):\n${loads.map((r) => `${String(r.median).padStart(5)} ms  ${r.path}`).join("\n")}`);
  console.log(`interactions (max event ms p50/max; done p50):\n${inter.map((r) => `${r.id.padEnd(18)} ${r.status.padEnd(5)} inp ${r.inpP50}/${r.inpMax} done ${r.doneP50}  ${r.what}`).join("\n")}`);
  console.log(`table: ${JSON.stringify(big)}`);
});
