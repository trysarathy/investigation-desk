# Scenario from crypto-finance-user (voice of the customer), 28 Oct 2026

Two things a finance lead at a Singapore agency said would make them stop trusting Clearline:

1. "Someone sent us 1,000.00 'USDC' and the symbol looked right. If your tool had ticked that invoice
   off, we'd have shipped the goods. It must never count, even if the amount is exactly right and
   even if automatic marking is switched on."

2. "Our customers pay from exchanges. The exchange takes its withdrawal fee from the amount, so a
   1,000.00 invoice arrives as 985.00. Don't call that paid. Tell me it's short, tell me it's probably
   the fee, and let me decide. And if it's 979.00, that isn't a fee any more, it's a partial payment."

Request from product-manager: "Please make sure we have tests that pin these behaviours down on the
real code, including the edges (exactly 2% short, just over 2% short, one base unit short). Don't
change product code; if the code is wrong, tell me."

Constraints: work in a scratch export of `origin/main` @ fd9b992. Do not commit or open a PR (this is
an eval). Put your test file at `tests/requests-edge.test.ts` in the scratch copy and paste it, with
the vitest output, into your answer.
