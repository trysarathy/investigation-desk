# Founder demo script — Clearline Connect + Control (15–20 minutes, fictional data)

Open **/clearline/trial** on the customer-trial site. Everything is a sandbox: fictional providers, quotes, webhooks,
balances and statements. Nothing moves money. Say this once at the start.

**1. One minute: what it is.** "Connect handles the payment instruction and what providers report. Control keeps the
evidence, reconciliation, liquidity, holds, exceptions and funding exposure. They share one record per payment."

**2. Case 1 — successful payment (3 min).** Connect → Payment intents → create an intent → request quotes ("indicative
sandbox quote — not executable") → choose a route → approve as a *different* simulated user (maker ≠ checker) → submit
→ simulate the provider events. Open the payment. Point at the three separate statuses: execution says
*provider_reported_completed*; settlement stays *none/observed* until a bank statement line arrives; reconciliation is
*pending*. Ingest the statement line → settlement *verified* (scope: bank statement) and reconciliation *matched*.
"A provider saying 'completed' is a claim, not proof."

**3. Case 2 — returned payout (2 min).** The beneficiary details were rejected: reconciliation is an *exception*, the
return is confirmed by a statement line, the supplier is still unpaid, and the owner and due date are shown.

**4. Case 3 — compliance hold (2 min).** The partner asked for documents. There is no release button — only "Record
reviewer decision". A provider event cannot move a held payout.

**5. Case 4 — Base Sepolia delay (2 min).** Synthetic testnet: the transfer is *observed* at 6 of 12 confirmations
(*pending finality*), not settled. A chain transfer never proves a bank credit.

**6. Case 5 — funding exposure (3 min).** Control → Funding exposure: SGD 50,000.00 advanced, SGD 30,000.00 repaid by
reference, SGD 20,000.00 outstanding with a due date. An SGD 20,000.00 receipt *without* the reference stays an
exception — it does not close the balance.

**7. Questions (5 min) — then stop talking.**
- What is the last difficult payment or funding exception you handled? Which systems did you open?
- Who investigated it, what evidence was missing, and how was it resolved?
- What did it cost, who owns the budget, and what existing system nearly solves it?

Do not say "live", "production", "partners" or "customers". Do not show the stateless test API as access control.
