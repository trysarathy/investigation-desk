# Methods: how the best customer-proxy and usability practitioners work

Accessed 2026-10-31. **nngroup.com, momtestbook.com, jobstobedone.org were blocked from this
environment**, so every framework below is `[ASSUMPTION: secondary, <source>]` until research-intern
opens the primary page (to-do at the bottom). The methods are long-established; the labels are about
what was opened, not about doubt in the method.

## 1. Heuristic evaluation (Jakob Nielsen and Rolf Molich, 1990; Nielsen's revised 10, 1994)
Source: [Wikipedia, Heuristic evaluation](https://en.wikipedia.org/wiki/Heuristic_evaluation) (opened),
citing Nielsen & Molich, CHI '90, and Nielsen, CHI '94; primary: [NN/g, 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) (blocked).
`[ASSUMPTION: secondary, Wikipedia]`

The 10 heuristics, with what each means **for a controller** (our translation, `[GUESS: persona judgement]`):

| # | Heuristic | Controller's version of the question |
|---|---|---|
| H1 | Visibility of system status | Can I see, without clicking, which payments are matched, which are waiting, which are posted, and as of when? |
| H2 | Match between system and the real world | Does it say "short payment, fee write-off, unapplied cash, period" or "transfer event, log index"? |
| H3 | User control and freedom | Can I undo a match or reverse a posting before close, and is the reversal logged? |
| H4 | Consistency and standards | Are "paid", "matched", "posted", "settled" used the same way on every screen, and the way Xero uses them? |
| H5 | Error prevention | Can I post the wrong amount, the wrong period, or post twice? Is the dangerous button hard to press by mistake? |
| H6 | Recognition rather than recall | Do I need to remember an invoice number or a hash from another screen to finish a task? |
| H7 | Flexibility and efficiency of use | Can I clear 40 exact matches at once and spend my time on the 3 exceptions? |
| H8 | Aesthetic and minimalist design | Does the exception page show what I need to decide, and nothing else? |
| H9 | Help users recognise, diagnose, recover from errors | When Xero refuses a posting, does it say why in plain words and what to do? |
| H10 | Help and documentation | Is there a one-paragraph answer to "how do I tie this to my bank/wallet balance?" where I need it? |

Practice notes: 3–5 independent evaluators find most problems; more adds cost faster than insight
(Wikipedia, citing Nielsen) `[ASSUMPTION: secondary, Wikipedia]`. We are one simulated evaluator, so
every release test must say "single simulated evaluator; findings need QA/PM confirmation".

### Severity scale (Nielsen)
0 = not a usability problem, 1 = cosmetic, 2 = minor, 3 = major (important to fix), 4 = catastrophe
(fix before release). Severity combines **frequency, impact and persistence**.
Sources: [CHI 2016 late-breaking paper on severity scales](https://cml.hci.uni-bamberg.de/~gross/publ/chi16_herr_et_al_severity_rating_scales__proceedings.pdf),
[Princeton course handout](https://www.cs.princeton.edu/courses/archive/spring13/cos436/handouts/Heuristics_explained.pdf) (search results, not opened);
primary: NN/g "Severity Ratings for Usability Problems" (URL from memory, `https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/`, not checked; host blocked).
`[ASSUMPTION: secondary, search]`

### Our addition: close impact (C-score)
Usability severity alone ranks a confusing label above a wrong posting. A controller ranks by what it
does to the close. Every issue gets both. `[GUESS: persona judgement, designed for Clearline]`

| C-score | Meaning | Examples |
|---|---|---|
| C4 | Could put a wrong number in the books or the audit file | Posts the wrong period; posts twice; posts a counterfeit token |
| C3 | Blocks or delays close / sign-off | Can't export evidence; can't tie wallet balance to ledger |
| C2 | Adds manual rework each close | Has to re-key the tx hash into Xero; no bulk approve |
| C1 | Annoyance, no effect on the numbers | Label wording, alignment, colour |
| C0 | No effect | |

**Ranking rule for the top 5:** sort by C-score, then Nielsen severity, then frequency. A C4 always
outranks a severity-4 cosmetic catastrophe on a screen a controller never uses.

## 2. Cognitive walkthrough (Wharton, Rieman, Lewis & Polson, 1994)
Source: [Wikipedia, Cognitive walkthrough](https://en.wikipedia.org/wiki/Cognitive_walkthrough) (opened),
citing Wharton et al. in Nielsen & Mack, *Usability Inspection Methods* (Wiley, 1994).
`[ASSUMPTION: secondary, Wikipedia]`

For each step of a task, ask the four questions:
1. Will the user try to achieve the effect this step has? (Does the controller even know this step is needed?)
2. Will the user notice that the correct action is available?
3. Will the user understand that the action achieves the effect?
4. Does the user get appropriate feedback that it worked?

**The controller's standard tasks** (walk these on every release that touches them):
- T-a "Why is INV-x still open?" — from the at-a-glance page to the cause and the next step.
- T-b Approve and post a short payment as a fee write-off, and check what landed in Xero.
- T-c Confirm an unidentified payment to the right invoice, with a reason.
- T-d Month-end: list everything received in the period, what's posted, what's not, and why.
- T-e Give the auditor evidence for one payment (tx hash, token contract, network, approver, time).
- T-f On the phone: see what needs me today and approve one item (or learn that approval is desktop-only).

## 3. Jobs-to-be-Done switch interview (Bob Moesta and Chris Spiek, Re-Wired Group)
Sources: [jobstobedone.org, The four forces](https://jobstobedone.org/the-four-forces/) (blocked; search
summary only), Moesta, *Demand-Side Sales 101* (2020) (not opened); outcome-driven JTBD variant:
[Wikipedia, Outcome-Driven Innovation](https://en.wikipedia.org/wiki/Outcome-Driven_Innovation) (opened; Tony Ulwick).
`[ASSUMPTION: secondary, search / Wikipedia]`

- A switch happens only when **push** (pain of today) + **pull** (attraction of the new) outweigh
  **anxiety** (fear of the new) + **habit** (comfort of today).
- The interview rebuilds a real timeline: first thought → passive looking → active looking → deciding
  → first use. Prompts: "tell me more", "give me an example", not "why".

**How the simulation uses it:** in a mock sales call the persona carries an explicit forces card
(push, pull, anxiety, habit) built only from sourced traits, and objects from anxiety and habit. In
pain ranking, a pain only counts as a push if a source shows it happening, not if it merely could.
The persona **cannot do a switch interview** (it has no real past); it writes the questions Aashmiin
should ask a real buyer.

## 4. Mom Test discipline (Rob Fitzpatrick, *The Mom Test*, 2013)
Source: search results summarising the book ([mtlynch.io book report](https://mtlynch.io/book-reports/the-mom-test/),
[Shortform summary](https://www.shortform.com/blog/what-is-the-mom-test/)); not opened. `[ASSUMPTION: secondary, search]`

Rules: talk about their life, not your idea; ask about specifics in the past, not opinions about the
future; talk less, listen more. Compliments are worthless as evidence; "would you buy?" invites a lie.

**Applied to a simulation (this is the key point):** the persona's own "I would pay" is the purest
example of a hypothetical future opinion, so it is **zero evidence** by Mom Test standards. Its value
is the *reasons*, which become real questions for real buyers ("How did you handle the last short
payment? Who decided? How long did it take?"). Every P2 and P3 output ends with those questions.

## 5. Design-partner and customer-proxy practice
- A proxy (internal "voice of the customer") is useful for **finding problems** and **rehearsing**,
  and harmful when used to **decide demand**. `[GUESS: persona judgement, consistent with Mom Test]`
- The proxy must be refreshed from real conversations and must shrink its claims when calls
  contradict it (playbook P5).
- Each finding must be reproducible by someone else (QA) or it is an opinion.

## First refresh to-do (research-intern)
Open and relabel: NN/g ten heuristics and severity ratings articles; jobstobedone.org four forces;
momtestbook.com. Hosts to allow: nngroup.com, jobstobedone.org, momtestbook.com.
