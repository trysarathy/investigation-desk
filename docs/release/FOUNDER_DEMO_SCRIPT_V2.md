# Founder demo script — Clearline v2 (15–20 minutes, fictional data)

Open **/clearline/trial** on the customer-trial preview. Say once, at the start: "Everything here is a sandbox —
fictional providers, quotes, webhooks, balances and statements. Nothing moves money. The maker/checker roles are
simulated workflow rules, not sign-in."

Navigation you will use: **Overview · Payments · Investigations · Reconciliation · Treasury & Funding** (daily work),
then **Routes & Providers · Compliance Holds · Reports · Developers · Settings** (set-up and reference).

**1. One minute — what it is.** "Clearline connects the payment instruction, what providers report and the financial
evidence, so an operations team can see what happened and what still needs attention. Every payment has three separate
truths: what the provider says happened (execution), what independent evidence shows (settlement evidence), and whether
it is matched in the books (reconciliation)."

**2. Case 01 — successful payment (3 min).** Start case 01. Routes & Providers › New payment intent → request quotes
("indicative sandbox quote — not executable") → choose a route → approve as a *different* simulated user (the engine
refuses maker = checker) → submit → simulate the provider events. Open the payment's investigation page:
- **Three truths:** execution "Provider reports completed" (the exact API value is shown as detail), settlement
  evidence "No settlement evidence", reconciliation "Pending". "A provider saying completed is a claim, not proof."
- Ingest the bank statement line → settlement evidence "Verified (by bank statement)", reconciliation "Matched". Only now
  is the status green.
- Show the **evidence timeline** (time, source, event, outcome, reference, why it matters) and the **findings**
  (known, unknown, contradictions, outstanding, owner).

**3. Case 02 — returned payout (2 min).** The beneficiary's bank rejected the payment. Execution "Provider reports
returned", settlement evidence "Evidence contradicts" (red), reconciliation "Exception". The supplier is still unpaid; the
owner and due date are shown. Point out: whichever order the return notice and the bank lines arrive in, the answer is
the same and is never "verified".

**4. Case 03 — compliance hold (2 min).** Compliance Holds. The partner asked for documents. There is no release button
— only "Record reviewer decision". A provider "completed" event does not move a held payout, and while it is held the
Funding page never says the supplier was paid.

**5. Case 04 — stablecoin finality (2 min).** Synthetic Base Sepolia testnet: the transfer is *observed* at 6 of 12
confirmations ("Awaiting finality"), not settled. Chain evidence counts only for the exact amount to the beneficiary
wallet, and it never proves a bank credit.

**6. Case 05 — funding exposure (3 min).** Treasury & Funding › Funding exposure: SGD 50,000.00 advanced, SGD 30,000.00
repaid by reference, SGD 20,000.00 outstanding with a due date. An unrelated SGD 20,000.00 receipt without the reference
stays in Reconciliation as an exception — it does not close the balance. "An amount match alone is never an
allocation."

**7. Optional — what an error looks like (1 min).** Try to close a payment with no settlement evidence: "Payment cannot
be closed. Settlement evidence is still missing." Actions only appear enabled when the engine would accept them.

**8. Questions (5 min) — then stop talking.**
- What is the last difficult payment or funding exception you handled? Which systems did you open?
- Who investigated it, what evidence was missing, and how was it resolved?
- What did it cost, who owns the budget, and what existing system nearly solves it?

Do not say "live", "production", "enterprise-ready", "partners" or "customers". Do not present the stateless test API
or the simulated roles as access control. If they offer real records: "Up to five redacted historical cases, once we
agree scope and secure data handling — uploads are disabled on this site."
