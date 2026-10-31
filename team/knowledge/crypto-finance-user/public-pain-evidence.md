# Public evidence of stablecoin payments arriving wrong

**These are public posts and vendor pages. They are not Clearline customers, not interviews, and not
a measure of how often anything happens.** Quote them only with the link and as "a public page/post
says". Accessed 2026-10-31. Reddit, Trustpilot, Xero Community and Intuit Community were **blocked**;
the forum search did not return a usable r/Accounting or r/Bookkeeping thread. So most entries are
vendor help/blog pages (opened) or search-level secondary items.

## A. Opened this run (primary for "what this vendor publishes")
| # | Pain | What the page says (short quotes) | Link | Label |
|---|---|---|---|---|
| P1 | Short payment | "Partially Paid: Do not deliver. The customer sent less than required. Either wait for the full amount or reach out to them. Moreover, if you're willing to accept the partial payment, you can manually complete it through your dashboard." | [NOWPayments, Best Integration Practices (updated 14 Sep 2026)](https://nowpayments.io/blog/best-integration-practices-at-nowpayments) | [VERIFIED] |
| P2 | Auto-accepting wrong amounts | "Finished: Be very careful with this setting. If selected, it automatically marks every deposit as 'Finished,' even if the amount is wrong." | same | [VERIFIED] |
| P3 | Wrong network | Most common refund cases: "A deposit was sent in a wrong network (i.e. in BEP-20 instead of ERC20)"; below-minimum amounts; deposits "without a memo/a destination tag". | [NOWPayments refund policy](https://nowpayments.io/help/payments/common/refund-policy) | [VERIFIED] |
| P4 | Recovery costs and is manual | "When a deposit gets stuck in the system due to a wrong network, the funds are extracted and forwarded to a relevant address manually, and automatic charging is not possible. In this case, we kindly ask a partner/a customer to cover a network fee" | same | [VERIFIED] |
| P5 | Exceptions are operational work | An exception means the merchant may need to "investigate why a payment was not completed; reconcile a transaction manually; coordinate a refund or recovery; troubleshoot a payout blocker; keep the customer updated". Case 1: a US$105 ETH payment flagged as a wrong-asset payment, resolved by support. Case 2: more than US$400 BTC shown as failed, refund took "approximately two days". | [NOWPayments, How support reduces the cost of payment exceptions (30 Oct 2026)](https://nowpayments.io/blog/how-nowpayments-support-team-reduces-the-cost-of-payment-exceptions) | [VERIFIED] (vendor marketing citing Trustpilot reviews it links; we did not open the reviews) |
| P6 | Refunds are new payments | "Refunds are always returned as stablecoins to the customer's original wallet." No disputes/chargebacks. | [Stripe, Stablecoin payments](https://docs.stripe.com/payments/stablecoin-payments) | [VERIFIED] |
| P7 | Bank-side short payments are normal enough for a tolerance setting | "if the customer sends 100 USD to pay their 100 USD invoice, the customer's bank might take 20 USD … If this difference … is acceptable, you can minimize manual effort by specifying this margin ahead of time" | [Stripe, Automatic reconciliation (deprecated)](https://docs.stripe.com/invoicing/reconciliation) | [VERIFIED] (fiat bank transfers, used as an analogue only) |
| P8 | Wrong chain is a real integration risk | Tether asks integrators to make it "explicitly clear (both publicly and within their platform) which protocols they support"; USD₮ exists on many chains and should be "treated equally and interchangeably". | [Tether, Supported protocols](https://tether.to/en/supported-protocols/) | [VERIFIED] |

## B. Search-level only (not opened; paraphrase, don't quote)
| # | Pain | What the search result reports | Link | Label |
|---|---|---|---|---|
| S1 | Fee deducted, payment short | A hosting company's public notice warns customers that sending exactly 1 USDT arrives as slightly less after TRC20/ERC20 fees, causing an insufficient payment. | [SurferCloud notice](https://www.surfercloud.com/blog/important-notice-ensuring-correct-usdt-payments-for-surfercloud-services-1%e2%89%a01usdt) | [ASSUMPTION: secondary, search] |
| S2 | Books missed stablecoin income and fees | A public job post: a business receiving client payments in USDT/USDC needs a bookkeeper to trace history before CPA review. | [Upwork post](https://www.upwork.com/freelance-jobs/apply/Bookkeeper-Experienced-With-Cryptocurrency-Transactions-and-Vendor-Payments_~022082276029369926101/) | [ASSUMPTION: secondary, search] |
| S3 | Manual close of invoices after USDC receipt | Search summary of a forum post: a Coinbase Business user receives USDC, withdraws to a bank, then manually marks the QuickBooks invoice paid (thread not identified precisely). | (no stable link) | [ASSUMPTION: secondary, search — weak, do not use outward] |
| S4 | Reconciliation questions in QuickBooks | A Reddit snapshot (via a mirror site) asks how people track and reconcile stablecoin transactions in QuickBooks; replies not visible. | [mirror snapshot](https://reddit.sentinel-team.org/posts/1rl3v7z/snapshots/2026-03-07T00%3A28%3A44.251359Z) | [ASSUMPTION: secondary, search — weak] |
| S5 | Wrong network help articles exist at other gateways | BoomFi help: "I used the wrong network for my payment, what now"; OpenNode: under/overpayments for payers. | [BoomFi](https://intercom.help/boomfi/en/articles/10470589-i-used-the-wrong-network-for-my-payment-what-now), [OpenNode](https://help.opennode.com/en/articles/6083068-underpayments-and-overpayments-for-payers) | [ASSUMPTION: secondary, search] |
| S6 | Prior research (Clearline spec) | Help centres of Binance.US, Kraken, Trust Wallet, OneKey, Cobo, Revolut on not-arrived deposits, wrong network, fake tokens | [INTERNAL: docs/SPEC.md §2 sources] | as labelled in the spec |

## C. What this does and doesn't show
- Shows: the failure modes Clearline targets (short after fees, wrong network/asset, no memo/reference,
  failed, refunds as new payments) are common enough that gateways publish help and settings for them.
- Doesn't show: frequency, cost per exception, or that any controller would pay to fix it. Gateways
  also handle much of this **for checkout payments**; the open question is how many payments skip the
  checkout [INTERNAL: OBJECTIONS.md "Our gateway does this"].
- No "no reference" complaint from a finance team was found in a forum this run. Treat it as
  `[ASSUMPTION]` from Clearline's own spec until a real call or post supports it.

## First refresh to-do
Re-run forum searches when reddit.com, community.xero.com, quickbooks.intuit.com/community and
trustpilot.com are reachable; open S1–S5; add only posts with a stable link.
