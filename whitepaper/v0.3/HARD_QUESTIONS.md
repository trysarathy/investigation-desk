# The 20 hardest questions, with suggested answers

These are for the meeting with an experienced crypto investor and mentor. Each answer is short, and each is true as of 29 October 2026.
Section numbers refer to the working paper **v0.3**. **[FOUNDER'S ANSWER]** marks the two answers only Aashmiin can write.

---

**1. You have zero customers. How do you know anyone has this problem?**
I don't know yet. That is what I'm testing now. The failure modes are real. What I haven't measured is how often a normal
business runs into them, or what they cost. Outreach started on 29 October. The next goal is 20 calls and 3 paid pilots. If
exceptions turn out to be rare or cheap, I'll change the wedge or stop. *(Sections 1, 8, 10.)*

**2. Request Finance already sends crypto invoices, and its protocol logs a payment reference on-chain. Why isn't that enough?**
For a payer who pays through Request's own flow, it probably is enough. That payment goes through a contract that logs a
reference tied to the invoice. Matching is exact, and partial payments add up. My hypothesis is that many B2B payers
send a plain transfer instead, from an exchange, a treasury wallet or a custody platform, with no reference. Clearline
works with plain transfers, and the price is harder matching. I haven't yet tested Request Finance against real cases,
so I can't claim to be better. *(Section 3.)*

**3. Stripe, Coinbase and Circle are vertically integrating. Won't checkout absorb this?**
For businesses happy with a processor, yes, and Clearline isn't for them. Stripe supports USDC but not USDT. It caps a
transaction at US$10,000 and doesn't list Singapore. The bet is on businesses that get paid directly. The risk is that
this segment shrinks. *(Section 3.)*

**4. What actually happens in live mode today?**
Much less than in the demo:
- Someone pastes a transaction ID, and Clearline checks it read-only on Ethereum.
- Nothing watches wallets, and confirmations aren't polled. A payment pasted early stays "confirming" until someone
  pastes it again.
- A person marks each payment paid.
- Pasting from a request's page doesn't tie the payment to that request. If several open requests share one wallet
  address, a person assigns the payment.
- Unidentified-payment suggestions and wrong-network recording work only in the demo.

Wallet watching, confirmation polling and Tron all come before any live pilot. *(Section 8, "Live today vs demo only".)*

**5. Most B2B USDT moves on Tron. Why Ethereum only?**
I built where my tools were. USDC and USDT both live on Ethereum, which holds about 49% of stablecoin supply; Tron holds
about 31%. But my target customers in Singapore and Hong Kong probably use Tron for USDT, an assumption I'll check in
calls. So Tron payment pages are the first change on the roadmap. *(Sections 2, 8, 9.)* *Aashmiin: confirm that this
reason is yours, or replace it.*

**6. Has the accounting integration ever posted to real books?**
No. The Xero adapter is tested against recorded API shapes, and the posting rules play through in the demo. It has
never posted to a live Xero organisation. QuickBooks hasn't been run on a sandbox, and NetSuite is designed only.
*(Section 8.)*

**7. Your accuracy numbers come from a test you designed. Why trust them?**
Don't treat them as real-world accuracy. They come from the earlier deposit-investigation product, whose checking
engine Clearline reuses. It got 59/59 real public transactions right, with sample company data, and 52/52 on a set
built afterwards. A source outside the product proved each answer, and an independent reviewer re-checked 7. Clearline's
own matching has been tested only on simulated data. The real measure will be the pilots' actual cases. *(Section 8.)*

**8. Would you let a pilot customer connect their Xero today?**
Not yet. Several fixes come first:
- There's no sign-in.
- Xero tokens are stored unencrypted.
- The audit log isn't tamper-evident.
- The granular Xero permissions in pull request 36 haven't been merged or tested live.

All of these get fixed before the first live pilot. *(Section 8, "Known gaps".)*

**9. Are you a regulated payment business?**
No. Clearline never receives, holds or moves funds. My assumption, not yet checked by a lawyer, is that this keeps it
outside Singapore's licensing for digital payment token services. HitPay is a useful comparison: its licensed partner
handles the stablecoins. Refunds, conversion or sweeping funds would cross that line, so they stay out. *(Section 6.)*

**10. US$200 a month. How is this venture-scale?**
On its own, it isn't. My bottom-up guess is 500–2,000 businesses in Singapore and Hong Kong at US$2,400 a year, which
gives US$1.2–4.8M a year. Getting to scale would need one or more of these:
- more regions;
- larger customers;
- payment-company partners paying per exception;
- a shared instruction format that wallets adopt.

None of that is proven. *(Section 9.)*

**11. With one treasury address, how does a payment reach the right invoice without a person?**
Today it doesn't. With one shared address, Clearline matches by evidence (exact amount, a known sender, a unique
amount), and a person confirms. There are three options:
- an address per invoice from the customer's own custody provider, with Clearline staying read-only;
- unique amounts;
- a payment reference that the payer's flow supports.

I'll test which one pilots accept. *(Sections 5 and 8.)*

**12. What about sanctions screening?**
Clearline doesn't screen against OFAC or UN lists and doesn't use Chainalysis or TRM. The paper doesn't claim compliance
screening. The issuer-freeze check barely matters for receipts, because a transfer from a frozen sender fails on-chain.
The real risks are these:
- The business's own address could be frozen. Clearline checks this when a hash is looked up.
- The funds could be tainted. Clearline doesn't detect this.

For now, screening stays the business's responsibility. An analytics integration is on the roadmap. *(Section 6.)*

**13. How is a stablecoin classified in the accounts, and is booking it at par into a bank account acceptable?**
It's an open question. In the US, the FASB proposed in August 2026 how some stablecoins can count as cash equivalents.
Comments close on 19 November, and nothing is final. I haven't found settled IFRS or SFRS(I) guidance specific to
stablecoins. So par valuation into a bank-type account is a default that the customer's accountant must accept, and the
account mapping should be configurable. *(Section 5, "Finality and valuation".)*

**14. Are you full-time on this?**
**[FOUNDER'S ANSWER: written by Aashmiin. Say honestly whether you are full-time or part-time, your study load, your other commitments, your hours a week on Clearline, and when that changes.]**

**15. How many times have you pivoted, and what evidence caused each pivot?**
**[FOUNDER'S ANSWER: written by Aashmiin. List each earlier idea, what you learned, and whether real evidence (calls, data) or your own reasoning drove the change.]**

**16. Who is liable when Clearline is wrong?**
No funds pass through Clearline, and a person approves every posting. The intended terms limit liability to the fees
paid. Before real volume, I need professional indemnity insurance. A lawyer hasn't reviewed any of this yet. *(Section 6.)*

**17. What does one customer cost, and how will you reach customers at US$200 a month?**
I don't know yet what it costs to win a customer. The running costs are a paid chain-data provider (I guess US$50–300 a
month at pilot volumes) and one container per customer. Support time hasn't been measured. At US$200 a month there's no
room for a sales team. That means founder-led outreach now, and partners (accountants, payment companies) later.
*(Section 9.)*

**18. Why wouldn't a business just use HitPay?**
Many should. For Singapore merchants, HitPay accepts USDT, USDC and PYUSD on several networks, including Tron, through a
licensed partner, and pays out fiat. Clearline is only for a business that wants to keep the stablecoins in its own
wallet, or whose payers won't use a checkout. If calls show those businesses are rare, that's the answer. *(Section 3.)*

**19. BIP70 failed. Why would your instruction standard be adopted?**
It may not be, and I'm not building one now. BIP70 tied payment requests to the web's certificate system. It saw little
adoption and was removed from Bitcoin Core in 2019. The lesson I take is to start from what wallets already read
(EIP-681), and to add a signature only where a wallet team agrees to verify it. Nothing gets published as a "standard"
until customers use it. *(Section 7.)*

**20. Has the Xero sign-in been tested under Xero's 2026 granular scopes?**
Not yet. Xero apps created on or after 2 March 2026 must use granular scopes. Pull request 36 replaces the old broad
`accounting.transactions` scope with `accounting.invoices`, `accounting.payments`, `accounting.banktransactions` and
`accounting.contacts.read`. It isn't merged yet. The Xero Demo Company test will be the first live run. *(Section 8.)*

---

**One question to ask them back:** "From the businesses you've seen take stablecoins directly, who would you call first,
and what would make them pay for a pilot?"
