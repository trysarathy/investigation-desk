# Founder demo script — Clearline rc4 (20 minutes, fictional data)

Start on the **website** (rc4 preview) → **Explore Clearline** → guided trial. Say once: "Everything here is a
sandbox — fictional providers, quotes, webhooks, statements and accounts. Nothing moves money and nothing is posted to
any ledger. Role switching is a simulated role, not sign-in."

**1. One minute — the problem.** "When a payment goes wrong, someone reconstructs it across the provider portal, the bank
statement, the chain explorer and the ledger. Clearline keeps one record per payment: what the provider *says*
happened, what *independent evidence* shows, whether it *reconciles* — and carries that to a proposed accounting
outcome a person approves."

**2. Case 01 — successful payment (3 min).** Open the payment. Execution "Provider reports completed"; settlement
evidence from a fictional bank statement line matched by trusted reference; reconciliation separate. Scroll to
**F. Accounting outcome**: one *proposed* entry (Dr supplier payable / Cr bank), balanced, with the statement line as its
evidence. Point at "proposed — not approved, not posted".

**3. Case 02 — returned payout (3 min).** Debit and return credit for USD 12,784.90: "net to zero on the statement. The
beneficiary was not paid." Settlement is contradicted (red). In the accounting outcome both entries read **"Supplier
still unpaid — payable open"**: the money went through provider clearing; the supplier payable never moved.

**4. Accounting (4 min).** Control › **Accounting**:
- Proposed entries — every line has an account code from the mapping, every entry balances per currency.
- "Not proposed, and why" — the unrelated SGD 20,000 receipt: *no entry, amount-only match*; a provider "completed" on
  its own: *no entry*.
- **Approve** as the proposer → refused (maker ≠ checker). Switch the approver to Daniel → approved.
- **Record posting** before export → refused. **Export journal** → download CSV/JSON (marked fictional, "not posted by
  Clearline", content-hashed id). **Record posting** with a reference you type, e.g. JE-2026-11-0042 — "Clearline
  records that *you* posted it; it posts nothing."
- Optional: Periods and mapping — closing a period with pending entries is refused; unmapping a bank account blocks
  export.

**5. Case 03 — compliance hold (2 min).** No release button; only the assigned compliance reviewer's decision, plus the
partner's release, moves it. No accounting entry while held.

**6. Case 04 — stablecoin finality (2 min).** Base Sepolia testnet USDC at 6 of 12 confirmations: awaiting finality,
no accounting entry yet. "A chain observation never proves a bank credit."

**7. Case 05 — funding exposure (2 min).** SGD 50,000 advanced → 30,000 repaid by reference → 20,000 outstanding. The
accounting outcome has the advance and the referenced repayment; the receivable nets to the 20,000 actually owed. The
unreferenced SGD 20,000 receipt stays an exception. Open the specialist Funding Desk workflow from the same page.

**8. Audit history (1 min).** Reports › Audit history, filtered by the payment: every action with actor, time and
evidence references — including the approval and the recorded posting.

**9. Reset (30 s).** Settings → Reset to sample (or reset one guided case from the trial page).

**10. Questions (5 min) — then stop talking.**
- When a provider said "paid" and the bank or chain disagreed, how did you find out, and who fixed it?
- How does a reconciled payment reach your ledger today — who prepares the entry, who approves it, which system?
- What did the last difficult case cost in hours, and who owns that budget?
- Which tools have you tried for this, and where did they stop?

**Working today vs not built.** Working in the sandbox: everything above, plus the stateless v1 test API (bridge and
Connect actions via `POST /actions`), and — in the engine and its tests only — a provider adapter framework with three
fictional providers. **Not built:** real providers, real bank statement ingestion, accounting system connections (Xero,
then NetSuite, are planned), AI assistance (designed only), user accounts and server-side storage. The posting rules are
**sandbox rules awaiting your sign-off**. Clearline does not execute payouts, hold funds or keys, lend, make compliance
decisions or post to a ledger.

Do not say "live", "production", "enterprise-ready", "partners" or "customers"; do not compare with named competitors.
If they offer real records: "Up to five redacted historical cases, once we agree scope and secure data handling."
