# The 20 hardest questions, with honest answers

For the meeting with an experienced crypto investor and mentor. Each answer is short and true as of 29 October 2026.
Section numbers refer to the working paper (v0.2). **[YOUR ANSWER]** marks the places only Aashmiin can fill in.

---

## The original ten (Q2, Q4 and Q5 revised)

**1. You have zero customers. How do you know anyone has this problem?**
I don't know yet; that's what I'm testing. The failure modes are real, but I haven't measured how often a normal
business hits them or what they cost. Outreach started on 29 October. My next goal is 20 calls and 3 paid pilots. If
exceptions turn out to be rare or cheap, I'll change the wedge or stop. *(Sections 1, 7, 9.)*

**2. Request Finance already sends crypto invoices, and its protocol logs a payment reference on-chain. Why isn't that enough?**
For a payer who pays through Request's flow, it probably is enough. The payment goes through a contract that logs a
reference tied to the invoice, so matching is exact, and partial payments add up. My hypothesis is that many B2B
payers send a plain transfer from an exchange, a treasury wallet or a custody platform, with no reference. Clearline
works with plain transfers, and the price of that is harder matching. I haven't yet tested Request Finance against real
cases. Until I do, I can't claim to be better. *(Section 3.)*

**3. Stripe, Coinbase and Circle are vertically integrating. Won't checkout absorb this?**
For businesses happy with a processor, yes, and Clearline isn't for them. Stripe supports USDC but not USDT, caps a
transaction at US$10,000 and doesn't list Singapore. The bet is on businesses paid directly. The risk is that this
segment shrinks. *(Section 3.)*

**4. What actually happens in live mode today?**
Much less than in the demo. Someone pastes a transaction ID, and Clearline checks it read-only on Ethereum. Nothing
watches addresses, and confirmations aren't polled: a payment pasted early stays "confirming" until someone pastes it
again. A person marks each payment paid. Pasting from a request's page doesn't tie the payment to that request, so if
several open requests share one wallet address, a person assigns it. Unidentified-payment suggestions and wrong-network
recording work only in the demo. Address watching, confirmation polling and Tron come before any live pilot.
*(Section 4.3.)*

**5. Most B2B USDT moves on Tron. Why Ethereum only?**
Honestly, I built where my tools were: the chain code I already had worked best on Ethereum, and USDC and USDT both
live there. Ethereum holds about 49% of stablecoin supply and Tron about 31%. But my target customers in Singapore and
Hong Kong probably use Tron for USDT (an assumption I'll check in calls). So Tron payment pages are the first change on
the roadmap. *(Sections 2, 8, 10.)*

**6. Has the accounting integration ever posted to real books?**
No. The Xero adapter is tested against recorded API shapes, and the posting rules play through in the demo. It has
never posted to a live Xero organisation. QuickBooks hasn't been run on a sandbox; NetSuite is designed only.
*(Section 4.3, Appendix A.5.)*

**7. Your accuracy numbers come from a test you designed. Why trust them?**
Don't treat them as real-world accuracy. They come from the earlier deposit-investigation product, whose checking
engine Clearline reuses: 59/59 real public transactions with sample company data, and 52/52 on a set built
afterwards. Each answer was proven by a source outside the product, and an independent reviewer re-checked 7. Clearline's
own matching has been tested only on simulated data. The real measure will be pilots' actual cases. *(Section 7.)*

**8. Would you let a pilot customer connect their Xero today?**
Not yet. There's no sign-in, Xero tokens are stored unencrypted, the audit log isn't tamper-evident, and the Xero
permissions need updating to granular scopes. So a pilot doesn't connect their Xero: it delivers matching,
explanations and a Xero-ready import file that their accountant reviews and imports. Live posting to a customer's Xero
is switched on only after the Xero sandbox tests pass and I approve it. *(Section 5.)*

**9. Are you a regulated payment business?**
No. Clearline never receives, holds or moves funds. My assumption, not yet checked by a lawyer, is that this keeps it
outside Singapore's licensing for digital payment token services. HitPay is a useful comparison: its licensed partner
handles the stablecoins. Refunds, conversion or sweeping funds would cross that line, so they stay out. *(Section 5.)*

**10. US$200 a month. How is this venture-scale?**
On its own it isn't. My bottom-up guess (500–2,000 businesses in Singapore and Hong Kong, US$2,400 a year) gives
US$1.2–4.8M a year. Scale would need more regions, larger customers, payment-company partners paying per exception, or
a shared instruction format that wallets adopt. None of that is proven. *(Section 8.)*

## Ten new questions

**11. With one treasury address, how does a payment reach the right invoice without a person?**
Today it doesn't. With one shared address, Clearline matches by evidence (exact amount, a known sender, a unique
amount) and a person confirms. The options are an address per invoice from the customer's own custody provider
(Clearline stays read-only), unique amounts, or a payment reference the payer's flow supports. I'll test which one
pilots accept. *(Section 4.4.)*

**12. What about sanctions screening?**
Clearline doesn't screen against OFAC or UN lists and doesn't use Chainalysis or TRM, and the paper doesn't claim
compliance screening. The issuer-freeze check barely matters for receipts, because a transfer from a frozen sender fails
on-chain. The real risks are the business's own address being frozen (checked when a hash is looked up) and tainted
funds (not detected). For now screening stays the business's responsibility; an analytics integration is on the
roadmap. *(Section 5.)*

**13. How is a stablecoin classified in the accounts, and is booking it at par into a bank account acceptable?**
It's an open question. In the US, the FASB proposed in August 2026 how some stablecoins can be cash equivalents;
comments close on 19 November and nothing is final. I haven't found settled IFRS or SFRS(I) guidance specific to
stablecoins. So par valuation into a bank-type account is a default the customer's accountant must accept, and the
account mapping should be configurable. *(Section 4.5.)*

**14. Are you full-time on this?**
**[YOUR ANSWER: state honestly: full-time or part-time; study load at SMU; other commitments; hours a week on Clearline; when that changes.]**

**15. How many times have you pivoted, and what evidence caused each pivot?**
**[YOUR ANSWER: list each version (e.g. Sarathy → settlement assurance → ClosTrace → Clearline), what you learned, and whether real evidence (calls, data) or your own reasoning drove it.]**

**16. Who is liable when Clearline is wrong?**
No funds pass through Clearline, and a person approves every posting. The intended terms limit liability to fees paid.
Before real volume I need professional indemnity insurance. None of this has been reviewed by a lawyer yet.
*(Section 5.)*

**17. What does one customer cost, and how will you reach customers at US$200 a month?**
I don't know the cost to win a customer yet. Running costs are a paid chain-data provider (I guess US$50–300 a month at
pilot volumes) and one container per customer; support time is unmeasured. At US$200 a month there's no room for a
sales team. That means founder-led outreach now, and partners (accountants, payment companies) later. *(Section 8.)*

**18. Why wouldn't a business just use HitPay?**
Many should. HitPay accepts USDT, USDC and PYUSD on several networks, including Tron, for Singapore merchants through a
licensed partner, and pays out fiat. Clearline is only for a business that wants to keep the stablecoins in its own
wallet, or whose payers won't use a checkout. If calls show those businesses are rare, that's the answer. *(Section 3.)*

**19. BIP70 failed. Why would your instruction standard be adopted?**
It may not be, and I'm not building one now. BIP70 tied payment requests to the web's certificate system, saw little
adoption and was removed from Bitcoin Core in 2019. The lesson I take is to start from what wallets already read
(EIP-681), add a signature only where a wallet team will verify it, and publish nothing as a "standard" until customers
use it. *(Section 6.)*

**20. Has the Xero sign-in been tested under Xero's 2026 granular scopes?**
No. Xero apps created on or after 2 March 2026 must use granular scopes, but the code still asks for the older broad
`accounting.transactions` scope. A separate pull request updates it, and the Demo Company test must use the new scopes.
*(Section 5.)*

---

**One question to ask them back:** "From the businesses you've seen take stablecoins directly, who would you call first,
and what would make them pay for a pilot?"
