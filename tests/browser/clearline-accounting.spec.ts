import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

/*
 * rc4 Accounting Bridge in the console: every bridge action, each engine-gated with a dry run, including the
 * refusals (maker = checker, wrong role, closed period, unmapped role, posting before export, revision conflict).
 * Sample entry ids and amounts are not pinned (the engine's posting rules may change): rows are found by
 * payment, rule and the engine's own labels and reason codes.
 */

const ROLE_NOTE = "Simulated role — not sign-in or access control";
const POSTING_NOTE = "Recorded by a person. Clearline does not post to any ledger.";

async function hydrated(page: Page) {
  await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
}
async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}
const entries = (page: Page) => page.locator("#entries tbody tr[data-proposal]");
/** Opens the review of the first entry in the table (or of `row`). */
async function review(page: Page, row = entries(page).first()) {
  const id = await row.getAttribute("data-proposal");
  await row.getByRole("button", { name: /^Review/ }).click();
  return page.locator(`[data-testid="proposal-review"][data-proposal="${id}"]`);
}
async function approveAs(page: Page, rv: ReturnType<Page["locator"]>, who: string) {
  await rv.getByTestId("approver-select").selectOption(who);
  await rv.getByTestId("approve-gate").getByRole("button", { name: "Approve entry" }).click();
  await expect(rv.getByRole("status")).toContainText("Approve entry — recorded by the engine");
}
async function tab(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Accounting pages" }).getByRole("link", { name }).click();
  await hydrated(page);
}

function axeSource(): string | null {
  const p = [process.env.CLEARLINE_AXE_PATH, process.env.QA_AXE_PATH].find((x) => x && existsSync(x));
  return p ? readFileSync(p, "utf8") : null;
}
async function axeViolations(page: Page, axe: string): Promise<string[]> {
  await page.evaluate(axe);
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run({ resultTypes: ["violations"] });
    return r.violations.map((x) => `${x.id} (${x.impact}, ${x.nodes.length})`);
  });
}
async function overflow(page: Page): Promise<string | null> {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  return o.sw > o.cw ? `scrollWidth ${o.sw} > ${o.cw}` : null;
}

test("overview: open period, mapping status and counts that match the table", async ({ page }) => {
  await open(page, "/clearline/accounting");
  await expect(page.getByTestId("bridge-disclaimer")).toContainText("posts nothing");
  await expect(page.getByTestId("overview-period")).toContainText("2026-11");
  await expect(page.getByTestId("overview-mapping")).toContainText("every account the entries use is mapped");
  const total = await entries(page).count();
  expect(total).toBeGreaterThan(0);
  let sum = 0;
  for (const s of ["proposed", "approved", "exported", "posted"]) {
    const n = Number(await page.getByTestId(`count-${s}`).innerText());
    expect(n).toBe(await page.locator(`#entries [data-testid="proposal-status"][data-api-value="${s}"]`).count());
    sum += n;
  }
  expect(sum).toBe(total);
  // Every entry is balanced, has exact debit and credit amounts, a currency and accounts with codes.
  for (const row of await entries(page).all()) {
    await expect(row.getByTestId("entry-balanced")).toHaveAttribute("data-balanced", "true");
    await expect(row.getByTestId("entry-currency")).toHaveText(/^[A-Z]{3,4}$/);
    expect(await row.getByTestId("account-code").count()).toBeGreaterThanOrEqual(2);
    await expect(row.getByTestId("entry-debit")).toContainText(/\d+\.\d{2}/);
  }
  // A status count is a link to the filtered table.
  await page.getByTestId("overview-counts").getByRole("link").first().click();
  await expect(page).toHaveURL(/status=proposed/);
});

test("a returned payout's entries read “Supplier still unpaid — payable open”; evidence links open the investigation", async ({ page, request }) => {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s2 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s2_returned")!.id;
  await open(page, `/clearline/accounting?payment=${s2}`);
  const rows = entries(page);
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row.getByTestId("supplier-paid")).toHaveText("Supplier still unpaid — payable open");
    await expect(row.getByTestId("supplier-paid")).toHaveAttribute("data-shows-paid", "false");
  }
  // At least one sample entry shows a supplier paid, by bank evidence — never a returned payout.
  await open(page, "/clearline/accounting");
  await expect(page.locator('#entries [data-testid="supplier-paid"][data-shows-paid="true"]').first()).toContainText("Shows the supplier as paid");
  await open(page, `/clearline/accounting?payment=${s2}`);
  const ev = rows.first().getByTestId("entry-evidence");
  await expect(ev.locator('[data-evidence="statement-line"]')).toContainText("Statement line");
  await ev.locator('[data-evidence="statement-line"]').first().click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${s2}#timeline$`));
  await hydrated(page);
  // The investigation's last section: the accounting outcome of this payment.
  const outcome = page.getByTestId("accounting-outcome");
  expect(await outcome.locator("tr[data-proposal]").count()).toBeGreaterThan(0);
  await expect(outcome.getByTestId("supplier-paid").first()).toHaveText("Supplier still unpaid — payable open");
  await expect(outcome.getByTestId("proposal-status").first()).toContainText("Proposed — not approved, not posted");
  await page.goBack();
  await hydrated(page);
  await rows.first().getByTestId("entry-evidence").locator('[data-evidence="payment"]').click();
  await expect(page).toHaveURL(new RegExp(`/clearline/payments/${s2}#accounting$`));
});

test("not proposed: the unreferenced receipt says no entry (amount-only match) and links to its exception", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const item = page.locator('#not-proposed li[data-code="NP_AMOUNT_ONLY_MATCH"]').first();
  await expect(item).toContainText("No entry");
  await expect(item).toContainText("Only the amount matches — no entry");
  await expect(item.getByTestId("not-proposed-amount")).toContainText(/^SGD [\d,]+\.\d{2}$/);
  const link = item.getByRole("link", { name: /^Open exception exc_/ });
  const exc = ((await link.innerText()).match(/exc_\d+/) ?? [""])[0];
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/clearline/exceptions\\?view=all#${exc}$`));
  await hydrated(page);
  await expect(page.locator(`[id="${exc}"]`)).toBeVisible();
});

test("approve: maker = checker and a non-approver are refused in the engine's words; a different approver is recorded", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const row = entries(page).first();
  const rv = await review(page, row);
  await expect(rv.getByText(ROLE_NOTE)).toBeVisible();
  const gate = rv.getByTestId("approve-gate");
  const btn = gate.getByRole("button", { name: "Approve entry" });
  // The sample's entries were proposed by Maya: she cannot check her own work.
  await expect(rv).toContainText("Proposed by Maya Tan");
  await rv.getByTestId("approver-select").selectOption("usr_maya");
  await expect(btn).toBeDisabled();
  await expect(gate).toContainText("different person");
  await expect(gate).toContainText("maker_checker_violation");
  await rv.getByTestId("approver-select").selectOption("usr_sam");
  await expect(btn).toBeDisabled();
  await expect(gate).toContainText("unauthorized_actor");
  const before = Number(await page.getByTestId("count-approved").innerText());
  await approveAs(page, rv, "usr_daniel");
  await expect(row.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "approved");
  await expect(row).toContainText("Approved by Daniel Ong");
  await expect(page.getByTestId("count-approved")).toHaveText(String(before + 1));
  // Approved once: a second approval is refused by the engine.
  await expect(btn).toBeDisabled();
});

test("reject needs a reason; the rejection is recorded with it", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const row = entries(page).first();
  const rv = await review(page, row);
  const btn = rv.getByTestId("reject-gate").getByRole("button", { name: "Reject entry" });
  await expect(btn).toBeDisabled();
  await expect(rv.getByTestId("reject-gate")).toContainText("Give a reason for rejecting first.");
  await rv.getByLabel("Reason for rejecting").fill("Duplicate of a manual journal already in the ledger");
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(rv.getByRole("status")).toContainText("Reject entry — recorded by the engine");
  await expect(row.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "rejected");
  await expect(row).toContainText("Duplicate of a manual journal already in the ledger");
  // A viewer may not reject.
  const other = entries(page).nth(1);
  const rv2 = await review(page, other);
  await page.locator("#cl-actor-global").selectOption("usr_alex");
  await rv2.getByLabel("Reason for rejecting").fill("Not mine to reject");
  await expect(rv2.getByTestId("reject-gate").getByRole("button", { name: "Reject entry" })).toBeDisabled();
  await expect(rv2.getByTestId("reject-gate")).toContainText("unauthorized_actor");
});

test("record posting: refused before export (NOT_EXPORTED); after approve and export, a typed reference is recorded as simulated", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const row = entries(page).first();
  const rv = await review(page, row);
  await expect(rv.getByTestId("posting-note")).toContainText(POSTING_NOTE);
  await rv.getByLabel("External ledger reference").fill("JE-EARLY-1");
  const post = rv.getByTestId("posting-gate").getByRole("button", { name: "Record posting" });
  await expect(post).toBeDisabled();
  await expect(rv.getByTestId("posting-gate")).toContainText("Only an exported entry can be recorded as posted.");
  await expect(rv.getByTestId("posting-gate")).toContainText("NOT_EXPORTED");
  await approveAs(page, rv, "usr_daniel");
  await tab(page, "Exports");
  const period = page.locator("#journal li", { hasText: "2026-11" });
  await expect(period.getByTestId("approved-count")).toHaveText("1");
  await period.getByRole("button", { name: /^Export journal/ }).click();
  await expect(page.locator("#journal").getByRole("status")).toContainText("Nothing was posted");
  await tab(page, "Proposed entries");
  const exported = page.locator('#entries tr[data-proposal]:has([data-api-value="exported"])');
  await expect(exported).toHaveCount(1);
  await expect(exported.getByTestId("proposal-status")).toContainText("Exported to file — not confirmed as posted");
  const rv2 = await review(page, exported);
  // Rejecting an exported entry needs an approver other than the person who exported it (Maya, acting).
  await rv2.getByLabel("Reason for rejecting").fill("Imported twice by mistake");
  await expect(rv2.getByTestId("reject-gate").getByRole("button", { name: "Reject entry" })).toBeDisabled();
  await expect(rv2.getByTestId("reject-gate")).toContainText(/maker_checker_violation|unauthorized_actor/);
  await rv2.getByLabel("Reason for rejecting").fill("");
  // The engine checks the reference the person typed.
  await rv2.getByLabel("External ledger reference").fill("x");
  await expect(rv2.getByTestId("posting-gate").getByRole("button", { name: "Record posting" })).toBeDisabled();
  await expect(rv2.getByTestId("posting-gate")).toContainText("invalid_field");
  await rv2.getByLabel("External ledger reference").fill("JE-2026-11-0099");
  await rv2.getByTestId("posting-gate").getByRole("button", { name: "Record posting" }).click();
  await expect(rv2.getByRole("status")).toContainText("Record posting — recorded by the engine");
  await expect(rv2.getByTestId("posting-recorded")).toContainText("JE-2026-11-0099 (simulated). Clearline posted nothing.");
  await expect(page.getByTestId("count-posted")).toHaveText("1");
});

test("confirm never imported: needs an approver other than the exporter and a note; then no reversal is needed", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const first = entries(page).first();
  const id = await first.getAttribute("data-proposal");
  // The review offers the control only once an entry has been exported.
  const rv0 = await review(page, first);
  await expect(rv0.getByTestId("not-imported-group")).toHaveCount(0);
  await approveAs(page, rv0, "usr_daniel");
  await tab(page, "Exports");
  await page.locator("#cl-actor-global").selectOption("usr_daniel"); // Daniel exports
  await page.locator("#journal li", { hasText: "2026-11" }).getByRole("button", { name: /^Export journal/ }).click();
  await expect(page.locator("#journal").getByRole("status")).toContainText("recorded by the engine");
  await page.goto(`/clearline/accounting#${id}`);
  await hydrated(page);
  const rv = page.locator(`[data-testid="proposal-review"][data-proposal="${id}"]`);
  const group = rv.getByTestId("not-imported-group");
  await expect(group.getByText(ROLE_NOTE)).toBeVisible();
  const btn = group.getByTestId("not-imported-gate").getByRole("button", { name: "Confirm never imported" });
  // Daniel exported it, so he cannot confirm it; an operator cannot either; Lin, a second approver, can.
  await group.getByTestId("confirmer-select").selectOption("usr_daniel");
  await expect(btn).toBeDisabled();
  await expect(group.getByTestId("not-imported-gate")).toContainText("maker_checker_violation");
  await group.getByTestId("confirmer-select").selectOption("usr_sam");
  await expect(group.getByTestId("not-imported-gate")).toContainText("unauthorized_actor");
  await group.getByTestId("confirmer-select").selectOption("usr_lin");
  await expect(btn).toBeDisabled();
  await expect(group.getByTestId("not-imported-gate")).toContainText("Say how you confirmed it was never imported first.");
  await group.getByLabel("How you confirmed it").fill("Checked the ledger's import log for this file: no journal with this id");
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(rv.getByRole("status")).toContainText("Confirm never imported — recorded by the engine");
  const row = page.locator(`#entries tr[data-proposal="${id}"]`);
  await expect(row.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "rejected");
  await expect(row.getByTestId("supplier-paid")).toHaveText("Withdrawn — says nothing about the supplier");
  await expect(group.getByTestId("not-imported-recorded")).toContainText("Confirmed never imported by Lin Wei");
  // Never imported, so no reversal: proposing again offers the same evidence afresh, not a JR_REVERSAL.
  await page.getByTestId("propose-gate").getByRole("button", { name: "Propose entries" }).click();
  await expect(page.locator("#propose").getByRole("status")).toContainText("recorded by the engine");
  await expect(page.locator('#entries tr[data-rule="JR_REVERSAL"]')).toHaveCount(0);
  await expect(page.locator(`#entries tr[data-rule="${await row.getAttribute("data-rule")}"]:has([data-api-value="proposed"])`).first()).toBeVisible();
  await open(page, "/clearline/reports/audit");
  await expect(page.getByTestId("audit-table").locator('tr[data-action="journal.confirmed_not_imported"]')).toHaveCount(1);
});

test("a saved entry the current rules derive differently is superseded on load; the notice links to it", async ({ page, request }) => {
  const ws = (await (await request.get("/api/clearline/test/v1/workspace", { headers: { Authorization: "Bearer cl_test_demo" } })).json()).data;
  const s1 = ws.intents.find((i: { scenario?: string }) => i.scenario === "s1_success");
  s1.status = { ...s1.status, execution: "returned", settlement: "verified", settlementScope: "bank_statement" };
  // Stored before the first page load, so the page under test is the one that migrates it.
  await page.addInitScript((text) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("clearline.console.workspace.v1", text); sessionStorage.setItem("seeded", "1"); } }, JSON.stringify(ws));
  await open(page, `/clearline/payments/${s1.id}`);
  const notice = page.getByTestId("workspace-migrated");
  await expect(notice).toContainText("posting rules");
  const link = notice.getByRole("link", { name: /^journal entry jp_\d+$/ });
  const id = ((await link.innerText()).match(/jp_\d+/) ?? [""])[0];
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/clearline/accounting#${id}$`));
  await hydrated(page);
  const row = page.locator(`#entries tr[data-proposal="${id}"]`);
  await expect(row.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "superseded");
  await expect(row.getByTestId("supersession")).toContainText("SP_RULES_CHANGED");
  await expect(row.getByTestId("supplier-paid")).toHaveText("Withdrawn — says nothing about the supplier");
});

test("G1: a contradictory provider event withdraws the entry; it is listed as not proposed (contradicted) and never shows the supplier paid", async ({ page, request }) => {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s1 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s1_success")!.id;
  await open(page, `/clearline/payments/${s1}`);
  const outcome = page.getByTestId("accounting-outcome");
  await expect(outcome.locator('[data-testid="supplier-paid"][data-shows-paid="true"]').first()).toBeVisible();
  await page.locator("#inv-inj").selectOption("contradictory");
  await page.locator("#simulate").getByRole("button", { name: "Simulate next provider event" }).click();
  await expect(page.locator("#simulate").getByRole("status")).toContainText("recorded by the engine");
  await expect(page.getByTestId("dim-settlement").locator('[data-api-value="contradicted"]')).toBeVisible();
  await expect(outcome.locator('[data-testid="supplier-paid"][data-shows-paid="true"]')).toHaveCount(0);
  await expect(outcome.getByTestId("proposal-status").first()).toHaveAttribute("data-api-value", "superseded");
  await expect(outcome.getByTestId("accounting-not-proposed")).toContainText("NP_EVIDENCE_CONTRADICTED");
  await open(page, "/clearline/accounting");
  const item = page.locator('#not-proposed li[data-code="NP_EVIDENCE_CONTRADICTED"]');
  await expect(item).toContainText("The evidence is contradicted — no entry");
  await expect(item.getByRole("link", { name: /^Open exception exc_/ })).toBeVisible();
  await expect(page.getByTestId("propose-gate").getByRole("button", { name: "Propose entries" })).toBeDisabled();
});

async function postFirstEntryOf(page: Page, intentId: string, ref: string) {
  await open(page, `/clearline/accounting?payment=${intentId}`);
  const row = entries(page).first();
  const id = (await row.getAttribute("data-proposal"))!;
  await approveAs(page, await review(page, row), "usr_daniel");
  await tab(page, "Exports");
  await page.locator("#journal li", { hasText: "2026-11" }).getByRole("button", { name: /^Export journal/ }).click();
  await expect(page.locator("#journal").getByRole("status")).toContainText("recorded by the engine");
  if (ref) {
    await page.goto(`/clearline/accounting#${id}`);
    await hydrated(page);
    const rv = page.locator(`[data-testid="proposal-review"][data-proposal="${id}"]`);
    await rv.getByLabel("External ledger reference").fill(ref);
    await rv.getByTestId("posting-gate").getByRole("button", { name: "Record posting" }).click();
    await expect(rv.getByRole("status")).toContainText("Record posting — recorded by the engine");
  }
  return id;
}

test("M1: a posted entry whose payout is then returned never reads “supplier paid” — table and payment page say what changed", async ({ page, request }) => {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s1 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s1_success")!.id;
  const id = await postFirstEntryOf(page, s1, "JE-2026-11-0101");
  await open(page, `/clearline/accounting?payment=${s1}`);
  await expect(page.locator(`#entries tr[data-proposal="${id}"]`).getByTestId("supplier-paid")).toHaveAttribute("data-shows-paid", "true");
  // The provider then reports the payout returned: a signed sandbox webhook (the sandbox secret is public).
  const ws = JSON.parse((await page.evaluate(() => localStorage.getItem("clearline.console.workspace.v1")))!);
  const ins = ws.instructions.find((x: { intentId: string }) => x.intentId === s1);
  const seq = Math.max(0, ...ws.providerEvents.filter((e: { intentId?: string }) => e.intentId === s1).map((e: { sequence: number }) => e.sequence)) + 1;
  const rawBody = JSON.stringify({ id: `${ins.providerPaymentId}-RET`, type: "payout.returned", provider_payment_id: ins.providerPaymentId, sequence: seq, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" });
  const t = Math.floor(Date.parse(ws.asOf) / 1000);
  const sig = `t=${t},v1=${createHmac("sha256", `test_whsec_${ins.providerId}_public_example`).update(`${t}.${rawBody}`).digest("hex")}`;
  const res = await request.post("/api/clearline/test/v1/events/webhook", { headers: { Authorization: "Bearer cl_test_demo" }, data: { workspace: ws, providerId: ins.providerId, rawBody, signatureHeader: sig } });
  const j = await res.json();
  expect(res.ok(), JSON.stringify(j.error)).toBe(true);
  expect(j.workspace.intents.find((i: { id: string }) => i.id === s1).status.execution).toBe("returned");
  await page.evaluate((text) => localStorage.setItem("clearline.console.workspace.v1", text), JSON.stringify(j.workspace));
  await open(page, `/clearline/accounting?payment=${s1}`);
  const row = page.locator(`#entries tr[data-proposal="${id}"]`);
  await expect(row.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "posted");
  const paid = row.getByTestId("supplier-paid");
  await expect(paid).toHaveAttribute("data-shows-paid", "false");
  await expect(paid).toContainText("Showed the supplier as paid when exported — payout since: provider reports returned");
  await expect(paid).not.toContainText(/^Shows the supplier as paid/);
  await expect(row.getByTestId("evidence-changed")).toContainText("Evidence changed after export");
  // The payment's accounting outcome says the same.
  await open(page, `/clearline/payments/${s1}`);
  const out = page.getByTestId("accounting-outcome").locator(`tr[data-proposal="${id}"]`);
  await expect(out.getByTestId("supplier-paid")).toContainText("Showed the supplier as paid when exported — payout since: provider reports returned");
  await expect(out.getByTestId("evidence-changed")).toBeVisible();
  await expect(page.getByTestId("accounting-outcome").locator('[data-testid="supplier-paid"][data-shows-paid="true"]')).toHaveCount(0);
  // Proposing again adds the reversal, and the row names it.
  await open(page, "/clearline/accounting");
  await page.getByTestId("propose-gate").getByRole("button", { name: "Propose entries" }).click();
  await expect(page.locator(`#entries tr[data-proposal="${id}"]`).getByTestId("supplier-paid")).toContainText("a reversal is proposed (jp_");
  await expect(page.locator('#entries tr[data-rule="JR_REVERSAL"]')).toHaveCount(1);
});

test("M1: an exported entry whose payout evidence is then contradicted (G1) reads what it showed and what changed", async ({ page, request }) => {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s1 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s1_success")!.id;
  const id = await postFirstEntryOf(page, s1, "");
  await open(page, `/clearline/payments/${s1}`);
  await page.locator("#inv-inj").selectOption("contradictory");
  await page.locator("#simulate").getByRole("button", { name: "Simulate next provider event" }).click();
  await expect(page.locator("#simulate").getByRole("status")).toContainText("recorded by the engine");
  const out = page.getByTestId("accounting-outcome").locator(`tr[data-proposal="${id}"]`);
  await expect(out.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "exported");
  await expect(out.getByTestId("supplier-paid")).toContainText("Showed the supplier as paid when exported — settlement evidence since contradicted");
  await expect(out.getByTestId("supplier-paid")).toHaveAttribute("data-shows-paid", "false");
  await open(page, "/clearline/accounting");
  await expect(page.locator(`#entries tr[data-proposal="${id}"]`).getByTestId("evidence-changed")).toBeVisible();
});

test("m2: every Accounting tab, both export panels and the payment's outcome say the posting rules are not signed off", async ({ page, request }) => {
  const NOTE = "Sandbox posting rules, pending founder sign-off — review with your accountant before using this file.";
  for (const p of ["/clearline/accounting", "/clearline/accounting/setup"]) {
    await open(page, p);
    await expect(page.getByTestId("rules-note").first()).toContainText(NOTE);
  }
  await open(page, "/clearline/accounting/exports");
  await expect(page.locator("#journal").getByTestId("rules-note")).toContainText(NOTE);
  await expect(page.locator("#reconciliation-export").getByTestId("rules-note")).toContainText(NOTE);
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s2 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s2_returned")!.id;
  await open(page, `/clearline/payments/${s2}`);
  await expect(page.getByTestId("accounting-outcome").getByTestId("rules-note")).toContainText(NOTE);
});

test("journal export: refused with nothing approved; downloads CSV and JSON marked fictional and not posted", async ({ page }) => {
  await open(page, "/clearline/accounting/exports");
  await expect(page.getByTestId("export-marking")).toContainText("Clearline has posted nothing");
  const period = page.locator("#journal li", { hasText: "2026-11" });
  await expect(period.getByRole("button", { name: /^Export journal/ })).toBeDisabled();
  await expect(period.getByTestId("export-journal-gate")).toContainText("NOTHING_TO_EXPORT");
  await tab(page, "Proposed entries");
  await approveAs(page, await review(page), "usr_daniel");
  await tab(page, "Exports");
  await period.getByRole("button", { name: /^Export journal/ }).click();
  const rec = page.locator("#records tr[data-export=journal]").first();
  await expect(rec).toBeVisible();
  const [csv] = await Promise.all([page.waitForEvent("download"), rec.getByRole("button", { name: /Download journal \(\.csv\)/ }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^jx_[0-9a-f]{16}\.csv$/);
  const text = readFileSync(await csv.path(), "utf8");
  const lines = text.trim().split("\r\n");
  expect(lines[0].startsWith("journal_id,journal_date,entry_date,account_code,account_name,debit,credit")).toBe(true);
  expect(lines.length).toBeGreaterThanOrEqual(3);
  for (const l of lines.slice(1)) expect(l).toContain("FICTIONAL SANDBOX");
  const [json] = await Promise.all([page.waitForEvent("download"), rec.getByRole("button", { name: /Download journal \(\.json\)/ }).click()]);
  const doc = JSON.parse(readFileSync(await json.path(), "utf8"));
  expect(doc).toMatchObject({ kind: "journal", fictional: true, sandbox: true, notPostedByClearline: true });
  expect(doc.entries).toHaveLength(1);
});

test("reconciliation export: choose a date range, download CSV and JSON; an invalid range is refused and nothing downloads", async ({ page }) => {
  await open(page, "/clearline/accounting/exports");
  await page.locator("#rx-from").fill("2026-11-01");
  await page.locator("#rx-to").fill("2026-12-01");
  await expect(page.getByTestId("rx-summary")).toContainText("rows");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download reconciliation export (.csv)" }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^rx_[0-9a-f]{16}\.csv$/);
  const text = readFileSync(await csv.path(), "utf8");
  expect(text.split("\r\n")[0]).toContain("section,row_id,movement,evidence_class");
  expect(text).toContain("XR_FICTIONAL_SANDBOX");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download reconciliation export (.json)" }).click()]);
  expect(JSON.parse(readFileSync(await json.path(), "utf8"))).toMatchObject({ kind: "reconciliation", period: { from: "2026-11-01", to: "2026-12-01" } });
  await expect(page.locator("#records tr[data-export=reconciliation]")).toHaveCount(2);
  // to before from: refused by the engine, the buttons are disabled.
  await page.locator("#rx-to").fill("2026-10-01");
  await expect(page.getByTestId("rx-invalid")).toContainText("invalid_field");
  await expect(page.getByRole("button", { name: "Download reconciliation export (.csv)" })).toBeDisabled();
  // A viewer may not record an export.
  await page.locator("#rx-to").fill("2026-12-01");
  await page.locator("#cl-actor-global").selectOption("usr_alex");
  await expect(page.getByRole("button", { name: "Download reconciliation export (.json)" })).toBeDisabled();
  await expect(page.locator("#reconciliation-export")).toContainText("unauthorized_actor");
});

test("periods: closing needs the approver and no open proposals; a closed period refuses proposals and a second close; overlap refused", async ({ page }) => {
  await open(page, "/clearline/accounting/setup");
  await expect(page.locator("#periods").getByText(ROLE_NOTE)).toBeVisible();
  const nov = page.locator('#periods tr[data-period="2026-11"]');
  // Maya (operator) may not close a period.
  await expect(nov.getByTestId("close-gate")).toContainText("unauthorized_actor");
  await page.locator("#cl-actor-periods").selectOption("usr_daniel");
  await expect(nov.getByRole("button", { name: /^Close period/ })).toBeDisabled();
  await expect(nov.getByTestId("close-gate")).toContainText("PERIOD_HAS_PENDING_PROPOSALS");
  // An overlapping period is refused.
  await page.locator("#period-name").fill("Overlap");
  await page.locator("#period-from").fill("2026-11-15");
  await page.locator("#period-to").fill("2026-12-15");
  await expect(page.getByTestId("open-period-gate")).toContainText("PERIOD_OVERLAP");
  await expect(page.getByTestId("open-period-gate").getByRole("button", { name: "Open period" })).toBeDisabled();
  // Open an earlier, empty period and close it as the approver.
  await page.locator("#period-name").fill("2026-10");
  await page.locator("#period-from").fill("2026-10-01");
  await page.locator("#period-to").fill("2026-11-01");
  await page.getByTestId("open-period-gate").getByRole("button", { name: "Open period" }).click();
  await expect(page.locator("#periods").getByRole("status")).toContainText("Open period 2026-10 — recorded by the engine");
  const oct = page.locator('#periods tr[data-period="2026-10"]');
  await oct.getByRole("button", { name: /^Close period/ }).click();
  await expect(page.locator("#periods").getByRole("status")).toContainText("Close period 2026-10 — recorded by the engine");
  await expect(oct.getByTestId("period-status")).toContainText("Closed");
  await expect(oct.getByRole("button", { name: /^Close period/ })).toBeDisabled();
  await expect(oct.getByTestId("close-gate")).toContainText("PERIOD_CLOSED");
  await expect(oct.getByRole("button", { name: /^Propose entries in this period/ })).toBeDisabled();
  await expect(oct.getByTestId("propose-period-gate")).toContainText("This accounting period is closed");
  await expect(oct.getByTestId("propose-period-gate")).toContainText("PERIOD_CLOSED");
});

test("unmapped role: blocks approval and export in the engine's words; a code change supersedes an approval (needs re-approval)", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const first = entries(page).first();
  const approvedId = await first.getAttribute("data-proposal");
  const rv = await review(page, first);
  await approveAs(page, rv, "usr_daniel");
  await expect(rv.getByTestId("approved-accounts")).toContainText("mapping revision 1");
  await tab(page, "Periods and mapping");
  const banks = page.locator('#mapping tr[data-account-key^="bank:"]');
  await expect(banks.first()).toBeVisible();
  for (const row of await banks.all()) {
    await row.getByLabel(/Account code for/).fill("");
    await row.getByLabel(/Account name for/).fill("");
  }
  await expect(page.locator("#mapping")).toContainText("Not mapped — blocks export");
  await page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(page.locator("#mapping").getByRole("status")).toContainText("recorded by the engine");
  await expect(page.getByTestId("mapping-revision")).toContainText("Saved revision 2");
  await expect(page.getByTestId("overview-mapping")).toContainText("Export blocked");
  await expect(page.getByTestId("overview-mapping-reason")).toContainText("Map every account role the entries use");
  // The approval named codes that changed: the engine supersedes it, and the table says it needs a new approval.
  await tab(page, "Proposed entries");
  const was = page.locator(`#entries tr[data-proposal="${approvedId}"]`);
  await expect(was.getByTestId("proposal-status")).toHaveAttribute("data-api-value", "superseded");
  await expect(was.getByTestId("supersession")).toContainText("SP_MAPPING_CHANGED");
  await expect(was.getByTestId("supersession")).toContainText("needs a new approval");
  await expect(page.getByTestId("account-unmapped").first()).toHaveText("Not mapped");
  // Approving an entry whose accounts are not mapped is refused.
  const pending = page.locator('#entries tr[data-proposal]:has([data-api-value="proposed"])').first();
  const rv2 = await review(page, pending);
  await rv2.getByTestId("approver-select").selectOption("usr_daniel");
  await expect(rv2.getByTestId("approve-gate").getByRole("button", { name: "Approve entry" })).toBeDisabled();
  await expect(rv2.getByTestId("approve-gate")).toContainText("UNMAPPED_ACCOUNT_ROLE");
  await tab(page, "Exports");
  await expect(page.locator("#journal li", { hasText: "2026-11" }).getByRole("button", { name: /^Export journal/ })).toBeDisabled();
});

test("mapping: an invalid code is refused field by field; two roles on one code are refused", async ({ page }) => {
  await open(page, "/clearline/accounting/setup");
  const first = page.locator("#mapping tr[data-account-key]").first();
  const second = page.locator("#mapping tr[data-account-key]").nth(1);
  await first.getByLabel(/Account code for/).fill("bad code!");
  await expect(page.getByTestId("mapping-save-gate")).toContainText("invalid_field");
  await first.getByLabel(/Account code for/).fill(await second.getByLabel(/Account code for/).inputValue());
  await expect(page.getByTestId("mapping-save-gate")).toContainText("used for two roles");
  await expect(page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();
  // Discarding asks first; "Keep editing" keeps the draft.
  await page.getByTestId("discard-confirm").getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByTestId("mapping-save-gate")).not.toContainText("No changes to save.");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByTestId("discard-confirm").getByRole("button", { name: "Yes, discard them" }).click();
  await expect(page.getByTestId("mapping-save-gate")).toContainText("No changes to save.");
});

test("mapping: a revision conflict from another tab is refused with the engine's words and can be resolved by reloading", async ({ page, context }) => {
  await open(page, "/clearline/accounting/setup");
  const code = (p: Page) => p.locator('#mapping tr[data-account-key="suspense"]').getByLabel(/Account code for/);
  await code(page).fill("1998");
  await expect(page.getByTestId("mapping-revision")).toContainText("Editing from revision 1");
  // Another tab saves first.
  const other = await context.newPage();
  await open(other, "/clearline/accounting/setup");
  await other.locator('#mapping tr[data-account-key="suspense"]').getByLabel(/Account name for/).fill("Suspense (changed in another tab, fictional)");
  await other.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(other.locator("#mapping").getByRole("status")).toContainText("recorded by the engine");
  await other.close();
  // This tab reloads the saved workspace; its unsaved edit is kept, and the engine refuses the stale revision.
  await page.reload();
  await hydrated(page);
  await expect(code(page)).toHaveValue("1998");
  const conflict = page.getByTestId("mapping-conflict");
  await expect(conflict).toContainText("The account mapping changed since you loaded it");
  await expect(conflict).toContainText("MAPPING_REVISION_CONFLICT");
  await expect(page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" })).toBeDisabled();
  // Theirs and yours side by side.
  const diffRow = conflict.getByTestId("mapping-diff").locator('tr[data-account-key="suspense"]');
  await expect(diffRow).toContainText("changed in another tab");
  await expect(diffRow).toContainText("1998");
  await conflict.getByRole("button", { name: "Discard my changes and load revision 2" }).click();
  await conflict.getByTestId("discard-confirm").getByRole("button", { name: "Yes, discard them" }).click();
  await expect(code(page)).toHaveValue("1999");
  await expect(page.getByTestId("mapping-revision")).toContainText("Saved revision 2");
});

test("mapping: a conflict can be resolved keeping your edits — re-applied on the new revision, still saved by you", async ({ page, context }) => {
  await open(page, "/clearline/accounting/setup");
  const row = (p: Page, k: string) => p.locator(`#mapping > form tr[data-account-key="${k}"]`);
  await row(page, "suspense").getByLabel(/Account code for/).fill("1998");
  const other = await context.newPage();
  await open(other, "/clearline/accounting/setup");
  await row(other, "supplier_payable").getByLabel(/Account name for/).fill("Trade payables (changed in another tab, fictional)");
  await other.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(other.locator("#mapping").getByRole("status")).toContainText("recorded by the engine");
  await other.close();
  await page.reload();
  await hydrated(page);
  const conflict = page.getByTestId("mapping-conflict");
  await expect(conflict.getByTestId("mapping-diff").locator("tbody tr")).toHaveCount(2);
  await conflict.getByRole("button", { name: "Re-apply my changes on revision 2" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(row(page, "suspense").getByLabel(/Account code for/)).toHaveValue("1998");
  await expect(row(page, "supplier_payable").getByLabel(/Account name for/)).toHaveValue("Trade payables (changed in another tab, fictional)");
  await expect(page.getByTestId("mapping-revision")).toContainText("Editing from revision 2");
  await page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(page.locator("#mapping").getByRole("status")).toContainText("(revision 2 → 3) — recorded by the engine");
  await expect(page.getByTestId("mapping-revision")).toContainText("Saved revision 3");
});

test("mapping: a draft is never saved over a different mapping with the same revision number", async ({ page, context }) => {
  // This tab saves revision 2, then keeps editing (draft based on that revision 2).
  await open(page, "/clearline/accounting/setup");
  const code = (p: Page) => p.locator('#mapping > form tr[data-account-key="suspense"]').getByLabel(/Account code for/);
  await code(page).fill("1998");
  await page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByTestId("mapping-revision")).toContainText("Saved revision 2");
  await code(page).fill("1997");
  // Another tab resets the workspace and saves a different revision 2.
  const other = await context.newPage();
  await open(other, "/clearline/settings");
  await other.getByRole("button", { name: "Reset to sample" }).click();
  await open(other, "/clearline/accounting/setup");
  await other.locator('#mapping > form tr[data-account-key="suspense"]').getByLabel(/Account name for/).fill("Suspense (another workspace, fictional)");
  await other.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" }).click();
  await expect(other.getByTestId("mapping-revision")).toContainText("Saved revision 2");
  await other.close();
  await page.reload();
  await hydrated(page);
  // Same revision number, different mapping: the draft is treated as stale and cannot be saved over it.
  await expect(page.getByTestId("mapping-conflict")).toBeVisible();
  await expect(page.getByTestId("mapping-save-gate").getByRole("button", { name: "Save mapping" })).toBeDisabled();
  await expect(page.getByTestId("mapping-save-gate")).toContainText("The saved mapping changed since you started editing");
});

test("propose entries: refused with nothing new; a provider settlement report gives no entry", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const gate = page.getByTestId("propose-gate");
  await expect(gate.getByRole("button", { name: "Propose entries" })).toBeDisabled();
  await expect(gate).toContainText("no_new_proposals");
  // The engine never proposes from a provider report: ingest one and nothing new appears.
  await open(page, "/clearline/reconciliation");
  await page.locator('#ingest select:has(option[value="provider_settlement_report"])').selectOption("provider_settlement_report");
  await page.getByRole("button", { name: "Ingest statement line" }).click();
  await expect(page.locator("#ingest").getByRole("status")).toContainText(/Line ingested|not ingested/);
  await open(page, "/clearline/accounting");
  await expect(gate.getByRole("button", { name: "Propose entries" })).toBeDisabled();
});

test("audit history: bridge actions appear with actor, time and evidence references; filters by payment, area and text", async ({ page }) => {
  await open(page, "/clearline/accounting");
  const row = entries(page).first();
  const id = await row.getAttribute("data-proposal");
  await approveAs(page, await review(page, row), "usr_daniel");
  await open(page, "/clearline/reports/audit");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("ConsoleReportsAudit history");
  const table = page.getByTestId("audit-table");
  const ev = table.locator('tr[data-action="journal.approved"]').first();
  await expect(ev.getByTestId("audit-actor")).toContainText("Daniel Ong");
  await expect(ev.getByTestId("audit-actor")).toContainText("Simulated approver");
  await expect(ev.locator('td[data-label="Time"]')).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} SGT/);
  await expect(ev.getByTestId("audit-refs").getByRole("link", { name: id! })).toBeVisible();
  await expect(ev.getByTestId("audit-refs").getByRole("link", { name: /^stl_/ }).first()).toBeVisible();
  for (const a of ["accounting.mapping_set", "accounting.period_opened", "journal.proposed"]) await expect(table.locator(`tr[data-action="${a}"]`).first()).toBeAttached();
  const search = page.getByRole("search", { name: "Filter audit history" });
  await search.locator("select[name=group]").selectOption("Journal entries");
  await expect(page).toHaveURL(/group=Journal/);
  for (const a of await table.getByTestId("audit-action").allInnerTexts()) expect(a).toMatch(/^journal\./);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await search.getByLabel("Search").fill(id!);
  await expect(page).toHaveURL(new RegExp(`q=${id}`));
  expect(Number(await page.getByTestId("audit-count").innerText())).toBeGreaterThanOrEqual(2);
  // Per payment, from the investigation.
  await ev.getByTestId("audit-refs").getByRole("link", { name: id! }).click();
  await expect(page).toHaveURL(new RegExp(`/clearline/accounting#${id}$`));
  await hydrated(page);
  await expect(page.locator(`[data-testid="proposal-review"][data-proposal="${id}"]`)).toBeVisible();
  const pay = await page.locator(`tr[data-proposal="${id}"]`).getByTestId("entry-evidence").locator('[data-evidence="payment"]').getAttribute("href");
  await open(page, pay!.replace(/#.*/, ""));
  const audit = page.locator("#audit");
  await expect(audit.getByTestId("payment-audit")).toContainText("journal.approved");
  await audit.getByRole("link", { name: "Open the full audit history for this payment" }).click();
  await expect(page).toHaveURL(/\/clearline\/reports\/audit\?payment=pi_\d+$/);
  await hydrated(page);
  await expect(page.getByTestId("audit-table").locator('tr[data-action="journal.approved"]')).toHaveCount(1);
});

test("a reset of a guided case with an approved entry is refused in the engine's words; the whole workspace resets", async ({ page, request }) => {
  const r = await request.get("/api/clearline/test/v1/intents", { headers: { Authorization: "Bearer cl_test_demo" } });
  const s1 = ((await r.json()).data as { id: string; scenario?: string }[]).find((i) => i.scenario === "s1_success")!.id;
  await open(page, `/clearline/accounting?payment=${s1}`);
  await approveAs(page, await review(page), "usr_daniel");
  await open(page, `/clearline/payments/${s1}`);
  await expect(page.getByTestId("reset-case")).toContainText("ACCOUNTING_ENTRIES_RECORDED");
  await open(page, "/clearline/settings");
  await page.getByRole("button", { name: "Reset to sample" }).click();
  await open(page, "/clearline/accounting");
  await expect(page.getByTestId("count-approved")).toHaveText("0");
});

test("accounting and audit pages: axe 0 violations and no horizontal overflow at 1440, 1024, 768, 390 and 320", async ({ page, isMobile }) => {
  test.skip(isMobile, "viewport widths set explicitly; runs once");
  test.setTimeout(240_000);
  const axe = axeSource();
  expect(axe, "set CLEARLINE_AXE_PATH or QA_AXE_PATH").not.toBeNull();
  const report: string[] = [];
  const check = async (label: string) => {
    const o = await overflow(page);
    if (o) report.push(`${label}: ${o}`);
    const v = await axeViolations(page, axe!);
    if (v.length) report.push(`${label}: ${v.join(", ")}`);
  };
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const p of ["/clearline/accounting", "/clearline/accounting/setup", "/clearline/accounting/exports", "/clearline/reports/audit"]) {
      await open(page, p);
      await check(`${p} @${width}`);
    }
    await open(page, "/clearline/accounting");
    await review(page);
    await check(`review open @${width}`);
    await open(page, "/clearline/payments");
    await page.locator('#payments a[href^="/clearline/payments/pi_"]').nth(1).click();
    await hydrated(page);
    await check(`investigation with accounting outcome @${width}`);
  }
  expect(report, report.join("\n")).toEqual([]);
});
