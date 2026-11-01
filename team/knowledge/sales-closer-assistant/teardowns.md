# Teardowns: how real sales teams prep, demo and close

Three real write-ups, each labelled. Two are primary (the companies' own public handbooks, cloned and read
on 2026-10-31); one is vendor research known only through search snippets (secondary). For each: what
they do, what we copy, what we deliberately do NOT copy.

---

## Teardown 1: GitLab's Command Plan and Mutual Close Plan [VERIFIED, primary]
Source: GitLab public handbook, repo `gitlab-com/content-sites/handbook` on gitlab.com, commit `5241935`
(2026-10-30), files:
- `content/handbook/sales/command-of-the-message/command-plan.md` (Command Plan)
- `content/handbook/sales/sales-operating-procedures/deal-closure.md` (Mutual Close Plan, negotiation)
- `content/handbook/sales/sales-operating-procedures/facilitate-the-opportunity.md` (demo, trial, champions)
- `content/handbook/sales/playbook/discovery/index.md` (pre-call plan, TED questions, Five Whys)
- `content/handbook/sales/meddppicc.md` (field definitions)
Web form: https://handbook.gitlab.com/handbook/sales/ (host blocked here; raw files opened instead).

**What they do.**
1. **One living document per deal**, the Command Plan, capped at 5,000 characters "to encourage sales team
   members to be crisp and succinct", focused on "future-looking plans". Three sections: Opportunity
   Overview (Why Now?, Primary Value Driver, Solution, Primary Capability, Why GitLab?), MEDDPPICC (9
   fields), Close Plan Details (**Close Plan** "with dates (day by day or week by week)", **Risks** "What
   would be the possible reasons for why the deal doesn't come in on time?", **Help** from the wider team).
2. **Manager review notes** dated YYYY-MM-DD with "Prioritized gaps" and "who will do what by when".
3. **Mutual Close Plan**: "a visual timeline of all the necessary tasks, individuals, and deadlines
   necessary to get the deal through closure and into deployment. A mutual close plan must have mutual
   outcome. It is created with your champions, advocates, and economic buyers. It will highlight gaps on
   both sides of the table." It runs past signature into deployment.
4. **Trial / POV with metrics**: "During this trial the sales representative and technical buyer should
   have established metrics for success", weekly touch points against them, and paper-process discovery
   before the trial ends.
5. **Success criteria signed**: "a document that clearly articulates what done looks like and when done is
   successful. The document should be signed by an accountable individual from both parties."
6. **Negotiation discipline**: "You should only discount when real budget constraints are the hold up";
   "If they push back, you probably missed something during your discovery process"; "Ask why?"; "Barter...
   What are we getting in return?"; flexibility bounded by a Deal Approval Matrix (someone else approves).
7. **Pre-call plan** questions: desired outcome for this meeting and the prospect's; which questions in what
   sequence; anticipated objections; how you will close the call to progress the opportunity.

**What we copy.**
- The Opportunities row + prep/summary Doc = our Command Plan. Keep it short and future-looking.
- The MAP = GitLab's mutual close plan shape, using Clearline's `MUTUAL_ACTION_PLAN_TEMPLATE.md` (15 steps,
  owner per side, dates, status) and running through the day-30 review, not just to "signed".
- A **Risks** line and a **Help** line on every opportunity (Help = what only Aashmiin, product or
  engineering can unblock, e.g. "Tron payment pages are roadmap: product-manager to confirm whether a
  pilot can wait").
- Success criteria written and agreed on day 1 (already in `PILOT_PROPOSAL_TEMPLATE.md` §3).
- The pre-call plan questions become the top of every prep brief.

**What we don't copy.** The Deal Approval Matrix, discount levers and "Barter": at Clearline there is no
delegated discount authority at all. Every price question is routed to Aashmiin as a question.

## Teardown 2: PostHog's discovery, reverse demo, trials and discount rules [VERIFIED, primary]
Source: PostHog public handbook, repo `PostHog/posthog.com` on github.com, commit `24d78a6` (2026-10-30),
`contents/handbook/growth/sales/`: `how-to-do-discovery.md`, `reverse-demo-calls.md`, `running-trials.md`,
`contract-rules.md`, `new-sales.md`. Web form: https://posthog.com/handbook/growth/sales/how-to-do-discovery
(host blocked here; repo files opened instead).

**What they do.**
1. **Discovery mindset**: "Curiosity over pitching", "Find the pain - People buy solutions to problems, not
   features", "Identify champions - Someone needs to sell internally when you're not there". Discovery is
   "give and take. You learn something, you show something, you ask questions, repeat."
2. **Prep**: check CRM history, the person on LinkedIn/X, the company's website and language, and use AI
   tools to research the company "and potential use cases".
3. **Questions**: "Use 'what' and 'how'... Start questions with 'tell me...', 'explain to me...', or
   'describe to me...' to avoid yes/no answers."
4. **Demo**: pair each demo moment with one question; "It's okay to say 'I don't know'... If you try to fake
   it, you'll lose credibility."
5. **Reverse demo**: the customer drives; "Tell them up front that you will follow up in writing"; "Recap
   before you end. Repeat back everything you heard and get them to confirm each point."
6. **Trials** need "Documented success criteria" and a "Documented timeline", a kickoff to agree them, and
   business process (procurement, legal, price) "in parallel"; "Mutually aim to get an order form signed by
   trial end".
7. **Discounts**: "We are transparent about how we contract with customers... allergic to the phrase 'let
   me talk to my manager and see what we can do'"; "discounts are earned, not given"; "We don't offer
   discounts to customers paying monthly"; and in `new-sales.md` "we don't do deals where year 1 is super
   cheap then we ratchet up the price in year 2."

**What we copy.**
- The recap-and-confirm close and the written follow-up within 2 hours (our metric).
- "I don't know, I'll follow up in writing" as the default answer to any unscripted feature question.
- Success criteria + timeline + paper process in parallel during the 30-day pilot (our MAP steps 5-7).
- Transparency: the founding offer is the same for all first 10 businesses; that consistency is itself
  the answer to "can you do 30% off?" (as a draft for her, she decides).

**What we don't copy.** "Allergic to 'let me check'": at Clearline the draft must say Aashmiin will
decide, because she is the only one who can. PostHog's self-serve and Slack-channel motions don't apply yet.

## Teardown 3: Gong Labs discovery-call research [ASSUMPTION: secondary, vendor research via search snippets]
Sources (not opened: gong.io blocked): https://www.gong.io/blog/deal-closing-discovery-call/ ,
https://www.gong.io/blog/talk-to-listen-conversion-ratio , https://www.gong.io/resources/labs/nailing-your-sales-discovery-calls/
(search 2026-10-31). Gong sells call-recording software, so this is **vendor research**: Gong's own
dataset, method not peer-reviewed, and it markets Gong's product.

**What the snippets say.** Original 2016 study: a "golden" talk-to-listen ratio of about 43:57 in
successful calls; a 2025 update over ~326K calls found the average is still about 60:40 talking, with low
performers' talk time swinging from ~54% in won to ~64% in lost deals; winners asked about 15-16 questions
on discovery calls vs about 20 for losers (more questions is not better); open "walk me through..." prompts
over yes/no questions. Third-party summaries give other figures (11-14 questions) not found in Gong's own
snippet; treat those as unreliable.

**What we copy (as hypotheses, never as claims to a prospect).** In the mock-call debrief and the summary,
note whether Aashmiin talked most of the call and whether questions were open. Keep the prep brief to 5-7
questions (the CALL_SCRIPT's 7 fit inside Gong's range). Never quote a Gong number in anything outward,
and never label it [VERIFIED] unless someone opens gong.io itself (and even then: "vendor research").

## Not used (and why)
- First Round Review's Sierra design-partner write-up, Bessemer's design-partner piece, YC's founder sales
  library: reached only as search results; hosts blocked. Their gist (charge for pilots, write success
  criteria and an end date, ask go/no-go at the end) is in `closing-pilots.md` as
  [ASSUMPTION: secondary, search].
- A "mutual action plan template" from a MAP-tool vendor: we use GitLab's (primary) and our own template.
