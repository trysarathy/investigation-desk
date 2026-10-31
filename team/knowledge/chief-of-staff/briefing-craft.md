# Briefing craft: how to write for a founder with 60 minutes a day

## 1. Bottom line up front (BLUF)
- BLUF comes from US Army correspondence standards: AR 25-50 asks writers to put "the main point at the
  beginning of the correspondence (bottom line up front)" and to use the active voice; the US Air Force
  *Tongue and Quill* says "get your bottom line up front (most of the time)" [ASSUMPTION S13, S14: seen in
  search summaries, page not opened].
- PostHog's handbook: write "with the busy reader in mind": a summary they can read quickly, then go
  deeper below or in appendices [VERIFIED S11].
- **Our rule:** the first 3 lines of every email answer: *Is anything wrong? What do you need from me? By
  when?* Then detail. Each section header says its conclusion ("Tests: RED on main, fix PR #42 ready"),
  not just its topic ("Tests").
- Subject lines carry state when it matters: `Clearline briefing 2026-11-05 - PAUSE ON - 2 risks`.
  A boring subject on a bad day is a bug.

## 2. Tag every item by what it asks of her
GitLab's E-Group agenda tags each item FYI (no action), TODO (an ask) or DISCUSS, and the Office of the
CEO orders them [VERIFIED S5]. Ours:
| Tag | Meaning | Where |
|---|---|---|
| `STOP` | Something is broken, risky or paused; read first | Top block |
| `APPROVE n` | Needs her yes/no/edit; numbered | Approval queue |
| `DECIDE Dn` | A choice between options; lettered A/B/C | 3 decisions |
| `DO` | A task only she can do (call, LinkedIn, merge, notes) | Her tasks |
| `FYI` | No action | Overnight, numbers, details |
She should be able to stop reading after the last `DECIDE` and lose nothing she must act on.

## 3. Completed staff work: bring answers, not questions
- The "completed staff work" doctrine (1940s US/Canadian military) says the staff officer should hand the
  chief a finished recommendation so the chief only has to approve or disapprove; a rough draft is fine,
  a half-baked idea is not [ASSUMPTION S20: search summary].
- GitLab: "make a concrete proposal instead of calling a meeting"; "every meeting should be a review of
  a proposal"; if you have none, say so and list what you considered [VERIFIED S3].
- **Our rule:** never ask "what do you want to do about X?". Write "I recommend A. Reply `D1 A` to agree."
  If you can't recommend, say why and what would let you.

## 4. Decision memos (the shape of every DECIDE item)
GitLab asks decision proposals to cover Setting (what, when and why now, smallest version), People
(who was consulted), Alternatives, Decision, Explain (why the recommendation) - its SPADE-based template
[VERIFIED S2]. GitLab also: "Say why, not just what" [VERIFIED S3]; "explicitly acknowledge the
quality/quantity of the data"; "it is ok to make a judgment call with limited data, but make sure that
is known" [VERIFIED S2].
Amazon's 2016 letter (as widely quoted) separates Type 1 decisions (one-way doors: irreversible, decide
carefully) from Type 2 (two-way doors: reversible, decide fast), and says most decisions should be made
with about 70% of the information you wish you had [ASSUMPTION S15: secondary summaries]. GitLab: most
decisions are easy to reverse; only irreversible ones need more discussion [VERIFIED S3].
Amazon writes narrative memos instead of slides and reads them silently at the start of meetings
[ASSUMPTION S16]; the lesson for us is full sentences with reasons, not bullet fragments.

**Short form (in the briefing, ≤ 90 words each):**
```
D1. <Question in one line>? (by <date/time>; <one-way | two-way> door)
Why now: <one line, with the number/source that makes it urgent>
A. <option> - <consequence>
B. <option> - <consequence>
C. Do nothing / wait - <consequence>
I recommend B because <reason>. Data: <what it rests on, and how thin it is>.
Reply `D1 B` (or A/C). No reply = <safe default: nothing changes / item stays waiting>.
```
**Long form (a decision memo Doc, when the short form can't carry it):** 1 page max:
Recommendation (2 lines) · Context and why now · Options table (cost, upside, risk, reversibility, time to
undo) · What the data says and how good it is · Who was consulted (which employees/tabs) · What happens on
each answer (who does what by when) · Revisit trigger.

## 5. How to pick and write "3 decisions" well
1. **Collect candidates** from: Decisions log `PENDING` rows; roadmap `needs decision` / `proposed`
   rows; employees' "need decided" Log notes; Opportunities waiting on price/terms; Risks needing a
   mitigation choice; her open questions; schedule/settings questions.
2. **Score** each: (a) does it move paying pilots this week? (b) is anyone blocked? (c) deadline?
   (d) one-way door? (e) cost of waiting a day. Pick the top 3. If fewer than 3 are real, send fewer:
   **never pad** with fake decisions. Park the rest in one line each under "Parked".
3. **Write** each as a choice between real options, including "wait/do nothing", with a recommendation
   and a safe default. Defaults are never "approve": silence never sends, spends, merges or prices
   anything. (The one sanctioned silence-means-go is week-1 first emails under HOLD, set by her.)
4. **Separate decisions from approvals.** An approval is yes/no on a finished item (a draft, a PR); a
   decision is a choice between options. Don't dress approvals up as decisions.
5. **Close the loop** next morning: "Yesterday you chose D1 B - done by revops-crm-agent at 01:27 (Log
   row)". GitLab: give back a deadline or that you did it; "will do" is not helpful [VERIFIED S7].

## 6. Writing rules for her emails
- ≤ 700 words above the `DETAILS` line for the briefing (≈ 3-4 minutes at a typical 200-250 words per
  minute [ASSUMPTION]); the rest is reference she may skip. Read time target ≤ 10 min including clearing
  approvals.
- One line per item; link, owner, recommendation. Numbers with source in brackets: `(Touches tab)`.
- Bad news plainly: "main is RED: 2 tests failing in accounting-sync (QA 22:53)". Never "mostly green".
- No "great progress!" filler. No passive voice hiding who failed: name the employee and run.
- Same section order every day so her eye knows where to go; empty sections say "none" in one line.
- Every reply format she can use is printed once at the bottom: `1 yes, 2 no, 3 edit: ..., D1 B, HOLD, PAUSE`.

## 7. Anti-patterns (each one fails the rubric)
Burying a `RISK:` row in "overnight"; reporting a number nobody computed; "you may want to consider";
three decisions that are really one; options without consequences; a recommendation without a reason;
asking her to read a 2,000-word log; repeating yesterday's unchanged items without their age.
