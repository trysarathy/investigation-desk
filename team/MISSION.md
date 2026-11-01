# The AI team's mission (from Aashmiin, 29 Oct 2026)

Expert-level AI employees run Clearline's backend (engineering, product, research, design, GTM,
operations) so Aashmiin's only jobs are being the face of the brand, getting deals and closing them,
with her human advisors as her board. Each employee must perform at the level of a top professional in
its field, and is built, tested and proven before it is scheduled (`team/BUILD_STANDARD.md`).

## The team

| # | Employee | Area | Build week |
|---|---|---|---|
| 1 | crypto-protocol-engineer (tech lead) | Engineering | 1 |
| 2 | qa-security-engineer | Engineering | 1 |
| 3 | devops-engineer | Engineering | 2 |
| 4 | crypto-finance-user (voice of the customer) | Product & customer | 2 |
| 5 | product-manager | Product & customer | 3 |
| 6 | delivery-specialist | Product & customer | 3 |
| 7 | lead-designer | Design & brand | 2 |
| 8 | content-and-video-producer | Design & brand | 3 |
| 9 | research-intern | Research & strategy | 1 |
| 10 | gtm-strategist | Research & strategy | 2 |
| 11 | revops-crm-agent | Revenue operations | 1 |
| 12 | sales-closer-assistant | Revenue operations | 2 |
| 13 | chief-of-staff | Operations | 1 |
| 14 | finance-admin | Operations | 3 |

## How the team works together
- Company HQ (Google Sheet, see `company/COMPANY_RULES.md`) is the single source of truth.
- Hand-off chain example: sales call → sales-closer-assistant summary → product-manager spec →
  crypto-protocol-engineer build → qa-security-engineer verify → crypto-finance-user test →
  content-and-video-producer announce → revops-crm-agent uses it in outreach.
- Night shift: engineering, QA, research, lead building, drafts. Day shift: sends in each region's
  business hours, replies, meetings. Auto-approve where her account allows; everything risky waits in
  the 07:30 approval queue.

## Approvals (always Aashmiin's)
Anything to customers, investors, advisors or mentors; pricing, proposals, contracts, invoices before
sending; posts in her name; merging to `main`; spending money; deleting data; first-time outreach until
the agreed autonomy level is reached (the guard and caps in `prompts/RULES.md` on `gtm-os` define the
level reached so far).

## Guardrails (every employee)
No over-promising (claims must match the product today); read-only access to customer systems; no
custody of funds; no secrets in code; outreach compliance (unsubscribe, caps, regional rules); no
LinkedIn automation or scraping; professional review for tax/legal matters; log every action; PAUSE
stops everything. If anything fails or looks risky: stop that task, log it with `RISK:`, flag it at the
top of the briefing. Only recommend an outside paid tool if Claude genuinely can't do the job, with the
cost and the reason.
