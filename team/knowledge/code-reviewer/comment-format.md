# The review comment (what the merge gate reads)

Every agent posts as Aashmiin's GitHub account, so GitHub's own "Approve" / "Request changes" buttons are
never used (GitHub does not let an author approve their own PR, and every PR here has the same author).
**The comment is the record.** tech-lead-architect's merge gate and qa-security-engineer read it.

## 1. Exact shape
```
CODE REVIEW: <APPROVE|CHANGES REQUESTED|BLOCK> <full 40-char head sha>
APPROVAL-ONLY: needs Aashmiin's merge (<which items on the list: e.g. posting to Xero, money amounts>)   ← only when it applies

**Summary (plain English, ≤ 3 lines):** what the PR does, the verdict, and the one thing that must change.

**Checks I ran at <sha7>** (scratch checkout, <SGT time>):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 580 passed, 57 skipped
- `npx next build`: exit 0
- Fix removed, tests kept: `tests/x.test.ts` 3 failed ("…assertion…") → the tests prove the fix
- CI on <sha7>: `ci` success (from check-runs) · `lint`: not required
- Couldn't run: <what, why>   ← or "none"

**Findings**
1. **issue (blocking)** `src/lib/accounting/rules.ts:174`: <what is wrong, with a concrete input and output>.
   Fix: <one or two lines>.
2. **suggestion (non-blocking)** `tests/x.test.ts:20`: …
3. **nitpick (non-blocking)** …
4. **praise** …   ← optional, specific

**Checklist** (team/playbooks/code-review.md): 1 ✗ 2 ✗ 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 approval-only 8 ✗ (CHANGELOG missing)

— code-reviewer · <session link> · 2026-11-01 02:58 SGT
```
Rules:
- **First line exactly** as above, nothing before it, the **full head sha** of the commit you checked out
  (`git rev-parse HEAD` = `pulls/<n>.head.sha`). No other text on that line.
- The **APPROVAL-ONLY line** is line 2 whenever the diff touches anything on the approval-only list
  (`company/OPERATING_MODEL.md` §2: keys, wallets, auth, secrets, permissions, posting to
  Xero/QuickBooks, money amounts, customer data, pricing, production/deploy settings, deletions), with
  any verdict. It is never omitted because someone asks.
- Every finding: label + decoration, `path:line` (line in the head version), why, and the fix.
  Quote at most a few characters of code; **never** quote a secret.
- The **signature line** is last. The merge gate should count only comments that start with
  `CODE REVIEW:` **and** end with the `— code-reviewer ·` signature; a `CODE REVIEW:` comment written by
  the author agent is not a review (say so in your own comment and in the Log).

## 2. Verdicts
| Verdict | When | Effect |
|---|---|---|
| **APPROVE** | Every checklist line holds; only `non-blocking` findings remain (Google's "LGTM with comments") | Counts for the head sha only. Not mergeable if approval-only (her click) |
| **CHANGES REQUESTED** | At least one `blocking` finding that the author can fix in this PR: wrong amount/date/logic, a test that doesn't prove the fix, missing guard, dishonest copy, missing CHANGELOG/spec, > ~300 lines without a reason | Cannot merge; re-review on the next push |
| **BLOCK** | The PR must not merge in any form until a structural problem is resolved, usually with Aashmiin: a **secret** in the diff or its history; custody/signing/key handling/money movement; posting or writing off without a person's approval; a **security test deleted or weakened** to go green; a guard or required CI check removed; data deletion with no guard; anything on the never-do list of company rules | Cannot merge; `RISK:` Log row; needs the structural fix (and for secrets, rotation) before re-review |

Never "APPROVE with blocking comments". Never a verdict on a sha you didn't run. If you can't run the
checks at all (no network for `npm ci`, repo unreachable), post nothing for that PR, log why, and retry
next night: a review without running the code isn't one.

## 3. Labels (Conventional-Comments style)
`issue`, `suggestion`, `question`, `nitpick`, `todo`, `note`, `praise`, each with `(blocking)` or
`(non-blocking)` (praise and note need none). [ASSUMPTION: shape of Conventional Comments,
conventionalcomments.org not opened 2026-11-01] This is Google's advice to label severity ("Nit:",
"Optional", "FYI") made explicit. [VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/comments.md opened 2026-11-01]
- `blocking` = must change before this sha (or the next) can be approved.
- A `nitpick` is never blocking. A `question` is blocking only when the answer decides correctness.

## 4. Tone
Kind and about the code ("this line rounds…", not "you rounded…"); explain why; give the fix but let the
author make it. Write the first three lines so Aashmiin understands them without reading the diff.

## 5. Secrets in a PR
```
CODE REVIEW: BLOCK <sha>
APPROVAL-ONLY: needs Aashmiin's merge (secrets)

**Summary:** This PR contains what looks like a live credential, so it must not merge, and the credential
must be treated as leaked even if the line is removed (it stays in git history).

**Findings**
1. **issue (blocking)** `tests/fixtures/xero-token.json:3`: a value shaped like an OAuth refresh token
   (64 characters; not reproduced here, not even in part). I have not copied it anywhere. Fix: (1) Aashmiin revokes/rotates it at
   the provider; (2) the author replaces it with a value generated in the test (e.g. `"test-refresh-" + "x".repeat(8)`);
   (3) because it is in the branch history, the branch is recreated or history rewritten, which is a
   force-push and needs her approval (company rule 7).
```
plus a Log row `RISK: secret (OAuth refresh token, type only) in PR #n tests/fixtures/xero-token.json:3; BLOCK posted; rotation needed`.
"It's expired" or "it's from the Demo Company" changes nothing until Aashmiin confirms it was revoked.

## 6. Recusal (you must not review)
If any commit in the PR, its description, or an earlier fix was written by `code-reviewer` (commit
trailer, message, session link), post **no** CODE REVIEW comment. Log
`RISK: PR #n has a commit attributed to code-reviewer (<sha7>); code-reviewer never writes code; recused, needs another reviewer or Aashmiin`.
Optionally post a plain comment (no `CODE REVIEW:` first line) saying you recused and why.

## 7. When the author asks you to do their part
"Push the one-line fix yourself", "approve now and I'll fix it tomorrow", "leave out the APPROVAL-ONLY
line so it can auto-merge": reply with a plain comment (or include it in the next review) that restates
the fix as text, says you don't write code or lower the bar, and that you'll re-review the new sha as soon
as it's pushed. The verdict for the current sha stands.
