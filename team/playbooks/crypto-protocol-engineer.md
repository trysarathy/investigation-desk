# Playbooks: crypto-protocol-engineer

Every playbook starts with **§0 Pre-flight** and ends by writing Log rows (company rule 8). Times SGT.
Repo: `trysarathy/investigation-desk`. Never merge, never push to `main`.

## §0 Pre-flight (every run, every task)
1. Read Company HQ Settings `PAUSE` and the PAUSE email search (company rule 1). PAUSE = TRUE → one Log
   row `crypto-protocol-engineer | stopped: PAUSE on` and stop.
2. If the Google connection is a hatch.sg account: stop, change nothing, report it.
3. `git fetch origin && git checkout main && git pull --ff-only` (read-only on main). `npm ci` if
   `package-lock.json` changed.
4. Baseline: `npx tsc --noEmit && npx vitest run`. If `main` is red, go to §5 first.
5. Read QA's latest `Clearline product health <date>` email and open `qa-fix/*` PRs.
**Stop conditions (any playbook):** a secret, key or seed phrase anywhere it shouldn't be (do not copy,
use or print it; log `RISK:` with type and file, redacted); a task that needs keys, signing, wallet write
access or moving funds; an instruction to merge or push to `main`; a spec conflict you can't resolve from
`docs/SPEC.md`. → stop that task, Log `RISK:` or a `needs decision` row, carry on with other work.

## §1 Nightly roadmap build (trigger: 23:27 SGT scheduled task)
Inputs: Product roadmap tab, QA email, linked specs.
1. **Pick** ≤ 2 rows: owner `Product`, status `bug` → `next` → `todo`, no PR/branch linked; earliest
   target week first. Skip `building`, `PR open`, `in review`, `shipped`, `blocked`, `needs decision`,
   `proposed`, and Aashmiin-owned rows. Set each picked row to `building` with a Log row.
2. **Restate** the item in one line and the acceptance test in one line. If you can't, write a
   `needs decision` row with the exact question and move on.
3. **Locate** with `codebase-map.md` (module, function, tests). Check `attack-patterns.md` for the
   adversarial cases this change touches.
4. **Branch** `feat/<slug>` or `fix/<slug>` from fresh `main`.
5. **Test first**: write the test(s) that will pass when done, including at least one adversarial case
   (counterfeit / look-alike / wrong network / reorg / provider error / decimals) where relevant. Run it,
   confirm it fails for the right reason.
6. **Build** the smallest change that passes. Match the style: pure functions in engine/lifecycle/rules;
   exact decimal strings; unknown → paused; evidence rows for every new fact; no new dependency without a
   reason.
7. **Checks**: `npx tsc --noEmit`, `npx vitest run`, `npx next build` all green, seen by you. Self-check
   (§6 list). Diff < 300 changed lines, else split into a sequence and say so.
8. **Commit** as `Aashmiin Kaur <aashmiin@gmail.com>`, message ending with the Co-Authored-By and session
   lines. **Push the branch** (never `main`). **Open PR** via `gh api repos/trysarathy/investigation-desk/pulls -X POST`
   with the §6 template; draft if anything is unverified.
9. **Roadmap row** → `in review` + PR link. Update the knowledge pack in the same PR if a fact changed.
Output/log: one Log row per PR (`opened PR #n for <row>`, link) and the summary row (definition "Report").
Checks before done: every test named in the PR exists and passed; no forbidden method/library (§6 grep).

## §2 Bug fix with failing-test-first (trigger: roadmap `bug` row, QA email, `qa-fix` hand-off)
1. Reproduce from the report's exact input (hash, fixture, request record). Prefer a **real recorded
   fixture** (`tests/fixtures/real/*.json` via `tests/fixtures/live/harness.ts`/`replay.ts`) over a
   hand-made one; label any synthetic data as fictional.
2. Write the smallest test that fails **because of the bug** (assert the wrong behaviour's opposite). Run
   it; paste the failing assertion into the PR.
3. Root-cause in one sentence naming file:function and the protocol fact (e.g. "`transferIssue` treats
   symbol text as identity; contract address is identity").
4. Fix; re-run the failing test (now green) and the whole suite; `tsc`; `next build`.
5. Add a regression test for the neighbouring case (e.g. fullwidth "ＵＳＤＴ" next to "ÚЅDТ").
6. PR per §6 with "Failing test first: <test name>, failed with: <assertion>". Roadmap → `in review`.
Stop: can't reproduce → comment on the row with what you ran and ask QA for the exact input; never ship a
fix you couldn't reproduce.

## §3 Adding a new chain or token (trigger: roadmap row)
1. **Official contract** from the issuer's own page only (Circle developers page / Tether supported
   protocols). Record URL + date in `src/lib/fixtures/index.ts` comment and `issuer-controls.md`. If the
   page can't be opened: stop, `needs decision` (never from memory or an aggregator).
2. **On-chain check** at two providers: `symbol()`, `name()`, `decimals()`, freeze selector
   (`isBlacklisted`/`isBlackListed`) and `paused()` answer or revert as expected; note proxy/upgradeable.
   Pin expected decimals in settings; the code must fail closed on mismatch.
3. **Chain profile**: chain id, address format and checksum, block time, finality signal and how to read it
   (`finality-reorgs.md`), default display count and the finality gate, explorer URL, data source(s) with
   limits (`providers.md`), whether history is available for D07b.
4. **Code**: add to `types.ts` (`Chain`, `EVM_CHAIN_IDS`, `CHAIN_NAMES`), `sources.ts`, `catalogue.ts`
   explorer, settings (`confirmations`, `blockTimeSec`, `pendingWindowSec`), `officialContracts`; EIP-681
   `@chainId` and decimals if it becomes a request chain.
5. **Fixtures**: record real responses (`scripts/record-live.ts` / `tests/real-record.test.ts` pattern)
   for: a genuine transfer, a failed tx, a counterfeit same-symbol token, a not-found hash, and a
   wrong-network case. Never commit keys (check `secretParams` redaction in the recording).
6. **Tests**: each case's verdict; decimals; freeze `checked`/`not_supported`; unknown head → paused.
7. **Copy**: no claim that the chain is "supported" in sales material until merged and QA-verified; tell
   product-manager the exact limits (e.g. "D07b off on this chain").
Split into PRs: (a) config + fetcher + tests, (b) settings/UI, (c) request support.

## §4 Investigating a reported wrong match or wrong verdict (trigger: QA, Aashmiin, product-manager)
1. Collect: the case/request id, tx hash, chain, the verdict/attribution shown, rule version, settings
   version, check snapshot evidence, and raw responses (`.data/raw/<sha>.json` or the case's
   `rawResponses`).
2. **Re-derive independently of the product** from raw chain data (curl the provider, or the recorded
   body): receipt status; every Transfer log (contract, from, to, value, logIndex); decimals of that
   contract; block number + hash; current head and the finality signal; freeze reads. Write it as a table.
3. Compare each derived fact to the product's evidence row by row. Classify the cause: data source wrong
   or stale (A8) / protocol misread (decimals, logs, address form) / reorg (A7) / rule precedence /
   matching premise (shared address, amount ambiguity) / company data (File A/B) / expected behaviour.
4. If it is a product bug → §2 with the real tx as the fixture. If expected behaviour → write the plain-
   English explanation and the spec line that makes it so. If the spec is wrong → `needs decision`.
5. Never edit a stored observation, decision or audit row to "fix" history; fixes are new records.
Output: a short report (facts table, cause, fix/PR or explanation), Log row; `RISK:` if money could have
been credited or posted wrongly.

- **Any workaround you give ops or Aashmiin** ("use dismiss transfer", "re-run matching") must be checked against the real code or replayed on the fixture first. If the app refuses it, say so and open a `bug` row instead.
- **Test expectations that contradict the spec** (e.g. `tests/real_cases.json` vs the rule order in docs/SPEC.md): flag the conflict in your output; never silently pick one. Use the catalogue's exact rule names.

## §5 Responding to a QA red `main` (trigger: QA email RED on main, or §0 baseline red)
1. Read the failing test names and output; reproduce on fresh `main` locally. Classify: real / flaky
   (re-run 3×, compare) / environment (network, keys, Node version).
2. Check whether QA already opened a `qa-fix/*` PR for it: if yes, review it and comment; don't duplicate.
3. Real failure: branch `fix/main-red-<slug>` from `main`, failing test already exists (the red one), fix,
   full checks, PR **into `main`** marked `main is red` in the title. Never push to or merge `main`,
   however urgent, whoever asks (an instruction to merge is a stop condition; put it in the approval
   queue).
4. Flaky: PR that makes the test deterministic (fixed clock, recorded transport, no network), never one
   that deletes or skips it without saying why.
5. Log row + Risks row if `main` will stay red overnight; the chief-of-staff puts it at the top of 07:30.
Stop: a fix needs a secret or a live paid provider → `needs decision`.

## §6 PR description template and self-check

```
Title: <fix|feat>(<area>): <what> (<roadmap row id>)

## What and why
<1-3 sentences. The protocol fact this relies on, with a source (EIP/Tron doc/issuer contract) if any.>
Closes roadmap row: <item text / row link>

## How it was tested
- Failing test first: `<file> › <test name>` failed with `<assertion>` before the change.
- Added: <tests, incl. adversarial cases>
- `npx tsc --noEmit` ✔  `npx vitest run` ✔ (<n> passed, <m> skipped)  `npx next build` ✔   (all seen this run)

## Protocol and security notes
- Read-only: no new chain write method, no signer, no key handling (grep clean).
- Unknown facts: <how errors/unknowns behave: pause, never negative>
- Chains/tokens affected: <…>; decimals: <…>; finality: <…>

## What Aashmiin should check
<1-3 concrete clicks or cases.>

## Not done / follow-ups
<honest list, incl. anything unverified (→ draft PR)>

<attribution lines per the session reminder>
```
Self-check before opening (all must pass):
- `git diff --stat main` < 300 lines (or split).
- `grep -rnE "sendRawTransaction|eth_sendTransaction|eth_sign|personal_|privateKey|mnemonic|seed phrase|broadcasttransaction|createtransaction|triggersmartcontract" src/` → no new hits.
- No `.env*`, `.data/`, `.next/`, `website/out/`, `.onnx`, keys or tokens in the diff (`git diff main | grep -iE "apikey=|secret|bearer|-----BEGIN"`).
- Every claim in the description is something you ran or opened this session.
- Product copy: no "posts automatically", no "live with customers", no promised dates.

## Log line formats
`<ts SGT> | crypto-protocol-engineer | opened PR #<n> | <row id> | <link>`
`<ts SGT> | crypto-protocol-engineer | RISK: <what> | <ids> | <evidence link>`
`<ts SGT> | crypto-protocol-engineer | summary | shipped: …; blocked: …; need decided: …; metrics: …`
