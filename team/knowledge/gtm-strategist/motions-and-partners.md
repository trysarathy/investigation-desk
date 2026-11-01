# Enterprise vs mid-market/SMB motion, and partner strategy

Last refreshed 2026-10-31 · owner gtm-strategist. Internal sources: `docs/enterprise/*` (branch
`enterprise-pack`), `prompts/CALL_SCRIPT.md`, `team/knowledge/research-intern/clearline-context.md`.
General practice statements are [ASSUMPTION: common B2B practice] unless sourced.

## 1. Motion differences
| | SMB (< 50 staff) | Mid-market (50-1,000) | Enterprise (> 1,000 or listed; S5 payment companies) |
|---|---|---|---|
| Buyer | Founder/CEO or the one finance person | Controller / head of finance; ops lead as user | COO / head of payment ops / CFO + IT security + procurement + legal |
| Entry | Cold email learning call → demo if Strong | Same, plus a champion who brings the controller | Usually intro or inbound; cold rarely works [ASSUMPTION] |
| Proof they need | Their own payments matched in a demo; price on the page | ROI calculator with their numbers; pilot success criteria | Security questionnaire, architecture, DPA, references, often SOC 2 / SSO |
| Clearline assets | One-pager, demo, pilot proposal | + `ROI_CALCULATOR.md`, `MUTUAL_ACTION_PLAN_TEMPLATE.md` | + `SECURITY_OVERVIEW.md`, `SECURITY_QUESTIONNAIRE.md`, `DATA_PROCESSING_TERMS_TEMPLATE.md`, `ARCHITECTURE.md` |
| Cycle (guess) | days-2 weeks [GUESS] | 2-6 weeks [GUESS] | months [GUESS] |
| Price | Founding offer as is | Founding offer; scope may narrow (her call) | "On request"; self-hosting, entities, security support (`ENTERPRISE_ONE_PAGER.md`) |
| Honest blocker | Volume below break-even | Multiple approvers; Tron | No SOC 2, no SSO, plain-JSON tokens, solo founder: "we're not ready for you yet" if policy requires it (`OBJECTIONS.md`) |
| Strategist stance now | **Primary motion** (beachhead) | Secondary, opportunistic | **Do not pursue proactively**; qualify out early unless self-hosting removes the blocker |
Qualify-out questions for enterprise (from `OBJECTIONS.md`): "Does your policy require SOC 2 or
SSO before a vendor touches finance data?" "What share of stablecoin receipts skip your provider's
checkout?"

## 2. Partner strategy
Why partners [ASSUMPTION]: one accounting firm or Web3 bookkeeper sees month-end pain across many
SMB clients and is trusted; Cryptio runs a 50+ accounting-firm programme
(`competitor-positioning.md` T1, [VERIFIED as their claim]); Ledgible gives tax professionals a
free seat and charges clients per client (T4, [VERIFIED as their pricing]).

### 2.1 Partner types and what they get
| Type | Examples (category, not named firms) | Their job-to-be-done | Offer to test (PROPOSAL, her decision) |
|---|---|---|---|
| Crypto practices at accounting/audit firms | Firms with a digital-asset advisory or audit line | Clean, evidenced stablecoin receipts at month end and audit; fewer client questions | Free partner workspace; clients on the founding offer; co-built month-end evidence pack; early say on QuickBooks |
| Web3 bookkeepers / outsourced finance | Fractional CFOs/bookkeepers for Web3 firms | Fewer hours per client on stablecoin matching | Same + per-client pricing hypothesis (pricing H5) |
| Company-formation / corporate-services firms (SG/HK/UAE) | Firms incorporating Web3 companies | A value-add for new clients | Referral intro only; no rev share until Aashmiin decides |
| Gateways that don't reconcile direct transfers | Self-serve gateways (S3 context) | Fewer support tickets on wrong payments | Parked: integration work, gateway already reconciles its own flows |

### 2.2 Programme design rules
- Partners never receive customer data without that customer's written consent; read-only and
  no-custody claims apply to partner materials too.
- No referral fees, revenue share, discounts or white-label without a numbered decision by
  Aashmiin (money = rule 6). Any partner agreement = contract = her approval and professional review.
- What partners may say: the same claims sales may say (`clearline-gtm-today.md` §3, §5), nothing more.
- First contact with each partner is a draft in the 07:30 approval queue (revops-crm-agent drafts;
  10:51 partnerships task). Mentors (Prof Paul Griffin, Dr Catalin Burlacu, Soon Loo, Donna,
  Doug Peris), SMU staff, investors and her warm network are **hers** to approach; QRE/QCDAO never.
- Track in the Partners tab (columns: partner, type, country, contact, evidence url, status,
  referrals, intro via, next_action, notes); referrals carry `intro via` on the Leads row.
- Partner experiment (PROPOSAL): EXP "accounting-firm design partners": 5 conversations grade B+
  in 30 days → >= 1 client referral = ITERATE/SCALE; 0 conversations after 15 approved drafts =
  KILL the channel for now.
