---
title: "Clearline"
author: "Aashmiin Kaur, founder"
date: "29 October 2026 · one-page summary of the working paper (v0.2)"
---

**The problem.** Real-economy stablecoin payments reached an estimated US\$350–550 billion in 2025 (BCG; about US\$390 billion per McKinsey/Artemis), roughly 1% of gross stablecoin transfers (Reap, August 2026). But a blockchain transfer is not a completed business payment. Payments arrive short, on the wrong network, in counterfeit tokens, without a reference, twice, or to a look-alike address. Finance teams sort them out by hand, after the money has moved.

**The product.** Clearline is a read-only layer for businesses paid straight into their own wallets: (1) a payment page per invoice with the exact amount, the issuer's token contract, the network, and an address checker that warns the payer about look-alike addresses; (2) deterministic checks with evidence; (3) conservative matching, never decided by amount alone; (4) plain-English explanations and replies; (5) accounting entries that post only after a person approves (Xero connection in testing). Counterfeit, failed and wrong-network payments are never posted. Clearline never holds funds or wallet keys.

**What works, and what doesn't yet.** All seven payment situations play through to the books in the demo with a fictional company. Live mode is thinner: someone pastes the transaction ID; nothing watches addresses or polls confirmations; correct payments are marked paid by a person; with one shared treasury address most payments need a person to assign them; payment pages are Ethereum only. Xero has not run on a live organisation, and its permissions need updating to Xero's 2026 granular scopes. There is no sign-in, and Xero tokens are stored unencrypted.

**Evidence.** 46 tests cover Clearline's own request and accounting code. The checking engine it reuses, from an earlier product, was correct on 59/59 and 52/52 real public transactions with sample company data. **No customers or customer calls yet**; outreach began 29 October 2026.

**Competition.** HitPay already gives Singapore merchants stablecoin acceptance through a licensed partner; Stripe supports USDC but not USDT and caps transactions at US\$10,000; Request Finance offers crypto invoicing, and its protocol logs payment references on-chain. Our untested hypothesis: the gap is businesses whose payers send plain transfers to the business's own wallet.

**Business (hypotheses).** First buyers in Singapore and Hong Kong; Tron payment pages come first. Pilot US\$300 for 30 days, then US\$200/month. A bottom-up guess (500–2,000 businesses) gives US\$1.2–4.8M a year: a small business unless it grows into partners, more regions or a shared standard.

**Biggest risks.** Unproven demand; processors or Request Finance solving it first; licensing if anything ever touches funds; unsettled accounting treatment of stablecoins; one founder.

**Next 90 days.** Tron pages; address watching and confirmation polling; sign-in, encrypted tokens and granular Xero scopes; the Xero Demo Company test; 20 customer calls; 3 paid pilots measured on real exceptions.
