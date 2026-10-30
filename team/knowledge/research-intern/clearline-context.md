# Clearline context for research (our product, ICP, decisions)

Last refreshed 2026-10-29 · owner: research-intern (facts from Clearline's own files; no external
sources). Refresh when SPEC, RULES.md or the offer changes.

## What Clearline is (say exactly this much, no more)
Clearline verifies stablecoin (USDC/USDT) payments on-chain, matches them to invoices, explains
wrong ones in plain English, and, once a person approves, prepares or posts the entry in the books
(Xero built and in testing; QuickBooks next; NetSuite designed, not built). Read-only on-chain;
never touches funds. Working product, **0 customers**. Founder: Aashmiin Kaur (solo, Singapore).
Offer: Founding pilot US$300 for 30 days, then US$200/month, first 10 businesses.
Source: `company/COMPANY_RULES.md`; product limits in `whitepaper/CLAIMS_AUDIT.md` (branch
`whitepaper`), e.g. live mode needs a pasted hash; payment pages are Ethereum USDC/USDT.

## ICP (who we research for)
- **Buyer**: finance lead (CFO, controller, head of finance/finance ops), head of payments ops,
  treasury; founder/CEO at <50 staff. **User**: the person who matches payments to invoices.
- **Company**: receives USDC/USDT from its own customers, ideally into its own wallet, with
  invoices; uses (or will use) Xero/QuickBooks. Segments and order: see `market.md` §4 and the
  rotations in the playbook.
- **Partners** (tier Partner): crypto practices at audit/accounting firms, Web3 bookkeepers,
  company-formation firms, gateways that don't reconcile.
- **Not ICP**: issuers, exchanges' retail users, anyone only paying out in stablecoins (vendor/
  outbound), government bodies, charities.

## Tiers and columns (unchanged from the existing system)
- **Targets tab** tier: Enterprise (>1,000 staff or listed), Mid-market (50–1,000), SMB (<50),
  Partner; "unknown" size if not shown. Columns: company, website, country, region, segment, tier,
  size_source, evidence_url, evidence_line (≤20 words), trigger + trigger_url, outreach_rule,
  day_added, status "new".
- **Leads tab** tier 1/2/3 from `gtm/score.py` (≥70 / 50–69 / <50) via `python3 -m gtm.cli merge`.
- **LinkedIn list** columns: day_added, name, role, company, country, linkedin_url, why_them,
  connection_note (≤280 chars), followup_dm (≤500 chars), status, date_sent, date_accepted,
  notes, tier.

## Decisions that bind research
- 23 Oct: product direction includes payment-ops exceptions for payment companies (SPEC).
- 28 Oct: accounting question in every call and D4 follow-up (RULES.md); research should surface
  which accounting system a lead uses when visible.
- Lean mode: daytime leads skip US/Canada and strict-consent countries (DE, AT, IT, ES, NL, VN,
  KR, CO, ZA); the nightly Targets/LinkedIn builder covers them with outreach_rule set.
- People never researched as leads: mentors (Prof Paul Griffin, Dr Catalin Burlacu, Soon Loo,
  Donna, Doug Peris), SMU staff, investors, warm network, QRE/QCDAO.
