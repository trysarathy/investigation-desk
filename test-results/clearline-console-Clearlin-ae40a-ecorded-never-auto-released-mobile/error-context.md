# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: clearline-console.spec.ts >> Clearline console >> scenario 3: compliance hold — reviewer decision recorded, never auto-released
- Location: tests/browser/clearline-console.spec.ts:93:3

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/clearline\/control\/holds$/
Received string:  "http://127.0.0.1:3184/clearline/trial"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:3184/clearline/trial"

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
- main:
  - navigation "Breadcrumb":
    - list:
      - listitem:
        - link "Console":
          - /url: /clearline
      - listitem:
        - text: /
        - link "Workspace":
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
  - paragraph: Guided trial · about 15 minutes
  - heading "Follow five payments from instruction to evidence." [level=1]
  - paragraph: Clearline shows payment providers what happened to each payout, what evidence supports it, and who must act next. Everything here is fictional test data in your browser.
  - link "Open the console":
    - /url: /clearline
  - button "Reset all cases"
  - status
  - region "The product in one minute":
    - heading "The product in one minute" [level=2]
    - list:
      - listitem:
        - strong: Connect
        - text: — create a payment intent, compare indicative sandbox routes, approve with two different people, submit, and receive provider events (including timeouts, duplicates, late and contradictory ones).
      - listitem:
        - strong: Investigate
        - text: "— each payment keeps three separate states: what the provider reports, what settlement evidence exists, and whether it reconciles. A provider saying “completed” is never shown as “payment successful”."
      - listitem:
        - strong: Control
        - text: — reconcile statement lines by trusted reference, work exceptions with owners and due dates, see usable liquidity under a provider-defined policy, record compliance reviewer decisions, and track funding advances until repaid.
  - region "01 / 05 · Successful payment":
    - heading "01 / 05 · Successful payment" [level=2]
    - text: Workspace · Investigation
    - heading "Starting state" [level=3]
    - paragraph: A supplier payout the sandbox provider reports as completed, plus a separate bank statement line.
    - heading "What you do" [level=3]
    - list:
      - listitem: Open the payment.
      - listitem: Read the three status dimensions in the header.
      - listitem: In the evidence timeline, find the provider event and the statement line, each with its source.
    - heading "Expected system response" [level=3]
    - list:
      - listitem: Execution says the provider reports completion — not “payment successful”.
      - listitem: Settlement evidence comes from the bank statement line, matched by trusted reference with code RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW.
      - listitem: Reconciliation is shown separately as matched.
    - paragraph:
      - strong: "Limitation:"
      - text: The statement line is fictional; no bank is connected.
    - 'link "Start case 01: Successful payment"':
      - /url: /clearline/payments/pi_s1_success
    - button "Reset to starting state"
  - region "02 / 05 · Returned payout":
    - heading "02 / 05 · Returned payout" [level=2]
    - text: Investigation · Exceptions
    - heading "Starting state" [level=3]
    - paragraph: The beneficiary's bank rejected the payout; the provider reported a return and a return line arrived on the statement.
    - heading "What you do" [level=3]
    - list:
      - listitem: Open the payment and read the explanation panel.
      - listitem: In the case section, assign an owner and add a note.
      - listitem: Try to resolve the case or its exception.
    - heading "Expected system response" [level=3]
    - list:
      - listitem: The explanation names what is known, what is not yet known, and what is still financially outstanding.
      - listitem: Resolve is refused until the engine's conditions are met, and the reason is shown.
      - listitem: Every action appears in the case history and the audit log.
    - paragraph:
      - strong: "Limitation:"
      - text: Beneficiary details are opaque test references; no real account is checked.
    - 'link "Start case 02: Returned payout"':
      - /url: /clearline/payments/pi_s2_returned
    - button "Reset to starting state"
  - region "03 / 05 · Compliance hold":
    - heading "03 / 05 · Compliance hold" [level=2]
    - text: Control · Compliance holds
    - heading "Starting state" [level=3]
    - paragraph: The partner placed the payout on hold and asked for supporting documents.
    - heading "What you do" [level=3]
    - list:
      - listitem: Submit the requested document names (metadata only).
      - listitem: Assign the compliance reviewer.
      - listitem: Switch “Acting as” to Priya (compliance) and record a decision with a reason.
    - heading "Expected system response" [level=3]
    - list:
      - listitem: There is no release button; Clearline only records the reviewer's decision.
      - listitem: A decision by anyone other than the assigned reviewer is refused with the reason.
      - listitem: The hold never releases on a timer or a provider event alone.
    - paragraph:
      - strong: "Limitation:"
      - text: Clearline makes no compliance decision; the partner and your reviewer do.
    - 'link "Start case 03: Compliance hold"':
      - /url: /clearline/control/holds
    - button "Reset to starting state"
  - region "04 / 05 · Base Sepolia finality delay":
    - heading "04 / 05 · Base Sepolia finality delay" [level=2]
    - text: Investigation · Chain evidence
    - heading "Starting state" [level=3]
    - paragraph: A testnet USDC transfer has been observed on Base Sepolia but does not yet have enough confirmations.
    - heading "What you do" [level=3]
    - list:
      - listitem: Open the payment and read the chain evidence panel.
      - listitem: Use “Simulate next provider event” to deliver more confirmations.
      - listitem: Watch settlement evidence move from pending finality towards verified.
    - heading "Expected system response" [level=3]
    - list:
      - listitem: Settlement evidence is pending finality until the confirmation threshold is reached.
      - listitem: The scope says on-chain transfer — it never claims a bank credit.
      - listitem: Only the allow-listed testnet token on chain 84532 is accepted.
    - paragraph:
      - strong: "Limitation:"
      - text: Synthetic testnet observations; no live chain lookup in this console.
    - 'link "Start case 04: Base Sepolia finality delay"':
      - /url: /clearline/payments/pi_s4_chain
    - button "Reset to starting state"
  - region "05 / 05 · Funding exposure":
    - heading "05 / 05 · Funding exposure" [level=2]
    - text: Control · Funding exposure
    - heading "Starting state" [level=3]
    - paragraph: The provider advanced SGD 50,000.00 to pay a supplier before its customer reimbursed it.
    - heading "What you do" [level=3]
    - list:
      - listitem: Open Funding exposure.
      - listitem: Check principal, repaid and outstanding, with the due date and repayment evidence.
      - listitem: Follow the exception for the receipt that quoted no reference.
    - heading "Expected system response" [level=3]
    - list:
      - listitem: SGD 50,000.00 advanced → SGD 30,000.00 repaid by reference → SGD 20,000.00 outstanding.
      - listitem: An unreferenced SGD 20,000.00 receipt is an exception, not a close — even though the amount equals what is owed.
      - listitem: The supplier payout links to its own investigation page.
    - paragraph:
      - strong: "Limitation:"
      - text: A projection, not a shared ledger. The provider makes every credit decision; Clearline lends nothing.
    - 'link "Start case 05: Funding exposure"':
      - /url: /clearline/control/funding
    - button "Reset to starting state"
  - region "Try your own payment":
    - heading "Try your own payment" [level=2]
    - paragraph: Create an intent, request quotes, approve as a different person, submit, then simulate the provider's next event with or without an injected failure. You land on the same payment's investigation page.
    - link "Open Connect":
      - /url: /clearline/connect
  - region "Funding Desk and the console":
    - heading "Funding Desk and the console" [level=2]
    - paragraph:
      - text: The console's Funding exposure page is a
      - strong: projection
      - text: "from the same engine: it links each advance to the supplier payout it funded, the maker–checker treasury approval, the repayment obligation and the statement lines allocated to it by reference, and computes what is still outstanding. It is not a shared production ledger. The original, more detailed Funding Desk prototype is still available separately."
    - link "Open Funding Desk prototype":
      - /url: /mentor-demo
  - region "Honest limitations":
    - heading "Honest limitations" [level=2]
    - list:
      - listitem: No licensed provider, bank or chain is connected. Providers, quotes, webhooks, balances and statements are simulated.
      - listitem: State lives in this browser only; there is no server persistence, multi-user access or login. Simulated roles stand in for people.
      - listitem: Quotes are indicative and never executable. Clearline does not move or hold funds, lend, or make compliance decisions.
      - listitem: "Not production infrastructure: no SSO, webhook delivery or retries, real settlement attestations or security review yet."
    - text: Please do not enter real customer names, bank details, credentials or wallet keys.
  - region "Tell us what you found":
    - heading "Tell us what you found" [level=2]
    - list:
      - listitem: Which of these exceptions happens most often in your team?
      - listitem: Who owns it today, and what system do they use?
      - listitem: Who would budget to fix it?
    - link "Email feedback":
      - /url: mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback
    - link "← Back to the Clearline website":
      - /url: https://clearline-marketing.vercel.app
    - link "Developer API reference":
      - /url: /clearline/docs
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
  56  |     await expect(page).toHaveURL(/\/clearline\/exceptions/);
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
> 96  |     await expect(page).toHaveURL(/\/clearline\/control\/holds$/);
      |                        ^ Error: expect(page).toHaveURL(expected) failed
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
  157 | 
  158 |   test("reset to sample restores the five scenarios and drops user data", async ({ page }) => {
  159 |     await open(page, "/clearline/connect");
  160 |     await page.getByLabel("Customer reference").fill("INV-RESET-1");
  161 |     await page.getByRole("button", { name: "Create test intent" }).click();
  162 |     await expect(page.getByTestId("intent-id")).toBeVisible();
  163 |     await open(page, "/clearline/payments");
  164 |     await expect(page.getByText("INV-RESET-1")).toBeVisible(); // persisted across navigation + reload
  165 |     await page.reload();
  166 |     await expect(page.getByTestId("cl-workspace")).toHaveAttribute("data-hydrated", "true");
  167 |     await expect(page.getByText("INV-RESET-1")).toBeVisible();
  168 |     await open(page, "/clearline/settings");
  169 |     await page.getByRole("button", { name: "Reset to sample" }).click();
  170 |     await expect(page.getByText("Workspace reset to the sample")).toBeVisible();
  171 |     await open(page, "/clearline/payments");
  172 |     await expect(page.getByText("INV-RESET-1")).toHaveCount(0);
  173 |     await expect(page.locator('#payments a[href^="/clearline/payments/pi_"]')).toHaveCount(5);
  174 |   });
  175 | 
  176 |   test("works when browser storage is unavailable", async ({ page }) => {
  177 |     await page.addInitScript(() => {
  178 |       Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  179 |     });
  180 |     await open(page, "/clearline/settings");
  181 |     await expect(page.getByText(/Unavailable — changes last until you reload/)).toBeVisible();
  182 |     await open(page, "/clearline/payments/pi_s1_success");
  183 |     await expect(page.getByTestId("dim-execution")).toBeVisible();
  184 |   });
  185 | 
  186 |   test("investigation page is operable by keyboard alone with visible focus", async ({ page, isMobile }) => {
  187 |     test.skip(isMobile, "keyboard walk runs on desktop");
  188 |     await open(page, "/clearline/payments/pi_s4_chain");
  189 |     await page.keyboard.press("Tab");
  190 |     await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  191 |     await page.keyboard.press("Enter");
  192 |     let reached = false;
  193 |     for (let i = 0; i < 60; i++) {
  194 |       await page.keyboard.press("Tab");
  195 |       const info = await page.evaluate(() => {
  196 |         const el = document.activeElement as HTMLElement | null;
```