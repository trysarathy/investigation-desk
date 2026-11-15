# QA + security review, release candidate 4

- **Software:** `rc4/clearline-app` at `2c0f0f0`. Frozen copy `scratchpad/qa4`, made with `git archive`, with `node_modules` hardlinked. One build with `CLEARLINE_CUSTOMER_PREVIEW=1`, served by `next start` on port 3684.
- **Website:** `rc4/clearline-site` at `320c11c`. I built `marketing/` as a static export and served it on 3685.
- **Who and when:** independent QA, 15 Nov 2026. I wrote none of the code under test. Everything ran locally on fictional data.
- **Not trusted:** the code reviews (`CODE_REVIEW_RC4_ACCOUNTING.md`, `CODE_REVIEW_RC4_CONNECT.md`). Every result below is one I saw in this session.

## 1. Verdict

**2c0f0f0 is acceptable for a public fictional-data trial, provided M1 is either fixed or disclosed.**

- **Suites:** the release's own suites are green.
  - tsc: exit 0.
  - vitest ×3: 1783 passed, 57 skipped, identical all three times.
  - Console and journey browser suites: 241 passed, 0 failed, 7 skipped, desktop and iPhone 13.
- **Engine actions:** through the engine's own actions, every accounting invariant I attacked held, and so did every Connect rule.
- **rc3 findings:** all four are fixed. My rc3 DEFECT tests (M1, M1b, L1, L2) pass on 2c0f0f0, and the console M2 dead end is gone.
- **One gap remains: M1.** A crafted stored or posted workspace can still fabricate evidence in two places that load does not re-check:
  - a repayment allocation with no reference;
  - a chain observation marked final below the confirmation threshold.

  The Accounting Bridge then proposes, approves and exports a journal entry for it. This affects only the crafting visitor's own sandbox. But it breaks the stated rule "crafted or forged workspaces cannot export invented amounts", and the "unrelated 20,000 never closes it" invariant, through `POST /actions` and through the console.

## 2. Findings

No Critical or High findings. Each "DEFECT" test asserts the correct behaviour and **fails on 2c0f0f0**.

### Medium

**M1. Load-time validation does not re-check two kinds of evidence. A forged workspace then gets "repaid" or "supplier paid" entries proposed and exported.**

*(a) An unreferenced receipt forged as a repayment.*

- **Steps** (repro: `probes4/m1http.mjs` against `next start`):
  1. Take the sample.
  2. Add an allocation of the **unreferenced** s5 SGD 20,000.00 credit (`stl_00157`) to obligation `obl_00124`, with a matching `repaymentAllocations` row.
  3. Mark its `RC_AMOUNT_ONLY_CANDIDATES` exception resolved.
  4. POST it with these actions, in order:
     - `propose_journal_entries`: 201 `proposals_created`, `jp_00199 JR_REPAYMENT_BY_REFERENCE` Dr bank 2,000,000 / Cr customer_receivable 2,000,000;
     - `approve_journal_proposal` (usr_daniel): 200;
     - `export_journal`: 201, status `exported`.
- **Console** (`console-rc4.spec.ts` › DEFECT M1, desktop and mobile): Treasury & Funding shows the advance as `repaid`.
- **Cause:** `crossCheck` requires a *payment* allocation's line to carry the payout's provider payment id. The load error reads "a payment allocation's statement line must carry the payout's provider payment id as its reference". I checked that this check holds: an unreferenced debit forged onto a payout is refused. No equivalent check exists for a *repayment* allocation against the obligation's reference.

*(b) A chain observation marked final too early.*

- **Steps:**
  1. In the sample, set the s4 observation (6 confirmations, threshold 12) to `status: "final"`.
  2. Add a chain allocation for it.
- **Result:**
  - It loads unchanged.
  - The payout's own settlement stays `pending_finality`.
  - `propose_journal_entries` nevertheless proposes `JR_STABLECOIN_FINAL_TRANSFER` (USDC 6,423.116085), the entry that shows the supplier paid.
- **Note:** a forged observation with `confirmations: 100` is not a finding, because the public API accepts that input anyway. The defect is that load does not re-derive `status` from `confirmations` and the threshold.

**Impact and fix**

- **Impact:** limited to the visitor's own client-held sandbox; no shared state. But the exported file carries `JR_REPAYMENT_BY_REFERENCE` / "supplier paid" for evidence that no engine action can produce, contrary to `ACCOUNTING_BRIDGE.md` §3, which says on load every entry must "re-derive from the evidence records it names".
- **Fix:** on load, re-validate the evidence records themselves:
  - a repayment allocation's line must carry the obligation's reference, mirroring the payment check;
  - a chain observation's `status` must equal `statusFor(confirmations)` against `FINALITY_THRESHOLD`, and an allocated observation must be final.

  Otherwise, document the limit explicitly next to the "approver identity is not authenticated" note.
- **Tests** (`tests/qa-release-rc4/accounting-rc4.test.ts`): › DEFECT M1, › DEFECT M1b, and "holds: an unreferenced bank debit forged into a payout allocation is refused on load" (passes).

### Low / Informational

- **Approver identity is not authenticated (documented).** The caller picks `x-clearline-actor`, so maker ≠ checker is a workflow rule, not an access control. This is stated in `ACCOUNTING_BRIDGE.md` §3, on `/developers` ("Maker-checker here is a workflow rule, not an authentication boundary"), and on every role switch. A test pins it.
- **Sandbox signing secrets are in the client bundle by design.** `.next/static/chunks/8968-*.js` contains `test_whsec_<provider>_public_example` and Connect keyrings such as `test_whsec_cobaltwren_2026a_public_example`. All are `test_` fictional strings; the verifier rejects any non-`test_` key and `signDelivery` throws on one.
- **`poll_provider` with a version the provider never had** returns 200 `no_event_pending` and changes nothing. That is acceptable; a 422 would be clearer.
- **Funding repayment with a superstring reference** (`XRPY-SEABRIGHT-00012`) is correctly not matched (rc3 test passes).
- **The site's disclosure comment says "rc4/clearline-app @ a132340"**, not the release head `2c0f0f0`. This is copy hygiene only.

## 3. What holds (seen this session)

**Accounting bridge** (v1 `POST /actions`, `probes4/acct.mjs`: 37 pass, 0 fail; vitest 26 of 28)
- **Balance:** all 5 sample entries are balanced per currency.
- **No entry without independent evidence:** no entries are proposed for:
  - s3 hold;
  - s4 pending chain;
  - the unrelated SGD 20,000 receipt;
  - a provider completion only;
  - a provider settlement report.
- **Returned or failed payouts:** s2 returned uses `JR_PAYOUT_DEBIT_NOT_DELIVERED` / `RETURN_CREDIT`; nothing ever debits `supplier_payable`.
- **Return after posting:** s1 posted, then `payout.returned`:
  - the reversal cannot be rejected (`REVERSAL_REQUIRED`);
  - the rebooking cannot be approved first;
  - once both are posted, the net `supplier_payable` is 0.
- **Stablecoin:** one `JR_STABLECOIN_FINAL_TRANSFER` clears the payable once, by the transfer amount. Re-proposing adds nothing.
- **Maker ≠ checker:**
  - approve: proposer, operator, compliance and viewer are refused; another approver succeeds;
  - withdraw-exported and confirm-not-imported: the exporter is refused (maya and daniel both tried) and operators are refused; `usr_lin` succeeds.
- **"Posted" only via `record_posting`:**
  - refused before export (`NOT_EXPORTED`);
  - refused twice;
  - a posted entry cannot be rejected;
  - 7 malicious external references refused: `=…`, `+1`, `<script>`, a space, too short, too long, and CRLF.
- **Periods:**
  - close is refused while entries are pending, and refused for operators;
  - a closed period refuses `propose`;
  - an overlapping period is refused;
  - bad names and dates are refused (HTML, `=1+1`, `to ≤ from`, 2026-02-30).
- **Unmapped roles:** `UNMAPPED_ACCOUNT_ROLE` on approve. These mappings are refused: duplicate codes, `=cmd`, HTML names, unknown roles. A mapping change supersedes an approval.
- **Exports:** byte-identical CSV/JSON and the same `documentId` across copies. A recorded export re-renders from its record.
- **CSV injection:** these are prefixed with `'`:
  - a `+SUM(A1)` account name;
  - `=HYPERLINK`, `+SUM`, `-1+1`, `@cmd` and tab-led statement references in the reconciliation CSV.
- **Forged workspaces refused on load** (apart from M1):
  - an invented amount on a proposed entry (superseded);
  - an exported entry with +1 minor unit;
  - an approval by the proposer, by a viewer, or by an unknown id;
  - "posted" without an export;
  - a forged s4 transfer entry;
  - duplicate account codes, overlapping periods, a pending entry in a closed period, an export naming an unknown entry.
- **Reset:** a per-case reset after an export is refused.

**Connect** (vitest: 9 of 9; v1 HTTP `probes4/connect-http.mjs`)
- **Tampered or replayed webhooks:**
  - a body changed by 1 byte is `rejected_signature` and not applied (engine and HTTP);
  - a replay within the window is `duplicate_ignored`; a replay outside 300 s is rejected;
  - an attacker-chosen `test_` key is rejected; a non-`test_` key throws.
- **Unverified scheme (Saltglass):** a forged "final" body through `ingest_webhook` is `rejected_signature`, with no chain observation and no verified settlement. Through `receiveConnectWebhook`, the forged body is never recorded.
- **Header bundles:** oversize, more than 16 headers, upper-case names, non-string values, no prefix and `[]` are all rejected. A duplicate key still needs a valid signature.
- **Polls:**
  - versions 999, -1, 1.5 and NaN apply nothing;
  - polling a non-Connect payout gives 422.
- **Claims never verify settlement:** no provider claim set settlement to verified across 6 scripts (success, presumed_only, internal_ledger, claims_conflict, clawback). Preliminary hashes never become chain observations.
- **Arrival order:** `delivered → bounced` gives the same outcome in reverse order; it ends `failed`, never verified.

**Journey, scenarios, reset**
- The existing browser suites passed on desktop and iPhone 13: 241 passed, 7 skipped (desktop-only checks), 0 failed. They include:
  - the founder rc4 18-step journey;
  - the 20-step journey;
  - five-scenario data;
  - per-case reset;
  - acceptance (1%, 50%, second approval, late date, FX never);
  - reopen;
  - accounting screens;
  - my rc3 QA spec.

**Security**
- **Allow-list:** of 77 built routes, 23 return 200 (console, docs, accounting, audit, v1 health, mentor-demo), 9 return 308 same-origin, `/` returns 307, the legacy test route returns 410, and the remaining 43 return 404. Encoded and dotted bypasses return 404. No open redirect. Server-action POST returns 404.
- **Headers:** exactly one CSP per response; a nonce plus `'strict-dynamic'` on pages; X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy everywhere; no X-Powered-By. `/clearline/accounting`: 21 of 21 scripts carry the nonce.
- **L3 body limits:**

  | Request | Status | Received before cut-off | RSS growth |
  |---|---|---|---|
  | 20 MB chunked | 422 + `Connection: close` | 7.1 MB | +0.0 MB |
  | 50 MB chunked | 422 | 5.2 MB | +0.0 MB |
  | Declared 20 MB | 422 | 0 MB | — |
  | 20 MB to a page | 200 | whole body | +12.7 MB (documented residual) |

- **Deployment-config check:** these 9 bad configurations are refused:
  - `"true"` as the preview mode value;
  - both modes set;
  - a short password;
  - `PREVIEW_*` set together with preview mode;
  - Xero secret in preview;
  - `DEMO_MODE=false`;
  - `QBO_ENV=production`;
  - an `http:` product URL.

  The secret value was echoed 0 times. The rc4 preview-branch environment loads.
- **XSS:** every text input on Accounting, Exports, Setup and Audit, plus URL parameters, at both viewports: nothing executed and nothing was injected. Crafted HTML mapping and period names render as text. A forged approval is not shown as approved.
- **Overflow and accessibility:** no overflow at 1440, 768, 390 or 320 on 7 rc4 pages, and 0 axe violations at 1440 and 320.

**Website (320c11c)**
- `next build`: exit 0. `node --test`: **53 of 53**, with the repository's `docs/` and `src/` present.
- 12 pages at 1440, 768, 390 and 320: no overflow and 0 page errors. axe at 1440 and 320: 0 violations.
- Links: every internal link and anchor returns 200; the 5 product links return 200 on the local console. `/replay` forwards to `/trial` by design.
- No forbidden claims:
  - posting is always "sandbox posting rules … Clearline posts nothing";
  - no "approved rules", "live providers", competitor comparisons, customer counts or licences;
  - "Clearline has no customers yet".
- Founder facts are the same as at rc3 and consistent across pages and with `company/PRODUCT_FACTS.md`. I have no independent source for her age, year or second major.
- Every works-today item is demonstrable:
  - Accounting, Audit and Acceptance: through the passing journey and accounting browser specs plus my API probes;
  - Connect adapters: described as "engine and tests only", which matches (`/clearline/connect` redirects to routes).
- The rc3 claim "an exception with an owner" is corrected to "a person assigns its owner".

## 4. Commands and counts (2c0f0f0)

| Check | Result |
|---|---|
| `CLEARLINE_CUSTOMER_PREVIEW=1 npx next build` | exit 0 (`.next/cache` deleted after the build to save disk) |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` ×3 (excluding my folder) | 87 files passed, 1 skipped; **1783 passed, 57 skipped**; 3 of 3 identical (33.8 s, 40.9 s, 52.2 s) |
| `npx vitest run tests/qa-release-rc3` (my rc3 tests, as imported) | 17 of 17 pass (rc3 M1, L1 and L2 fixed) |
| `npx playwright test -c playwright.qa4.config.ts --retries=0` (existing `clearline-*.spec.ts`, port 3684) | **241 passed, 7 skipped, 0 failed** (4.7 min) |
| `npx vitest run tests/qa-release-rc4` | **28 tests: 26 passed, 2 failed** (DEFECT M1, M1b) |
| `npx playwright test -c playwright.qa4-new.config.ts` (`console-rc4.spec.ts`, desktop + iPhone 13) | **10 tests: 8 passed, 2 failed** (DEFECT M1 ×2) |
| API probes `probes4/acct.mjs`, `connect-http.mjs`, `m1http.mjs`; `probes3/body.mjs` | acct: 37 pass, 0 fail. connect-http: 4 pass, plus 2 results my probe expected wrongly (version 99 → `no_event_pending`; `pi_00001` was the Connect payout itself) |
| Website `npx next build` / `node --test` | exit 0 / 53 of 53 |

**Cleanup:**
- Stopped my own processes only: next-server 29880, its launcher 29863, and static server 10340. I checked each process's working directory first and did not use `pkill -f next-server`.
- Deleted the `qa4` copy (`.next` and `node_modules`), `site4`, and earlier my leftover `site3`.
- Kept `scratchpad/qa4/tests/qa-release-rc4/` and `scratchpad/qa4/playwright.qa4-new.config.ts`.
- Nothing under `/home/user/rel/*` was edited. Nothing was committed or pushed.

## 5. Files
- `scratchpad/qa4/tests/qa-release-rc4/accounting-rc4.test.ts`: 19 tests (2 DEFECT).
- `scratchpad/qa4/tests/qa-release-rc4/connect-rc4.test.ts`: 9 tests.
- `scratchpad/qa4/tests/qa-release-rc4/console-rc4.spec.ts`: 5 tests per viewport (1 DEFECT). It needs `next start` with `CLEARLINE_CUSTOMER_PREVIEW=1` on 3684, and `QA_AXE_PATH` for the axe test.
- `scratchpad/qa4/playwright.qa4-new.config.ts`: scratch config (`testDir ./tests/qa-release-rc4`).
- `scratchpad/probes4/*`: API probe scripts.
