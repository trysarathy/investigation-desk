# Security answers (the only approved source for security questions)

Used by sales-closer-assistant, revops-crm-agent, content and anyone answering a prospect. Labels:
**[VERIFIED]** = true in the code or company docs on `main` today (file given); **[ASSUMPTION]** =
needs Aashmiin to confirm before it goes to a prospect. Checked 2026-10-31. Fuller detail:
`docs/enterprise/SECURITY_OVERVIEW.md` and `SECURITY_QUESTIONNAIRE.md` (branch `enterprise-pack`).

## "Are you SOC 2?" (the one answer)

> No. We're pre-SOC 2. Here's what we do instead: Clearline is read-only on the blockchain, never
> holds funds and never asks for keys; it posts to Xero only after a person on your team approves
> each entry. We're happy to fill in your security questionnaire, and SOC 2 is planned once we have
> paying customers who need it.

Never say "SOC 2 in progress", "SOC 2 compliant", "SOC 2-ready" or "enterprise-grade". If their
policy requires SOC 2 before any vendor touches finance data, say so plainly: "Then we're not ready for
you yet" [VERIFIED: docs/enterprise/OBJECTIONS.md:14; SECURITY_OVERVIEW.md:122].

| Statement | Label | Source |
|---|---|---|
| No SOC 2 report, no penetration test yet | [VERIFIED] | `docs/enterprise/SECURITY_OVERVIEW.md:6,114` |
| Read-only on chain; no custody; never asks for private keys or seed phrases | [VERIFIED] | `company/COMPANY_RULES.md` rule 3; chain code only reads (`src/lib/chain/*`) |
| Posts to Xero only after a person clicks Approve | [VERIFIED] | `docs/ACCOUNTING_SYNC.md`; `src/lib/accounting/service.ts` approval flow |
| SOC 2 planned after paying customers need it | [VERIFIED] (stated plan) | `SECURITY_OVERVIEW.md:122` |
| Happy to fill in a security questionnaire | [VERIFIED] | `docs/enterprise/SECURITY_QUESTIONNAIRE.md` exists |

## Questionnaire answer sheet (draft)

| Topic | Answer today | Label | Source |
|---|---|---|---|
| **Data stored** | Payment requests, observed on-chain transfers (hashes, addresses, amounts), the customer's uploaded records (invoices/ledger CSVs), decisions and an audit log, and Xero connection tokens. Stored as JSON files in one data directory per deployment (`.data/`, or `DESK_DATA_DIR`). No card or bank credentials, no private keys | [VERIFIED] | `src/lib/data-dir.ts`; `src/lib/accounting/store.ts`; `src/lib/requests/service.ts` |
| **Deployment model** | One deployment per company (no shared multi-tenant database); self-hosting possible from the Dockerfile | [VERIFIED] | `whitepaper/Clearline_Whitepaper.md` architecture; `Dockerfile` |
| **Where it's hosted / region** | Provider-hosted pilot on a host and region chosen per customer, or self-hosted | [ASSUMPTION] which host and region (template says Fly.io / Render / Google Cloud Run) | `docs/enterprise/DATA_PROCESSING_TERMS_TEMPLATE.md` §5 |
| **Access control** | Optional shared password on a deployment (HTTP Basic, `PREVIEW_USER`/`PREVIEW_PASSWORD`). **No individual user accounts, roles or SSO yet** | [VERIFIED] | `src/middleware.ts:1-29` |
| **Who at Clearline can access data** | Only the founder (one-person operation) | [ASSUMPTION] confirm, and how access is logged | `docs/enterprise/OBJECTIONS.md:11` |
| **Encryption in transit** | Outbound calls use HTTPS; the app relies on the host for TLS | [VERIFIED] | `SECURITY_QUESTIONNAIRE.md` C1 |
| **Encryption at rest** | **Not yet**: plain JSON files; only disk-level encryption if the host provides it. Xero tokens are plain JSON | [VERIFIED] | `SECURITY_QUESTIONNAIRE.md` C2, C3; `src/lib/accounting/providers/xero-auth.ts` |
| **Secrets in logs** | API keys are redacted from stored URLs; Xero errors never echo tokens | [VERIFIED] | `src/lib/chain/http.ts:83-85`; `SECURITY_QUESTIONNAIRE.md` C5 |
| **Sub-processors** | Hosting provider; Xero (customer's own system); Google Workspace (support email); chain data providers (Etherscan, TronGrid, public RPCs, Blockscout) see hashes/addresses looked up; Anthropic only if the customer opts in, with customer IDs removed (off by default) | [VERIFIED] list as drafted; [ASSUMPTION] that it's final | `DATA_PROCESSING_TERMS_TEMPLATE.md` §5; `src/lib/ai/anthropic.ts` |
| **Data deletion / return** | On request at pilot end | [ASSUMPTION] confirm the process and time limit | `DATA_PROCESSING_TERMS_TEMPLATE.md` |
| **Incident contact** | Aashmiin Kaur, aashmiin@gmail.com | [ASSUMPTION] confirm this is the address to give, and the notice time | `SUPPORT_AND_UPTIME.md` (enterprise-pack) |
| **Incident history** | No security incidents; no customer data has been held | [VERIFIED] | 0 customers (`company/PRODUCT_FACTS.md`) |
| **Penetration test** | None yet; planned before the first customer with real volume | [VERIFIED] | `SECURITY_OVERVIEW.md:114` |
| **Business continuity** | No second operator; self-hosting and source escrow on request | [VERIFIED] (stated); [ASSUMPTION] escrow terms | `SECURITY_QUESTIONNAIRE.md` F4 |

Rule for drafts: copy answers from this table as written. Anything [ASSUMPTION] goes to Aashmiin as a
question before the answer leaves the building.
