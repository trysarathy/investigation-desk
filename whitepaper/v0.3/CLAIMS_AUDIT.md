# Claims audit: Clearline working paper v0.3

**Checked on 29–30 October 2026.** This audit goes with `paper.html` and `Clearline_Whitepaper_v0.3.pdf`. Each factual
claim is listed with its source. Each product claim is listed with the file and line range (or the test) that proves it.
v0.3 keeps every correction from the independent review of v0.2. Section 3 below lists them. `../CLAIMS_AUDIT.md` is the
v0.2 audit, and its rows still apply wherever v0.3 repeats a claim word for word.

**Pinned commits.** Product claims are true of `main` at `9af0200` unless a row says otherwise. These branches are cited
but not yet merged:

| Branch | Commit | PR | What the paper uses it for |
|---|---|---|---|
| `qa-polish` | `12abf33` | #31 | Code excerpts, the QA report, the 573-test run |
| `xero-scopes` | `da07676` | #36 | Granular Xero scopes, the mandatory plan key, 26 accounting tests |
| `enterprise-pack` | `7c493e3` | #30 | The security overview |

No branch contains Tron payment-request code.

Labels: **V** verified · **A** assumption (written as a hypothesis) · **G** guess. The review PDF prints these labels
next to each claim.

## 1. Code excerpts (section 5)

Each excerpt was copied from the file and trimmed only where "…" appears. Nothing was reworded.

| # | Excerpt | Source (branch, file, lines) | What the paper says it shows | Check |
|---|---|---|---|---|
| X1 | Rule order and pause | `qa-polish` `src/lib/catalogue.ts` 12–15; `src/lib/engine/run.ts` 30–39 | Every rule runs; first High match wins, else first Medium; pause if a chain didn't answer | V: run.ts 37–39 `checks.find(... "High") ?? checks.find(... "Medium")`; 33–35 paused branch |
| X2 | Counterfeit vs wrong token | `qa-polish` `src/lib/requests/lifecycle.ts` 288–292 | Genuine = issuer's contract fixed on the request; symbol containing the token name → counterfeit, else wrong token | V |
| X3 | Look-alike address | `qa-polish` `lifecycle.ts` 557–563 | First 4 **or** last 4 hex characters equal → look-alike; it warns only | V. The comment above the function says "first and last"; the code uses "or". The paper follows the code |
| X4 | Matching and scoring | `qa-polish` `lifecycle.ts` 143–146, 517–527 (labels trimmed) | Several candidates → ambiguous, amount is only a hint; scores 40/35/15/10; Strong ≥ 80, Possible ≥ 50; minimum 40, top 3 | V |
| X5 | Never-post kinds and the plan key | `qa-polish` `src/lib/accounting/rules.ts` 98–100; `xero-scopes` `src/lib/accounting/engine.ts` 38–47 | Counterfeit, wrong network, failed and wrong token never post; approval refused without the key, or if the plan changed | V. On `main`, the key is optional in the function (the web route requires it). The paper says this in section 8 |
| X6 | Instruction and receipt JSON | Proposal; fields map to `src/lib/requests/types.ts` | A draft format; the signature does not exist | Labelled as a draft. Sample data is fictional. `ruleVersion` `rules-2026-10-22.5` matches `catalogue.ts` line 3 |

## 2. New or reworded claims in v0.3

| Claim | Label | Source or proof |
|---|---|---|
| The opening scene (Mei, INV-1042, 40 minutes) | Illustrative | Marked as fictional in the text. Not a customer interview |
| Cost table: 10–30 min per exception, hours to days for wrong-network recovery, 15–30 min plus a refund for duplicates | G | No measurement. Marked "our estimate" |
| Cost table: look-alike losses are "usually for good" | A | Reasoning, not data |
| Wrong network is recoverable with an ordinary key (same key on every EVM chain), often not for smart-contract wallets or exchange deposit addresses | A (technical) | Standard EVM address derivation. Kept from the v0.2 correction |
| 19 Dec 2025, 49,999,950 USDT, first 3 + last 4 characters, after a test payment, from the sender's own history | V | Cointelegraph (20 Dec 2025); Etherscan tx `0xc0514a79…6a0f`; `tests/real_cases.json` POISON-1 |
| "ÚЅDТ" uses look-alike Cyrillic and accented letters; 13 counterfeit "USDT" among the collected cases | V | `demo/REPORT.md`; case FAKE-HG |
| Page 1: US$350–550B (BCG), about 1% of gross transfers | V | Reap, 14 Aug 2026 |
| Page 1: HK's first issuer licences, Apr 2026; MAS consultation, Sep 2026 | V | Charltons; Gibson Dunn |
| Worked example: INV-1042, 4,950.00 of 5,000.00 USDC from an exchange, short by 50.00 (1.0%), likely an exchange fee (an inference), accepted as settled → payment 4,950.00 + fee write-off 50.00 | V (demo data) | `src/lib/requests/demo.ts` case b; `lifecycle.ts` `shortfallCause`; `tests/accounting.test.ts` "short, accepted as settled" |
| Sequence step 4: in live mode someone pastes the transaction ID | V | `src/lib/requests/provider.ts`, `service.ts` `attachHash` |
| Section 4: Clearline imports the invoice | V | `POST /api/accounting/import`; `accounting/engine.ts` `importInvoice` |
| Section 6: the business's own address freeze is checked on lookup | V | `src/lib/chain/investigate.ts` (freeze calls on sender and destination) |
| Section 8: PR #36 adds 3 accounting tests (23 → 26) | V | `tests/accounting.test.ts` on `xero-scopes` (26 `it(` blocks) |
| Bessemer pull quote | V | Bessemer, 22 Apr 2026, quoted word for word |
| Unit economics, market size, pilot price | G / G / A | Unchanged from v0.2 |

All the other market, regulatory and competitor facts are identical to v0.2 (`../CLAIMS_AUDIT.md`, rows M1–M8, R1–R7,
C1–C10, S1–S7). Their sources were re-opened on 29 October 2026.

## 3. Corrections from the v0.2 review, all kept in v0.3

| Review item | Where it is in v0.3 |
|---|---|
| Market maths: "about 1%", with BCG and McKinsey/Artemis attributed correctly; BIS ~US$28T and BCG × Allium >US$62T | Page 1; section 2 |
| Wrong-network example uses Polygon or BNB Chain, plus recoverability | Section 1 cost table; problem map |
| "Look-alike Cyrillic and accented letters" (ÚЅDТ) | Page 1; section 1; section 8 table |
| The checker only warns | Section 4 step 1; section 5 excerpt 3 |
| Append-only: decisions, activity, check snapshots and posting audit; requests and transfers are updated, with earlier attributions kept | Section 6 "Controls that exist today" |
| Xero scopes: `main` asks for the broad scope; fixed in PR #36, unmerged | Section 8 known gaps |
| Test counts: 23 + 23 (10 posting rules, 4 request shapes), +3 in PR #36; 573 overall, mostly the earlier product | Section 8 |
| AI explanations are on whenever an API key is set, and evidence is then sent to Anthropic | Section 6 "Data and AI" |
| Request Finance and Request Network, HitPay networks, Stripe limits (no USDT, US$10k, Singapore not listed) | Section 3 |
| Sanctions, accounting classification (FASB proposal), finality, liability | Sections 5 and 6 |
| Every "not yet built or tested" statement in one place | Section 8 (live vs demo table, known gaps, roadmap) |

## 4. Checks

- **AI-sounding scan** (a script in the session scratchpad that looks for clichés, em dashes, hedges and very long
  sentences). On the first full draft it found no clichés and no em dashes. It flagged "journey" and one 40-word
  sentence, and both were fixed. "Navigate" appears only inside the Bessemer quote. The scan has **not yet been
  re-run** on the final text, because shell commands were waiting for approval.
- **Excalidraw files.** The generator (`figures.mjs`, `excalidraw()`) writes each file with `type: "excalidraw"`,
  `version: 2`, `elements`, `appState` and `files`. Every element carries the fields Excalidraw requires:
  - id, type, x, y, width, height, angle;
  - colours, strokeStyle, roughness, opacity;
  - groupIds, frameId, roundness, seed, version, versionNonce, isDeleted, boundElements, updated, link, locked.

  Text elements also carry their text, font and container fields, and arrows carry points, bindings and arrowheads.
  `map-vision.excalidraw` was inspected by hand. A scripted check of all seven files, and an import test in Excalidraw
  itself, are **still to do**.
