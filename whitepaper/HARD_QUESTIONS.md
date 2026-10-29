# The 10 hardest questions, with honest answers

For the meeting with an experienced crypto investor and mentor. Each answer is short and true today. Where the paper
answers the question, the section is named. Where it can't be answered yet, the honest answer says so.

---

**1. You have zero customers. How do you know anyone has this problem?**

I don't know yet. That is the most important thing I'm testing. The failure modes are real: a US$50M look-alike-address
loss in December 2025, and counterfeit "USDT" tokens that we found among real transactions. But I haven't measured how
often a normal business hits them, or what they cost. Outreach started on 29 October. My next goal is 20 customer calls
and 3 paid pilots. If exceptions turn out to be rare or cheap, I'll change the wedge. *(Paper: 2.3, 8, 10.)*

**2. Bitwave, Request Finance, TRES and Cryptio already sync stablecoin payments to Xero and NetSuite. Why won't they just do this?**

They might, and they are real competitors. I haven't tested their products deeply yet, so I won't claim they can't
do it. My hypothesis is that they serve crypto-native finance teams after the money arrives. Clearline starts before
the payment, with the instruction and the address check, and it is built around exceptions for a business paid straight
into its own wallet. If a call shows that one of them already solves this well for that business, that's a signal to
narrow further or stop. *(Paper: 4, 10.)*

**3. Stripe, Coinbase and Circle are vertically integrating. Won't checkout absorb this?**

For businesses that are happy to use a processor, probably yes, and Clearline isn't for them. Stripe settles
stablecoin payments to a Stripe balance in local currency and, as of today, doesn't list Singapore. The bet is on
businesses whose customers pay them directly, without a processor in the middle. Bessemer's own advice is to build
outside those companies' paths. The risk is that the direct-payment segment shrinks. *(Paper: 4, 10.)*

**4. "Matched automatically" sounds good. What actually happens in live mode today?**

In live mode, a person pastes the transaction ID and Clearline checks it read-only on Ethereum. Nothing watches wallet
addresses yet, and automatic marking as paid works only in the demo. Address watching on Ethereum is the first roadmap
item. *(Paper: 5.3, 5.4.)*

**5. Most USDT moves on Tron. Why Ethereum only?**

Fair point. Tron holds about 31% of stablecoin supply and Ethereum about 49%. I started on Ethereum, where both USDC and USDT
live and which holds the largest share of supply. The checking engine already reads
Tron, but payment requests don't. Tron payment requests are next, and if the calls show the pain is mostly on Tron, they
come first. *(Paper: 5.2, 11.)*

**6. Has the accounting integration ever posted to a real set of books?**

No. The Xero adapter is built and tested in automated tests against recorded API shapes, and the posting rules play
through in the demo with a fictional company. It has never posted to a live Xero organisation. The test with Xero's Demo
Company is next. QuickBooks is built against the documentation but hasn't been run on a sandbox. NetSuite is designed only.
*(Paper: 5.6.)*

**7. Your accuracy numbers come from a test you designed. Why should I trust them?**

You shouldn't treat them as proof of real-world accuracy. They show the rules do what they were designed to do: 59/59
real public transactions after fixes, and 52/52 on a held-out set built afterwards. Each answer was proven by a source
outside the product, and an independent reviewer re-checked 7 cases on-chain. But the sample is small, and request
matching has been tested only on simulated data. The real measure will be each pilot's actual cases, and I'll publish the
error rate. *(Paper: 8.)*

**8. Would you let a pilot customer connect their Xero to this today? What about security?**

Not before fixing the basics. Today there is no sign-in (the user types a name, with an optional shared password),
Xero tokens are stored unencrypted, and the audit log isn't tamper-evident. All of this is written in the paper.
Sign-in and encrypted tokens come before the first live pilot. Until then a pilot runs in its own deployment, which can be
in the customer's own cloud, behind a long random password. *(Paper: 6.3.)*

**9. Are you a regulated payment business? What stops you sliding into custody?**

Clearline never receives, holds or moves funds, and has no wallet keys. My assumption, which I have not yet checked
with a lawyer, is that this keeps it outside Singapore's Payment Services Act licensing for digital payment token
services. HitPay is a useful comparison: it says its MAS-licensed partner handles the stablecoins and HitPay itself doesn't.
Refunds, conversion or sweeping funds would cross that line, so they stay out. I'll get legal advice before the first
paying customer. *(Paper: 6.1, 10.)*

**10. US$200 a month from small businesses. How does this become a venture-scale company?**

I don't know yet, and the price is an untested placeholder. The thesis has three steps: start with a small wedge
(exceptions and booking); build a network (every payment page teaches payers to verify, and sender history improves
matching); and aim for an open, signed payment-instruction and receipt format that wallets and auditors use. Only the
first step is built. A per-exception fee embedded in payment companies' products is one alternative model. The honest
answer is that pilots have to show the value per customer before the scale question can be answered. *(Paper: 7, 9.)*

---

**One question to ask them back:** "From the businesses you've seen take stablecoins directly, who would you call first, and what would make them say yes to a paid pilot?"
