# Journal-entry patterns for stablecoin receipts

Double entry: every posting's debits equal its credits, to the cent. Debits increase assets and expenses;
credits increase liabilities, equity and revenue, and decrease assets such as Accounts Receivable
[ASSUMPTION: secondary, Modern Treasury docs "Debits and Credits" search summary; also standard textbook
double entry]. Xero manual journals encode this as signed amounts: "Debits are positive, credits are negative"
[VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, ManualJournalLine.LineAmount].

The **signed spec is `docs/POSTING_RULES.md`**; this file explains the patterns and the Xero/QBO record that
produces each. Amounts are examples; INV-1042 for 5,000.00 USD, Acme Pte Ltd.

## Accounts used
| Ref | Account | Xero | Today in code |
|---|---|---|---|
| WAL | USDC wallet – <network> <address> | BANK account, currency USD | `walletAccountCode` "090", one for all |
| AR | Accounts Receivable (Acme) | system DEBTORS | via the invoice |
| FEE | Payment shortfalls / bank fees | EXPENSE | `feeAccountCode` "404" |
| CRD | Customer credit (overpayment) | Xero overpayment on the contact (sits against AR) | RECEIVE-OVERPAYMENT into WAL |
| RND | Rounding | system ROUNDING | not used |
| FXG | Realised currency gains/losses | system REALISEDCURRENCYGAIN | not used (Xero books it) |
| GAS | Network fees (gas we pay) | EXPENSE | not used |
| SUS | Stablecoin suspense (unallocated receipts) | BANK or ASSET | not used (proposal) |

## Patterns
1. **Exact**: Dr WAL 5,000.00 / Cr AR 5,000.00. Xero: one Payment on the invoice, Account = WAL. QBO: Payment
   linked to invoice, DepositToAccountRef = WAL.
2. **Partial (no decision yet, or balance requested)**: Dr WAL 4,950.00 / Cr AR 4,950.00. Invoice stays open
   50.00; history note. Only what arrived is posted.
3. **Under after fees, accepted as settled**: Dr WAL 4,950.00; Dr FEE 50.00 / Cr AR 5,000.00. Xero: Payment
   4,950.00 + credit note (ACCRECCREDIT, line to FEE, NoTax) 50.00 allocated to the invoice. GST question: a
   credit note can read as a price reduction (output-tax adjustment) whereas an exchange fee is a cost
   [ASSUMPTION; her call].
4. **Overpaid** (excess 0.50, refund or keep): Dr WAL 5,000.50 / Cr AR 5,000.00; Cr CRD 0.50. Xero: Payment
   5,000.00 + RECEIVE-OVERPAYMENT 0.50 into WAL. Nothing posts until a person picks refund or keep.
5. **Refund of an overpayment** (later, a person sends tokens back): Dr CRD 0.50 / Cr WAL 0.50; gas Dr GAS / Cr
   native-coin wallet. Xero: a Payment against the Overpayment (Payment has an `Overpayment` field,
   PaymentType AROVERPAYMENTPAYMENT) [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. **Clearline never sends
   the refund and does not post it today.**
6. **Kept credit used on the next invoice**: Xero `PUT /Overpayments/{id}/Allocations` [VERIFIED path exists].
7. **Multi-invoice** (one transfer pays INV-1 3,000 + INV-2 2,000): Dr WAL 5,000.00 / Cr AR(INV-1) 3,000.00;
   Cr AR(INV-2) 2,000.00. Two Payments, same date, same tx hash in each Reference. Only after a person confirms
   the split; never by guessing from amounts.
8. **Sub-cent residuals**: tokens have 6 (or 18) decimals; books have 2. Payment lines are floored against the
   running total so the books never show more than arrived. A residual under one cent stays in the wallet's
   on-chain balance; book it with a periodic wallet-reconciliation adjustment (Dr WAL / Cr RND) rather than one
   0.00 line per payment.
9. **Wrong token / wrong network that is genuinely ours**: a person posts by hand to the right wallet account
   (e.g. "USDT wallet – Tron"), or to SUS until decided. Never automatic.
10. **Counterfeit, failed, look-alike (sent to an attacker's address)**: nothing arrived, nothing posts; the
    invoice stays open. No entry.
11. **Reversal**: never edit or delete history silently. In Xero a Payment can be set `Status: DELETED`
    [VERIFIED: enum in Xero OpenAPI 19.1.0 opened 2026-11-01], which removes it; a reversing manual journal keeps
    the trail. Either is a person's decision (deletion is approval-only).

## Invariants to test for every pattern
Σ debits = Σ credits; Σ payment lines ≤ tokens received × rate (floored); invoice due after posting = what the
plan says it will be (to the cent); every line has a date in the org timezone; every line has a source
(tx hash, logIndex, rate source).
