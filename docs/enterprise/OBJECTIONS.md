# Objections, answered honestly

Facts about other companies are labelled. [VERIFIED] = checked on their own pages (date given). [ASSUMPTION] =
our understanding, not re-checked; confirm before quoting it to a prospect.

## "What about security?"
Say what's true, including the gaps:
- Read-only on-chain. No custody, no wallet keys, no code that can move money (`src/lib/chain/`).
- Writes to your books only when a person approves a specific plan; every posting and refusal is logged.
- **Gaps today:** no individual sign-in (a shared password gate at most), data and Xero tokens stored as plain
  JSON, no SOC 2, no penetration test, one-person operation.
- **What we offer instead:** run it on your own infrastructure, or a dedicated container in your region with an IP
  allow-list; AI off; no live Xero connection in the pilot (a Xero-ready import file your accountant reviews and
  imports); deletion in 10 business days.
- If your policy requires SOC 2 or SSO before any vendor touches finance data, **we're not ready for you yet**, and
  it's better to say so now. We'd like to come back when we are.

## "We'll build it ourselves."
- For checking a single payment, you could: the explorer shows most of it. The work is in the edge cases: counterfeit
  tokens that copy the name, issuer freezes, transfers with several token events, look-alike address poisoning,
  short payments after exchange fees, and posting a short or over payment to the books correctly (fee write-off,
  overpayment line, never two payments for a duplicate). That took 18 diagnosis rules and their tests
  (`src/lib/engine/rules.ts`, `tests/`), tested on 52 held-out real transfers.
- Honest view: if you have an engineering team and stablecoins are core to your business, building can make sense.
  The founding pilot is US$300 for 30 days; it's a cheap way to see the edge cases before you decide.

## "Our gateway does this." (CoinGate, NOWPayments, BitPay, Coinbase Commerce)
- **Where they're enough:** if every customer pays through the gateway's checkout, the gateway already creates the
  invoice, gives a payment address, tracks status and flags under- and overpayments, and gives you its own reports
  and settlement records [ASSUMPTION: true of all four in general; specific features and accounting integrations
  differ, not re-checked]. You probably don't need Clearline for those payments.
- **What we add:** payments that **don't** go through the gateway: customers sending straight to your company
  wallet, wrong network, counterfeit tokens, missing references; and posting them to your books with the tx hash,
  token, network and approver. Clearline is built to sit alongside a gateway, not replace it.
- **Not yet:** Clearline doesn't import gateway reports into the payment-request flow. (The older investigation
  desk imports provider settlement CSVs with column mapping, `src/lib/payments/`, but that isn't wired to the books.)
- Ask: "What share of your stablecoin payments skip the checkout?" If the answer is "almost none", we're not the fit.

## "Bitwave / Request Finance / Cryptio already do this."
- **True, partly.** Bitwave supports stablecoin invoices and receivables and syncs payments with NetSuite, Xero,
  QuickBooks, Sage and more [VERIFIED 28 Oct 2026, bitwave.io]. Request Finance syncs crypto and fiat bills to
  QuickBooks Online, Xero and NetSuite [VERIFIED 28 Oct 2026, help.request.finance]. Cryptio is a crypto
  accounting and sub-ledger platform with ERP integrations [ASSUMPTION: not re-checked].
- They are broader, more mature and certified in ways we aren't [ASSUMPTION about their certifications: check
  each one's trust page].
- **Where we're different (a hypothesis we're testing):** a smaller business paid directly into its own wallet, and
  the payments that arrive wrong: explained in plain English, with the customer reply drafted, and prepared for the
  books correctly (in a pilot, as a Xero-ready import file your accountant reviews). Priced for a small finance team.
- If you already use one of them and it handles your wrong payments, keep it.

## "What about pricing?"
- Founding pilot: **US$300 for 30 days, then US$200/month** (first 10 businesses). Cancel any time.
  Enterprise pricing on request.
- Why pay for a pilot: it's priced so both sides take the success criteria seriously, and it's refunded if we miss
  "every payment matched or explained" or "zero wrong entries in the Xero import file" for reasons on our side.
- Use `ROI_CALCULATOR.md` with their numbers. Honest: below roughly 20–25 payments a month it may not pay for
  itself on time alone [GUESS, from the calculator's assumed inputs].
- Older website copy said pilots are free; that's wrong and is being corrected (PR #40 on `website-fixes`).

## "You're a student / a solo founder."
- True. Clearline is built and run by one person, a university student in Singapore, with 0 customers so far.
  Invoices come from her sole proprietorship in India.
- What that means for you: one person answers your email (first reply within 1 business day, SGT); no uptime SLA;
  if she's unavailable, the service is too.
- What reduces the risk: self-hosting (you keep running it without us), nothing in Clearline holds or moves your
  money, a 30-day term with no lock-in, deletion on request, and source code access in escrow on request.
- What it buys you: direct access to the person who writes the code, and changes in days, not quarters.
