# Knowledge pack: code-reviewer

Last refreshed: **2026-11-01 (SGT)** · Refresh owner: code-reviewer proposes changes in its summary Log
row; tech-lead-architect applies them (monthly with the golden-task re-run, after every escaped defect
or false block, and whenever a hotspot file:line moves on `main`). Built from the code on `origin/main`
@ `0c7d9f1`, the real PR history (`gh api repos/trysarathy/investigation-desk/pulls?state=all`), the
`security/*` and `bug/*` branches, and the primary sources listed in each file.

Labels (company rule 2): **[VERIFIED: <url> opened 2026-11-01]** = code-reviewer opened the primary source
itself while writing this pack; **[VERIFIED: code @0c7d9f1]** = the line was read in the repo;
**[VERIFIED: ran 2026-11-01]** = the command was run and the output seen; **[ASSUMPTION]** = reasonable,
not checked; **[ASSUMPTION: secondary, <source>]** = only a secondary source was available. When you reuse
a fact in a PR comment, copy the label with who and when (e.g. `[VERIFIED: code-reviewer 2026-11-01,
<url>]`), never "[VERIFIED per pack]".

| File | Use it for |
|---|---|
| `review-standard.md` | What "approve" means (Google's standard), what to look for, speed, how to write comments, severity labels; OWASP Code Review Guide and ASVS 5.0 as the security baseline; Stripe's integer-minor-units rule for money. Every rule sourced. |
| `clearline-hotspots.md` | The places in our code where reviews must slow down, with file:line on `main`: `decimal.ts`/`money.ts`, the `Number()` boundary in the Xero/QuickBooks adapters, posting dates and the org-timezone rule, the approval key, chain reads, demo-mode guards, middleware/auth, CSV export, file writes. What a correct change looks like in each. |
| `security-checklist.md` | The security pass for every diff, mapped row by row to `team/SECURITY_GAPS.md` #1-#8 and to ASVS 5.0 requirement numbers; what a fix PR for each gap must contain; secrets handling. |
| `prove-the-test.md` | How to prove a test fails without the fix (revert `src/` only, run, restore), the `it.fails` convention on our bug/security branches, mutation-style probes for money and dates, what to do when a test passes both ways. With worked runs from 2026-11-01. |
| `comment-format.md` | The exact comment the merge gate reads: first line, APPROVAL-ONLY line, checks block, findings (Conventional-Comments-style labels with `blocking`/`non-blocking`), signature; verdict rules APPROVE / CHANGES REQUESTED / BLOCK; worked examples. |
| `size-and-scope.md` | How to count the ~300-line limit, what doesn't count, when to ask for a split, scope creep, stacked PRs and base branches, the approval-only list applied to file paths. |

## Sources I could not open on 2026-11-01
The session's network allowlist blocked `google.github.io`, `conventionalcomments.org`, `owasp.org`,
`cheatsheetseries.owasp.org`, `developer.mozilla.org`, `developer.xero.com` and `stryker-mutator.io`.
Where the same text lives in the publisher's own GitHub repository I read it there via
`raw.githubusercontent.com` (Google's eng-practices repo, OWASP's ASVS, CheatSheetSeries, www-community
and Code Review Guide project repos, Xero's own OpenAPI spec, vitest's docs, Stryker's README); those are
the publisher's own files, so they are labelled [VERIFIED] with the raw URL. **Conventional Comments could
not be opened at all**: its label set is described from memory and labelled [ASSUMPTION]. First job when
the allowlist widens: open https://conventionalcomments.org/ and relabel `comment-format.md` §3.
