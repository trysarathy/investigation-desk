# Xero Accounting API: what we use and what it says

**Source situation on 2026-11-01:** `developer.xero.com` is **blocked** in this session (DNS refused by the
network policy), so the human-readable docs pages (OAuth 2.0 overview, limits, Payments, Invoices, Bank
Transactions, Manual Journals, Accounts, Organisation, Currencies, Demo Company) were **not opened**. The
primary source used instead is **Xero's own OpenAPI spec**, published by Xero in the `XeroAPI` GitHub org:
`https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml`
(`info.version: 19.1.0`, 933,096 bytes), plus Xero's SDK README
`https://raw.githubusercontent.com/XeroAPI/xero-node/master/README.md`. Both are Xero's own
publications, so facts from them are [VERIFIED]. Short form used below:
**[VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]** = the spec URL above.
Search-engine summaries are `[ASSUMPTION: secondary, <source>]`. First job when the host is allowed:
open the docs pages and re-label (refresh checklist in `README.md`).

## Base
- Base URL `https://api.xero.com/api.xro/2.0`; every call needs header `xero-tenant-id` (required)
  [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `parameters.requiredHeader`].
- OAuth 2.0 authorization code: authorize `https://login.xero.com/identity/connect/authorize`, token
  `https://identity.xero.com/connect/token` [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `securitySchemes`].
- Tokens: access token is a JWT with **30-minute** expiry (`expires_in: 1800`); refresh token **60-day**
  expiry [VERIFIED: https://raw.githubusercontent.com/XeroAPI/xero-node/master/README.md opened 2026-11-01].
  The refresh token is replaced on each use [ASSUMPTION: not in the opened files; the code's lock comment
  says so].
- `summarizeErrors=false` returns 200 with a mix of created objects and ones with `ValidationErrors`
  [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `parameters.summarizeErrors`]. Our adapter does not send
  it (default false) and posts one object per call, so check `ValidationErrors` on a 200 anyway.

## Scopes (spec list, version 19.1.0)
`openid`, `profile`, `email`, `accounting.transactions` ("read-write access to bank transactions, credit notes,
invoices, repeating invoices"), `accounting.transactions.read`, `accounting.contacts(.read)`,
`accounting.settings(.read)` ("organisation and account settings"), `accounting.journals.read`,
`accounting.reports.read`, `accounting.attachments(.read)`, `accounting.budgets.read`, `paymentservices`
[VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. `offline_access` (for a refresh token) is not in the spec list
[ASSUMPTION: standard OIDC; the code requests it].
- **We need `accounting.settings.read`** to read `GET /Organisation` (Timezone, BaseCurrency, lock dates) and
  `GET /Accounts` (to validate account codes). The code doesn't request it today (codebase-map D6).
- Granular scopes: for apps created **on or after 2 March 2026**, `accounting.transactions` is split into
  `accounting.invoices`, `accounting.payments`, `accounting.banktransactions`, `accounting.manualjournals`;
  existing apps must move before 13 Sep 2027 [ASSUMPTION: secondary, search summary of
  devblog.xero.com "Upcoming changes to Xero Accounting API scopes" and apideck.com/blog/xero-scopes; not
  in spec 19.1.0]. Aashmiin's developer app will be new, so plan for granular scopes:
  `openid profile email offline_access accounting.invoices accounting.payments accounting.banktransactions
  accounting.contacts.read accounting.settings.read` (set `XERO_SCOPES`). Confirm on the scopes page.

## Organisation (`GET /Organisation`)
Fields we need [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `components.schemas.Organisation`]:
- `Timezone`: `$ref TimeZone`, an **enum of Windows-style zone names, upper-cased, no spaces**, e.g.
  `SINGAPORESTANDARDTIME`, `NEWZEALANDSTANDARDTIME`, `EASTERNSTANDARDTIME`, `UTC` (132 values). The spec's own
  example response has `Timezone: NEWZEALANDSTANDARDTIME`, `BaseCurrency: NZD`. **Not IANA.** We must map it
  (see `timezone-cutoff.md`).
- `BaseCurrency` (CurrencyCode), `CountryCode`, `IsDemoCompany` (boolean: "if organisation is a demo company"),
  `Class` (includes `DEMO`), `FinancialYearEndDay`, `FinancialYearEndMonth`, `PeriodLockDate`,
  `EndOfYearLockDate` ("Shown if set"), `OrganisationStatus`.
- **Use `IsDemoCompany` as a hard guard**: until Aashmiin switches live posting on, the adapter must refuse
  to post when `IsDemoCompany !== true`.

## Records we write
| Record | Path | Fields that matter (spec quotes) |
|---|---|---|
| Payment | `PUT /Payments` | `Invoice`, `Account` (or `Code`), `Date` "Date the payment is being made (YYYY-MM-DD)", `Amount` "Must be less than or equal to the outstanding amount owing on the invoice", `CurrencyRate` "Exchange rate when payment is received. Only used for non base currency invoices and credit notes", `BankAmount` "amount of the payment in the currency of the bank account", `Reference`, `IsReconciled`, `Status` AUTHORISED/DELETED, `PaymentType` incl. `ACCRECPAYMENT`, `AROVERPAYMENTPAYMENT`. A Payment can also reference an `Overpayment` or `CreditNote` (used for refunds) |
| Credit note + allocation | `PUT /CreditNotes`, `PUT /CreditNotes/{CreditNoteID}/Allocations` | Allocation: `Invoice`, `Amount` "the amount being applied to the invoice", `Date` "the date the allocation is applied YYYY-MM-DD" |
| Bank transaction | `PUT /BankTransactions` | `Type` enum RECEIVE, **RECEIVE-OVERPAYMENT**, RECEIVE-PREPAYMENT, SPEND, SPEND-OVERPAYMENT, SPEND-PREPAYMENT, RECEIVE-TRANSFER, SPEND-TRANSFER. `Reference`: "**Only supported for SPEND and RECEIVE transactions.**" `CurrencyRate`: "If this isn't specified for non base currency accounts then either the user-defined rate (preference) or the XE.com day rate will be used. Setting currency is only supported on overpayments." `OverpaymentID` returned for RECEIVE-OVERPAYMENT |
| Overpayment allocation | `PUT /Overpayments/{OverpaymentID}/Allocations` | Applying a kept credit to a later invoice |
| Invoice history | `PUT /Invoices/{InvoiceID}/History` | `HistoryRecords[].Details` |
| Manual journal | `PUT /ManualJournals` | `Narration`, `Date` "Date journal was posted – YYYY-MM-DD", `Status` DRAFT/POSTED/…, `JournalLines[].LineAmount` "**Debits are positive, credits are negative**", `AccountCode`, `TaxType`, `Tracking` (max 2). `ShowOnCashBasisReports` defaults true. We don't post journals today; a DRAFT journal is the safe way to propose an unusual entry for a person to post |

All schema rows [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01].

## Accounts (`GET /Accounts`)
`Code` (max 10), `Type`, `BankAccountType` (BANK, CREDITCARD, PAYPAL, NONE), `CurrencyCode`,
`EnablePaymentsToAccount` ("whether account can have payments applied to it"), `Class` (ASSET, EQUITY,
EXPENSE, LIABILITY, REVENUE), `SystemAccount` enum incl. `DEBTORS`, `BANKCURRENCYGAIN`,
`REALISEDCURRENCYGAIN`, `UNREALISEDCURRENCYGAIN`, `ROUNDING` [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01].
- So a payment can go to a non-bank account only if `EnablePaymentsToAccount` is true; a
  RECEIVE-OVERPAYMENT needs a `BankAccount`. Before posting, read `GET /Accounts` and check the wallet code
  exists, is ACTIVE, and is a BANK account in the invoice's currency (or payments-enabled).
- Default codes in our code (`090` wallet, `404` Bank Fees) follow "Xero's demo company chart" per a code
  comment [ASSUMPTION: Demo Company chart not opened]. The spec's examples show `090` as a bank account
  named "My Savings" and `610` as "Accounts Receivable" [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01,
  examples only, not proof of the Demo Company chart]. Read the real codes from the Demo Company.

## Currencies
`GET /Currencies` lists the org's enabled currencies [VERIFIED: path exists in Xero OpenAPI 19.1.0 opened
2026-11-01]. A USD invoice in a non-USD-base org needs USD enabled, which needs a Xero plan with
multi-currency [ASSUMPTION: plan feature not checked].

## Idempotency
Header `Idempotency-Key`: "This allows you to safely retry requests without the risk of duplicate processing.
**128 character max.**" [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. How long Xero remembers a key, and
what it returns for a reused key with a different body, is **not stated in the spec** [ASSUMPTION: check the
idempotency page on developer.xero.com]. Our keys are `clearline-<32 hex>-<i>[-alloc]` ≈ 44-50 chars: fine.

## Rate limits (docs page blocked)
Per organisation: 5 concurrent calls, 60 calls/minute, 5,000 calls/day; app-wide 10,000 calls/minute across
tenants; over the limit → HTTP 429 [ASSUMPTION: secondary, search summary of developer.xero.com/faq/limits and
cdata.com driver docs]. Header names (`Retry-After`, `X-Rate-Limit-Problem`, `X-MinLimit-Remaining`…) were **not
confirmed**. Design so the numbers don't matter: see `rate-limits-idempotency.md`.

## Demo Company (docs blocked)
Pre-filled sample organisation; resets **28 days** after creation (and can be reset by hand), deleting
entered data, after which apps must reconnect [ASSUMPTION: secondary, search summary of approvalmax.com and
unified.to help pages; Xero's own help page not opened]. Consequence: re-create test invoices at the start
of every sandbox run; never rely on yesterday's IDs.
