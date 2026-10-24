# Five-minute demo: stablecoin payment requests

One sample business, Harbor & Pine Supply Co., receives USDC invoice payments on Ethereum.
Everything is synthetic and labelled: the business, customers, addresses and transfers. Transfers
come from a simulated provider. Say so in the first sentence.

## Setup (2 minutes, before the call)

```
npm ci
npm run build
npx next start            # http://localhost:3000, no keys or network needed
```

1. Open `http://localhost:3000/requests`.
2. Click **Load the demo day**. If it was used before, click **Reset demo** instead.
3. Type your name in **Acting as** the first time you are asked.
4. Open two windows side by side:
    - left: `/requests/REQ-1041` (the business);
    - right: its **Sender page ↗** (the customer).

The pages update by themselves every few seconds.

## Script

**0:00 The problem (30 s).** "A business sends an invoice payable in USDC. Today the customer gets an
address in an email and hopes they picked the right network. Finance then checks an explorer to see
whether anything arrived. Here's a sample business's day, with everything synthetic and labelled."

**0:30 The sender's view (40 s).** On the right-hand page, say: "This is what Acme sees."

- Point at the amount, **USDC on Ethereum**, Circle's contract, and the address in groups of four
  with the ends highlighted.
- Read the warning aloud: "Other tokens or networks won't arrive. Transfers can't be reversed."
- Point at the QR code: "a standard Ethereum payment request. Not every wallet reads it, and the
  page says so."

**1:10 Routine payment (60 s).**

1. Left page, **Demo controls**: click **Acme Logistics sends 1,250.00 USDC**. Both pages show
   **Transfer detected**.
2. Click **Include in a block** → **Confirming 0 of 12**.
3. Click **Add 12 confirmations** → **Matched**.

Stop on "Matched": "The money is on-chain, but that doesn't mean Acme was credited. The next
action says to credit it in your own system, then acknowledge it here."

4. Click **Acknowledge payment** → **Completed**. The sender's page turns **Paid**.
5. Scroll to **Activity**: who did what, and when.

**2:10 Short payment (60 s).** Open **REQ-1042** (Brightline, 4,800.00).

1. Click **Brightline Studio sends 3,800.00 USDC**, then **Include in a block**, then
   **Add 12 confirmations**.
2. Point out:
    - the state is **Needs review**;
    - **Outstanding 1,000.00** is shown in amber;
    - "Why it needs review" gives the reason;
    - the reply draft asks for the remaining 1,000.00;
    - the sender page now asks for **1,000.00**, and so does its QR.
3. Type a note, "Emailed Brightline", and click **Ask for the balance**. The request stays open.
4. Optional: click **Brightline sends 1,000.00 USDC**, mine and confirm it → **Matched**.

**3:10 Look-alike token (60 s).** Open **REQ-1043** (Orbit, 2,000.00).

1. Click **Orbit Retail sends 2,000.00 look-alike "USDC"**, then mine and confirm it.
2. Point out:
    - the state is **Needs review**;
    - **Received 0.00**;
    - the transfer says **Not Circle's USDC contract**;
    - the engine verdict is **D06 Fake token**, with the evidence timeline beside it.

"It calls itself USDC. The contract isn't Circle's, so it never counts."

3. Point at the reply draft and **What this can't tell you**: simulated, so no freeze or history
   check is made, and none is claimed.
4. Type a note, "Counterfeit; customer told", and click **Not a payment for this request**. The
   transfer and its evidence stay on file.

**4:10 Honesty and the queue (40 s).**

1. Click **Deliver last event again**. Nothing changes, and the activity log says the repeat was
   ignored.
2. Go back to **Payment requests**: one completed, one waiting for a balance, one cleared fake.
   Every item has a single next action.
3. Close: "Next, we'd run this on your real requests. Live detection replaces the demo controls."

## What's real, what's simulated, what's next

| Working now | Simulated in the demo | Production work still needed |
| --- | --- | --- |
| Requests, sender page, QR, states, matching, decisions, activity, persistence, reset | Transfers and blocks (the "Simulated provider") | Watching addresses for incoming transfers (today a real transfer is recorded by pasting its hash) |
| Engine checks on every transfer (D06 fake token, D03 failed, D12 arrived not credited...) | The business and its customers | Unique receiving address per request from the business's wallet or custody provider |
| A live, read-only Ethereum lookup by transaction hash | | Notifications, sign-in and roles, a database |
| Duplicate, ambiguous and short or over payment handling | | More tokens and networks, paid RPC providers |
