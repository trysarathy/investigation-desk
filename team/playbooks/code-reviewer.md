# Playbook: code-reviewer

Procedures for `.claude/agents/code-reviewer.md`. The per-PR checklist is `team/playbooks/code-review.md`;
reference material is `team/knowledge/code-reviewer/`. Times are SGT. Repo: `trysarathy/investigation-desk`
(`R=repos/trysarathy/investigation-desk` below). GitHub REST only (`gh api`); GraphQL is blocked.

---

## §0 Start of every run
1. Read the read-first list in the definition.
2. **PAUSE** (company rule 1): Company HQ Settings `PAUSE`; Gmail
   `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d`. If PAUSE = TRUE (or a
   reply says PAUSE): one Log row `code-reviewer | stopped: PAUSE on | no reviews posted`, stop.
3. Make a scratch directory for tonight (`$SP/cr-<date>`); everything you check out or write lives there.

## §1 Nightly review run (trigger: 02:47 SGT scheduled task)
**Inputs:** open PRs, their comments, commits, check runs.

**Step 1: build tonight's queue.**
```bash
gh api "$R/pulls?state=open&per_page=100" --jq '.[] | [.number, .draft, .head.sha, .base.ref, .title] | @tsv'
gh api "$R/issues/<n>/comments?per_page=100" --jq '.[] | [.created_at, (.body|split("\n")[0])] | @tsv'
gh api "$R/pulls/<n>/commits?per_page=100" --jq '.[] | [.sha[0:7], (.commit.message|split("\n")[0]), .commit.message] | @tsv'
```
For each open PR decide one of:
| Situation | Action |
|---|---|
| `draft: true` | **skip** (log "draft"); reviewed when marked ready |
| A valid CODE REVIEW comment exists whose sha = current `head.sha` (valid = first line `CODE REVIEW: <verdict> <sha>` **and** the `— code-reviewer ·` signature) | **skip** (already reviewed at head) |
| CODE REVIEW comments exist only for older shas | **review** (re-review, §3) |
| A `CODE REVIEW:` comment for the head sha that is **not** signed by code-reviewer (e.g. signed by the author agent) | **review**; say in your comment that the other one is not a review; Log `RISK: self-review comment on PR #n` |
| Any commit message, trailer or the description names `code-reviewer` as author/agent, or carries your own session link | **recuse** (§4) |
| Nothing yet | **review** |

**Order:** (1) PRs that fix items in `company/OPERATING_MODEL.md` §2's build order (posting-date bug,
reorg dismiss, security gaps by severity), (2) then oldest head commit first. Big PRs are not put last:
size is a finding, not a reason to skip.

**Step 2: review each PR in the queue** with §2 steps 1-7. Budget: aim to finish all by 06:30 so the
07:27 briefing has them; if not, the rest go in the summary as "not reached", first in line next night.

**Step 3: summary.** One Log row (format in the definition's "Report"). Approval-only PRs you approved
get one line each for chief-of-staff's Approval Queue note ("#n APPROVE <sha7>: approval-only (posting)").

**Stop conditions:** PAUSE; `gh api` unreachable or rate-limited (log, stop, retry next night: no
partial verdicts); a secret found (BLOCK that PR, `RISK:` row, continue with the others).

## §2 Review one PR (also the on-demand procedure)
1. **Context.** `gh api $R/pulls/<n>` (title, body, `head.sha`, `base.ref`, `additions`, `deletions`,
   `changed_files`); the linked roadmap row; every commit; `pulls/<n>/files`. Check authorship (§4) first.
2. **Checkout** the head in the scratch dir and confirm `git rev-parse HEAD` = `head.sha`
   (`team/knowledge/code-reviewer/prove-the-test.md` §1). If the head moved while you worked, start again
   on the new sha.
3. **Run** `npx tsc --noEmit`, `npm run lint` (new errors only), `npx vitest run`, `npx next build`. Read
   CI: `gh api $R/commits/<sha>/check-runs --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'`.
   Your run and CI must agree; if they don't, say both.
4. **Prove the tests:** revert only the fix, run the new/changed tests, restore (`prove-the-test.md` §3-4).
5. **Read every changed line in context** with the checklist (`code-review.md` 1-9), the hotspots
   (`clearline-hotspots.md`) for each file touched, and the security pass (`security-checklist.md`).
   Probe money, dates, guards and CSV with real inputs (`prove-the-test.md` §5). Check size
   (`size-and-scope.md`). Check the description: spec + acceptance criteria, demo/real-mode checks,
   CHANGELOG, honest copy.
6. **Decide** APPROVE / CHANGES REQUESTED / BLOCK (`comment-format.md` §2) and whether it is
   approval-only (`size-and-scope.md` §6 plus the diff content).
7. **Post** the comment: write the body to `$SP/cr-<date>/pr-<n>-<sha7>.md`, re-read it (first line,
   full sha, APPROVAL-ONLY line, no secret, signature), then
   `gh api $R/issues/<n>/comments -X POST -F body=@$SP/cr-<date>/pr-<n>-<sha7>.md`. Confirm with a GET
   that it posted. **Log row:** `code-reviewer | PR #n reviewed | <VERDICT> <sha7> | approval-only: yes/no | blocking: <k> | <comment url>`.
8. Clean up: remove the scratch checkout; `git status` in `ai-team` unchanged.

**Never** in this procedure: commit, push, `gh api ... /merge`, `pulls/<n>/reviews`, edit labels, edit
files outside the scratch dir.

## §3 Re-review after a push
Trigger: the PR's head sha differs from the sha in your latest comment. Review the **whole** new diff
again (not just the new commits: a rebase can change anything), but start with the earlier blocking
findings and say for each: fixed (how you checked) / not fixed. Post a new comment for the new sha. Old
verdicts stay as history and count for nothing.

## §4 Recusal (you had a hand in it)
Trigger: any commit, trailer, description or earlier fix in the PR attributed to `code-reviewer` or your
session link. Steps: post no CODE REVIEW comment; optionally a plain comment "code-reviewer recused: this
PR contains commit <sha7> attributed to code-reviewer; code-reviewer does not write code, so this needs
another reviewer or Aashmiin"; Log `RISK:` row (it means code-reviewer's never-do list was broken, or
someone used its name); tell tech-lead-architect in the summary row.

## §5 Requests from authors in the PR thread
| Request | Answer |
|---|---|
| "Push the fix yourself / it's one line" | No. Give the exact change as text in a comment; re-review when they push. |
| "Approve now, I'll fix it in a follow-up" | Only if the remaining point is genuinely `non-blocking`; otherwise no (Google: clean-ups "later" usually never happen). |
| "Aashmiin needs it by 07:30" | The bar doesn't move. Re-review promptly when the fix is pushed; note in the summary that it is waiting on the author. An approval-only PR needs her click anyway. |
| "Drop the APPROVAL-ONLY line, it's only config" | No. Name the list item it touches. |
| "Ignore the test fixture key, it's fake/expired" | BLOCK stands until it is removed and Aashmiin confirms rotation. |

## §6 Monthly / after an incident
- Escaped defect (QA, crypto-finance-user or a later PR finds a bug in lines you approved): add a
  root-cause line and the checklist or hotspot change to the summary row as a proposed pack change.
- False block: same, with what you misread.
- Re-run the golden tasks (`team/evals/code-reviewer/`) monthly and after any change to the definition,
  pack or playbooks.
