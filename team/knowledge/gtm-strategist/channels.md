# Channel scorecard (Bullseye)

Last refreshed 2026-10-31 · owner gtm-strategist. Framework: Weinberg & Mares *Traction*
(`frameworks.md` §5). Numbers come only from the tabs (Touches, Calls, Opportunities, Partners,
Log), recomputed each Monday with `gtm/metrics.py` logic; never typed from memory.

## 1. Scorecard template (one row per channel, weekly)
| Channel | Ring (outer/middle/inner) | Owner | Effort h/week (founder) | Volume (touches) | Positive replies (k/n, 95% CI) | Calls held | Strong calls (grade A-C) | Offers | Paid | Cost US$ | Cost per held call | Experiment ID | Status (testing/scale/iterate/kill/parked) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## 2. Channels for Clearline (31 Oct 2026; all FIRST-WEEK, no results yet)
| Channel (Traction name) | Ring | Constraints | Primary metric | Notes |
|---|---|---|---|---|
| Cold email, lean mode (sales / email) | middle (candidate inner) | `prompts/RULES.md` caps: FIRST_EMAIL_CAP 50, CURRENT_SEND_CAP 75, bulk line 1,000/30 days; no strict-consent countries; opt-out | positive-reply rate per D0 → held calls | Only started 29 Oct; reply data immature |
| LinkedIn by hand (sales) | middle | Manual only, no automation/scraping; her time | accepted → conversation → held call | Effort is founder time: count it |
| Accounting/audit firm partners (business development) | middle | Drafts only; she approves each first contact | partner conversations grade B+ → referrals | See `motions-and-partners.md` |
| Web3 service-firm partners (formation firms, Web3 bookkeepers, agencies) (BD) | outer → middle | same | referrals | |
| Engineering as marketing: free "check a stablecoin transfer" page from the investigation desk | outer | needs product-manager + engineering capacity; must not over-promise | sign-ups / email captures → calls | Strong fit with the 18 diagnosis rules; propose only via roadmap |
| Content/SEO (wrong-network, counterfeit USDT, how to record USDT in Xero) | outer | content producer week 3; claims audit | organic visits → form fills | Slow; long-term |
| Community (Web3 finance/ops groups, SG fintech meetups) (community building, offline events) | outer | by hand, her time; no scraping | conversations → calls | |
| Speaking (SMU/fintech events) | outer | mentors/SMU contacts are hers to approach (company rule 6) | talks → calls | Never contact SMU staff ourselves |
| Existing platforms (Xero App Store listing) | outer | needs Xero partner process; check Xero's requirements on its own site first | installs | [ASSUMPTION: listing requirements not checked] |
| Paid ads (SEM/social) | parked | spending money = her approval; low intent volume | — | Not before a beachhead |

## 3. Ring rules
- **Outer → middle**: a one-paragraph test idea with cost < 3 founder-hours/week and a
  pre-registered rule (template in `experiments-and-decision-rules.md`).
- **Middle → inner (SCALE)**: meets its SCALE threshold at minimum n (e.g. >= 3 held calls with
  grade A-C pain from the channel, and positive-reply CI lower bound >= 2% on >= 150 D0).
- **Kill / park**: meets its KILL threshold at minimum n, or costs > 5 founder-hours/week with no
  grade-B+ signal after 3 weeks.
- At most **3 middle-ring tests at once** (solo founder).

## 4. Channel facts that bound plans
- Sends happen 9:00-17:00 recipient time, max 8 per hourly run (`prompts/RULES.md`).
- Auto-throttle to 20/day if bounce > 3%, a complaint, or reply rate < 1% over the last 100 sends.
  **A reply rate below 1% is a guard event, not a channel verdict by itself.**
- Domain sending (20 → 35 → 50/day ramp) only after DOMAIN_READY and her purchase of a domain.
