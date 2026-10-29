---
title: "Clearline"
author: "Aashmiin Kaur, founder"
date: "29 October 2026 · one-page summary of the white paper (v0.1)"
---

**The problem.** Stablecoins now carry real commerce: about US\$400 billion of real-economy payments in 2025, an estimated 60% of them business-to-business (Bessemer, April 2026). But a blockchain transfer is not a completed business payment. Payments arrive short, on the wrong network, in counterfeit tokens, with no invoice reference, twice, or to a look-alike address. Finance teams sort this out by hand with block explorers and spreadsheets, after the money has moved.

**The product.** Clearline is a read-only layer between "money moved" and "invoice closed" for businesses paid straight into their own wallets:

1. **Instruction:** a payment page per invoice with the exact amount, the issuer's token contract, the network and an address checker that stops look-alike addresses.
2. **Verification:** deterministic checks with evidence (genuine token, network, failed, confirmations, issuer freeze).
3. **Matching:** conservative attribution; never decided by amount alone; a person confirms uncertain matches with a reason.
4. **Explanation:** plain-English cause, next step and customer reply, built from the records.
5. **Accounting:** prepares the entries and, after a person approves, posts them (Xero connection in testing). Counterfeit, failed and wrong-network payments are never posted.

Clearline never holds funds or wallet keys. Staying read-only is also our regulatory position; we have not yet taken legal advice on it.

**Evidence so far.** Working demo with seven payment situations, played end to end through to the books (113/113 browser checks). 573 automated tests pass. On real public transactions, the checking engine was correct on 59/59 cases after fixes and 52/52 on a held-out set. **Not yet:** customers (0), customer calls (0; outreach began 29 Oct 2026), a live Xero run (the Demo Company test is next), automatic detection (today someone pastes the transaction ID; nothing watches addresses), payment pages beyond Ethereum (Tron is next), sign-in, and encrypted storage of accounting tokens.

**Market and competition.** Real payments are only about 0.6–2% of stablecoin transfer volume (Reap, citing BIS, BCG and McKinsey). Processors (Stripe, Coinbase, HitPay) put themselves in the middle; crypto accounting tools (Bitwave, Request Finance, TRES, Cryptio) already sync to ERPs. Our hypothesis: the unserved user is the small or mid-sized business paid directly, where the cost sits in exceptions and in bad payment instructions.

**Business.** First buyer (hypothesis): finance lead or founder at a Singapore or Hong Kong business invoicing in USD and paid in USDC/USDT. Founding pilot US\$300 for 30 days, then US\$200/month (untested). Path: wedge (exceptions and booking), then network (payer-side verification, sender history), then an open, signed payment-instruction and receipt format that wallets and auditors can verify.

**Biggest risks.** Demand is unproven; processors or accounting tools may absorb the problem; licensing if any feature ever touches funds; fragile public chain data; security maturity of a one-founder product.

**Next 90 days.** Xero Demo Company live test; fix sign-in and token encryption; address watching on Ethereum; 20 customer calls; 3 paid pilots measured on real exceptions.
