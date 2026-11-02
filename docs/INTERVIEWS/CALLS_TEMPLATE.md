# Interview log: Calls tab columns (discovery sprint, from 2026-11-02)

Template only. **Adding these columns or a new tab to the Company HQ Sheet needs Aashmiin's OK** (I don't
edit the Sheet layout). Until then she can keep this as a CSV/table and paste rows in.

## Rules
1. **Only real calls go in.** No mock calls, no persona (crypto-finance-user) output, no "they'd probably
   say". A call that didn't happen has no row.
2. **Every public claim must trace to a row.** Any sentence in a post, deck, website, email or pitch
   that says "businesses tell us…" cites row ids, and only rows with `OK to quote publicly? = Y` may be
   quoted (anonymised unless they agreed to their name).
3. **Quotes are exact** (her notes, in quotation marks as said). Otherwise `per notes: …`. Never tidied.
4. **Numbers are theirs only**, units kept. No estimate of ours goes in `cost` or `would pay`. Blank = Unknown.
5. `would pay` is filled only from **past or present behaviour** (they pay for something today, or offered
   money/a budget unprompted). "We'd probably pay" = `N (hypothetical)`; it's a Mom Test D and doesn't count.
6. Advisor/partner calls (OTC desk, advisory firm, Matt/Vishal/Ryan/Brian views) → `source = advisor`;
   they never count as a customer Strong on their own.
7. One row per person per call. One hypothesis per row is preferred; if a call tests two, make two rows
   with the same date/who (scores often differ).
8. No secrets, wallet keys, logins or their clients' names in any cell.

## Columns
| # | Column | Allowed values / format | Example (format only, not real) |
|---|---|---|---|
| 1 | date | YYYY-MM-DD (SGT) | 2026-11-04 |
| 2 | who (name) | As they introduced themselves | `<name>` |
| 3 | role | Their title in their words | `<title>` |
| 4 | company type | merchant / exporter / agency / SaaS / PSP / OTC desk / exchange / accounting-advisory / other: … | `<type>` |
| 5 | country | Country of the business | `<country>` |
| 6 | receives stablecoins today (Y/N) | Y / N | Y |
| 7 | the pain in their words (exact quote) | "…" or `per notes: …` or blank | `"<their exact words>"` |
| 8 | what they do today | Workaround, tools, people | `<workaround>` |
| 9 | cost (their numbers only) | As said, with units; blank = Unknown | `<their number + unit>` |
| 10 | would pay (Y/N/how much) | Y + what they pay today / N / N (hypothetical) / Unknown | `<…>` |
| 11 | hypothesis tested (H1–H4) | H1 / H2 / H3 / H4 | H2 |
| 12 | score (Strong/Weak/None) | Strong / Weak / None / Unscored – notes too thin (definitions: `SCRIPT_CORE.md`) | `<score>` |
| 13 | next step | Who, what, when, as agreed (intro, data sample, follow-up) or "none" | `<…>` |
| 14 | source (call/advisor) | call / advisor | call |
| 15 | OK to quote publicly? (Y/N) | Y / N / Y-anonymous. Default **N** until they said yes | N |

Optional (recommended): `Q5 answer (word for word)`, `evidence grade A-D`, `notes link`, `row id`.

## CSV header (copy into the Sheet once she OKs)
```
date,who (name),role,company type,country,receives stablecoins today (Y/N),the pain in their words (exact quote),what they do today,cost (their numbers only),would pay (Y/N/how much),hypothesis tested (H1–H4),score (Strong/Weak/None),next step,source (call/advisor),OK to quote publicly? (Y/N)
```

## Day-7 tally (from rows only)
For each of H1-H4: number of calls, Strong / Weak / None (source = call only), and advisor rows
separately. The "biggest pain" is the hypothesis with the most Strong call rows whose cost column has a
number; ties → the one with more commitments (intros, data samples).
