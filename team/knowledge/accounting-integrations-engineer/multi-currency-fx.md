# Multi-currency and FX

Three currencies can be involved in one receipt: the **token** (USDC/USDT, a dollar token), the **invoice
currency**, and the organisation's **base currency** (a Singapore company is often SGD-base).

## What the code does today [VERIFIED: code @0c7d9f1, read 2026-11-01]
- `importInvoice` and `planPosting` accept **only USD invoices**; anything else is `blocked`: "Post it by hand".
- Each token is valued with `parPrice` = 1.00 USD, source text "par: 1 USDC = 1.00 USD (no price feed
  connected)". The line records `usdRate` and `usdRateSource`. A price more than 0.5% off par would block, but
  **no price feed is ever passed** (`service.ts`), so the guard is inert (D4).
- The Xero payment carries no `CurrencyRate` and no `BankAmount`; nothing reads the org's `BaseCurrency`.

## What Xero does [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01 unless marked]
- `Payment.CurrencyRate`: "Exchange rate when payment is received. Only used for non base currency invoices and
  credit notes." `Payment.BankAmount`: "amount of the payment in the currency of the bank account."
- `BankTransaction.CurrencyRate`: if not given for a non-base-currency account, "either the user-defined rate
  (preference) or the XE.com day rate will be used."
- System accounts `REALISEDCURRENCYGAIN`, `UNREALISEDCURRENCYGAIN`, `BANKCURRENCYGAIN` exist: Xero books FX
  differences itself when a foreign-currency invoice is paid at a different rate from the invoice rate
  [ASSUMPTION for the exact mechanics; the account types are VERIFIED].
- Multi-currency needs a Xero plan that has it [ASSUMPTION].

## The cases
| Invoice | Org base | Wallet account | What should happen (proposal, POSTING_RULES R11) |
|---|---|---|---|
| USD | USD | USD bank | Today's rules. Rate 1.00 per token (par), no FX |
| USD | SGD | **USD** bank account (USDC wallet) | Payment of the USD amount from the USD account. Xero converts both invoice and payment to SGD at its rates and books realised FX on the AR difference. FX source = Xero's rate for the **org-local posting date** unless the accountant sets one. Clearline must check the wallet account's `CurrencyCode` = USD and USD is enabled; else block |
| SGD | SGD | USD bank | A USD receipt against an SGD invoice is a cross-currency settlement. Needs a person: amount in SGD = USD × rate, the rate source and date stated, and any difference treated as short/over or FX. **Never automatic** until she signs a rule |
| EUR, etc. | any | USD bank | Same as above: to a person |

## FX rate rules (proposal)
1. Source named on every line (`usdRateSource`, plus `fxRateSource`): "Xero daily rate (XE.com) for 2026-10-31"
   or "MAS reference rate…" etc. Never an unnamed number. [ASSUMPTION: which rate an SG company must use for
   GST/tax is a question for her; not researched]
2. Date = the posting date rule (org-local date of the block time).
3. Rounding: convert, then round half-up to 2 dp in the invoice currency; residual < 0.01 goes to Xero's rounding
   (or is left to Xero's FX booking). Never round twice.
4. Stablecoin to USD: par only within the 0.5% band, and only once a real price feed is wired; otherwise the line
   says "par, no price feed" honestly.

## Tests a change must add
USD invoice in SGD org with USD wallet → no `CurrencyRate` sent (Xero's rate) **or** the signed source; wallet
account currency ≠ invoice currency → blocked with a reason; SGD invoice → blocked; depeg price 0.994 → blocked;
price feed error → unknown → waiting, not par.
