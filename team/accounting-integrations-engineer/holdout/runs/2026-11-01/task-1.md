# Task 1: Journal lines to the cent for six receipts

To: tech-lead-architect, cc Aashmiin · From: accounting-integrations-engineer · 2026-11-01 04:00 SGT

**Pre-flight.** Live tools are off, so I couldn't check Settings `PAUSE` or the PAUSE email search. In a live run I'd do that first. Every org in the fixture is a Xero **Demo Company** (sandbox), so nothing here touches real books.

**Status of the rules.** Every rule in `docs/POSTING_RULES.md` is still **DRAFT**. Aashmiin hasn't approved any of them in §9 yet. The journals below are what the draft spec says should happen. They are not approval to build anything.

**Sources used**
- Product code on `main` @ `0c7d9f1`, read-only copy, read 2026-11-01. I also ran a scratch probe (`tests/zz-holdout-probe.test.ts`, deleted afterwards) through the real `planPosting()` and `xeroBody()` for cases 1-6. Results below are labelled `[VERIFIED: probe 2026-11-01]`.
- Xero OpenAPI spec 19.1.0, opened this run: https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml. Labelled `[VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]`.
- developer.xero.com is blocked in this session (proxy refused the connection on 2026-11-01).

**Dates.** Each date is the block time converted into the org's zone, `Asia/Singapore`, using `Intl.DateTimeFormat("en-CA", {timeZone})` (run 2026-11-01). The code today posts the **UTC date** instead (`rules.ts:137`, D1).

**Rounding.** These rules come from POSTING_RULES R3:
- Payment lines are rounded down against the running total.
- Write-off lines are rounded half-up.
- Overpayment lines are rounded down.
- Anything under 1 cent is never posted as its own line.

---

## Case 1: ORG-A, INV-2001, 1,250.00 USD, exact (rule C1)
Block time 2026-10-14T03:12:09Z = 14 Oct 11:12:09 SGT. **Posting date 2026-10-14.**

| Account | Dr | Cr |
|---|---|---|
| 091 USDC Clearing - Ethereum | 1,250.00 | |
| 610 Accounts Receivable (INV-2001) | | 1,250.00 |

**Xero record:** `PUT /Payments`
- Invoice = INV-2001
- `Account.Code` "091"
- `Date` "2026-10-14"
- `Amount` 1250.00
- `Reference` "USDC on Ethereum · tx 0xa1a1…0001 · @1.00 USD"

INV-2001 is **paid**, with AmountDue 0.00.

**Code today:** status `ready`, one line: payment 1250.00, account 091, date 2026-10-14 [VERIFIED: probe 2026-11-01]. It matches. The UTC date happens to equal the SGT date here.
- The rate is "par, no price feed connected" (D4).
- Nobody has checked that 091 exists or is a USD bank account (D6).

## Case 2: ORG-A, INV-2002, 980.00 USD, USDT on Tron 979.65, short accepted by Mei (rule C3)
Block time 2026-10-15T22:40:00Z = **16 Oct 06:40 SGT**. **Posting date 2026-10-16.**

| Account | Dr | Cr |
|---|---|---|
| 092 USDT Clearing - Tron | 979.65 | |
| 404 Bank Fees (accepted shortfall) | 0.35 | |
| 610 Accounts Receivable (INV-2002) | | 980.00 |

Shortfall = 980.00 − 979.650000 = 0.35 exactly. Half-up rounding changes nothing.

**Xero records:**
1. `PUT /Payments`: Account 092, Amount 979.65, Date 2026-10-16, Reference "USDT on Tron · tx b2b2…0002 · @1.00 USD".
2. `PUT /CreditNotes`: Type `ACCRECCREDIT`, `LineAmountTypes` NoTax, one line 0.35 to `AccountCode` 404, Date 2026-10-16, Status AUTHORISED.
3. `PUT /CreditNotes/{id}/Allocations`: Invoice INV-2002, Amount 0.35, Date 2026-10-16.

INV-2002 is **paid**.

**Code today, three problems:**
1. **Network.** Payment requests are **Ethereum only**. A Tron transfer to a request gets flagged "this request is Ethereum only" (`src/lib/requests/check.ts:74`), and `rules.ts:98-104` treats `wrong_network` as never-post. So today Clearline **cannot post this receipt at all**. A person posts it by hand into 092 (POSTING_RULES C10) [VERIFIED: code @0c7d9f1, read 2026-11-01].
2. **Account.** Suppose it could post. `walletAccountCode` is a single code for every token, network and address (D8, `types.ts:124`). With the ORG-A settings, the 979.65 would go into **091 (USDC Ethereum)**, not 092. 091 would be overstated by 979.65 and 092 understated by 979.65, and neither would reconcile to its on-chain wallet.
3. **Date.** The code would post **2026-10-15**. I measured this with a USDT-on-Ethereum stand-in: payment 979.65, account 091, date 2026-10-15, plus fee_writeoff 0.35, account 404, date 2026-10-15 [VERIFIED: probe 2026-11-01]. That is one day early (D1).

**Open question Q-C3 for Aashmiin:** is the 0.35 a cost (no GST effect) or a price reduction (credit note that adjusts output GST)? Today it is a no-tax credit note to an expense account.

## Case 3: ORG-A, INV-2003, 600.00 USD, 450.00 received, no decision (rule C2)
Block time 2026-10-17T09:00:00Z = 17 Oct 17:00 SGT. **Posting date 2026-10-17.**

| Account | Dr | Cr |
|---|---|---|
| 091 USDC Clearing - Ethereum | 450.00 | |
| 610 Accounts Receivable (INV-2003) | | 450.00 |

**Xero records:**
- `PUT /Payments`: Account 091, Amount 450.00, Date 2026-10-17.
- `PUT /Invoices/{id}/History`: "Clearline: 450.00 of 600.00 USDC received on Ethereum. Short by 150.00. Waiting for a decision: request the balance or accept as fees."

INV-2003 stays **open with 150.00 due**.

**Code today:** `ready`, `leavesOpen` true. Lines: payment 450.00, account 091, date 2026-10-17, plus a note line (amount 0) with the text above [VERIFIED: probe 2026-11-01]. It matches.

## Case 4: ORG-A, INV-2004, 500.00 USD, two transfers totalling 500.009567 (rules C8 and C7)
Both transfers are dated **2026-10-18**: 01:00Z = 09:00 SGT and 01:20Z = 09:20 SGT.

Running total:

| Transfer | Applied to invoice | Running total | Posted |
|---|---|---|---|
| 200.004567 | 200.004567 | 200.004567 → rounded down to 200.00 | 200.00 |
| 300.005000 | 299.995433 | 500.000000 = invoice, so it closes exactly at 500.00 | 300.00 |
| Excess | 0.009567 | under 1 cent | not a line |

| Account | Dr | Cr | Date |
|---|---|---|---|
| 091 USDC Clearing - Ethereum | 200.00 | | 2026-10-18 |
| 610 Accounts Receivable (INV-2004) | | 200.00 | 2026-10-18 |
| 091 USDC Clearing - Ethereum | 300.00 | | 2026-10-18 |
| 610 Accounts Receivable (INV-2004) | | 300.00 | 2026-10-18 |

**Xero records:** two `PUT /Payments` (200.00 and 300.00, Account 091), each with its own tx hash in the Reference. INV-2004 is **paid**.

The 0.009567 USDC stays in the wallet and is not booked. The daily wallet reconciliation picks it up (POSTING_RULES §6). Later it is booked as Dr 091 / Cr Rounding. ORG-A's fixture chart lists no rounding account, though Xero has a system `ROUNDING` account type [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `SystemAccount` enum]. Which code to use in ORG-A has to be read from `GET /Accounts`.

**Code today differs (D2).** Status is **`needs_decision`**. Lines: payment 200.00, payment 300.00, and **overpayment 0.00**, all on account 091 [VERIFIED: probe 2026-11-01].
- Nothing posts until a person chooses "refund" or "keep" for under 1 cent of USDC.
- Even with no decision, the overpayment body already carries Reference "To refund · …", because `rules.ts:207` defaults to "refund" when the excess isn't kept.
- If someone does decide, `xeroBody` sends a `RECEIVE-OVERPAYMENT` with `LineAmount` 0. I expect Xero to reject a zero-value bank transaction [ASSUMPTION: not tested in the Demo Company]. If it does, the run fails *after* the two payments posted (`PartialPostError`), and someone has to clean up by hand.
- A refund of 0.009567 USDC would cost more in gas than it is worth.

## Case 5: ORG-A, INV-2005, 750.00 USD, 800.00 received, Mei chose refund_excess (rule C5)
Block time 2026-10-20T16:05:00Z = **21 Oct 00:05 SGT**. **Posting date 2026-10-21.**

| Account | Dr | Cr |
|---|---|---|
| 091 USDC Clearing - Ethereum | 800.00 | |
| 610 Accounts Receivable (INV-2005) | | 750.00 |
| 610 AR: Acme overpayment credit, "To refund" (CRD) | | 50.00 |

**Xero records:**
1. `PUT /Payments`: INV-2005, Account 091, Amount 750.00, Date 2026-10-21.
2. `PUT /BankTransactions`: Type `RECEIVE-OVERPAYMENT`, `BankAccount.Code` 091, Contact = customer, `LineAmount` 50.00, Date 2026-10-21.

Xero holds the overpayment as a credit on the contact, so it sits against AR 610. INV-2005 is **paid**, and the customer has a **50.00 credit to refund**.

**Code today:** `ready`. Lines: payment 750.00, account 091, **date 2026-10-20**, and overpayment 50.00, account 091, **date 2026-10-20** [VERIFIED: probe 2026-11-01].
- The amounts and accounts are right. Both dates are **one day early** (D1): 00:05 SGT books to the previous day.
- The "To refund" label goes into `Reference`. Xero says that field is "Only supported for SPEND and RECEIVE transactions" [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, BankTransaction.Reference], so the label may be dropped (D7). It survives in the line description.

### Case 5: the later refund (the business does this itself; Clearline never moves funds)
Refund sent 2026-10-23. The fixture gives a date only. I've taken it to be the SGT date of the refund's block time [ASSUMPTION].

| Account | Dr | Cr |
|---|---|---|
| 610 AR: Acme overpayment credit (CRD) | 50.00 | |
| 091 USDC Clearing - Ethereum | | 50.00 |
| 405 Blockchain Network Fees | 0.78 | |
| 093 ETH for network fees | | 0.78 |

**Gas:** 0.00031 ETH × 2,500.00 = **0.775 USD exactly**, rounded **half-up to 0.78** (the write-off rule R3b, applied to an expense). This assumes 093 carries ETH at 2,500.00. If the ETH's carrying amount is different, the difference is a gain or loss on disposing of ETH. That is an accounting-policy question for Aashmiin [ASSUMPTION].

**Xero records** (a person records these, not Clearline):
- Refund: `PUT /Payments` with `Overpayment: {OverpaymentID}`, Account 091, Amount 50.00, Date 2026-10-23. The PaymentType comes back as `AROVERPAYMENTPAYMENT` [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `Payment.Overpayment`, PaymentType enum].
- Gas: 093 is a current asset, not a bank account, so it needs a **manual journal**: `PUT /ManualJournals`, LineAmount +0.78 on 405 and −0.78 on 093 ("Debits are positive, credits are negative" [VERIFIED: same spec, ManualJournalLine.LineAmount]), Date 2026-10-23.

**Code today:** Clearline does not prepare or post refunds or gas. `LineKind` is only payment, fee_writeoff, overpayment or note (`types.ts`) [VERIFIED: code @0c7d9f1]. See open question Q-C13.

## Case 6: ORG-B (SGD base), INV-3001, 2,000.00 USD, exact, FX (rule C15)
Block time 2026-10-28T02:00:00Z = 28 Oct 10:00 SGT. **Posting date 2026-10-28.**

- Invoice at 1.2900 → AR SGD 2,580.00.
- Receipt at 1.3050 → SGD 2,610.00.
- Difference: realised FX **gain of SGD 30.00**. The receivable was in USD, and USD was worth more SGD on the day it was settled.

| Account | Dr | Cr |
|---|---|---|
| 091 USDC Clearing - Ethereum (USD 2,000.00) | SGD 2,610.00 | |
| 610 Accounts Receivable (INV-3001, USD 2,000.00) | | SGD 2,580.00 |
| FXG Realised Currency Gains | | SGD 30.00 |

Totals: Dr 2,610.00 = Cr 2,580.00 + 30.00.

**Xero record:** **one** `PUT /Payments`:
- Invoice INV-3001, Account 091 (a USD bank account), Amount 2000.00 (in the invoice currency), Date 2026-10-28.
- Xero converts the payment and books the realised gain to its system realised-currency-gain account itself. Clearline posts no FXG line. The `REALISEDCURRENCYGAIN` system account type exists [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. The mechanics of how Xero books it are [ASSUMPTION].
- **Rate:** `Payment.CurrencyRate` is "Exchange rate when payment is received. Only used for non base currency invoices and credit notes e.g. 0.7500" [VERIFIED: same spec].
  - To get exactly 1.3050, Clearline would have to send it.
  - The spec's example suggests the rate is foreign currency per one unit of base (1 SGD = 0.766284 USD, which is 1/1.3050 rounded to 6 dp). I have not confirmed this [ASSUMPTION]. Sent that way, Xero may produce SGD 2,609.998… → 2,610.00. Re-rounding is a risk.
  - If no rate is sent, Xero uses its own rate for that day, and the gain will not be exactly 30.00.
  - **Open question Q-C15a for Aashmiin:** which rate source?

INV-3001 is **paid**.

**Code today:** `ready`, payment 2000.00, **account 090**, date 2026-10-28 [VERIFIED: probe 2026-11-01, default accounts]. Problems:
1. **The post will fail or land in the wrong account.** ORG-B has no `clearlineAccounts`, so the default `walletAccountCode` "090" applies (`types.ts:124`). ORG-B's chart has no 090. Expect Xero's 400 "Account code '090' is not a valid code for this document", which is exactly REQ-133 in Task 4. If a 090 did exist (Xero's spec examples show 090 as a bank account called "My Savings" [VERIFIED: same spec, examples only]), the receipt would land in the wrong account.
2. No `CurrencyRate` is sent. The code never reads `BaseCurrency` and never checks that 091 is a USD account (D6, which needs scope `accounting.settings.read`).
3. The default `feeAccountCode` "404" doesn't exist in ORG-B either. That would break any shortfall write-off there.

---

## ORG-A totals, cases 1-5 (spec journals, refund excluded)

| Account | Dr | Cr |
|---|---|---|
| 091 USDC Clearing - Ethereum (1,250.00 + 450.00 + 200.00 + 300.00 + 800.00) | 3,000.00 | |
| 092 USDT Clearing - Tron | 979.65 | |
| 404 Bank Fees | 0.35 | |
| 610 AR, invoices (1,250.00 + 980.00 + 450.00 + 500.00 + 750.00) | | 3,930.00 |
| 610 AR, customer overpayment credit (INV-2005) | | 50.00 |
| **Total** | **3,980.00** | **3,980.00** |

Debits equal credits: 3,980.00 = 3,980.00.

**What is left open afterwards:**
- INV-2003 still has 150.00 due.
- The INV-2005 customer has a 50.00 credit waiting to be refunded.
- So, starting from AR of 4,080.00 invoiced, AR for these customers moves by −3,980.00 and is left at **100.00** net: 150.00 due less the 50.00 credit.

**Wallet check:** 091 on-chain = 3,000.009567 USDC against 3,000.00 booked. The 0.009567 is case 4's residual, which goes to the wallet reconciliation.

**What the code today would book instead:**
- Case 2 nothing (Tron), or, if a person forced it, into 091.
- Case 4 blocked.
- Cases 2 and 5 dated one day early.

## Follow-ups (for tech-lead-architect's plan; all approval-only)
1. D1 date fix (Task 2).
2. Wallet account per token and network (D8), so that 092 is used.
3. Ignore residuals under 1 cent instead of creating a 0.00 overpayment (D2).
4. Read `GET /Organisation` and `GET /Accounts` and block on an unknown account code, base currency or wallet currency (D6).
5. Questions for Aashmiin: Q-C3 (GST on 0.35), Q-C13 (should Clearline prepare refund entries?), Q-C15a (FX rate source), and how to measure the ETH used for gas.
