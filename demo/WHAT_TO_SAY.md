# What to say if…

These are honest answers. Where something isn't built, say "not yet". A finance lead trusts "not yet"
more than a dodge.

**"Is this real data?"**
No. It's a fictional business, and every customer, message, address and transaction is demo data. The
transaction hashes start with eight zeros so they can't be mistaken for real ones. The matching, checks
and rules are the real code.

**"Is it secure? Do you hold our funds or keys?"**
We never hold funds or keys, and we never move money. The product only *reads*: public blockchain data
and the receiving addresses you give it. Refunds are drafted as instructions for your treasury team to
send from your own wallet.
*Not yet:* sign-in and roles (today the name on each action is typed in, not verified), a security
audit, or SOC 2. Those come before any real customer data goes in.

**"What does it cost?"**
We haven't set pricing. We're working it out with our first design partners. What do you spend on this
today, in people's hours? That's what it has to beat.

**"Which chains and tokens?"**
Today: USDC and USDT on Ethereum. A payment sent on Tron is detected as a wrong-network payment, with
whether it's recoverable.
*Not yet:* receiving on Tron, Solana, Base, Polygon or other networks. Tell us which ones you use; that
decides what comes next.

**"What data would you need from us?"**
For the first pilot: the receiving addresses you use, and your open invoices (customer, invoice number,
amount, token). No customer personal data is needed. Optionally, an export of past payment support
tickets so we can measure the product against your real cases.
*Not yet:* a connection to your accounting system. Today "mark paid" is recorded in the app, not pushed
to Xero or NetSuite.

**"How do you know which invoice a payment is for?"**
Each invoice gets its own receiving address, so the address identifies the invoice, not the amount.
When money arrives without that (at a shared address, or with no reference), we never guess. We show a
suggested match with the evidence (exact amount, a sender address seen before, timing), and a person
confirms it.

**"Isn't auto-marking paid risky?"**
The rule only marks paid a payment that is the exact amount, in the genuine token from the issuer's
contract, sent to that invoice's own address, and fully confirmed. Anything else waits for a person.
The rule is recorded as the actor, so the audit trail says who marked it paid and why. It's set on each
request when the request is created. It's on in the demo and off by default in live mode.
*Not yet:* a settings screen to switch it on or off.

**"How accurate is the 'likely cause' or the 'time saved'?"**
"Likely cause" is an inference from the evidence, and the page labels it that way. Only the customer can
confirm why they sent less. "Time saved" is a demo estimate (6 minutes per payment matched automatically
and 20 per exception explained). It isn't measured. We'd measure it on your tickets in a pilot.

**"Can't we build this ourselves?"**
You could, and some teams do. It isn't one feature, though. It's matching that never decides on amount
alone, counterfeit-token detection, wrong-network and recoverability rules, duplicate-event handling,
address-poisoning checks, plus an audit trail and customer wording for every case. Then you maintain all
of it as tokens and scams change. The question is whether that's where you want your engineers.
We'd rather earn it on a pilot than argue it.

**"Who's using it?"**
No one in production yet. This is an early product, and we're looking for design partners. That's why
the three questions at the end matter.

**"What happens if a blockchain data provider goes down?"**
In live mode a check that can't reach the chain says "paused" and concludes nothing until it can. It
never reports a guess.

**"Can customers pay by card or bank transfer too?"**
Not yet. Today it covers stablecoins only.
