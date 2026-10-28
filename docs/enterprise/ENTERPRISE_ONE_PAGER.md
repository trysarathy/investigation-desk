# Clearline: stablecoin payments, matched, explained and in your books

## The problem
Businesses paid in USDC or USDT straight to their own wallet get transfers with no invoice reference. Some arrive
wrong: short after an exchange fee, on the wrong network, a counterfeit token. Someone in finance matches each one
to its invoice, works out what went wrong, writes to the customer and types the payment into the accounting
system by hand. [ASSUMPTION: how often, and how many hours it costs, is not yet measured with any customer.]

## What Clearline does today (built and in the code)
- **Payment request per invoice** with a customer payment page: exact amount, token, network, your address, an
  EIP-681 QR code. USDC and USDT **on Ethereum**.
- **Look-alike address check** on that page: a pasted address that starts or ends like yours is stopped and recorded.
- **Checks every transfer it's given**: genuine issuer contract, right network, right address, confirmations,
  issuer freeze, failed transaction; short, over, duplicate and unidentified payments go to a person.
- **Plain-English explanation and a drafted reply** for each problem; counterfeit and wrong-network money can never
  be counted as paid.
- **Posting plan to Xero**: exactly what will post (tx hash, token, network, USD value; fee write-off; overpayment),
  written **only when a person approves**, with an audit log. Built and covered by tests; **not yet run against a
  real Xero organisation**.
- **Investigation desk** for a reported transfer across Ethereum, Tron, BNB Chain, Polygon, Arbitrum, Base and
  Optimism; tested on 52 of 52 held-out real public transfers (`demo/REPORT.md`; our own test, not a customer result).
- Read-only. No custody, no keys, no money movement.

## Delivered with our team (manual during a pilot)
- **Getting transfers in:** Clearline does not watch addresses yet. During a pilot the founder records each
  incoming transfer from its hash (daily, from your wallet's history or an explorer), or you paste it yourself.
- **Marking paid:** in live mode a person confirms each matched payment (the automatic rule is demo-only today).
- **Month-end report:** prepared by the founder from Clearline's records and audit log, as a spreadsheet.
- **Xero setup:** account codes are set in a config file by the founder; there's no settings screen yet.
- **Deletion and offboarding:** done by hand, confirmed in writing (`SECURITY_OVERVIEW.md` §5).

## Roadmap (not built)
Address watching (live detection without a hash) · Tron and other networks for payment pages · sign-in, roles,
SSO · encrypted token storage and a database · QuickBooks Online live test · NetSuite · notifications ·
non-USD invoices · SOC 2 when customers need it.

## The pilot
- **US$300 for 30 days**, then **US$200/month** if you continue; the pilot fee is credited against months 2–4.
  Cancel any time. **Enterprise pricing on request** (self-hosting, multiple entities, security review support).
- A **paid pilot with written success criteria** agreed on day 1 (see `PILOT_PROPOSAL_TEMPLATE.md`), for example:
  every stablecoin payment in the period matched or explained; time to post per payment down by an agreed amount;
  zero wrong postings.
- Invoiced by the founder's sole proprietorship in India (bank transfer, PayPal or Wise).
- Who you work with: one founder, a university student in Singapore. 0 customers today; you'd be one of the first.

## Security summary
Read-only on-chain; no custody; writes to your books only on approval, with an append-only audit log. Honest gaps:
**no sign-in yet** (shared password gate at most), **data and Xero tokens stored as plain JSON** on the host's disk,
**no SOC 2, no penetration test**. One isolated deployment per customer, in the region you choose, or on your own
infrastructure. Details: `SECURITY_OVERVIEW.md`, `SECURITY_QUESTIONNAIRE.md`.
