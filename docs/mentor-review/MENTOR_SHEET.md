# Clearline — what to say to a mentor

## One line

[ASSUMPTION — proposed positioning] “I'm building a desk for payment providers that pay suppliers before their customers reimburse them: review the advance, then track what is still owed.”

## Open with the problem

[VERIFIED — advisor account recorded in the founding paper, p1] “The idea came from a conversation about providers fronting money after a credit review. I've built a prototype around that workflow. I haven't yet proved how often the operations problem happens or whether someone will pay to fix it.”

## Three proof points

1. [VERIFIED — funding-replay-parity README:72–85; this review's Python run] “The earlier funding replay uses only evidence known at the decision time. Its 139 Python tests passed here. That is a synthetic test, not a customer outcome.”
2. [VERIFIED — founding paper p3] “The model separates supplier payment from customer repayment. The importer receiving its own customer cash does not clear what it owes the provider.”
3. [VERIFIED — review regression run] “We found a case where missing network and recipient checks still produced a paid label. We reproduced it and fixed it with regression tests.”

## Three honest gaps

- [VERIFIED — founding paper p1] No measured customer workflow, confirmed budget or paid pilot is established in the reviewed evidence.
- [VERIFIED — source inspection and test log] No live-money, bank or Xero integration was validated in this review. The demo and proposed operating product are different releases.
- [VERIFIED — review limits] Fresh desktop/mobile browser verification was blocked in this environment. Finality enforcement at every posting path and deployment-specific security still need work.

## What to show

[ASSUMPTION] Use one synthetic advance case and one refusal. Explain the terms and source of funds first. Show the supplier-credit state separately from the outstanding customer balance, then match a repayment. Label simulation throughout. Do not switch to unrelated stablecoin matching or documentary-credit screens. Before the meeting, verify that the shared URL serves the intended build and that this path actually works there.

## The ask

[ASSUMPTION] “Could you introduce me to one treasury or payment-operations owner who already deals with customer advances? I'd like to replay five redacted cases, including one that was declined or repaid late, and compare it with their current process.”

[ASSUMPTION — commercial test] Proposed offer: SGD1,000 for a two-week, five-case replay. Agree the scope and evidence access before quoting it as an offer. Do not call it proven pricing.

## If asked why this needs crypto

[ASSUMPTION] “It doesn't need a new chain or token. Stablecoin data can be one source of evidence, but the difficult part is connecting the funding decision, supplier delivery and repayment. If a spreadsheet handles that well enough, we need to know.”

## The question that can kill the thesis

[ASSUMPTION] “If we put the right evidence in front of you earlier, could you actually take a different action, or is the blocker simply unavailable credit or a fixed contract?”
