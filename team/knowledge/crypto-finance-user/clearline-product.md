# What Clearline does today (what you are testing)

Internal sources, read 2026-10-31: `company/COMPANY_RULES.md`, `README.md`, `docs/SPEC.md`,
`docs/ACCOUNTING_SYNC.md`, `demo/REQUESTS_DEMO.md`, `demo/WHAT_TO_SAY.md`, `demo/screens/e2e-results.txt`,
`docs/enterprise/OBJECTIONS.md` (branch `enterprise-pack`). Re-read the release notes of the release you
test; this page goes stale with every merge.

## One line
For businesses paid in USDC/USDT: verifies each payment on-chain (read-only), matches it to its invoice,
explains wrong ones in plain English, and, **once a person approves**, posts the entry to the books
(Xero built and in testing; QuickBooks next; NetSuite designed, not built). 0 customers.

## The screens a controller will touch
| Screen | Route | What it does |
|---|---|---|
| At a glance | `/` | The week: requests sent, payments arrived, matched automatically, needs attention |
| Payment request page | `/requests/...` | One invoice: status, transfers, what happened, likely cause (labelled an inference), reply draft, **In your books** (the exact lines that would post) |
| Sender's payment page | `/pay/[publicId]` | What the payer sees: amount, network, address in groups, look-alike address check |
| Books / audit log | `/books` | Connect Xero, import invoices, every posting and every refused approval |
| Investigation desk (older) | `/cases/[id]`, `/investigate`, `/bulk` | Deposit diagnosis D01–D18 for ops analysts |
| Exceptions inbox | `/inbox` | Exceptions with owner, evidence, status |
| Settings | `/settings` | Company rules (tokens, thresholds, policies) |

## Posting rules (from docs/ACCOUNTING_SYNC.md; all tested)
Exact → one payment (tx hash, token, network, USD value, rate source). Short, no decision → partial +
note, invoice open. Short accepted → payment + separate fee write-off. Over → nothing until a person
decides, then invoice amount + separate overpayment line ("To refund" / "Customer credit"). Duplicate →
one payment + one overpayment for refund, never two. Same transfer twice → nothing new. Wrong network,
counterfeit, failed, wrong token → never posted. No reference → nothing until a person confirms.
Non-USD invoice or > 0.5% off par → blocked, post by hand. Lines rounded down to cents.
Approval sends the plan's key; if the plan changed since the page loaded, the server refuses.

## Known gaps a controller will find (say "not yet", never hide)
From WHAT_TO_SAY.md and OBJECTIONS.md:
- No individual sign-in or roles: the approver's name is typed, not verified.
- Data and Xero tokens stored as plain JSON; no SOC 2, no pen test; one-person operation.
- Account codes set in a JSON file, no settings screen.
- No settings screen to switch auto-mark-paid on or off.
- Chains: USDC/USDT on Ethereum in the payment-request flow; Tron detected as wrong network. (The older
  desk covers Tron, Ethereum, BNB Chain for investigation.)
- Gateway reports not imported into the payment-request flow.
- "Time saved" in the demo is an estimate (6 min per auto-match, 20 per exception), not measured.
- No period/close view found in the docs (receipts by period, per-wallet roll-forward). Check each
  release before claiming either way. `[GUESS: from docs only]`

## Claims you must not make (company rule 2)
Never "posts to Xero automatically", "integrated with QuickBooks/NetSuite", "live with customers",
"used by finance teams". Say "once you approve", "Xero first, QuickBooks next".

## Pricing hypothesis (internal, for P2 only)
Pilot US$300 for 30 days, then US$200/month, pilot fee credited against months 2–4; below roughly
20–25 payments a month it may not pay for itself on time alone [GUESS, from ROI_CALCULATOR.md inputs]
[INTERNAL: OBJECTIONS.md]. The website said pilots are free; being corrected. `demo/WHAT_TO_SAY.md` says
"We haven't set pricing" — the two internal docs disagree; flag it, don't resolve it.

## How to run it for a release test
`npm ci && npm run build && npx next start` (demo mode on by default, no keys, no network), open
`http://localhost:3000`, click **Load the demo day**. Desktop 1280×720; phone 390×844. Everything shown is
fictional demo data (hashes start with eight zeros).
