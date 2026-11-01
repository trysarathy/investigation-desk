# Posting rules: what Clearline puts in the books

**Status: DRAFT, awaiting Aashmiin's sign-off.** Nothing in this document changes the product until she
approves it rule by rule (§9). Approved rules are then built as small PRs, each **approval-only** (posting
to Xero/QuickBooks is on the approval-only list, `company/OPERATING_MODEL.md` §2): never auto-merged.

- Author: accounting-integrations-engineer · Drafted 2026-11-01 (SGT) · Version 0.1
- Checked against the code on `origin/main` @ `0c7d9f1` (`src/lib/accounting/rules.ts`, `providers/xero.ts`,
  `providers/quickbooks.ts`), with a probe run through the real posting rules on 2026-11-01. Where today's code
  differs from a proposed rule, the rule says **Code today: differs (Dn)** and §8 lists every difference.
- Scope: receipts from customers paying sales invoices with USDC or USDT, posted to **Xero** (in testing on the
  Demo Company) and later **QuickBooks Online** (code exists, not offered). NetSuite: design only.
- Labels: [VERIFIED: …] = primary source opened; [ASSUMPTION] = not checked. Accounting-standard points are all
  [ASSUMPTION: secondary] today (`team/knowledge/accounting-integrations-engineer/stablecoin-accounting.md`).

## 1. How to read this
Each rule says, in plain accounting language: when it applies, the **debit and credit lines** (to the cent),
which Xero / QuickBooks record makes them, the **date**, the **rounding**, and what **goes to a person instead**.
The worked example is always invoice **INV-1042, Acme Pte Ltd, 5,000.00 USD**, paid in USDC on Ethereum.
"Posts" always means: Clearline prepares the lines, a person clicks **Approve**, and only then are they sent.

## 2. Accounts (the chart Clearline posts to)
| Ref | Account | Type in Xero | What it holds | Code today |
|---|---|---|---|---|
| WAL | **USDC wallet – Ethereum 0x…** (one per token + network + address) | Bank account, currency USD | Stablecoins received, at the USD value posted | `walletAccountCode` = `090`, **one account for everything** (D8) |
| AR | Accounts Receivable | System (Debtors) | What Acme owes | via the invoice |
| FEE | **Payment shortfalls (fees accepted)** | Expense | Shortfalls you accept as settled, usually the payer's exchange withdrawal fee | `feeAccountCode` = `404` (Bank Fees) |
| CRD | Customer credit (overpayment) | Xero overpayment on the contact (a credit against AR) | Money received above the invoice | received into WAL as an overpayment |
| RND | Rounding | System (Rounding) | Differences under one cent between token decimals and cents | not used |
| FXG | Realised currency gains/losses | System (Realised currency gain) | FX differences when the invoice and the receipt are valued at different rates | not used (Xero books it itself) |
| GAS | Network fees | Expense | Gas the business pays when **it** sends tokens (refunds) | not used |
| SUS | Stablecoin suspense | Bank or current asset | Genuine money received that no rule can place (wrong token / network) until a person decides | not used |

**Question for Aashmiin (Q-A1):** how should WAL be presented: cash equivalent, or another current asset
(financial asset, or intangible)? Clearline needs a *bank-type* account in Xero to receive payments into
[VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `BankTransaction.BankAccount`, `Account.EnablePaymentsToAccount`],
but that is a bookkeeping container: the financial-statement classification is the accountant's policy.
IFRS IC (June 2019) said cryptocurrencies with no contract are IAS 38/IAS 2, not cash; a redeemable fiat-backed
stablecoin may instead be an IAS 32 financial asset [ASSUMPTION: secondary, search summaries of the ifrs.org
agenda decision and KPMG/ICAEW commentary; primary sources blocked]. Clearline will never name the account
"Cash at bank" by default.

## 3. Rules that apply to every posting
**R1 Approval.** Nothing is sent to the books until a named person clicks Approve on the exact plan they saw (the
plan's key must match). A changed plan must be approved again. *Code today: matches* — **but** the approval can be
forged from another website today (SECURITY_GAPS #2, D11), so live posting must stay off until that is fixed.

**R2 Date.** The posting date of every line is **the calendar date of the transfer's block time in the accounting
organisation's own timezone** (Xero: `Organisation.Timezone`; QuickBooks: the company's timezone). Not UTC, not
Singapore hard-coded, not when Clearline saw it, not when someone approved it.
Example: block time 2026-10-31 23:30 UTC = **1 Nov 07:30 SGT** → a Singapore org posts **2026-11-01 (November)**;
a New York org posts 2026-10-31. If the block time is unknown → don't post. If the date falls on or before the
org's lock date → a person chooses; Clearline never moves a date by itself.
*Code today: differs (D1, D5):* posts the **UTC date** (`rules.ts:137`), so every receipt between 00:00 and 07:59
SGT lands on the previous day, and on the 1st, the previous month; falls back to the time Clearline first saw the
transfer when the block time is missing; no lock-date check (D6).

**R3 Amounts and rounding.** Token amounts are exact (6 decimals for USDC on Ethereum and USDT on Tron
[VERIFIED: crypto-protocol-engineer 2026-10-29/31, Circle's address page and an on-chain `decimals()` read, per its
`erc20-trc20.md` §4]; BNB Chain USDT uses 18 [ASSUMPTION: copied from that pack's table, row not re-read]); the books
take cents.
- (a) A **payment** line is rounded **down** to the cent against the running total, so the books never show more
  received than arrived; when the invoice is covered exactly, the last line closes it exactly.
- (b) A **write-off** line is the cents needed to close the invoice (half-up).
- (c) An **overpayment** line is rounded down.
- (d) Anything **under one cent** left over is not posted as its own line (see C7).
- Never floating-point arithmetic; amounts stay exact decimal strings until the request body.
*Code today: matches (a)-(c); differs on (d) (D2, D3).*

**R4 Value.** USDC and USDT are valued at **1.00 USD (par)** only while the token trades within **0.5%** of par;
outside that, a person posts by hand. Every line states the rate and its source. *Code today: differs (D4):* no
price feed is connected, so every line is "par, no price feed" and the 0.5% stop can never trigger.

**R5 When money counts.** Only transfers that are genuine (official token contract), successful, on the network
the invoice asked for, to the invoice's receiving address, and confirmed. *Code today:* confirmed = 12 blocks
from the latest Ethereum block (a sample setting), **not** Ethereum's `finalized` checkpoint (D13). Proposal:
post only after `finalized` (about 13 minutes) [ASSUMPTION: crypto-protocol-engineer pack `finality-reorgs.md`,
which cites the OP Stack finality page for ~2 epochs ≈ 12.8 min].

**R6 Sandbox only.** Until Aashmiin switches on live posting in writing, Clearline posts only to an organisation
whose `IsDemoCompany` is true (Xero) or to a QuickBooks sandbox company. A pilot gets a Xero-ready import file
that the customer's accountant reviews and imports (her decision, 31 Oct 2026). *Code today: differs (D6):* no
demo-company check.

**R7 Never twice, never silently changed.** One line per transfer, ever; retries reuse the same idempotency key.
A wrong entry is corrected by a new, approved entry (or a person deletes it in Xero); Clearline never edits or
deletes posted records by itself. *Code today: matches* (idempotency, audit log); no automatic correction exists.

**R8 Goes to a person instead of posting** (the plan shows why): anything flagged (wrong token, wrong network,
counterfeit, look-alike, failed); no or ambiguous reference; still confirming; overpaid until refund/keep is chosen;
non-USD invoice; price off par; unknown timezone, block time, lock date or account; account code missing in the
org; the org is not a demo company (R6).

## 4. Receipts: the cases
Format: **lines** (Dr = debit, Cr = credit) · Xero record · QuickBooks record · result for the invoice.

### C1 Exact payment
5,000.00 USDC arrives for INV-1042.
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL USDC wallet – Ethereum | 5,000.00 | |
| 2 | AR Acme (INV-1042) | | 5,000.00 |
Xero: one Payment on INV-1042, Account = WAL, Reference "USDC on Ethereum · tx 0x… · @1.00 USD". QuickBooks: Payment
linked to the invoice, deposited to WAL. Invoice: **paid**. *Code today: matches (date: D1).*

### C2 Partial payment (short, no decision yet, or balance requested)
4,950.00 USDC arrives.
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL | 4,950.00 | |
| 2 | AR Acme | | 4,950.00 |
Plus a note on the invoice history: "4,950.00 of 5,000.00 USDC received on Ethereum. Short by 50.00." Invoice: **open,
50.00 due**. QuickBooks has no invoice history: the note goes in the payment's private note. *Code today: matches.*

### C3 Under after fees, accepted as settled (the fee is borne by us)
4,950.00 arrives because the payer's exchange took a 50.00 withdrawal fee; a person clicks "accept as settled".
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL | 4,950.00 | |
| 2 | FEE Payment shortfalls | 50.00 | |
| 3 | AR Acme | | 5,000.00 |
Xero: Payment 4,950.00 + a credit note (line to FEE, no tax) 50.00 allocated to INV-1042. QuickBooks: Payment + credit
memo (write-off item mapped to FEE) linked by a zero payment. Invoice: **paid**. Only a person can accept a shortfall;
there is no automatic tolerance. *Code today: matches.*
**Question (Q-C3):** is an accepted shortfall a *cost* (fee, no GST effect) or a *price reduction* (a credit note that
reduces output GST on a GST-registered invoice)? Today it is a no-tax credit note to an expense account.

### C4 Network fees: borne by the payer vs. by us
- **Gas on the customer's transfer** (ETH/TRX) is paid by the sender from their own native coin; it never reduces the
  USDC that arrives. **Nothing posts** for it.
- **A fee taken out of the amount** (exchange withdrawal fee) shows up as a shortfall: C2 until someone decides, C3 if
  accepted (the business bears it), or the business asks the payer for the balance (the payer bears it).
- **Gas the business pays** happens only when the business sends tokens (refund C13, moving funds). Lines: Dr GAS / Cr
  "ETH wallet" (the native coin). Clearline does not see or post these today; a person posts them.

### C5 Overpaid (one transfer above the invoice)
5,000.50 arrives. Nothing posts until a person chooses **refund** or **keep as credit**; then:
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL | 5,000.50 | |
| 2 | AR Acme (INV-1042) | | 5,000.00 |
| 3 | CRD Acme overpayment ("To refund" or "Customer credit") | | 0.50 |
Xero: Payment 5,000.00 + an overpayment of 0.50 received into WAL. QuickBooks: Payment + an unapplied payment of 0.50.
Invoice: **paid**; Acme has a 0.50 credit. *Code today: matches,* except Xero says a bank-transaction Reference is only
supported for SPEND and RECEIVE types [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01], so the "To refund"/"Customer
credit" label may be dropped from the overpayment's reference; it survives in the line description (D7, check in the
Demo Company).

### C6 Paid twice (duplicate)
Two transfers of 5,000.00. Same as C5 with the second transfer as the excess: Dr WAL 10,000.00 / Cr AR 5,000.00 /
Cr CRD 5,000.00 (overpayment marked "To refund" by default). **Never two payments on one invoice.** A person decides
first. *Code today: matches.*

### C7 Differences under one cent
Tokens have 6 decimals; the books have 2.
- **Over by less than a cent** (5,000.004 arrives): **proposed:** post the 5,000.00 payment only (C1), mention
  "5,000.004 USDC received" in the reference, no decision needed. The 0.004 stays in the on-chain wallet and is
  picked up by the wallet reconciliation (§6). *Code today: differs (D2):* creates a **0.00 overpayment line** and
  blocks the posting until a person chooses refund or credit for 0.004.
- **Short by less than a cent** (4,999.995 arrives): **proposed:** the plan shows Dr WAL 4,999.99 / Dr RND 0.01 /
  Cr AR 5,000.00 and closes the invoice; still needs Approve. *Code today: differs (D3):* posts 4,999.99 and leaves the
  invoice **open for 0.01 in Xero** while Clearline's note says "short by 0.005"; the two disagree.
  **Question (Q-C7):** allow this one-cent rounding line, or keep every shortfall for a person (C3)?

### C8 Several transfers for one invoice (rounding across lines)
333.333333 then 666.666667 arrive for a 1,000.00 invoice. Lines: Dr WAL 333.33 / Cr AR 333.33 (date of the first
transfer), then Dr WAL 666.67 / Cr AR 666.67 (date of the second). The running total is rounded down, so the two lines
add up to exactly 1,000.00 and the invoice closes. *Code today: matches (measured).*

### C9 Wrong token (e.g. genuine USDT sent to a USDC request)
Real money arrived, but not what was asked. **Never posted automatically.** A person decides: ask for the right token
and return this one, or accept it; if accepted, the person posts by hand to the right wallet account (Dr "USDT wallet –
Ethereum" / Cr AR) or to SUS until decided. *Code today: matches* (never posted; no suspense account).

### C10 Wrong network (e.g. USDT sent on Tron to an Ethereum request)
**Never posted automatically, even if a person accepts it.** If the business really controls that address on the other
network, a person posts by hand to that network's wallet account. *Code today: matches.*

### C11 Look-alike address (address poisoning)
The payer sent to an attacker's look-alike address; the money **never reached the business**. **Nothing posts**; INV-1042
stays open for 5,000.00; Clearline explains it. The loss is the payer's, not an entry in our books. *Code today: matches*
(the transfer is not to the request's address, so it never counts).

### C12 Counterfeit token or failed transaction
Nothing of value arrived. **Never posted.** *Code today: matches.*

### C13 Refund of an overpayment
Clearline never sends money. When the business sends the 0.50 back itself, a person records it:
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | CRD Acme overpayment | 0.50 | |
| 2 | WAL | | 0.50 |
| 3 | GAS Network fees | (gas in USD) | |
| 4 | ETH wallet | | (gas) |
Xero: a payment against the overpayment [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `Payment.Overpayment`,
PaymentType `AROVERPAYMENTPAYMENT`]. Date: the refund transfer's block date in the org timezone. *Code today:* not
posted by Clearline (it gives the refund instruction only). **Question (Q-C13):** later, should Clearline *prepare* this
entry from the refund transaction for approval?

### C14 One transfer for several invoices
5,000.00 arrives meant for INV-1041 (3,000.00) and INV-1042 (2,000.00). **Proposed:** a person confirms the split; then
Dr WAL 5,000.00 / Cr AR (INV-1041) 3,000.00 / Cr AR (INV-1042) 2,000.00, as two payments with the same tx hash and date.
Never split by guessing from amounts. *Code today: differs:* one request per invoice; the transfer is matched to one
request, the extra becomes an overpayment (C5) and a person must then apply the credit to the other invoice in Xero by
hand.

### C15 Currencies (FX)
- **USD invoice, USD-base org:** C1-C14 as written.
- **USD invoice, SGD-base org** (likely for a Singapore company): WAL must be a **USD** bank account. Clearline posts the
  USD payment; Xero converts at its rate for the posting date (its own or XE.com day rate when none is given
  [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `BankTransaction.CurrencyRate`; `Payment.CurrencyRate` "only used
  for non base currency invoices"]) and books the realised FX difference. Illustrative only (rates are made up):
  invoiced at 1.3000 → AR SGD 6,500.00; received at 1.2900 → WAL SGD 6,450.00; **Dr FXG SGD 50.00** (loss).
  **Question (Q-C15a):** accept Xero's daily rate as the FX source, or supply another (state which)?
  *Code today: differs (D6):* never reads the base currency or checks WAL's currency.
- **Invoice in SGD (or any non-USD currency):** **to a person.** *Code today: matches* (blocked, "post it by hand").
  **Question (Q-C15b):** do you want a rule for this, and with which rate source?

### C16 No reference, ambiguous, or still confirming
Nothing posts until a person confirms which invoice the money pays (then C1-C8), or until it is confirmed. *Code today:
matches.*

### C17 Token off par
USDC trading at 0.994: more than 0.5% from par → a person posts by hand at a stated rate. *Code today: differs (D4)*
(no price feed, so it can't detect it).

## 5. What goes to a person (summary)
Wrong token (C9), wrong network (C10), counterfeit/failed/look-alike (nothing to post, explain), overpaid or duplicate
until refund/keep chosen (C5-C6), any shortfall (C3; C7 if Q-C7 says no), multi-invoice split (C14), non-USD invoice
(C15), off-par price (C17), no/ambiguous reference (C16), unknown timezone/block time/lock date/account (R2, R8), any
non-demo organisation (R6), refunds and gas (C13, C4).

## 6. Wallet reconciliation (proposed, not built)
Daily, per wallet: on-chain balance (read-only) vs Xero WAL balance vs Clearline's posted lines. A difference under
one cent per receipt accumulates from C7; above that it is a finding for a person. Adjustments: Dr/Cr WAL against RND,
approved like any posting.

## 7. QuickBooks and NetSuite
QuickBooks uses the same lines; records as shown per case. Its date rule needs the company timezone, whose API location
is not yet verified; until then QuickBooks must be configured with it and refuse to post without it. Not offered until
its sandbox tests pass. NetSuite: design only; the same lines map to customerPayment / creditMemo.

## 8. Where today's code differs (every difference)
| # | Difference | Rule | Effect | Proposed fix | Approval-only? |
|---|---|---|---|---|---|
| D1 | Posting date is the UTC date (`rules.ts:137`), sent as Xero `Date` / QBO `TxnDate` | R2 | 00:00-07:59 SGT receipts book to the previous day; month/year-end cut-off wrong | Pass the org's IANA zone (`PlanOptions.orgTimeZone`) and format the block time in it; 17 failing tests ready on `bug/xero-posting-date-timezone` | yes |
| D2 | Over by < 1 cent → 0.00 overpayment line + needs decision | R3d, C7 | A pointless decision; a zero-value Xero record | Ignore residuals < 0.01 in the excess calculation; note the token amount | yes |
| D3 | Short by < 1 cent → invoice left open 0.01 while the note says 0.005 | R3d, C7 | Books and Clearline disagree | Per Q-C7: rounding line, or show "0.01 due" consistently | yes |
| D4 | No price feed: always par; depeg stop inert | R4, C17 | A depegged token would post at 1.00 | Wire a price source; unknown price = wait, not par | yes |
| D5 | Missing block time → uses first-seen time | R2 | Wrong date possible | Don't post without block time | yes |
| D6 | Never reads Xero Organisation: no timezone, base currency, lock date or demo-company check; scope `accounting.settings.read` not requested | R2, R6, C15 | Can't do R2; could post to a real org | Add the scope; read Organisation on connect; refuse unless `IsDemoCompany` (until live is approved) | yes (auth + posting) |
| D7 | Overpayment "To refund"/"Customer credit" put in a Reference Xero may ignore for RECEIVE-OVERPAYMENT | C5 | Label lost in Xero (still in description) | Check in Demo Company; if dropped, rely on the line description / history note | yes |
| D8 | One wallet account for every token, network and address | §2 | Can't reconcile per wallet | `walletAccountCode` per token + network (+ address) | yes |
| D9 | No 429 / retry-after handling; a timeout is logged "failed" even if Xero created the record | R7 | Manual re-approval; relies on Xero remembering the key | Backoff on 429/5xx; read back before retry | yes |
| D10 | QuickBooks uses a static access token from the environment (expires after 1 h) | §7 | QBO unusable beyond an hour | OAuth refresh like Xero | yes (auth) |
| D11 | Approval can be forged cross-site (SECURITY_GAPS #2) | R1 | Skips human approval | Origin/Sec-Fetch-Site check (security fix first) | yes |
| D12 | `xero-tokens.json` written 0644 (SECURITY_GAPS #6) | R1 | Token readable by other local users | Write 0600 | yes (secrets) |
| D13 | Posts after 12 confirmations from `latest`, not `finalized` | R5 | A reorg after posting is possible | Gate posting on `finalized` | yes |
| D14 | Xero apps created after 2 Mar 2026 may not be granted `accounting.transactions` [ASSUMPTION: secondary, Xero devblog/Apideck summaries] | — | Connect may fail for her new app | Use granular scopes via `XERO_SCOPES` | yes (auth) |
| D15 | Multi-invoice: one transfer can't be split across invoices | C14 | Manual credit allocation | Person-confirmed split, two payment lines | yes |

## 9. Sign-off (Aashmiin)
Mark one box per rule. "Change" or "Question": write what you want in the last column. Nothing is built until a rule is
**Approved**; each built rule then needs her merge click.
| Rule | Approved | Change | Question | Your note |
|---|---|---|---|---|
| §2 Accounts (WAL per wallet, FEE, CRD, RND, FXG, GAS, SUS) and Q-A1 presentation | ☐ | ☐ | ☐ | |
| R1 Approval on the exact plan | ☐ | ☐ | ☐ | |
| R2 Date = block time in the org timezone; unknown → no post; lock date → person | ☐ | ☐ | ☐ | |
| R3 Rounding (payment down, write-off half-up, overpayment down, < 1 cent not a line) | ☐ | ☐ | ☐ | |
| R4 Par within 0.5%, rate source on every line | ☐ | ☐ | ☐ | |
| R5 Post only after `finalized` | ☐ | ☐ | ☐ | |
| R6 Demo Company / sandbox only until you switch live on | ☐ | ☐ | ☐ | |
| R7 Never twice; corrections are new approved entries | ☐ | ☐ | ☐ | |
| C1 Exact | ☐ | ☐ | ☐ | |
| C2 Partial | ☐ | ☐ | ☐ | |
| C3 Shortfall accepted → FEE (and Q-C3 GST) | ☐ | ☐ | ☐ | |
| C4 Network fees (payer's gas: nothing; our gas: person) | ☐ | ☐ | ☐ | |
| C5 Overpaid → CRD, after refund/keep decision | ☐ | ☐ | ☐ | |
| C6 Duplicate → one payment + overpayment | ☐ | ☐ | ☐ | |
| C7 Under one cent (and Q-C7 rounding line) | ☐ | ☐ | ☐ | |
| C8 Several transfers, running-total rounding | ☐ | ☐ | ☐ | |
| C9 Wrong token → person | ☐ | ☐ | ☐ | |
| C10 Wrong network → never automatic | ☐ | ☐ | ☐ | |
| C11 Look-alike address → nothing posts | ☐ | ☐ | ☐ | |
| C12 Counterfeit / failed → never | ☐ | ☐ | ☐ | |
| C13 Refunds recorded by a person (Q-C13) | ☐ | ☐ | ☐ | |
| C14 Multi-invoice split by a person | ☐ | ☐ | ☐ | |
| C15 FX (Q-C15a rate source, Q-C15b non-USD invoices) | ☐ | ☐ | ☐ | |
| C16 No reference / confirming → wait | ☐ | ☐ | ☐ | |
| C17 Off par → person | ☐ | ☐ | ☐ | |
| Build order: D1 first (operating-model order), then D6, D2/D3, D4, D13, D8, D9 | ☐ | ☐ | ☐ | |

Signed: ____________________ (Aashmiin Kaur) Date: __________ SGT
