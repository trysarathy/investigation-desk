# Accounting systems and Rillet: a study for the Clearline Accounting Bridge

Prepared by research-agent (general-purpose agent working under the research-intern brief) on 2026-11-15 SGT, revision 2. This is research only: nothing was sent to anyone, and nothing under /home/user/rel was edited.

## 0. Evidence status

**How pages were read.** Revision 1 had no primary sources, because WebFetch could not resolve the hosts. In revision 2, pages were downloaded with `curl` through the session proxy into per-page directories. Text was extracted with a separate `python3 -I` html.parser script. Downloaded content was treated as data only. The raw HTML has since been deleted.

**Labels used:**
- `[VERIFIED: research-agent 2026-11-15, <url>]`: I fetched that primary page this run, and the page itself states the claim.
- `[ASSUMPTION: secondary, <source>]`: the claim comes from a WebSearch snippet, review or blog, or a primary page I could not read.
- `[NOT ESTABLISHED]`: I found no evidence. A missing doc does not prove a feature is absent.
- `[INFERENCE]`: my own reasoning.

**Pages that could not be read this run.** Claims from these stay secondary:

| Host | Result |
|---|---|
| `www.intacct.com` (Intacct help: JE approvals, bank matching rules) | No response |
| `developer.sage.com` (Intacct REST portal) | No response |
| `www.sage.com` | HTTP 403 |
| `www.netsuite.com` (2026.2 release article) | HTTP 403 |
| `docs.cryptio.co` | No response |
| `cryptio.support.site` | Returns a JavaScript shell with no article text |
| `rillet.com/product/api`, `rillet.com/blog/ai-with-control` | HTTP 404 |
| NetSuite CSV-import approval behaviour | Exists only on community forums |

**Corrections to revision 1, from primary pages:**
1. **Rillet's automation figures conflict on its own pages.** The homepage says "99.7% Transactions post automatically" and "800+ customers". The close article says "93% of journal entries are booked automatically without human intervention (customers)". See §2.1 and §4.
2. **Rillet's journal-entry API posts directly.** `POST /journal-entries` "Posts a balanced manual journal entry". The draft/human-review staging I found applies to **contracts**, not journal entries. Rillet idempotency keys are kept for **24 hours only**.
3. **Sage Intacct XML `GLBATCH` create defaults to Posted** ("Posted to post to the GL, otherwise Draft. (Default: Posted)"). An integration must send Draft explicitly.
4. **Zoho Books journals do have an approval and publish workflow in the API.** It has endpoints to submit for approval, bulk approve and publish. Revision 1 said "not established".
5. **NetSuite has four system rules, not three.** A rule that matches after stripping prefixes and leading zeros sits between the exact-number rule and the amount-and-date rules. Its statement parsers also cover MT940.
6. **NetSuite's generative-AI "Enriched Bank Data" is on by default** and can itself produce matches. The separate Transaction Matching Assistant never submits a match automatically.

---

## 1. Executive summary

1. **"Proposed, then approved, then posted" is native in most targets. The defaults differ, so the bridge must always state the target state explicitly.**
   - **Sage Intacct XML:** `GLBATCH` has states Draft, Submitted, Partially Approved, Approved, Posted, Declined and Reversed. Creation defaults to Posted [VERIFIED: research-agent 2026-11-15, https://developer.intacct.com/api/general-ledger/journal-entries/].
   - **Zoho Books:** journals can be submitted for approval, approved and published [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/api/v3/journals/].
   - **NetSuite:** SuiteApprovals does **not** route transactions created by CSV import, web service or RESTlet [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0806110833.html].
   - **Rillet:** its public journal-entry API "Posts a balanced manual journal entry" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/reference/create-a-journal-entry.md]. Rillet routes "journal entries, sync events, and AI agent proposals" through configurable approval workflows [VERIFIED: research-agent 2026-11-15, https://rillet.com/product/enterprise-security]. Whether an API-created journal entry is held for approval depends on that configuration: [NOT ESTABLISHED].
2. **Ledger bank matching can rest on amount and date alone. Clearline's does not.**
   - NetSuite's system rules end with "Match on Amount when Date is within 3 Previous Days" and "…within 90 Previous Days". When candidates are ambiguous, a person must choose [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160374863744.html].
   - Rillet's structured layer combines amount, an invoice number found in the description, and date proximity [VERIFIED: research-agent 2026-11-15, https://rillet.com/blog/your-cash-reconciliation-problem-isnt-a-capacity-problem].
   - Clearline never allocates on amount alone [VERIFIED: research-agent 2026-11-15, /home/user/rel/trial/docs/clearline/ARCHITECTURE.md §4 row 4a].
3. **Rillet treats provider data as bank data.** The Stripe Balance Account "appears in Cash Reconciliation alongside your other bank accounts". Stripe payouts are auto-matched as transfers [VERIFIED: research-agent 2026-11-15, https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/integrations/stripe/stripe-billing-integration-overview/sync-stripe-invoices-and-payments-into-rillet]. [INFERENCE] In Rillet a provider's own report is reconciled the way a bank feed is. Clearline keeps that report labelled a provider claim until a bank or chain record independently corroborates it. That is the core difference to offer.
4. **The crypto sub-ledgers validate Clearline's evidence model.**
   - Cryptio advertises "Independent on-chain data across 90+ blockchains via verified node runners". It offers matching "by hash, UID or any metadata field", and breaks with "assignment and sign-off history" [VERIFIED: research-agent 2026-11-15, https://cryptio.co/solutions/reconciliation].
   - Cryptoworth "ensures your balances match real on-chain activity before generating any ledger output" [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/crypto-month-end-close]. Journal entries are pushed "once reviewed and verified … through native sync or export" [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/crypto-subledger].
5. **AI is assistive in most documented places, with two exceptions.**
   - NetSuite's Enriched Bank Data (generative AI, on by default) can make matches itself [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0305111754.html].
   - Rillet lets customers configure "which AI proposals require human review vs auto-post" [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/control-integrity-under-change-rillet]. This sits alongside its security page's statement that for agents, "Nothing posts without approval".
6. **Recommendation:**
   - Build a ledger-neutral, balanced proposed-journal export (CSV) with a Clearline-owned deterministic key.
   - Make the Xero draft manual journal the first live adapter, as already decided [VERIFIED: build session 2026-10-31, company/PRODUCT_FACTS.md].
   - Make NetSuite second, via external-ID upsert. Its SuiteApprovals routing does not apply to integration-created records, so the target status must be set explicitly.
   - Then Intacct (explicit Draft), Zoho (draft, then submit), a Tally XML voucher file, and Rillet. Rillet is a credible target, but its journal-entry API posts directly, so it needs an approval workflow configured first.
   - Use AI only for explanations and mapping or candidate suggestions. Never for amounts, entries, evidence, approval, finality or closure.

---

## 2. Per-company sections

### 2.1 Rillet (deep study)

| # | Question | Finding |
|---|---|---|
| 1 | Core product | "AI-Native ERP". The product menu lists: General ledger ("Continuous Close ledger"), Accounts receivable, Accounts payable, Bank reconciliation, Advanced revenue recognition, Multi-entity accounting, Flexible GAAP reporting, Real-time reporting, Aura AI, Audit & Compliance, Integrations ("12,000+ connectors and MCPs") [VERIFIED: research-agent 2026-11-15, https://www.rillet.com/]. |
| 2 | Who pays | Finance teams. Solutions are listed by role (CFO, Controller, Accounting firms, Private equity) and by industry, including SaaS, Financial Services and Crypto. "Used by 800+ customers in 70+ countries" (company claim) [VERIFIED: research-agent 2026-11-15, https://www.rillet.com/]. Funding: $100M Series C at a $1B valuation, Aug 2026, ICONIQ lead [ASSUMPTION: secondary, fortune.com 2026-08-18; fintech.global]. Pricing: not stated on the pages read. |
| 3 | Problem solved | The month-end close. The homepage headline is "Zero-day close" [VERIFIED: research-agent 2026-11-15, https://www.rillet.com/]. |
| 4 | Features (verified) | **Cash Reconciliation Report** per account and period; the difference is shown as uncleared items on each side [VERIFIED: research-agent 2026-11-15, https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports/understand-the-cash-reconciliation-report]. **Stripe sync**: Open or Paid invoices only, "draft invoices do not sync"; fees, chargebacks and refunds recorded at payment [VERIFIED: research-agent 2026-11-15, docs.rillet.com …/sync-stripe-invoices-and-payments-into-rillet]. **Accruals** with "AI-powered detection, review, editing, and posting" and a materiality-threshold setting [VERIFIED: research-agent 2026-11-15, https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/general-accounting/accruals]. **Plaid** for "12,000+ financial institutions", plus custom bank integrations such as "JP Morgan Access, HSBC" [VERIFIED: research-agent 2026-11-15, https://www.rillet.com/product/bank-reconciliation]. **Period locking** and "Granular subledger locks by entity", each "logged with reason and timestamp" [VERIFIED: research-agent 2026-11-15, https://rillet.com/product/enterprise-security]. |
| 5 | System of record | Rillet's GL. "the general ledger is the system of record"; external systems "remain the operational front-ends" [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/how-rillet-works-integrations-ai-security]. |
| 6 | Payment and bank states | Invoice payments can be successful, uncleared or failed. "Only uncleared payments can be deleted; cleared or reconciled payments are rejected" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/llms.txt]. Each line of the reconciliation report is tagged Unmatched, a timing item, or uncleared. A distinct returned-payout or provider-claim state: [NOT ESTABLISHED]. |
| 7 | Reconciliation | A "four-layered matching system": (1) integration context, where Stripe sends invoice metadata and Ramp sends expense IDs, and these "match automatically with no human input required"; (2) structured matching on amount, an invoice or expense number in the description, and date proximity; (3) merchant or description rules; (4) "similarity algorithms or Aura AI" giving "confidence-weighted suggestions". Auto-match can be set to "never auto-match, to auto-match only by rules, or to auto-match all high-confidence transactions". Rillet claims "95% of cash transactions" are auto-matched [VERIFIED: research-agent 2026-11-15, https://rillet.com/blog/your-cash-reconciliation-problem-isnt-a-capacity-problem]. |
| 8 | Independent evidence | Bank feeds and confirmed statement balances. "If this figure doesn't match your bank statement … a bank transaction is missing, duplicated, or excluded from the feed. Confirm the period-end statement balance to anchor it" [VERIFIED: research-agent 2026-11-15, docs.rillet.com …/understand-the-cash-reconciliation-report]. The Stripe balance is treated as a bank account [VERIFIED: research-agent 2026-11-15, docs.rillet.com …/sync-stripe-invoices-and-payments-into-rillet]. |
| 9 | Integrations | Stripe, Ramp, Brex, Plaid "and 100+ others" for cash reconciliation [VERIFIED: research-agent 2026-11-15, rillet.com/blog/your-cash-reconciliation-problem-isnt-a-capacity-problem]. Salesforce and HubSpot for revenue [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/automate-month-end-close-fastest-path]. Cryptoworth pushes journals into Rillet [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/blog/cryptoworth-streamlines-digital-asset-accounting-with-new-rillet-erp-integration]. An `integrations health` API endpoint exists [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/llms.txt]. |
| 10 | Exceptions | Unmatched bank transactions, unmatched journal entries, "paid uncleared" bills and unmatched received invoices, all listed as uncleared items. "Uncleared items include differences from previous periods that have not been resolved" [VERIFIED: research-agent 2026-11-15, docs.rillet.com cash-reconciliation-report]. The close module has "exception queues" [VERIFIED: research-agent 2026-11-15, info.rillet.com/automate-month-end-close-fastest-path]. |
| 11 | Approvals and permissions | Roles: "Owner, Admin, Accountant, plus view-only". "Tier approvals to materiality (e.g., $50K to Controller, $500K to CFO)". Approvals route "journal entries, sync events, and AI agent proposals". "Every approval and rejection logged immutably". "SOC 1 & SOC 2 Type II … Reports available for review" [VERIFIED: research-agent 2026-11-15, https://rillet.com/product/enterprise-security]. Close-checklist completion and sign-off over the API require "an OAuth connection made by a named user; API keys are rejected with HTTP 403" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/llms.txt]. Maker-checker for one-person teams is "part of enterprise diligence" [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/control-integrity-under-change-rillet]. |
| 12 | Accounting support | Revenue recognition schedules with restatement on contract change, prepaids, capitalised commissions, multi-entity with eliminations and translation [VERIFIED: research-agent 2026-11-15, info.rillet.com/automate-month-end-close-fastest-path; https://info.rillet.com/how-rillet-works-multi-entity-consolidation; docs.api.rillet.com/llms.txt]. |
| 13 | Developer APIs | **Auth:** bearer API key, enabled by the Rillet team. **Hosts:** `api.rillet.com` and `sandbox.api.rillet.com`. **Versioning:** `X-Rillet-API-Version` header; the default "is 1" and was due to change to latest on 1 Aug 2026. **Pagination:** keyset; cursors last 2 hours; maximum page size 100. **Idempotency:** an `Idempotency-Key` header on POST; "We save responses for 24 hours. After that a request with the same idempotency key will create a new object". **Rate limits:** 600 requests/min in production, 100 in test. **Errors:** RFC 9457. **Money:** decimal strings with a currency [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/docs/getting-started.md]. The OpenAPI spec shows version "v4.0" [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/reference/create-a-journal-entry.md]. **Endpoints:** chart of accounts; journal entries (create posts directly; update replaces all lines; delete "typically prior to period lock"); journal-entry document upload; bank accounts and balances; bank transactions, with match-to-records, match-with-quick-entry and match-as-transfer; book periods (close and reopen by `YYYY-MM`); close checklist; draft contracts "for a human to approve or reject"; webhooks with an `X-Rillet-Id` "for idempotency" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/llms.txt; https://docs.api.rillet.com/docs/webhooks.md]. **MCP server** at `api.rillet.com/mcp` over OAuth2, with tools mirroring the public API; "your agent will only have access to the tools that your Rillet user has access to" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/docs/mcp.md]. |
| 14 | Hard workflow (sourced) | Rillet's own report says unresolved differences carry forward ("Uncleared items include differences from previous periods…"), and that differences starting at go-live need a balance-history review [VERIFIED: research-agent 2026-11-15, docs.rillet.com cash-reconciliation-report]. This is a documented case to handle, not evidence of customer dissatisfaction. |
| 15 | What Clearline could do differently | (a) Keep the provider report separate from bank and chain evidence, where Rillet treats the Stripe balance as a bank account. (b) Never auto-allocate on amount, invoice number in the memo and date; Clearline requires an exact trusted reference. (c) Rillet's idempotency lasts 24 hours, so Clearline must keep its own permanent export key and look up before any retry [INFERENCE]. |

### 2.2 NetSuite (Oracle)

| # | Question | Finding |
|---|---|---|
| 1 | Core product | Cloud ERP with GL, banking, period close and OneWorld subsidiaries [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451780.html]. |
| 2 | Who pays | [NOT ESTABLISHED] on the pages read. |
| 3 | Problem solved | One finance and operations system, including bank matching and period close. |
| 4 | Features | **Intelligent Transaction Matching**: system rules, user matching rules, and auto-create rules that "create an account transaction and match it automatically" [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1551275.html]. **Bank Statement Parsers SuiteApp**: BAI2, CAMT.053 (.001.02 or .001.08), CSV, MT940, OFX/QFX; it "will not create NetSuite transactions" [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1566294502.html]. **Period locks** by module (A/R, A/P, Payroll, All) and by subsidiary in OneWorld [VERIFIED: research-agent 2026-11-15, section_N1451780]. |
| 5 | System of record | The NetSuite GL. |
| 6 | Payment and bank states | "In-transit payments are non-posting". They are matched by a hidden rule that requires the transaction number and amount to match and the bank line to be a Payment type. Already-matched account transactions "can't be matched again" [VERIFIED: research-agent 2026-11-15, section_N1551275]. |
| 7 | Reconciliation | System rules run in order: (1) transaction number and amount; (2) amount and transaction number ignoring prefixes and leading zeros; (3) amount within 3 previous days; (4) amount within 90 previous days. Rules 1 and 2 support many-to-one and many-to-many matching. The account transaction date must be the same as or before the bank date. "If a rule finds two or more possible matches, the rule can't match the transaction automatically" [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160374863744.html]. |
| 8 | Independent evidence | Imported bank data from feeds or parsed statement files. |
| 9 | Integrations | SOAP `upsertList` by external ID. REST batch upsert by PUT or PATCH: "executed asynchronously", "maximum of 100 records", with an optional `X-NetSuite-idempotency-key` [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0203101639.html]. OAuth 2.0 client credentials (machine to machine) [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162730264820.html]. REST `journalEntry` record operations and concurrency limits [ASSUMPTION: secondary, netsuite-docs.pages.dev; truto.one]. |
| 10 | Exceptions | Ambiguous candidates require manual choice. Enriched Bank Data and the Transaction Matching Assistant work on ambiguous cases (see §4) [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_40170235282.html]. Ageing of unmatched items in 2026.2 [ASSUMPTION: secondary, netsuite.com 2026.2 article snippet; the page returned 403]. |
| 11 | Approvals and permissions | SuiteApprovals does not route transactions "created through CSV import, script deployment, web service, or RESTlet". "A record submitter can't be an approver". "The Administrator role isn't available in approval matrices" [VERIFIED: research-agent 2026-11-15, section_0806110833]. Journal entries imported by CSV default to Pending Approval when JE approval routing is on [ASSUMPTION: secondary, community.oracle.com 4482145]. The unlock permission name [ASSUMPTION: secondary, docs.oracle.com snippet; not on the lock page read]. |
| 12 | Accounting support | Full GL, period close checklist, OneWorld. |
| 13 | Developer APIs | See row 9. SuiteQL is read-only [ASSUMPTION: secondary, truto.one]. |
| 14 | Hard workflow (sourced) | Integration-created transactions bypass SuiteApprovals routing [VERIFIED: research-agent 2026-11-15, section_0806110833]. Transactions can get stuck in pending approval when no Final Approver is set, and "Bulk processing of affected transactions isn't currently supported" [VERIFIED: research-agent 2026-11-15, section_0806110833]. |
| 15 | Clearline differently | Upsert with `externalId` set to Clearline's entry key. Set the approval status explicitly rather than relying on routing. Send evidence references in memo or custom fields, so the customer's ledger matches by an exact number (rule 1) instead of amount and date (rules 3 and 4) [INFERENCE]. |

### 2.3 Sage Intacct

| # | Question | Finding |
|---|---|---|
| 1 | Core product | Cloud financial management with a dimensional GL, multi-entity support and cash management [ASSUMPTION: secondary, accountingdepartment.com; g2.com]. |
| 2 | Who pays | Mid-market finance teams [ASSUMPTION: secondary, trustradius.com]. Pricing: [NOT ESTABLISHED]. |
| 3 | Problem solved | Multi-entity close and reporting [ASSUMPTION: secondary, sage.com snippet; the page returned 403]. |
| 4 | Features | Journal entries "add, edit, or reverse a transaction to a journal", with reversal date, reference number and supporting document ID. `BASELOCATION_NO` is "Required if multi-entity enabled and entries do not balance by entity" [VERIFIED: research-agent 2026-11-15, https://developer.intacct.com/api/general-ledger/journal-entries/]. Bank feeds and matching rule sets [ASSUMPTION: secondary, intacct.com help snippets; the host did not respond]. |
| 5 | System of record | The Intacct GL. |
| 6 | Payment and bank states | [NOT ESTABLISHED] from primary sources. A cleared "Auto-match" match type is reported [ASSUMPTION: secondary, intacct.com snippet]. |
| 7 | Reconciliation | Rule sets run on import, when a feed arrives, and every 4 hours [ASSUMPTION: secondary, intacct.com automatically-match-txns snippet]. |
| 8 | Independent evidence | Bank feeds and imported files [ASSUMPTION: secondary]. |
| 9 | Integrations | XML API (legacy) and REST. "Sage Intacct recommends using the REST API … all new objects and features will be released using the REST API". The developer docs are "expected to move to … developer.sage.com/intacct with the FY27 R1 release". 2026 Release 4 "went live on November 6, 2026" [VERIFIED: research-agent 2026-11-15, https://developer.intacct.com/]. |
| 10 | Exceptions | [NOT ESTABLISHED]. |
| 11 | Approvals and permissions | `GLBATCH` STATE values: "I - Draft, S - Submitted, X - Partially Approved, A - Approved, P - Posted, R - Declined, Z - Reversed" [VERIFIED: research-agent 2026-11-15, developer.intacct.com/api/general-ledger/journal-entries/]. Multi-level approvers [ASSUMPTION: secondary, intacct.com approval-overview snippet]. |
| 12 | Accounting support | Dimensions, reversals, allocations, tax solutions such as UK VAT and AU GST [VERIFIED: research-agent 2026-11-15, developer.intacct.com/api/general-ledger/journal-entries/]. |
| 13 | Developer APIs | XML `create` on `GLBATCH`. STATE on create: "Posted to post to the GL, otherwise Draft. (Default: Posted)" [VERIFIED: research-agent 2026-11-15, developer.intacct.com/api/general-ledger/journal-entries/]. This settles revision 1's conflicting secondary reports for the XML API. REST default behaviour [ASSUMPTION: secondary, developer.sage.com OpenAPI snippet]. |
| 14 | Hard workflow (sourced) | Because the XML default is Posted, an integration that omits STATE posts straight to the GL [VERIFIED: research-agent 2026-11-15, same page]. |
| 15 | Clearline differently | Always send `STATE=Draft`. Map Clearline dimensions onto Intacct dimensions. Use `REVERSEDATE` and reversal of an existing entry for corrections [INFERENCE]. |

### 2.4 Zoho Books

| # | Question | Finding |
|---|---|---|
| 1 | Core product | Online accounting for SMBs. |
| 2 | Who pays | SMBs. The India edition offers a FREE plan for "Businesses with revenue less than 25 lakhs per annum" [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/in/books/audit-trail/]. Other pricing: not repeated here. |
| 3 | Problem solved | Bookkeeping, banking, tax. |
| 4 | Features | Bank feeds "through third party partners/providers". Import in "CSV, TSV, XLS, OFX, QIF, and CAMT.053 formats". Bank statements can be auto-forwarded from email [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/banking.html]. Transaction lock with `transaction_lock_date` and partial unlock [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/api/v3/transaction-locking/]. |
| 5 | System of record | The Zoho Books ledger. |
| 6 | Payment and bank states | Bank transactions can be matched, unmatched, excluded, restored, or categorised (expense, vendor payment, customer payment, refunds) [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/api/v3/bank-transactions/]. |
| 7 | Reconciliation | A "Match found" tag appears on lines that meet the criteria. A user can select several transactions until "the amount of the selected transactions is equal to the amount of the uncategorized bank transaction". A gateway fee is handled by adding an adjustment transaction [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/help/banking/matching-transactions.html]. A bank reconciliation API covers create, list, update, "Save a bank reconciliation as draft" and attachments [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/api/v3/journals/ (shared API navigation)]. |
| 8 | Independent evidence | Bank feeds and imported statements. |
| 9 | Integrations | REST v3. The ICICI connected-banking page returned 404 this run, so that claim stays [ASSUMPTION: secondary, zoho.com snippet]. |
| 10 | Exceptions | The uncategorised tab is the work queue [VERIFIED: research-agent 2026-11-15, matching-transactions.html]. |
| 11 | Approvals and permissions | Journals: "Submit a journal for approval", "Bulk approve journals", "Mark a journal as published" [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/books/api/v3/journals/]. The audit trail records "a timestamp and the details of the user", and Zoho "does not allow the disabling of audit trails" [VERIFIED: research-agent 2026-11-15, https://www.zoho.com/in/books/audit-trail/]. Roles [ASSUMPTION: secondary, stitchflow.com]. |
| 12 | Accounting support | Manual journals with line items (`account_id`, `debit_or_credit`), `journal_type` "Cash and Both", and VAT/BAS fields by region [VERIFIED: research-agent 2026-11-15, zoho.com/books/api/v3/journals/]. |
| 13 | Developer APIs | `POST https://www.zohoapis.com/books/v3/journals?organization_id=…`, OAuth scope `ZohoBooks.accountants.CREATE` [VERIFIED: research-agent 2026-11-15, same page]. Idempotency key: [NOT ESTABLISHED]; none was found on the journals page. |
| 14 | Hard workflow (sourced) | [NOT ESTABLISHED] from primary sources. |
| 15 | Clearline differently | Create as draft, then submit for approval; never publish from Clearline. Put the entry key in `reference_number` and look it up before retrying [INFERENCE]. |

### 2.5 TallyPrime (India relevance)

| # | Question | Finding |
|---|---|---|
| 1 | Core product | Accounting, inventory and compliance software for Indian businesses. "TallyPrime 7.2 is now live" with GST and TDS/TCS enhancements [VERIFIED: research-agent 2026-11-15, https://help.tallysolutions.com/xml-integration/]. |
| 2 | Who pays | Indian SMEs [INFERENCE from GST/TDS focus]. Pricing: [NOT ESTABLISHED]. |
| 3 | Problem solved | Books, GST, banking and the MCA edit-log rule ("from 1st April 2023"; "Software to ensure that the edit trail cannot be disabled") [VERIFIED: research-agent 2026-11-15, https://tallysolutions.com/tally/audit-trail-in-tallyprime]. This is not legal advice. |
| 4 | Features | Statement import from "145+ banks", CSV or Excel. PDF and "CSV/Excel converted from PDF" are not accepted. Imports can auto-create vouchers and auto-reconcile [VERIFIED: research-agent 2026-11-15, https://help.tallysolutions.com/bank-statement/]. Connected Banking from 6.0 [VERIFIED: research-agent 2026-11-15, https://tallysolutions.com/whats-new/]. MT940 support [ASSUMPTION: secondary, help.tallysolutions.com snippet; not on the page read]. |
| 5 | System of record | The Tally company data. |
| 6 | Payment and bank states | Banking Activities shows counts "Available in Books and Available in Bank". Reports separate reconciled and unreconciled transactions [VERIFIED: research-agent 2026-11-15, https://help.tallysolutions.com/tally/bank-reconciliation/]. |
| 7 | Reconciliation | Auto-reconcile after import, which requires release 6.0 or later. A "Reconciliation Beginning Date" on the bank ledger and an Opening BRS for earlier items [VERIFIED: research-agent 2026-11-15, help.tallysolutions.com/tally/bank-reconciliation/]. |
| 8 | Independent evidence | Imported statements and Connected Banking. |
| 9 | Integrations | XML over HTTP with an `ENVELOPE` / `HEADER` / `BODY` structure. `TALLYREQUEST` takes "Import, Export, or Execute". The response `STATUS` "1 means success; 0 indicates failure" [VERIFIED: research-agent 2026-11-15, https://help.tallysolutions.com/xml-integration/]. "Tally must be running in server mode with HTTP listener enabled (default port 9000)". ODBC is available via `IsODBCTable: Yes`. Listed use case: "Importing journal entries from an accounting engine". A "Tunnel-Based Connectivity" guide also exists [VERIFIED: research-agent 2026-11-15, https://help.tallysolutions.com/tallyprime-as-server/]. |
| 10 | Exceptions | Unreconciled list [VERIFIED: research-agent 2026-11-15, help.tallysolutions.com/tally/bank-reconciliation/]. |
| 11 | Approvals and permissions | The edit log records date, time and user, and tracks deleted transactions [VERIFIED: research-agent 2026-11-15, tallysolutions.com/tally/audit-trail-in-tallyprime]. Role-based access [ASSUMPTION: secondary, tallysolutions.com business guide]. |
| 12 | Accounting support | Vouchers (sales, journal and others), GST, TDS. |
| 13 | Developer APIs | XML/HTTP, ODBC, TDL, JSON via TDL [ASSUMPTION: secondary for JSON; XML and ODBC verified above]. |
| 14 | Hard workflow (sourced) | Integration needs Tally running in server mode [VERIFIED: research-agent 2026-11-15, tallyprime-as-server]. A tunnel option exists [same page], so revision 1's inference that a cloud service "cannot push" was too strong. The tunnel's mechanics are [NOT ESTABLISHED]. |
| 15 | Clearline differently | Start with an XML voucher file the CA imports. Consider the tunnel route later, after a security review [INFERENCE]. |

### 2.6 Cryptio

| # | Question | Finding |
|---|---|---|
| 1 | Core product | "Data transformation and ERP for digital assets": "Institutional data engine for accounting, reconciliation, fund admin and credit" [VERIFIED: research-agent 2026-11-15, https://cryptio.co/]. |
| 2 | Who pays | Segments listed include banks, exchanges, treasury companies, payments, stablecoins, token issuers and on/off ramps. "Trusted by 400+ leading digital asset institutions" (company claim) [VERIFIED: research-agent 2026-11-15, https://cryptio.co/]. $45M Series B, Mar 2026 [ASSUMPTION: secondary, cointelegraph]. |
| 3 | Problem solved | Auditable on-chain books and reconciliation. |
| 4 | Features | Transaction-level and balance-level reconciliation. "Match trades and transfers by hash, UID or any metadata field". "Verify net positions per asset and wallet at any point in time". "Automated alerts, materiality controls and full break assignment with sign-off history" [VERIFIED: research-agent 2026-11-15, https://cryptio.co/solutions/reconciliation]. |
| 5 | System of record | A sub-ledger and data engine that exports "to ERPs, banking, and risk systems" [VERIFIED: research-agent 2026-11-15, https://cryptio.co/]. |
| 6 | Payment and bank states | Sync states (labelled, ready to be synced, synced) [ASSUMPTION: secondary, cryptio.support.site; the page is a JavaScript shell]. |
| 7 | Reconciliation | "Continuous, independent multi-way reconciliation" across "OMS, ERP, custodian and on-chain data" [VERIFIED: research-agent 2026-11-15, cryptio.co/solutions/reconciliation]. The per-wallet Reconciled / Unreconciled / Untestable statuses [ASSUMPTION: secondary, cryptio.support.site]. |
| 8 | Independent evidence | "Independent on-chain data across 90+ blockchains via verified node runners, no third-party data dependency"; "30+ custodians and 35+ exchanges ingested with Big 4-approved completeness controls" (company claims) [VERIFIED: research-agent 2026-11-15, cryptio.co/solutions/reconciliation]. |
| 9 | Integrations | ERP exports [VERIFIED: research-agent 2026-11-15, cryptio.co]. A NetSuite-focused offering ("multi-entity digital asset operations in NetSuite") [VERIFIED: research-agent 2026-11-15, cryptio.co]. Xero draft manual journals; mapping required before sync; one journal per transaction for NetSuite [ASSUMPTION: secondary, cryptio.support.site]. |
| 10 | Exceptions | Breaks "surface instantly with full context … with complete audit trail to sign-off" [VERIFIED: research-agent 2026-11-15, cryptio.co/solutions/reconciliation]. |
| 11 | Approvals and permissions | Sign-off history on breaks (row 10). SOC reports [ASSUMPTION: secondary, startuphub.ai]. |
| 12 | Accounting support | "GAAP and IFRS-grade financial reporting including fair value & impairments" [VERIFIED: research-agent 2026-11-15, cryptio.co]. |
| 13 | Developer APIs | "Access Cryptio's full reconciliation engine via API. Matched data, balance snapshots and break logs" [VERIFIED: research-agent 2026-11-15, cryptio.co/solutions/reconciliation]. API keys issued via support [ASSUMPTION: secondary, cryptio.support.site]. |
| 14 | Hard workflow (sourced) | The fix for NetSuite duplicates is to delete and resync [ASSUMPTION: secondary, cryptio.support.site]. |
| 15 | Clearline differently | Cryptio reconciles assets and balances. Clearline additionally ties each payment to an invoice or obligation and keeps the three status dimensions separate [INFERENCE]. |

### 2.7 Cryptoworth

| # | Question | Finding |
|---|---|---|
| 1 | Core product | A digital-asset sub-ledger: "Normalize, reconcile, categorize, and prepare digital asset activity" before the accounting system [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/crypto-subledger]. |
| 2 | Who pays | Controllers and CFOs; "enterprise users" for the Rillet integration [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/crypto-month-end-close; cryptoworth.com Rillet blog]. Pricing: [NOT ESTABLISHED]. |
| 3 | Problem solved | The digital-asset month-end close. |
| 4 | Features | Coverage figures conflict across its own pages: the sub-ledger page says "230+ blockchains, 80+ exchanges, and 800+ DeFi protocols", the close page says "over 300 blockchains and exchanges using read-only access" [VERIFIED: research-agent 2026-11-15, cryptoworth.com/crypto-subledger; cryptoworth.com/crypto-month-end-close]. "Data Reconciliation Services": a dedicated analyst on enterprise plans [VERIFIED: research-agent 2026-11-15, crypto-month-end-close]. |
| 5 | System of record | Sub-ledger. The ERP is the GL. |
| 6 | Payment and bank states | [NOT ESTABLISHED]. |
| 7 | Reconciliation | "runs sanity checks and deviation flags, and ensures your balances match real on-chain activity before generating any ledger output" [VERIFIED: research-agent 2026-11-15, crypto-month-end-close]. |
| 8 | Independent evidence | On-chain activity, read-only [VERIFIED: research-agent 2026-11-15, same page]. |
| 9 | Integrations | "two-way integrations … Xero, QuickBooks, and NetSuite" [VERIFIED: research-agent 2026-11-15, crypto-month-end-close]. Rillet integration "now live and available to all Cryptoworth enterprise users" [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/blog/cryptoworth-streamlines-digital-asset-accounting-with-new-rillet-erp-integration]. Sage Intacct: [NOT ESTABLISHED]. |
| 10 | Exceptions | Sanity checks and deviation flags (row 7). |
| 11 | Approvals and permissions | "Once reviewed and verified, journal entries can be pushed … through native sync or export"; "Your finance team maintains control over what reaches the…" (text truncated in the extracted page) [VERIFIED: research-agent 2026-11-15, cryptoworth.com/crypto-subledger]. |
| 12 | Accounting support | Trial balance, cash flow statement, realised and unrealised gains [VERIFIED: research-agent 2026-11-15, crypto-subledger]. |
| 13 | Developer APIs | A private API for registered business users [ASSUMPTION: secondary, developer.cryptoworth.com snippet; not fetched]. |
| 14 | Hard workflow (sourced) | "configuration-heavy" [ASSUMPTION: secondary, third-party profile]. |
| 15 | Clearline differently | Adopt the "balances must match before any ledger output" gate, which Clearline's evidence ceiling already provides [INFERENCE]. |

---

## 3. Capability matrix

**Legend:**
- **VA**: Verified available.
- **VL**: Verified limited (available, but with a documented constraint).
- **NE**: Not established from a primary source; secondary notes in brackets.

Each verified cell gives its source.

| Capability | Rillet | NetSuite | Sage Intacct | Zoho Books | TallyPrime | Cryptio | Cryptoworth |
|---|---|---|---|---|---|---|---|
| Accounting integration | **VA**: Stripe, Ramp, Brex, Plaid, 100+ (rillet.com/blog/your-cash-reconciliation…) | **VA**: SOAP/REST upsert by external ID (docs.oracle.com article_0203101639) | **VA**: XML GLBATCH; REST recommended (developer.intacct.com) | **VA**: REST v3 journals (zoho.com/books/api/v3/journals) | **VA**: XML/HTTP, ODBC (help.tallysolutions.com/tallyprime-as-server) | **VA**: ERP exports (cryptio.co) | **VA**: Xero, QBO, NetSuite, Rillet (cryptoworth.com/crypto-month-end-close; Rillet blog) |
| General ledger | **VA** (rillet.com; docs.api.rillet.com/llms.txt) | **VA** (docs.oracle.com section_N1451780) | **VA** (developer.intacct.com journal-entries) | **VA** (zoho.com api journals) | **VA** (help.tallysolutions.com) | **VL**: sub-ledger, exports to ERP (cryptio.co) | **VL**: sub-ledger (cryptoworth.com/crypto-subledger) |
| Audit history | **VA**: approvals and locks logged immutably (rillet.com/product/enterprise-security) | NE (system notes not read) | NE | **VA**: cannot be disabled (zoho.com/in/books/audit-trail) | **VA**: edit log (tallysolutions.com/tally/audit-trail-in-tallyprime) | **VA**: sign-off history on breaks (cryptio.co/solutions/reconciliation) | **VL**: "timestamped records" (crypto-subledger) |
| Reconciliation | **VA**: 4-layer engine, configurable auto-match (rillet.com blog); report (docs.rillet.com) | **VA**: 4 system rules + user rules (docs.oracle.com section_160374863744) | NE [secondary: rule sets every 4 hours] | **VA**: many-to-one matching (zoho.com help matching-transactions) | **VA**: auto-BRS from 6.0 (help.tallysolutions.com/tally/bank-reconciliation) | **VA**: transaction and balance level (cryptio.co/solutions/reconciliation) | **VA**: balance match before output (crypto-month-end-close) |
| Exceptions | **VA**: uncleared items, exception queues (docs.rillet.com; info.rillet.com) | **VL**: ambiguous → manual; AI assist only for 1:1 (docs.oracle.com article_40170235282) | NE | **VL**: uncategorised queue (zoho help) | **VL**: unreconciled list (tally help) | **VA**: break assignment and sign-off (cryptio.co) | **VL**: deviation flags (crypto-month-end-close) |
| Approval workflows | **VA**: materiality tiers; routes JEs, sync events, AI proposals (rillet.com/product/enterprise-security) | **VL**: SuiteApprovals skips CSV, web service and RESTlet records (docs.oracle.com section_0806110833) | **VA**: Draft→Submitted→Approved→Posted states (developer.intacct.com) | **VA**: submit, approve, publish journals (zoho.com api journals) | NE | **VL**: break sign-off only (cryptio.co) | **VL**: "reviewed and verified" before push (crypto-subledger) |
| Developer experience | **VA**: sandbox, idempotency (24 h), RFC 9457, rate limits, OpenAPI, MCP (docs.api.rillet.com getting-started, mcp) | **VA**: external-ID upsert, async batch idempotency, OAuth M2M (docs.oracle.com) | **VA**: XML reference, SDKs, Postman; REST (developer.intacct.com) | **VL**: no idempotency documented (zoho.com api journals) | **VL**: local server, port 9000 (tally help) | **VA**: reconciliation API (cryptio.co/solutions/reconciliation) | NE [secondary: private API] |
| Operational automation | **VA**: 99.7% / 93% claims, which conflict (rillet.com; info.rillet.com) | **VA**: auto-create rules; Enriched Bank Data (docs.oracle.com) | NE | **VA**: auto-forwarded statements, feeds (zoho.com/books/banking) | **VA**: auto-create vouchers (help.tallysolutions.com/bank-statement) | **VA**: triggers "hourly to monthly" (cryptio.co) | **VA**: auto-categorisation (cryptoworth.com/platform) |

Full URLs for the cells are in the §2 rows.

---

## 4. How accounting software uses AI: authority vs. assistance

### 4.1 Rillet's auto-post boundary and the "93%" figure

The relevant statements come from Rillet's own pages, all fetched this run:

| Statement | Source |
|---|---|
| "Every agent action is proposed to a human. Nothing posts without approval." Also "Materiality-Tiered: Configurable thresholds tie human checkpoints to dollar value." | [VERIFIED: research-agent 2026-11-15, https://rillet.com/product/enterprise-security] |
| "Aura AI suggestions require human approval before anything hits the ledger." | [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/automate-month-end-close-fastest-path] |
| "93% of journal entries are booked automatically without human intervention (customers)", and "93% of journal entries auto-booked, human approval gating exceptions (customers)". | Same page [VERIFIED: research-agent 2026-11-15, info.rillet.com/automate-month-end-close-fastest-path] |
| "99.7% Transactions post automatically". Data is "automatically ingested, served for approval where needed, processed and posted". | [VERIFIED: research-agent 2026-11-15, https://www.rillet.com/] |
| "99.7% of journal entries booked automatically". | Rillet's own explainer, citing rillet.com [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/how-rillet-works-integrations-ai-security] |
| Under "Part of enterprise diligence": "the specific configuration of which AI proposals require human review vs auto-post". Also "The accruals workflow books approved accruals automatically (the approval step is the gate before booking)." | [VERIFIED: research-agent 2026-11-15, https://info.rillet.com/control-integrity-under-change-rillet] |
| Auto-match can be set to "never", "only by rules", or "all high-confidence transactions"; layer 4 is "Aura AI … confidence-weighted suggestions". | [VERIFIED: research-agent 2026-11-15, https://rillet.com/blog/your-cash-reconciliation-problem-isnt-a-capacity-problem] |

**Reading** [INFERENCE]:
- Most automatic posting in Rillet comes from **deterministic integration and rule paths**: Stripe and Ramp metadata, schedules, recurring rules. That is the 93% or 99.7%.
- **AI agent proposals** (accruals, suggestions) are approval-gated by default.
- Rillet's own diligence page says the split between "human review" and "auto-post" for AI proposals is configurable. That softens "Nothing posts without approval".
- Bank auto-matching of high-confidence matches (which may include AI-ranked ones) can be enabled without human review.
- **The two automation figures conflict.** 93% is labelled "(customers)" and covers journal entries. 99.7% covers "transactions" on the homepage and "journal entries" in the explainer. Neither page gives a method or period. Treat both as unaudited vendor claims.
- Revision 1 quoted "0 auto-posts without approval" and "100% of AI actions logged". **Neither appears on the fetched security page.** That page says "Full Audit Trail: Every query, proposal, approval, and rejection logged". Those two quotes are withdrawn to [ASSUMPTION: secondary, search snippet].

### 4.2 Other vendors

| Vendor | AI as authority | AI as assistant only |
|---|---|---|
| NetSuite | **Enriched Bank Data**: generative AI, "enabled by default". It is used only to resolve ambiguity between same-amount candidates (exact amount, GL date ≤7 days before, entity similarity). When "a match is made using an entity extracted by generative AI", the match is marked with a coloured bar. Oracle says results "should always be verified" [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0305111754.html]. | **Transaction Matching Assistant** (NetSuite Next, "uses OpenAI"): "AI-assisted recommendations are not submitted automatically"; one-to-one candidates only; "doesn't learn from past decisions" [VERIFIED: research-agent 2026-11-15, https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_40170235282.html]. |
| Sage Intacct | [NOT ESTABLISHED] | Copilot: "nothing happens without your approval" [ASSUMPTION: secondary, sage.com snippet; the page returned 403]. |
| Zoho Books | [NOT ESTABLISHED] | [NOT ESTABLISHED] |
| TallyPrime | [NOT ESTABLISHED] | "TallyIra … Starting with Docs by Ira – AI-powered invoice processor", framed as helping users "stay in control" [VERIFIED: research-agent 2026-11-15, https://tallysolutions.com/whats-new/]. |
| Cryptio | "Prebuilt agentic workflows that close your books, end to end". Outputs described as "Deterministic by design and expert-reviewed" [VERIFIED: research-agent 2026-11-15, https://cryptio.co/]. The split between AI and determinism is [NOT ESTABLISHED]. | "Build internal AI tools and treasury agents on verified, normalised reconciliation data" [VERIFIED: research-agent 2026-11-15, cryptio.co/solutions/reconciliation]. |
| Cryptoworth | [NOT ESTABLISHED] | "AI assists accounting teams in identifying exceptions, validating classifications, and accelerating tax workflows" [VERIFIED: research-agent 2026-11-15, https://www.cryptoworth.com/platform]. |
| Rillet MCP | The agent gets only "the tools that your Rillet user has access to" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/docs/mcp.md]. Checklist sign-off rejects API keys and requires a named OAuth user [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/llms.txt]. | |

**Pattern** [INFERENCE]: vendors let AI **choose between candidates** or **extract entities**, and sometimes let the result stand automatically (NetSuite enrichment, Rillet high-confidence auto-match). No vendor documents AI creating **evidence**: whether a bank line exists, or whether a chain transfer is final. The strongest controls tie sign-off to a named human (Rillet's OAuth-only sign-off) and restrict an agent to its user's permissions.

### 4.3 Where AI helps Clearline, and where it must not act

Clearline's rules here: "Nothing resolves itself" and "Evidence over claims" [VERIFIED: research-agent 2026-11-15, /home/user/rel/trial/docs/clearline/ARCHITECTURE.md §1].

**Allowed.** Outputs are labelled "suggested", and nothing changes state until a person acts.
1. Plain-English narratives generated from the deterministic `investigate()` view, with a check that every number and id in the text exists in the view.
2. Chart-of-accounts mapping suggestions per posting role, accepted by a person and versioned.
3. Ordering of amount-only candidates for a reviewer. Never allocation and never dropping a candidate. This is stricter than NetSuite's enrichment, which can auto-match.
4. Extracting candidate references from bank memos. A candidate counts only if it exactly equals a known provider payment id.
5. Drafting "who acts / next action" text on top of the existing `WA_*` / `NA_*` codes.
6. If Clearline exposes an MCP server, follow Rillet's pattern: the agent's tools are limited to the user's permissions, and approvals require a named human session, never an API key.

**Never:** create or alter amounts, currencies, accounts or lines; set `verified`, `matched` or finality; close an exception or obligation; release a hold; act as approver or checker; invent a reference or evidence.

---

## 5. Cross-cutting observations

- **Defaults differ, so the target state must always be explicit:**

  | Target | What happens by default |
  |---|---|
  | Intacct XML | Posted |
  | Rillet journal-entry API | Posts |
  | Zoho | Draft, then publish |
  | NetSuite integration records | Not routed by SuiteApprovals |

  Sources are in §2.
- **Idempotency must be owned by Clearline:**

  | Target | What it offers |
  |---|---|
  | Rillet | 24-hour key |
  | NetSuite | External-ID upsert, plus an async batch key |
  | Zoho | None documented |
  | Intacct and Tally | Not established |
- **Period controls exist on every target and are queryable:**

  | Target | Period control |
  |---|---|
  | Rillet | Book periods API, close and reopen by month |
  | Zoho | `transaction_lock_date` |
  | NetSuite | Locks per module and subsidiary |
  | Tally | Reconciliation Beginning Date |
- **Mapping must be complete before export.** This is reported for Cryptio [ASSUMPTION: secondary]. Entity scope matters on every target:
  - Intacct requires `BASELOCATION_NO` when multi-entity entries "do not balance by entity" [VERIFIED: research-agent 2026-11-15, https://developer.intacct.com/api/general-ledger/journal-entries/].
  - Rillet's journal-entry create takes "subsidiary scope" [VERIFIED: research-agent 2026-11-15, https://docs.api.rillet.com/llms.txt].

---

## 6. Implications for the Clearline Accounting Bridge (prioritised)

**Baseline.** Clearline's engine is pure and deterministic. It keeps execution, settlement and reconciliation separate, appends every action to an audit log, enforces maker ≠ checker, and stores money as integer minor units [VERIFIED: research-agent 2026-11-15, /home/user/rel/trial/docs/clearline/ARCHITECTURE.md; DATA_MODEL.md]. Integration status: Xero built and in testing, posting only after approval; QuickBooks next; NetSuite designed, not built [VERIFIED: build session 2026-10-31, company/PRODUCT_FACTS.md]. Everything below is [INFERENCE] unless a label says otherwise.

### P0: Proposed journal entry (ledger-neutral)

1. **`ProposedJournalEntry`** is a pure derivation, like `buildCaseReport`. Fields:
   - `entryKey`: deterministic hash of tenant, intent, posting role, evidence ids and mapping version.
   - `postingDate`: in `Organization.timezone`.
   - `entity` / `subsidiary`.
   - `currency`.
   - `lines[]`: role, mapped account, debit or credit in minor units, dimensions.
   - `evidenceRefs[]`: each with its `independent` flag.
   - `basis`: the evidence ceiling.
   - `status`: proposed → approved (maker ≠ checker) → exported → acknowledged (with remote id), or rejected or superseded.

   Entries must balance per currency, checked with BigInt. Amounts are exported as decimal strings, as Rillet's API expects [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/docs/getting-started.md].
2. **Gate entries on evidence, not provider status.** A provider "completed" report alone creates no cash entry. This departs deliberately from treating a processor balance as a bank account, as Rillet does with Stripe.
3. **Fixed entry shapes:**

   | Trigger | Entry | Note |
   |---|---|---|
   | Submitted (optional policy) | Dr Supplier clearing / AP, Cr Payments in transit – {provider} | |
   | Bank debit matched by trusted reference | Dr In transit (or AP), Cr Bank – {account} | |
   | Accepted fee | Dr Payment fees, Cr Bank / Clearing | Same idea as Zoho's adjustment transaction [VERIFIED: research-agent 2026-11-15, zoho.com help matching-transactions] |
   | Accepted over-amount difference | Dr Payment differences, Cr Bank | Within the existing 1% / 50% rules |
   | Statement-confirmed return | Dr Bank, Cr In transit / Supplier clearing | The supplier obligation stays open |
   | Stablecoin final on chain | Dr In transit, Cr Digital asset – USDC {network} {wallet} | |
   | Advance and repayment by reference | Dr / Cr Advance receivable against Bank | |

   No entry is ever produced from amount-only candidates, an open contradiction, a currency mismatch without FX evidence, or a short or batched debit.
4. **Corrections only by a linked reversal.** Intacct has `REVERSEDATE` and a Reversed state for this [VERIFIED: research-agent 2026-11-15, developer.intacct.com]. Never update in place, even though Rillet's update "Replaces the lines" [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/llms.txt].

### P0: Chart-of-accounts mapping

- Map **posting roles**: Bank (per account), In transit (per provider), Supplier clearing / AP, Fees, Differences, FX (blocked until FX evidence exists), Digital asset (token × network × wallet), Advance receivable.
- Import the customer's chart read-only. Rillet exposes "Lists all accounts" with `updated.gt` and stable ids [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/llms.txt].
- A person approves the mapping, and it is versioned. No export without a complete mapping.
- Carry provider, rail, entity and counterparty as dimensions or metadata (Intacct dimensions; Rillet metadata definitions), not as new accounts.

### P0: Period handling

- Before export, read the target's period status: Rillet book periods [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/llms.txt]; Zoho `transaction_lock_date` [VERIFIED: research-agent 2026-11-15, zoho.com/books/api/v3/transaction-locking]; NetSuite locks [VERIFIED: research-agent 2026-11-15, docs.oracle.com section_N1451780].
- If the period is locked, a person chooses the next open date, and that choice is audited. Never re-date silently and never reopen a period.

### P0: Export formats, in order

1. **Balanced CSV of proposed journals.** One row per line, carrying the entry key. Marked like the existing case-report CSV and guarded against formula injection. This matches the pilot decision that the accountant reviews and imports [VERIFIED: build session 2026-10-31, company/PRODUCT_FACTS.md].
2. **Xero** draft manual journal, as already decided [VERIFIED: build session 2026-10-31, company/PRODUCT_FACTS.md].
3. **NetSuite**: CSV, then REST upsert by `externalId = entryKey` using async batches of up to 100 with an idempotency key [VERIFIED: research-agent 2026-11-15, docs.oracle.com article_0203101639]. Set the approval status explicitly, because SuiteApprovals ignores integration records [VERIFIED: research-agent 2026-11-15, section_0806110833].
4. **Tally XML voucher file** (`TALLYREQUEST=Import`; check `STATUS` 1 or 0 on any live push) [VERIFIED: research-agent 2026-11-15, help.tallysolutions.com/xml-integration].
5. **Intacct** with `STATE=Draft` always. **Zoho**: draft, then "Submit a journal for approval"; never publish from Clearline. **Rillet**: only after the customer has configured an approval workflow that captures API journal entries, because `POST /journal-entries` posts. Use the `Idempotency-Key` header and attach the evidence pack through the journal-entry document upload.

### P1: Export ledger and audit

- An append-only `ExportRecord` holds: entryKey, target, mapping version, payload SHA-256, approver and checker, timestamp, remote id, and acknowledgement.
- Never rely on a target's idempotency beyond its window (Rillet's is 24 hours). Look up by entry key or reference before any retry.
- Consume target webhooks idempotently; Rillet's `X-Rillet-Id` is an example [VERIFIED: research-agent 2026-11-15, docs.api.rillet.com/docs/webhooks.md].

### P1: First live adapter

**Xero first, NetSuite second.** Reasons:
- Xero is already built, has company backing, and lands as a draft.
- NetSuite has documented server-side upsert and machine-to-machine OAuth, but its approvals do not catch integration records, so the bridge must set status itself.
- Rillet is a strong design-partner target. Its API is mature (sandbox, idempotency, RFC 9457 errors, MCP, period API) and a crypto sub-ledger already pushes into it. It comes third or fourth because its journal-entry API posts directly and no company decision names it.
- Tally is for India via file export first. A tunnel route exists but is unassessed.

### P2: Reconciliation hand-off

- Export **evidence references**, not matches: provider payment id, bank line id, chain hash and network, and `independent` flags. Put them in memo or reference fields so the customer ledger's exact-number rule (NetSuite rule 1) matches them, rather than amount-and-date rules.
- Never mark the customer's bank line as reconciled from Clearline.
- Surface "not yet evidenced" (`UK_*`) as a first-class state, as Cryptio does with breaks and Cryptoworth with its pre-output balance gate.

### Owner and next step

- **Owner:** product-manager with accounting-integrations-engineer, to turn P0 into a design doc.
- **Open verifications for research-intern** (needs `www.intacct.com` and `developer.sage.com` allowed, and a rendered view of `cryptio.support.site`):
  - Intacct JE approval and bank-rule pages.
  - Intacct REST JE default state.
  - NetSuite journal-entry approval routing for CSV and REST.
  - Cryptio Xero and NetSuite sync articles.
  - Zoho ICICI page (404 this run).
