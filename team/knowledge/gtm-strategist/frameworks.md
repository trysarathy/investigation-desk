# Frameworks: what the best B2B GTM strategists use, and how Clearline applies each

Last refreshed 2026-10-31 · owner gtm-strategist. **Label honesty:** none of the authors' own
sites or books could be opened this run (hosts blocked, see `README.md`). Descriptions are from
the books as commonly taught: `[ASSUMPTION: from the book, not opened this run]`, or
`[ASSUMPTION: secondary, <source>]` where a summary was read. Never quote an author word for word
from this file. Source IDs → `sources.md`.

---

## 1. Positioning: April Dunford, *Obviously Awesome* (2019) and *Sales Pitch* (2023) [F1, F2]
**What it says** [ASSUMPTION: secondary, search summaries F1s]: positioning is a set of linked
decisions, not a tagline. Five components, defined in this order: (1) **competitive alternatives**
(what the customer would do if you didn't exist, often "a spreadsheet and a person"), (2) **unique
attributes** (what you have that the alternatives lack), (3) **value** (what those attributes
enable, with proof), (4) **target customers** (who cares a lot about that value), (5) **market
category** (the frame that makes the value obvious); some versions add relevant trends ("5+1").
*Sales Pitch* turns positioning into a sales narrative: insight on how buying has changed →
alternatives and their limits → perfect-world → your differentiated value → proof → objections.
[ASSUMPTION: from the book, not opened this run]

**How Clearline applies it** (canvas v0, every cell a hypothesis):
| Component | Clearline v0 | Evidence needed |
|---|---|---|
| Competitive alternatives | A finance person + block explorer + spreadsheet + manual Xero entry; or the gateway's own reports; or a sub-ledger (Cryptio, Bitwave) for larger teams | Call Q6 answers ("what have you tried"), coded per call |
| Unique attributes | Works on plain transfers to the company's own wallet (no reference needed); deterministic checks incl. counterfeit token, wrong network, issuer freeze; plain-English explanation + drafted payer reply; posts only after a person approves, with tx hash/token/network on the entry | Product files (one-pager); each attribute must be "built" today |
| Value | Hours saved per wrong payment; no wrong postings; audit-ready entries | **Unmeasured.** ROI calculator defaults are [ASSUMPTION]/[GUESS]; pilot measures them |
| Target customers | SMB/mid-market finance teams receiving USDC/USDT directly, on Xero, with enough volume (break-even ~22 payments/month at default inputs) | Calls: volume, Strong share by segment |
| Market category | Candidate frames to test: "stablecoin accounts receivable", "stablecoin payment reconciliation for Xero", "crypto sub-ledger (lite)". Avoid "crypto accounting" (puts us next to Cryptio at enterprise prices) [ASSUMPTION] | Which frame makes prospects say "oh, like X for Y" in calls |
Rule: change one component per experiment, and re-check the others still fit.

## 2. Jobs-to-be-Done: Clayton Christensen, Bob Moesta [F3, F4, F5]
**What it says** [ASSUMPTION: from the books, not opened]: customers "hire" a product to make
progress in a circumstance (*Competing Against Luck*, Christensen et al., 2016; HBR "Know Your
Customers' Jobs to Be Done", Sept 2016). Moesta's switch interview (*Demand-Side Sales 101*, 2020)
reconstructs a real purchase timeline: first thought → passive looking → active looking → deciding
→ consuming, and the four forces (push of the situation, pull of the new solution, anxiety of the
new, habit of the present).

**How Clearline applies it**: the job candidate is "when a stablecoin payment arrives that I
can't match, help me close it out (customer told, books right) before month end without pinging
engineering". Code each call's story (CALL_SCRIPT Q1, Q3, Q4) into the four forces. Habit is
the big one for us (the spreadsheet works "well enough"): if habit dominates in a segment, the
segment is Weak regardless of stated pain. Q7 ("what would it be worth") is a *pull* signal only;
it is never a price commitment.

## 3. Beachhead: Geoffrey Moore, *Crossing the Chasm* (1991; rev. 1999, 2014) [F6]
**What it says** [ASSUMPTION: secondary, Wikipedia F6w, opened]: a chasm lies between early
adopters (enthusiasts, visionaries) and the early majority (pragmatists); cross it by picking one
niche ("beachhead"), delivering the **whole product** for that niche, and winning word of mouth
within it before moving to adjacent niches ("bowling pins"). The Wikipedia page quotes a16z's
Martin Casado summarising the needs as "a compelling use case that will create pull, a whole
product that nails the use case, and a word-of-mouth community" [ASSUMPTION: secondary, F6w].

**How Clearline applies it**: we are pre-chasm (0 customers). Pick **one** beachhead segment
where (a) receipts land in the company's own wallet, (b) they use Xero, (c) volume clears
break-even, (d) members talk to each other (a community or shared accountant). Whole product for
that niche = payment pages + checks + Xero posting + the founder's manual help (one-pager
"Delivered with our team"). Do not open a second segment until the first has the threshold in
`experiments-and-decision-rules.md` §4.

## 4. ICP and account tiering (scoring) [F7]
**What it says** [ASSUMPTION: common B2B practice, no single canonical author]: an ICP is the
firmographic + technographic + situational profile of accounts most likely to buy, succeed and
refer; tiering scores accounts on fit (who they are), intent/pain (what is happening to them) and
reachability, and spends effort by tier. Good ICPs are written from closed-won data; before you
have any, they are hypotheses scored from proxies.

**How Clearline applies it**: lead score already exists in `gtm/score.py` (fit 0-40, evidence 0-30,
reach 0-15, engagement 0-15). gtm-strategist proposes an **account-level** overlay
(`icp-and-segments.md` §3) and, once Calls has data, re-weights from what held calls showed.
Changes to `score.py` go to revops-crm-agent as a PR proposal after Aashmiin's yes.

## 5. Channels: Gabriel Weinberg & Justin Mares, *Traction* (2015) — the Bullseye [F8]
**What it says** [ASSUMPTION: secondary, search summaries F8s]: 19 traction channels (e.g.
targeting blogs, publicity, unconventional PR, SEM, social/display ads, offline ads, SEO, content
marketing, email marketing, viral, engineering as marketing, business development, sales,
affiliate programs, existing platforms, trade shows, offline events, speaking engagements,
community building). Process: **outer ring** brainstorm one idea per channel; **middle ring**
pick the ~3 most promising and run cheap tests; **inner ring** focus on the one that works until
it saturates, then repeat. Spend ~half the time on traction from the start.

**How Clearline applies it**: see `channels.md`. Cold email is our inner-ring *candidate*, not a
proven inner ring. Middle-ring tests that fit a solo founder: business development via accounting
firms (partners), community (Web3 finance/ops groups, by hand), engineering-as-marketing (a free
"check this USDT transfer" tool built from the investigation desk), targeted content (wrong-network
explainer). LinkedIn stays manual (company rule 5).

## 6. Pricing research: Van Westendorp PSM, Gabor-Granger, value-based (Ramanujam) [F9-F11]
- **Van Westendorp Price Sensitivity Meter** (Peter van Westendorp, 1976) [ASSUMPTION: secondary,
  Wikipedia F9w, opened]: four questions (too expensive / too cheap / getting expensive / a
  bargain); plot cumulative curves; intersections give a range (point of marginal cheapness to
  point of marginal expensiveness) and an indifference point. Needs a meaningful sample (tens of
  respondents per segment) [ASSUMPTION]; it measures stated attitudes, not purchase.
- **Gabor-Granger** (André Gabor and Clive Granger, 1960s) [ASSUMPTION: secondary, Wikipedia F10w,
  opened]: ask purchase likelihood at a sequence of prices to build a demand curve and the
  revenue-maximising price. Same stated-preference caveat.
- **Value-based pricing / *Monetizing Innovation*** (Madhavan Ramanujam & Georg Tacke, Wiley 2016)
  [ASSUMPTION: secondary, search summaries F11s]: have the willingness-to-pay talk early, segment by
  WTP and needs, choose the pricing model (how you charge) as deliberately as the price level, and
  design the product around the price.

**How Clearline applies it**: with < 20 calls, PSM and Gabor-Granger are **not** valid; use them
only as structured questions inside calls and label results "directional, n=k". The strongest
evidence available is **revealed** preference: offers made at US$300/US$200 and what happened
(accepted, negotiated, declined + reason in their words, Opportunities tab). Value anchor: the ROI
calculator (`ROI_CALCULATOR.md`) with the prospect's own numbers. Pricing *model* hypotheses
(flat vs per-payment vs per-entity) are logged in `pricing.md`.

## 7. Experiment design with pre-registered decision rules [F12, F13]
**What it says** [ASSUMPTION: standard practice in experimentation, e.g. Kohavi, Tang & Xu,
*Trustworthy Online Controlled Experiments*, CUP 2020; and the Lean Startup's "validated
learning", Eric Ries 2011; not opened this run]: write the hypothesis, the one primary metric, the
minimum sample, the duration and the decision rule **before** starting; don't peek-and-stop; a
result below the minimum sample is inconclusive, not negative. Small samples need intervals, not
point estimates.

**How Clearline applies it**: the template and thresholds are in
`experiments-and-decision-rules.md`. Every experiment is registered in the Log before the first
send/call; its rule can't change after start.

## 8. Evidence quality: Rob Fitzpatrick, *The Mom Test* (2013) [F14]
**What it says** [ASSUMPTION: from the book, not opened]: talk about their life, not your idea; ask
about specifics in the past, not generics or the future; talk less, listen more. Compliments,
"fluff" (generics, hypotheticals, future promises) and ideas are not data; commitment
(time, reputation, money) and advancement to a next step are.

**How Clearline applies it**: grade every call signal (A-D) before counting it:
A = paid / signed / gave data or system access; B = concrete next step with a date (intro, demo
with their data, security review); C = specific past story with numbers (how many, how long, what
it cost); D = compliment, hypothetical, "we'd definitely use that". **Only A-C count toward
segment thresholds; D is logged and ignored.** The call script already follows the Mom Test
(past stories, "I'm not selling anything").

## 9. Supporting: messaging hierarchy and the "message house" [ASSUMPTION: common practice]
One umbrella line (today's headline), 3 pillars (matched · explained · in your books, once
approved), proof under each pillar that is *true today* (built features; no customer proof yet),
and a "never say" list (automatic posting, live with customers, compliant, Tron support).
