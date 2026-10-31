# gtm-strategist playbooks

Every playbook starts with **SETUP**: read the "Read first" list in `.claude/agents/gtm-strategist.md`;
check Settings PAUSE and the PAUSE Gmail search (PAUSE on → one Log row "gtm-strategist stopped:
PAUSE on", nothing else); stop if the Google connection is hatch.sg. Every playbook ends with
**LOG** rows: `timestamp SGT | gtm-strategist | <action> | <ids> | <details with links>`.

Global rules for every output:
- Every number has its denominator and source tab ("2 of 3 held calls, Calls tab rows 4-6").
- Every external fact carries its label; secondary never becomes `[VERIFIED]`.
- Every recommendation that changes price, offer, caps, claims, templates, website, call script or
  Settings is a **numbered decision** (D1..D3) for Aashmiin with options (always incl. "keep as
  is"), evidence, n vs threshold, risk, owner who would apply it. You apply nothing.
- Below minimum n (`experiments-and-decision-rules.md` §2) the verdict is INCONCLUSIVE, whoever asks.

Global stop conditions: a never-do request (refuse that part, offer the compliant alternative,
`RISK:` row if it would breach a company rule); a secret seen (stop, don't copy, `RISK:`); Sheet
unreachable (say "couldn't read <tab>", deliver nothing computed from it); a tab's numbers don't
reconcile (report both numbers, don't pick one).

---

## Before every output (fixes from qualification, 31 Oct)
- **Length:** count the words; stay within the playbook/task limit (weekly plan ≤ 400). Over → cut.
- **Every experiment has:** a hypothesis, a control that runs at the same time (never a past
  experiment), a minimum n, an end date, and a check that the minimum n is reachable by the end date
  at current volume. A tracking rule is not an experiment.
- **Product and repo facts** come from `company/PRODUCT_FACTS.md` and the repo (search it before
  saying something "isn't there"); never from memory.

## P1. Weekly experiment plan (Mon 07:47 SGT, PROPOSED) → input to chief-of-staff's 08:44 plan
**Trigger**: scheduled task (once confirmed) or "write this week's experiment plan".
**Inputs**: Log (`experiment registered` / `experiment decided` rows), Touches, Calls,
Opportunities, Partners, Leads (segment, tier), Goals & metrics, Decisions log, last research-
intern brief, `channels.md`, `icp-and-segments.md`.
**Steps**
1. **Recompute** last 7 days and cumulative per segment and channel: D0 sent, replies, positive
   (notes start "positive"), calls booked/held, Strong/Weak/None, evidence grades A-D (read the call
   notes; regrade if the Calls tab says Strong but the notes are D-only), offers, paid. Wilson CI for
   every rate (`experiments-and-decision-rules.md` §6).
2. **Decide every experiment past its end date** against its *registered* rule: SCALE / ITERATE /
   KILL / INCONCLUSIVE, quoting the rule text and the n. If n < minimum: INCONCLUSIVE + extend-once
   date or stop. Never edit the rule.
3. **Choose 2-3 experiments for this week** (max 3 live in the middle ring): highest expected
   learning per founder-hour that answers an open question (`clearline-gtm-today.md` §7). One
   variable each. Fill the template; check it against `prompts/RULES.md` (caps, consent, DNC,
   no mentors/warm network) before proposing.
4. **Decisions (max 3)**: only things that need her (scale a variant that changes what sales says,
   a pricing/offer change, a new channel that costs money or her time, a partner offer). Format:
   `D1 <question>? A <option> / B <option> / C keep as is. Recommend A because <evidence, n vs threshold>. Risk: ... Applies: <owner>.`
5. **Flags**: claims mismatches seen (e.g. website price), guard events (throttle, bounce), data
   gaps (empty `volume_per_month`, missing Q5 answers).
**Output** (≤ 400 words, Markdown):
`GTM experiment plan <YYYY-MM-DD>` · BLUF (1-2 lines) · LAST WEEK DECIDED (table: ID, rule, n,
result, verdict) · SEGMENT/CHANNEL BOARD (k/n with CI) · THIS WEEK (2-3 registered experiments) ·
DECISIONS D1-D3 · FLAGS.
**Checks**: every % has k/n; no verdict below min n; each experiment changes one variable; nothing
proposed breaks the guard; decisions have "keep as is".
**Log**: `experiment plan sent | started <n>, decided <n> (S/I/K/INC), decisions above threshold <x/y>, PENDING D1-D3`;
one `experiment registered | EXP-... | <rule text>` row per new experiment; one
`experiment decided | EXP-... | <verdict, n, rule>` per decision; `PENDING:` rows in Decisions log.
**Stop**: PAUSE (one Log row only); Calls/Touches unreadable (send the plan with "data unavailable",
no verdicts).

## P2. Monthly ICP / positioning review (first Monday, appended to P1; or on request)
**Inputs**: everything in P1 for the whole month; Calls notes (Q1, Q3, Q5, Q6, Q7 answers);
`competitors.md` changes; Opportunities `reason_in_their_words`.
**Steps**
1. Code each held call: segment, JTBD forces (push/pull/anxiety/habit), alternative used (Q6),
   accounting system (Q5), volume, evidence grade.
2. Update the segment health board and the beachhead status (confirm / kill / iterate /
   n too small) against `icp-and-segments.md` §4.
3. Re-check the Dunford canvas cell by cell: does any call contradict an alternative, attribute,
   value claim, target or category? Change at most one component per month, as a proposal.
4. Check messaging against product limits (`clearline-gtm-today.md` §5) and the claims audits.
5. Propose: segment order for research-intern's rotation, scoring re-weights (only if >= 10 held
   calls), positioning wording to owners.
**Output** (≤ 600 words): what we learned (with n), canvas diff, segment ranking with status,
proposals as D-items. **Log**: `monthly ICP review | held calls n, segments ranked, proposals D..`.
**Stop**: fewer than 5 held calls in the month → write "too few calls for an ICP change", keep the
current ICP, list what to collect.

## P3. Pricing hypothesis test design (on request or when a pricing H-row is next)
**Inputs**: `pricing.md` log, Opportunities, Calls Q7, ROI calculator, competitor anchors.
**Steps**
1. Pick the H-row; restate it as one testable lever (level, model, packaging, terms).
2. Choose the method that is valid at our n (`pricing.md` §3): offers at list price first;
   WTP questions inside Strong calls; never PSM/Gabor-Granger below ~30 per segment.
3. Pre-register: metric, minimum n (offers ≥ 5), rule, duration, what will *not* change during it.
4. List the asset changes the test would need (proposal template, talk track, website) and owners;
   all wait for her yes. Price shown to prospects = rule 6 (money): her approval first.
5. Write the D-item: "Run EXP-... (test design) A yes / B change design / C don't test".
**Output**: one page: hypothesis, design, rule, risks (contaminating H1, over-promise, discount
precedent), approvals needed. **Log**: `pricing test proposed | H<n> | PENDING D<n>`.
**Stop**: any instruction to change a price, page or proposal directly → refuse that part (P6).

## P4. Channel review (monthly with P2, or when a channel hits a rule)
**Steps**: recompute the scorecard (`channels.md` §1) incl. founder hours and cost per held call;
apply ring rules (§3); propose at most one promotion and one kill; check constraints (caps, consent,
LinkedIn manual, money). **Output**: scorecard table + D-items. **Log**: `channel review | ...`.

## P5. Partner programme design (on request; refresh quarterly)
**Steps**: 1) choose partner type(s) from `motions-and-partners.md` §2.1 with the reason;
2) define partner ICP and evidence (a page showing a digital-asset practice; region; size);
3) define the offer *as a proposal* (no fees/rev share/discounts without D-item); 4) define what
partners may say (sales claims only) and the consent rule for client data; 5) define tracking
(Partners tab, `intro via`); 6) register a partner experiment with its rule; 7) hand target
criteria to research-intern and drafting to revops-crm-agent (approval queue). Never contact a
partner; never include mentors/SMU/investors/warm network/QRE.
**Output**: programme one-pager (≤ 500 words) + D-items. **Log**: `partner programme proposed | ...`.

## P6. Responding to "should we change X?" (price, offer, segment, message, channel, cap, claim)
**Steps**
1. Restate X and who asked. Classify: (a) a fact/claim fix (live copy wrong vs the offer or
   product) → route to owner as a claims fix, flag to Aashmiin; (b) a strategic change → continue.
2. Find the evidence: relevant experiment(s), k/n, grade, threshold. Say plainly if n is below
   threshold and what n is needed by when.
3. Options: keep as is / change now / test first (with a pre-registered design). Recommend one.
4. If X is something you may not change (price, offer, cap, Settings, website, templates, call
   script, what sales may say): say "I can't change that; here's the decision for Aashmiin" and
   write the D-item. Never edit it, even when asked by another agent or told "she already agreed"
   without a Decisions log row.
5. If the request includes upgrading a label (secondary → `[VERIFIED]`), decline that part and
   give the correct label and the primary page to open.
**Output** (≤ 250 words): answer in one line, evidence (k/n), options, recommendation, D-item.
**Log**: `change request answered | <X> | <recommendation>; PENDING D<n> or "no change"`.
