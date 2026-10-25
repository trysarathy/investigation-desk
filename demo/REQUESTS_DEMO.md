# Three-minute demo: stablecoin payments without the mess

**Audience:** a finance-ops or payments-ops lead at a company that receives stablecoin payments.
**Data:** everything is fictional and labelled "Demo data". The business is Northwind Pay Pte Ltd
(Singapore), and the transfers come from a simulated provider. Say so in your first sentence.

## Before the call (2 minutes)

```
npm ci
npm run build
npx next start            # http://localhost:3000 · demo mode is on by default · no keys, no network
```

1. Open `http://localhost:3000`. It opens on **At a glance**.
2. Click **Load the demo day**. If you rehearsed already, click **Reload demo day** at the bottom of the
   page, then click it again to confirm. The demo always starts from the same state.
3. Make the browser window 1280×720 or larger. On a projector, zoom to 100%.
4. Have a second window ready for the customer's payment page.

If anything goes wrong mid-demo, click **Reload demo day** twice. It takes one second.

## The script

**0:00 The pain (15 s).** Say:

> "If you take stablecoin payments, you know the emails: *'we paid yesterday, why is the invoice still
> open?'* Someone opens a block explorer, works out which invoice it was, and finds it was short, or a
> fake token, or sent on the wrong network. This is what that looks like instead. It's a fictional
> business; all of this is demo data."

**0:15 At a glance (25 s).** Point at the headline, then the numbers.

> "This week: 18 payment requests sent and 16 payments arrived. 11 of those were matched and marked paid
> with nobody touching them. Five need a person, and for each one the product already says what
> happened and what to do."

Run your finger down **Needs attention**: blocked, unidentified, short payment, wrong network, paid twice.

**0:40 a. Routine: Acme (25 s).** In **Arriving now**, click **▶ Play Acme's payment**. The status
moves from payment seen to confirming to paid, in about four seconds. Click **Acme Logistics** to show
the result.

> "Exact amount, genuine USDC, to that invoice's own address, fully confirmed: marked paid by the
> matching rule. That's most payments. Nobody touches them."

**1:05 b. Short payment: Brightline (30 s).** Go back to **At a glance**, then click **Brightline Studio**.

- Read the customer's email at the top: *"Why is invoice INV-1042 still showing as unpaid?"*
- **What happened:** short by 50.00 USDC.
- **Likely cause:** fees deducted. It came from an exchange's withdrawal wallet, and it's 1.0% of the
  invoice. Point at the label: "an inference, not a fact".
- **Reply:** a polite top-up request, ready to copy.

> "That was a 20-minute investigation. Now it's a copy and paste."

Optional: click **Sender page ↗**. The customer's page now asks for exactly **50.00 USDC**.

**1:35 c. Counterfeit token: Orbit (30 s).** Go back, then click **Orbit Retail**.

> "Orbit says they paid 7,500 USDT. Something called USDT did arrive, but from a contract Tether doesn't
> control. Anyone can create a token named USDT."

Point at the two contracts listed side by side, then at **Mark paid** greyed out: "It can't be marked
paid by mistake." Then point at the reply, which explains it to the customer without accusing them.

**2:05 f. Look-alike address: Fernhill (30 s).** Go back. Under **About to pay**, click
**Open their payment page ↗**.

> "This is what their customer sees: what to send, which network, and the address in groups so they
> can check it. Fernhill said they'd use the address from last time, which is how address-poisoning
> scams catch people."

Click **Demo: paste the address from Fernhill's wallet history**. The red result says: **"Stop: don't
send to this address."**

> "Same first and last characters, different address. It's caught before any money moves."

Switch back to the ops window and open **Fernhill Foods**. It now shows **Scam stopped** in blue,
because it's good news, with a security note drafted for the customer. (Before the check, its next step
already flagged the risk in the customer's own chat message: *"I'll use the address from last time."*)

**2:35 e. Unidentified payment: Kite (20 s).** Go back, then click the **Unidentified** row.

> "2,180 USDC arrived at the main address with no reference. The product suggests Kite's invoice and
> shows why: the exact amount, a wallet Kite has paid from before, no other invoice for that amount. It
> never matches on a guess. A person confirms."

Type a short reason (for example "exact amount from Kite's usual wallet") and click
**Confirm: this pays INV-1045**. Every decision needs a note in the person's own words: the product
never writes one for them.

**2:55 Close (5 s).**

> "Most payments close themselves. Every exception comes with the cause, the evidence and the reply.
> Can I ask you three questions?"

## The three questions (ask them, then stop talking)

1. **How do you handle wrong-network, short or unidentified payments today?**
2. **How many happen a month?**
3. **Would you share an export of your payment-related support tickets?** (Redacted is fine. It's how
   we'd prove the product on your real cases.)

Write the answers down word for word.

## If you have extra time

- **d. Wrong network, Meridian:** USDT sent on Tron for an Ethereum invoice. It's recoverable because
  it landed in Northwind's old Tron wallet. The next step is for treasury to confirm, then count it.
- **g. Paid twice, Kestrel:** two identical payments 4 minutes apart. A refund instruction for treasury
  and a reply are drafted. The app never sends money.
- **Repeated events:** on any case with a transfer, open **Demo tools**, then click **Deliver the last
  event again**. The activity log says it was ignored, because it counts once.

## What's real, what's simulated, what's next

| Working now | Simulated in the demo | Production work still needed |
| --- | --- | --- |
| Requests and sender pages, QR codes, matching, the auto-match rule, short, over and duplicate payments, counterfeit-token and wrong-network detection, scored suggestions for unidentified payments, the look-alike address checker, decisions with notes, an activity log, a read-only live Ethereum lookup by hash (live mode) | The business, customers, messages and every transfer (the "simulated provider"), and the "time saved" estimate | Watching addresses automatically, connecting to an accounting system (Xero, NetSuite and others), sign-in and roles, a database, notifications, more networks, a unique address per invoice from your custody provider |

A backup recording of the full demo is in `demo/demo-a-plus.mp4`.
