# Clearline: mentor-readiness review

Review date: 6 November 2026. Findings distinguish inspected code, executed tests, proposed behaviour and commercial hypotheses. “Verified” means verified within the stated scope, not independently audited production performance. [ASSUMPTION] and [GUESS] mark recommendations and estimates. Writing style is not evidence of AI authorship.

## Three verdicts

**Protocol reviewer:** [VERIFIED] The safety branch adds real finality and issuer-freeze checks, but it is not the release on main. A missing network/recipient check can still yield a paid headline (S, `src/lib/requests/release-headline.ts:90–118`).
[ASSUMPTION] Present a tested decision-support prototype; do not present a settlement-verification protocol or a complete payment-to-books system.

**Product reviewer:** [VERIFIED] The paper identifies an advance-review workflow but explicitly has no measured frequency, buyer budget or live-money installation (P, p1). The website still sells a different workflow (W, `website/src/components/Hero.tsx:18–34`).
[ASSUMPTION] Sell one redacted-case replay to a provider that already advances money. Stop expanding into documentary credits until that buyer commits.

**Editor:** [VERIFIED] The paper has seven consistently structured pages, no actual money/data diagrams, and visibly uneven word spacing in its rendered PDF. The website uses a gradient headline, animated glow and stock browser-window framing (W, `Hero.tsx:7–8,18–19,37–45`).
[ASSUMPTION] The larger credibility problem is inconsistent scope, not AI attribution. A specific case, a failed case and a candid limitation will impress more than another polished platform claim.

## Evidence map and limits

References below are pinned to these versions, not an unspecified checkout:

| Key | Inspected material |
| --- | --- |
| P | User's **Clearline Founding White Paper**, 05 Nov 2026, Research Edition 1.0, 7 pages. All text read; all seven rendered pages inspected. PDF has no source line numbers, so page references apply. |
| M | `main`, `24fdab48a4ede02241d1d3b02bb22494ed955f51` |
| S | `feat/demo-slices-s2`, `28b62de3fdbb4858423fd7ee30946e7f4e5ca774`, containing the stacked safety changes |
| F | `funding-replay-parity`, merge `8847bc9117315e2ef2eac3dbf086881aaeaaa5e5`, PR71 tester edition |
| W | `website-fixes`, branch inspected after fetching; PR28 remains open. `website/src/...` paths apply. |
| B | `brief-fixes`, branch inspected after fetching; PR29 remains open. Six-slide PDF text and `pitch/src/build_brief6.py` reviewed. |
| O | `whitepaper-v0.3`, PR37; older stablecoin paper, distinct from P. `whitepaper/v0.3/paper.html` inspected. |

[VERIFIED] PR70 merged **into funding-replay**; PR71 merged **into funding-replay-parity**. Neither is a merge into main. PR65, 67, 68, 66 and 69 form a stack in that order. PR31, 36, 37, 28 and 29 remain open at inspection. Sources: GitHub PR metadata at `https://github.com/trysarathy/investigation-desk/pull/{number}`. PR36 already proposes the mandatory posting-plan key fix; do not open a competing version of that fix.

[VERIFIED] This review ran dependency installation, TypeScript, Vitest and Python replay tests. `npm run qa` does not exist on M (`package.json:5–12`). Browser tests were attempted, but Chromium failed at its required local socket with `Operation not permitted`; browser download also failed. No claim is made that every desktop/mobile flow was clicked in this review. Earlier screenshot/test files are historical evidence, not fresh runs. No live bank, Xero, customer ledger or production deployment was verified.

## A. Story and coherence

### A1 — Critical: choose one buyer and decision

[ASSUMPTION] **Clearline is a prototype operating desk for payment providers to review a customer advance and track what remains owed after the supplier is paid.** This is the story to take to mentors. The benefit to prove is less evidence-chasing and fewer mistaken releases or repayment matches.

[VERIFIED] Four materials currently disagree:

- P p1: provider advances, treasury/credit reviewer, collection of repayment.
- M `README.md:1–6`: week-one stablecoin investigation desk with fabricated fixtures.
- W `Hero.tsx:18–34`: stablecoin payments matched and put into the books for businesses receiving directly.
- B `pitch/src/build_brief6.py:97–104`: invoice-to-accounting product; its slide 5 reports zero customers and three vendor calls, not provider advance interviews.

[ASSUMPTION] These can be one founder's experiments, but they are two products with different buyers. Keep invoice investigation as an explicitly historical research project and reusable adapter/rules library. Archive its *public positioning*, not delete branches or working code. Give mentors one current entry point and an appendix explaining the earlier experiment. Do not show LC issuance, eBL, accounting sync and funding approval as equally validated offerings.

### A2 — Important: evidence grade

| Proposition | Grade and basis |
| --- | --- |
| Some providers front customer payments | **Weak** [VERIFIED: P p1 records an advisor account, not transaction evidence]. Plausible workflow, no independently reviewed customer case. |
| The target's repeated operational problem is costly | **None** [VERIFIED: P p1 expressly says frequency/budget unknown]. No measured minutes, incident losses or backlog supplied. |
| Software can represent the decision without hindsight | **Strong for selected synthetic cases only** [VERIFIED: F `funding-replay/README.md:72–85`, 139 Python tests executed]. Not production effectiveness. |
| People will adopt/pay | **None** [VERIFIED: P pp6–7 prices and gates are proposals]. No signed pilot or observed use supplied. |
| Industry studies validate Clearline's demand | **None** [ASSUMPTION: they explain surrounding infrastructure, not this buyer's purchase]. |

[VERIFIED] The older brief's “3 calls reached vendors” and the founder's later reported conversations cannot be pooled as independent buying confirmations (B slide5; P p1). No interview transcript or redacted transaction file was available for independent verification.

### A3 — Important: who pays

[ASSUMPTION] Buyer: head of treasury/operations at a Singapore cross-border provider already offering short advances to recurring enterprise customers. Budget: operations software; credit signs off on the workflow. User: operator preparing an advance, reviewer approving it, collector matching repayment. Frequency is unknown.

[ASSUMPTION] Smallest paid offer this month: **SGD1,000 for a two-week replay of five authorized historical cases**, including a decline and late receipt; agreed output is an evidence packet and comparison against their existing process. This is P's proposed price, not willingness-to-pay evidence. Do not sell funding, guarantees, live execution or regulatory approval.

[VERIFIED] P p6's arithmetic holds: 135,382.50 × 8% × 3/365 = SGD89.02; a SGD150 fee leaves SGD60.98 before other costs/losses. One extra day costs SGD29.67. At 20 minutes × SGD45/hour, value is SGD15/case; SGD1,000/month needs 66.67 cases just to cover the fee. This excludes implementation and review time. At 30 cases it is SGD450, so the proposed subscription loses on that benefit alone. Principal released is not revenue or savings.

## B. Technical rigour

### B4 — Claim-by-claim findings

The table covers the material on-chain claims located in the inspected surfaces. It is not an assertion that every historical file, deployed branch or connector has received a security audit.

| Severity; exact claim | Finding and evidence | Correction |
| --- | --- | --- |
| Critical: “Paid and final.” | [VERIFIED] S `release-headline.ts:90–118` filters absent network/address checks out; neither is required before the final paid branch. Four regression cases reproduced this, including nonblocking overpayment. | Require both checks to pass before any paid assertion. Applied in correctness branch. |
| Important: “Final on Ethereum (can't be reversed).” | [VERIFIED] S `release-checks.ts:38`. Overstates a consensus guarantee; Ethereum finality has explicit economic/security assumptions [R1]. Token freeze/admin action is a separate risk. | “Ethereum reports this payment as final.” Applied. |
| Important: “Not final yet — usually … more” | [VERIFIED] S `release-checks.ts:39–42` multiplies finalized-height gap by block spacing. That is not a finality-time estimator. Demo wait separately repeats the claim, `src/lib/demo-slices/release.ts:67–69`. | Remove countdown; say to recheck before release. Applied in both paths. |
| Critical for live use: “checks the transfer is genuine, complete and final” | [VERIFIED] O `paper.html:33` conflicts with its own `:155,183` describing 12 confirmations. M `src/lib/accounting/rules.ts:110` uses a confirmations threshold. PR68's release-card work does not prove live posting uses finality. | “Checks configured token, amount and confirmation rules; finalized-state enforcement is not integrated across all posting paths.” |
| Important: finality “transaction … re-read now” | [VERIFIED] S `requests/finality.ts:19–25,52–74` rereads canonical inclusion and rejects moved block numbers; EVM `chain/evm.ts:261–274` compares receipt block hash with canonical block. [ASSUMPTION] A same-height reinclusion could change emitted transfer facts, which this query cannot compare because it carries no expected transfer identity or original block hash. | Bind all amount/token/recipient claims to the fresh receipt's exact transfer event; retain block hash and evidence time. Constructed scenario still needs regression implementation. |
| Important: issuer check “at block …” | [VERIFIED] S `requests/freeze.ts:49–76` reads a head, then independently calls `eth_call` at latest (`chain/evm.ts:281–285`). It cannot claim those answers came from that earlier block. | Pin the reads to a supported block/hash or label them as separate latest-state reads without a precise block assertion. Outstanding. |
| Important: “it's a look-alike” | [VERIFIED] S `release-checks.ts:48–59` says this for every contract mismatch. Mismatch proves it is not the configured contract, not counterfeit intent; it could be another legitimate asset or unsupported representation. | “Token contract does not match the accepted asset.” Outstanding copy change. |
| Important: BNB token assumption | [VERIFIED] S `src/lib/contracts.ts:3–5,20–26` treats BNB assets as company-declared bridged contracts. Tether's current supported-protocol page lists BNB [R4]. | Registry must identify **chain + contract + issuer/bridge + effective date**, not infer issuer status from chain alone. Do not relabel the existing Binance-pegged fixture as issuer-native. |
| Important: wrong network | [VERIFIED] S `engine/rules.ts:79–85` and `requests/release-checks.ts:76–85` can reject a mismatch against a known invoice/network. A failed lookup on selected networks does not prove absence everywhere (`rules.ts:51–61`). | Say which networks were checked. Never say lost forever or promise recovery. EVM address equality across networks does not establish an accepted payment. |
| Important: look-alike/poisoning diagnosis | [VERIFIED] S `engine/rules.ts:121–130` uses resemblance/history for a Medium finding. That supports suspicion, not proof of attacker identity or causation. | Preserve “possible”; show exact addresses, history evidence and gaps. No history means not checked. |
| Important: issuer freeze | [VERIFIED] S `requests/freeze.ts:34–46,59–82` checks exact configured contracts and sender/receiver; malformed or missing results become unknown. Historical transfer success is not evidence of current spendability. | Keep issuer-specific method, both addresses, timestamp and “can change later”. OFAC matching is a different check, not global compliance clearance. |
| Important: Ethereum, L2s and Tron | [VERIFIED] S `chain/sources.ts:20–47` has different providers; payment requests remain Ethereum-only (`company/PRODUCT_FACTS.md:12–16`). Tron solidity requires solidified transaction/receipt evidence [R2]. OP Stack finality depends on L1 derivation [R3]. | Publish a capability matrix: lookup, token registry, finality signal, matching, posting. “Seven networks supported” is too broad. Do not equate sequencer receipt, safe state, finalized state or bridge withdrawal completion. |
| Important: “never on amount alone” | [VERIFIED] S `requests/lifecycle.ts:110–146` sends multiple candidates to review even with one matching amount. But one open request/no prior completed request auto-links by receiving address. | Explicitly require exclusive address ownership/assignment. One company's invoice list does not prove exclusivity across companies. Unrelated customer funds cannot be attributed by value alone. |
| Polish: EIP-681 payment request | [VERIFIED] S `requests/present.ts:17–22` builds chain-1 token transfer URI, appropriate to the Ethereum-only request scope [R5]. | URI is an instruction, not payment proof; wallet compatibility and acceptance need tests. Do not reuse `@1` on other chains. |
| Important: ERC-7699 | [VERIFIED] O `paper.html:222` correctly says “proposes”; the standard is Draft [R6]. No implementation found in inspected request code. | Keep as prior art, not interoperable shipped reference support or a feature of ordinary ERC-20 transfers. |
| Important: “the chain holds none of them” | [VERIFIED] O `paper.html:74` includes token genuineness, network and finality among supposedly absent chain facts. False: chain data plus the right trust anchors supports those checks. Invoice identity remains external. | “The chain supplies transfer facts. The business must connect them to an invoice and its acceptance policy.” |
| Important: on-chain settlement versus delivery | [VERIFIED] P p4 explicitly requires final off-ramp credit as separate evidence. Swift also distinguishes institution arrival and beneficiary credit [R7]. | Retain this distinction; a finalized token transfer is not proof of supplier bank credit or goods release. |

### B5 — What breaks first

1. **Critical — wrong release/version.** [VERIFIED] Mentors can open main and see another product; safety work is unmerged. PR70/71 targets differ. A successful build is not proof of what the public URL serves.
2. **Critical — attribution and stale approval.** [VERIFIED] Paid-headline omission reproduced; M `accounting/engine.ts:28,38–41` makes expected plan key optional. PR36 contains a proposed fix. [ASSUMPTION] Wrong invoice or changed approval can be more damaging than a slow lookup.
3. **Critical before money — untested operational integration.** [VERIFIED] P pp1,4 describes a pilot/spec; no authorized live bank/payout or Xero run was supplied. Unknown delivery and provider timeout must not be retried as fresh transfers.
4. **Important — inconsistent evidence time.** [VERIFIED] Freeze block stamp overstates provenance; finality doesn't rebind transfer facts. A checksum proves byte identity, not truth or completeness of the provider response.
5. **Important — customer data and accounting policy.** [ASSUMPTION] Organization isolation, permissions, restore, document access and ledger treatment need deployment-specific tests. No blanket “bank-grade” or GDPR/data-residency assurance is justified by these checks.
6. **Important — provider coverage.** [VERIFIED] Etherscan finality limitation is documented in PR68; sources depend on selected provider and keys. Unavailable data must visibly block only affected actions, never become a guessed success.

### B6 — Read-only and law

[VERIFIED] The inspected blockchain adapters query data; no wallet-signing/broadcast path was found in the inspected `src` code search. This is a bounded negative finding, not a guarantee for all branches. The newer local pilot's `funding-replay/pilot/connector.py:1–17` explicitly describes a SQLite-backed simulation, not live payouts.

[VERIFIED] “The whole product is read-only” is false: M `src/lib/accounting/providers/xero.ts:86–104` issues accounting PUT requests. Accurate wording: **“Read-only on chain; accounting writes require approval. Payouts in this demo are simulated.”** Do not confuse accounting records called Payments with moving bank funds.

[VERIFIED] MAS's 2 April 2024 expansion expressly includes some noncustodial facilitation of DPT transmission and cross-border transfers [R8]. No custody is not a licensing exemption. [ASSUMPTION] Singapore counsel should review the actual contracts and flow before introducing live initiation, arranging advances or portable title. This review does not certify PSA, UCP600, ISBP, eURC, SWIFT or eBL compliance. MLETR source PDF was inaccessible in this session; no title-law conclusion is verified here.

## C. Product judgment

### C7 — First five minutes

[ASSUMPTION] Show one concrete distinction: **the supplier has been paid, but the provider is still owed money.** Show exposure staying unchanged when the importer receives its own customer payment, then falling only on a matched repayment. That is memorable and specific to the buyer. F's earlier Friday/Monday replay is only the timing experiment; do not pretend PR71 contains the whole later provider lifecycle (P p3 versus F README).

[ASSUMPTION] Cut from the mentor journey: instrument catalogues, hypothetical network intelligence, global invoice uniqueness, general AI assistant, token/chain ambitions and accounting integrations that do not support the advance case. Keep a decline/unknown path beside the happy path. Hide irrelevant nav entries rather than remove their source code.

### C8 — Clicks and speed

[VERIFIED] M `requests/provider.ts` and `requests/check.ts` require supplied transaction evidence in live request lookup; the earlier brief acknowledges manual hash input (O `paper.html:155`). Its video omits the accounting step (B slide4). PR69's body says the demo has no fully eligible approve route: recorded Ethereum finality is missing and Tron posting is unsupported.

[VERIFIED] Consequently, no observed end-to-end “payment arrived → books correct” time or defensible total click count was obtained. Browser execution was blocked; tests and screenshots cannot substitute for timed operator use. [ASSUMPTION] Measure from artifact receipt to reviewed ledger entry, including hash-chasing, provider delay and accountant work. Compare the same case in the incumbent spreadsheet/portal workflow. A two-second rule evaluation is not two-second resolution.

### C9 — What would be 10× better

[ASSUMPTION] One authorized provider record arrives; Clearline identifies exactly which case it unblocks, presents only the changed evidence to the reviewer and reconciles the eventual receipt without rekeying. Prove improvement in operator minutes and repeat contacts at equal error/service levels. Target a 20-minute repetitive evidence chase becoming a two-minute review **as an experiment**, not a claim. The scarce capability is a trustworthy integrated workflow, not more diagnosis codes.

[ASSUMPTION] Compounding advantage: permissioned within-provider evidence-to-outcome mappings and integration reliability. Requires rights to retain appropriate outcomes and representative adverse cases. A treasury vendor with the same data/access can copy it. No current network moat is demonstrated (P p5).

## D. Editing and visual review

### D10 — White-paper language

[ASSUMPTION] The repetitive pattern is abstract heading → compressed proposition → balancing caveat. It reads like an advisory memo, not a founder explaining one difficult case. Keep factual caveats; replace abstractions with the actual operator, evidence and action. The 15 exact source sentences/headings and suggested replacements are in `PAPER_EDITS.md`. They are editorial suggestions, not an authorship detector. No founder's note has been edited; O `paper.html:60` still contains a placeholder that should not be sent to mentors.

### D11 — Other text

| Severity | Located text | Suggested replacement |
| --- | --- | --- |
| Important | M `README.md:3`: “Build week 1 of Product Spec v1” | “This repository contains the original stablecoin investigation prototype and a separate funding experiment. See the release map before running either.” |
| Important | W `Hero.tsx:19`: “matched, explained and in your books” | For the current funding direction: “Review the advance. Track what is still owed.” Mark as prototype. |
| Important | W `site.ts:13–15`: long asks/matches/checks/explains/prepares list | “For payment providers that pay suppliers before customers reimburse them. Review the evidence and track the outstanding advance.” Proposed scope, not shipped claims. |
| Important | B slide4: “Posted to your books on approval” | “Accounting connector tested with fixtures; live Xero validation remains to be done.” |
| Important | B slide5: “52 of 52 real transactions: correct verdict” | “The earlier deposit-diagnosis test set reported 52/52 on selected cases. It did not measure invoice matching or funding decisions.” |
| Polish | W `Sections.tsx:94`: “Questions, answered plainly.” | “Pilot scope and limitations” |
| Polish | S `release-headline.ts:1–14`: task provenance and long policy recital | Keep the invariant and a link to the policy; move agent ownership/history to the PR. Do not erase AI assistance disclosures. |
| Polish | M git log `a7cf760`: very long policy/plan commit title | “Document posting policy and unresolved accounting choices” with details in the body. |
| Important | Long PR narratives mixing work log, counts, screenshots and promises | “Problem. Changed behaviour. Tests actually run. Remaining limit.” Example: “Missing recipient checks could produce a paid headline. Require both attribution checks; add regression cases.” |

[VERIFIED] The inspected history has multiple stacked, long-lived product branches and branch-specific test claims. [ASSUMPTION] That signals release-management debt, not proof of poor code or AI authorship. Keep history, add a current release manifest, stop opening unrelated scope under one product name. No branches were deleted or hidden.

### D12 — Design

[VERIFIED] All seven P pages were rendered and inspected. Paragraphs have visibly uneven spacing, including missing-looking gaps between words; page7's source list is especially hard to scan. There are no actual diagrams separating money from decisions. These are presentation defects, not style preferences.

[ASSUMPTION] Re-render from editable source with normal proportional body text, no body tracking, embedded font and consistent 1.4 line height. Use monospace only for IDs/amounts. Replace one page of repeated headings with the USD100k case: evidence received, action permitted, cash moved, amount still owed. Add one money-flow diagram and a separate evidence/decision diagram with simulation labels. Do not combine legal obligations and on-chain events in the same arrow.

[ASSUMPTION] On the app, prioritize amount/currency, supplier deadline, available cash, exposure and missing evidence in one viewport. Reserve green for evidenced outcomes; never color simulated supplier credit as observed live credit. Replace the empty queue's repeated “Nothing here” sections with a single empty state and a labelled synthetic-case action. The current screenshot's account login is a pilot security boundary; a separate disposable guest workspace should not bypass real tenant authentication. Fresh desktop/mobile visual validation is outstanding.

## E. Honesty and strengths

### E13 — Claims to correct

[VERIFIED] Material overstatements are the paid headline with missing attribution; irreversible-finality wording; fabricated finality ETA; exact freeze block provenance; older paper's “chain holds none” claim; unqualified end-to-end accounting copy; and carrying diagnosis test counts into matching/funding claims. Each has source and corrected wording above.

[ASSUMPTION] Do not say “full product”, “bank-grade”, “compliant”, “100% accurate”, “ready for real money”, “cuts funding cost”, “guarantees delivery”, “network moat” or “proven demand”. Say precisely which branch, test and external integration were verified. The new paper already labels its market range, pricing and savings inputs as assumptions; preserve those labels.

[VERIFIED] ADB's gap is a financing-demand estimate [R9], not Clearline's software market. ICC's register is not evidence of this provider segment's unsecured credit risk [R10]. The LiquidX, MonetaGo and Traydstream descriptions are vendor descriptions [R11–R13], not independent comparative performance. P's two 1kx essays provide hypotheses [R14–R15], not buyer commitments.

### E14 — What can be said more confidently

- [VERIFIED] “The funding replay has explicit known-at times and refuses to use later evidence in an earlier decision.” F README:72–85; 139 executed tests. Scope: selected synthetic cases.
- [VERIFIED] “The shared-address matcher does not resolve ambiguous invoices by amount alone.” S lifecycle:134–146. Scope: supplied request set.
- [VERIFIED] “We reproduced a paid-label defect, added four regression cases and fixed it.” Correctness diff; pre-fix 4 failures, post-fix 830 passing tests, 67 skipped, 1 todo.
- [VERIFIED] “Our paper separates the provider's receivable from supplier delivery and the importer's own receipt.” P p3. This is a clear model boundary, not evidence of customer results.

## F. Ten hard mentor questions

Answers below are proposed founder wording [ASSUMPTION], grounded in the review above.

1. **Who pays you today?** “Nobody yet. I'm testing this with providers that already advance funds. My next proof is a paid replay, not another feature.”
2. **What decision do you improve?** “Whether an advance case is ready for review before cutoff, and what is still owed after payout. The provider keeps the credit decision.”
3. **Why did the product change?** “I began with stablecoin payment investigation. The advisor raised a different problem: providers funding customers. I'm testing that separately rather than claiming the first product proved it.”
4. **Why not a spreadsheet?** “It might be enough. I want the same historical case run through both and will stop if we don't remove repeated work or a real error risk.”
5. **Why blockchain?** “It is an optional evidence source and payment route. This workflow does not need our own chain or token.”
6. **Does final mean the supplier can spend the money?** “No. Chain finality, issuer restrictions and beneficiary bank credit are different facts. We need the relevant evidence for each.”
7. **Can you identify an invoice from a shared wallet?** “Not reliably from amount alone. Ambiguous transfers go to review; automatic attribution needs an exclusive assignment or another trustworthy reference.”
8. **What does 52/52 prove?** “A selected earlier deposit-diagnosis test set, not live matching accuracy, funding decisions or customer ROI.”
9. **Are you regulated or lending?** “The demo simulates payouts and we don't provide capital. Noncustodial does not settle the legal question; counsel must review any real execution or financing role.”
10. **What do you need from me?** “An introduction to a treasury owner who can share five redacted advance cases, including one that went wrong, and compare the replay with their actual process.”

## Top ten fixes, in credibility order

1. [ASSUMPTION] One current buyer/story and a release map. Archive old marketing from the mentor journey; preserve code/history.
2. [VERIFIED] Require network and recipient checks before a paid claim. **Implemented/tested**, separate correctness branch.
3. [VERIFIED] Remove irreversible-finality and block-gap ETA language, including demo wait. **Implemented/tested**, separate copy branch.
4. [ASSUMPTION] Integrate and validate finality/approval invariants at the actual posting boundary; review PR36 before merging anything. **Outstanding**, not patched by a headline fix.
5. [ASSUMPTION] Replace unqualified accuracy/end-to-end claims with branch, dataset and integration limits. **Proposed in paper edits and meeting sheet**; old deck not silently rewritten.
6. [ASSUMPTION] Obtain one redacted provider case and benchmark the existing process. **External evidence missing**; software cannot manufacture this.
7. [ASSUMPTION] Pin freeze evidence correctly and revalidate exact transfer facts across reorgs. **Outstanding**; do not call this branch production-safe.
8. [ASSUMPTION] Present one working synthetic provider case plus one refusal; fresh desktop/mobile and deployed-build checks. **Browser environment blocked this review**.
9. [ASSUMPTION] Re-render the paper with normal text spacing; remove generic marketing framing. **Text edits supplied; PDF binary not replaced**.
10. [ASSUMPTION] Fix release hygiene: one published build ID, reproducible commands, short PRs and an honest known-gaps list. **This review records the state; no merges/deployment performed**.

## Primary sources opened for this review

Accessed 6 November 2026. Vendor claims remain vendor claims. Source descriptions are deliberately narrow.

- R1: https://ethereum.org/developers/docs/consensus-mechanisms/pos/faqs/ — consensus finality and security assumptions.
- R2: https://developers.tron.network/docs/confirmation-semantics — inclusion, receipt and solidity are distinct.
- R3: https://specs.optimism.io/protocol/derivation.html — L2 derivation and L1 dependencies.
- R4: https://tether.to/en/supported-protocols/ and https://developers.circle.com/stablecoins/usdc-contract-addresses — current issuer registries; check the exact contract, not symbol.
- R5: https://eips.ethereum.org/EIPS/eip-681 — payment URI specification.
- R6: https://eips.ethereum.org/EIPS/eip-7699 — draft transfer-reference extension.
- R7: https://www.swift.com/sites/default/files/files/swift-spotlight-on-speed_september-2025.pdf — last-mile beneficiary credit distinction.
- R8: https://www.mas.gov.sg/news/media-releases/2024/mas-expands-scope-of-regulated-payment-services — noncustodial facilitation may be regulated.
- R9: https://www.adb.org/publications/adb-global-trade-finance-gap-survey
- R10: https://iccwbo.org/wp-content/uploads/sites/3/2025/10/ICC-Market-Commentary_Trade-Register-2025.pdf
- R11: https://www.liquidx.com/working-capital-solutions-monetize/
- R12: https://www.monetago.com/use-cases
- R13: https://www.traydstream.com/news/mizuho-bank-selects-traydstream-to-advance-trade-finance-digitisation
- R14: https://1kx.capital/writing/cost-of-trust-2
- R15: https://1kx.capital/writing/the-rewiring-of-trade-finance
