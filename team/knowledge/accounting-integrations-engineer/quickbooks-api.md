# QuickBooks Online (QBO) API: what we use and what we know

**Status:** code exists (`src/lib/accounting/providers/quickbooks.ts`), **not offered**, never run against
a sandbox company [VERIFIED: code @0c7d9f1 header comment, read 2026-11-01]. Xero first; QuickBooks next.

**Source situation on 2026-11-01:** `developer.intuit.com` and `blogs.intuit.com` are **blocked** in this
session. Opened instead (Intuit's own GitHub publications):
- `https://raw.githubusercontent.com/intuit/oauth-jsclient/master/README.md` (Intuit's OAuth client)
- `https://raw.githubusercontent.com/intuit/QuickBooks-V3-DotNET-SDK/master/README.md`
- `https://raw.githubusercontent.com/intuit/QuickBooks-V3-Java-SDK/develop/README.md`
Everything else below is [ASSUMPTION] until the Intuit docs pages are opened.

## OAuth 2.0
- Environments `sandbox` and `production` [VERIFIED: intuit/oauth-jsclient README opened 2026-11-01].
- "Access tokens are valid for 3600 seconds (one hour)… always use the refresh token returned in the most
  recent token_endpoint response. Your previous refresh tokens expire 24 hours after you receive a new one."
  [VERIFIED: intuit/oauth-jsclient README opened 2026-11-01].
- Errors carry an `intuit_tid` transaction id for support; `invalid_grant` = re-authorise; 401 = invalid or
  expired access token [VERIFIED: same README].
- Development keys work with sandbox companies and the sandbox base URL [VERIFIED:
  intuit/QuickBooks-V3-DotNET-SDK README opened 2026-11-01].
- **Gap in our code:** `service.ts` reads a static `QBO_ACCESS_TOKEN` from the environment, so the adapter
  stops working one hour after the token was minted. A real QBO connection needs the same refresh-in-a-lock
  design as `xero-auth.ts`, and the realm id from the OAuth callback (codebase-map D10).

## Base URL and minor versions
- Sandbox `https://sandbox-quickbooks.api.intuit.com/v3/company/<realmId>`, production
  `https://quickbooks.api.intuit.com/...` [VERIFIED: code; ASSUMPTION that these match Intuit's docs].
- Intuit deprecated minor versions 1-74 from 1 Aug 2025; lower or missing `minorversion` is served as 75
  [ASSUMPTION: secondary, search summary of blogs.intuit.com/?p=34635 and codat.io]. Our code sends
  `minorversion=75`.

## Idempotency: `requestid`
- Query parameter `requestid` on writes; a repeated id returns the original response instead of creating a
  duplicate; unique per company; max 50 characters for non-batch operations (36 for batch)
  [ASSUMPTION: secondary, search summary of developer.intuit.com field-definitions page and a CodeProject
  article]. A user report says dedup didn't work for Customers/Items [ASSUMPTION: secondary, unverified
  comment]: test it in the sandbox for Payment and CreditMemo.
- Our ids: `clearline-<32 hex>-<i>` = 44 chars; the fee write-off's linking payment adds `-link` → 49 chars
  with i < 10, **51 with i ≥ 10**. Over the (assumed) 50 limit once a plan has 10+ lines. Shorten the key
  (e.g. 24 hex) in the QBO adapter before it is offered.

## Records (as our adapter maps them)
| Line | QBO record | Note |
|---|---|---|
| payment | `Payment` with `Line[].LinkedTxn {TxnType: "Invoice"}`, `TxnDate`, `DepositToAccountRef` | `DepositToAccountRef` = the wallet account; if omitted QBO uses Undeposited Funds [ASSUMPTION] |
| fee_writeoff | `CreditMemo` (service item mapped to the fee account, `QBO_WRITEOFF_ITEM_ID`) + a `Payment` of 0 linking memo and invoice | The usual QBO pattern for applying a credit memo [ASSUMPTION] |
| overpayment | `Payment` with no `Line` = unapplied customer credit | [ASSUMPTION] |
| note | Folded into the next payment's `PrivateNote` | QBO has no invoice history API (code comment) [ASSUMPTION] |
| deposit / journal | `Deposit`, `JournalEntry` | Not used. A `JournalEntry` is the QBO equivalent of a Xero manual journal for unusual entries a person posts |

## Timezone and dates
- `TxnDate` is a plain date; the company's timezone setting must be used to compute it, exactly as for Xero
  (the bug-branch test checks `TxnDate` too). Where QBO exposes the company timezone (CompanyInfo or
  Preferences) **was not verified** [ASSUMPTION: open the Intuit Preferences and CompanyInfo entity pages
  first]. Until then the QBO adapter must take the timezone from configuration and refuse to post without it.

## Sandbox
- A sandbox company is created from the Intuit developer dashboard; development keys only work there
  [VERIFIED: DotNET SDK README for keys; ASSUMPTION for dashboard steps]. Region of the sandbox company
  (US/UK/AU/CA…) decides its home currency and tax model [ASSUMPTION].
