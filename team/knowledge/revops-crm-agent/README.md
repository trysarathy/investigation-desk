# revops-crm-agent knowledge pack

Reference material for **revops-crm-agent** (Clearline's pipeline owner). Read the files your task needs
before you act; read `gtm-os-rules-digest.md` every run. Where anything here disagrees with
`prompts/RULES.md` on branch `gtm-os`, **RULES.md wins** (then `company/COMPANY_RULES.md`).

Last refreshed: **2026-10-29**. Refresh owner: **research-intern** (monthly, and whenever a law, Google/Gmail
policy, LinkedIn agreement or `gtm-os` code changes). revops-crm-agent flags anything stale in its Log as
`RISK: knowledge pack stale: <file>`.

| File | What it is for | Use it when |
|---|---|---|
| `gtm-os-rules-digest.md` | Faithful digest of RULES.md (incl. LEAN MODE), the guard, caps, ramp, autonomy, and what the guard does NOT check | Every run |
| `deliverability.md` | Google/Gmail sender requirements, personal-Gmail limits, warm-up, bounces, spam complaints | Queue build, hourly send, throttle decisions |
| `compliance.md` | B2B cold-email law by country (US, UK, EU, DE/AT/IT/ES/NL, SG, CA, AU, IN) | Deciding if a lead may be emailed at all |
| `cold-email-craft.md` | How to write first lines, questions and sequences for finance buyers; worked Clearline examples | Writing D0/D4/D11 and replies |
| `crm-hygiene.md` | Company HQ tabs and columns, stages, required fields, dedupe and DNC rules | Every Sheet write |
| `linkedin-manual.md` | LinkedIn limits and the User Agreement ban on automation and scraping; the manual pack format | 01:27 LinkedIn pack |
| `proposals-invoices.md` | Founding-pilot offer, proposal template, invoice draft fields (Indian proprietorship, GST/LUT placeholders for CA), payment tracking | Pilot agreed, invoice, payment check |
| `scoring-tiers.md` | Exactly how `gtm/score.py` scores and tiers a lead, and its blind spots | Queue build, lead review |

## Labels and sources
Every external fact carries a label, a source URL and the access date (2026-10-29 for this edition):
- **[VERIFIED]**: the source was opened while writing. In this edition that applies to files in the
  `gtm-os`, `enterprise-pack` and `ai-team` branches (opened with `git show`).
- **[ASSUMPTION: search-only]**: from web search results that quote or summarise the source; the primary
  page itself could **not** be opened, because this build session's network policy blocked every external
  host for page fetches (support.google.com, ftc.gov, ico.org.uk, linkedin.com, pdpc.gov.sg,
  datatracker.ietf.org, blog.google all refused). Treat these as reasonable but unchecked. research-intern's
  first refresh job is to open each primary URL and upgrade or correct the label.
- **[ASSUMPTION]** / **[GUESS]**: our reasoning, not a source.

Nothing in this pack is legal or tax advice. Law questions go to Aashmiin with "ask a lawyer/CA" attached.
