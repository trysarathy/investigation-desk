# QA + security review, release candidate 3

- **Software:** `rc3/clearline-app` at `3e66fa7`, frozen copy `scratchpad/qa3` (`git archive`), built with `CLEARLINE_CUSTOMER_PREVIEW=1` and served by `next start` on port 3684.
- **Reopen path only:** re-tested on `dc9e44f` (engine merge `7151ebf`), as the coordinator asked.
- **Website:** `rc3/clearline-site` at `665f267`. I built `marketing/` as a static export and served it on 3685.
- **Who and when:** independent QA, 14 Nov 2026. I wrote none of the code under test. Everything was local and all data was fictional.
- **Not trusted:** the conclusions of `QA_SECURITY_REVIEW_V2.md`, `SECURITY_PLATFORM_RC3.md` and `CODE_REVIEW_RC3_*.md`. Every result below is one I saw in this session.

## 1. Verdict

**3e66fa7 is not ready for a public fictional-data trial.**

Two things stop it:

1. **The release's own browser suite fails.** `clearline-journey.spec.ts:1210` fails at both desktop and iPhone 13 (2 failed, 154 passed, 6 skipped). The engine change in `0a746b1` now lets one person accept a 5% over-amount, but the console and its test still assume 1%. See M2.
2. **A visitor can break their own workspace with normal clicks.** Accepting an over-amount and then pressing Reopen leaves a workspace the engine refuses to load. Every action gate then reads "This workspace cannot be loaded … Reset to the sample". See M1.

**On dc9e44f, M1 is fixed:** my M1 and M1b tests pass there. **M2 is not touched by that fix** (console scope). It still needs either:
- a console path for `approve_acceptance`, or
- a console gate that limits one person to 1%,

and in either case an updated browser test.

With M2 fixed on top of dc9e44f, nothing I found counts money wrongly, shows unevidenced settlement as verified through the engine's own actions, releases a hold, or exposes secrets or data. **I have not re-run the full suites on dc9e44f.** That is required before sign-off.

## 2. Findings by severity

No Critical or High findings. Each "DEFECT" test asserts the correct behaviour and **fails on 3e66fa7**.

### Medium

**M1. Reopen after an accepted difference makes the workspace unloadable.** Fixed in dc9e44f.

- **Where:** `src/lib/clearline/actions.ts` `reopen()` (lines 733–749) sets `status: "reopened"` but keeps `resolution.acceptedDifference`. `serialize.ts` `crossCheck` then requires that `acceptedDifference` belong to a *resolved* exception, so it refuses the workspace on the next load. `applyAction` validates its input but not its output, so the reopen itself returns 200 `applied`.
- **Repro through the API** (`probes3/accept.mjs`):
  1. Run a 5% over-amount debit, then `resolve` with `acceptDifference`, then `approve_acceptance` (usr_sam). Then `reopen`: 200 `applied`.
  2. The next action on the returned workspace gives 422 `invalid_field`: "exceptions[4].resolution.acceptedDifference: must belong to a resolved … exception … No version of the engine produces this". That message is false, because the engine just produced it.
- **Repro in the console** (`console-rc3.spec.ts` › DEFECT M1, desktop and mobile):
  1. Accept a 0.5% over-amount, then Reopen: "Reopen — recorded by the engine (Done)".
  2. Every action gate on the page then shows "This workspace cannot be loaded …". The person's only way out is a full reset.
- **Impact:** a visitor loses their sandbox state. No money or evidence is misreported.
- **Fix:** reopen should undo the resolution's effects. dc9e44f does this ("reopen now withdraws the acceptance"). Also validate `applyAction`'s output in tests, so that any action producing an unloadable workspace fails.
- **Tests:**
  - `tests/qa-release-rc3/engine-rc3.test.ts` › DEFECT M1 and M1b: fail on 3e66fa7, **pass on dc9e44f**.
  - `console-rc3.spec.ts` › DEFECT M1: fails on 3e66fa7. Not run on dc9e44f.

**M2. The console lets one person accept a 1–50% over-amount, then offers no way to complete it. The release's own browser test is red.**

- **Where:** `src/components/clearline/AcceptDifference.tsx`.
  - The hint says "Only a small over-amount (up to 1%)", but the gate is the engine's dry run. Since `0a746b1` that dry run accepts up to 50%, flagged `secondApproval.required`.
  - No console component dispatches `approve_acceptance`, and none offers `acceptLateDate`. `grep -rn approve_acceptance src/components src/app` finds nothing.
- **Repro** (`console-rc3.spec.ts` › DEFECT M2, desktop and mobile):
  1. Create a payout and complete it, then ingest a debit at 105%.
  2. Assign an owner, attach evidence, and click "Accept the over-amount". It is enabled, and the click is applied.
  3. On the payment page the case gate shows SECOND_APPROVAL_REQUIRED, and there is no approve control.
  4. The only way forward in the console is Reopen. On 3e66fa7 that then triggers M1.
- **Release gate:** the existing `clearline-journey.spec.ts:1210` ("a larger one is refused in the engine's words") fails at `toBeDisabled()` in both projects.
- **Impact:** the case cannot be closed in the console. The page text contradicts the engine ("up to 1%"). The suite is red.
- **Fix, either of:**
  - add an "Approve the acceptance" step, shown to a different staff role and gated by the engine dry run, plus a late-date acceptance kind;
  - or keep the console at 1%, gated on the engine's `needsSecondApproval`.

  Then update the hint and the `:1210` test.

### Low

**L1. A crafted stored or posted workspace can claim verified + matched with no final evidence, and its case closes.**

- **Repro** (`probes3/forge2.mjs`, and `engine-rc3.test.ts` › DEFECT L1):
  1. In the sample, set `pi_00090` (s4, its only observation `pending_finality`) to `verified`/`matched`.
  2. Mark its case's exceptions resolved, then POST `/actions` `resolve` case.
  3. Result: 200 `applied`. The case is resolved, and the investigation reports verified with 0 contradictions. `migrations` is `[]`.
- **Why:** `migrateToRc3` covers only the four v2 patterns (A–D). `canResolveCase` trusts the stored `status`. The migrate.ts header says "the stored EVIDENCE is re-validated against rc3's rules", which overstates it.
- **Impact:** limited to the attacker's own stateless sandbox, but it breaks "nothing closes without evidence" for a posted workspace.
- **Fix:** on load, recompute each intent's dimensions from evidence (`recomputeDimensions` on a copy). Refuse or downgrade any settlement or reconciliation that the evidence does not support.

**L2. `crossCheck` checks the shape of maker–checker and hold decisions, not who made them.**

- **What it accepts** (`engine-rc3.test.ts` › DEFECT L2; API repro in `probes3/forge.mjs`):
  - a hold `released` with a `release` decision by `usr_maya` (operator), or by no actor at all;
  - a funding decision whose checker is `usr_alex` (viewer);
  - an instruction whose checker `usr_nobody` does not exist.
- **Contrast:** its doc says "a hold is released … only with a matching reviewer decision".
- **Same class:** a forged `secondApproval.approvedBy: "usr_sam"` lets a case close (probe). That forgery cannot be detected without server state, so this is Informational.
- **Fix:** require each decision's actor to exist and to have the required role (the hold's `reviewerId`, approver, a staff member other than the maker), or say plainly in the docs that client-held state is trusted.

**L3. Website claim: "anything else becomes an exception with an owner and a due date".**

- New exceptions are created **unassigned**. Two of the four sample exceptions (`exc_00114`, `exc_00160`) have no owner, and the console shows "Unassigned — operations should assign".
- Due dates are set.
- **Fix:** the copy owner should change it to something like "an exception with a due date, which a person assigns to an owner" (`marketing/lib/disclosure.ts`, `app/control/page.tsx`).

**L4. axe `region` (moderate) on `/mentor-demo`.** One node, at 1440 and at iPhone 13. All 17 other console pages: 0 axe violations and no horizontal overflow at both sizes.

### Informational

- **Sandbox webhook secrets are in the client bundle.** `.next/static/chunks/4780-*.js` builds `test_whsec_<provider>_public_example` by design. Anyone can sign sandbox webhooks, which is acceptable only because nothing is real.
- **`ANTHROPIC_API_KEY` is not refused in preview mode.** The AI routes are 404 there, so it is not reachable.
- **No HSTS header.** Vercel's `*.vercel.app` is HSTS-preloaded.
- **Repayment reference matching.** A second identical 10,000 credit (lower-case reference) becomes `RC_DUPLICATE_SUSPECTED` and is not counted. A 25,000 credit on a 20,000 balance raises `RC_OVERPAYMENT` and is not applied. Both are conservative.
- **Stale finality exception.** After a final observation, `CH_BELOW_FINALITY_THRESHOLD` stays open until a person resolves it, while settlement shows verified.
- **Process note.** When stopping my servers I ran `pkill -f next-server`. That would also have stopped any other agent's `next-server` on this machine. I could not tell afterwards whether one was running, so please check the other sessions' servers.

## 3. What holds (seen this session)

**Money**
- `amountMinor` values 1.5, 0.1+0.2, 2^53, -100, 0, NaN, null, "1000" and 1e21 are all refused with 422.

**Three truths and returns**
- Provider completion leaves settlement `none`.
- A provider settlement report gives `observed` / `provider_report` only.
- A referenced bank debit gives `verified`/`matched`.
- s2: `RT_NET_ZERO`, `beneficiaryPaid: false`, settlement `contradicted`, never verified.

**Allocation**
- An amount-only line is `RC_AMOUNT_ONLY_CANDIDATES` and is not allocated.
- Two same-amount payouts keep both candidates.
- A duplicate line gets 409.
- A second referenced debit is `RC_DUPLICATE_SUSPECTED`, and the allocated total stays 10,000.00.

**Stablecoin**
- Final at 12 confirmations gives verified.
- A reorg after final gives `contradicted` / `exception`.
- Chain 1, a counterfeit contract, symbol `usdc` and network `base` are not counted.
- Short amount and other recipient raise exceptions.
- Chain evidence on a fiat payout gets 422.

**Funding**
- The sample is 50,000 / 30,000 / 20,000.
- These leave it `partly_repaid`: an unrelated 20,000 credit, a USD credit, a superstring reference, and a provider-report credit (422).
- The referenced 20,000 credit gives `repaid`.

**Maker ≠ checker**
- Instruction self-approval gets 403.
- Funding decisions: maker gets 403; operator, viewer and compliance get 403; approver gets 201.
- `approve_acceptance`:
  - the accepter gets 403 `maker_checker_violation`;
  - a viewer, an unknown id and an empty note are refused;
  - a repeat gets 409;
  - the case is SECOND_APPROVAL_REQUIRED until approved.
- Accepting never upgrades settlement.
- Refused acceptances: over 50%, provider reports, credits, before-submission dates, more than 60 days late, and currency mismatch.

**Holds**
- Advancing the clock to 2027-12-31 leaves the hold open.
- Release by maya, daniel or alex gets 403.
- priya gets 422 until documents are submitted.

**Route access (customer preview)**
- **74 built routes:** 20 return 200 (console, docs, v1 health, mentor-demo, icon), 9 return 308 to same-origin console paths, 1 returns 307 (`/` to `/clearline`), and the legacy test route returns 410. The other 43 legacy routes return 404, POSTs included.
- **29 bypass paths** (encoded, dotted, case-changed, `//evil.example`, `/_next/..`, `.env`, `.git`) returned 404, except: 401 JSON for `v1/health.json`, 400 for `_next/image` with an external URL, and same-origin 308s.
- No open redirect: query strings and `//` stay on localhost.
- A server-action POST gets 404.

**Headers and CSP**
- One CSP header per response. Console pages use a nonce plus `'strict-dynamic'`; API, 404 and static responses use the static policy.
- `X-Frame-Options DENY`, nosniff, Referrer-Policy and Permissions-Policy are on every kind checked. No `X-Powered-By`.
- `/clearline`: 18 of 18 `<script>` tags carry the nonce.
- A client-sent `x-nonce` is ignored, and an HTML-injection attempt in that header is not reflected.

**L3 body limits** (RSS of the live server)

| Request | Status | Received before cut-off | RSS growth |
|---|---|---|---|
| 20 MB chunked to `v1/liquidity` | 422 + `Connection: close` | 3.8 MB | +0.0 MB |
| 50 MB chunked to `v1/actions` | 422 | 3.8 MB | +1.1 MB |
| 600 KB | 422 | — | — |
| Declared 20 MB `Content-Length` | 422 | 0 MB | — |
| Legacy route | 422 | 3.8 MB | — |
| 20 MB to `/clearline` page | 200 | whole body | +16.9 MB (residual risk 1 in the platform doc) |
| `v1/%2e/liquidity` | 422 | whole body (goes through the middleware's 64 KB copy, then invalid JSON) | — |

**Deployment configuration check**
- 13 bad combinations refused, with no secret value echoed: `"true"` and `" 1"` mode values, both modes set, a single `PREVIEW_*` variable, a short password, `PREVIEW_*` together with preview mode, Xero secret in preview, `DEMO_MODE` false/FALSE/0, `QBO_ENV=production`, and `javascript:` or `http:` product URLs.
- `QBO_ENV=Production` loads, which is consistent because the adapter compares with `=== "production"`.

**Workspace attack surface**
- Refused: depth 5,000 and 100,000; `seq` 1e300; an amount of `MAX_SAFE_INTEGER`; `schemaVersion` 0; `fictional: false`; unknown action; clock backwards; actor `system`.
- Handled without harm: a 400 KB label and a `__proto__` key, with no pollution.
- In the console (7 crafted stored values × 2 viewports, plus an HTML actor name): no page error, no dialog, no "Application error", no injected element.

**XSS**
- Payloads went into 5 URL-parameter sets and every text field on 5 form pages, with every form submitted, at both viewports. Nothing executed and no element was injected.
- Inputs refuse `=`, `@` and HTML in names, references and purpose.
- The one accepted formula-leading text, a `+…` beneficiary name, is exported as `'+…` in the case report CSV (test).

**Secrets**
- 171 client static files scanned for key and token patterns. The only hit is the public sandbox webhook secret described above.

**Five scenarios**
- The existing `clearline-journey.spec.ts` (founder acceptance journey: all 20 steps, per-case reset, refusal reasons, returned payout facts, role labels, error handling, slow-network navigation) and `clearline-console.spec.ts` passed, desktop 1440×900 and iPhone 13, except `:1210` (M2).
- My API probes reproduced each scenario's original data: s1 verified/matched; s2 returned, net zero, unpaid; s3 on_hold with hold open and reviewer priya; s4 pending_finality at 6 confirmations; s5 50k/30k/20k.

**Website** (665f267)
- `node --test`: 44 of 44 pass, with the repository's `docs/` and `src/` present. With `marketing/` alone, 8 fail on a missing file, which is an environment issue.
- `next build`: exit 0.
- 12 pages at 1440, 768, 390 and 320: 0 horizontal overflow and 0 page errors.
- axe at 1440 and 320: 0 violations.
- Links: every internal link and anchor returns 200. The 5 product URLs return 200 on the local console. `/replay` forwards to `/trial` by design. LinkedIn was not fetched (external).
- No forbidden claims: no Xero/QuickBooks posting, customer counts, licensing, guarantees or "live" claims. "No customers" matches `company/PRODUCT_FACTS.md`.
- Founder facts match across home and about (Aashmiin Kaur, Singapore, the SMU email in `lib/site.ts`). I have no independent source in the repository for age, year and second major; they match the site's own tests.
- Works-today list: every item was demonstrated, except the "with an owner" wording (L3). The demonstrations covered:
  - idempotent replay, and 409 on the same key with a different body;
  - 3 providers with ineligible routes and their reasons;
  - duplicate, bad-signature and contradictory events;
  - 12-confirmation finality;
  - OpenAPI 3.1;
  - roles, reset, case report and filters, through the journey suite.

## 4. Commands and counts

| Check | Result |
|---|---|
| `CLEARLINE_CUSTOMER_PREVIEW=1 npx next build` (qa3) | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` ×3 | 70 files passed, 1 skipped; **1406 passed, 57 skipped**; 3 of 3 identical (28.1 s, 21.4 s, 20.2 s) |
| `npx playwright test -c playwright.qa3.config.ts --retries=0` (existing console + journey suites, port 3684) | **154 passed, 2 failed (`journey:1210` desktop and mobile), 6 skipped** |
| `npx vitest run tests/qa-release-rc3` on 3e66fa7 | 17 tests: **13 passed, 4 failed** (the 4 DEFECTs: M1, M1b, L1, L2) |
| Same file on dc9e44f (src/lib + tests only) | **15 passed, 2 failed** (L1, L2; M1 and M1b fixed) |
| `console-rc3.spec.ts` (`playwright.qa3-new.config.ts`, desktop + iPhone 13) | First full run: crafted-storage ×8 and HTML-actor tests passed (16); axe failed only on `/mentor-demo` region (L4); XSS timed out. After fixes, XSS passed ×2; DEFECT M1 and M2 fail ×2 each, as expected |
| API probes (`probes3/api.mjs`, `api2.mjs`, `accept.mjs`, `forge.mjs`, `forge2.mjs`, `claims.mjs`, `body.mjs`) | api.mjs: 30 pass, 1 harness fail (wrong actor, re-run in api2.mjs: maker-checker holds) |
| Website `npx next build` / `node --test` | exit 0 / 44 of 44 |

**To reproduce my console tests:** start `next start` on 3684 with `CLEARLINE_CUSTOMER_PREVIEW=1`, then run
`QA_AXE_PATH=<axe.min.js> npx playwright test -c playwright.qa3-new.config.ts`.
That config sets `testDir ./tests/qa-release-rc3` and the local Chromium.

**Cleanup:**
- All servers I started (3684, 3685) are stopped (see the process note above).
- Deleted: `qa3/.next`, `qa3/node_modules`, the marketing `node_modules` and `.next`, and the dc9e44f copy.
- Nothing under `/home/user/rel/*` was edited. Nothing was committed or pushed.

## 5. Files written
- `scratchpad/qa3/tests/qa-release-rc3/engine-rc3.test.ts`: 17 tests (4 DEFECT).
- `scratchpad/qa3/tests/qa-release-rc3/console-rc3.spec.ts`: 13 tests per viewport (2 DEFECT).
- `scratchpad/qa3/playwright.qa3.config.ts` and `scratchpad/qa3/playwright.qa3-new.config.ts`: scratch configs.
- `scratchpad/probes3/*`: probe scripts and the website probe.
