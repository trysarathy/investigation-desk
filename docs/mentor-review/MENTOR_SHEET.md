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

## Competitor questions

These answers use the supplied competitor pack’s topics, with the named primary pages opened again on 2026-11-06. Vendor descriptions are claims about advertised capability, not independent performance tests. The pack’s 7 November date has not been adopted as this review’s date.

### Why won’t Nium or Airwallex build this?

1. [ASSUMPTION] “They could. I have no evidence that they won’t.”
2. [VERIFIED — [Nium documentation](https://docs.nium.com/docs/payins/program-client-and-client-prefund-account), opened 2026-11-06] “Nium already documents prefund accounts; that alone doesn’t prove it advances money to importers.”
3. [VERIFIED — [Airwallex Singapore](https://www.airwallex.com/en-sg), opened 2026-11-06] “Airwallex offers payouts and embedded-finance APIs, including for financial-services businesses.”
4. [ASSUMPTION] “My proposed starting point is a file-based view of outstanding advances across a provider’s existing records.”
5. [ASSUMPTION — unknown] “I don’t know whether that is enough to win. Five case replays should tell us whether their existing tools already handle it.”

### Isn’t this Modern Treasury?

1. [VERIFIED — [Modern Treasury lending](https://www.moderntreasury.com/solutions/lending), opened 2026-11-06] “There is real overlap: it advertises disbursements, repayment collection and matching repayments to loans.”
2. [VERIFIED — same source] “It also describes keeping each capital partner’s money in separate accounts.”
3. [ASSUMPTION] “Clearline’s proposed first deliverable is an open-advances file and exceptions list, using records the provider already has.”
4. [ASSUMPTION] “That could suit a team that wants a narrow reconciliation job without changing its payment setup.”
5. [ASSUMPTION — unknown] “I haven’t proved it is easier or cheaper. We should compare the same five cases against their spreadsheet and a configured incumbent.”

### Isn’t this Taktile?

1. [VERIFIED — [Taktile](https://taktile.com/), opened 2026-11-06] “Taktile advertises business onboarding and underwriting workflows.”
2. [VERIFIED — same source] “Its business-underwriting description includes automating applications and supporting complex reviews.”
3. [ASSUMPTION — scope] “Clearline leaves the credit decision with the provider and starts with what happens to an advance and its repayment records.”
4. [ASSUMPTION] “That is a different first job, but it is not evidence that Taktile or a customer using it couldn’t add it.”
5. [ASSUMPTION — unknown] “I don’t know yet whether the remaining operations work needs a separate tool.”

### What if importers just get credit elsewhere?

1. [VERIFIED — [Ebury supplier finance](https://ebury.com/products/financing/supplier-payment-finance), opened 2026-11-06] “That is a real alternative: Ebury advertises paying suppliers while its customer settles later.”
2. [VERIFIED — same source] “Its page says product availability varies by country, so I can’t assume every importer qualifies.”
3. [ASSUMPTION] “Clearline does not remove the need for capital or replace a credit facility.”
4. [ASSUMPTION] “It only has a job if a provider still carries advances and spends meaningful effort finding what remains unpaid.”
5. [ASSUMPTION — stop condition] “If customers can get suitable credit elsewhere and the provider stops advancing funds, that provider is outside our first market.”
