// QA end-to-end run against a demo server that is already running (npm run qa starts one for you).
//
//   BASE=http://localhost:3400 node tests/e2e/qa_flows.mjs
//
// Optional env:
//   NONDEMO_ID  a non-demo request created before this run (live mode); checked to survive the demo reset
//   SHOTS       a folder: one full-page screenshot per page at desktop width, plus any page with a problem
//   MAX_LOAD_MS page load budget (default 2000)
//
// Part 1 visits every page at 1280×800 and 390×844 and records HTTP status, console errors and
// warnings, uncaught exceptions, failed requests, load time and horizontal overflow on a phone.
// Part 2 plays demo cases a–g through the UI, then the new-request form and the demo reset.
// Exit code 0 only when every check passed. Results also go to tests/e2e/qa_results.json.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const { chromium } = pw;

const BASE = (process.env.BASE || "http://localhost:3400").replace(/\/$/, "");
const SHOTS = process.env.SHOTS;
const MAX_LOAD_MS = Number(process.env.MAX_LOAD_MS || 2000);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const checks = [];
const pages = [];
const record = (name, ok, detail = "") => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const slug = (p) => p.replace(/^\//, "").replace(/[^\w-]+/g, "_").slice(0, 80) || "root";

/** Next.js streams pages, so a missing record can arrive with HTTP 200: the not-found page itself is the signal. */
async function exists(path) {
  const r = await fetch(BASE + path);
  const html = await r.text();
  return r.status === 200 && !html.includes("NEXT_HTTP_ERROR_FALLBACK;404");
}

async function api(path, body) {
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const browser = await chromium.launch();

/** A page with listeners for everything that counts as a problem. */
async function open(vp) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const log = { errors: [], warnings: [], exceptions: [], failed: [] };
  page.on("console", (m) => { if (m.type() === "error") log.errors.push(m.text()); if (m.type() === "warning") log.warnings.push(m.text()); });
  page.on("pageerror", (e) => log.exceptions.push(String(e)));
  // Next.js cancels link prefetches when a page closes or navigates: those aborts are not failures.
  page.on("requestfailed", (r) => { const t = r.failure()?.errorText ?? ""; if (/ERR_ABORTED/.test(t) && /_rsc=/.test(r.url())) return; log.failed.push(`${t} ${r.url()}`); });
  page.on("response", (r) => { if (r.status() >= 400) log.failed.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, log };
}

const overflowOf = (page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return document.documentElement.scrollWidth > w + 1 ? document.documentElement.scrollWidth : 0;
});

async function auditPage(path, vp) {
  const { ctx, page, log } = await open(vp);
  const t0 = Date.now();
  let status = 0;
  try { status = (await page.goto(BASE + path, { waitUntil: "load", timeout: 30_000 }))?.status() ?? 0; } catch (e) { log.exceptions.push(String(e)); }
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(400);
  const overflow = vp.width < 500 ? await overflowOf(page) : 0;
  const empty = (await page.locator("main, body").first().innerText().catch(() => "")).trim().length < 20;
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
  const problems = [];
  if (status !== 200) problems.push(`HTTP ${status}`);
  if (log.errors.length) problems.push(`console errors: ${log.errors.join(" | ").slice(0, 300)}`);
  if (log.warnings.length) problems.push(`console warnings: ${log.warnings.join(" | ").slice(0, 300)}`);
  if (log.exceptions.length) problems.push(`exceptions: ${log.exceptions.join(" | ").slice(0, 300)}`);
  if (log.failed.length) problems.push(`failed requests: ${log.failed.join(" | ").slice(0, 300)}`);
  if (overflow) problems.push(`horizontal overflow: ${overflow}px wide at ${vp.width}px`);
  if (loadMs > MAX_LOAD_MS) problems.push(`slow: ${loadMs} ms`);
  if (empty) problems.push("page is empty");
  pages.push({ path, width: vp.width, status, loadMs, overflow, problems });
  record(`page ${path} @${vp.width}`, problems.length === 0, problems.join("; ") || `${loadMs} ms`);
  if (SHOTS && (vp.width === DESKTOP.width || problems.length)) {
    await page.screenshot({ path: `${SHOTS}/${slug(path)}_${vp.width}${problems.length ? "_PROBLEM" : ""}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
  return links;
}

/** Run one flow; any throw is a failed check with its message, and the run carries on. */
async function flow(name, vp, fn) {
  const { ctx, page, log } = await open(vp);
  try {
    const detail = await fn(page);
    const bad = [...log.exceptions, ...log.errors];
    record(`flow ${name}`, bad.length === 0, bad.length ? `browser errors: ${bad.join(" | ").slice(0, 300)}` : detail ?? "");
  } catch (e) {
    record(`flow ${name}`, false, String(e?.message ?? e).split("\n")[0].slice(0, 300));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/flow_${slug(name)}_PROBLEM.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
}

const books = (page) => page.getByTestId("books-status");
async function decide(page, kind, note) {
  await page.getByLabel("Decision note").fill(note);
  await page.getByTestId(`decide-${kind}`).click();
}
async function approve(page) {
  await books(page).filter({ hasText: "Ready to post" }).waitFor({ timeout: 15_000 });
  await page.getByTestId("approve-posting").click();
  await books(page).filter({ hasText: "Posted" }).waitFor({ timeout: 15_000 });
}
const lineKinds = async (page) => (await page.getByTestId("posting-lines").last().locator("tbody tr td:first-child").allInnerTexts()).map((s) => s.trim());

// ---------------------------------------------------------------------------------------------
// Setup: the demo day, from a clean start.
const reset = await api("/api/requests/demo", { kind: "reset" });
record("load the demo day (POST /api/requests/demo reset)", reset.status === 200, `HTTP ${reset.status}`);
if (process.env.NONDEMO_ID) record(`non-demo request ${process.env.NONDEMO_ID} exists before the reset`, await exists(`/requests/${process.env.NONDEMO_ID}`));

// Warm each route once so load times measure the page, not the server's first compile of it.
const ROUTES = ["/", "/requests", "/requests/all", "/requests/new", "/books", "/payments", "/inbox", "/settings", "/bulk"];
for (const p of ROUTES) await fetch(BASE + p).catch(() => {});

// Part 1: every page, both sizes.
const discovered = new Set();
for (const p of ROUTES) for (const vp of [DESKTOP, PHONE]) {
  const links = await auditPage(p, vp);
  links.filter((h) => /^\/requests\/DEMO-|^\/pay\/|^\/requests\/payments\//.test(h)).forEach((h) => discovered.add(h.split("?")[0]));
}
const detail = [...discovered].filter((h) => h.startsWith("/requests/DEMO-")).sort();
const publicIds = {};
for (const p of detail) {
  for (const vp of [DESKTOP, PHONE]) {
    const links = await auditPage(p, vp);
    links.filter((h) => /^\/pay\/|^\/requests\/payments\//.test(h)).forEach((h) => { discovered.add(h.split("?")[0]); if (h.startsWith("/pay/")) publicIds[p.slice(10)] = h.slice(5); });
  }
}
record("every demo request has a sender page link", detail.every((p) => publicIds[p.slice(10)]), `${Object.keys(publicIds).length} of ${detail.length}`);
for (const p of [...discovered].filter((h) => !h.startsWith("/requests/DEMO-")).sort()) for (const vp of [DESKTOP, PHONE]) await auditPage(p, vp);
for (const [label, path, words] of [["unknown request", "/requests/DEMO-9999", "Not found"], ["unknown sender link", "/pay/not-a-real-link", "This payment link isn't valid"]]) {
  const { ctx, page } = await open(PHONE);
  await page.goto(BASE + path);
  const box = page.getByTestId("not-found");
  await box.waitFor({ timeout: 10_000 }).catch(() => {});
  const text = (await box.count()) ? await box.innerText() : "";
  const ok = text.includes(words) && !/Case not found|Back to the queue/.test(text) && !(await overflowOf(page));
  record(`${label} shows a not-found page in the right words`, ok, ok ? words : `got: ${text.slice(0, 80) || "no not-found page"}`);
  await ctx.close();
}

// Part 2: the flows, from a fresh demo day.
await api("/api/requests/demo", { kind: "reset" });

await flow("a: Acme pays (send, mine, advance 12) → marked paid automatically → approve posting → Posted", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1041`);
  await page.getByTestId("play-payment").click();
  await page.getByTestId("verdict").filter({ hasText: "Matched and marked paid automatically" }).waitFor({ timeout: 20_000 });
  const pill = await page.locator(".page-head").innerText();
  if (!/Paid/.test(pill)) throw new Error(`status pill is not Paid: ${pill.slice(0, 120)}`);
  await approve(page);
  const kinds = await lineKinds(page);
  if (kinds.join() !== "Payment") throw new Error(`posted lines: ${kinds.join(", ")}`);
  return "Posted: one Payment line";
});

await flow("b: Brightline short → request balance → accept short → fee write-off line → approve", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1042`);
  await decide(page, "request_balance", "QA: sent the top-up request to the customer");
  await page.getByTestId("activity").locator("li", { hasText: /balance|top-up/i }).first().waitFor({ state: "attached", timeout: 10_000 });
  await page.reload();
  await decide(page, "accept_short", "QA: we absorb the 50.00 exchange fee");
  // Before the decision a short payment is already "Ready to post" as a partial payment: wait for the new plan.
  await page.getByTestId("posting-lines").first().filter({ hasText: "Fee write-off" }).waitFor({ timeout: 15_000 });
  await approve(page);
  const kinds = await lineKinds(page);
  if (kinds.join() !== "Payment,Fee write-off") throw new Error(`posted lines: ${kinds.join(", ")}`);
  return "Posted: Payment + Fee write-off";
});

await flow("c: Orbit counterfeit → dismiss → Never posted", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1043`);
  if (!(await page.getByTestId("mark-paid-blocked").isDisabled())) throw new Error("Mark paid is not locked");
  await decide(page, "dismiss_transfer", "QA: counterfeit token; customer told");
  await books(page).filter({ hasText: "Never posted" }).waitFor({ timeout: 15_000 });
  if (await page.getByTestId("approve-posting").count()) throw new Error("an approve button is offered for a counterfeit");
  return "Never posted";
});

await flow("d: Meridian wrong network → accept_other_network → Never posted", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1044`);
  const btn = page.getByTestId("decide-accept_other_network");
  if (!(await btn.count())) throw new Error("accept_other_network is not offered");
  await decide(page, "accept_other_network", "QA: treasury confirmed it arrived in the old Tron wallet");
  await books(page).filter({ hasText: "Never posted" }).waitFor({ timeout: 15_000 });
  if (await page.getByTestId("approve-posting").count()) throw new Error("an approve button is offered for a wrong-network payment");
  return "Never posted (wrong network)";
});

await flow("e: Kite unidentified → assign → posting ready → approve", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1045`);
  await page.getByTestId("review-suggested").click();
  await page.getByTestId("suggestion").first().waitFor();
  await page.getByLabel("Why this match").first().fill("QA: exact amount from Kite's usual wallet");
  await page.getByTestId("confirm-match").first().click();
  await page.waitForURL(/\/requests\/DEMO-1045$/, { timeout: 15_000 });
  await approve(page);
  const kinds = await lineKinds(page);
  if (kinds.join() !== "Payment") throw new Error(`posted lines: ${kinds.join(", ")}`);
  return "Posted: one Payment line";
});

await flow("f: Fernhill sender page stops a look-alike address", PHONE, async (page) => {
  const pid = publicIds["DEMO-1046"];
  if (!pid) throw new Error("no sender link for DEMO-1046");
  await page.goto(`${BASE}/requests/DEMO-1046`);
  const real = (await page.locator("dd.mono").first().innerText()).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(real)) throw new Error(`receiving address not found on the request page: ${real}`);
  await page.goto(`${BASE}/pay/${pid}`);
  await page.getByTestId("demo-paste-lookalike").click();
  const res = page.getByTestId("check-result");
  await res.filter({ hasText: "Stop: don't send to this address" }).waitFor({ timeout: 10_000 });
  await page.getByTestId("check-input").fill(real);
  await page.getByTestId("check-address").click();
  await res.filter({ hasText: "That's the right address" }).waitFor({ timeout: 10_000 });
  await page.getByTestId("check-input").fill("0x123");
  await page.getByTestId("check-address").click();
  await res.filter({ hasText: "isn't an Ethereum address" }).waitFor({ timeout: 10_000 });
  await page.goto(`${BASE}/requests/DEMO-1046`);
  await page.locator(".page-head", { hasText: "Scam stopped" }).waitFor({ timeout: 10_000 });
  return "look-alike stopped, real address accepted, invalid input explained, ops page shows Scam stopped";
});

await flow("g: Kestrel duplicate → refund_excess → approve → one payment and one overpayment", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests/DEMO-1047`);
  await decide(page, "refund_excess", "QA: refund address confirmed; instruction sent to treasury");
  await approve(page);
  const kinds = await lineKinds(page);
  if (kinds.join() !== "Payment,Overpayment") throw new Error(`posted lines: ${kinds.join(", ")}`);
  return "Posted: Payment + Overpayment";
});

await flow("redelivered event still counts once (Acme)", DESKTOP, async (page) => {
  const received = () => page.locator(".figure", { hasText: "Received" }).locator(".v").innerText();
  await page.goto(`${BASE}/requests/DEMO-1041`);
  const before = await received();
  const r = await api("/api/requests/demo", { kind: "redeliver", requestId: "DEMO-1041" });
  if (r.status !== 200) throw new Error(`redeliver HTTP ${r.status}`);
  await page.reload();
  const after = await received();
  if (before !== after) throw new Error(`received changed: ${before} → ${after}`);
  return `received ${after.replace(/\s+/g, " ")} before and after`;
});

await flow("books page after the flows: no console errors, audit log shows the postings", PHONE, async (page) => {
  await page.goto(`${BASE}/books`);
  const n = await page.getByTestId("audit-log").locator("li", { hasText: "Posted" }).count();
  if (n < 4) throw new Error(`only ${n} Posted entries in the audit log`);
  const o = await overflowOf(page);
  if (o) throw new Error(`horizontal overflow ${o}px`);
  return `${n} Posted entries`;
});

await flow("a decision shows on the page within 4 s (8 tries; refresh watchdog)", DESKTOP, async (page) => {
  const times = [];
  for (let i = 0; i < 8; i++) {
    await api("/api/requests/demo", { kind: "reset" });
    await page.goto(`${BASE}/requests/DEMO-1042`);
    await page.getByLabel("Decision note").fill(`QA latency try ${i}: asked for the balance`);
    const t0 = Date.now();
    await page.getByTestId("decide-request_balance").click();
    await page.getByTestId("activity").locator("li", { hasText: `QA latency try ${i}` }).first().waitFor({ state: "attached", timeout: 4_000 });
    times.push(Date.now() - t0);
  }
  return `ms: ${times.join(", ")}`;
});
await api("/api/requests/demo", { kind: "reset" });

let createdId = "";
await flow("new request through the form → sender page opens", PHONE, async (page) => {
  await page.goto(`${BASE}/requests/new`);
  await page.locator("#customerRef").fill("QA Test Customer");
  await page.locator("#invoiceRef").fill("INV-QA-1");
  await page.locator("#amount").fill("123.45");
  await page.locator("#receivingAddress").fill("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/requests\/[^/?]+\?created=1/, { timeout: 15_000 });
  createdId = new URL(page.url()).pathname.split("/").pop();
  const o = await overflowOf(page);
  if (o) throw new Error(`created page overflows: ${o}px`);
  const href = await page.getByTestId("sender-link").getAttribute("href");
  const sender = await page.goto(BASE + href);
  if (sender?.status() !== 200) throw new Error(`sender page HTTP ${sender?.status()}`);
  await page.getByText("INV-QA-1").first().waitFor();
  await page.getByTestId("send-exactly").filter({ hasText: "123.45" }).waitFor();
  if (await overflowOf(page)) throw new Error("sender page overflows on a phone");
  return `${createdId} created; sender page shows INV-QA-1, 123.45 USDC`;
});

await flow("reload demo day (two clicks) → demo rebuilt cleanly, non-demo data kept", DESKTOP, async (page) => {
  await page.goto(`${BASE}/requests`);
  const btn = page.getByTestId("reload-demo");
  await btn.click();
  await btn.filter({ hasText: "Click again" }).waitFor();
  await btn.click();
  await page.getByTestId("play-payment").waitFor({ timeout: 15_000 });
  // Every case back at its starting state.
  const startStates = { "DEMO-1041": "Awaiting payment", "DEMO-1042": "Short payment", "DEMO-1043": "Blocked", "DEMO-1047": "Paid twice" };
  for (const [id, label] of Object.entries(startStates)) {
    await page.goto(`${BASE}/requests/${id}`);
    const head = await page.locator(".page-head").innerText();
    if (!head.includes(label)) throw new Error(`${id} after reload: "${head.replace(/\s+/g, " ").slice(0, 100)}" (expected ${label})`);
    if (id !== "DEMO-1041" && id !== "DEMO-1043" && /Posted/.test(await books(page).innerText().catch(() => ""))) throw new Error(`${id} still shows Posted after reload`);
  }
  // A request made during the demo is demo data (labelled, cleared by the reload), by design.
  if (createdId && await exists(`/requests/${createdId}`)) throw new Error(`the request made during the demo (${createdId}) is still there`);
  if (process.env.NONDEMO_ID && !(await exists(`/requests/${process.env.NONDEMO_ID}`))) throw new Error(`non-demo request ${process.env.NONDEMO_ID} was removed`);
  const again = await api("/api/requests/demo", { kind: "reset" });
  if (again.status !== 200) throw new Error(`second reset HTTP ${again.status}`);
  return `cases back to their start states; demo-made request cleared${process.env.NONDEMO_ID ? `; ${process.env.NONDEMO_ID} kept` : " (no NONDEMO_ID given: non-demo check skipped)"}`;
});

await browser.close();

const failed = checks.filter((c) => !c.ok);
const loads = pages.map((p) => p.loadMs).sort((a, b) => a - b);
const summary = {
  at: new Date().toISOString(), base: BASE, checks: checks.length, passed: checks.length - failed.length, failed: failed.length,
  load: { pages: loads.length, medianMs: loads[Math.floor(loads.length / 2)], maxMs: loads.at(-1), slowest: [...pages].sort((a, b) => b.loadMs - a.loadMs).slice(0, 5).map((p) => `${p.path} @${p.width}: ${p.loadMs} ms`) },
  failures: failed, pages,
};
try { writeFileSync(new URL("./qa_results.json", import.meta.url), JSON.stringify(summary, null, 2)); } catch { /* read-only checkout: the console has it all */ }
console.log(`\n${summary.passed} of ${summary.checks} checks passed. Page loads: median ${summary.load.medianMs} ms, max ${summary.load.maxMs} ms.`);
process.exit(failed.length ? 1 : 0);
