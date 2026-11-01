# Knowledge pack: accounting-integrations-engineer

Last refreshed: **2026-11-01 (SGT)** · Refresh owner: accounting-integrations-engineer (monthly with the golden-task
re-run, and in the same PR as any code change that makes a file untrue). Built by reading `src/lib/accounting` on
`origin/main` @ `0c7d9f1`, running a probe test through the real `planPosting`/`xeroBody` in a scratch copy, and
opening the primary sources listed below.

Labels: **[VERIFIED: <url> opened 2026-11-01]** = I opened that primary source while writing (company rule 2).
Code facts are `[VERIFIED: code @0c7d9f1, read 2026-11-01]`. **[ASSUMPTION: secondary, <source>]** = a search
summary or third-party page. **[ASSUMPTION]** = reasoning, not checked. **[GUESS]** = estimate. When you reuse a
fact, copy its label with who and when (e.g. `[VERIFIED: accounting-integrations-engineer 2026-11-01, <url>]`);
never "[VERIFIED per pack]".

| File | Use it for |
|---|---|
| `codebase-map.md` | Every file in `src/lib/accounting` and the accounting API routes, the data flow, the 23 + 17 tests, measured behaviour of today's rules, known gaps **D1-D14**. Read before touching code |
| `xero-api.md` | OAuth, scopes (incl. granular-scope change), Organisation (Windows-style `Timezone` enum, `BaseCurrency`, `IsDemoCompany`, lock dates), Payments, CreditNotes/Allocations, BankTransactions, Overpayments, ManualJournals, Accounts, Currencies, idempotency, limits, Demo Company |
| `quickbooks-api.md` | QBO OAuth (1 h tokens), minor version 75, `requestid`, record mapping, what's unverified (timezone location) |
| `stablecoin-accounting.md` | IFRS IC 2019 agenda decision, IAS 32/IAS 38/IAS 7 debate for stablecoins, ASU 2023-08 scope, AICPA practice aid; what it means for our accounts (all secondary today) |
| `journal-entry-patterns.md` | Debit/credit patterns per case and the Xero/QBO record that produces each; invariants |
| `timezone-cutoff.md` | The UTC posting-date bug, the org-timezone rule, Windows→IANA mapping (CLDR), lock dates, month-end |
| `multi-currency-fx.md` | Token vs invoice vs base currency; Xero `CurrencyRate`/XE day rate; proposals |
| `rate-limits-idempotency.md` | Limits, idempotency keys, retries, read-back on ambiguous outcomes, token life |
| `benchmark-practices.md` | Stripe Ledger, Modern Treasury double entry, Xero/Intuit practice; the 7 practices we follow |
| `../../../docs/POSTING_RULES.md` | **The spec Aashmiin signs.** Wins over everything here once approved |

## Primary sources opened on 2026-11-01
- Xero OpenAPI spec 19.1.0: https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml
- Xero Node SDK README: https://raw.githubusercontent.com/XeroAPI/xero-node/master/README.md
- Unicode CLDR windowsZones: https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml
- Intuit OAuth client README: https://raw.githubusercontent.com/intuit/oauth-jsclient/master/README.md
- Intuit QBO SDK READMEs: https://raw.githubusercontent.com/intuit/QuickBooks-V3-DotNET-SDK/master/README.md, https://raw.githubusercontent.com/intuit/QuickBooks-V3-Java-SDK/develop/README.md
- The product code on `origin/main` @ `0c7d9f1` and branch `bug/xero-posting-date-timezone` @ `a3bde16`.

## Could not be opened on 2026-11-01 (session network policy)
developer.xero.com (OAuth overview, limits, every API page, Demo Company), developer.intuit.com,
blogs.intuit.com, ifrs.org, fasb.org, aicpa-cima.com, kpmg.com, iasplus.com, stripe.com, moderntreasury.com,
and github.com web / GitHub API for the XeroAPI repos (raw files worked). Consequences: rate-limit numbers,
granular scopes, Demo Company reset, QBO `requestid`/timezone and **all accounting-standards content are
[ASSUMPTION: secondary]**. First job when the hosts are allowed: open them and flip labels.

## Refresh checklist
1. `git log` on `src/lib/accounting` since the last refresh; update `codebase-map.md` (lines, tests, gaps).
2. Re-download the Xero OpenAPI spec; diff `Payment`, `BankTransaction`, `Organisation`, `TimeZone`, scopes.
3. Re-open the blocked pages above if allowed; relabel.
4. Re-run the probe cases in `codebase-map.md` against current `main`; update the table.
5. If any fact in `docs/POSTING_RULES.md` changed, mark the affected rule "needs re-approval".
