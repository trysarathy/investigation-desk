# Clearline GTM today: ICP, segments, offer, positioning (as written)

Last refreshed 2026-10-31 · owner gtm-strategist · source: Clearline's own files (primary for
what *we* say; none of it is customer-validated). Re-read the cited files every run; if they
changed, they win over this summary.

## 1. Stage and evidence base
- 0 customers; working product; solo founder (`company/COMPANY_RULES.md`).
- Outreach started 29 Oct 2026; stated goal "20 calls and 3 paid pilots"; "if exceptions turn out
  to be rare or cheap, I'll change the wedge or stop" (`whitepaper/HARD_QUESTIONS.md` Q1, branch
  `whitepaper`).
- SPEC keeps a **20 Nov kill date** "and its criteria from the decision spec" (`docs/SPEC.md`,
  head-of-product verdict point 5). The criteria themselves are not in this repo: ask chief-of-staff
  / Decisions log before using them. [ASSUMPTION: criteria exist in the decision spec]
- Calls so far: read the Calls tab every run. Until it says otherwise, treat every segment
  conclusion as **n too small** (see `experiments-and-decision-rules.md`).

## 2. The offer (binding until Aashmiin changes it)
| Element | As written | Source |
|---|---|---|
| Founding pilot | US$300 for 30 days | `company/COMPANY_RULES.md` context; `docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md` §6 (branch `enterprise-pack`) |
| After pilot | US$200/month, cancel any time | same |
| Credit | Pilot fee credited against months 2-4 | `PILOT_PROPOSAL_TEMPLATE.md` §6; `OBJECTIONS.md` "pricing" |
| Cap | First 10 businesses ("one of 10 founding pilots") | `docs/enterprise/CLAIMS_AUDIT.md` row 38 (branch `enterprise-pack`, citing `gtm/offer.py` in the GTM repo); `team/knowledge/chief-of-staff/okrs-metrics.md` |
| Refund | Pilot fee refunded if "every payment matched or explained" or "zero wrong postings" missed for reasons on our side | `PILOT_PROPOSAL_TEMPLATE.md` §3; `OBJECTIONS.md` |
| Enterprise | "Enterprise pricing on request" (self-hosting, multiple entities, security review support) | `ENTERPRISE_ONE_PAGER.md` |
| Billing entity | Founder's sole proprietorship in India (bank transfer, PayPal, Wise) | `ENTERPRISE_ONE_PAGER.md` |
| Price status | "Untested" | `whitepaper/CLAIMS_AUDIT.md` row P0 |

**Contradiction to escalate:** the website (branch `pitch-deck`, `website/src/components/Partners.tsx`
and `Sections.tsx`) still says "Free during the pilot" / "Free for design partners during the
pilot". `OBJECTIONS.md` says this "is out of date and is being corrected"; the enterprise
claims audit (`docs/enterprise/CLAIMS_AUDIT.md` row 1) marks it **FALSE** and gives the
replacement line. gtm-strategist never
edits the website; it flags the mismatch to Aashmiin and lead-designer/content as an owner fix.

## 3. Positioning and messaging as written
- **Headline** (one line used everywhere): "Stablecoin payments, matched, explained and in your
  books." (`website/src/lib/site.ts`; `prompts/RULES.md` "Accounting question" section, gtm-os).
- **Website sub-line**: "Clearline asks for each payment clearly, matches it to its invoice, checks
  it's genuine, explains anything that went wrong in plain English, and posts it to your accounting
  system when you approve." Hero eyebrow: "Working demo · early access". Audience line: "For finance
  teams paid in stablecoins (digital dollars such as USDC)" (`website/src/components/Hero.tsx`).
- **Call/reply line**: "once a person approves, posted to the invoice in their accounting system
  (Xero first, QuickBooks next)" (`prompts/RULES.md`).
- **Outreach frame**: learning calls, "I'm not selling anything" (`prompts/RULES.md` writing rules;
  `prompts/CALL_SCRIPT.md`). Demo only at the end and only if the problem sounded Strong.
- **Problem framing**: payments with no invoice reference, short after exchange fees, wrong
  network, counterfeit token; finance matches, diagnoses, writes to the customer and types it into
  the books by hand (`ENTERPRISE_ONE_PAGER.md`). "[ASSUMPTION: how often, and how many hours it
  costs, is not yet measured with any customer.]"
- **Differentiation hypothesis** (from `OBJECTIONS.md`): smaller business paid directly into its
  own wallet; wrong payments explained, reply drafted, posted correctly; priced for a small finance
  team. Explicitly "a hypothesis we're testing".

## 4. ICP and segments as written
- **Buyer**: finance lead (CFO, controller, head of finance/finance ops), head of payments ops,
  treasury; founder/CEO at <50 staff. **User**: the person matching payments to invoices
  (`team/knowledge/research-intern/clearline-context.md`).
- **Company**: receives USDC/USDT from its own customers, ideally into its own wallet, with
  invoices; uses or will use Xero/QuickBooks (same file).
- **Segments in the order research finds evidence** (not a measured ranking): crypto/Web3 SaaS,
  data, RPC, node and AI-API firms; prop-trading challenge firms and USDT-priced online services;
  hosting/VPS/proxy/VPN; Web3 agencies, studios, audit firms, crypto media/events; Web3
  legal/accounting/formation firms; PSPs/OTC/exchanges/remitters; merchants on gateways that settle
  in crypto (`team/knowledge/research-intern/market.md` §4).
- **SPEC's original buyer** (23 Oct direction): COO/controller/head of payment ops at a payment
  company using several providers (`docs/SPEC.md`). This is a *different* motion (larger, ops-led,
  data-integration heavy) from the SMB invoice-matching ICP above. Treat them as two hypotheses.
- **Weak fit**: merchants on gateways that convert to fiat (Stripe, Coinbase/Shopify default,
  HitPay/Triple-A) (`market.md` §4). **Not ICP**: issuers, retail users, outbound-only payers,
  government, charities (`clearline-context.md`).
- **Tiers**: Targets tab Enterprise (>1,000 staff or listed) / Mid-market (50-1,000) / SMB (<50) /
  Partner; Leads tier 1/2/3 from `gtm/score.py` (>=70 / 50-69 / <50). gtm-strategist may *propose*
  scoring changes; revops-crm-agent owns the code path, Aashmiin approves.

## 5. Product limits that bound positioning (never position past these)
From `ENTERPRISE_ONE_PAGER.md` and `whitepaper/HARD_QUESTIONS.md` Q4-Q5: payment pages are
Ethereum USDC/USDT only; live mode needs a pasted hash (no address watching); a person marks paid;
Xero posting built and tested but not yet run against a real Xero organisation; QuickBooks next;
NetSuite designed, not built; no sign-in, no SOC 2, tokens stored as plain JSON; one founder.
Likely-ICP buyers in SG/HK use Tron for USDT [ASSUMPTION, HARD_QUESTIONS Q5]: **positioning
to a Tron-heavy segment must say "Tron is next on the roadmap", not imply support.**

## 6. Channels in use today
Cold email from personal Gmail under lean mode (caps from Settings: CURRENT_SEND_CAP 75 total,
FIRST_EMAIL_CAP 50, per `prompts/RULES.md`), LinkedIn by hand (daily list), partnerships drafts
(10:51 weekday task), website with a design-partner form. Strict-consent countries and US without
POSTAL_ADDRESS excluded from cold email.

## 7. Open questions the data must answer (owner of the answer in brackets)
1. Which segment has the most Strong problem scores per held call? (Calls tab; gtm-strategist)
2. What share of each segment's receipts skip a gateway? (call Q6/objection ask; sales)
3. Which accounting system do they use (question 5 answers)? (Calls tab; weekly wrap)
4. Does anyone accept US$300 / US$200 without a discount request? (Opportunities; sales)
5. Payment volume per month by segment (ROI break-even ~22 payments/month at defaults). (Calls `volume_per_month`)
