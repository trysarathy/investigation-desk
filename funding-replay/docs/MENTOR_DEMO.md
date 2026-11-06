# One funding conversation

[VERIFIED — `tools/export_mentor.py`, `tests/test_mentor_export.py`] This walkthrough uses the lifecycle engine's reference case. It exports 16 states: the advance journey and one refusal. Every amount, evidence row, eligibility result and timeline remains the engine's output. Only the available navigation is narrowed. The regular exporter and authenticated pilot are unchanged.

From the repository root:

```sh
python3 funding-replay/tools/export_mentor.py /tmp/clearline-mentor
python3 -m http.server 8766 --directory /tmp/clearline-mentor
```

Open `http://localhost:8766`. Export into a new, empty directory. The output can be served on a static host; it needs no login or customer database. Do not commit the exported files. This is a simulation, not an operational tenant or live integration.

## Show this sequence

1. Explain the fictional provider's funding cash and pre-agreed facility. Request advance, then Reserve capacity. No money has been drawn.
2. Record simulated draw, instruct payout and record provider acceptance. Acceptance does not prove supplier credit.
3. Record beneficiary credit. The supplier delivery and SGD 135,532.50 owed to the provider appear separately.
4. Advance the simulated clock twice, then record the importer's customer receipt. The provider is still owed SGD 135,532.50.
5. Record the SGD 100,000 payment, then Match repayment. Receiving it alone does not allocate it. Matching leaves SGD 35,532.50.
6. Record the balance and match it. Exposure ends. Close the case.
7. Reset, Request advance, Decline. No exposure is created. Reset returns to the same synthetic case.

[ASSUMPTION — proposed validation] Ask: “Which record would you need before trusting this outstanding balance? Could we replay five redacted advances, including a declined or late case?”

## Validation for this change

[VERIFIED — local command run] `python3 -m unittest discover -s funding-replay/tests -p 'test_*.py'`: 212 passed, including four new export/repayment/refusal tests. `npx tsc --noEmit` and `npx next build`: passed after a clean `npm ci`. `npx vitest run`: 572 passed, 57 skipped. This does not establish customer accuracy or performance.

[VERIFIED — attempted browser launch] Fresh visual verification is blocked: system Chromium aborts during ProcessSingleton setup with `Operation not permitted`. No fresh screenshots, accessibility or visual quality pass is claimed. Before sharing, run:

```sh
node funding-replay/tests/browser/mentor.cjs /tmp/clearline-mentor /tmp/mentor-screenshots
```

The browser check requires Playwright and Chromium (`CHROMIUM_PATH` can override `/usr/bin/chromium`). It covers the journey, refusal, keyboard actions, simulation label and overflow at 1280 and 390 px. Review those screenshots before merging. Verify the actual hosted URL separately; this PR does not deploy it.
