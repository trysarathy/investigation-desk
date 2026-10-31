# Task 7: an SGD-based customer (for Aashmiin)

Fixture: Xero Demo Company, **base currency SGD**, timezone Singapore, multi-currency on, USD enabled. Rates are made
up by the fixture.

Both receipts are on 31 Oct SGT: 02:00Z = 10:00 SGT and 02:30Z = 10:30 SGT. So the date is **2026-10-31**, and the UTC
bug (D1) doesn't change it for these two.

## Short answer
- **Today:**
  - Receipt 1 would post to the **wrong account**: your SGD business bank account 090, not the USD USDC wallet 091.
  - Receipt 2 can't be handled by Clearline at all. It goes to a person.
- **What should happen:**
  - Receipt 1: a USD 5,000.00 payment from 091. Xero books a **S$50.00 realised FX loss** itself.
  - Receipt 2: you decide what the S$50.00 gap is.
- **Settings to fix:** wallet account 090 → 091, plus the checks Clearline doesn't do yet.

## 1. What Clearline does today [VERIFIED: code @0c7d9f1, read 2026-11-01]
**Receipt 1: 5,000 USDC for INV-4101 (USD 5,000.00).**
- `planPosting` sees a USD invoice and an exact payment, so the plan is `ready` with one line: payment 5000.00, account
  `walletAccountCode` = **090**, date 2026-10-31.
- `xeroBody` sends `PUT /Payments` with `Account {Code: "090"}`, `Amount 5000`, **no `CurrencyRate`**. Clearline never
  reads the org's `BaseCurrency` or 090's currency (D6).
- 090 is "Business Bank Account", **SGD**. A USD payment received into an SGD account means Xero either rejects it or
  converts at its own rate and records ≈ S$6,450.00 arriving in the SGD bank account
  [ASSUMPTION: Xero's exact behaviour for a base-currency account paying a foreign-currency invoice, untested].
- If it posts:
  - The SGD bank account shows S$6,450 that never reached that bank, so its bank reconciliation breaks.
  - The USDC wallet 091 shows nothing, although the USDC is there.
  - The total is still balanced, but it sits in the wrong asset.
- The line text says "USD value 5000.00 at 1.00 (par: … no price feed connected)" (D4).

**Receipt 2: 5,000 USDC for INV-4102 (SGD 6,500.00).**
- `importInvoice` refuses SGD invoices ("INV-4102 is in SGD: only USD invoices for now"), so no payment request is
  made from it. If a link existed, `planPosting` returns `blocked`: "Only USD invoices are posted automatically for
  now… Post it by hand."
- Clearline can still verify the transfer on-chain (tx-hash check), but **nothing posts**. A person handles it (C15).

## 2. The entries that should result (SGD base; amounts USD and SGD to the cent)

### Receipt 1: INV-4101, USD 5,000.00, invoiced at 1.3000 → carried in AR at S$6,500.00
Received 31 Oct at Xero's daily rate 1.2900 → 5,000.00 × 1.2900 = **S$6,450.00** (exact, no rounding needed).

| | Account | Dr | Cr |
|---|---|---|---|
| 1 | 091 USDC wallet – Ethereum (USD bank) | USD 5,000.00 = **S$6,450.00** | |
| 2 | Realised currency gains/losses (Xero system account) | **S$50.00** (loss) | |
| 3 | AR Acme, INV-4101 | | USD 5,000.00 = **S$6,500.00** |

Σ Dr S$6,500.00 = Σ Cr S$6,500.00.

Xero record: one `PUT /Payments`: Invoice INV-4101, `Account {Code:"091"}`, `Date 2026-10-31`, `Amount 5000.00` (in the
invoice currency, USD), Reference "USDC on Ethereum · tx … · @1.00 USD".
- With `CurrencyRate` omitted, Xero applies its own rate for the date. `Payment.CurrencyRate` is "only used for non
  base currency invoices", which this is [VERIFIED: accounting-integrations-engineer 2026-11-01, Xero OpenAPI 19.1.0].
- That an omitted rate on a **Payment** falls back to Xero's day rate is [ASSUMPTION]. The spec states that fallback
  for `BankTransaction.CurrencyRate`, not for Payment.
- **If we ever send the rate explicitly**, Xero's rate convention must be checked first. I believe Xero quotes
  foreign units per 1 base unit, i.e. 1 / 1.2900 = 0.775194 USD per SGD, not 1.2900 [ASSUMPTION: not verified].
  Sending 1.29 under the wrong convention would value the receipt at roughly S$3,876 instead of S$6,450.

Xero books the S$50.00 realised loss itself; Clearline posts no FX line.
**Invoice balance after: USD 0.00, PAID.**
This is a genuine FX loss: you invoiced in USD and the dollar fell between 1 Oct and 31 Oct. It is not a shortfall and
needs no write-off decision.

### Receipt 2: INV-4102, **S$6,500.00**, paid with USD 5,000.00 USDC
At Xero's daily rate 1.2900 the USDC is worth **S$6,450.00**, so the payment is **S$50.00 short** of the invoice. The
payer says "5,000 USDC = S$6,500 at the rate I saw on my exchange" (an implied 1.3000). That is an unverified, unnamed
rate from the payer, and Clearline never books on a number like that.

Options (all posted **by a person**, per C15):
- **A. Partial; ask for the balance** (the default if you don't decide):

  | | Account | Dr | Cr |
  |---|---|---|---|
  | 1 | 091 USDC wallet | USD 5,000.00 = S$6,450.00 | |
  | 2 | AR INV-4102 | | S$6,450.00 |

  **Balance after: S$50.00 due**, open. Asking the payer for 38.76 USDC covers it at 1.2900 (50 ÷ 1.29 = 38.7597 →
  38.76, rounded up so it covers; 38.76 × 1.29 = S$50.0004).
- **B. Accept as settled; the S$50 is an FX loss:**

  | | Account | Dr | Cr |
  |---|---|---|---|
  | 1 | 091 USDC wallet | S$6,450.00 | |
  | 2 | FX loss (or Payment shortfalls) | S$50.00 | |
  | 3 | AR INV-4102 | | S$6,500.00 |

  **Balance after: S$0.00, PAID.**
- **C. Accept as settled; the S$50 is a price reduction:** the same lines, but the S$50 goes on a credit note. If
  INV-4102 carried GST, that reduces output GST (Q-C3).
- **Not recommended:** booking the wallet at S$6,500 using the payer's 1.30. Xero values the USD wallet at its own
  rate, so the wallet would be overstated by S$50 against Xero's own revaluation, and the rate source is unnamed.

How a person enters it in Xero: Xero normally pays an invoice only from a bank account in the invoice's currency or
the base currency [ASSUMPTION: to confirm in the Demo Company]. 091 is USD and the invoice is SGD, so:
1. Use an SGD "USDC conversion clearing" bank account: a Payment on INV-4102 from it for S$6,450.00 (Dr Clearing /
   Cr AR).
2. Then a bank transfer of USD 5,000.00 into 091 against it at 1.2900 (Dr 091 S$6,450 / Cr Clearing S$6,450).

Net: Dr 091 / Cr AR S$6,450.00, and the clearing account goes back to 0. Under option B or C, the S$50 is then a credit
note or write-off. I would test this in the Demo Company before writing it into the spec.

## 3. Settings that are wrong
| Setting | Now | Should be | Why |
|---|---|---|---|
| `walletAccountCode` | **090** "Business Bank Account" (SGD) | **091** "USDC wallet – Ethereum (test)" (USD) | The tokens are in the wallet, not in the SGD bank; the receipt must land in a USD account |
| `feeAccountCode` | 404 | 404 only if it exists and is an active expense in this org | Not in the fixture's account list. Read `GET /Accounts` and block if it's missing |
| Organisation not read | — | Read `BaseCurrency`, `Timezone`, lock dates, `IsDemoCompany`; scope `accounting.settings.read` | D6 |
| No wallet-currency check | — | Block when the wallet account's `CurrencyCode` ≠ the invoice currency (and it isn't payments-enabled for it) | Would have caught 090 |
| One wallet account | 090 for everything | One per token + network (+ address) | D8. Can't reconcile otherwise |
| Rate | par 1.00, no feed | A named price source; FX source named on every line | D4, R4 |

## 4. What you need to decide
1. **Change the wallet account to 091?** In code this is the Clearline accounts setting. I won't change it until you
   say so.
2. **Q-C15a, FX source for USD invoices:** accept Xero's daily rate (XE.com) for the posting date, or supply another
   source (e.g. MAS reference rate)? Which one an SG company should use for GST/tax I haven't researched.
3. **Q-C15b, SGD invoices paid in USDC:** keep them always by hand, or have a signed rule (rate source, date,
   tolerance)?
4. **INV-4102's S$50.00:** A (ask for the balance), B (FX loss), or C (price reduction, GST effect)?
5. **Q-A1:** how the USDC wallet is presented in the statements (cash equivalent vs another current asset). The
   accounting-standards material is all [ASSUMPTION: secondary] today.

For the real customer: during the pilot they get a Xero-ready import file their accountant imports. This analysis
tells us what that file must contain for an SGD-base org: USD payments from the USD wallet account, SGD invoices
flagged for a person.

Log row: `accounting-integrations-engineer | advice: SGD-base org | t7 | wallet 090→091 needed; C15 questions to Aashmiin`.
