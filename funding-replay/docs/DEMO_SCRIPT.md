# 90-second demo script

Show this **only after** the buyer has walked you through their own last payout (Validation Plan,
days 1–3). Open http://127.0.0.1:8765 beforehand. Scenario: **Reference week**. Rate: **8%**.

**0:00 — Friday decision (≈30 s).** Decision time: *Friday funding decision*.
> "It's Friday 3 pm in Singapore. You owe a US supplier USD 100,000 net, spendable by Wednesday
> 23:00 Singapore, 10:00 New York. The question isn't 'is Monday cheaper?' — it's 'can you show, right
> now, that Monday is actually available?' Here the answer is no: there's no Monday quote, no reserved
> capacity and no fallback on record. So the evidence says keep Friday's window. Notice there's no
> Monday number on this screen at all — nobody knew it on Friday."

Point at: the headline, "What evidence is missing?", the empty Monday card, the evidence trail (only
records known by Friday 15:00).

**0:30 — Hindsight (≈25 s).** Switch to *Retrospective comparison*.
Read the headline aloud: *"In hindsight, Monday tied up cash for fewer days — waiting was not supported
on Friday."*
> "Now look back. Each slot was feasible on the evidence known by its own funding time. Waiting would have restricted
> the SGD for 2 days instead of 5 — 405,000 SGD-days less. At an assumed 8% that's SGD 88.77 of carry,
> minus SGD 10 extra processing: SGD 78.77 before any subscription. But see the label: hindsight only. It
> wasn't available to you on Friday, and supplier credit was never observed."

Click **0%**:
> "And if that cash would just have sat idle, waiting costs SGD 10 more. The rate is an assumption — your
> number, not ours."

Click **8%** again.

**0:55 — Delayed receipt (≈20 s).** Scenario: *Forecast customer receipt*, Decision time: *Monday checkpoint* (note the amber
"Counterfactual" tag: this asks what would have happened had the SGD been held).
> "Different week. Suppose they had held the SGD. Monday's usable cash would have been SGD 130,000 against SGD 135,382.50 required — short by
> SGD 5,382.50. A customer receipt that lands on Tuesday can't pay Monday's instruction, so the tool
> withholds any comparison. Waiting would have left them short on the day they had to fund."

**1:15 — The question (≈15 s).** Leave the screen and ask:
> "What could you actually have done with that cash on Friday — and did your agreement with your bank or
> provider let you wait?"

Then stop talking. Note the answer word for word in the Calls tab.

Optional — old bank balance (≈15 s): Scenario *Friday-afternoon balance*, Decision time *Monday checkpoint*.
> "Here the newest bank balance is Friday 14:00 — 73 hours old at Monday's 15:00 slot. Our demo rule is 24
> hours, so the tool won't call Monday feasible or short. It asks for a newer balance first."

Optional if asked: *Pre-agreed later slot* on Friday shows **Manual review before waiting** — the terms to
verify and what reserving Monday would cost (SGD 25.00) — with no benefit figure, and is explicitly not a
recommendation to wait.

Do not say "savings", "we save you" or quote a monthly figure. Every number on screen is synthetic.
