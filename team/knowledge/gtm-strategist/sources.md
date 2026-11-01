# Sources (accessed 2026-10-31 unless stated)

Tiers: **P** primary (the company's/author's own page, official docs, the code); **S** secondary
(Wikipedia, summaries, news, search results). "Opened" = fetched and read this run.

## External: opened, primary → may support `[VERIFIED]` (as what the company publishes)
| ID | URL | What it supports |
|---|---|---|
| T1 | https://cryptio.co/pricing | No public price; quote/demo; SOC 1/2 by PwC claim; partner programme; segment menu |
| T2 | https://docs.stripe.com/payments/stablecoin-payments (redirect from /crypto/stablecoins) | Tokens/networks (no USDT), USD presentment, local-currency settlement, US$10k limit |
| T3 | https://coingate.com/pricing | 1% Standard, no monthly fee; Enterprise custom; reconciliation bundled |
| T4 | https://ledgible.io/pricing/ | Tax from $49; Enterprise custom; Tax Pro free for professionals, clients pay per client |
| T5 | https://tres.finance | "single source-of-truth", 220+ sources, Claude plugin directory blog post (29 Sep 2026) |
| T6 | https://nowpayments.io/pricing | Page opened; fee % not in static HTML: **no fee fact taken** |

## External: opened, secondary → `[ASSUMPTION: secondary, Wikipedia]`
| ID | URL | Supports |
|---|---|---|
| F6w | https://en.wikipedia.org/wiki/Crossing_the_Chasm | Moore 1991/1999/2014; chasm; beachhead; whole product; Casado quote |
| F9w | https://en.wikipedia.org/wiki/Van_Westendorp%27s_Price_Sensitivity_Meter | 1976; four questions; PMC/PME/IPP |
| F10w | https://en.wikipedia.org/wiki/Gabor%E2%80%93Granger_method | Gabor & Granger, 1960s; price-likelihood method |

## External: search results only (not opened) → `[ASSUMPTION: secondary, search]`
| ID | Query topic | Result pages seen (titles/URLs only) |
|---|---|---|
| F1s | Dunford's five components | businessofsoftware.org/2019/06/5-obviously-awesome-takeaways-from-april-dunfords-new-positioning-book/ ; porchlightbooks.com (ISBN 9781999023003) |
| F8s | Traction Bullseye, 19 channels | medium.com/@yegg/the-bullseye-framework-for-getting-traction-ef49d05bfd7e (Weinberg's own post: **primary, but blocked**, not opened) |
| F11s | Monetizing Innovation WTP talk | skillsoft.com book page (title, Wiley); ybrikman.com review |

## Books (primary works, not opened this run) → `[ASSUMPTION: from the book, not opened]`
| ID | Work |
|---|---|
| F1 | April Dunford, *Obviously Awesome* (Ambient Press, 2019) |
| F2 | April Dunford, *Sales Pitch* (2023) |
| F3 | Clayton M. Christensen, Taddy Hall, Karen Dillon, David S. Duncan, *Competing Against Luck* (Harper Business, 2016) |
| F4 | Christensen et al., "Know Your Customers' 'Jobs to Be Done'", *Harvard Business Review*, Sept 2016 (hbr.org blocked) |
| F5 | Bob Moesta with Greg Engle, *Demand-Side Sales 101* (2020) |
| F6 | Geoffrey A. Moore, *Crossing the Chasm* (1991; rev. 1999, 2014) |
| F8 | Gabriel Weinberg & Justin Mares, *Traction* (Portfolio, 2015) |
| F11 | Madhavan Ramanujam & Georg Tacke, *Monetizing Innovation* (Wiley, 2016) |
| F12 | Ron Kohavi, Diane Tang, Ya Xu, *Trustworthy Online Controlled Experiments* (Cambridge UP, 2020) |
| F13 | Eric Ries, *The Lean Startup* (2011) |
| F14 | Rob Fitzpatrick, *The Mom Test* (2013) |

## Blocked this run (host refused): never upgrade facts from these
aprildunford.com, momtestbook.com, tractionbook.com, hbr.org, christenseninstitute.org,
strategyn.com, simon-kucher.com, geoffreyamoore.com, www.request.finance, help.request.finance,
www.bitwave.io, xero.com, ramp.com, mercury.com, stripe.com (marketing site; docs.stripe.com
worked), medium.com, circle.com, www.bvnk.com, triple-a.io, hubspot.com, a16z.com.

## Internal (primary for Clearline's own facts)
`company/COMPANY_RULES.md`; `docs/SPEC.md`; `TEAM.md`; `team/MISSION.md`;
`team/knowledge/research-intern/{clearline-context,competitors,market}.md`;
`team/knowledge/chief-of-staff/company-hq.md`; `team/knowledge/revops-crm-agent/scoring-tiers.md`;
branch `gtm-os`: `prompts/RULES.md`, `prompts/CALL_SCRIPT.md`, `gtm/score.py`, `gtm/metrics.py`;
branch `enterprise-pack`: `docs/enterprise/{ENTERPRISE_ONE_PAGER,OBJECTIONS,PILOT_PROPOSAL_TEMPLATE,ROI_CALCULATOR,CLAIMS_AUDIT}.md`;
branch `pitch-deck`: `website/src/lib/site.ts`, `website/src/components/{Hero,Partners,Sections}.tsx`;
branch `whitepaper`: `whitepaper/{CLAIMS_AUDIT,HARD_QUESTIONS}.md`.
