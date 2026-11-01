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
- **Posting rules signed (2026-11-01).** Aashmiin approved five rules in `docs/POSTING_RULES.md` §9
  (v0.2): (1) receipts post to a per-organisation **Stablecoin clearing** account, not a bank
  account; (2) no automatic GST on shortfalls, an accepted shortfall posts to the organisation's
  chosen account and is flagged for the accountant; (3) rounding line up to 0.01 per invoice, any
  larger difference → exceptions queue (no posting); (4) par to USD, then Xero's own FX rate to
  base currency, depeg above 0.5% → exception; (5) post only at Ethereum `finalized`, never on a
  confirmation count. Only these may be built; the rest of the spec is still DRAFT and its open
  questions are in `docs/POSTING_RULES.md` §10. Tasks that implement them are marked **[PR-v0.2]**.
- **Roadmap priority 2 (Aashmiin, 2026-11-01): the partial-post idempotency bug** (POSTING_RULES
  D19), right after the UTC posting-date fix. Task D2.5; failing tests go on
  `bug/partial-post-idempotency`.

## What Aashmiin needs to do (in date order)
| By | Decision / action | Unblocks |
|---|---|---|
| Day 1-2 | **Branch rule:** add a required status check `ci` (strict) to the `main` ruleset (or classic rule per `team/APPROVALS/branch-protection.md`). Today: PR required only, no required check, role bypass | any auto-merge |
| Day 2 | **Approve ADR 0001** (how decisions are recorded) | ADR process |
| Day 2 | **Approve ADR 0002** (posting date in org timezone; includes adding Xero scope `accounting.settings.read`) and its PR (a) | target 4 |
| Day 2 | **Choose the scenario source (ADR 0003):** replayed real transfers (no keys, no wallet, no new chain) or a testnet (needs a test wallet *she* controls and sends from; Clearline never holds keys; a testnet chain + official testnet token contract must be added) | target 1, 2 |
| Day 3 | **Create a Xero developer app** (Web app, redirect `http://localhost:3000/api/accounting/xero/callback`), put `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET` in a git-ignored `.env.local` on the demo machine (never in chat or the repo), and **connect the Xero Demo Company** | target 1, 4 |
| ~~Day 3~~ done 2026-11-01 | ~~Sign the posting-rules spec~~: **five rules signed** (clearing account, shortfall/GST, rounding, FX, finality; `docs/POSTING_RULES.md` §9) | D4.4, D5.4, D5.5, D6.4, D7.3, D8.2, D9.3 |
| Day 3 | **Sign the rest needed for the Day 11 run:** R1, R2 (= ADR 0002), R3(a)-(c), R6, R7, C1 in `docs/POSTING_RULES.md` §9 | target 4 |
| Day 3-4 | **In the Xero Demo Company:** create a current-asset account "Stablecoin clearing" with "Enable payments to this account" ticked (not a bank account), and choose the shortfall account and the rounding account; tell accounting-integrations-engineer the three codes (codes only) | D4.4, D11.1 |
| Day 4 | **Answer Q-R1, Q-R2, Q-R3, Q-SF1** (`docs/POSTING_RULES.md` §10: does a >0.01 partial wait for a person; over by exactly 0.01; rounding account; shortfall account per org or per acceptance) | D5.4, D6.4 |
| Day 6 | **Answer Q-C5** (overpayments when the clearing account is not a bank account) and **Q-SF2** (how the accountant is flagged) | D6.4, overpayment cases in D11.1 |
| Day 7 | **Answer Q-FX1 (price source for the depeg check) and Q-FX2** (price unavailable: exception, or par in the Demo Company only). Without one of them nothing posts on Day 11 (fail closed) | D9.3, D11.1 |
| Day 8 | **Answer Q-FX3** (base-currency amount shown only after Xero posts) | D8.2 |
| Day 4-12 | **Merge AO PRs** after reading each 3-line summary (timezone a+b, partial-post idempotency, account settings + clearing validation, rounding, shortfall flag, finality read + gate, FX, depeg, security #1/#2/#6). About 14 AO PRs: plan ~2 merges a day | targets 1, 4 |
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
| D2.3 | matching-engine-engineer | Scenario catalogue (doc + JSON schema only): 20 payments, each with invoice, transfer description, expected state, plan status and reason text; covers exact ≥ 4, partial ≥ 3 (incl. accepted-short, expected: posts to the shortfall account + accountant flag; and a >0.01 short with no decision, expected: exceptions queue), over ≥ 2, duplicate ≥ 1, wrong token/counterfeit ≥ 2, wrong network ≥ 2, look-alike address ≥ 2, no reference ≥ 2, not yet final ≥ 1 (expected `waiting`, "not final yet"), **[PR-v0.2]** short by ≤ 0.01 ≥ 1 (expected: rounding line, invoice paid). Expected lines name the clearing account, never a bank account. Depeg is a unit-test case only (no replayed transfer can carry a price) | none | | not started |
| D2.5 | accounting-integrations-engineer | **Partial-post idempotency (roadmap priority 2, POSTING_RULES D19/R7).** **Day 1 (done): 9 failing tests committed to `bug/partial-post-idempotency` @ b529bae (`tests/posting-idempotency.test.ts`, spec `docs/specs/posting-idempotency.md`); they cover, among others:** (1) accepted shortfall, payment posts, credit note fails with a 504 → on retry the credit note's `Idempotency-Key` equals the one sent on attempt 1 (`<key1>-1`); today it is `<key2>-0` (measured 2026-11-01 on `0c7d9f1`); (2) `PUT /CreditNotes` succeeds, `/Allocations` fails → the created credit note is recorded and a retry allocates it, never creates a second; (3) a plan changed by a new transfer still needs re-approval (no regression of the plan-key check). Day 3: fix PR from that branch (per-line keys derived from request + line identity, not the remaining-lines hash), the tests switch to `it` and pass; diff < 300 lines | D2.1 first in order (no code dependency) | AO (posting) | not started |
| D2.4 | tech-lead-architect | ADR 0003 (scenario source) Proposed with both options, costs and honesty labels; Approval Queue row | D2.3 draft | AQ | not started |

### Day 3 · Tue 3 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D3.1 | accounting-integrations-engineer | ADR 0002 PR (b): Xero `GET /Organisation` read; CLDR-derived `Timezone`→IANA map with tests for `SINGAPORESTANDARDTIME`→`Asia/Singapore`, `EASTERNSTANDARDTIME`→`America/New_York`, an unknown value → none; scope `accounting.settings.read` added; zone stored on the connection; plans get `orgTimeZone`. **Also store `BaseCurrency` and `IsDemoCompany`** from the same read (used by D8.2 and R6; no behaviour change in this PR) | D2.1 merged; ADR 0002 approved | AO (posting, permissions) | not started |
| D3.4 | tech-lead-architect | ADR 0004 (Proposed): the interface changes the signed rules need, which `docs/ARCHITECTURE.md` §2 ("Interfaces that several engineers touch") otherwise forbids without an ADR: `AccountSettings` (`clearingAccountCode`, `shortfallAccountCode`, `roundingAccountCode`), `Observation`/`TransferEvent` finality fields (`finalizedAt`/`finalBlock` from D5.5), `PlanOptions.price` use, plan reason codes for the exceptions queue; Approval Queue row | POSTING_RULES v0.2 | AQ | not started |
| D3.2 | crypto-protocol-engineer | `requests/watch.ts` (pure): given a watched address and a list of token transfers, emit `TransferEvent`s exactly like `LiveHashProvider`; tests incl. wrong network and look-alike sender | ADR 0003 direction (either option uses this) | | not started |
| D3.3 | lead-designer | Contrast fix PR (operating-model order item 4) | none | | not started |

### Day 4 · Wed 4 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D4.1 | crypto-protocol-engineer | Watcher service + route "Check for payments" for a watched address (read-only calls only; replay-testable with recorded responses; unknown/error → nothing recorded and a "couldn't check" message) | D3.2 | | not started |
| D4.2 | frontend-product-engineer | "Connect a wallet address (read-only)" on `/books` or `/requests`: EIP-55 checksum checked (reuse `csv/files.ts checkAddress`), never asks for keys; copy matches PRODUCT_FACTS (Ethereum only) | D3.2 interface | | not started |
| D4.3 | crypto-protocol-engineer | SECURITY_GAPS #1 (demo reset guard) + #4a fix | none | AO (customer data) | not started |
| D4.4 | accounting-integrations-engineer | **[PR-v0.2] Clearing account setting + validation** (decisions 1, 2; D8, D16). `AccountSettings` gains `clearingAccountCode`, `shortfallAccountCode`, `roundingAccountCode`, **no defaults** (an old data file's `walletAccountCode` `090` / `feeAccountCode` `404` are not carried over silently: plans `blocked` until set). Validation from Xero `GET /Accounts`: clearing = exists, ACTIVE, `Class` ASSET, `Type` ≠ BANK, `EnablePaymentsToAccount` true; shortfall and rounding = exist, ACTIVE. Tests: each failing check → `blocked` with its reason; a BANK account as clearing → `blocked` "not a bank account"; `GET /Accounts` fails or scope missing → `blocked`, never "assume valid"; payment line `Account.Code` = clearing code. Demo Company check (playbook §3): a Payment into the clearing account is accepted and reads back | D3.1, D3.4 | AO (posting rules, accounts) | not started |

### Day 5 · Thu 5 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D5.1 | matching-engine-engineer | Scenario batch 1: 10 payments as fixtures with provenance labels + a test asserting each expected outcome | D2.3; ADR 0003 decided | | not started |
| D5.2 | frontend-product-engineer | **[PR-v0.2]** Account-code settings on `/books`: **Stablecoin clearing** (help text: "a current-asset account with payments enabled, not a bank account"), shortfall account (per Q-SF1), rounding account; shows D4.4's validation result per account; never offers a bank account as the clearing account; no "Cash at bank" wording | D4.4 | AO (posting rules) | not started |
| D5.3 | crypto-protocol-engineer | SECURITY_GAPS #2 (CSRF origin check in middleware) | none | AO (auth) | not started |
| D5.4 | accounting-integrations-engineer | **[PR-v0.2] Rounding** (decision 3; D2, D3, D20, D18). `planPosting`: rounding = invoice − Σ payment lines (cents); `0 < r ≤ 0.01` → one `rounding` line (Dr rounding / Cr AR; Xero: NoTax credit note to the rounding account, allocated), dated like the last transfer; `r > 0.01` with no person's decision → `blocked` "difference above 0.01: a person decides" (exceptions queue, nothing posts; reading per Q-R1); over that rounds to 0.00 → no line, no decision; overpayment excess → exceptions queue until Q-C5. Tests (exact strings): 999.995, 999.99, 999.989, 1000.004 on a 1,000.00 invoice; 333.333333 + 666.661; 333.333333 + 666.666667 (no rounding line); Σ Dr = Σ Cr in every case | D4.4; Q-R1/Q-R2/Q-R3 answered (else built to the stated defaults) | AO (posting) | not started |
| D5.5 | crypto-protocol-engineer | **[PR-v0.2] Read Ethereum finality** (decision 5; D13): `eth_getBlockByNumber("finalized")` read-only, short cache; a transfer is final when its block ≤ finalized head **and** the block hash at that height still matches; result carried on the observation per ADR 0004; tag unreadable → "unknown", never final; no confirmation count used for this. Tests with recorded responses: below/at/above the finalized head, hash mismatch (reorg), RPC error | D3.4; D2.2 (reorg bug) | AO (changes what is counted as payable) | not started |

### Day 6 · Fri 6 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D6.1 | matching-engine-engineer | Scenario batch 2: the other 10 (wrong network, look-alike, counterfeit, duplicate, no reference) + test | D5.1 | | not started |
| D6.2 | matching-engine-engineer | Wrong-network transfer found live is recorded and flagged (not dropped, gap K5), so it reaches the queue | D4.1 | depends: if it changes what's counted → AO | not started |
| D6.3 | accounting-integrations-engineer | SECURITY_GAPS #6: `xero-tokens.json` written 0600 | none | AO (secrets) | not started |
| D6.4 | accounting-integrations-engineer | **[PR-v0.2] Shortfall** (decision 2; D16): accepted shortfall → credit note to `shortfallAccountCode`, `LineAmountTypes: NoTax`, allocated; **no GST computed or reversed**; flagged for the accountant: invoice history note "Shortfall of X accepted as settled by <person> on <date>. Posted to <code> with no GST. For your accountant to review the GST treatment." + an "accountant review" item in Clearline (per Q-SF2); shortfall account unset/invalid → `blocked`. Tests: 4,950.00 of 5,000.00 accepted → payment 4,950.00 to clearing + credit note 50.00 to the chosen code, NoTax, flag text present; no tax field other than NoTax in the Xero body | D4.4, D5.4 | AO (posting) | not started |

### Day 7 · Sat 7 Nov (integration checkpoint)
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D7.1 | qa-security-engineer | All 20 scenarios run through demo books end to end from a fresh data dir; report: expected vs actual per payment | D5.1, D6.1, D4.1 | | not started |
| D7.2 | tech-lead-architect | Mid-point re-plan: what slipped, what moves, written to the task file and the evening report | D7.1 | | not started |
| D7.3 | accounting-integrations-engineer | **[PR-v0.2] Finality gate in `planPosting`** (decision 5; D13): `confirmations >= threshold` (`rules.ts:110`) replaced by "final per D5.5"; not final → `waiting` "Not final on Ethereum yet (usually about 13 minutes)"; finality unknown → `waiting` "Clearline couldn't check that this payment is final"; posting date stays the block time in the org zone (R2). The confirmation count stays for display only. Tests: final/not final/unknown; a 12-confirmation transfer that is not yet final does **not** post; date unchanged by finality time | D5.5, D2.1 | AO (posting) | not started |

### Day 8 · Sun 8 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D8.1 | frontend-product-engineer + lead-designer | Exceptions queue: one view listing every `needs_review`, flagged, unidentified, `never` and `blocked` item with its reason and a link; derived from existing state (no new store); all 20 scenarios' exceptions appear with the expected reason, **including the v0.2 reasons: difference above 0.01, price off par / unavailable, account not set, overpayment excess (Q-C5)**; accepted shortfalls appear on a separate "for your accountant" list | D7.1, D5.4 | | not started |
| D8.2 | accounting-integrations-engineer | **[PR-v0.2] FX** (decision 4; D17): USD invoice in a non-USD-base org: USD amount at par, **no `CurrencyRate` sent** (Xero's own rate); before posting require USD enabled (`GET /Currencies`) and `BaseCurrency` known (D3.1), else `blocked`; after posting read the Payment back and record Xero's `CurrencyRate` on the posted line and audit; plan text "converted by Xero at its rate for <date>" (Q-FX3). Non-USD invoices stay `blocked`. Tests: SGD-base org body has no `CurrencyRate`; USD not enabled → blocked; base unknown → blocked; read-back rate stored. Demo Company check: confirm Xero applies its rate when `CurrencyRate` is omitted on a Payment (spec doesn't say) — if not, stop and ask Aashmiin | D3.1, D4.4 | AO (posting) | not started |

### Day 9 · Mon 9 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D9.1 | matching-engine-engineer | Explanation pass: each of the 20 has a plain-English reason that matches `team/CLAIMS_REVIEW.md` rules; test asserts key phrases | D7.1 | | not started |
| D9.2 | frontend-product-engineer | Request page shows "Posts as <date> (<org> time)" from the plan, and "Waiting for Ethereum finality" while not final | D3.1, D7.3 | | not started |
| D9.3 | accounting-integrations-engineer | **[PR-v0.2] Depeg check** (decision 4; D4, D4b): a `PriceSource` for the source Aashmiin picks in Q-FX1, price at the block time; \|price − 1.00\| > 0.005 → `blocked` (exception, no posting); exactly 0.005 posts; price unavailable/error → per Q-FX2 (default: exception); the line's `usdRate` is always 1.00 (par) with the peg-check price and source stated separately. Tests: 0.995, 0.994, 1.005, 1.0051, source error | Q-FX1 + Q-FX2 answered; D3.4 | AO (posting) | not started (blocked on Q-FX1) |

### Day 10 · Tue 10 Nov
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D10.1 | devops-engineer | `npm run demo:check` (or a script): env check (no secrets printed), seed scenarios to a fresh data dir, run, print expected-vs-actual; works offline in demo books | D7.1 | | not started |
| D10.2 | qa-security-engineer | Xero verification script (read-only GETs): for each posted line, compare amount (cents), account code and date with the plan; **also: every payment's account is the clearing code and not a bank account; rounding credit notes ≤ 0.01 and only on the rounding code; shortfall credit notes NoTax on the chosen code with the accountant note on the invoice; no record exists for any exception case; Xero's rate recorded where the org is non-USD-base** | D3.1, D4.4 | | not started |

### Day 11 · Wed 11 Nov (first Xero Demo Company run)
| Step | Owner | Acceptance criteria | Depends on | AQ/AO | Status |
|---|---|---|---|---|---|
| D11.1 | qa-security-engineer | Live mode against the Xero Demo Company: import invoices, run 20 scenarios, a person approves the postable ones, verification script all match; never-post and exception cases never posted; result file with sha | D2.1+D3.1+D2.5+D4.4+D5.2+D5.4+D6.4+D5.5+D7.3 merged by Aashmiin (D8.2 too if the Demo Company is not USD-base); D9.3 merged **or** Q-FX2 answered "par in the Demo Company only" (otherwise every plan is an exception and nothing posts); Xero connected; clearing/shortfall/rounding codes set | AQ (her connection; approvals clicked by a named person) | not started |

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
