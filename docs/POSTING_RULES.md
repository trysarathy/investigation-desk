# Posting rules: what Clearline puts in the books

**Status: Approved by Aashmiin 2026-11-01 for the rules in §9 marked Approved.** Every other rule is still
**DRAFT** and is not built. Approved rules are built as small PRs, each **approval-only** (posting to
Xero/QuickBooks is on the approval-only list, `company/OPERATING_MODEL.md` §2): never auto-merged; each needs her
merge click. Open questions are listed in §10.

- Author: accounting-integrations-engineer · Drafted 2026-11-01 (SGT) · **Version 0.3** (2026-11-02: Aashmiin's
  decision 6, the clearing-account option 2 (hold at cost, IAS 21/IAS 38 basis), recorded in §9; new case **C18**
  (lots, conversion, impairment flag) with five worked SGD examples, **PROPOSED**; R4.5 added; §2, §5, §6, §8 (D21-D24)
  and §10 updated). v0.2 2026-11-01: the five decisions of 1 Nov; clearing-account model; rounding, FX, shortfall and
  finality rules.
- Checked against the code on `origin/main` @ `0c7d9f1` (`src/lib/accounting/rules.ts`, `types.ts`, `engine.ts`,
  `providers/xero.ts`, `src/lib/requests/check.ts`, `src/lib/fixtures/index.ts`), with probes run through the real
  `planPosting`/`approveAndPost` on 2026-11-01 (scratch test in a copy of the repo, deleted after). Where today's code
  differs from a rule, the rule says **Code today: differs (Dn)** and §8 lists every difference.
- Scope: receipts from customers paying sales invoices with USDC or USDT on **Ethereum** (payment requests are
  Ethereum-only today [VERIFIED: build session 2026-10-31, src/lib/requests/check.ts:74]), posted to **Xero** (in
  testing on the Demo Company) and later **QuickBooks Online** (code exists, not offered). NetSuite: design only.
- Labels: [VERIFIED: …] = primary source opened (by whom, when); [ASSUMPTION] = not checked. "Xero OpenAPI 19.1.0" =
  Xero's own spec, `https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml`
  (`info.version: 19.1.0`), saved 2026-11-01 and re-read from that saved copy on 2026-11-01 for this version.
  Accounting-standard points are [ASSUMPTION: secondary] (`team/knowledge/accounting-integrations-engineer/stablecoin-accounting.md`).

## 1. How to read this
Each rule says, in plain accounting language: when it applies, the **debit and credit lines** (to the cent), which
Xero / QuickBooks record makes them, the **date**, the **rounding**, and what **goes to a person instead** (the
**exceptions queue**: nothing posts until a person resolves it).
The worked example is invoice **INV-1042, Brightline Studio, 5,000.00 USD**, paid in USDC on Ethereum. (Fictional
demo data: `src/lib/requests/demo.ts`, request DEMO-1042.) The organisation is USD-base unless the case says otherwise.
"Posts" always means: Clearline prepares the lines, a person clicks **Approve**, and only then are they sent.

## 2. Accounts (the chart Clearline posts to)
| Ref | Account | Type in Xero | What it holds | Status | Code today |
|---|---|---|---|---|---|
| CLR | **Stablecoin clearing** (name suggested; the account code is set **per organisation**, no default) | A non-bank **current asset** account with "Enable payments to this account" on (`Account.EnablePaymentsToAccount: true`). **Not** a bank account | Stablecoin receipts, at the USD value posted, until the accountant moves or classifies them | **Approved** (decision 1) | `walletAccountCode` defaults to `090`, one account for everything, never validated (D8) |
| AR | Accounts Receivable | System (Debtors) | What the customer owes | via the invoice | via the invoice |
| SHF | **Shortfall account** (chosen by the organisation; no default) | Whatever the organisation chooses (expense, or a sales-reduction account) | Shortfalls a person accepted as settled | **Approved** (decision 2) | `feeAccountCode` defaults to `404` (Bank Fees) (D16) |
| RND | **Rounding** (code set per organisation) | An account the organisation chooses (see Q-R3) | Rounding lines of at most 0.01 per invoice | **Approved** (decision 3) | not used (D3) |
| FXG | Realised currency gains/losses | System (`REALISEDCURRENCYGAIN`) [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01, `Account.SystemAccount`] | FX differences Xero books itself | **Approved** (decision 4: Xero's own rate) | Xero books it; code never reads base currency (D17) |
| CRD | Customer credit (overpayment) | Xero overpayment on the contact | Money received above the invoice | DRAFT; record type open (Q-C5) | received as `RECEIVE-OVERPAYMENT` into the wallet account (D18) |
| GAS | Network fees | Expense | Gas the business pays when **it** sends tokens (refunds) | DRAFT | not used |
| SUS | Stablecoin suspense | Current asset | Genuine money no rule can place (wrong token / network) until a person decides | DRAFT | not used |
| DGN | **Gain on stablecoin conversion** (name suggested; code set per organisation, no default) | Other income (not revenue) | Realised gain when held coins are converted or paid out (C18) | **PROPOSED** (decision 6) | not used (D24) |
| DLS | **Loss on stablecoin conversion** (code set per organisation; may be the same code as DGN) | Expense | Realised loss when held coins are converted or paid out (C18) | **PROPOSED** (decision 6) | not used (D24) |
| IMP | **Impairment loss: stablecoins** (code set per organisation) | Expense | Prepared period-end impairment, and any approved reversal (C18) | **PROPOSED** (decision 6) | not used (D24) |
| AIM | **Accumulated impairment: stablecoins** (code set per organisation) | Asset (contra; credit balance), next to CLR | Impairment taken on lots still held | **PROPOSED** (decision 6) | not used (D24) |
| BNK | The organisation's own SGD (base-currency) bank account | Bank | Base-currency proceeds of a conversion; the person picks it on the conversion | existing org account; Clearline never posts to it (C18) | not used |

**Decision 1 (Aashmiin, 2026-11-01): the stablecoin wallet is not a cash equivalent.** So Clearline never posts a
stablecoin receipt to a bank account and never suggests "Cash at bank". Receipts post to CLR.
What that means in Xero:
- A Payment may be applied to a non-bank account only if that account has `EnablePaymentsToAccount` ("describes
  whether account can have payments applied to it") [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01, `Account`]. Whether
  Xero accepts an ACCREC Payment into such an account in practice: [ASSUMPTION: check in the Demo Company, task D4.4].
- Before any plan is `ready`, Clearline reads `GET /Accounts` (scope `accounting.settings` / `accounting.settings.read`
  [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01, `/Accounts` security]) and checks the CLR code: exists, `Status`
  ACTIVE, `Class` ASSET, `Type` is **not** `BANK`, `EnablePaymentsToAccount` true. Any check fails or can't be read →
  `blocked`: "Set a Stablecoin clearing account in Settings (a current-asset account with payments enabled, not a bank
  account)."
- In a non-USD-base organisation the CLR balance is in the base currency (see C15); the USD amount and the token
  amount are on every line's reference and description, which is what the clearing reconciliation (§6) uses.
- QuickBooks: Payment deposited to an Other Current Asset account named Stablecoin clearing [ASSUMPTION: QBO
  `DepositToAccountRef` accepting that account type not checked].

**Decision 6 (Aashmiin, 2026-11-02, option 2): stablecoins held are carried at cost, not revalued.** CLR is also where
the coins sit while held. Each receipt is a **lot** with its base-currency (SGD) cost on the day of receipt;
conversions and payments out get a prepared manual journal with the realised gain or loss; period-end brings only an
impairment **flag**. Details, accounts DGN/DLS/IMP/AIM and five worked examples: **C18 (PROPOSED)**. An organisation
that prefers a separate "Stablecoins held at cost" account can be offered one later (Q-L5); until then CLR is the lot
account, so the token units in its lots reconcile to the wallet (§6).

## 3. Rules that apply to every posting
**R1 Approval.** Nothing is sent to the books until a named person clicks Approve on the exact plan they saw (the
plan's key must match). A changed plan must be approved again. *Code today: matches* — **but** the approval can be
forged from another website today (SECURITY_GAPS #2, D11), so live posting must stay off until that is fixed. DRAFT.

**R2 Date.** The posting date of every line is **the calendar date of the transfer's block time in the accounting
organisation's own timezone** (Xero: `Organisation.Timezone`; QuickBooks: the company's timezone). Not UTC, not
Singapore hard-coded, not when Clearline saw it, not when it became final, not when someone approved it.
Example: block time 2026-10-31 23:30 UTC = **1 Nov 07:30 SGT** → a Singapore org posts **2026-11-01 (November)**;
a New York org posts 2026-10-31. If the block time is unknown → don't post. If the date falls on or before the
org's lock date → a person chooses; Clearline never moves a date by itself.
*Code today: differs (D1, D5):* posts the **UTC date** (`rules.ts:137`); falls back to the time Clearline first saw the
transfer when the block time is missing; no lock-date check (D6). DRAFT (signed together with ADR 0002).

**R3 Amounts and rounding.** Token amounts are exact (6 decimals for USDC on Ethereum [VERIFIED: crypto-protocol-engineer
2026-10-29/31, Circle's address page and an on-chain `decimals()` read]); the books take cents. Never floating-point
arithmetic; amounts stay exact decimal strings until the request body.
- (a) A **payment** line is rounded **down** to the cent against the running total, so the books never show more
  received than arrived; when the invoice is covered exactly, the last line closes it exactly. *Code today: matches.* DRAFT.
- (b) A **shortfall** line is the cents needed to close the invoice. *Code today: matches.* DRAFT.
- (c) An **overpayment** line is rounded down. *Code today: matches.* DRAFT.
- **(d) Rounding line — Approved (decision 3).** Per invoice, at most **one rounding line of at most 0.01**:
  `rounding = invoice amount − Σ payment lines` (in cents, after (a)).
  - `rounding = 0.00` → no line; the payments close the invoice.
  - `0.00 < rounding ≤ 0.01` → one line **Dr RND / Cr AR** for that amount, dated like the last transfer; the invoice
    closes; still needs Approve.
  - `rounding > 0.01` → **not rounding.** Under decision 3 "any larger difference goes to the exceptions queue (no
    posting)": nothing posts until a person decides (record as partial C2, accept the shortfall C3, or ask for the
    balance). See Q-R1 for how far this reaches.
  - Received more than the invoice by **less than 0.01** (e.g. 0.004 USDC): the excess rounds down to 0.00, so there is
    no line and no decision; the invoice closes with the payment; the token amount is in the reference; the residual
    stays in the wallet and shows in the clearing reconciliation (§6). Over by 0.01 or more is an overpayment (C5); see Q-R2.
  *Code today: differs (D2, D3, D20).*

**R4 Value and FX — Approved (decision 4).**
1. **Stablecoin → USD at par:** 1 USDC = 1 USDT = **1.00 USD**. The USD amount of every line is the token amount (after
   R3) × 1.00. A market price is used **only to check** the peg, never to value the line.
2. **Depeg check:** the token's USD price at the transfer's block time, from the price source in Q-FX1. If it is more
   than **0.5%** from par (|price − 1.00| > 0.005), the receipt is an **exception: no posting**. Exactly 0.5% posts.
   Examples: 0.995 → posts at par; 0.994 → exception; 1.005 → posts at par; 1.0051 → exception.
   Price unavailable → proposed: exception, never "assume par" (Q-FX2).
3. **USD → the organisation's base currency: Xero's own rate.** Clearline sends the USD amount and **no**
   `CurrencyRate`; Xero converts at its rate for the posting date (R2) and books any realised FX difference itself
   (C15). Clearline then reads the Payment back and records the rate Xero used on the posted line.
   Xero's spec: `Payment.CurrencyRate` "Exchange rate when payment is received. Only used for non base currency
   invoices and credit notes" [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01]; for bank transactions and prepayments
   an unspecified rate means "the XE.com day rate" (or the user-defined rate) [VERIFIED: same]. What Xero does when a
   Payment omits `CurrencyRate` is not stated for Payments [ASSUMPTION: check in the Demo Company, task D8.2]. The
   Accounting API has no exchange-rate endpoint (only `/Currencies`) [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01,
   path list], so the base-currency amount cannot be shown before approval; the plan says "converted by Xero at its
   rate for <date>" (Q-FX3).
4. Every line states the USD rate and its source ("par 1.00 USD; peg check <price> from <source> at <time>").
5. **After receipt: no revaluation (decision 6, 2026-11-02, option 2).** Clearline never revalues CLR at period end,
   for FX or for price. The SGD amount booked on receipt is the lot's cost; it changes only when coins leave (a
   prepared, approved conversion journal) or when a person approves a prepared impairment entry (C18).
*Code today: differs (D4, D4b, D17; C18: D21-D24).*

**R5 When money counts — Approved for Ethereum (decision 5).** Only transfers that are genuine (official token
contract), successful, on the network the invoice asked for, to the invoice's receiving address, and **final**.
- **Ethereum: final = the transfer's block is at or below the block returned by `eth_getBlockByNumber("finalized")`**,
  and the block hash at that height is still the transfer's block hash. **Never a fixed confirmation count.** The
  `finalized` tag is "the most recent crypto-economically secure block, cannot be re-orged outside of manual
  intervention driven by community coordination" [VERIFIED: crypto-protocol-engineer 2026-10-29,
  github.com/ethereum/execution-apis `src/schemas/block.yaml`]; it usually takes ~2 epochs ≈ 12.8 min [VERIFIED:
  crypto-protocol-engineer 2026-10-29, as quoted by the OP Stack docs `transaction-finality.mdx`].
- If the `finalized` block can't be read → **waiting** ("Clearline couldn't check that this payment is final"), never
  "assume final". A block count may still be **shown** ("12 of 12 confirmations") but never gates posting.
- Finality does not change the date: R2 uses the block time, not the time the block became final.
  Example: block time 2026-10-31 23:30:11 UTC, finalized about 23:43 UTC → the plan becomes `ready` after 23:43;
  a Singapore org's date is still **2026-11-01**.
- **Other chains: undecided (Q-F1).** Nothing on another chain posts until Aashmiin decides what final means there.
*Code today: differs (D13):* `rules.ts:110` counts `confirmations >= threshold`, with threshold 12 from the sample
settings (`src/lib/fixtures/index.ts:36`, via `requests/check.ts:23`); the word `finalized` appears nowhere in `src/`.

**R6 Sandbox only.** Until Aashmiin switches on live posting in writing, Clearline posts only to an organisation
whose `IsDemoCompany` is true (Xero) or to a QuickBooks sandbox company. A pilot gets a Xero-ready import file
that the customer's accountant reviews and imports (her decision, 31 Oct 2026). *Code today: differs (D6).* DRAFT.

**R7 Never twice, never silently changed.** One line per transfer, ever; a retry after any failure re-sends each
unposted line with **the same idempotency key it had on the first attempt**. A wrong entry is corrected by a new,
approved entry (or a person deletes it in Xero); Clearline never edits or deletes posted records by itself.
*Code today: differs (D19):* after a partial post the remaining lines get a **new** key (measured below). DRAFT.

**R8 Goes to the exceptions queue instead of posting** (the plan shows why): anything flagged (wrong token, wrong
network, counterfeit, look-alike, failed); no or ambiguous reference; **not yet final** (R5); overpaid until refund/keep
is chosen; a difference above 0.01 with no decision (R3d); non-USD invoice; **price more than 0.5% off par, or price
unavailable** (R4); unknown timezone, block time, lock date or account; **CLR, SHF or RND code missing or failing the
checks in §2**; the org is not a demo company (R6).

## 4. Receipts: the cases
Format: **lines** (Dr = debit, Cr = credit) · Xero record · QuickBooks record · result for the invoice. Every example
balances (Σ Dr = Σ Cr) and is dated per R2.

### C1 Exact payment
5,000.00 USDC arrives for INV-1042, final.
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CLR Stablecoin clearing | 5,000.00 | |
| 2 | AR Brightline Studio (INV-1042) | | 5,000.00 |
Xero: one Payment on INV-1042, `Account` = CLR code, Reference "USDC on Ethereum · tx 0x… · @1.00 USD". QuickBooks:
Payment linked to the invoice, deposited to CLR. Invoice: **paid**. *Code today: differs only in the account (D8) and
date (D1).* DRAFT.

### C2 Partial payment (short by more than 0.01)
4,950.00 USDC arrives. The difference (50.00) is above 0.01, so it goes to the **exceptions queue first** (R3d,
decision 3). When a person chooses "record as partial" or "ask for the balance":
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CLR | 4,950.00 | |
| 2 | AR Brightline Studio | | 4,950.00 |
Plus a note on the invoice history: "4,950.00 of 5,000.00 USDC received on Ethereum. Short by 50.00." Invoice: **open,
50.00 due**. QuickBooks has no invoice history: the note goes in the payment's private note.
*Code today: differs (D20):* posts the partial straight away with no decision (probe: status `ready`, lines
`payment 4950.00` + `note`). DRAFT; Q-R1.

### C3 Shortfall accepted as settled — Approved (decision 2)
4,950.00 arrives (e.g. the payer's exchange took 50.00); a person clicks "accept as settled".
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CLR | 4,950.00 | |
| 2 | SHF the organisation's chosen shortfall account | 50.00 | |
| 3 | AR Brightline Studio | | 5,000.00 |
- **No automatic GST.** The shortfall line carries no tax (Xero `LineAmountTypes: NoTax`); Clearline never computes
  or reverses GST on it.
- **Flagged for the accountant.** The plan, the invoice history note and Clearline's accountant list say: "Shortfall
  of 50.00 accepted as settled by <person> on <date>. Posted to <SHF code> with no GST. For your accountant to review
  the GST treatment." (Mechanism: Q-SF2.)
- SHF is chosen by the organisation; no default. Not set or failing the account checks → `blocked` (R8).
Xero: Payment 4,950.00 to CLR + a credit note (ACCRECCREDIT, NoTax, one line to SHF) 50.00 allocated to INV-1042.
QuickBooks: Payment + credit memo (write-off item mapped to SHF) linked by a zero payment. Invoice: **paid**. Only a
person can accept a shortfall; there is no automatic tolerance beyond the 0.01 rounding line (C7).
*Code today: differs (D16):* posts the line to `feeAccountCode` (default `404` Bank Fees) with NoTax (matches "no GST"),
but has no "flag for the accountant".

### C4 Network fees: borne by the payer vs. by us
- **Gas on the customer's transfer** (ETH) is paid by the sender from their own native coin; it never reduces the
  USDC that arrives. **Nothing posts** for it.
- **A fee taken out of the amount** (exchange withdrawal fee) shows up as a shortfall: exceptions queue → C2 or C3.
- **Gas the business pays** happens only when the business sends tokens (refund C13). Lines: Dr GAS / Cr "ETH holdings".
  Clearline does not see or post these; a person posts them. DRAFT.

### C5 Overpaid (one transfer above the invoice by 0.01 or more)
5,000.50 arrives. Nothing posts until a person chooses **refund** or **keep as credit**; the target lines are:
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CLR | 5,000.50 | |
| 2 | AR Brightline Studio (INV-1042) | | 5,000.00 |
| 3 | CRD Brightline Studio overpayment ("To refund" or "Customer credit") | | 0.50 |
**Open (Q-C5):** today the excess is a Xero `BankTransaction` of Type `RECEIVE-OVERPAYMENT`, which requires a
`BankAccount` [VERIFIED: Xero OpenAPI 19.1.0 read 2026-11-01, `BankTransaction.required`]. With CLR not a bank account
that record likely can't be used [ASSUMPTION: not tried in the Demo Company]. Until Q-C5 is decided: line 1 posts only
5,000.00 with line 2 (Payment to CLR), and the 0.50 excess goes to the exceptions queue for a person to record.
Invoice: **paid**. *Code today: differs (D18).* DRAFT.

### C6 Paid twice (duplicate)
Two transfers of 5,000.00. As C5 with the second transfer as the excess: Dr CLR 10,000.00 / Cr AR 5,000.00 / Cr CRD
5,000.00. **Never two payments on one invoice.** A person decides first; the excess record follows Q-C5. DRAFT.

### C7 Differences under one cent — Approved (decision 3)
Tokens have 6 decimals; the books have 2. Rule R3d.
| Received | Lines | Invoice |
|---|---|---|
| 5,000.004 (over 0.004) | Dr CLR 5,000.00 / Cr AR 5,000.00. No other line; reference says "5,000.004 USDC received" | paid |
| 4,999.995 (short 0.005) | Dr CLR 4,999.99 / **Dr RND 0.01** / Cr AR 5,000.00 (Σ Dr 5,000.00 = Σ Cr) | paid |
| 4,999.99 (short 0.01) | Dr CLR 4,999.99 / **Dr RND 0.01** / Cr AR 5,000.00 | paid |
| 4,999.989 (short 0.011) | Payment would be 4,999.98, rounding 0.02 > 0.01 → **exceptions queue, nothing posts** | open, 5,000.00 due until a person decides |
Xero: Payment to CLR + a credit note (ACCRECCREDIT, NoTax, one line to RND) for 0.01 allocated to the invoice, same date
as the last transfer. QuickBooks: credit memo to RND linked like C3.
*Code today: differs.* Probe on `0c7d9f1`, 1,000.00 invoice: over 0.004 → `needs_decision` with lines `payment 1000.00`
+ `overpayment 0.00` (D2); short 0.005 → `ready`, `payment 999.99` + note, invoice left open (D3); short 0.011 → `ready`,
`payment 999.98` + note (D20).

### C8 Several transfers for one invoice (rounding across lines)
333.333333 then 666.666667 arrive for a 1,000.00 invoice: Dr CLR 333.33 / Cr AR 333.33 (date of the first transfer),
then Dr CLR 666.67 / Cr AR 666.67 (date of the second); Σ = 1,000.00, invoice closes, no rounding line.
333.333333 then 666.661 arrive (received 999.994333): Dr CLR 333.33 / Cr AR 333.33, then Dr CLR 666.66 / Cr AR 666.66,
then **Dr RND 0.01 / Cr AR 0.01** dated like the second transfer (one rounding line per invoice, R3d). Σ Dr = Σ Cr =
1,000.00. *Code today: first example matches; second differs* (probe: `333.33`, `666.66` + note, invoice open; D3). DRAFT,
except the rounding line (Approved under R3d).

### C9 Wrong token (e.g. genuine USDT sent to a USDC request)
Real money arrived, but not what was asked. **Never posted automatically.** A person decides: ask for the right token
and return this one, or accept it; if accepted, the person posts by hand (Dr CLR, or SUS until decided / Cr AR).
*Code today: matches* (never posted; no suspense account). DRAFT.

### C10 Wrong network (e.g. USDT sent on Tron to an Ethereum request)
**Never posted automatically, even if a person accepts it.** *Code today: matches.* DRAFT.

### C11 Look-alike address (address poisoning)
The money **never reached the business**. **Nothing posts**; INV-1042 stays open for 5,000.00; Clearline explains it.
*Code today: matches.* DRAFT.

### C12 Counterfeit token or failed transaction
Nothing of value arrived. **Never posted.** *Code today: matches.* DRAFT.

### C13 Refund of an overpayment
Clearline never sends money. When the business sends the 0.50 back itself, a person records it:
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CRD Brightline Studio overpayment | 0.50 | |
| 2 | CLR | | 0.50 |
| 3 | GAS Network fees | (gas in USD) | |
| 4 | ETH holdings | | (gas) |
Date: the refund transfer's block date in the org timezone. *Code today:* not posted by Clearline. DRAFT; Q-C13.

### C14 One transfer for several invoices
**Proposed:** a person confirms the split; then Dr CLR 5,000.00 / Cr AR (INV-1041) 3,000.00 / Cr AR (INV-1042) 2,000.00,
as two payments with the same tx hash and date. Never split by guessing. *Code today: differs (D15).* DRAFT.

### C15 Currencies (FX) — Approved (decision 4) for USD invoices; non-USD invoices still to a person
- **USD invoice, USD-base org:** C1-C14 as written; rate 1.00, no FX.
- **USD invoice, SGD-base org.** The token is valued at par (5,000.00 USDC = 5,000.00 USD). Clearline sends a Payment
  of 5,000.00 USD to CLR with no `CurrencyRate`; Xero converts at its own rate for the posting date and books the FX
  difference. Illustrative only (**rates are made up**): invoice dated 2026-10-15 at 1 USD = 1.3000 SGD → AR SGD
  6,500.00; receipt dated 2026-11-01 at 1 USD = 1.2900 SGD:
  | | Account | Dr (SGD) | Cr (SGD) |
  |---|---|---|---|
  | 1 | CLR | 6,450.00 | |
  | 2 | FXG Realised currency loss | 50.00 | |
  | 3 | AR Brightline Studio (INV-1042, USD 5,000.00) | | 6,500.00 |
  Xero computes and rounds the SGD amounts; Clearline does not round in the base currency (no double rounding). After
  posting, Clearline reads the Payment back and records Xero's rate on the line. Before posting: USD must be an enabled
  currency (`GET /Currencies`) and the org's `BaseCurrency` read (`GET /Organisation`), else `blocked`.
  How Xero quotes the rate (USD per SGD or SGD per USD): [ASSUMPTION: check in the Demo Company; the spec's example is
  just "0.7500"].
- **Depeg:** a price more than 0.5% from par → exceptions queue (C17), whatever the base currency.
- **Invoice in SGD (or any non-USD currency):** **to a person.** *Code today: matches* (blocked). Q-C15b.
*Code today: differs (D17):* sends no `CurrencyRate` (as the rule wants) but never reads `BaseCurrency` or
`/Currencies`, and doesn't record the rate Xero used.

### C16 No reference, ambiguous, or not yet final
Nothing posts until a person confirms which invoice the money pays (then C1-C8), or until the transfer is final (R5).
*Code today: matches for the reference; differs for finality (D13).* DRAFT.

### C17 Token off par — Approved (decision 4)
USDC priced at 0.994 USD at the block time: more than 0.5% from par → **exceptions queue, no posting**; a person posts
by hand at a rate they state. 0.995 → posts at par. Price unavailable → exceptions queue (proposed, Q-FX2).
*Code today: differs (D4):* the threshold logic matches (probe: 0.995 and 1.005 → `ready`; 0.994 and 1.0051 →
`blocked`) but no price source is ever passed (`service.ts` uses `parPrice`), so it never triggers.

### C18 Holding stablecoins: lots, conversion, impairment — PROPOSED (decision 6, option 2)
**PROPOSED — awaiting Aashmiin's sign-off and a qualified accountant's review.** Not built (D21-D24). Applies to an
organisation whose base currency is not USD (worked in SGD). In a USD-base organisation the same rules apply with every
rate 1.00, so a conversion of USDC to USD at par gives no gain or loss.

**In plain words.**
- **Every journal here is approval-only.** Clearline prepares the lines and shows them; a person clicks Approve on the
  exact lines; only then are they sent (R1). In the Demo Company only, until live posting is switched on (R6); a pilot
  gets them in the import file.
- **Clearline never** auto-posts an impairment or its reversal, **never** revalues CLR at period end (no FX
  revaluation, no move up to market: R4.5), never posts to the bank account (the person reconciles the bank deposit),
  and never picks lots by guessing (the configured method decides, and the plan shows which units leave).
- Clearline only sees the coins leave on-chain. The base-currency **proceeds** come from the exchange or OTC
  confirmation, which a person enters; no proceeds entered → nothing is prepared.

**Accounting basis** (decision 6; for the accountant to confirm). None of this was opened this run: ifrs.org could not be
reached from this session, so every point is an assumption from the standards as commonly read.
- Held stablecoins are treated as a **non-monetary intangible asset at cost** (IAS 38 cost model: cost less accumulated
  amortisation and impairment) [ASSUMPTION: IAS 38 para 74, not opened]. With an indefinite useful life they are not
  amortised but are tested for impairment under IAS 36, at least annually and whenever there is an indication
  [ASSUMPTION: IAS 38 paras 107-108, IAS 36 para 10, not opened]. The revaluation model is not used.
- A non-monetary item measured at historical cost in a foreign currency stays at the rate on the date of the
  transaction, so there is **no period-end FX revaluation** [ASSUMPTION: IAS 21 para 23(b), not opened]. When such an
  item's carrying amount is the lower of cost and recoverable amount, the recoverable amount is translated at the rate
  on the date it is measured; a fall in USD/SGD can therefore show up **as an impairment**, not as an FX loss
  [ASSUMPTION: IAS 21 para 25, not opened].
- Recoverable amount is the higher of fair value less costs of disposal and value in use [ASSUMPTION: IAS 36 para 18,
  not opened]. Clearline's "market value" (below) ignores costs of disposal, so it is only a **flag of a possible
  impairment**; the accountant decides the amount.
- An impairment loss on an asset other than goodwill may be reversed, but only up to the carrying amount the asset
  would have had with no impairment (here, its cost, as nothing is amortised), and in a cost-model asset the reversal
  goes to profit or loss [ASSUMPTION: IAS 36 paras 114, 117, 119 and 124 (goodwill never reversed), not opened]. So
  the cost model **never** takes the asset above cost.
- The gain or loss on disposal is net proceeds less carrying amount, in profit or loss, and is not revenue
  [ASSUMPTION: IAS 38 paras 113-114, not opened].
- IAS 38 names no cost formula; FIFO or weighted average is borrowed from IAS 2 by analogy [ASSUMPTION: IAS 2 para 25,
  not opened]. The method must be a written, consistent policy.
- **Why this needs the accountant's review.** The IFRIC agenda decision of June 2019 ("Holdings of cryptocurrencies",
  IAS 2 or IAS 38, not cash, not a financial asset) was scoped to a cryptocurrency **not issued by a jurisdictional
  authority or other party** and giving **no contract** between holder and another party. USDC and USDT have an issuer
  and redemption terms, so they are outside its literal scope [ASSUMPTION: not reopened this run; `docs/research/H2.md`
  §1 records the quotes as VERIFIED by accounting-integrations-engineer 2026-11-02,
  https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf].
  A holder with a contractual right to redeem at par may instead hold a **monetary financial asset** (IAS 32 / IFRS 9),
  retranslated at the closing rate every period [ASSUMPTION: secondary, KPMG and ICAEW summaries, copied from
  `stablecoin-accounting.md`]. If the accountant reaches that view, decision 6 must be revisited, not patched.

**The lot rule.**
1. **Every receipt is a lot**: token, network, wallet, tx hash + log index, units (exact, 6 dp), date (R2, org
   timezone), and **SGD cost = the SGD amount the receipt actually booked to CLR** (Xero's rate for that date under
   decision 4, read back from the posted Payment; Q-L1). Coins acquired another way (e.g. bought with SGD by the
   business) are a lot at the SGD paid, recorded by a person.
2. **Which units leave: FIFO by default** (oldest lot first), per token per wallet (Q-L8); the organisation may choose
   weighted average instead. The method is set once and shown on every plan; changing it is a policy change for the
   accountant, never per transaction.
3. **Cost leaving, rounding:** for part of a lot, cost leaving = the lot's remaining cost × units leaving ÷ the lot's
   remaining units, rounded **half-up to 0.01 SGD once**. The last units of a lot take its whole remaining cost, so a lot
   always empties to 0.00 (no drift). Any accumulated impairment on those units is released in the same proportion.
4. **Gain or loss = proceeds − (cost leaving − impairment released)**, exact in cents (no second rounding). Positive →
   Cr DGN; negative → Dr DLS.
5. **Market value at period end** (for the flag only) = units held × the token's USD price (peg check source, Q-FX1) ×
   the closing USD/SGD rate (source Q-L2), rounded half-up to 0.01 once per lot.
6. **Date:** a conversion journal is dated the trade date on the exchange/OTC confirmation, in the org timezone (Q-L6);
   an impairment entry is dated the period-end date.

**Illustrative rates [ILLUSTRATIVE rates, not market data].** The same made-up rates as `docs/research/H2.md` §3, plus
three added for (b), (c) and the reversal. USDC = 1.00 USD on every day (within the 0.5% band, R4.2). No fees, no GST.

| Day (org timezone) | SGD per 1 USD | Used in |
|---|---|---|
| 1 | 1.3500 | Lot A acquired |
| 5 | 1.3400 | Invoice INV-1042 raised |
| 10 | 1.3300 | INV-1042 paid in USDC: Lot B |
| 15 | 1.3450 (or 1.3200 for (c)) | (b), (c) conversion proceeds |
| 20 | 1.3200 | (d) conversion proceeds |
| 30 (period end) | 1.3100 | (e) impairment flag |
| 40 | 1.3200 | (e) sale after impairment |
| 60 (next period end) | 1.3400 | (e) reversal flag |

**Lot A (opening, for (d)):** 10,000 USDC acquired day 1 at 1.3500 = **SGD 13,500.00** (in H2 bought with SGD:
Dr CLR 13,500.00 / Cr BNK 13,500.00, a person's entry; a USD invoice raised and paid on day 1 would give the same lot
with no FX difference).

#### (a) Receipt of USDC against a USD invoice (SGD-base company) — creates Lot B
INV-1042, USD 5,000.00, dated day 5. 5,000 USDC arrives day 10, final. The invoice line is Xero's own, not Clearline's;
the receipt is C15 (Payment of USD 5,000.00 to CLR, no `CurrencyRate`; Xero converts and books the FX on the receivable).

| Day | | Account | Dr SGD | Cr SGD | Note |
|---|---|---|---|---|---|
| 5 | 1 | AR Brightline Studio (INV-1042, USD 5,000.00) | 6,700.00 | | 5,000 × 1.3400 (Xero) |
| 5 | 2 | Revenue | | 6,700.00 | |
| | | **Total day 5** | **6,700.00** | **6,700.00** | |
| 10 | 1 | CLR Stablecoin clearing | 6,650.00 | | 5,000 × 1.3300: **Lot B cost** |
| 10 | 2 | FXG Realised currency loss (on the receivable) | 50.00 | | 6,700.00 − 6,650.00; Xero books it |
| 10 | 3 | AR Brightline Studio (INV-1042) | | 6,700.00 | invoice paid |
| | | **Total day 10** | **6,700.00** | **6,700.00** | |

**Lot B:** 5,000.000000 USDC, day 10, cost **SGD 6,650.00** (1.3300 per USDC). The 50.00 is an FX difference on the
receivable (decision 4), not a gain or loss on the coin. Xero's `CurrencyRate` is "[Foreign Currency] PER [Base
Currency]", rounded to 6 dp [VERIFIED: accounting-integrations-engineer 2026-11-02,
https://developer.xero.com/documentation/best-practices/data-integrity/multicurrency]: 0.751880 here, and
5,000 / 0.751880 = 6,650.0027 → 6,650.00 (my arithmetic). On large amounts the 6-dp rate can move a cent, so the lot
takes whatever SGD amount Xero actually booked, never a recomputed one.

#### (b) Conversion to SGD at a gain (one lot)
An organisation whose only lot is Lot B sells all 5,000 USDC on day 15; the bank receives **SGD 6,725.00** (1.3450).

| | Account | Dr SGD | Cr SGD | Note |
|---|---|---|---|---|
| 1 | BNK Bank SGD | 6,725.00 | | proceeds (the person's bank deposit) |
| 2 | CLR Stablecoin clearing | | 6,650.00 | Lot B, all 5,000 units, at cost |
| 3 | DGN Gain on stablecoin conversion | | 75.00 | 6,725.00 − 6,650.00 |
| | **Total** | **6,725.00** | **6,725.00** | |

In Xero: the person reconciles the bank deposit as Receive Money in BNK coded to CLR (6,725.00); Clearline prepares one
manual journal **Dr CLR 75.00 / Cr DGN 75.00** for approval. CLR after: 6,650.00 − 6,725.00 + 75.00 = **0.00**; Lot B
empty. (Xero manual journal lines are signed, debits positive, credits negative [ASSUMPTION: pack entry,
`journal-entry-patterns.md`, Xero OpenAPI `ManualJournalLine.LineAmount`; whether the bank-deposit-plus-journal split
works as written: check in the Demo Company].)

#### (c) Conversion to SGD at a loss (one lot)
The same, but the bank receives **SGD 6,600.00** (1.3200).

| | Account | Dr SGD | Cr SGD | Note |
|---|---|---|---|---|
| 1 | BNK Bank SGD | 6,600.00 | | proceeds |
| 2 | DLS Loss on stablecoin conversion | 50.00 | | 6,650.00 − 6,600.00 |
| 3 | CLR Stablecoin clearing | | 6,650.00 | Lot B, all 5,000 units |
| | **Total** | **6,650.00** | **6,650.00** | |

Manual journal prepared: **Dr DLS 50.00 / Cr CLR 50.00**. CLR after: 6,650.00 − 6,600.00 − 50.00 = **0.00**.

#### (d) Partial conversion across two lots (FIFO)
Held: Lot A 10,000 USDC, cost 13,500.00; Lot B 5,000 USDC, cost 6,650.00 (CLR 20,150.00). Day 20: 12,000 USDC sold;
the bank receives **SGD 15,840.00** (1.3200). (Same numbers as H2.md §3 step (c).)

| Lot | Units leaving | Cost leaving | Units left | Cost left |
|---|---|---|---|---|
| A (day 1) | 10,000 (all) | 13,500.00 (whole lot) | 0 | 0.00 |
| B (day 10) | 2,000 of 5,000 | 6,650.00 × 2,000 ÷ 5,000 = 2,660.00 | 3,000 | 3,990.00 |
| **Total** | **12,000** | **16,160.00** | **3,000** | **3,990.00** |

| | Account | Dr SGD | Cr SGD | Note |
|---|---|---|---|---|
| 1 | BNK Bank SGD | 15,840.00 | | proceeds |
| 2 | DLS Loss on stablecoin conversion | 320.00 | | 16,160.00 − 15,840.00 |
| 3 | CLR Stablecoin clearing (Lot A) | | 13,500.00 | |
| 4 | CLR Stablecoin clearing (Lot B, 2,000 units) | | 2,660.00 | |
| | **Total** | **16,160.00** | **16,160.00** | |

Manual journal prepared: **Dr DLS 320.00 / Cr CLR 320.00**. CLR after: 20,150.00 − 15,840.00 − 320.00 = **3,990.00** =
Lot B's remaining cost. With **weighted average** instead: 20,150.00 × 12,000 ÷ 15,000 = 16,120.00 leaves, loss
**280.00**, 4,030.00 stays; same total over (d) + (e), split differently.

#### (e) Period-end impairment flag (prepared, approval-only, never auto-posted)
Day 30 is the period end. Held: Lot B 3,000 USDC, carrying amount 3,990.00. Market value = 3,000 × 1.00 USD × 1.3100 =
**3,930.00**, below carrying amount by **60.00** → Clearline shows **"Possible impairment: market value 3,930.00 is
below carrying amount 3,990.00 (Lot B). For your accountant."** and prepares:

| | Account | Dr SGD | Cr SGD | Note |
|---|---|---|---|---|
| 1 | IMP Impairment loss: stablecoins | 60.00 | | 3,990.00 − 3,930.00 |
| 2 | AIM Accumulated impairment: stablecoins | | 60.00 | recorded against Lot B |
| | **Total** | **60.00** | **60.00** | |

Nothing posts unless a person approves it (or edits the amount to the accountant's recoverable amount and approves
that). After approval: CLR 3,990.00, AIM (60.00), carrying amount **3,930.00**. Lot B keeps its cost of 3,990.00; the
impairment is held separately so cost is never lost.

*Sale after impairment (day 40):* all 3,000 sold for **SGD 3,960.00** (1.3200). Dr BNK 3,960.00 + Dr AIM 60.00 =
**4,020.00**; Cr CLR 3,990.00 + Cr DGN 30.00 = **4,020.00**. Manual journal prepared: Dr AIM 60.00 / Cr CLR 30.00 /
Cr DGN 30.00 (Dr 60.00 = Cr 60.00).

*Reversal flag instead (still held at day 60, next period end, 1.3400):* market value 3,000 × 1.3400 = 4,020.00 is
90.00 above carrying amount 3,930.00, but the reversal is **capped at cost** 3,990.00, so Clearline prepares a possible
reversal of **60.00** only: Dr AIM 60.00 / Cr IMP 60.00 (or a separate reversal account, Q-L7). The 30.00 above cost is
**never** booked (cost model). Same rule: flagged, prepared, approval-only.

**P&L over the H2 sequence (Lot A, (a), (d), (e)):** FX on the receivable −50.00, conversion −320.00, impairment
−60.00, total **−430.00**, as in H2.md §3. What Xero does if the coin is entered the obvious way: H2.md §3 and
`docs/PROBLEM_BRIEF.md` §2 H2.

**Goes to a person instead (exceptions queue):** no proceeds entered; units leaving exceed the lots held (the lot
ledger and the wallet disagree); a lot with no SGD cost (receipt not yet posted or not read back); a payment out to a
supplier (Q-L4); a period-end price or rate unavailable (no flag computed, said so, never "assume par"); coins moved
between own wallets (not a disposal: no journal, lots move with the units [ASSUMPTION]).
*Code today: differs (D21-D24): none of C18 exists.*

## 5. What goes to the exceptions queue (summary)
Wrong token (C9), wrong network (C10), counterfeit/failed/look-alike (nothing to post, explain), overpaid or duplicate
until refund/keep chosen, and the excess itself until Q-C5 (C5-C6), **any difference above 0.01 with no decision**
(C2, C7), multi-invoice split (C14), non-USD invoice (C15), **off-par or unavailable price** (C17), **not yet final**
(R5), no/ambiguous reference (C16), unknown timezone/block time/lock date, **missing or invalid CLR/SHF/RND account**
(R8), any non-demo organisation (R6), refunds and gas (C13, C4), and for held coins (C18, proposed): no proceeds
entered, lots and wallet disagree, payments out to suppliers, period-end price/rate unavailable. Accepted shortfalls post
but stay on the **accountant's list** (C3); C18 impairment flags go on the same list and never post by themselves.

## 6. Clearing reconciliation (proposed, not built)
Daily, per wallet: on-chain token balance (read-only, valued at par) vs the CLR postings for that wallet (USD amounts on
each line) vs Clearline's posted lines. Expected differences: sub-cent overs (C7) and excesses waiting on Q-C5; anything
else is an exception for a person. CLR is a clearing account: the accountant decides when and where its balance is
moved or classified (decision 1). Under decision 6 (C18, proposed) the check adds: token units in open lots = on-chain
balance, and CLR balance in SGD = Σ open lots' remaining cost (impairment sits in AIM).

## 7. QuickBooks and NetSuite
QuickBooks uses the same lines; records as shown per case. Its date rule needs the company timezone, whose API location
is not yet verified; until then QuickBooks must be configured with it and refuse to post without it. Not offered until
its sandbox tests pass. NetSuite: design only; the same lines map to customerPayment / creditMemo.

## 8. Where today's code differs (every difference)
Code read on `main` @ `0c7d9f1`, 2026-11-01. "Approved rule" = the rule as signed in §9; "proposed" = still DRAFT.
| # | Code today | Rule (status) | Effect | Fix (plan task) | Approval-only? |
|---|---|---|---|---|---|
| D1 | Posting date is the UTC date (`rules.ts:137`) | R2 (DRAFT, with ADR 0002) | 00:00-07:59 SGT receipts book to the previous day/month | ADR 0002 PR (a)+(b): D2.1, D3.1 | yes |
| D2 | Over by < 0.01 → `overpayment 0.00` line + `needs_decision` (probe) | R3d (**Approved**) | A pointless decision; a zero-value Xero record | Excess that rounds to 0.00 is not a line: D5.4 | yes |
| D3 | Short by ≤ 0.01 → partial payment, invoice left open 0.01 (probe: 999.995 → `payment 999.99` + note) | R3d (**Approved**) | Books and Clearline disagree; invoice never closes | Rounding line Dr RND ≤ 0.01: D5.4 | yes |
| D4 | No price source: `service.ts` never passes `price`, so `parPrice` always; depeg stop inert | R4.2 (**Approved**; source Q-FX1) | A depegged token would post at 1.00 | Wire the chosen source; unknown → exception: D9.3 | yes |
| D4b | With a price given, the line records the feed price as `usdRate` while the amount is at par | R4.1, R4.4 (**Approved**) | Line says "@0.997" but posts at 1.00 | `usdRate` 1.00 (par) + a separate peg-check field: D9.3 | yes |
| D5 | Missing block time → uses first-seen time | R2 (DRAFT) | Wrong date possible | Don't post without block time: D2.1 | yes |
| D6 | Never reads Xero Organisation (timezone, base currency, lock date, `IsDemoCompany`); scope `accounting.settings.read` not requested | R2, R6, C15 | Can't do R2/C15; could post to a real org | D3.1 (Organisation + scope) | yes (auth + posting) |
| D7 | Overpayment label in a `Reference` Xero ignores for RECEIVE-OVERPAYMENT | C5 | Label lost | Superseded by Q-C5 | yes |
| D8 | `walletAccountCode` default `090` (a bank account "My Savings" in Xero's spec examples), one account for all, never validated | §2 CLR (**Approved**) | Receipts would post to a bank account, against decision 1 | `clearingAccountCode` per org, no default, validated via `GET /Accounts`: D4.4 + UI D5.2 | yes |
| D9 | No 429 / retry-after handling; a timeout is logged "failed" even if Xero created the record | R7 | Manual re-approval | Backoff; read back before retry (after D2.5) | yes |
| D10 | QuickBooks static access token (1 h) | §7 | QBO unusable | OAuth refresh (later) | yes (auth) |
| D11 | Approval can be forged cross-site (SECURITY_GAPS #2) | R1 | Skips human approval | D5.3 | yes |
| D12 | `xero-tokens.json` written 0644 (SECURITY_GAPS #6) | R1 | Token readable by other local users | D6.3 | yes (secrets) |
| D13 | Posting gate = `confirmations >= 12` from `latest` (`rules.ts:110`; 12 from `fixtures/index.ts:36`); no `finalized` read anywhere | R5 (**Approved**, Ethereum) | A reorg after posting is possible | Read `finalized` (D5.5), gate `planPosting` on it (D7.3) | yes |
| D14 | Xero apps after 2 Mar 2026 may not get `accounting.transactions` [ASSUMPTION: secondary] | — | Connect may fail | Granular scopes via `XERO_SCOPES` | yes (auth) |
| D15 | One transfer can't be split across invoices | C14 | Manual credit allocation | Later | yes |
| D16 | Accepted shortfall → credit note to `feeAccountCode` (default `404`), NoTax; no accountant flag | C3 (**Approved**) | Posts to an account the org didn't choose; nobody is told to review GST | `shortfallAccountCode` (no default, validated) + accountant flag: D4.4, D6.4 | yes |
| D17 | No `BaseCurrency`/`/Currencies` read; Xero's applied rate not recorded | R4.3, C15 (**Approved**) | A USD invoice in an org without USD enabled fails at Xero; no audit of the rate | D8.2 | yes |
| D18 | Excess posts as `RECEIVE-OVERPAYMENT` with `BankAccount` = wallet code (`xero.ts:47`) | C5 (DRAFT; Q-C5) | With CLR non-bank, Xero likely rejects it [ASSUMPTION] | Excess → exceptions queue until Q-C5: D5.4 | yes |
| D19 | **Partial-post idempotency:** after a `PartialPostError`, `planPosting` drops the posted lines and `idempotencyKeyFor` (`rules.ts:68`) hashes only the rest, so the retry has a new plan key and line index. Probe: accepted shortfall, payment posted, credit note failed → fee line key `<k1>-1` on attempt 1, `<k2>-0` on retry (k1 ≠ k2). The comment at `engine.ts:23` ("retrying uses the same idempotency key") is untrue here. Also a credit note created before its allocation fails is not in the posted list (`xero.ts`, `post`) | R7 | After a timeout/5xx where Xero did create the record, the retry creates a **second credit note** | Failing tests on `bug/partial-post-idempotency`, then fix: **D2.5** (roadmap priority 2) | yes |
| D20 | Short by > 0.01 with no decision → posts as partial straight away | R3d (**Approved**; reach Q-R1) | Posts before a person has looked | Plan `blocked` → exceptions queue until a decision: D5.4 | yes |
| D21 | **No lot ledger.** Nothing records a receipt as a lot (units, date, SGD cost). A case-insensitive search of `src/` for `ManualJournal`, `impair`, `lot`, `fifo`, `costBasis` and `revalu` found no such code (checked on `ai-team` @ `f47e118`, 2026-11-02) | C18 lot rule (PROPOSED; decision 6 Approved) | Cost of coins leaving can't be computed; CLR can't be reconciled per lot | Not planned yet; after C18 is signed and the accountant has reviewed it | yes |
| D22 | **No conversion / payment-out journal.** `providers/xero.ts` calls only `/Payments`, `/CreditNotes` (+ allocations) and `/BankTransactions` (`RECEIVE-OVERPAYMENT`); no `ManualJournals` call anywhere in `src/` (same search) | C18 (b)-(d) (PROPOSED) | Conversion gains and losses stay inside CLR, as in H2 | Not planned yet | yes |
| D23 | **No period-end impairment flag** (no period-end job, no market-value check; `impair` appears nowhere in `src/`) | C18 (e) (PROPOSED) | Carrying amount above market is never flagged | Not planned yet | yes |
| D24 | **No settings for DGN, DLS, IMP, AIM** or the lot method (`types.ts` account settings: `walletAccountCode`, `feeAccountCode`, optional `overpaymentAccountCode`; nothing for gains, losses or impairment) | §2, C18 (PROPOSED) | — | With D21 | yes |

## 9. Sign-off (Aashmiin)
Nothing is built until a rule is **Approved**; each built rule then needs her merge click.
Decisions recorded 2026-11-01 by accounting-integrations-engineer, from Aashmiin's sign-off of 2026-11-01 (her words
in quotes, unchanged).
| Rule | Approved | Change | Question | Her note |
|---|---|---|---|---|
| §2 CLR "Stablecoin clearing" and Q-A1 presentation | ☑ 2026-11-01 | | | Decision 1: "The stablecoin wallet is NOT a cash equivalent. Receipts post to a configurable 'Stablecoin clearing' account (account code set per organisation), not a bank account." |
| §2 other accounts (CRD, GAS, SUS) | ☐ | ☐ | ☐ | |
| R1 Approval on the exact plan | ☐ | ☐ | ☐ | |
| R2 Date = block time in the org timezone; unknown → no post; lock date → person | ☐ | ☐ | ☐ | (with ADR 0002) |
| R3 (a)-(c) payment down, shortfall to close, overpayment down | ☐ | ☐ | ☐ | |
| R3 (d) / C7 rounding line | ☑ 2026-11-01 | | | Decision 3: "Rounding line allowed up to 0.01 per invoice; any larger difference goes to the exceptions queue (no posting)." (Reach: Q-R1, Q-R2; account: Q-R3) |
| R4 / C15 / C17 value and FX | ☑ 2026-11-01 | | | Decision 4: "Stablecoin valued at par to USD, then Xero's own FX rate to the organisation's base currency. A depeg above 0.5% is an exception (no posting)." (Price source: Q-FX1, Q-FX2; non-USD invoices: Q-C15b) |
| R5 finality | ☑ 2026-11-01 (Ethereum) | | ☐ other chains (Q-F1) | Decision 5: "Post only at chain finality — Ethereum 'finalized' block tag — never on a fixed confirmation count." |
| R6 Demo Company / sandbox only until you switch live on | ☐ | ☐ | ☐ | |
| R7 Never twice; corrections are new approved entries | ☑ 2026-11-01 ("never twice" part) | | ☐ corrections part not yet stated | Her words, 1 Nov: "Every post to Xero must be idempotent" and "a retry after a partial post never creates a duplicate credit note." The "corrections are new approved entries" half is still unsigned. |
| C1 Exact | ☐ | ☐ | ☐ | |
| C2 Partial (now via the exceptions queue) | ☐ | ☐ | ☐ | Q-R1 |
| C3 Shortfall accepted (and Q-C3 GST) | ☑ 2026-11-01 | | | Decision 2: "No automatic GST on shortfalls. An accepted shortfall posts to a customer-chosen account and is flagged for the accountant." (Account choice: Q-SF1; flag: Q-SF2) |
| C4 Network fees | ☐ | ☐ | ☐ | |
| C5 Overpaid → CRD, after refund/keep decision | ☐ | ☐ | ☐ | Q-C5 |
| C6 Duplicate → one payment + overpayment | ☐ | ☐ | ☐ | |
| C8 Several transfers, running-total rounding | ☐ | ☐ | ☐ | (its rounding line is covered by R3d) |
| C9 Wrong token → person | ☐ | ☐ | ☐ | |
| C10 Wrong network → never automatic | ☐ | ☐ | ☐ | |
| C11 Look-alike address → nothing posts | ☐ | ☐ | ☐ | |
| C12 Counterfeit / failed → never | ☐ | ☐ | ☐ | |
| C13 Refunds recorded by a person (Q-C13) | ☐ | ☐ | ☐ | |
| C14 Multi-invoice split by a person | ☐ | ☐ | ☐ | |
| C16 No reference / not final → wait | ☐ | ☐ | ☐ | |
| **Decision 6: clearing account under option 2** (hold at cost; IAS 21/IAS 38 basis) | ☑ 2026-11-02 (the policy) | | | **Decided by Aashmiin 2026-11-02 (option 2)**, as relayed by tech-lead-architect: stablecoins held are non-monetary intangibles at cost (IAS 38 cost model), no period-end FX revaluation, consistent with IAS 21 for non-monetary items at historical cost; decision 1 kept (wallet not a cash equivalent, configurable "Stablecoin clearing" account); every receipt recorded as a lot with its SGD (base-currency) cost at the rate on the day of receipt; on conversion or payment out Clearline prepares a manual journal with the realised gain/loss (lot method FIFO by default, configurable), posting approval-only; at period end, flag a possible impairment if market value is below carrying amount, prepare the entry, never post it automatically. Her words: "update POSTING_RULES.md with worked SGD examples (receipt, conversion at a gain, conversion at a loss, partial conversion across two lots, period-end impairment flag) in plain debits and credits for my sign-off … I'll have a qualified accountant review it." |
| C18 lots, conversion journals, impairment flag: the five worked examples, accounts DGN/DLS/IMP/AIM, rounding, Q-L1-Q-L9 | ☐ | ☐ | ☐ | PROPOSED; awaiting her sign-off **and** a qualified accountant's review. Not built until both. |
| Build order: D1, then D19 (partial-post idempotency, roadmap priority 2), D6, D8/D16, D2/D3/D20, D13, D17, D4 | ☑ 2026-11-01 (first two) | | | Her build order, 1 Nov: "1. UTC posting-date fix … 2. Idempotent Xero posting … 3. Reorg dismiss bug … 4. Honest copy … 5. The 20 test payments … 6. Payment status + ETA … 7. Then continue docs/PLAN_14_DAY.md in order." The order after D19 follows the plan. |

Signed: Aashmiin Kaur, 2026-11-01 SGT, for the five rows marked ☑ (recorded by accounting-integrations-engineer).
Decision 6 (option 2) decided by Aashmiin 2026-11-02 SGT, recorded by accounting-integrations-engineer from the tech lead's relay; the C18 details row is not signed.
Remaining rows: ____________________ Date: __________ SGT

## 10. Open questions for Aashmiin (none decided here)
| # | Question | Options / what Clearline does until then | Needed by |
|---|---|---|---|
| Q-R1 | Decision 3 says a difference above 0.01 goes to the exceptions queue. Does that also mean a plain partial payment (C2, e.g. 4,950.00 of 5,000.00) waits for a person instead of posting as a partial straight away, as the code does today? | Built the stricter way (waits for a person) unless you say otherwise | Day 4 (before D5.4) |
| Q-R2 | Over by exactly 0.01 (5,000.01): treat as rounding (Cr RND 0.01, no decision) or as an overpayment needing refund/keep (C5)? | C5 (overpayment) | Day 4 |
| Q-R3 | Which account takes the rounding line? Xero's system Rounding account may not accept direct postings [ASSUMPTION: not checked] | An account code set per organisation, like CLR; blocked if not set | Day 4 |
| Q-SF1 | "Customer-chosen account" for shortfalls: one account chosen once per organisation in Settings, or chosen by the person each time they accept a shortfall? | One per-organisation setting, no default | Day 4 |
| Q-SF2 | How the accountant is told: a note on the invoice in Xero plus an "accountant review" list in Clearline: enough? | Both | Day 6 |
| Q-FX1 | **Price source** for the 0.5% depeg check (price at the block time). Options: an on-chain Chainlink USDC/USD (USDT/USD) feed on Ethereum (read-only, fits our read-only chain access); a market-data API (e.g. CoinGecko, Kaiko: account and terms needed); another source you name | Not wired; see Q-FX2 | Day 7 (before D9.3) |
| Q-FX2 | Price unavailable (no source yet, or it fails): exception (no posting), or allow par in the **Demo Company only** with the line saying "peg not checked"? | Exception (fail closed). Note: this means nothing posts in the Day 11 Demo Company run unless Q-FX1 is wired by then or you allow the Demo-only option | Day 7 |
| Q-FX3 | Xero's rate can only be seen after posting (no rate endpoint): OK for the plan to say "converted by Xero at its rate for <date>" and show the base-currency amount only after posting? | Yes, as written in R4.3 | Day 8 |
| Q-C15b | Invoices in SGD or another non-USD currency: do you want a rule, and with which rate? | To a person | after Day 14 |
| Q-C5 | Overpayments when CLR is not a bank account (Xero's overpayment record needs a bank account). (a) Manual journal Dr CLR / Cr a "Customer overpayments" liability; (b) a bank-type account used only for excesses (conflicts with decision 1); (c) a person records the excess by hand | (c): excess to the exceptions queue; the invoice amount still posts | Day 6 |
| Q-F1 | **Finality on other chains** (none post today; payment requests are Ethereum-only). What we know: **Tron** — a block is "solidified" (irreversible) when ≈19 of 27 Super Representatives have built on it, ≈1 minute, read from `/walletsolidity/*` [VERIFIED: crypto-protocol-engineer 2026-10-31, developers.tron.network/docs/concensus]; **BNB Chain** — `finalized` tag under BEP-126 fast finality, about a second [VERIFIED: crypto-protocol-engineer 2026-10-29/31, bnb-chain/BEPs BEP-126, BEP-667]; **Base/OP, Arbitrum** — `finalized` follows Ethereum finality of the posted batch, ~15-30 min [VERIFIED: crypto-protocol-engineer 2026-10-29/31, OP Stack and Arbitrum docs]; **Polygon PoS** — `finalized` milestones, 2-5 s [VERIFIED: crypto-protocol-engineer 2026-10-31, docs.polygon.technology]. Is "the chain's own finality signal, read from the node" the rule for each? | Undecided: nothing on another chain posts | before Tron payment requests ship |
| Q-C13 | Should Clearline later *prepare* the refund entry (C13) for approval? | No | later |
| Q-H1 | ~~Clearing account and period-end revaluation (PROBLEM_BRIEF §3, H2 finding): keep decision 1 as is, add a conversion manual-journal step, or revisit decision 1?~~ | **Decided by Aashmiin 2026-11-02 (option 2):** hold at cost, lots, prepared conversion journals, impairment flag; no period-end revaluation (R4.5, C18, §9 decision 6) | done |
| Q-L1 | **Lot cost rate source.** Proposed: the SGD amount Xero actually booked to CLR for the receipt (Xero's rate, decision 4, read back), so lots always equal the books. Alternative: a named daily rate (e.g. MAS, XE) per day of receipt, which would then disagree with Xero by the FX Xero books | Xero's booked amount (proposed) | before C18 is built |
| Q-L2 | **Period-end market value source** (for the impairment flag): USDC/USD price (Q-FX1) × a USD/SGD closing rate from which source (MAS, XE, the exchange's USDC/SGD price)? Xero's rate can't be read before posting (no rate endpoint, R4.3) | No flag until chosen | before C18 (e) |
| Q-L3 | Impairment tested **per lot** (proposed, prudent: a low-cost lot can't hide a high-cost one) or per token holding? Accountant's call | Per lot | accountant review |
| Q-L4 | **Payment out to a supplier in USDC:** proceeds = the SGD amount at which Xero settles the USD bill on that date? Clearline does not see bills today | To a person | later |
| Q-L5 | A separate "Stablecoins held at cost" account (and its presentation: current/non-current intangible) instead of holding lots in CLR? | Lots stay in CLR | accountant review |
| Q-L6 | Conversion date and fees: trade date on the exchange/OTC confirmation (proposed)? Exchange fee netted into proceeds (net proceeds, proposed) or a separate fee expense line? | Trade date; net proceeds | before C18 (b)-(d) |
| Q-L7 | Impairment reversal: credit IMP (proposed) or a separate "Impairment reversal" income account? | IMP | accountant review |
| Q-L8 | FIFO per token **per wallet** (proposed, reconcilable on-chain) or across all the organisation's wallets? | Per wallet | before C18 is built |
| Q-L9 | When is "period end" for the flag: every month end (proposed) or only the financial year end? | Every month end, org timezone | before C18 (e) |
| — | Still to sign: §2 CRD/GAS/SUS, R1, R2 (with ADR 0002), R3(a)-(c), R6, R7, C1, C2, C4-C6, C8-C14, C16, build order | Not built until Approved | Day 3-4 for R1, R2, R3(a)-(c), R6, R7, C1 (needed for the Day 11 run) |
