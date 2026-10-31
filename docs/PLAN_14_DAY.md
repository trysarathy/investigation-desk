# 14-day technical plan: the reproducible Xero demo

Owner: **tech-lead-architect**. Written 2026-11-01 SGT. Day 1 = Sun 1 Nov 2026, Day 14 = Sat 14 Nov
2026 (SGT). Architecture: `docs/ARCHITECTURE.md`. Dependencies: `team/knowledge/tech-lead-architect/dependency-map-14-day.md`.

**Status of every step today: not started.** (Status means the acceptance criteria are met. The
Day 1 tech-lead documents exist as drafts on the `ai-team` branch, not merged and not approved, so
D1.1 is also "not started".)

## The target (all six, from a clean checkout)
1. A finance controller connects a wallet address (read-only) and a Xero demo org.
2. 20 test payments arrive, on testnet or as replayed real transfers, covering exact, partial,
   over, wrong token, wrong network and a look-alike address.
3. Clearline matches each to an invoice or flags it, with a plain-English explanation.
4. On approval, correct entries post to the Xero demo org: right accounts, amounts to the cent,
   dates in the org's own timezone.
5. Every unmatched or risky payment is in the exceptions queue with the reason.
6. A recorded walkthrough (script + screenshots) in `docs/DEMO.md`.

## Rules for this plan
- Build order follows company/OPERATING_MODEL.md §2: (1) UTC posting-date bug, (2) reorg dismiss
  bug, (3) security gaps by severity, (4) contrast fix, (5) roadmap. The demo work below is
  scheduled around that order, not ahead of it.
- Every step is one or more PRs < 300 changed lines, tests first, CI green, `CODE REVIEW: APPROVE
  <sha>` (code-reviewer) and `QA: PASS <sha>`.
- **AQ** = needs Aashmiin (Approval Queue). **AO** = approval-only PR: she merges it, never an agent.
- Merges: nothing auto-merges until the branch rule on `main` requires the `ci` check (today it
  requires a PR only; see `docs/ARCHITECTURE.md` §1.9). Until then every PR waits for her click.
- Labelling: scenario payments are shown as "replayed public transfer", "testnet" or "demo data";
  never as real customer payments.

## What Aashmiin needs to do (in date order)
| By | Decision / action | Unblocks |
|---|---|---|
| Day 1-2 | **Branch rule:** add a required status check `ci` (strict) to the `main` ruleset (or classic rule per `team/APPROVALS/branch-protection.md`). Today: PR required only, no required check, role bypass | any auto-merge |
| Day 2 | **Approve ADR 0001** (how decisions are recorded) | ADR process |
| Day 2 | **Approve ADR 0002** (posting date in org timezone; includes adding Xero scope `accounting.settings.read`) and its PR (a) | target 4 |
| Day 2 | **Choose the scenario source (ADR 0003):** replayed real transfers (no keys, no wallet, no new chain) or a testnet (needs a test wallet *she* controls and sends from; Clearline never holds keys; a testnet chain + official testnet token contract must be added) | target 1, 2 |
| Day 3 | **Create a Xero developer app** (Web app, redirect `http://localhost:3000/api/accounting/xero/callback`), put `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET` in a git-ignored `.env.local` on the demo machine (never in chat or the repo), and **connect the Xero Demo Company** | target 1, 4 |
| Day 3 | **Sign the posting-rules spec for the demo org:** which Demo Company bank account is the stablecoin wallet account, fee account (`404 Bank Fees` proposed by `docs/ACCOUNTING_SYNC.md`), and sign `docs/POSTING_RULES.md` (draft by accounting-integrations-engineer, rule by rule; R2 = ADR 0002) | target 4 |
| Day 4-12 | **Merge AO PRs** after reading each 3-line summary (timezone a+b, account settings, security #1/#2/#6) | targets 1, 4 |
| Day 13 | Capture the Xero-side screenshots (Xero's UI needs her login) | target 6 |
| Day 14 | Review the reproduction run and `docs/DEMO.md` | done |

## Day by day
Status column: all **not started** on 2026-11-01.

### Day 1 · Sun 1 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D1.1 | tech-lead-architect | `docs/ARCHITECTURE.md`, ADR 0001, ADR 0002 (Proposed), this plan on `main` via a docs PR; ADR 0001/0002 rows in Approval Queue | none | AQ (ADRs) | not started |
| D1.2 | devops-engineer | Clean-checkout baseline on `main` @ head: `npm ci`, `tsc`, `vitest`, `next build` all exit 0, logged with sha; CI `ci` job green on `main` head | none | | not started |
| D1.3 | devops-engineer | Branch-rule instructions updated for the **ruleset** that now exists (add `required_status_checks: ci`, strict), filed in Approval Queue | none | AQ | not started |

### Day 2 · Mon 2 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D2.1 | accounting-integrations-engineer | ADR 0002 PR (a): `PlanOptions.orgTimeZone?`, `day()` uses it; the 17 `it.fails` tests on `bug/xero-posting-date-timezone` become `it` and pass; new test: Xero plan with no/invalid zone → `blocked` with the stated reason; no `Asia/Singapore` in `src/` | ADR 0002 Proposed | AO (posting) | not started |
| D2.2 | crypto-protocol-engineer | Reorg dismiss bug (`bug/dismiss-while-confirming-reorg`): failing test flipped, fix PR | none | AO if the fix changes what is counted toward an invoice (decided at review) | not started |
| D2.3 | matching-engine-engineer | Scenario catalogue (doc + JSON schema only): 20 payments, each with invoice, transfer description, expected state, plan status and reason text; covers exact ≥ 4, partial ≥ 3 (incl. accepted-short), over ≥ 2, duplicate ≥ 1, wrong token/counterfeit ≥ 2, wrong network ≥ 2, look-alike address ≥ 2, no reference ≥ 2, still confirming ≥ 1 | none | | not started |
| D2.4 | tech-lead-architect | ADR 0003 (scenario source) Proposed with both options, costs and honesty labels; Approval Queue row | D2.3 draft | AQ | not started |

### Day 3 · Tue 3 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D3.1 | accounting-integrations-engineer | ADR 0002 PR (b): Xero `GET /Organisation` read; CLDR-derived `Timezone`→IANA map with tests for `SINGAPORESTANDARDTIME`→`Asia/Singapore`, `EASTERNSTANDARDTIME`→`America/New_York`, an unknown value → none; scope `accounting.settings.read` added; zone stored on the connection; plans get `orgTimeZone` | D2.1 merged; ADR 0002 approved | AO (posting, permissions) | not started |
| D3.2 | crypto-protocol-engineer | `requests/watch.ts` (pure): given a watched address and a list of token transfers, emit `TransferEvent`s exactly like `LiveHashProvider`; tests incl. wrong network and look-alike sender | ADR 0003 direction (either option uses this) | | not started |
| D3.3 | lead-designer | Contrast fix PR (operating-model order item 4) | none | | not started |

### Day 4 · Wed 4 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D4.1 | crypto-protocol-engineer | Watcher service + route "Check for payments" for a watched address (read-only calls only; replay-testable with recorded responses; unknown/error → nothing recorded and a "couldn't check" message) | D3.2 | | not started |
| D4.2 | frontend-product-engineer | "Connect a wallet address (read-only)" on `/books` or `/requests`: EIP-55 checksum checked (reuse `csv/files.ts checkAddress`), never asks for keys; copy matches PRODUCT_FACTS (Ethereum only) | D3.2 interface | | not started |
| D4.3 | crypto-protocol-engineer | SECURITY_GAPS #1 (demo reset guard) + #4a fix | none | AO (customer data) | not started |

### Day 5 · Thu 5 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D5.1 | matching-engine-engineer | Scenario batch 1: 10 payments as fixtures with provenance labels + a test asserting each expected outcome | D2.3; ADR 0003 decided | | not started |
| D5.2 | frontend-product-engineer | Account-code settings on `/books` (wallet bank account, fee account), validated against the connected org's accounts | Aashmiin's posting spec (Day 3) | AO (posting rules) | not started |
| D5.3 | crypto-protocol-engineer | SECURITY_GAPS #2 (CSRF origin check in middleware) | none | AO (auth) | not started |

### Day 6 · Fri 6 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D6.1 | matching-engine-engineer | Scenario batch 2: the other 10 (wrong network, look-alike, counterfeit, duplicate, no reference) + test | D5.1 | | not started |
| D6.2 | matching-engine-engineer | Wrong-network transfer found live is recorded and flagged (not dropped, gap K5), so it reaches the queue | D4.1 | depends: if it changes what's counted → AO | not started |
| D6.3 | accounting-integrations-engineer | SECURITY_GAPS #6: `xero-tokens.json` written 0600 | none | AO (secrets) | not started |

### Day 7 · Sat 7 Nov (integration checkpoint)
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D7.1 | qa-security-engineer | All 20 scenarios run through demo books end to end from a fresh data dir; report: expected vs actual per payment | D5.1, D6.1, D4.1 | | not started |
| D7.2 | tech-lead-architect | Mid-point re-plan: what slipped, what moves, written to the task file and the evening report | D7.1 | | not started |

### Day 8 · Sun 8 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D8.1 | frontend-product-engineer + lead-designer | Exceptions queue: one view listing every `needs_review`, flagged, unidentified, `never` and `blocked` item with its reason and a link; derived from existing state (no new store); all 20 scenarios' exceptions appear with the expected reason | D7.1 | | not started |

### Day 9 · Mon 9 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D9.1 | matching-engine-engineer | Explanation pass: each of the 20 has a plain-English reason that matches `team/CLAIMS_REVIEW.md` rules; test asserts key phrases | D7.1 | | not started |
| D9.2 | frontend-product-engineer | Request page shows "Posts as <date> (<org> time)" from the plan | D3.1 | | not started |

### Day 10 · Tue 10 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D10.1 | devops-engineer | `npm run demo:check` (or a script): env check (no secrets printed), seed scenarios to a fresh data dir, run, print expected-vs-actual; works offline in demo books | D7.1 | | not started |
| D10.2 | qa-security-engineer | Xero verification script (read-only GETs): for each posted line, compare amount (cents), account code and date with the plan | D3.1 | | not started |

### Day 11 · Wed 11 Nov (first Xero Demo Company run)
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D11.1 | qa-security-engineer | Live mode against the Xero Demo Company: import invoices, run 20 scenarios, a person approves the postable ones, verification script all match; never-post cases never posted; result file with sha | D2.1+D3.1+D5.2 merged by Aashmiin; Xero connected | AQ (her connection; approvals clicked by a named person) | not started |

### Day 12 · Thu 12 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D12.1 | owners of failures | Fix-forward PRs for anything D11.1 found; buffer day | D11.1 | per PR | not started |

### Day 13 · Fri 13 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D13.1 | qa-security-engineer + lead-designer | `docs/DEMO.md`: script (step, what to click, what the viewer sees), Clearline screenshots from the D11 run, Xero screenshots from Aashmiin, every screen labelled with provenance; no invented metrics | D11.1 | AQ (Xero screenshots) | not started |

### Day 14 · Sat 14 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D14.1 | qa-security-engineer (fresh session) | Reproduction from a clean checkout following only `docs/DEMO.md` + `npm run demo:check`; all 6 target items shown; deviations logged | D10.1, D13.1 | | not started |
| D14.2 | tech-lead-architect | Final status against the 6 targets (done / not done, with evidence links) | D14.1 | | not started |

## Evening status format (sent by tech-lead-architect at 21:17 SGT to aashmiin@gmail.com only, ≤ 200 words)
Subject: `Clearline 14-day status Day <n> (<date>)`
```
Day <n> of 14. Targets: 1 <state> · 2 <state> · 3 <state> · 4 <state> · 5 <state> · 6 <state>
Done today: <step ids + PR links, only what you saw merged or passing>
In progress: <step ids, PR links, what's left>
Blocked: <step id: reason; who unblocks (Aashmiin: <exact action>)>
Needs you (Approval Queue): <n> items, top one: <3-line summary title>
Risks: <RISK lines, incl. "RISK: spend limit" if hit>
Tonight's tasks: team/plan/tasks-<date>.md (<n> tasks)
```
States per target: `not started` / `in progress` / `done (evidence)` / `blocked`.
