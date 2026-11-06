# Founding paper: proposed text edits

Source: Clearline Founding White Paper, Research Edition 1.0, 05 November 2026, seven pages. These are suggested editorial replacements [ASSUMPTION], not claims that prose can identify AI authorship. Preserve the original PDF and its sources. No founder-authored note is edited.

## Replacement opening

**Clearline Funding Desk — provider advance review prototype**

[ASSUMPTION] A payment provider has promised to pay a supplier before its customer reimburses it. Before releasing the money, the reviewer must check the agreed terms, available cash and evidence. After release, the operator must track two separate facts: whether the supplier received the payment and whether the customer repaid the provider.

[ASSUMPTION] Clearline's proposed job is to put that case in one reviewable record. It shows the evidence available at the decision time, identifies missing conditions and keeps the outstanding advance visible until a repayment is matched. The provider supplies the policy, credit approval and money.

[VERIFIED: original paper p1] The starting evidence is an advisor's account of this workflow. We have no measured case frequency, confirmed budget or purchase commitment in the materials reviewed. The example uses synthetic company data. The earlier Friday/Monday replay passed 139 Python tests in this review; that does not validate the later provider operating desk or a live payment integration.

[ASSUMPTION] The first buyer to test is a Singapore cross-border provider already making short advances to recurring enterprise customers. We will ask its treasury owner for five authorized redacted cases, including a decline and a late receipt, and replay them against the current process. The proposed two-week price is SGD1,000. It is a commercial test, not an accepted market price.

## Fifteen precise edits

Each original is from the founder-provided paper, not a third-party quotation. Replacements retain uncertainty and scope.

| Page | Original sentence or heading | Suggested replacement |
| --- | --- | --- |
| 1 | “It links the funding decision to delivery and collections without taking custody or making the credit decision.” | “The provider makes the credit decision and supplies the money. Clearline records the evidence, payout status and outstanding repayment.” |
| 1 | “Why this company might deserve to exist” | “What the reviewer needs before cutoff” |
| 1 | “Build for one provider before building between providers.” | “First, replay five cases with one provider.” |
| 1 | “The hard question is not whether the software works; it is what the reviewer would do differently because it exists.” | “Ask the reviewer which action this evidence would have changed, and when.” |
| 2 | “Read the papers as hypotheses about where value accrues.” | “The essays suggest where a business might form. They do not show that our buyer needs this product.” |
| 2 | “Our first mechanism is narrower: a reviewer can reuse an already established fact instead of chasing it across teams.” | “Test whether the reviewer can reuse a recorded fact instead of asking another team for it again.” |
| 2 | “It earns the right to move toward underwriting evidence only if customers generate representative, permissioned outcomes.” | “We should not offer underwriting data until customers permit its use and the records include declines, delays and losses as well as successful cases.” |
| 2 | “The trap for a founder” | “Does this help the first customer on its own?” |
| 3 | “One case, three clocks” | “A USD100,000 supplier payment: when cash is needed and when it returns” |
| 3 | “Count improvements only at equal service and risk.” | “Only compare routes that meet the same supplier deadline and use comparable credit, liquidity and recovery assumptions.” |
| 4 | “A record a reviewer can defend” | “What the decision record must contain” |
| 4 | “Private by construction” | “Privacy controls to implement and test” |
| 5 | “What could compound” | “What repeated customer use could teach us” |
| 5 | “Integration quality, versioned evidence mappings and a history operators rely on might be.” | “The harder part to copy may be keeping a provider's records accurate through retries, corrections and repayment exceptions. We have not proved that advantage yet.” |
| 7 | “The ask that earns a second meeting” | “The next test: five redacted advance cases” |

## Corrections needed outside this seven-page paper

[VERIFIED: older PR37 paper, `whitepaper/v0.3/paper.html:74`] “the chain holds none of them” is technically false when the listed facts include network and finality. Suggested replacement: “The chain supplies transfer facts. The business must connect them to an invoice and its acceptance policy.”

[VERIFIED: older PR37 paper, `paper.html:33,155,183`] The opening says verification checks finality, but the implementation description uses twelve confirmations and calls finalized-state support planned. Suggested replacement: “The current request path checks configured confirmation thresholds. Finalized-state checks must be integrated at the posting boundary before live use.” Do not rewrite it as already shipped because a separate demo branch contains a checker.

[VERIFIED: older brief, slide5] “52 of 52” belongs to selected deposit-diagnosis cases, not funding or invoice-attribution accuracy. Keep it in the historical appendix with dataset and date; do not move it into this paper as a proof point.

## Layout changes for the next PDF export

[ASSUMPTION] Use normal word spacing and proportional body text; restrict tracking to small labels. The reviewed PDF has visibly irregular gaps on all seven pages. Keep amounts aligned and currencies explicit. Add separate money-flow and evidence-flow diagrams only after confirming they match the case model. The binary PDF is not overwritten in this change; this avoids pretending that a text patch has fixed its rendering.
