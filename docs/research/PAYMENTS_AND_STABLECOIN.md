# Payment orchestration and stablecoin infrastructure: competitor research for Clearline

Prepared by research-agent (general-purpose subagent briefed as research-intern), 2026-11-15. Not reviewed by a person.

## Method, scope and limits

- **Question tested (not assumed):** "Can Clearline provide a consistent, independent financial history across payment providers, settlement evidence and accounting systems?"
- **Sources.** Every `[VERIFIED]` label below is for an official vendor documentation or vendor website page that research-agent fetched and read on 2026-11-15. The WebFetch tool failed DNS resolution on the allowed hosts in this session, so pages were fetched with `curl` through the session proxy and converted to text. Most vendors publish Markdown versions of their docs (`.md` / `llms.txt`), which convert cleanly.
- **Extraction caveats.**
  - Formance pages are Next.js apps. Their text was pulled from the embedded page payload, which is fragmentary: table rows and headings arrive without layout. Formance claims below are limited to what was legible.
  - Thunes publishes one long HTML API reference; its status tables were read from that page.
  - Several pages contained instructions aimed at AI agents (for example, Circle pages asking the reader to install plugins). Those were treated as page content, not instructions, and ignored.
- **Blocked or not opened.**
  - `docs.finmo.net` is not on the allowed host list, so Finmo is covered only from its marketing site.
  - No pricing pages were opened for any vendor, so pricing is `[NOT ESTABLISHED]` throughout.
  - No customer reviews were used.
- **Secondary sources.** One WebSearch was run for Modern Treasury (URL discovery only) and one for Finmo. Facts from those snippets carry `[ASSUMPTION: secondary, …]` labels.
- **Rule applied:** missing documentation is reported as `[NOT ESTABLISHED]`, never as proof that a capability is absent.

Shorthand used in the tables: **VA** = Verified available, **VL** = Verified limited (documented, but partial, gated, index-level only, or limited to the vendor's own account), **NE** = Not established. Source IDs such as `[MT3]` resolve to URLs in the **Source register** at the end. Every source in that register was opened by research-agent on 2026-11-15, so a source ID stands for `[VERIFIED: research-agent 2026-11-15, <url>]`.

---

## Executive summary

1. **Most vendors document that its own "done" status is not final settlement.** This is the strongest evidence in this research, and it comes from the vendors themselves:
   - **Stripe:** a payout can show `paid` and then change to `failed` [ST4].
   - **Modern Treasury:** "`Completed` does not imply reconciliation"; a `completed` payment order can still move to `returned` or `reversed` [MT2].
   - **Airwallex:** `PAID` can still become `FAILED`. Its docs tell integrators to keep monitoring "until funds arrival is confirmed" [AW3].
   - **Nium:** `PAID` has sub-statuses up to `DEEMED_PAID`, which is reached once the clearing return window passes [NI2].
   - **Circle CPN:** at `COMPLETED`, "the receiver may or may not have received the transfer" [CI1].
   - **Bridge:** the transaction hash at `payment_submitted` "may be preliminary" [BR1].
   - **Zero Hash:** separates ledger `status` from `on_chain_status`, but says internal transactions show `CONFIRMED` without happening on-chain [ZH1].
   - **Fireblocks:** tells customers to reconcile deposits against the blockchain themselves before crediting users [FB3].

   Clearline's choice to keep execution, settlement evidence and reconciliation as separate states matches how these providers actually behave.
2. **That separation is not unique to Clearline.** Several vendors already expose it inside their own boundary:
   - Modern Treasury has a separate `reconciliation_status` [MT1].
   - Gr4vy has a `settled` flag that never changes `status` [GR3].
   - Nium has a separate settlement status [NI1].
   - Zero Hash has a separate `on_chain_status` [ZH1].

   Clearline's possible difference is **normalising these models across providers and adding independent evidence**, not inventing the distinction.
3. **Cross-provider coverage already exists, in slices:**
   - **Formance:** connectors for 20+ PSPs, banks and exchanges, a double-entry ledger, and a reconciliation module that records evidence and alerts [FM1][FM3][FM4]. This is the closest architectural analogue.
   - **Primer and Gr4vy:** unify **card/PSP settlement reports** across processors [PR2][GR4].
   - **Modern Treasury:** reconciles bank transactions to expected payments across bank connections, and now offers a stablecoin rail [MT4][MT7].
   - **Finmo:** claims multi-bank cash aggregation and ERP sync (marketing only) [FI1][FI2].
4. **No source examined documents one product that combines all of the following:**
   - outbound payout providers (Nium, Thunes, Airwallex, Bridge, CPN);
   - bank statements;
   - on-chain stablecoin evidence;
   - a human-approved accounting outcome.

   This is the **plausible** gap. It is not proven demand: Clearline has 0 customers, so there is no buyer evidence here.
5. **Where the thesis is weak:**
   - **Single-provider customers.** A customer whose money moves only through Stripe automatic payouts, Airwallex or Circle Mint already gets provider reconciliation reports [ST2][AW5][CI3].
   - **Card-acquiring merchants** already using Primer or Gr4vy.
   - **Teams already on Modern Treasury** for bank and payment operations.
6. **Implications for Clearline Connect** (detail at the end):
   - The adapter contract must allow providers to regress a status (`paid → failed`, `completed → returned`).
   - Each provider's raw status and sub-status must be kept verbatim.
   - Signature verification has to be pluggable: at least eight different schemes are documented across these vendors.
   - A polling reconciler is required: Nium's default webhook delivery is at-most-once [NI5], and Thunes tells partners to query after its callbacks stop retrying [TH1].
   - Provider settlement reports should be classified as provider claims, not independent evidence.

---

## Clearline today (for comparison)

Source: repository files `/home/user/rel/trial/docs/clearline/ARCHITECTURE.md` (status 2026-11-13) and `ENGINE_API.md`, read 2026-11-15.

- Sandbox prototype on fictional data. Adapters are deterministic simulators with no network, keys or payouts.
- One `PaymentIntent.id` links quotes, the maker/checker instruction, provider events, statement allocations, chain observations, the case, exceptions and Funding Desk advances.
- `execution`, `settlement` and `reconciliation` are separate dimensions. Provider events carry `confidence: provider_claim`. Only bank statement lines and chain observations are `independent: true`. A provider settlement report yields `observed / provider_report`, never `verified`.
- Webhook ingestion checks the signature, dedupes, orders events and detects contradictions. Exceptions close only through a person. Compliance holds need both the partner's release and a reviewer's decision.
- Out of scope: real routing, payouts, custody, a shared ledger, multi-tenant state. The real-data pilot design is TARGET only (Postgres, KMS secrets, idempotency table).

---

## Payments companies

### Modern Treasury

1. **Core product.** Payment operations software: "manage the full cycle of money movement—from payment initiation, through approvals, to reconciliation" [MT6]. Also Ledgers [MT8] and a stablecoin rail [MT7].
2. **Who pays.** `[NOT ESTABLISHED]` (no pricing page opened). The docs address companies that originate bank payments.
3. **Problem.** Initiating bank payments, approving them and reconciling them to bank transactions [MT6][MT4].
4. **Verifiable features.**
   - Payment orders across ACH, wire, RTP, stablecoin and check [MT1].
   - Approval rules with sequential approval chains by user group [MT5].
   - Expected payments and reconciliation rules [MT4].
   - Manual reconciliation UI [MT9].
   - BAI2 import (Early Access) [MT10].
   - Immutable audit trail [MT11].
   - Ledgers [MT8].
5. **System of record.** Modern Treasury holds payment orders, bank transactions and expected payments. Ledgers is offered as a separate double-entry product [MT8].
6. **State model.** Payment order `status` values: `Needs Approval`, `Approved`, `Denied`, `Cancelled`, `Processing`, `Sent`, `Held`, `Stopped`, `Failed`, `Completed`, `Returned`, `Reversed`. `completed` can move to `returned` or `reversed`. "Once `Sent`, a payment may move to `Failed` from any state" [MT1].
   - A separate `reconciliation_status`: `unreconciled`, `tenatively_reconciled` (spelled this way in the docs), `reconciled` [MT1].
   - Webhook events `acknowledged` and `confirmed` "do not change the payment order's state". `confirmed` is typically accompanied by network references such as ACH trace numbers or Fedwire IMAD/OMAD, and still "does not guarantee that the payment will settle" [MT2].
   - Ledger transactions: `pending`, `posted`, `archived`. Posted entries are immutable, and reversal is a new transaction [MT8].
7. **Reconciliation.** Rule-based matching of bank Transactions to Expected Payments, using one-to-one, one-to-many and many-to-many strategies on `reconciliation_rule_variables` [MT4]. Payment orders are reconciled automatically [ASSUMPTION: secondary, WebSearch snippet citing docs.moderntreasury.com expected-payments].
8. **Independent evidence.** Bank transactions from bank connections. The integrations page names Citi, Wells Fargo, SVB, Cross River and Column [MT12]. BAI2 files cover banks without an integration [MT10].
9. **Integrations.** The banks above [MT12]. ERP or accounting connectors: `[NOT ESTABLISHED]`. Payment orders carry an `accounting_category_id` field [MT2].
10. **Exceptions.** Side-by-side manual reconciliation, with adjustable expected amounts [MT9]. Compliance "Cases" for legal entities [MT13]. Returns carry a Return object [MT1].
11. **Approvals and permissions.** Approval rules by group, with sequential chains, applied to payment orders and external accounts. Reconciliation rule management is gated by role [MT5][MT4].
12. **Accounting support.** Ledgers product [MT8]. The `accounting_category_id` field [MT2]. ERP sync: `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `Idempotency-Key` header, max 180 characters, results saved 24 hours, keys independent of route [MT3].
    - Webhooks signed with hex HMAC-SHA-256 of the raw body in `X-Signature` [MT14].
14. **Documented hard workflow.** The vendor's own docs warn that `completed` is not `reconciled` and that orders can fail or return after `sent` or `completed` [MT1]. This is a documented integration burden, not a complaint.
15. **What Clearline could do differently.** Treat MT as an evidence source, not a competitor, for MT customers who also run non-bank rails (payout providers, stablecoins). Map MT `confirmed` and `tentatively_reconciled` to provider-claim confidence, and `reconciled` to MT's own match, which is still not Clearline-independent.

### Stripe (Payment Intents, payouts, balance transactions, reconciliation)

1. **Core product.** Payments platform. PaymentIntents collect funds [ST1].
2. **Who pays.** `[NOT ESTABLISHED]` (no pricing page opened).
3. **Problem.** Accepting payments and paying the balance out to a bank account [ST1][ST4].
4. **Verifiable features.**
   - PaymentIntents [ST1].
   - Pending and available balances [ST6].
   - Automatic and manual payouts [ST4].
   - Payout reconciliation report [ST2] and reconciliation via API [ST5].
   - Stablecoin payments that "settle in your Stripe balance in your local currency" [ST8].
   - Revenue Recognition [ST9].
5. **System of record.** Stripe's BalanceTransactions: "Every funds movement in or out of your Stripe account creates a BalanceTransaction" [ST5].
6. **State model.**
   - PaymentIntent: `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`, `requires_capture`, `canceled`, `succeeded` [ST1]. `succeeded` means "the funds are in your account and you can fulfill the order" [ST3].
   - Funds then sit as pending balance before becoming available [ST6].
   - Payout: `pending`, `in_transit`, `paid`, `failed`, `canceled`. "Some payouts that fail might initially show as `paid`, then change to `failed`" [ST7]; bank returns "can take up to 5 additional business days" [ST4].
   - Payout `reconciliation_status` includes `completed` [ST7].
   - Payouts carry `trace_id`, a value from the beneficiary's bank [ST7].
7. **Reconciliation.**
   - The Payout reconciliation report groups the transactions in each **automatic** payout [ST2]. The API equivalent lists BalanceTransactions by `payout` and listens for `payout.reconciliation_completed` [ST5].
   - For **manual** and **instant** payouts, "Stripe can't identify which transactions are included… You're responsible for reconciling" [ST2][ST5].
   - Report data can lag behind the payout itself [ST2].
8. **Independent evidence.** The bank `trace_id` is exposed [ST7]. The docs do not say Stripe confirms receipt at the destination bank: `[NOT ESTABLISHED]`.
9. **Integrations.** Accounting/ERP connectors: `[NOT ESTABLISHED]` (not opened). Revenue Recognition is a Stripe product [ST9].
10. **Exceptions.** Failed payouts carry a `failure_code`, plus email and Dashboard notice [ST4]. Disputes and refunds are reflected on the Charge, while the PaymentIntent stays `succeeded` [ST3].
11. **Approvals and permissions.** Team roles exist [ST10]. A payment approval workflow: `[NOT ESTABLISHED]`.
12. **Accounting support.** Revenue Recognition (accrual automation) [ST9]. GL export: `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `Idempotency-Key` up to 255 characters. In v1, the first response (including a 500) is replayed, and keys become eligible for removal after 24 hours [ST11].
    - Webhooks signed in the `Stripe-Signature` header, retried for up to three days in live mode, with no ordering guarantee and possible duplicates [ST12].
14. **Documented hard workflow.**
    - Reconciling manual and instant payouts is the merchant's job [ST2][ST5].
    - `paid → failed` regressions [ST7].
    - Out-of-order events [ST12].
15. **What Clearline could do differently.**
    - Stripe-only merchants on automatic payouts are already served by Stripe's report.
    - Clearline's possible role is linking the Stripe payout (`po_…`, `trace_id`) to the **bank statement line** as independent evidence, and covering manual and instant payouts, where Stripe says reconciliation is the merchant's responsibility.

### Nium

1. **Core product.** Embeddable fintech infrastructure for payment platforms: payouts, cards, FX, virtual accounts [NI0].
2. **Who pays.** "Companies use Nium to launch and manage their payment platforms" [NI0]. Pricing: `[NOT ESTABLISHED]`.
3. **Problem.** Cross-border payouts and pay-ins for platforms [NI0][NI2].
4. **Verifiable features.**
   - Payouts with a lifecycle audit endpoint [NI2].
   - Return codes based on ISO 20022, and RFIs [NI0][NI6].
   - Locked FX rates (index entry only) [NI0].
   - Settlement reports [NI3].
   - Portal roles including `APPROVER` [NI7].
5. **System of record.** Nium wallets and transactions [NI1].
6. **State model.**
   - "Every transaction… has two status data elements": transaction status (`Approved`, `Blocked`, `Cancelled`, `Declined`, `Error`, `Initiated`, `Pending`, `Rejected`) and settlement status (`Disputed`, `Dispute_Closed`, `Released`, `Settled`, `Unsettled`, `Waived`) [NI1].
   - Payout statuses include `AWAITING_FUNDS`, `INITIATED`, `RFI_REQUESTED`, `RFI_RESPONDED`, `COMPLIANCE_COMPLETED`, `SCHEDULED`, `SENT_TO_BANK`, `PAID`, `RETURN`, `FAILED`, `REJECTED`, `CANCELLED`, `EXPIRED`.
   - `PAID` has sub-statuses: `PROCESSED_BY_CLEARING` ("when Nium does not have full visibility"), `SENT_TO_BENEFICIARY_BANK`, `SENT_TO_BENEFICIARY_BANK_ACCOUNT` and `DEEMED_PAID` ("the clearing return window has elapsed without any returns") [NI2].
7. **Reconciliation.**
   - Daily client settlement report via Portal or SFTP, enabled on request. The V2 report is card-scheme oriented and "purely for informational purposes" [NI3].
   - Externally, Nium supports `externalId` "for your own reconciliation needs" [NI2].
8. **Independent evidence.** `[NOT ESTABLISHED]` beyond Nium's own reports and statuses.
9. **Integrations.** Accounting/ERP: `[NOT ESTABLISHED]`.
10. **Exceptions.** RFIs (v5 flow, hosted forms) [NI6][NI0]. `RETURN` with return codes [NI2].
11. **Approvals and permissions.** Portal roles `VIEWER`, `DEVELOPER`, `MANAGER`, `APPROVER`, `ADMIN`. `APPROVER` approves or rejects transactions and changes [NI7].
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - Idempotency on all POSTs with an `x-request-id` key. The first response, including a 500, is saved for 24 hours [NI4].
    - **Webhooks are delivered at most once by default.** Retries (20 attempts, every 5 minutes) must be enabled per event type through Nium [NI5].
    - Webhook signing: `[NOT ESTABLISHED]` (not found on the page opened).
14. **Documented hard workflow.** The vendor acknowledges limited visibility at `PROCESSED_BY_CLEARING` [NI2]. Default at-most-once webhooks [NI5].
15. **What Clearline could do differently.** Treat Nium `PAID` sub-states as graded **provider claims**: `DEEMED_PAID` is a time-based inference, not evidence. Poll Nium's audit endpoint rather than relying on webhooks. Link to the payer's bank debit and the beneficiary confirmation where available.

### Thunes

1. **Core product.** A cross-border payments network with Money Transfer and Collection APIs [TH0][TH1].
2. **Who pays.** The docs site lists banks, money transfer operators, PSPs, platforms and marketplaces, and eWallets as served segments [TH0]. Pricing: `[NOT ESTABLISHED]`.
3. **Problem.** Real-time payouts to "various payment partners" [TH0].
4. **Verifiable features.**
   - Quotation → transaction → confirm flow. The quotation's FX rate is "locked for the duration of the quotation" [TH1].
   - Callbacks or polling [TH1].
   - RFIs [TH1].
   - Daily and monthly account statement and transaction reports [TH1].
5. **System of record.** The partner's balance at Thunes: confirming "will hold the source amount… moving it from the available balance to the pending balance" [TH1].
6. **State model.** Status classes `CREATED`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `SUBMITTED`, `AVAILABLE`, `COMPLETED`, `REVERSED`, `DECLINED`, with numeric sub-statuses. Examples:
   - `20110 CONFIRMED-UNDER-REVIEW-SLS` (sanctions screening);
   - `30500 REJECTED-INSUFFICIENT-BALANCE`;
   - `70000 COMPLETED`: "payout has been made to the beneficiary";
   - `90000 DECLINED`: by the pay-out partner [TH1].
7. **Reconciliation.** Report types `PARTNER_ACCOUNT_STATEMENT_DAILY/MONTHLY` and `PARTNER_TRANSACTION_REPORT_DAILY/MONTHLY` [TH1]. A matching engine: `[NOT ESTABLISHED]`.
8. **Independent evidence.** `[NOT ESTABLISHED]`. Statuses come from the pay-out partner [TH1].
9. **Integrations.** Payer network [TH0]. Accounting: `[NOT ESTABLISHED]`.
10. **Exceptions.** Granular rejection and decline codes, plus RFI workflow [TH1].
11. **Approvals and permissions.** API access uses HTTP Basic Authentication [TH1]. Approval workflow: `[NOT ESTABLISHED]`.
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `external_id` on transactions [TH1]. Idempotency semantics: `[NOT ESTABLISHED]`.
    - Callbacks "retried several times, beyond which, the transaction status will have to be queried" [TH1].
    - Callback signing: `[NOT ESTABLISHED]`.
14. **Documented hard workflow.** After callback retries are exhausted, the partner must poll [TH1].
15. **What Clearline could do differently.** A Thunes adapter should key on `external_id`, store the numeric sub-status verbatim, and treat `COMPLETED` as a partner claim. Thunes is also a reconciliation processor listed by Primer [PR3]: a sign that settlement reporting for Thunes flows is already being normalised elsewhere.

### Airwallex

1. **Core product.** Global accounts, payouts, payments, FX, Spend, Connected Accounts [AW0].
2. **Who pays.** `[NOT ESTABLISHED]`.
3. **Problem.** Multi-currency collection, conversion and payouts [AW0][AW1].
4. **Verifiable features.**
   - Transfers with `quote_id` to fix the FX rate [AW1].
   - Transfer approval workflows that also apply to API-initiated transfers if configured, and to stablecoin transfers [AW2][AW4].
   - Financial reports: Balance activity, Transaction reconciliation, Account statement, Balance snapshot [AW5].
   - Stablecoin payouts (API only, enabled by an account manager) [AW4].
   - Spend GL account and tax-rate APIs [AW0].
5. **System of record.** The Airwallex wallet and balance [AW5].
6. **State model (API 2025-06-30+).**
   - `IN_APPROVAL`, `APPROVAL_RECALLED`, `APPROVAL_REJECTED`, `APPROVAL_BLOCKED`, `SCHEDULED`, `OVERDUE`, `PROCESSING`, `SENT`, `PAID`, `FAILED`, `CANCELLED`. Funding has its own `PROCESSING` and `FAILED` events [AW3].
   - `PAID`: "processed successfully by our banking partner… may subsequently fail if it is rejected by the local clearing system or the recipient bank". Next step: "Continue monitoring for `payout.transfer.failed` webhooks until funds arrival is confirmed" [AW3].
7. **Reconciliation.** Transaction reconciliation report, to reconcile "your Airwallex transactions to your own records" [AW5].
8. **Independent evidence.** `[NOT ESTABLISHED]` beyond Airwallex's own reports.
9. **Integrations.** ERP sync: `[NOT ESTABLISHED]` in pages opened. OAuth partner connections exist [AW0].
10. **Exceptions.** Failure reasons and a handle-failed-transfers guide. RFIs during `PROCESSING` and `SENT` [AW3][AW1].
11. **Approvals and permissions.** Approval workflows configured in the web app [AW2].
12. **Accounting support.** Spend GL accounts and custom accounting fields APIs [AW0]. Transfer-to-GL posting: `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - Webhooks signed with HMAC. Retried with exponential back-off "over about three days". Stable event `id`. Order not guaranteed [AW6].
    - `request_id` appears in transfer payloads [AW1]. Its idempotency semantics: `[NOT ESTABLISHED]`.
14. **Documented hard workflow.** `PAID` is not final [AW3].
15. **What Clearline could do differently.** Close Airwallex's own documented gap ("until funds arrival is confirmed") with independent evidence: the beneficiary-side bank line, or an on-chain transfer for stablecoin payouts.

### Primer

1. **Core product.** Payment orchestration: a unified payments API, no-code Workflows, fallbacks, observability, unified settlement reconciliation [PR0][PR1][PR2].
2. **Who pays.** `[NOT ESTABLISHED]`. The docs address merchants using multiple processors.
3. **Problem.** Running payments across processors with one model [PR1].
4. **Verifiable features.**
   - Unified lifecycle [PR1].
   - Fallbacks [PR4].
   - Workflows (triggers and actions) [PR0].
   - Unified Settlement Report for Adyen, Checkout.com, dLocal, Klarna, Mollie, Monext, PayPal, Stripe and Thunes [PR3].
5. **System of record.** Primer payments, plus reconciliation batches built from processor reports [PR2].
6. **State model.** `PENDING`, `AUTHORIZED`, `SETTLING`, `SETTLED`, `PARTIALLY_SETTLED`, `DECLINED`, `FAILED`, `CANCELLED`. `SETTLED`: "The processor has settled funds in your account" [PR1]. Here, settlement is a status *inside* the payment lifecycle and is processor-reported. The API enforces the state machine (`InvalidPaymentStatus`) [PR1].
7. **Reconciliation.** Processor settlement reports become batches keyed by processor + MID + settlement currency [PR2]. The report focuses on sales and refunds [PR2].
8. **Independent evidence.** Processor settlement reports (provider-side). Bank receipt evidence: `[NOT ESTABLISHED]`.
9. **Integrations.** The processors listed above [PR3].
10. **Exceptions.** Monitors, a disputes app and workflow-failure webhooks [PR0]. A reconciliation exception queue: `[NOT ESTABLISHED]`.
11. **Approvals and permissions.** `[NOT ESTABLISHED]`.
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - Idempotency keys on payment creation [PR5].
    - Webhooks signed with base64 HMAC-SHA256 in `X-Signature-Primary`, plus `X-Signature-Secondary` during rotation. Retried up to 5 times, the last at roughly 30 minutes [PR6].
14. **Documented hard workflow.** "Data on sales is not guaranteed to be final within one payout"; fees can show up days later; "Payout dates are not guaranteed to be unique" [PR2].
15. **What Clearline could do differently.** Primer collapses processor-reported settlement into the payment status. Clearline keeps it as `provider_report` and would add the bank deposit line as independent evidence. This complements Primer for card merchants rather than replacing it.

### Gr4vy

1. **Core product.** Payment orchestration: transactions across connections, Flow routing rules, settlement report ingestion [GR1][GR5][GR4].
2. **Who pays.** `[NOT ESTABLISHED]`.
3. **Problem.** Routing, retrying and reconciling payments across PSPs [GR5][GR2].
4. **Verifiable features.**
   - Flow routing and retries for card and non-card payments [GR0].
   - Settlement report ingestion per connection [GR4].
   - Settlement records API [GR3].
   - `reconciliation_id` [GR6].
   - Roles, for example Administrator and Analyst [GR7].
5. **System of record.** Gr4vy transactions, plus imported settlement records [GR3].
6. **State model.** `processing`, `buyer_approval_pending`, `authorization_succeeded`, `authorization_failed`, `authorization_declined`, `capture_pending`, `capture_succeeded`, `authorization_void_pending`, `authorization_voided` [GR1]. Settlement is **separate**: "At the API level, the `status` of a record does not change", and `settled`, `settled_amount` and `settled_currency` fields are added instead [GR3].
7. **Reconciliation.** Gr4vy passes `reconciliation_id` (Base62 of the transaction id) to the PSP and matches imported settlement lines on it, attaching fees [GR6][GR3]. Its docs describe reconciliation as a two-step mapping: PSP record → platform record → merchant system [GR2].
8. **Independent evidence.** PSP settlement reports (provider-side) [GR4]. Bank evidence: `[NOT ESTABLISHED]`.
9. **Integrations.** PSP connections [GR0].
10. **Exceptions.** Chargebacks arrive through settlement reports and set `disputed` [GR4]. An exception workflow: `[NOT ESTABLISHED]`.
11. **Approvals and permissions.** Roles and additional permissions [GR7]. Approval workflow: `[NOT ESTABLISHED]`.
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `Idempotency-Key` up to 255 characters, valid 24 hours [GR8].
    - Webhook headers `X-Gr4vy-Webhook-Timestamp`, `X-Gr4vy-Webhook-Signatures` (one signature per active secret) and `X-Gr4vy-Webhook-ID`, which "acts as the idempotency value" [GR9].
    - Retries for up to 7 days [GR10].
14. **Documented hard workflow.**
    - Ingestion starts only from the day it is enabled.
    - Imported reports are downloadable for 30 days.
    - "In the near future, support for marking the transaction as settled… is added" [GR4][GR6].
15. **What Clearline could do differently.** Gr4vy's identifier guidance (merchant, platform and PSP IDs) is a good model for Clearline's correlation keys. Clearline's addition would be bank-side and on-chain evidence, which Gr4vy does not document.

### Formance (ledger)

1. **Core product.** Modular financial infrastructure: Ledger (double-entry, Numscript), Payments (connectors), Reconciliation, Orchestration, Wallets and Webhooks modules [FM0].
2. **Who pays.** `[NOT ESTABLISHED]`. Community and Enterprise editions are mentioned for connectors [FM2].
3. **Problem.** Building internal ledgers and syncing provider money movements [FM0].
4. **Verifiable features.**
   - Connectors: Adyen, Atlar, Banking Circle, Column, Currencycloud, Increase, Mangopay, Modulr, Moneycorp, Qonto, Routable, Stripe, Wise; exchanges Bitstamp, Coinbase Prime, Fireblocks and Kraken Pro; open banking via Plaid, Tink and Powens; plus a Generic connector and a "build a connector" guide [FM0].
   - Reconciliation rules with PASS / FAIL / ERROR evaluations, proofs and evidence, and alerts [FM3][FM4].
   - Ledger idempotency [FM5].
   - Bank statement ingestion (CAMT.053), "currently in closed beta" [FM6].
5. **System of record.** The Formance Ledger. Payments records provider payments with an append-only `adjustments` list ("the audit trail") and the `raw` upstream payload [FM1].
6. **State model.**
   - Payment statuses: `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `EXPIRED`, `OTHER`, `UNKNOWN`, among others [FM1].
   - The generic-connector lifecycle page also lists `AUTHORISATION`, `CAPTURE`, `CAPTURE_FAILED`, `REFUNDED`, `REFUND_REVERSED`, `REFUNDED_FAILURE`, `DISPUTE`, `DISPUTE_WON` and `DISPUTE_LOST`. It explains "why there is no status state machine", and says the connector "does not write ledger postings" [FM7].
7. **Reconciliation.** Balance-level control templates: `ledger_vs_pool_drift`, `ledger_invariant`, `account_threshold` and `source_parity` ("Do two independent balance sources agree?"). Tolerances are per asset. Point-in-time per source (`pitPerSource`), with a safety margin to avoid ingestion-timing false positives [FM3][FM8].
8. **Independent evidence.** Cash pools from connectors, and bank statements (closed beta) [FM8][FM6]. On-chain evidence: `[NOT ESTABLISHED]`; exchange and custody connectors exist [FM0].
9. **Integrations.** See item 4.
10. **Exceptions.** Alert states `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, with reopen on later failure. An append-only timeline of fail, pass, ack, resolve, accept and snooze [FM4][FM3].
11. **Approvals and permissions.** `[NOT ESTABLISHED]`.
12. **Accounting support.** Chart of accounts, double-entry, bi-temporality and revert in the ledger [FM0]. ERP export: `[NOT ESTABLISHED]`.
13. **Developer APIs.** Ledger `Idempotency-Key`: a hash of the request is stored, a hit returns `Idempotency-Hit: true`, and the same key with different parameters is a validation error [FM5]. Webhooks module [FM0]. Signing details: `[NOT ESTABLISHED]`.
14. **Documented hard workflow.**
    - Connector payments do not become ledger entries automatically: "a separate step in your integration" [FM7].
    - Statement ingestion is still closed beta [FM6].
15. **What Clearline could do differently.**
    - Formance reconciles **balances** per asset and period. Clearline reconciles **individual payment intents** to evidence and explains each exception in plain English.
    - Overlap is real: a Formance customer could build much of Clearline's evidence layer. Clearline should not build a competing ledger; exporting to or reading from a ledger like Formance is more plausible.

### Finmo

All Finmo facts come from its marketing site. `docs.finmo.net` was outside the allowed hosts.

1. **Core product.** "Treasury, Cash Visibility & Payments Platform" [FI0].
2. **Who pays.** Marketing names CFOs, importers and exporters, and marketing and affiliate agencies, with a focus on Asia Pacific [FI0]. Pricing: `[NOT ESTABLISHED]`.
3. **Problem.** Consolidated cash visibility plus global collections and payouts [FI0][FI2].
4. **Verifiable features (vendor claims).**
   - "Get paid like a local in 27+ currencies" and payouts in "195+ countries" [FI0].
   - "automatically reconcile everything to your existing systems" [FI0].
   - "Post cleared items back into your ERP" [FI2].
   - Sync of remittance and FX transactions into accounting systems [FI1].
5. **System of record.** `[NOT ESTABLISHED]`.
6. **State model.** `[NOT ESTABLISHED]` (docs not reachable).
7. **Reconciliation.** Claimed, but the mechanism is `[NOT ESTABLISHED]` [FI0][FI2].
8. **Independent evidence.** Claims to connect bank accounts "via API or manual upload" [FI2]. Mechanism: `[NOT ESTABLISHED]`.
9. **Integrations.** No ERP named on the pages opened. Xero and QuickBooks reconciliation, and a third-party (Cirra by MindCloud) Xero connector, come only from secondary sources [ASSUMPTION: secondary, WebSearch summary citing finmo.net and mindcloud.co].
10.–13. `[NOT ESTABLISHED]`.
14. Not reported: no source.
15. **What Clearline could do differently.** Finmo's multi-bank visibility claim overlaps "independent cross-provider" positioning for APAC finance teams. Clearline's possible difference is per-payment evidence and on-chain stablecoin verification, which Finmo's opened pages do not mention. Confirming this needs `docs.finmo.net` allowed.

---

## Stablecoin and digital-asset companies

### Circle (USDC, Circle Mint, CPN)

1. **Core product.** USDC/EURC issuer. Circle Mint (fiat mint/redeem and on-chain transfer). CPN, "a stablecoin payments network for accepting, converting, moving, and settling" money [CI0].
2. **Who pays.** Circle Mint institutional customers and distributors (Institutional API, Credit API) [CI4]. Pricing: `[NOT ESTABLISHED]`.
3. **Problem.** Minting and redeeming stablecoins, and cross-border settlement via USDC [CI0].
4. **Verifiable features.**
   - CPN payments, quotes, RFIs and refunds [CI1].
   - Circle Mint deposits and on-chain transfers [CI5].
   - CAMT.053 daily statements [CI3].
   - Credit API: settlement advance and line of credit (index entries) [CI4].
5. **System of record.** The Circle Mint account. CAMT.053 statements cover all USDC and EURC activity [CI3].
6. **State model.**
   - CPN payment: `CREATED`, `CRYPTO_FUNDS_PENDING`, `FIAT_PAYMENT_INITIATED`, `COMPLETED`, `FAILED`. `statusAddendum` values: `IN_MANUAL_REVIEW` and `PAYMENT_SETTLEMENT_DELAYED`.
   - At `COMPLETED`: "Depending on the transfer method, the receiver may or may not have received the transfer."
   - RFI: `INFORMATION_REQUIRED`, `IN_REVIEW`, `APPROVED`, `FAILED`. Refund: `CREATED`, `FAILED`, `COMPLETED` [CI1].
   - CPN transaction: `pending` → `broadcasted` → `completed` after a chain-specific confirmation count. Reorgs are explicitly anticipated [CI2].
   - Mint transfer: `pending`, `running` (with `transactionHash`), `complete` ("Blockchain finality reached") [CI5].
7. **Reconciliation.** CAMT.053 files "to reconcile balances, match transactions" [CI3].
8. **Independent evidence.** On-chain transaction hash. CAMT entries carry `Blockchain` and `TransactionHash` fields [CI3].
9. **Integrations.** Rails Fedwire, SWIFT, RTP, SEPA and others (index) [CI4]. Accounting: `[NOT ESTABLISHED]`.
10. **Exceptions.** RFIs, `IN_MANUAL_REVIEW`, `PAYMENT_SETTLEMENT_DELAYED`, refunds [CI1].
11. **Approvals and permissions.** `[NOT ESTABLISHED]`.
12. **Accounting support.** ISO 20022 statements [CI3]. ERP: `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `idempotencyKey` in request bodies [CI5].
    - CPN webhooks: IP allowlisting plus signature verification (algorithm documented on a separate page, not opened). 11 retries in production [CI6][CI7].
    - CAMT delivered by 06:00 UTC the next day [CI3].
14. **Documented hard workflow.** CPN `COMPLETED` does not guarantee the beneficiary received funds. `PAYMENT_SETTLEMENT_DELAYED` [CI1].
15. **What Clearline could do differently.** Ingest CAMT.053 as provider-reported statements, and verify the on-chain leg independently (hash, allowlisted contract, finality). For CPN payments, keep `COMPLETED` as a BFI claim until a beneficiary-side bank line or confirmation exists.

### BVNK

1. **Core product.** Stablecoin payment infrastructure: crypto pay-ins (payment links, channels), payouts, wallets, fiat rails [BV0].
2. **Who pays.** `[NOT ESTABLISHED]`. Docs address platforms and merchants [BV0].
3. **Problem.** Accepting and sending stablecoins with conversion to crypto or fiat [BV2].
4. **Verifiable features.**
   - Payment links, and channels (static addresses) [BV0][BV2].
   - Underpayment handling settings and auto-refund to source address [BV3][BV4].
   - Ledger reports in CSV, PDF or JSON, delivered by email or webhook [BV1].
5. **System of record.** BVNK ledger wallets, with `/ledger/v1/transactions` and reports [BV1].
6. **State model.**
   - Payment: `Pending`, `Processing`, `Complete` ("Funds have been received and confirmed on the blockchain"), `On Hold`, `Underpaid` [BV2]. API values seen: `PENDING`, `PROCESSING`, `COMPLETE`, `DETECTED`, `EXPIRED`, `UNDERPAID`.
   - Webhooks include "transaction detected", "transaction confirmed", "late", "on hold" [BV0].
7. **Reconciliation.** "Verify that your internal transaction records match BVNK's transaction data" via `POST /ledger/v1/reports`, transaction lists and balance snapshots [BV1].
8. **Independent evidence.** On-chain confirmation by BVNK. `paidCurrency.actual` and `paidCurrency.amount` show received versus expected amounts [BV3].
9. **Integrations.** Accounting: `[NOT ESTABLISHED]`.
10. **Exceptions.** Overpayment, underpayment and late payment, with settings: settle merchant wallet, handle manually, auto refund, lower threshold [BV3][BV4].
11. **Approvals and permissions.** `[NOT ESTABLISHED]`.
12. **Accounting support.** Reports "to prepare accounting records" [BV1]. GL posting: `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `X-Idempotency-Key`, a 36-character UUID. A repeat request returns **400** (with exceptions on some endpoints) [BV5].
    - Webhooks: HMAC-SHA256 `X-Signature`, a 10-second timeout, up to 100 retries with back-off capped at 15 minutes, and a unique event id [BV6].
14. **Documented hard workflow.** Underpayments caused by exchange fees or user error [BV3].
15. **What Clearline could do differently.** BVNK already handles payment-level stablecoin exceptions inside its boundary. Clearline's role would be matching BVNK's `Complete` to the invoice and accounting outcome, and to independent chain evidence, especially for customers using BVNK *plus* other rails.

### Bridge

1. **Core product.** Stablecoin orchestration: transfers, virtual accounts, liquidation addresses, custody wallets, issuance, cards [BR0].
2. **Who pays.** `[NOT ESTABLISHED]`. Developer platforms are addressed [BR0].
3. **Problem.** Moving money "across fiat rails and stablecoins" [BR0].
4. **Verifiable features.**
   - Transfers with states [BR1].
   - Returns [BR2].
   - Virtual accounts, and liquidation addresses with drain history (index) [BR3].
   - Webhooks with asymmetric signatures [BR4].
5. **System of record.** Bridge transfers and drains [BR1][BR3].
6. **State model.**
   - `awaiting_funds`, `in_review`, `funds_received`, `payment_submitted`, `payment_processed`, `undeliverable`, `returned`, `missing_return_policy`, `refunded`, `refund_in_flight`, `refund_failed`, `canceled`, `error`.
   - The happy path "can never go backwards".
   - At `payment_submitted` the hash "may be preliminary"; use the hash at `payment_processed` [BR1].
7. **Reconciliation.** `[NOT ESTABLISHED]` (no reconciliation page found in the index).
8. **Independent evidence.** The final transaction hash at `payment_processed` [BR1].
9. **Integrations.** `[NOT ESTABLISHED]`.
10. **Exceptions.** The exception-path states above, plus a crypto return policy [BR1][BR2].
11. **Approvals and permissions.** `[NOT ESTABLISHED]`.
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `Idempotency-Key` required on all POSTs, guaranteed for 24 hours. The body must match on retry [BR5].
    - `X-Webhook-Signature: t=…,v0=…`, verified with a per-endpoint public key over a double SHA-256 digest [BR4].
14. **Documented hard workflow.** Preliminary hashes. Refunds of fiat deposits fail if the sending account is closed [BR1].
15. **What Clearline could do differently.** Mark Bridge hashes as `preliminary` until `payment_processed`, then verify them on-chain. Link liquidation-address drains to invoices.

### Fireblocks

1. **Core product.** Digital-asset custody and transfer platform ("direct custody"): vaults, policies, AML/KYT, webhooks [FB0].
2. **Who pays.** `[NOT ESTABLISHED]`.
3. **Problem.** Secure custody and movement of digital assets [FB0].
4. **Verifiable features.**
   - Transaction statuses and sub-statuses [FB1].
   - Confirmation policy [FB2].
   - Balance validation guide [FB3].
   - Policies and approval quorums [FB4][FB0].
   - Chainalysis and Elliptic AML integrations [FB0].
5. **System of record.** Fireblocks vault balances and transactions [FB3].
6. **State model.** `SUBMITTED`, `QUEUED`, `BROADCASTING`, `CONFIRMING`, `COMPLETED` ("part of the blockchain, and all assets have been transferred"), `CANCELLING`, `CANCELLED`, `BLOCKED`, `REJECTED`, `FAILED`. Pending/authorization sub-states were not legible in the extraction, so they are `[NOT ESTABLISHED]` here. Transaction status is distinct from AML and Travel Rule screening status [FB1].
7. **Reconciliation.** The guide tells customers to wait for `COMPLETED`, then a balance event at the same or a higher `blockHeight`, then compare with chain state; "don't credit the end user until you investigate". The vendor calls this an "independent check" [FB3].
8. **Independent evidence.** `blockInfo` (`blockHeight`, `blockHash`), which "can be missing for some asset types" [FB3].
9. **Integrations.** AML providers [FB0]. Formance has a Fireblocks connector [FM0].
10. **Exceptions.** Compliance policies and screening; `BLOCKED` and `REJECTED` [FB0][FB1].
11. **Approvals and permissions.** A policy engine controlling who can initiate, from and to where. Approval quorums [FB4][FB0].
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.**
    - `Idempotency-Key` (max 40 characters) for POST/PUT, but "Do not use `Idempotency-Key` when you create transactions. Use the `externalTxId` parameter" [FB5].
    - Webhooks via JWKS (`Fireblocks-Webhook-Signature`, detached JWS), with legacy `Fireblocks-Signature`. Optional mTLS or OAuth [FB6][FB0].
    - Retries at 10 s … 14,400 s, 10 attempts in total [FB7].
14. **Documented hard workflow.** The customer must independently reconcile balances against the chain [FB3].
15. **What Clearline could do differently.** This is the clearest vendor-side support for an independent evidence layer. Clearline could perform the check Fireblocks recommends and record it as `independent: true` chain evidence, read-only, without custody.

### BitGo

1. **Core product.** Custody, wallets and trading platform. Crypto-as-a-Service. Go Accounts (off-chain) [BG0].
2. **Who pays.** `[NOT ESTABLISHED]`.
3. **Problem.** Custody and transfers of digital assets [BG0].
4. **Verifiable features.**
   - Policy rules (scope, touchpoint, condition, action) [BG3].
   - Wallet webhooks for `transfer`, `pendingapproval`, `stuckTx` and `txRequest` [BG2].
   - Reports endpoints (index) [BG0].
5. **System of record.** BitGo wallets. For Go Accounts, "BitGo internal ledger processing rather than actual blockchain or mempool events" [BG2].
6. **State model.** Transfer webhook `state` includes `unconfirmed`. `numConfirmations` sets a threshold. Failure and removed states need `listenToFailureStates` [BG2]. Full transfer state list: `[NOT ESTABLISHED]`.
7. **Reconciliation.** `[NOT ESTABLISHED]`.
8. **Independent evidence.** Confirmations for on-chain wallets. Go Account events are ledger events [BG2].
9. **Integrations.** `[NOT ESTABLISHED]`.
10. **Exceptions.** `stuckTx` webhooks [BG2].
11. **Approvals and permissions.** Policy actions such as "Require approval from specific users" [BG3].
12. **Accounting support.** `[NOT ESTABLISHED]`.
13. **Developer APIs.** HMAC `x-signature-sha256`, a verify endpoint, an `idempotency-key` header on webhooks, 7 retries (1–240 minutes), and auto-blocking of a URL after 10 non-retryable 4xx responses within 1 hour [BG1].
14. **Documented hard workflow.** Go Account "unconfirmed" is not a mempool event [BG2].
15. **What Clearline could do differently.** Label Go Account transfers as provider-ledger claims, never chain evidence. For on-chain wallets, verify with Clearline's own finality rule instead of trusting the webhook threshold.

### Zero Hash

1. **Core product.** Crypto and stablecoin infrastructure for platforms: account funding, payins, payouts, withdrawals, bank rails, Travel Rule [ZH0].
2. **Who pays.** Platforms, for example the docs' brokerage example [ZH2]. Pricing: `[NOT ESTABLISHED]`.
3. **Problem.** Embedding crypto and stablecoin movement in platforms [ZH0].
4. **Verifiable features.**
   - Withdrawal status tracking [ZH1].
   - Reconciliation guidelines [ZH2][ZH3].
   - Reporting suite: balances, deposits, network fees, trades, withdrawals [ZH4].
   - RSA and HMAC webhook signing [ZH5].
5. **System of record.** The zerohash ledger. Many platforms keep their own fiat ledger, and "zerohash relinquishes control of the End Customer's account balance" [ZH2].
6. **State model.**
   - Withdrawal `status` (ledger): `PENDING_TRADE`, `PENDING`, `APPROVED`, `REJECTED`, `SETTLED`.
   - `on_chain_status`: `PENDING`, `CONFIRMED`.
   - "Internal transactions show `CONFIRMED` despite not occurring on-chain" [ZH1].
7. **Reconciliation.**
   - Net settlement across Account Funding and Buy/Sell determines the wire direction [ZH3].
   - Withdrawal conformance: encumber funds, keep them encumbered if a webhook cannot be matched, and re-credit only on `failed` or `abandoned` [ZH2].
8. **Independent evidence.** `transaction_id` (on-chain hash) [ZH1].
9. **Integrations.** `[NOT ESTABLISHED]`.
10. **Exceptions.** Unmatched webhooks keep funds encumbered [ZH2].
11. **Approvals and permissions.** A `PENDING` status awaiting approval [ZH1]. The workflow itself: `[NOT ESTABLISHED]`.
12. **Accounting support.** Reports [ZH4]. ERP: `[NOT ESTABLISHED]`.
13. **Developer APIs.** `X-REQUEST-ID` used for idempotent retries [ZH6]. Webhooks signed with `x-zh-hook-rsa-signature-256`, or HMAC; a newer header includes a timestamp for replay protection, and the older scheme is deprecated [ZH5].
14. **Documented hard workflow.** The platform is "completely responsible" for not over-releasing funds [ZH2].
15. **What Clearline could do differently.** The documented requirement (hold funds until a terminal webhook, keep unmatched events as exceptions) is what Clearline's exception model already enforces. Clearline should treat `on_chain_status: CONFIRMED` on internal transfers as a ledger claim, not chain evidence.

---

## Competitor capability matrix

VA = Verified available, VL = Verified limited, NE = Not established. Bracketed IDs are sources in the register. "Webhook ingestion" = documented signed event delivery to the customer, or ingestion of upstream provider events (orchestrators). "API reliability" = documented idempotency, retries and SLAs; VA only where all three are documented.

| Company | Payment intents | Routing | Provider adapters | Quote normalization | Approval workflows | Webhook ingestion | Settlement evidence | Reconciliation | Exceptions | Treasury | Liquidity | Funding exposure | Stablecoin attribution | Accounting integration | General ledger | Audit history | Developer experience | API reliability | Operational automation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Modern Treasury | VA [MT1] | NE | VA banks [MT12] | NE | VA [MT5] | VA [MT14][MT2] | VA bank txns, BAI2 [MT10][MT2] | VA [MT4] | VA [MT9] | VL balance reports [MT6] | NE | NE | VL send-only [MT7] | VL field only [MT2] | VA [MT8] | VA [MT11] | VA [MT6] | VL idem; SLA NE [MT3] | VA rules [MT4] |
| Stripe | VA [ST1] | NE | NE | NE | NE | VA [ST12] | VL trace_id; paid→failed [ST7] | VL auto payouts only [ST2] | VL [ST4] | NE | VA pending/available [ST6] | NE | VL settles to fiat balance [ST8] | VL RevRec [ST9] | VL balance txns [ST5] | NE | VA [ST1] | VL idem+retries; SLA NE [ST11][ST12] | VL [ST4] |
| Nium | VA [NI2] | NE | NE | VL index [NI0] | VA APPROVER [NI7] | VL at-most-once default [NI5] | VL PAID sub-states [NI2] | VL reports [NI3] | VA RFI/returns [NI6] | NE | VL AWAITING_FUNDS [NI2] | NE | NE | NE | NE | VA audit endpoint [NI2] | VA [NI0] | VL idem; retries opt-in [NI4][NI5] | NE |
| Thunes | VA [TH1] | NE | NE | VA locked quote [TH1] | NE | VL callbacks [TH1] | VL partner status [TH1] | VL statements [TH1] | VA codes/RFI [TH1] | NE | VL hold on confirm [TH1] | NE | NE | NE | NE | NE | VL [TH1] | NE | NE |
| Airwallex | VA [AW1] | NE | NE | VA quote_id [AW1] | VA [AW2][AW3] | VA [AW6] | VL PAID→FAILED [AW3] | VA own account [AW5] | VL [AW3] | VL [AW5] | VL funding states [AW3] | NE | VL [AW4] | VL Spend GL API [AW0] | NE | NE | VA [AW0] | VL retries; idem NE [AW6] | VL [AW2] |
| Primer | VA [PR1] | VA fallbacks [PR4] | VA [PR3] | NE | NE | VA [PR6] | VL processor reports [PR2] | VA [PR2] | VL monitors [PR0] | NE | NE | NE | NE | NE | NE | NE | VA [PR0] | VL idem+retries [PR5][PR6] | VA workflows [PR0] |
| Gr4vy | VA [GR1] | VA Flow [GR0] | VA [GR0] | NE | NE | VA [GR9][GR10] | VL PSP reports [GR4] | VA reconciliation_id [GR3] | NE | NE | NE | NE | NE | NE | NE | NE | VA [GR0] | VL idem+retries [GR8][GR10] | VL [GR0] |
| Formance | VL initiation [FM0] | NE | VA 20+ connectors [FM0] | NE | NE | VL [FM0] | VL pools; CAMT beta [FM6][FM8] | VA balance controls [FM3][FM8] | VA alerts [FM4] | VL cash pools [FM0] | NE | NE | VL exchange connectors [FM0] | NE | VA [FM0] | VA adjustments, timeline [FM1][FM4] | VA [FM0] | VL ledger idem [FM5] | VL orchestration [FM0] |
| Finmo | NE | NE | VL claim [FI2] | NE | NE | NE | NE | VL claim [FI0] | NE | VL claim [FI0] | VL claim [FI0] | NE | NE | VL claim [FI1] | NE | NE | NE | NE | VL claim [FI2] |
| Circle (Mint/CPN) | VA [CI1] | NE | NE | VA CPN quotes [CI0] | NE | VA [CI6][CI7] | VA hash, finality, CAMT [CI2][CI3] | VA CAMT.053 [CI3] | VA RFI/addendum [CI1] | VL Mint [CI4] | VL credit API [CI4] | VL settlement advance (index) [CI4] | VA CAMT TransactionHash [CI3] | NE | NE | NE | VA [CI0] | VA idem, retries, CAMT SLA [CI5][CI7][CI3] | NE |
| BVNK | VA [BV2] | NE | NE | VL estimates [BV0] | NE | VA [BV6] | VL BVNK-confirmed [BV2] | VA reports [BV1] | VA under/over/late [BV3][BV4] | NE | NE | NE | VA actual vs expected [BV3] | NE | VL ledger wallets [BV1] | NE | VA [BV0] | VL idem returns 400 [BV5][BV6] | VL auto-refund [BV4] |
| Bridge | VA [BR1] | NE | NE | NE | NE | VA [BR4] | VL preliminary→final hash [BR1] | NE | VA states [BR1][BR2] | NE | VL prefunded (index) [BR3] | NE | VL liquidation addresses [BR3] | NE | NE | NE | VA [BR0] | VL idem 24h [BR5] | VL drains [BR3] |
| Fireblocks | VL externalTxId [FB5] | NE | VL exchange connections [FB0] | NE | VA policies [FB4] | VA [FB6][FB7] | VA blockInfo [FB3] | VL customer-run [FB3] | VL screening [FB1] | VL wallet pools [FB0] | NE | NE | VL | NE | NE | NE | VA [FB0] | VL idem+retries [FB5][FB7] | VL |
| BitGo | NE | NE | NE | NE | VA [BG3] | VA [BG1] | VL confirmations [BG2] | NE | VL stuckTx [BG2] | NE | NE | NE | NE | NE | NE | NE | VA [BG0] | VL webhook idem+retries [BG1] | NE |
| Zero Hash | VA withdrawals [ZH1] | NE | NE | NE | VL PENDING approval [ZH1] | VA [ZH5] | VA status vs on_chain_status [ZH1] | VA guidelines [ZH2][ZH3] | VL encumbrance rules [ZH2] | NE | VL net settlement [ZH3] | NE | VL tx hash [ZH1] | NE | NE | VL reports [ZH4] | VA [ZH0] | VL X-REQUEST-ID [ZH6] | NE |

Reading notes:
- VA under "Reconciliation" for single providers (Stripe, Airwallex, Circle, BVNK) means reconciliation **of that provider's own activity**. It does not cover activity across providers.
- No row shows VA for both "Settlement evidence" from independent sources (bank *and* chain) and "Accounting integration". That gap is where Clearline would sit.

---

## State-model comparison: provider-reported completion versus settlement

| Company | Provider's "done" status | How settlement / finality is shown | Vendor-documented caveat |
|---|---|---|---|
| Modern Treasury | `completed` | Separate `reconciliation_status` (`unreconciled` / `tenatively_reconciled` / `reconciled`) [MT1] | `Completed` ≠ reconciled; `completed → returned/reversed`; `confirmed` "does not guarantee… settle" [MT1][MT2] |
| Stripe | PI `succeeded`; payout `paid` | Pending → available balance [ST6]; payout `reconciliation_status`, `trace_id` [ST7] | `paid` may later become `failed`; up to 5 business days [ST7][ST4] |
| Nium | Transaction `Approved`; payout `PAID` | Separate settlement status (`Unsettled`/`Settled`/`Released`…) [NI1]; `PAID` sub-states up to `DEEMED_PAID` [NI2] | `PROCESSED_BY_CLEARING`: limited visibility; `DEEMED_PAID` is time-based [NI2] |
| Thunes | `70000 COMPLETED` | Statement reports [TH1] | Callbacks stop; must poll [TH1] |
| Airwallex | `PAID` | Not separate | `PAID` may become `FAILED`; "monitor… until funds arrival is confirmed" [AW3] |
| Primer | `SETTLED` (processor-reported, in status) | Unified settlement report batches [PR2] | Fees can arrive days later; payout dates not unique [PR2] |
| Gr4vy | `capture_succeeded` | `settled` flag + settlement records; status unchanged [GR3] | Ingestion only from enable date [GR4] |
| Formance | `SUCCEEDED` | Balance controls against cash pools / statements [FM8] | No status state machine; statements in closed beta [FM7][FM6] |
| Circle CPN | `COMPLETED` | Tx `completed` after confirmations [CI2]; CAMT.053 [CI3] | Receiver "may or may not have received" [CI1] |
| BVNK | `Complete` (confirmed on chain by BVNK) | `paidCurrency.actual` vs `amount` [BV3] | Underpaid / late / on-hold paths [BV2][BV3] |
| Bridge | `payment_processed` | Final hash at `payment_processed` [BR1] | Earlier hash "may be preliminary" [BR1] |
| Fireblocks | `COMPLETED` | `blockInfo` + balance event at ≥ blockHeight [FB3] | Customer should independently check before crediting [FB3] |
| BitGo | Transfer `state` (e.g. `unconfirmed` → confirmed via threshold) | `numConfirmations` [BG2] | Go Account events are internal ledger, not mempool [BG2] |
| Zero Hash | `SETTLED` (ledger) | Separate `on_chain_status` [ZH1] | Internal transfers show `CONFIRMED` without on-chain activity [ZH1] |
| Clearline (sandbox) | `execution` from provider event | `settlement` only from bank line or chain observation; provider report = `observed / provider_report` (ARCHITECTURE.md §1) | Prototype; fictional data only |

---

## Differentiation thesis: evidence for and against

**Thesis under test:** Clearline can provide a consistent, independent financial history across providers, settlement evidence and accounting systems.

### Lifecycle coverage by vendor (from sources above)

| Lifecycle stage | Already documented by |
|---|---|
| Intent | All payment vendors (payment order, PaymentIntent, transfer, quote-locked CPN payment) |
| Route | Primer (workflows, fallbacks) [PR0][PR4]; Gr4vy (Flow) [GR0] — card/PSP only |
| Execution report | Every vendor, with webhooks |
| Evidence | Within each vendor's boundary. MT: bank transactions [MT10]. Circle: CAMT and tx hash [CI3]. Fireblocks: blockInfo [FB3]. Zero Hash: on_chain_status [ZH1]. Cross-provider bank-plus-chain evidence: none found |
| Reconciliation | MT (bank ↔ expected) [MT4]; Formance (balance-level, cross-source) [FM3]; Primer/Gr4vy (PSP settlement ↔ transaction) [PR2][GR3]; single-provider reports elsewhere |
| Exception | MT manual recon [MT9]; Formance alerts [FM4]; BVNK payment exceptions [BV3]; RFIs (Nium, Thunes, Circle) |
| Resolution | Formance alert resolve/accept with timeline [FM4]; MT manual reconcile [MT9] |
| Accounting outcome | MT Ledgers [MT8]; Formance Ledger [FM0]; Stripe Revenue Recognition [ST9]; Finmo ERP sync (claim) [FI1]. Human-approved posting of a reconciled payment to Xero/QuickBooks: not found in sources opened |

### Evidence for (plausible value)

1. **Vendors say their own completion is a claim.** Nine of the fourteen external vendors (MT, Stripe, Nium, Airwallex, Circle, Bridge, Fireblocks, BitGo, Zero Hash) document a status that can regress or is not final (state-model table). A layer that keeps those as claims and waits for independent evidence matches their own guidance:
   - Airwallex: "until funds arrival is confirmed" [AW3];
   - Fireblocks: "independent check" [FB3];
   - Zero Hash: encumber until terminal [ZH2].
2. **The integration burden is pushed to the customer** for payouts and stablecoins:
   - Stripe manual and instant payouts [ST2];
   - Nium at-most-once webhooks [NI5];
   - Thunes polling fallback [TH1];
   - Formance connector-to-ledger "separate step" [FM7].
3. **Stablecoin evidence semantics differ by vendor:**
   - Bridge: preliminary hash [BR1];
   - BitGo: Go Account off-chain events [BG2];
   - Zero Hash: internal `CONFIRMED` [ZH1];
   - Circle: confirmation count per chain [CI2].

   A customer using two or more of these would need one normalised rule for "verified on-chain". Clearline's chain module (allowlist, finality, reorg rule) addresses exactly this, in sandbox.
4. **No examined vendor documents cross-provider payout plus bank plus chain plus accounting.** Formance comes closest on infrastructure, but its reconciliation compares balances and leaves ledger postings to the integrator [FM3][FM7].

### Evidence against (where it is not needed, or already served)

1. **Single-provider customers are served.**
   - Stripe automatic payouts have a reconciliation report and API [ST2][ST5].
   - Airwallex has a transaction reconciliation report [AW5].
   - Circle Mint delivers daily CAMT.053 by 06:00 UTC [CI3].
   - BVNK has ledger reports and exception settings [BV1][BV3].

   Clearline's added value for them is limited to the accounting outcome and bank-side confirmation.
2. **Card merchants with several PSPs** already have unified settlement reconciliation from Primer or Gr4vy [PR2][GR3].
3. **Bank-centric companies** have Modern Treasury: rules, manual exceptions, approvals, audit trail, ledgers, and now stablecoin payouts [MT4][MT5][MT11][MT8][MT7].
4. **Engineering-led fintechs** can assemble the layer on Formance, which has connectors, reconciliation evidence, alerts and a ledger [FM0][FM3][FM4].
5. **No demand evidence.**
   - Clearline has 0 customers (COMPANY_RULES.md).
   - This research found no source showing buyers want a separate cross-provider evidence layer.
   - It found no customer dissatisfaction with any vendor; none was looked for or inferred.
6. **Evidence access is the hard dependency.** Independent bank evidence needs statement access: BAI2, CAMT.053, open banking. Formance's own statement ingestion is still closed beta [FM6]. Clearline's TARGET pilot design is unbuilt.

### Verdict

**Not proven.** The design is consistent with vendor documentation, and there is a plausible gap for multi-rail businesses: those combining payout providers, stablecoin providers and banks, where the accounting outcome needs a human approval. The gap is narrow for single-provider and card-only customers. Formance and Modern Treasury are the most direct overlaps.

**Next step (owner: product-manager, with gtm-strategist):** run 5–10 discovery calls with multi-rail finance teams to test whether "provider says paid, bank or chain says otherwise" is a recurring, costly exception. Before any positioning claim is made, the research above should be verified against those calls.

---

## Implications for Clearline Connect (adapter framework and API design)

Priority order: P1 = needed before any real-provider pilot; P2 = needed for credible multi-provider coverage; P3 = later.

**P1. Status mapping that allows regression and keeps raw values**
- Each adapter maps a provider status to `(execution claim, settlement claim, confidence)` and also stores, verbatim:
  - raw `status`;
  - sub-status: Nium `PAID` sub-states [NI2], Thunes numeric codes [TH1], Fireblocks `subStatus` [FB1];
  - addendum: CPN `statusAddendum` [CI1].
- Regressions must be first-class contradictions, not errors:
  - Stripe `paid→failed` [ST7];
  - MT `completed→returned/reversed` [MT1];
  - Airwallex `PAID→FAILED` [AW3].
- Clearline's rc3 returned-payout scenario already does this for one sandbox case. Make it an adapter-level rule.
- Time-based inferences (Nium `DEEMED_PAID`) map to a distinct confidence, never `verified`.

**P1. Pluggable webhook verification on the raw body**
At least these schemes are documented:
- hex HMAC-SHA256 `X-Signature` (MT) [MT14];
- `Stripe-Signature` [ST12];
- base64 HMAC with a rotation header (Primer) [PR6];
- timestamp plus multiple signatures (Gr4vy) [GR9];
- RSA over a double SHA-256 with a timestamp (Bridge) [BR4];
- detached JWS via JWKS (Fireblocks) [FB6];
- RSA or HMAC with a timestamp (Zero Hash) [ZH5];
- HMAC `x-signature-sha256` (BitGo) [BG1];
- HMAC `X-Signature` (BVNK) [BV6].

The adapter interface needs `verify(rawBody, headers, keyMaterial)`, with support for key rotation (several active secrets) and a replay window. Where a provider's signing is `[NOT ESTABLISHED]` (Nium, Thunes), the adapter must default to "unverified → poll to confirm".

**P1. Dedupe and ordering independent of delivery**
- Dedupe keys differ by provider:
  - Stripe event id, with a fallback of object id + type [ST12];
  - Airwallex `id` [AW6];
  - `X-Gr4vy-Webhook-ID` [GR9];
  - Nium `x-request-id`, which is reused on redelivery [NI5];
  - BVNK event id [BV6].
- Never use arrival order. Stripe and Airwallex disclaim ordering [ST12][AW6]. Order by provider object state and version, with Clearline's own progress ranks.

**P1. A polling reconciler as a required adapter capability**
- Nium webhooks are at-most-once by default [NI5].
- Thunes tells partners to query once callbacks stop [TH1].
- Primer's last retry is at about 30 minutes [PR6].
- BitGo auto-blocks a URL after 10 non-retryable 4xx responses in an hour [BG1].

Each adapter should expose `fetchStatus(providerRef)` and `listSince(cursor)`, driven by a schedule and by every unresolved intent.

**P2. Outbound idempotency semantics per adapter**
The contract should declare replay versus reject, key length, scope and TTL:
- Stripe: 255 characters, replays the first response including a 500 [ST11];
- MT: 180 characters, route-independent, 24 hours [MT3];
- Fireblocks: 40 characters, and `externalTxId` (not the header) for transactions [FB5];
- BVNK: UUID, **400** on repeat [BV5];
- Bridge: required on every POST, body must match [BR5];
- Nium: `x-request-id`, 24 hours [NI4];
- Zero Hash: `X-REQUEST-ID` [ZH6];
- Gr4vy: 255 characters / 24 hours [GR8].

Clearline's TARGET `idempotency_keys` table should hold the provider key alongside its own.

**P2. Correlation identifier model**
Follow Gr4vy's three-layer guidance (merchant, platform, PSP IDs) [GR2]. Add:
- network references: ACH trace, Fedwire IMAD/OMAD [MT2];
- Stripe `trace_id` [ST7];
- `reconciliation_id` [GR6];
- Thunes `external_id` [TH1];
- on-chain `transactionHash`, with a `preliminary` flag (Bridge) [BR1].

Only exact identifiers should auto-link, which is consistent with Clearline's matching rule.

**P2. Evidence source classification**
- **Independent:** bank statements (BAI2 [MT10], CAMT.053) and Clearline's own chain observation.
- **`provider_report`:** Circle CAMT.053 [CI3], Primer and Gr4vy settlement reports [PR2][GR3], Stripe payout reconciliation [ST2], Thunes statements [TH1], BVNK ledger reports [BV1], Zero Hash reports [ZH4]. These are provider-authored, so they stay provider reports.
- **Provider-ledger claims, not chain evidence:** Zero Hash internal `CONFIRMED` [ZH1] and BitGo Go Account events [BG2].

**P3. Quote normalization**
Normalise locked quotes into one shape (rate, fees, expiry, source and destination amounts):
- Thunes quotation [TH1];
- Airwallex `quote_id` [AW1];
- CPN quotes [CI0];
- Nium locked rate [NI0].

Record which quote an execution actually used.

**P3. Approvals: ingest, don't duplicate**
Providers already run approvals:
- MT `approved`/`denied` [MT2];
- Airwallex `IN_APPROVAL…` [AW3];
- Nium `APPROVER` [NI7];
- Fireblocks policies [FB4];
- BitGo `pendingapproval` [BG2].

Clearline should record these as audit events. It should keep its own maker/checker for the **accounting outcome** and for exception resolution, which no source shows the providers covering end to end.

**P3. Do not build a ledger**
MT Ledgers [MT8] and Formance [FM0] are mature. Clearline's TARGET design already excludes a shared ledger. An adapter to read from, or export to, a customer's ledger is more defensible than competing with one.

---

## Source register

All URLs opened by research-agent on 2026-11-15 via curl through the session proxy. Each ID stands for `[VERIFIED: research-agent 2026-11-15, <url>]`.

**Modern Treasury**
- MT1 https://docs.moderntreasury.com/platform/reference/payment-order-object.md
- MT2 https://docs.moderntreasury.com/platform/reference/payment-orders.md
- MT3 https://docs.moderntreasury.com/platform/reference/idempotent-requests.md
- MT4 https://docs.moderntreasury.com/payments/docs/defining-reconciliation-rules.md
- MT5 https://docs.moderntreasury.com/payments/docs/approval-rules-overview.md
- MT6 https://docs.moderntreasury.com/platform/llms.txt
- MT7 https://docs.moderntreasury.com/payments/docs/stablecoins.md
- MT8 https://docs.moderntreasury.com/ledgers/docs/transaction-status-and-balances.md (and https://docs.moderntreasury.com/ledgers/llms.txt)
- MT9 https://docs.moderntreasury.com/payments/docs/exception-handling-manual-reconciliation.md
- MT10 https://docs.moderntreasury.com/payments/docs/import-transactions-via-bai2-files.md
- MT11 https://docs.moderntreasury.com/payments/docs/audit-a-payment-order.md
- MT12 https://www.moderntreasury.com/integrations
- MT13 https://docs.moderntreasury.com/platform/reference/cases.md
- MT14 https://docs.moderntreasury.com/platform/docs/verifying-webhooks.md

**Stripe**
- ST1 https://docs.stripe.com/payments/paymentintents/lifecycle.md
- ST2 https://docs.stripe.com/reports/payout-reconciliation.md
- ST3 https://docs.stripe.com/payments/payment-intents/verifying-status.md
- ST4 https://docs.stripe.com/payouts.md
- ST5 https://docs.stripe.com/payouts/reconciliation.md
- ST6 https://docs.stripe.com/payments/balances.md
- ST7 https://docs.stripe.com/api/payouts/object.md
- ST8 https://docs.stripe.com/payments/stablecoin-payments.md
- ST9 https://docs.stripe.com/revenue-recognition.md
- ST10 https://docs.stripe.com/get-started/account/teams/roles.md
- ST11 https://docs.stripe.com/api/idempotent_requests.md
- ST12 https://docs.stripe.com/webhooks.md

**Nium**
- NI0 https://docs.nium.com/llms.txt
- NI1 https://docs.nium.com/docs/transactions/transaction-statuses.md
- NI2 https://docs.nium.com/docs/payouts/transfer-money/remittance-lifecycle.md
- NI3 https://docs.nium.com/docs/reports/client-reports/client-settlement-report-v2.md
- NI4 https://docs.nium.com/docs/developers/nium-api/idempotency.md
- NI5 https://docs.nium.com/docs/developers/notifications-and-webhooks.md
- NI6 https://docs.nium.com/docs/transactions/transaction-rfis.md
- NI7 https://docs.nium.com/docs/nium-portal/roles-and-permissions.md

**Thunes**
- TH0 https://docs.thunes.com/ (docs landing page)
- TH1 https://docs.thunes.com/money-transfer/v2/

**Airwallex**
- AW0 https://www.airwallex.com/docs/llms.txt
- AW1 https://www.airwallex.com/docs/payouts/transfers/create-a-transfer.md
- AW2 https://www.airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers.md
- AW3 https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses.md
- AW4 https://www.airwallex.com/docs/payouts/transfers/transfers-via-stablecoin.md
- AW5 https://www.airwallex.com/docs/global-treasury/reporting/financial-reports.md
- AW6 https://www.airwallex.com/docs/developer-tools/webhooks/webhooks-overview.md

**Primer**
- PR0 https://primer.io/docs/_llms/documentation.txt
- PR1 https://primer.io/docs/concepts/payment-lifecycle.md
- PR2 https://primer.io/docs/reconciliation/unified-settlement-report.md
- PR3 https://primer.io/docs/reconciliation/supported-processors.md
- PR4 https://primer.io/docs/payment-services/fallbacks.md
- PR5 https://primer.io/docs/checkout/primer-checkout/guides-and-recipes/use-idempotency-keys.md
- PR6 https://primer.io/docs/api-reference/get-started/configure-webhooks.md

**Gr4vy**
- GR0 https://docs.gr4vy.com/llms.txt
- GR1 https://docs.gr4vy.com/guides/api/statuses/transactions.md
- GR2 https://docs.gr4vy.com/guides/ids.md
- GR3 https://docs.gr4vy.com/guides/dashboard/reports/settlement/settlement-records.md
- GR4 https://docs.gr4vy.com/guides/dashboard/reports/settlement/ingestion.md
- GR5 https://docs.gr4vy.com/guides/dashboard/flow/overview.md (index entry in GR0; page itself not opened)
- GR6 https://docs.gr4vy.com/guides/dashboard/reports/settlement/reconciliation.md
- GR7 https://docs.gr4vy.com/guides/dashboard/roles-and-permissions/roles.md
- GR8 https://docs.gr4vy.com/guides/api/idempotent-requests.md
- GR9 https://docs.gr4vy.com/guides/features/webhooks/signatures.md
- GR10 https://docs.gr4vy.com/guides/features/webhooks/technical-considerations.md

**Formance**
- FM0 https://docs.formance.com/llms.txt
- FM1 https://docs.formance.com/modules/payments/payments
- FM2 https://docs.formance.com/modules/payments/connectors
- FM3 https://docs.formance.com/v3.2/modules/reconciliation/concepts
- FM4 https://docs.formance.com/v3.2/modules/reconciliation/alerts
- FM5 https://docs.formance.com/v3.2/modules/ledger/working-with/idempotency
- FM6 https://docs.formance.com/cloud/banking-bridge/account-statement-ingestion
- FM7 https://docs.formance.com/modules/payments/connectors/generic/payment-lifecycle
- FM8 https://docs.formance.com/v3.2/modules/reconciliation/controls

**Finmo**
- FI0 https://www.finmo.net/
- FI1 https://www.finmo.net/hk/seamless-accounting-integration
- FI2 https://www.finmo.net/product/connected-financial-dashboard

**Circle**
- CI0 https://developers.circle.com/llms.txt
- CI1 https://developers.circle.com/cpn/concepts/payments/component-states-and-workflows.md
- CI2 https://developers.circle.com/cpn/concepts/transactions/block-confirmation-and-finality.md
- CI3 https://developers.circle.com/circle-mint/references/camt053-statements.md
- CI4 https://developers.circle.com/_llms/liquidity-services.txt
- CI5 https://developers.circle.com/circle-mint/howtos/transfer-on-chain.md
- CI6 https://developers.circle.com/cpn/concepts/webhooks/webhook-security.md
- CI7 https://developers.circle.com/cpn/concepts/webhooks/webhook-retries.md

**BVNK**
- BV0 https://docs.bvnk.com/llms.txt
- BV1 https://docs.bvnk.com/bvnk/reconciliation/reconcile-transactions.md
- BV2 https://docs.bvnk.com/bvnk/use-cases/stablecoin-payments-for-platforms/get-payment.md
- BV3 https://docs.bvnk.com/bvnk/use-cases/stablecoin-payments-for-platforms/underpayments.md
- BV4 https://docs.bvnk.com/bvnk/use-cases/stablecoin-payments-for-platforms/auto-refund-to-source-address.md
- BV5 https://docs.bvnk.com/bvnk/api-explorer/api-overview/idempotency.md
- BV6 https://docs.bvnk.com/bvnk/get-started/create-webhook-listener.md

**Bridge**
- BR0 https://apidocs.bridge.xyz/get-started/introduction/overview.md
- BR1 https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-states.md
- BR2 https://apidocs.bridge.xyz/platform/orchestration/more/returns.md
- BR3 https://apidocs.bridge.xyz/llms.txt
- BR4 https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature.md (and https://apidocs.bridge.xyz/platform/additional-information/webhooks/overview.md)
- BR5 https://apidocs.bridge.xyz/api-reference/introduction/idempotence.md

**Fireblocks**
- FB0 https://developers.fireblocks.com/_llms/guides.txt
- FB1 https://developers.fireblocks.com/reference/statuses.md
- FB2 https://developers.fireblocks.com/docs/define-confirmation-policy.md
- FB3 https://developers.fireblocks.com/docs/validate-balances.md
- FB4 https://developers.fireblocks.com/docs/set-transaction-authorization-policy.md
- FB5 https://developers.fireblocks.com/reference/api-idempotency.md
- FB6 https://developers.fireblocks.com/reference/validating-webhooks.md
- FB7 https://developers.fireblocks.com/reference/webhooks-gettingstarted-responsesretries.md

**BitGo**
- BG0 https://developers.bitgo.com/llms.txt
- BG1 https://developers.bitgo.com/docs/webhooks-overview.md
- BG2 https://developers.bitgo.com/docs/webhooks-wallet.md
- BG3 https://developers.bitgo.com/docs/policies-create.md

**Zero Hash**
- ZH0 https://docs.zerohash.com/llms.txt
- ZH1 https://docs.zerohash.com/docs/withdrawal-api-response-field-interpretation.md
- ZH2 https://docs.zerohash.com/docs/withdrawals-releasing-funds.md
- ZH3 https://docs.zerohash.com/docs/account-funding-reconciliation.md
- ZH4 https://docs.zerohash.com/docs/reporting-suite.md
- ZH5 https://docs.zerohash.com/reference/webhook-security.md
- ZH6 https://docs.zerohash.com/docs/request-ids.md

**Secondary (labelled `[ASSUMPTION: secondary]` where used)**
- WebSearch, "docs.moderntreasury.com payment order status…": used for URL discovery and one expected-payments point.
- WebSearch, "Finmo treasury reconciliation Xero NetSuite…": summary citing finmo.net/integrations and mindcloud.co.
