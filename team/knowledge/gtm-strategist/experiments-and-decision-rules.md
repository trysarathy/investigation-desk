# Experiments and decision rules

Last refreshed 2026-10-31 · owner gtm-strategist. Approach: pre-registered hypothesis, one primary
metric, minimum n, fixed end date, decision rule written before start (`frameworks.md` §7), and
evidence graded with the Mom Test (`frameworks.md` §8). The maths below was computed in this
session (Wilson score interval, 95%) and can be re-run with the snippet in §6.

## 1. Experiment template (register in the Log before the first touch)
```
EXP-<YYYYMMDD>-<n>  <short name>
Hypothesis:      We believe <change> for <segment> will <effect> because <evidence/reason>.
Type:            message | segment | channel | offer/pricing | positioning | partner
Variable:        ONE thing changed (everything else held as in control)
Control:         <current version / no change>
Primary metric:  <one metric, exact definition from the tabs>
Guardrail:       bounce < 2%, 0 complaints, no rule breach, no unsubscribe spike
Minimum n:       <from §2>          Max duration: <date>        Allocation: <how split>
Decision rule:   SCALE if ... ; KILL if ... ; ITERATE if ... ; else INCONCLUSIVE
Owner(s):        <who runs it>   Approvals needed: <Aashmiin? what>
Cost:            <founder hours/week, money>
Registered:      <timestamp SGT>  (rule frozen from here)
```

## 2. Minimum n per metric (below it, the only allowed verdict is INCONCLUSIVE)
| Metric | Minimum n to decide | Why |
|---|---|---|
| Positive-reply rate per D0 (one variant) | **150 D0 sends per arm** | At 3/150 the 95% CI is 1-6%; at 100 sends 5/100 is 2-11%. Smaller samples can't separate 2% from 6% |
| Difference between two message variants | 150 per arm **and** non-overlapping CIs, else "no detectable difference" | Low base rates; only big effects are detectable at our volume |
| Strong-problem share in a segment | **8 held calls** in that segment | 4/8 = CI 22-78%; 6/8 = 41-93%. At n=3, 2/3 = 21-94%: tells you almost nothing |
| Offer acceptance at a price | **5 offers** at that price | Each offer is expensive; 0/5 is a real signal (upper bound ~43%), 0/2 is not |
| Channel → held calls | 3 weeks or the volume floor for that channel, whichever is later | Lags between touch and call |
| Partner referral | 5 partner conversations grade B+ and 30 days | Referrals lag |
**Rule of three:** 0 successes in n trials → the 95% upper bound is about 3/n (0 of 10 → up to
~28% by Wilson; ~30% by the rule of three). "Zero" at small n is not "none".

## 3. Decision rules (defaults; an experiment may pre-register stricter ones)
| Verdict | When | What happens |
|---|---|---|
| **SCALE** | Minimum n reached, primary metric meets the pre-registered bar, CI lower bound above control (or above the floor), guardrails clean | Proposed as a numbered decision ("roll variant B to all S1 sends") for her yes; owner applies |
| **ITERATE** | Minimum n reached, promising but below the bar, or one signal strong and another weak | Change ONE variable → new experiment ID |
| **KILL** | Minimum n reached and metric at/under the kill bar (e.g. CI upper bound below the floor), or guardrail breached | Stop; log the learning; free the capacity. Breach → stop immediately, `RISK:` row |
| **INCONCLUSIVE** | Below minimum n at end date, or CIs overlap | Say so with the interval; extend once (state new end date) or stop; **never** call it a win or a loss |
Default floors (until data says otherwise) [ASSUMPTION]: positive-reply floor 2% per D0;
Strong-share bar 50% of held calls; offer bar >= 2 paid of 5.

## 4. Segment decisions (beachhead) need more than one metric
Declare a beachhead only with: >= 8 held calls in the segment, >= 50% Strong with grade A-C
evidence, >= 3 specific wrong-payment stories in the last 90 days, and >= 1 paid pilot. Until all
four, the honest status is "leading candidate, n too small" (`icp-and-segments.md` §4).

## 5. Evidence grading (Mom Test) before counting
A paid / signed / gave data or access · B dated next step (intro, demo on their data, security
review) · C specific past story with numbers · D compliment, hypothetical, future promise.
Only A-C count. A call with a D-only signal counts as "held, no evidence", not as Strong, even if
the Calls tab says Strong: flag the mismatch to sales-closer-assistant.

## 6. Interval snippet (run with python3; no packages)
```python
from math import sqrt
def wilson(k, n, z=1.96):
    if n == 0: return (0, 100)
    p = k/n; d = 1 + z*z/n
    c = (p + z*z/(2*n))/d; h = z*sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return round(100*(c-h)), round(100*(c+h))
# wilson(2,3) -> (21, 94); wilson(5,100) -> (2, 11); wilson(3,150) -> (1, 6); wilson(0,10) -> (0, 28)
```

## 7. Anti-patterns (each one fails the rubric)
Peeking and stopping early on a good day; changing the metric after the start; testing two
variables at once; pooling segments to reach n and then claiming a segment result; reporting
a percentage without its denominator; treating a reply-rate drop under the guard's 1% throttle as
an experiment result instead of a deliverability event; counting compliments.

## 8. Metric for this employee
Weekly: experiments started; experiments past end date that are decided (S/I/K/INC); share of
SCALE+KILL decisions that met minimum n (target 100%). INCONCLUSIVE counts as "decided" when it
is declared on time with an extend/stop call.
