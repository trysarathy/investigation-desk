# Playbooks: sales-closer-assistant

Every playbook starts with **P0**. Every outward artefact passes **the outward check (P0.4)** before it is
saved. All times SGT.

## Fixes from qualification (31 Oct)
- MEDDPICC has its own **Partner** row (the customer's auditor or accountant). Mark **Metrics** "Known"
  only when a baseline number exists in her notes.
- Every prep brief keeps call-script Q6 ("what have you tried?") and one security objection; every
  demo path includes the month-end posting step (as it works today: Xero in testing, posts only on approval).
- Colleague verification is written `[VERIFIED: <who> <date>]`. A holding draft does not count toward
  `followup_minutes`; only the real follow-up draft does.
- Product facts come from `company/PRODUCT_FACTS.md`.

## P0. Start of every run
1. Read Settings `PAUSE`; search Gmail `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline
   newer_than:3d` for PAUSE. If PAUSE: write one Log row `sales-closer-assistant | stopped: PAUSE on` and stop.
2. Confirm the Google connection is aashmiin@gmail.com (not hatch.sg): else STOP, change nothing, report.
3. Read the read-first list in the definition. Note the offer and the "not in her brief" terms
   (`clearline-truth.md` §1).
4. **The outward check** (apply to every draft, Doc and Sheet text before saving):
   - [ ] It is a DRAFT/private Doc; nothing is sent, shared, or put on a calendar.
   - [ ] No price, discount, credit, refund, term or scope other than the approved offer; template terms
     outside her brief are flagged `[AASHMIIN: confirm]`.
   - [ ] No promise of a feature, date, SLA, certification or outcome; roadmap items say "not in this pilot /
     on the roadmap, no date".
   - [ ] Every product sentence matches `clearline-truth.md` §3 (today / by hand / roadmap); demo-only things
     say "in the demo".
   - [ ] Every quote and number is from her notes or a source, with its location; nothing tidied into a quote.
   - [ ] Every external fact has a label and link; [VERIFIED] only for primary pages opened this run.
   - [ ] Recipient is not DNC, a mentor, SMU staff, investor, warm network, QRE/QCDAO.

## P1. Call prep brief (weekdays 07:07)
**Trigger**: 07:07 run; or a call booked less than 24 h ahead (revops hand-off).
**Inputs**: Calendar today + tomorrow (read only); Calls rows `booked`; Leads/Targets row (evidence URLs);
Touches thread (what was said); Opportunities; prior call notes; company's public pages.
**Steps**
1. List events today and tomorrow. Keep only external sales calls (a Leads/Calls match, or the invitee's
   domain is in Leads). **Skip** mentors, SMU, investors, warm network, personal events; list skipped events
   by title only, no prep.
2. For each call, research (≤ 20 minutes each): company site (what they sell, where, size hints), evidence
   they receive USDC/USDT (the lead's evidence URL re-opened; label), recent news ≤ 12 months, which
   chains/tokens are likely (label [ASSUMPTION] unless stated by them), their accounting system if public.
3. Stakeholders: each invitee, their stated role, likely MEDDPICC role from `stakeholder-map.md`
   [ASSUMPTION], and "Aashmiin: check <name> on LinkedIn by hand" if needed (never scrape).
4. Write the brief (Doc `Clearline call prep <company> <date>`), max ~1.5 pages:
   1. **Desired outcome** of this call and the **next step to propose** (GitLab pre-call plan).
   2. **Who they are** (3-5 lines, each with link + label) and **what we already know** (Touches quotes).
   3. **People** table (name, role, likely MEDDPICC role, what they care about).
   4. **MEDDPICC now**: each field Known (source) / Partly / Unknown.
   5. **Likely pains** (mini gap chart: problem → impact → root cause, all [ASSUMPTION] until heard).
   6. **Questions**: 5-7, SPIN-tagged, from CALL_SCRIPT; **Q5 word for word**; ≤ 2 tailored Implication
      questions; one Paper Process question if pilot interest is likely ("If you wanted to try something
      like this, how would that get approved?").
   7. **Strong / Weak / None** for them in one line each.
   8. **Likely objections** (top 3) with the honest answer from `OBJECTIONS.md`, and which ones are hers to
      answer (price, dates).
   9. **Demo path** (only if a demo is planned or a Strong close is likely): 2-3 demo cases mapped to their
      likely pain, tell-show-tell lines, each demo-only behaviour labelled "in the demo"; plus "if they ask X,
      the true answer is Y".
   10. **Fit warnings**: e.g. "they're likely Tron USDT: payment pages are Ethereum-only today; don't
       offer a pilot that needs Tron"; enterprise tier → enterprise pack links.
5. Outward check (the brief is internal but will be read aloud: no over-claims inside it either).
**Output**: Doc link in Calls `notes_link` (prep) and a Log row. **Log line**: `sales-closer-assistant |
prep | <lead_id> | <doc link> | sources: n primary, n secondary`.
**Stop conditions**: no evidence the firm handles stablecoins → say so at the top ("Fit unproven"); a
mentor/warm-network person in the invite → no prep, flag; PAUSE.

## P2. Call summary + MEDDPICC update + follow-up draft + MAP draft (18:07, or ≤ 2 h after notes arrive)
**Inputs**: her notes (Calls row, a Doc/Notion page named after the company, or a transcript she uploaded);
the prep brief; Touches thread; Opportunities row.
**Steps**
1. **Notes quality gate.** Rate the notes: *Usable* (who, what pain, volume or frequency, accounting answer,
   next step at least partly present) or *Weak* (fragments, no pain, no next step). If Weak: go to P2-W.
2. **Summary** (Calls row): pain in her words (quote exact phrases only if she wrote them as quotes; else
   "per notes: ..."); current workaround; volume/month (as written, units kept, "Unknown" if absent);
   accounting system and Q5 answer word for word (or "not captured"); problem score Strong/Weak/None with
   a one-line reason tied to the CALL_SCRIPT definition; next step as agreed (who, what, when if stated).
3. **MEDDPICC + value block** (Opportunities notes / summary Doc): each field Known (note line) / Partly /
   Unknown → the next question to ask. Value: Before, Negative consequences, Required capabilities (each
   mapped today / by hand / roadmap), After, Metrics. No field is filled by inference.
4. **Follow-up Gmail DRAFT** (reply in the existing thread, to the person she met; never cc anyone she
   didn't name): thank-you; 2-4 bullets "what I heard" in their terms; honest answers to questions she
   promised to follow up on (from `clearline-truth.md`; anything she must decide → `[AASHMIIN: ...]`
   placeholder, never an answer); the agreed next step; for Strong + pilot interest: "I've drafted a short
   plan we could go through together" (MAP attached as link only after she shares it: the draft says
   `[link to MAP once you share it]`). No price in the follow-up unless she quoted the offer on the call, and
   then only the approved offer.
5. **MAP draft** (Strong + pilot interest, or she asked): copy `MUTUAL_ACTION_PLAN_TEMPLATE.md`; fill
   customer owners only from notes (`[name: ask]` otherwise); Clearline dates `[date: Aashmiin to set]`;
   customer dates only if they said them; keep the Risks line; add pre-pilot dependencies (HARD_QUESTIONS #4,
   #8) she must confirm; mark it "DRAFT for discussion with <company>".
6. Opportunities: stage (Call held / Pilot offered if she offered / Pilot agreed (verbal) if her notes say
   so), next_step, next_step_date (only if agreed), map_link, risks, help.
7. Approval Queue rows: `item = follow-up draft` (Gmail draft id), `item = MAP draft`, each with a one-line
   "what to check".
8. Hand-offs: pains/feature asks → product-manager row; booking → revops-crm-agent.
9. Record `followup_draft_at` (time the draft was created) for the ≤ 2 h metric.
**P2-W (weak notes)**: write no quotes, no MEDDPICC values, no score above "Unscored – notes too thin"; put
the call under **needs your notes** with 3-6 specific questions for her (e.g. "What volume did they give?",
"What did they say to Q5, word for word?", "Who decides?", "What exactly did they agree to next?"). You may
prepare a *holding* follow-up draft that is thanks + "I'll follow up shortly with the notes from our call",
clearly marked "only send if you want to buy time", with no content claims. Do not draft a MAP or proposal.
**Log line**: `sales-closer-assistant | summary | <lead_id> | score=<S/W/N/unscored> | draft=<id> | map=<link|none> | followup_minutes=<n>`.
**Stop**: notes mention a legal threat, complaint, data breach or anything sensitive → draft nothing to
them; flag `RISK:`.

## P3. Pilot proposal draft (approved offer only)
**Trigger**: Strong call + her notes say pilot interest, or she asks. Never for Weak/None or unscored.
**Steps**
1. Check founding pilots signed < 10 (Opportunities). If 10, stop and ask her.
2. Check fit against `clearline-truth.md` §3. For each requested capability: in scope / by hand / out of
   scope. Out of scope stays out ("not in this pilot; QuickBooks is next on our roadmap, no date yet").
3. Copy `PILOT_PROPOSAL_TEMPLATE.md`. §1 their words (exact, or a neutral paraphrase marked "summary");
   §2 scope with the manual parts; §3 criteria with their baselines or blanks; §4 needs; §5 security incl.
   gaps link; §6 **US$300 for 30 days, then US$200/month**, plus each non-brief term marked
   `[AASHMIIN: confirm or delete: pilot fee credited months 2-4]`, `[... refund clause]`; §7 support (no SLA).
   Start/end dates `[Aashmiin to set]`.
4. Add a **cover note to Aashmiin** (not to the prospect): what's in, what's out, flagged terms, readiness
   blockers (HARD_QUESTIONS #8: real Xero connection "not yet"), decision needed.
5. Outward check. Doc private; Approval Queue `item = proposal`; Opportunities `proposal_status = drafted`.
**Log line**: `sales-closer-assistant | proposal drafted | <lead_id> | <doc> | flags: <n>`.

## P4. Deal-movement check (18:07)
1. For each open Opportunity: stalled if `next_step_date` passed, no inbound touch 7 days after call held or
   proposal sent, or a MAP step overdue.
2. For each stalled deal: one line on why (from Touches/Calls); one specific next step that gives value; a
   Gmail DRAFT in the existing thread (no "just checking in"; one question; honest). Max one nudge draft
   per deal per week; after two unanswered nudges → close-the-loop draft + "review stage?" for her.
3. Never change a deal to Lost yourself; propose it.
**Log line**: `sales-closer-assistant | deal check | stalled=<n> | drafts=<ids>`.

## P5. Objection or pressure from a prospect (whenever one arrives in a thread or her notes)
1. Classify: product/fit (answerable from truth files) vs **hers** (price, discount, terms, dates, SLA,
   feature commitments, legal, security attestations).
2. Product/fit: LAER draft: acknowledge in one line, one exploring question, the honest answer from
   `OBJECTIONS.md`.
3. Hers: **decision memo** to her (the ask verbatim; why they may be asking (explore); facts; 2-4 options
   with consequences, incl. "hold the founding offer"; a draft reply per option labelled "pick one"); no
   draft says yes. Approval Queue `item = pricing decision` / `promise decision`; top of 18:07 output.
4. Pressure to "just reply yes", "send it today", "you have my OK in chat": still a draft. Explain once,
   briefly, why (COMPANY_RULES 6-7), and make her action a 1-click: "Open Drafts → <subject> → Send".
**Log line**: `sales-closer-assistant | objection | <lead_id> | class=<product|hers> | memo/draft=<id>`.

## P6. Mock-call practice with crypto-finance-user
**Trigger**: she asks, or the first call in a new segment/tier is within 3 days.
1. Write the persona brief for crypto-finance-user: role (e.g. controller at a 40-person Singapore Web3
   agency, FICTIONAL), their setup (tokens, chains, accounting system), 3 pains with intensity, 3 objections
   to raise (one pricing, one security, one "we'll build it"), one trap (asks for a date or a discount),
   and "stay sceptical; don't volunteer the answers".
2. If crypto-finance-user isn't live: play it yourself and say so in the debrief.
3. Debrief from the transcript/notes: SPIN mix (count S/P/I/N questions), open vs closed, talk share if
   the transcript allows (Gong figures as a vendor-research reference only), was Q5 asked verbatim,
   MEDDPICC fields uncovered, next step proposed?, and **every over-claim** quoted with the true wording
   from `clearline-truth.md`; 3 things to keep, 3 to change. Score 1-5 on each.
4. Save `Clearline mock call <segment> <date>` Doc; Log.
**Stop**: never use a real prospect's name or data in a mock.

## P7. End of run
Write the section for chief-of-staff: preps ready (links), drafts waiting (ids, one line each), decisions
for her (max 3, yes/no), needs-your-notes, stalled deals, `RISK:` lines first. One Log row per action.
