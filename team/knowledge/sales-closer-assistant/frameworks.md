# Sales frameworks, sourced and applied to Clearline

Accessed 2026-10-31 unless stated. Labels per `README.md`. "Apply" sections are our judgement [ASSUMPTION].

---

## 1. MEDDICC / MEDDPICC (qualification and deal inspection)

**Origin.** MEDDIC was created at PTC (Parametric Technology Corporation) around 1996; Dick Dunkel is
usually credited as creator, with Jack Napoli, building on the practice of PTC sales leaders including John
McMahon. Andy Whyte's book *MEDDICC: The ultimate guide to staying one step ahead in the complex sale*
(2020, MEDDICC Ltd) added the second C (Competition); Dunkel wrote its foreword.
[ASSUMPTION: secondary, search summary of the book's publisher listing on perlego.com
(https://www.perlego.com/book/3013688/meddicc-the-ultimate-guide-to-staying-one-step-ahead-in-the-complex-sale-pdf)
and highspot.com; accounts differ on who "invented" it (some credit McMahon). meddicc.com was blocked.]

**Definitions (as used by a real enterprise sales team).** GitLab uses MEDDPPICC (two Ps: Partner and
Paper Process) and defines each letter on its public handbook [VERIFIED:
https://gitlab.com/gitlab-com/content-sites/handbook/-/raw/main/content/handbook/sales/meddppicc.md,
opened 2026-10-31]:
| Letter | GitLab's definition (quoted) |
|---|---|
| M Metrics | "the economic impact of the solution" |
| E Economic Buyer | "the individual within the customer's organization who is required for the final 'yes'" |
| D Decision Process | "the process and timeline by which the customer will evaluate, select, and purchase a solution" |
| D Decision Criteria | "the formal solution requirements against which each participant in the decision process will evaluate" |
| P Partner | "the process of validating the partner landscape and opportunity implications" |
| P Paper Process | "the process by which the customer will document and execute the process of purchasing (including the MSA, order form, PO, etc.)" |
| I Identify Pain | "the problems created by the customer's current state (nobody buys until there is pain!)" |
| C Champion | "the person(s) with power and influence ... who are actively selling on your behalf and willing to give you inside information" |
| C Competition | "competitive strengths, weaknesses, and differentiators, including competitor's champions" |

GitLab also distinguishes a **champion** (influence, sway on the decision, can remove barriers, "will put
their value currency on the line") from an **advocate** (speaks well of you but cannot remove barriers)
[VERIFIED: GitLab handbook, `sales-operating-procedures/facilitate-the-opportunity.md` §3.1.2].

**Apply at Clearline (MEDDPICC, one P for Paper; "Partner" = their gateway/accountant/Xero advisor).**
- Keep a MEDDPICC block per opportunity with three states per field: **Known (with source: "her notes 2 Nov,
  line 4")**, **Partly known**, **Unknown – ask next**. Never fill a field from inference. An empty field
  is information; an invented one is a lie the next brief repeats.
- At 0 customers and US$300, the Economic Buyer is often the founder/CFO of a 5-50 person firm and the
  Paper Process may be "a card or a bank transfer, no PO". Still ask; don't assume.
- **Metrics** must be their numbers (payments/month, minutes per wrong payment, minutes to post) captured
  in their words. Our ROI calculator is a frame, never a claim.
- **Competition** includes "do nothing", their gateway, their accountant, Request Finance/Bitwave/Cryptio
  (see `clearline-truth.md` for what we may say about them).

## 2. SPIN Selling (discovery questions for large sales)

Neil Rackham, *SPIN Selling* (McGraw-Hill, 1988), from Huthwaite's study of about 35,000 sales calls over
roughly 12 years in 20+ countries with a team of 30 researchers. Four question types: **Situation**
(facts), **Problem** (difficulties), **Implication** (consequences that raise the cost of the problem),
**Need-payoff** (the buyer states the value of solving it). Rackham's finding: in large sales, successful
sellers asked more Implication and Need-payoff questions; Situation questions are necessary but overused.
[ASSUMPTION: secondary, Wikipedia "Neil Rackham" (https://en.wikipedia.org/wiki/Neil_Rackham, opened via
API 2026-10-31) for the study size; supersummary.com and routledge.com listing (search) for the question
types. The book was not opened.]

**Apply.** The CALL_SCRIPT already follows SPIN without naming it: Q1-2 Situation, Q3-4 Problem, Q5-6
Implication (the accounting question exposes the month-end cost), Q7 Need-payoff ("If this went away
tomorrow, what would it be worth to you?"). The prep brief tags each question S/P/I/N and adds at most
two tailored Implication questions. Do the Situation research before the call so she spends less time on
S questions.

## 3. The Challenger Sale (commercial teaching)

Matthew Dixon and Brent Adamson (CEB), *The Challenger Sale* (Portfolio/Penguin, 10 Nov 2011): sales reps
fall into five profiles; the "Challenger" profile performed best in complex B2B sales; the model is to
**teach** the customer something new about their business, **tailor** it to the stakeholder, and **take
control** of the conversation. [ASSUMPTION: secondary, Wikipedia "The Challenger Sale"
(https://en.wikipedia.org/wiki/The_Challenger_Sale, opened 2026-10-31) for the book and five profiles;
teach/tailor/take-control from general secondary summaries; gartner.com and challengerinc.com blocked.]

**Apply, carefully.** The honest "teaching" Clearline can bring: the failure modes buyers may not have
thought about (counterfeit tokens that copy the name, look-alike address poisoning, issuer freezes, short
payments after exchange fees, posting a short payment correctly), each with a **public, cited example**
from the product's sources (e.g. the Dec 2025 USDT look-alike loss in the whitepaper claims audit M8).
"Take control" at Clearline means proposing a clear next step and a dated plan for her to send; it never
means pressure, deadlines invented to force a decision, or a discount to create urgency. The CALL_SCRIPT
discovery call is "learning only": no teaching pitch on a first call unless they ask.

## 4. Command of the Message (Force Management value framework)

Force Management's value-based messaging methodology. GitLab states it "adopted and operationalized Force
Management's Command of the Message" and lists **customer value drivers** and **differentiators**
[VERIFIED: GitLab handbook `sales/command-of-the-message/_index.md`]. GitLab's handbook uses the framework's
terms: "Before/After Scenarios, PBOs [Positive Business Outcomes], Requirements, and Metrics" for a
qualified discovery call [VERIFIED: `sales/sales-development/_index.md` line ~839], "Before Scenarios,
Negative Consequences, and business pain framed in Revenue, Cost, and Risk" [VERIFIED:
`sales/shadow-program.md`], and its Command Plan's mandatory fields: **Why Now?** (compelling event),
**Primary Value Driver**, **Solution**, **Primary Capability**, **Why GitLab?** [VERIFIED:
`sales/command-of-the-message/command-plan.md`]. The full six-part value framework (Before scenario,
Negative consequences, Required capabilities, After scenario / Positive business outcomes, Metrics, plus
Differentiators and Proof points) [ASSUMPTION: secondary, rework.com summary (search); forcemanagement.com
blocked; GitLab says the detail is behind its internal handbook for IP reasons].

**Apply.** Every call summary has a small value block:
- **Before** (their words): e.g. "we check every USDT payment on Tronscan by hand".
- **Negative consequences** (their words or Unknown): hours, errors, late close, auditor questions.
- **Required capabilities** (what they said they need) → mapped to **today / delivered by us by hand /
  roadmap** from `clearline-truth.md`. A capability that is roadmap is written as roadmap.
- **After / PBO** (their words): what good looks like.
- **Metrics**: their baseline numbers or Unknown.
- **Proof points we may use**: only those in `clearline-truth.md` §4 (e.g. 52/52 held-out real transfers on
  the earlier engine, with the caveat). No customer proof points exist: 0 customers.

## 5. Gap Selling (current state → future state)

Jim Keenan, *Gap Selling* (2018/2019, A Sales Growth Company): the sale is the gap between the buyer's
**current state** (environment, problems, impact, root cause, emotion) and **future state**; the bigger
and clearer the gap, the stronger the reason to change; build a problem-identification chart before
calling. [ASSUMPTION: secondary, hubspot.com / builtin.com / gong.io blog summaries (search only); the book
and gapselling.com not opened.]

**Apply.** The prep brief's "likely pains" section is a mini problem-identification chart: problem →
likely impact → likely root cause, each marked [ASSUMPTION] until she hears it on the call. The summary
then records current state and future state *only from her notes*. If the gap is small (they're fine with
the workaround), the honest outcome is Weak/None, not a harder push.

## 6. LAER (objection handling)

Carew International's **Listen, Acknowledge, Explore, Respond**: hear the concern fully, show it
registered, explore what is underneath (price is often a stand-in for something else), then respond to
what exploring uncovered. [ASSUMPTION: secondary, thinkinsights.net and prospeo.io summaries (search);
origin date conflicts (1976 vs Jack Carew's 1990 book *You'll Never Get No for an Answer*); carew.com not
opened.]

GitLab's negotiation guidance says the same thing in its own words: "If they push back, you probably
missed something during your discovery process" and "Ask why? ... Determine if they are asking because
they are trained to ask for concessions or if it truly is a money issue" [VERIFIED: GitLab handbook
`sales-operating-procedures/deal-closure.md` §3].

**Apply.** Objection response drafts follow L-A-E-R but the **R** is limited to (a) the honest answer in
`OBJECTIONS.md` / `clearline-truth.md`, (b) a question that explores, or (c) "Aashmiin will come back to
you on that" for anything about price, terms, dates or features. The draft never concedes.

## 7. Discovery → demo: tell-show-tell, and the reverse demo

**Tell-show-tell**: tell the buyer what they're about to see and why it matters to their pain, show the
shortest path to it, then tell them what they just saw and ask how it compares to today. Associated with
Peter Cohan's *Great Demo!* (2003; 2nd ed. 2005) whose core idea is to show the result first ("do the last
thing first") rather than a feature tour; one source credits the tell-show-tell label to demo2win
instead. [ASSUMPTION: secondary, Pragmatic Institute webinar page and greatdemo.blogspot.com (search);
attribution disputed; the book not opened.]

Primary practice from two real sales teams:
- GitLab: "The demonstration should be tailored to the customers specific pain points and business goals.
  ... traditional sales representatives tend to overwhelm customers with a long overview of the company and
  its product features" [VERIFIED: `facilitate-the-opportunity.md` §3.1].
- PostHog: "Conduct a demo that actually matters"; "It's okay to say 'I don't know'... follow up with an
  answer after the call. If you try to fake it, you'll lose credibility"; pair each demo moment with one
  question (e.g. "How does this compare to how you're handling this today?") [VERIFIED: PostHog handbook
  `how-to-do-discovery.md`]. PostHog's **reverse demo**: the customer drives, you follow up in writing,
  recap and confirm each point before ending [VERIFIED: `reverse-demo-calls.md`].

**Apply: the Clearline demo path** (5 minutes, fictional demo data only, offered only after a Strong
discovery call per CALL_SCRIPT). Pick 2-3 of the seven demo cases (`demo/REQUESTS_DEMO.md`) that match
the pain she heard. For each: **Tell** ("You said a customer paid 2% short after exchange fees and it took
your team a day to sort out; here's that case"), **Show** (the case page), **Tell + ask** ("It's matched,
the shortfall is explained, and nothing posts until you approve. How does that compare with today?").
Always say "in the demo" for anything demo-only (auto-mark paid, address watching). If they ask something
the product can't do: "I don't know / not today; I'll follow up in writing" (PostHog rule), and the
follow-up draft carries the honest answer.

## 8. What "top AEs and SEs" do, distilled (our synthesis) [ASSUMPTION]
1. Prepare: research the account and the person; write the desired outcome of the call; plan the questions
   and the next step you'll propose (GitLab "Pre-Call Plan" questions [VERIFIED: `playbook/discovery/index.md`]).
2. Discover before showing; follow the answers; quantify in the buyer's words.
3. Qualify continuously (MEDDPICC) and write down what you don't know.
4. Demo only what maps to stated pain; tell-show-tell; say "I don't know".
5. End every call with a dated next step both sides agreed to; send the recap the same day.
6. Build the close plan with the buyer, not for them (GitLab: "A mutual close plan must have mutual
   outcome. It is created with your champions, advocates, and economic buyers" [VERIFIED: `deal-closure.md` §1]).
7. Discount only for a real reason, and only by someone with authority (GitLab "only discount when real
   budget constraints are the hold up"; PostHog "discounts are earned, not given" [VERIFIED: both]). At
   Clearline that authority is Aashmiin alone.
