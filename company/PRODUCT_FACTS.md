# What Clearline does today (the one place to check before saying it)

Every employee checks this page before describing the product to anyone, inside or outside.
If a draft, brief, post or proposal says something not on this page, it is wrong until Aashmiin
confirms it. Owner: crypto-protocol-engineer keeps it true after each merged PR; qa-security-engineer
checks it weekly against the code. Last checked 2026-10-31 against `main`.

| Capability | Today | Source |
|---|---|---|
| Check a payment someone sent (by tx hash) | **Tron, Ethereum and BNB Chain** (USDT/USDC), via chain lookups and the diagnosis catalogue D01-D16 | [VERIFIED: docs/SPEC.md §3 "v1 chains"; src/lib/chain/tron.ts, evm.ts] |
| Payment requests (a pay page per invoice) | **Ethereum only.** A payment on Tron or another network to a request is flagged "this request is Ethereum only". Tron payment requests are on the roadmap ("building"), **not shipped** | [VERIFIED: src/lib/requests/check.ts:74; Product roadmap row "Tron USDT payment requests"] |
| Match payments to invoices / explain wrong ones | Yes, with exact identifiers for automatic links; anything ambiguous goes to a person | [VERIFIED: docs/SPEC.md "Matching"] |
| Accounting: Xero | Built, **in testing**; posts only after a person clicks Approve; live Demo Company test still to do | [VERIFIED: Product roadmap rows; docs/ACCOUNTING_SYNC.md] |
| Accounting: QuickBooks | Code exists (`src/lib/accounting/providers/quickbooks.ts`) but **not offered**: "QuickBooks next" | [VERIFIED: file exists; company/COMPANY_RULES.md rule 2 wording] |
| Accounting: NetSuite | Designed, **not built** | [VERIFIED: company/COMPANY_RULES.md] |
| Customers | **0** | [VERIFIED: company/COMPANY_RULES.md] |
| Custody, keys, moving funds | **Never**. Read-only on chain | [VERIFIED: company/COMPANY_RULES.md rule 3] |
| Offer | Founding pilot US$300 for 30 days, then US$200/month, first 10 businesses, paid by invoice. Nothing else (no credits, discounts or free trials) without her approval | [VERIFIED: Settings/Decisions as used by every scheduled task] |

**Known conflicts to fix (Aashmiin's decision):**
- The website on `website-fixes` says "Free during the pilot"; `demo/WHAT_TO_SAY.md` says pricing isn't set. Both contradict the offer above.
- The whitepaper's HARD_QUESTIONS says connecting a customer's real Xero is "not yet" possible, while the pilot template includes a Xero step.

Say it like this: "Clearline checks USDT/USDC payments on Tron, Ethereum and BNB Chain; payment
pages are Ethereum-only for now; Xero is in testing and posts only once you approve."
