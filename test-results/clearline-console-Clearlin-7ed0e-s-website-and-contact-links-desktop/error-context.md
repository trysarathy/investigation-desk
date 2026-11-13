# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: clearline-console.spec.ts >> Clearline console >> shell: test-mode marker, navigation, breadcrumbs, website and contact links
- Location: tests/browser/clearline-console.spec.ts:46:3

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/clearline\/exceptions/
Received string:  "http://127.0.0.1:3184/clearline"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:3184/clearline"

```

```yaml
- link "Skip to content":
  - /url: "#cl-main"
- region "Test mode notice":
  - text: TEST MODE · FICTIONAL DATA Simulated providers, quotes and statements. Clearline does not move or hold funds.
  - link "Guided trial":
    - /url: /clearline/trial
  - link "Clearline website":
    - /url: https://clearline-marketing.vercel.app
  - link "Feedback":
    - /url: mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback
- complementary:
  - link "Clearline console overview":
    - /url: /clearline
    - text: clearline.
  - button "Menu"
  - navigation "Console":
    - paragraph: Workspace
    - list:
      - listitem:
        - link "Overview":
          - /url: /clearline
      - listitem:
        - link "Payments":
          - /url: /clearline/payments
      - listitem:
        - link "Investigations":
          - /url: /clearline/investigations
      - listitem:
        - link "Exceptions":
          - /url: /clearline/exceptions
    - paragraph: Connect
    - list:
      - listitem:
        - link "Payment intents":
          - /url: /clearline/connect
      - listitem:
        - link "Quotes and routes":
          - /url: /clearline/connect/quotes
      - listitem:
        - link "Provider activity":
          - /url: /clearline/connect/activity
      - listitem:
        - link "Developer API reference":
          - /url: /clearline/docs
    - paragraph: Control
    - list:
      - listitem:
        - link "Reconciliation":
          - /url: /clearline/control/reconciliation
      - listitem:
        - link "Liquidity":
          - /url: /clearline/control/liquidity
      - listitem:
        - link "Funding exposure":
          - /url: /clearline/control/funding
      - listitem:
        - link "Compliance holds":
          - /url: /clearline/control/holds
      - listitem:
        - link "Reports and evidence":
          - /url: /clearline/control/reports
    - paragraph: Organization
    - list:
      - listitem:
        - link "Settings":
          - /url: /clearline/settings
    - link "Guided trial (5 cases)":
      - /url: /clearline/trial
    - link "Funding Desk prototype":
      - /url: /mentor-demo
    - link "← clearline-marketing.vercel.app":
      - /url: https://clearline-marketing.vercel.app
    - link "Contact / feedback":
      - /url: mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback
- main:
  - navigation "Breadcrumb":
    - list:
      - listitem:
        - link "Console":
          - /url: /clearline
      - listitem: /Overview
  - text: Acting as
  - combobox "Acting as":
    - option "Maya Tan · Operations (fictional)" [selected]
    - option "Sam Lee · Operations (fictional)"
    - option "Daniel Ong · Treasury approver (fictional)"
    - option "Priya Nair · Compliance reviewer (fictional)"
    - option "Alex Chen · Viewer (fictional)"
  - text: Simulated role — sandbox only
  - paragraph: Workspace
  - heading "Overview" [level=1]
  - paragraph: "Simulated clock: 2026-11-13 10:00 SGT. Each figure links to the payments or cases behind it."
  - link "New payment intent":
    - /url: /clearline/connect
  - link "Guided trial":
    - /url: /clearline/trial
  - strong: Lumen Pay Sandbox Pte Ltd (fictional)
  - text: is a fictional organisation. A provider saying “completed” is a provider claim; Clearline shows execution, settlement evidence and reconciliation as three separate states.
  - link "Payments in workspace 5 View payments":
    - /url: /clearline/payments
  - link "Provider-reported complete, settlement not verified 1 View these payments":
    - /url: /clearline/payments?execution=provider_reported_completed
  - link "Payments with a reconciliation exception 0 View these payments":
    - /url: /clearline/payments?reconciliation=exception
  - link "Open exceptions 4 Open exceptions queue":
    - /url: /clearline/exceptions
  - link "Open investigations 4 View cases":
    - /url: /clearline/investigations
  - link "Compliance holds awaiting a human 1 View holds":
    - /url: /clearline/control/holds
  - link "Statement lines not allocated 1 View statement lines":
    - /url: /clearline/control/reconciliation?status=open
  - link "Funding outstanding SGD 20,000.00 View advances":
    - /url: /clearline/control/funding
  - region "Needs attention":
    - heading "Needs attention" [level=2]
    - link "All exceptions":
      - /url: /clearline/exceptions
    - table:
      - rowgroup:
        - row "Exception Severity Status Owner Required action Payment":
          - columnheader "Exception"
          - columnheader "Severity"
          - columnheader "Status"
          - columnheader "Owner"
          - columnheader "Required action"
          - columnheader "Payment"
      - rowgroup:
        - row "Returned payout PV_RETURNED_BENEFICIARY_REJECTED High In review Maya Tan · Operations (fictional) Verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent. pi_00027":
          - cell "Returned payout PV_RETURNED_BENEFICIARY_REJECTED":
            - link "Returned payout":
              - /url: /clearline/exceptions#exc_00047
            - code: PV_RETURNED_BENEFICIARY_REJECTED
          - cell "High"
          - cell "In review"
          - cell "Maya Tan · Operations (fictional)"
          - cell "Verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent."
          - cell "pi_00027":
            - link "pi_00027":
              - /url: /clearline/payments/pi_00027
        - row "Compliance hold PV_PARTNER_COMPLIANCE_HOLD High In review Priya Nair · Compliance reviewer (fictional) The partner requested documents. Your compliance reviewer decides the response; the hold is never released automatically. pi_00060":
          - cell "Compliance hold PV_PARTNER_COMPLIANCE_HOLD":
            - link "Compliance hold":
              - /url: /clearline/exceptions#exc_00085
            - code: PV_PARTNER_COMPLIANCE_HOLD
          - cell "High"
          - cell "In review"
          - cell "Priya Nair · Compliance reviewer (fictional)"
          - cell "The partner requested documents. Your compliance reviewer decides the response; the hold is never released automatically."
          - cell "pi_00060":
            - link "pi_00060":
              - /url: /clearline/payments/pi_00060
        - row "Missing payment reference RC_AMOUNT_ONLY_CANDIDATES Medium Open Unassigned Ask the remitter for the payment reference; without it the receipt cannot be allocated. adv_00121":
          - cell "Missing payment reference RC_AMOUNT_ONLY_CANDIDATES":
            - link "Missing payment reference":
              - /url: /clearline/exceptions#exc_00160
            - code: RC_AMOUNT_ONLY_CANDIDATES
          - cell "Medium"
          - cell "Open"
          - cell "Unassigned"
          - cell "Ask the remitter for the payment reference; without it the receipt cannot be allocated."
          - cell "adv_00121":
            - link "adv_00121":
              - /url: /clearline/control/funding
        - row "Pending finality CH_BELOW_FINALITY_THRESHOLD Low Open Unassigned Wait until the finality threshold is reached; observation is not finality. pi_00090":
          - cell "Pending finality CH_BELOW_FINALITY_THRESHOLD":
            - link "Pending finality":
              - /url: /clearline/exceptions#exc_00114
            - code: CH_BELOW_FINALITY_THRESHOLD
          - cell "Low"
          - cell "Open"
          - cell "Unassigned"
          - cell "Wait until the finality threshold is reached; observation is not finality."
          - cell "pi_00090":
            - link "pi_00090":
              - /url: /clearline/payments/pi_00090
  - region "Recent activity":
    - heading "Recent activity" [level=2]
    - link "Audit log":
      - /url: /clearline/control/reports
    - list:
      - listitem:
        - text: 2026-11-12 10:30 SGT
        - paragraph: Simulated clock moved to 2026-11-13T02:00:00.000Z
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: clock.advanced
          - text: · workspace clock
      - listitem:
        - text: 2026-11-12 10:27 SGT
        - paragraph: missing_payment_reference · RC_AMOUNT_ONLY_CANDIDATES
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: exception.opened
          - text: · exception exc_00160
      - listitem:
        - text: 2026-11-12 10:27 SGT
        - paragraph: Payment INV-PM-5011 · Pacific Metals (fictional supplier)
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: case.opened
          - text: · case case_00161
      - listitem:
        - text: 2026-11-12 10:27 SGT
        - paragraph: bank_statement credit 2000000 SGD ref ""
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: statement.ingested
          - text: · statement_line stl_00157
      - listitem:
        - text: 2026-11-12 10:24 SGT
        - paragraph: SGD 30,000.00 by reference RPY-SEABRIGHT-0001; outstanding SGD 20,000.00
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: funding.repayment_allocated
          - text: · obligation obl_00124
      - listitem:
        - text: 2026-11-12 10:24 SGT
        - paragraph: SGD 30,000.00 → obl_00124 (RC_REPAYMENT_BY_REFERENCE, RC_PARTIAL_AMOUNT)
        - paragraph:
          - text: Maya Tan · Operations (fictional) ·
          - code: reconciliation.allocated
          - text: · statement_line stl_00150
  - text: Clearline test-mode console. All organisations, providers, quotes, balances and statements are fictional. No custody, payout execution, lending or compliance decisions.
  - link "Website":
    - /url: https://clearline-marketing.vercel.app
  - text: ·
  - link "aashmiin.k.2025@accountancy.smu.edu.sg":
    - /url: mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback
- alert
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | /** Fresh browser context per test = fresh localStorage = the deterministic sample workspace. */
  4   | async function open(page: Page, path: string) {
  5   |   await page.goto(path);
  6   |   await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  7   | }
  8   | 
  9   | async function noHorizontalOverflow(page: Page, label = "") {
  10  |   const o = await page.evaluate(() => {
  11  |     const cw = document.documentElement.clientWidth;
  12  |     const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > cw + 1).slice(0, 3)
  13  |       .map((e) => `${e.tagName}.${e.className}`);
  14  |     return { sw: document.documentElement.scrollWidth, cw, wide };
  15  |   });
  16  |   expect(o.sw, `${label}: scrollWidth ${o.sw} > clientWidth ${o.cw}; ${o.wide.join(" | ")}`).toBeLessThanOrEqual(o.cw);
  17  | }
  18  | 
  19  | /** Create → quote → choose (maker) → approve (checker ≠ maker) → submit. Returns the intent id. */
  20  | async function connectToSubmitted(page: Page, ref: string, outcome = "success") {
  21  |   await open(page, "/clearline/connect");
  22  |   await page.getByLabel("Customer reference").fill(ref);
  23  |   await page.getByLabel("Sandbox outcome").selectOption(outcome);
  24  |   await expect(page.getByLabel("Idempotency key")).not.toHaveValue("");
  25  |   await page.getByRole("button", { name: "Create test intent" }).click();
  26  |   await expect(page.getByTestId("intent-id")).toBeVisible();
  27  |   const id = (await page.getByTestId("intent-id").innerText()).trim();
  28  |   await expect(page.getByTestId("idempotency-key")).toContainText("idem_");
  29  |   await page.getByRole("button", { name: "Request quotes" }).click();
  30  |   await expect(page.getByText("Indicative sandbox quote — not executable").first()).toBeVisible();
  31  |   await expect(page.getByText("Not eligible").first()).toBeVisible();
  32  |   await page.getByRole("button", { name: /^Choose / }).and(page.locator(":enabled")).first().click();
  33  |   // Maker tries to approve their own instruction: the engine refuses.
  34  |   await page.locator("#checker").selectOption("usr_maya");
  35  |   await page.getByRole("button", { name: "Approve as checker" }).click();
  36  |   // The engine refuses: a non-approver (role check) or the maker themself (maker ≠ checker).
  37  |   await expect(page.getByText(/not applied — .*\((unauthorized_actor|maker_checker_violation)\)/)).toBeVisible();
  38  |   await page.locator("#checker").selectOption("usr_daniel");
  39  |   await page.getByRole("button", { name: "Approve as checker" }).click();
  40  |   await page.getByRole("button", { name: "Submit instruction" }).click();
  41  |   await expect(page.getByRole("button", { name: "Simulate next provider event" })).toBeVisible();
  42  |   return id;
  43  | }
  44  | 
  45  | test.describe("Clearline console", () => {
  46  |   test("shell: test-mode marker, navigation, breadcrumbs, website and contact links", async ({ page }) => {
  47  |     await open(page, "/clearline");
  48  |     await expect(page.getByTestId("test-mode-marker")).toHaveText("TEST MODE · FICTIONAL DATA");
  49  |     await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  50  |     await expect(page.locator('a[href="https://clearline-marketing.vercel.app"]').first()).toBeAttached();
  51  |     await expect(page.locator('a[href^="mailto:aashmiin.k.2025@accountancy.smu.edu.sg"]').first()).toBeAttached();
  52  |     // Every summary metric is a link to its underlying cases.
  53  |     const metrics = page.getByRole("link", { name: /View|Open exceptions queue/ });
  54  |     expect(await metrics.count()).toBeGreaterThanOrEqual(8);
  55  |     await page.getByRole("link", { name: /Open exceptions.*Open exceptions queue/ }).click();
> 56  |     await expect(page).toHaveURL(/\/clearline\/exceptions/);
      |                        ^ Error: expect(page).toHaveURL(expected) failed
  57  |     await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Workspace");
  58  |   });
  59  | 
  60  |   test("scenario 1: successful payment keeps three separate dimensions", async ({ page }) => {
  61  |     await open(page, "/clearline/trial");
  62  |     await page.getByRole("link", { name: "Start case 01: Successful payment" }).click();
  63  |     await expect(page).toHaveURL(/\/clearline\/payments\/pi_\d+$/); // documented scenario id resolves to the engine id
  64  |     await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  65  |     await expect(page.getByTestId("dim-execution")).toContainText("Provider reports completed");
  66  |     await expect(page.getByTestId("dim-settlement")).toBeVisible();
  67  |     await expect(page.getByTestId("dim-reconciliation")).toContainText("Matched");
  68  |     await expect(page.getByText(/payment successful/i)).toHaveCount(0);
  69  |     const tl = page.getByTestId("evidence-timeline");
  70  |     await expect(tl).toContainText("Source:");
  71  |     await expect(tl).toContainText("Statement record");
  72  |     await expect(tl).toContainText("Matching decision");
  73  |     await expect(page.getByTestId("explanation")).toContainText("Known");
  74  |   });
  75  | 
  76  |   test("scenario 2: returned payout — assign, note, resolve gated by the engine", async ({ page }) => {
  77  |     await open(page, "/clearline/payments/pi_s2_returned");
  78  |     await expect(page.getByTestId("dim-execution")).toContainText("Returned");
  79  |     const kase = page.locator("#case");
  80  |     await kase.getByLabel("Assign owner").selectOption("usr_maya");
  81  |     await kase.getByRole("button", { name: "Assign owner" }).click();
  82  |     await expect(kase.getByText("Owner assigned: recorded.")).toBeVisible();
  83  |     await kase.getByLabel("Add note").fill("Called the supplier; account name differs.");
  84  |     await kase.getByRole("button", { name: "Add note" }).click();
  85  |     await expect(kase.getByText("Called the supplier; account name differs.")).toBeVisible();
  86  |     await kase.getByLabel("Resolution note").fill("Trying to close early");
  87  |     await kase.getByRole("button", { name: "Resolve" }).click();
  88  |     await expect(kase.getByText(/Resolve not applied — .*\(/)).toBeVisible();
  89  |     await page.getByRole("link", { name: /Returned payout/ }).first().click();
  90  |     await expect(page).toHaveURL(/\/clearline\/exceptions/);
  91  |   });
  92  | 
  93  |   test("scenario 3: compliance hold — reviewer decision recorded, never auto-released", async ({ page }) => {
  94  |     await open(page, "/clearline/trial");
  95  |     await page.getByRole("link", { name: "Start case 03: Compliance hold" }).click();
  96  |     await expect(page).toHaveURL(/\/clearline\/control\/holds$/);
  97  |     await expect(page.getByRole("button", { name: /^Release/ })).toHaveCount(0);
  98  |     const hold = page.locator('section[id^="hold_"]').first();
  99  |     await hold.getByRole("button", { name: "Submit documents" }).click();
  100 |     await expect(hold.getByText("Documents submitted: recorded.")).toBeVisible();
  101 |     await hold.getByLabel("Assign reviewer").selectOption("usr_priya");
  102 |     await page.getByLabel("Acting as").first().selectOption("usr_priya");
  103 |     await hold.getByRole("button", { name: "Assign reviewer" }).click();
  104 |     await expect(hold.getByText("Reviewer assigned: recorded.")).toBeVisible();
  105 |     await hold.getByLabel("Reason (required)").fill("Invoice matches purchase order; request partner's release note.");
  106 |     await hold.getByRole("button", { name: "Record reviewer decision" }).click();
  107 |     await expect(hold.getByText("Reviewer decision: recorded.")).toBeVisible();
  108 |     await expect(hold).toContainText("Request more");
  109 |   });
  110 | 
  111 |   test("scenario 4: Base Sepolia finality delay advances to verified evidence", async ({ page }) => {
  112 |     await open(page, "/clearline/payments/pi_s4_chain");
  113 |     await expect(page.getByTestId("dim-settlement")).toContainText(/Pending finality|Evidence observed/);
  114 |     await expect(page.locator("#chain")).toContainText("not a bank credit");
  115 |     for (let i = 0; i < 20; i++) {
  116 |       if (/Evidence verified/.test(await page.getByTestId("dim-settlement").innerText())) break;
  117 |       await page.getByRole("button", { name: "Simulate next provider event" }).click();
  118 |       await expect(page.getByRole("status").filter({ hasText: /Provider event processed|No event simulated/ })).toBeVisible();
  119 |     }
  120 |     await expect(page.getByTestId("dim-settlement")).toContainText("Evidence verified");
  121 |     await expect(page.getByTestId("dim-settlement")).toContainText("on-chain transfer");
  122 |   });
  123 | 
  124 |   test("scenario 5: funding exposure 50,000 → 30,000 repaid → 20,000 outstanding", async ({ page }) => {
  125 |     await open(page, "/clearline/trial");
  126 |     await page.getByRole("link", { name: "Start case 05: Funding exposure" }).click();
  127 |     await expect(page).toHaveURL(/\/clearline\/control\/funding$/);
  128 |     await expect(page.getByTestId("funding-principal").first()).toContainText("50,000.00");
  129 |     await expect(page.getByTestId("funding-repaid").first()).toContainText("30,000.00");
  130 |     await expect(page.getByTestId("funding-outstanding").first()).toContainText("20,000.00");
  131 |     await expect(page.getByTestId("funding-exceptions").first()).toContainText("20,000.00");
  132 |     await expect(page.getByRole("link", { name: "/mentor-demo" })).toBeVisible();
  133 |   });
  134 | 
  135 |   test("Connect: create → quote → maker/checker → submit → event → investigation", async ({ page }) => {
  136 |     const id = await connectToSubmitted(page, "INV-E2E-301");
  137 |     await page.getByRole("button", { name: "Simulate next provider event" }).click();
  138 |     await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
  139 |     await expect(page.getByRole("heading", { level: 1 })).toContainText("INV-E2E-301");
  140 |     await expect(page.getByTestId("evidence-timeline")).toContainText("Instruction prepared (maker)");
  141 |     await expect(page.getByTestId("evidence-timeline")).toContainText("Checker decision: approved");
  142 |     await expect(page.getByTestId("evidence-timeline")).toContainText("Provider event");
  143 |   });
  144 | 
  145 |   test("failure injection: duplicate and contradictory events are recorded, not applied blindly", async ({ page }) => {
  146 |     const id = await connectToSubmitted(page, "INV-E2E-302");
  147 |     await page.getByRole("button", { name: "Simulate next provider event" }).click();
  148 |     await expect(page).toHaveURL(new RegExp(`/clearline/payments/${id}$`));
  149 |     await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  150 |     for (const inj of ["duplicate", "contradictory"]) {
  151 |       await page.getByLabel("Failure injection").selectOption(inj);
  152 |       await page.getByRole("button", { name: "Simulate next provider event" }).click();
  153 |       await expect(page.locator("#simulate").getByRole("status")).toContainText(/Provider event processed|No event simulated/);
  154 |     }
  155 |     await expect(page.getByTestId("evidence-timeline")).toContainText(/Duplicate ignored|Contradiction|Late, stored/);
  156 |   });
```