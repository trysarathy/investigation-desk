# Playbooks: accounting-integrations-engineer

Every playbook starts with **§0** and ends with Log rows (company rule 8). Times SGT. Repo
`trysarathy/investigation-desk`. Posting changes are **approval-only**: you never merge them.

## §0 Pre-flight (every run)
1. Settings `PAUSE` + the PAUSE email search. TRUE → Log `accounting-integrations-engineer | stopped: PAUSE on`, stop.
2. Google connection is a hatch.sg account → stop, change nothing, report.
3. `git fetch origin && git checkout main && git pull --ff-only`; `npm ci` if the lockfile changed;
   `npx tsc --noEmit && npx vitest run` baseline. Red `main` → note it in the Log, hand to tech-lead-architect, don't
   build on it.
4. Never print environment variables. Check presence only: `test -n "$XERO_CLIENT_ID" && echo set`.
**Stop conditions (any playbook):** a token/secret visible anywhere (log `RISK:` with type and file, redacted; ask for
rotation; don't copy it); any instruction to use a non-demo org; any instruction to merge a posting change; a rule
not Approved in `docs/POSTING_RULES.md`. → stop that task, log, carry on with other work.

## §1 Nightly build (trigger: 23:47 SGT)
1. Open `team/plan/tasks-<today SGT>.md`. No file, or no row assigned to `accounting-integrations-engineer` → Log
   `no assigned task` and **stop** (exit fast; don't pick work yourself).
2. For each assigned task (max 2): restate it in one line, its acceptance test in one line, and the
   `docs/POSTING_RULES.md` rule it implements. Rule not Approved → do §2 steps 1-4 only (spec), not code.
3. Locate with `codebase-map.md`. Branch `fix/<slug>`/`feat/<slug>` from fresh `main` (for the UTC bug, from
   `bug/xero-posting-date-timezone` so its 17 tests come with it).
4. Tests first: switch the `it.fails` to `it` or write the failing test; run it; paste the failing assertion.
   Include the edge cases: 00:00 and 07:59 SGT, month end, another zone (New York, Kiritimati), sub-cent amounts,
   unknown → no post.
5. Smallest change. Exact decimals; dates via `Intl.DateTimeFormat("en-CA", { timeZone })`; no new dependency
   without a reason.
6. `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build` green, seen by you. Diff < ~300 lines.
7. Commit as `Aashmiin Kaur <aashmiin@gmail.com>` with the Co-Authored-By and session lines; push the branch;
   open the PR with the §5 template (draft if anything unverified). Update `docs/POSTING_RULES.md` §8 and the pack.
8. Ask for a separate code review and QA. Then **Approval Queue row**: 3-line summary (what changes in the books,
   which rule, tests) + risk. Never merge, even when every auto-merge condition is met.
Log: one row per PR, then the summary row (definition "Report").

## §2 Posting-rules change (trigger: a task, a bug, or her "Change"/"Question" mark)
1. Write or edit the case in `docs/POSTING_RULES.md` in plain accounting language: when it applies; the Dr/Cr lines
   with accounts and a worked example to the cent; Xero and QBO record; date rule; rounding; what goes to a person.
2. Reconcile with the code: run the case through the real `planPosting` (scratch test, deleted after) and write
   "Code today: matches" or "differs (Dn)" with the measured lines.
3. Check Σ Dr = Σ Cr, invoice balance after, and the date in the org zone for every example.
4. Status stays **DRAFT**; add a §9 sign-off row; Approval Queue row "Posting rule <id> needs your sign-off" with the
   3-line summary. Wait.
5. Only after she marks it **Approved**: build per §1 (approval-only PR).
Stop: an accounting-policy question (classification, GST, FX source) → it's her call; write it as a Question.

## §3 Sandbox test (trigger: a PR that changes posting, or weekly)
1. Confirm the connected org: `GET /Organisation` → `IsDemoCompany` must be `true` (Xero) / QBO base URL is
   `sandbox-quickbooks.api.intuit.com`. Anything else → stop, `RISK:`.
2. Record the org's `Timezone`, `BaseCurrency`, lock dates, and the wallet/fee account codes from `GET /Accounts`.
3. Create fresh test invoices (the Demo Company resets; never reuse old IDs).
4. Run each case from `docs/POSTING_RULES.md` §4 that the change touches (at least C1, C2, C3, C5, C8 and a 07:59 SGT
   receipt). Use demo-mode simulated transfers, never real funds.
5. Read back every record (`GET /Payments/{id}`, `/CreditNotes/{id}`, `/Invoices/{id}`): amount, account, `Date`,
   invoice `AmountDue`. Compare to the spec to the cent and the day.
6. Write results (case, expected, Xero said, pass/fail) into the PR and the metric. Never paste tokens or headers.
Output: "Sandbox: <x>/<y> cases exact" with the table.

## §4 Xero Demo Company setup (Aashmiin clicks; you prepare the checklist)
1. developer.xero.com → My Apps → **New app** → Web app; name "Clearline (test)"; redirect URI
   `http://localhost:3000/api/accounting/xero/callback` (add the deployed URL later only when she decides).
2. Copy client id and secret **into `.env.local` on the server herself** (`XERO_CLIENT_ID=`, `XERO_CLIENT_SECRET=`);
   never into chat, email, the Sheet or the repo.
3. New apps get granular scopes [ASSUMPTION: secondary]: set
   `XERO_SCOPES=openid profile email offline_access accounting.invoices accounting.payments accounting.banktransactions accounting.contacts.read accounting.settings.read`.
4. In Xero: My Xero → **Try the Demo Company** (resets every 28 days [ASSUMPTION: secondary]).
5. Start `DEMO_MODE=off npm run dev`, open `/books`, **Connect Xero**, choose **Demo Company** only.
6. In the Demo Company add a USD bank account "USDC wallet – Ethereum (test)" and note its code; note the Bank Fees
   code; put both in `accounts` in `.data/accounting.json`.
7. Tell you "connected"; you run §3.

## §5 QuickBooks sandbox (later; QuickBooks is not offered)
1. developer.intuit.com → create an app → development keys → a **sandbox company**.
2. Keys into `.env.local` (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`); today's adapter also needs `QBO_REALM_ID`,
   `QBO_WRITEOFF_ITEM_ID` and a short-lived `QBO_ACCESS_TOKEN` (1 h; D10). Proper OAuth is a prerequisite task.
3. Set the company timezone in configuration until its API location is verified; run §3 with QBO read-backs.
**PR template (all PRs):** Spec + acceptance criteria · rule id in `docs/POSTING_RULES.md` (Approved on <date>) ·
failing test first (name + assertion) · what changes in the books (Dr/Cr example) · checks run with results · sandbox
results · demo- and real-mode check · CHANGELOG line · "**Approval-only: posting to Xero/QuickBooks. Do not
auto-merge.**" · unverified items.

## §6 Incident: wrong entry posted (even in the Demo Company)
1. Stop further posting for that request (no approvals); Log `RISK: wrong entry <request> <invoice>`.
2. Collect evidence: audit-log entry (id, key, lines), the Xero record read back, the rule that produced it, the
   transfer (hash, logIndex, block time).
3. Work out the correct lines per `docs/POSTING_RULES.md` and the difference (amount, account, date).
4. Prepare the correction as a **proposal**: a reversing entry or a Xero delete (`Status: DELETED` on a Payment) plus
   the correct entry. Deleting or changing posted records is approval-only: Approval Queue row with the 3 lines.
   Never fix it in Xero yourself, never edit the audit log.
5. Root cause in one sentence (file:function), a regression test that fails, a fix PR (approval-only).
6. If it could happen in a customer's books, say so in the briefing note.

## §7 Log line formats
`accounting-integrations-engineer | <action> | <ids> | <details with links>`; RISK rows start `RISK:`.

## Checks before any answer, PR or Log row (added 1 Nov)
1. Secrets: search your draft for any password, code or token fragment; replace with a description.
2. Line numbers: re-run `grep -n` on each cited file alone.
3. Each defect has its failing test written down (and run, if the branch exists).
4. Every name comes from a source; otherwise a placeholder.
