# Product build review — 22 October 2026

[VERIFIED] Nine implementation steps cover adapters, deterministic diagnosis, persistent investigations,
Company Scan/PDF, review/accuracy, integration interfaces, privacy-bounded intelligence, trust/value,
and design polish. SPEC.md was read in full. The repository had no VISION.md; the user-provided vision
is now recorded there. Existing chain, engine, CSV, bulk and investigation code was reused.

[VERIFIED] This is a pilot candidate. The requested 100-real-transaction accuracy gate has **not passed**.
The repo has seven recorded public transactions, plus synthetic cases and company records. Passing
unit tests establishes expected behavior on those fixtures, not field accuracy.

## Validation

[VERIFIED] 346 tests pass across 18 files. Typecheck and production build pass. Authenticated E2E
checks exercise three roles, password/TOTP, replay rejection, saved investigations, correction,
independent adjudication, regression propagation, resolution, scan and PDF export. Machine results
are in `artifacts/qa/e2e-results.json`. Visual QA captures 13 views and exports a real multi-page PDF.

[VERIFIED] Fresh external investigation latency below two seconds remains unproven. E2E recorded
replay timings are not live-provider benchmarks. Scans have bounded execution and explicit partial
coverage; they do not guarantee exhaustive scans of arbitrarily busy wallets within 60 seconds.

## Public company-wallet scan validation

[VERIFIED] Final run on 22 October 2026, seven-day Ethereum window, public Blockscout history.
Attributions come from public explorer labels, not company-confirmed ownership. This is one selected
wallet per company, not a company-wide audit. Raw provider payloads and hashes are retained in
`artifacts/qa/public-evidence`; full reports are in `public-company-scan-attempts.json`.

| Explorer-attributed wallet | Result | Incoming observations | Seconds |
|---|---|---:|---:|
| BitPay (explorer attribution, unconfirmed) | unavailable | Unknown | 8.01 |
| CoinPayments (explorer attribution, unconfirmed) | complete | 35 | 14.35 |
| CoinsPaid (explorer attribution, unconfirmed) | complete | 0 | 0.97 |

[VERIFIED] BitPay's final attempt timed out; its zero-length result must not be read as zero activity.
The completed results triggered no limited scan signals. Confirmed problem payments and dollar losses
remain **unassessed** for all three. A moving seven-day window and provider indexing can change counts
between runs. The final evidence is preserved rather than selecting the most flattering attempt.

Public attribution pages:
- [BitPay 2](https://etherscan.io/address/0x2730ef3c0c180e7f7bcfca249c757421b208e333)
- [CoinPayments.net 2](https://etherscan.io/address/0x005ad9b93955bf76d180c66f33fe84bd0f3310b5)
- [CoinsPaid HotWallet 1](https://etherscan.io/address/0x7bdb61d76ab2237102a7203da24816ef0a6408f6)

## Accuracy per diagnosis

[VERIFIED] Each row below has **zero independently adjudicated real company cases**. Both precision
and recall are unmeasured, not zero and not 100%. P = TP/(TP+FP); R = TP/(TP+FN). Null denominators
remain null. Correction candidates do not count until a different lead adjudicates them.

| Diagnosis | Precision | Recall | Limitation |
|---|---|---|---|
| D01 not found | Unmeasured | Unmeasured | Requires explicit absence across all v1 chains |
| D02 confirmations | Unmeasured | Unmeasured | Company confirmation policy required |
| D03 failed | Unmeasured | Unmeasured | Missing receipt remains unknown |
| D04 wrong network | Unmeasured | Unmeasured | Company network policy required |
| D05 unsupported token | Unmeasured | Unmeasured | Acceptance policy required |
| D06 fake token | Unmeasured | Unmeasured | Verified issuer-contract registry coverage required |
| D07 wrong address | Unmeasured | Unmeasured | Company address snapshot required |
| D07b look-alike finding | Unmeasured | Unmeasured | Pattern is not proof of attacker intent |
| D08 below minimum | Unmeasured | Unmeasured | Company minimum required |
| D09 issuer freeze | Unmeasured | Unmeasured | Supported issuer checks only |
| D10 pending/congested | Unmeasured | Unmeasured | Disabled by default without reliable timing |
| D11 sender exchange issue | Unmeasured | Unmeasured | Requires supplied sender facts; not universal exchange integration |
| D12 uncredited | Unmeasured | Unmeasured | Exact identity, ownership and ledger freshness matter |
| D13 credited | Unmeasured | Unmeasured | Exact company ledger evidence required |
| D14 on hold | Unmeasured | Unmeasured | Company ledger evidence required |
| D15 memo/tag | Not supported | Not supported | Outside current v1 chains/spec |
| D16 rejected | Unmeasured | Unmeasured | Company ledger evidence required |
| D17 another customer's address | Unmeasured | Unmeasured | Never reveals the other customer |
| D18 retired address | Unmeasured | Unmeasured | Ownership evaluated at transfer time |
| D99 unknown | Unmeasured | Unmeasured | Review, not confident guessing |

## Sceptical head of payment ops

[ASSUMPTION] These are the strongest reasons to decline purchase, not interview findings:

1. No independently demonstrated field accuracy. **Unresolved:** obtain consented historical cases,
   analyst labels and independent adjudication; stratify by diagnosis and report confidence intervals.
2. A wallet scan cannot count our uncredited payments. **Fixed in presentation:** signals and coverage
   are distinguished from confirmed problems; ledger import remains necessary.
3. A confident wrong answer is worse than a manual lookup. **Improved:** unknown receipts, incomplete
   chain searches and missing company policy no longer become confident conclusions. Still needs field validation.
4. Integrations might create extra work. **Unresolved:** Slack/Zendesk installation and workflow trials;
   Intercom is absent. No customer account was contacted or changed during development.
5. Security onboarding would reject an immature SaaS. **Partly addressed:** MFA/roles/audit/retention;
   isolated single-company deployment only. SSO, external security review, managed secrets/backups,
   immediate account-specific revocation and comprehensive operations remain gaps.
6. Savings may be marketing. **Addressed in measurement:** estimates disclose the baseline and formula;
   elapsed resolution time is not measured active handling time. Real time studies remain necessary.
7. API outages and incomplete history hide problems. **Partly addressed:** failover, provenance, health,
   caching and unavailable/partial states. Distributed durable jobs, load tests and SLAs remain gaps.
8. False scam accusations cause harm. **Addressed in wording:** look-alikes and zero-value transfers
   are review signals, not proof of poisoning or losses.

## Senior engineer: could we copy it in a week?

[ASSUMPTION] A capable team could copy a polished hash lookup, explorer links, basic rules, CSV import,
Slack command, an LLM summary and a basic scan report quickly. A token or new chain would not protect them.

[VERIFIED] The build now preserves evidence revisions, rule/settings versions, corrections, independent
adjudication, regression candidates, audit and scoped aggregation. These are mechanisms for learning,
not an existing moat. There is no proprietary customer corpus or network effect yet.

[ASSUMPTION] Defensibility can develop from a high-quality, consented and independently reviewed failure
corpus, reliable company/provider integrations and becoming the team's system of record. Competitors can
copy the code; reproducing accumulated labels and trusted operational adoption may take longer. If teams
will not share records or pay for faster resolution, the infrastructure thesis fails at the wedge.

## Three-minute demo

- **0:00–0:25:** Open the explicitly fictional queue. Explain read-only scope and select an action-needed case.
- **0:25–1:00:** Show verdict, confidence, next step and highlighted evidence. Open a source; distinguish public
  chain facts from fictional company policy/ledger records. Show that unavailable facts pause diagnosis.
- **1:00–1:30:** In a saved case, confirm/correct a verdict. Show the independent lead review and regression
  candidate. Accuracy stays unmeasured until qualified labels exist.
- **1:30–2:15:** Run the fictional Company Scan, open a flagged transfer and export PDF. Explain why the
  public scan cannot claim uncredited dollar losses. Show the real public-wallet validation separately.
- **2:15–2:40:** Show bulk CSV, settings and the value report's explicit estimated-hours formula.
- **2:40–3:00:** Show security and opt-in intelligence boundaries. Ask for a small, consented historical-case
  pilot with baseline handling times and independent labels, rather than claiming production readiness.

## Remaining release gates

[VERIFIED] No 100-real-case labelled test set, measured field precision/recall, live <2s SLA, customer-verified
wallet ownership, real integration installation, multi-company federation, Intercom implementation or
production security certification. Address/reference lookup resolves stored company records; it is not
unbounded public-chain identity search. Company Scan's checks cover contract mismatch and zero value,
not the full company-aware diagnosis catalogue. No full account lifecycle or distributed scan worker.

[ASSUMPTION] The next useful investment is two design-partner teams and adjudicated cases, followed by
hardening the integrations they actually use. Additional chains and infrastructure branding should follow
measured demand, not substitute for it.
