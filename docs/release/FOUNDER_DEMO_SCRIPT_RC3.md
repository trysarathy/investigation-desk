# Founder demo script — Clearline rc3 (15–20 minutes, fictional data)

Start on the **website** (rc3 preview), click **Explore Clearline**, then **Open the guided trial**. Say once:
"Everything here is a sandbox — fictional providers, quotes, webhooks, balances and statements. Nothing moves money.
The role switcher is a simulated role, not sign-in or access control."

Navigation: **Overview · Payments · Investigations · Reconciliation · Treasury & Funding**, then **Routes & Providers ·
Compliance Holds · Reports · Developers · Settings**.

**1. One minute — what it is.** "Clearline keeps one record per payment: what the provider says happened (execution),
what independent evidence shows (settlement evidence), and whether the books match (reconciliation). Connect handles
the instruction; Control keeps the evidence and the exceptions."

**2. Case 01 — Successful payment (3 min).** Open the payment. Execution says *Provider reports completed* — not
"successful". Settlement evidence comes from a fictional bank statement line matched by trusted reference;
reconciliation is shown separately as matched. Scroll the evidence timeline: every row names its source.
Then show **View case report** → the engine's synthetic report (marked fictional), downloadable as JSON or CSV.
*Optional, if they are technical:* Routes & Providers › New payment intent → quotes ("indicative sandbox quote — not
executable") → choose an eligible route → approve as a different simulated person (the same person is refused) → submit
→ simulate provider events.

**3. Case 02 — Returned payout (3 min).** The statement shows the outgoing debit, then the return credit for the same
USD 12,784.90. Settlement evidence is *contradicted* (red). The return position states both facts: "net to zero on the
statement. The beneficiary was not paid." Assign an owner, add a note, try **Resolve** — the engine's reason is shown
under the disabled button. Open the Exceptions queue and filter by status; the filter stays in the URL.

**4. Case 03 — Compliance hold (2 min).** There is no release button. Assign the compliance reviewer, switch "Acting as"
to Priya (compliance), record a decision with a reason. Anyone else is refused; nothing releases on a timer or a
provider event.

**5. Case 04 — Base Sepolia finality (2 min).** Synthetic testnet USDC observed at 6 of 12 confirmations: *awaiting
finality*. Simulate the next provider event until it is verified *by on-chain transfer* — never a bank credit.

**6. Case 05 — Funding exposure (3 min).** Treasury & Funding › Funding exposure: SGD 50,000.00 advanced → SGD 30,000.00
repaid by reference → SGD 20,000.00 outstanding with a due date. An unreferenced SGD 20,000.00 receipt is an exception,
not a close. Open the specialist **Funding Desk** workflow from the same page.

**7. Reset (30 s).** On the trial page, **Reset case 02 to its starting state** restores only that case; anything you created stays. If a
record you created depends on the case, the reset is refused and says why. **Reset the whole workspace** (also on the trial
page) starts over.

**8. Optional — a disagreeing bank debit (2 min).** Ingest a debit 0.5% over a payment: one person can accept the
over-amount with a reason. Above 1% a second, different person must approve. A different currency is never acceptable,
and the case says what evidence would be needed.

**9. Questions (5 min) — then stop talking.**
- What is the last difficult payment or funding exception you handled? Which systems did you open?
- Who investigated it, what evidence was missing, and how was it resolved?
- What did it cost, who owns the budget, and what existing system nearly solves it?

**Working today vs in development.** Working in the sandbox: everything above, the stateless v1 test API with its
OpenAPI document. Not built: connections to licensed providers, banks or wallets; real chain reads; user accounts,
authentication and server-side storage; uploads of your own data; the onchain Safe proposals design. Clearline does not
execute payouts, hold funds or keys, lend, or make compliance decisions.

Do not say "live", "production", "enterprise-ready", "partners" or "customers". If they offer real records: "Up to five
redacted historical cases, once we agree scope and secure data handling — uploads are disabled on this site."
