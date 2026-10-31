# Task 1: Morning prep, 07:07 run, Mon 2 Nov 2026 (SGT)

Live tools OFF. Everything below is what I WOULD WRITE / WOULD SAVE. Nothing is sent, shared or put on a calendar.

## P0 start-of-run
- Settings `PAUSE` = FALSE (fixture shared state). WOULD RUN Gmail search `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d` for PAUSE: none in fixtures.
- Google connection = aashmiin@gmail.com (not hatch.sg). OK to continue.
- Read-first done: COMPANY_RULES, RULES.md + CALL_SCRIPT.md (`origin/gtm-os`), knowledge pack (refreshed 2026-10-31, not stale), OBJECTIONS / templates / CLAIMS_AUDIT (`origin/enterprise-pack`), HARD_QUESTIONS (`origin/whitepaper`), playbook, rubric.
- Offer noted: founding pilot US$300 for 30 days, then US$200/month, first 10 businesses (0 of 10 signed). Template terms NOT in her brief: credit months 2-4, refund clause, "cancel any time", escrow/self-host, invoicing entity.
- Web is OFF this run, so no company page was re-opened live. Every account fact below is labelled accordingly; nothing is [VERIFIED].

## Calendar today + tomorrow: what I prep and what I skip
| Event | Decision | Why |
|---|---|---|
| Mon 2 Nov 10:00-10:30 Clearline x Harbourline Trading | **PREP (full brief)** | External sales call; L201 in Leads, stage Call booked; invitees on harbourline.example |
| Mon 2 Nov 13:00 "Lunch - Prof Paul Griffin" | **SKIP, no prep** | Mentor (COMPANY_RULES 6). Title only. |
| Mon 2 Nov 16:00 "Dentist" | **SKIP, no prep** | Personal event. Title only. |
| Tue 3 Nov 11:00-11:20 Clearline demo - Saltmarsh Digital | **PREP (short brief + demo path)** | External sales demo; L202 in Leads, Strong on 27 Oct |

---

## WOULD SAVE (private Google Doc, her Drive, not shared): `Clearline call prep Harbourline Trading 2026-11-02`

**Clearline call prep: Harbourline Trading Pte Ltd: Mon 2 Nov 2026, 10:00-10:30 SGT (15-minute learning call)**
Lead L201 · Tier 1 · booked by revops-crm-agent from Mei Tan's reply of 29 Oct (thread th-201). Internal: for Aashmiin only.

**RISKS / FIT WARNING FIRST**
- **Tron fit risk.** Mei wrote they're "mostly on Tron" (Touches th-201, 29 Oct). Clearline payment pages are **USDC/USDT on Ethereum only** today; Tron payment pages are roadmap, **no date**. **Address watching is not built** (a person pastes the hash). The checker *can* check a reported USDT transfer on Tron by hash, but the invoice/request flow and live lookups for requests are Ethereum-only (CLAIMS_AUDIT #7, #19, #32). **Don't offer or imply a pilot that needs Tron payment pages or automatic detection.** If they ask: "not today; I'll follow up in writing on what a pilot could cover."
- Accounting system: **Unknown** (not on their page or in the thread). If it's Xero: built and unit-tested, never run against a real Xero organisation; a real customer Xero connection is "not yet" (HARD_QUESTIONS #8). If QuickBooks: "QuickBooks next", no date.
- This is a **learning call** (CALL_SCRIPT): no pitch. Demo only offered at the end, only if Strong.

### 1. Desired outcome and next step to propose
- **Outcome:** understand how ~100+ USDT payments/month get from invoice to "paid" to the books; capture Q5 word for word; score Strong/Weak/None; learn who else decides.
- **Next step to propose (only if Strong):** the script's close: "Would you like to see what I'm building, in a 5-minute demo in two weeks? Completely fine if not." Date/time is theirs to choose; revops-crm-agent books it after written agreement. If Weak/None: thank them, ask "Who else should I talk to?".

### 2. Who they are
- Harbourline Trading Pte Ltd, Singapore; "founded 2014, supplies industrial packaging to buyers in South-East Asia and the Gulf." [ASSUMPTION: captured copy of their own page https://harbourline.example/payments, captured 2026-10-30 (Leads evidence); live page not re-opened this run, web OFF]
- Accepts "bank transfer (SGD, USD) and stablecoins: USDT on TRON (TRC-20) and USDT on Ethereum (ERC-20)"; asks payers to put the invoice number in the payment notes or email ar@harbourline.example; "Payments to any other address or network cannot be credited." [same label and link]
- Recent news (≤ 12 months): **couldn't check** (web OFF). Size: Unknown. Accounting system: Unknown.
- **What we already know (Touches th-201):** D0 sent 27 Oct. Mei Tan, 29 Oct, verbatim: "We get maybe a hundred-odd USDT payments a month from buyers in Vietnam and the UAE, mostly on Tron, and reconciling them before month end is painful. I've added Rahul who runs payments ops. Monday 10am works."

### 3. People
| Name | Stated role | Likely MEDDPICC role [ASSUMPTION, stakeholder-map.md] | What they likely care about [ASSUMPTION] |
|---|---|---|---|
| Mei Tan | Financial Controller (Leads L201) | Champion candidate; Decision Criteria owner; possibly Economic Buyer for small tools | Month-end reconciliation, how hash/fees/short payments get posted, auditor evidence |
| Rahul Iyer | "runs payments ops" (Mei's email) | User; Metrics source; Champion candidate | Daily matching, wrong payments, buyer "where's my payment" chasing |
| Unknown (CFO / approver) | Not known | Economic Buyer: Unknown | Ask "who else needs to say yes?" |
Tasks for Aashmiin: check Mei Tan and Rahul Iyer on LinkedIn by hand (I don't scrape).

### 4. MEDDPICC now
| Field | State | Source / next question |
|---|---|---|
| Metrics | Partly | "maybe a hundred-odd USDT payments a month" (Mei, 29 Oct). Time cost Unknown → Q4, Q5 |
| Economic Buyer | Unknown | "If you wanted to try something like this, how would that get approved?" |
| Decision Criteria | Unknown | Ask what "good" looks like at month end; what the auditor asks |
| Decision Process | Unknown | Same Paper question |
| Paper Process | Unknown | Same |
| Identify Pain | Partly | "reconciling them before month end is painful" (Mei, 29 Oct) |
| Champion | Unknown | Mei/Rahul are advocates until tested |
| Competition | Unknown | Q6 (spreadsheet? gateway? do nothing?) |

### 5. Likely pains (mini gap chart, all [ASSUMPTION] until heard)
| Problem | Likely impact | Likely root cause |
|---|---|---|
| Payments with no invoice reference | Matching by amount, mismatches, chasing buyers | Payers send plain transfers from exchanges; page asks for reference in notes |
| Short payments (exchange/withdrawal fees) | Partial invoices, follow-up emails, write-off decisions | Buyers in VN/UAE paying from exchanges |
| Wrong network (e.g. not TRC-20/ERC-20) | Funds possibly unrecoverable ("cannot be credited") | Payer picks the wrong chain |
| Month-end posting | Days of keying into the books, auditor questions | No link from on-chain record to the accounting entry |

### 6. Questions (SPIN-tagged; order of CALL_SCRIPT; follow the answers)
1. (S) Walk me through the last stablecoin payment you received, from invoice to "paid".
2. (S) How many stablecoin payments a month, roughly? Which tokens and networks? *(Mei said "a hundred-odd", "mostly on Tron": confirm the Tron/Ethereum split.)*
3. (P) When did a payment last arrive wrong (short, wrong network, fake token, no reference)? What happened next?
4. (P/I) Who sorts it out, and how long does it take?
5. (I) **After a stablecoin payment is matched, how does it get into your accounting system today, and how long does that take?** Follow-ups: which system (Xero, QuickBooks, NetSuite, other)? Who posts it? How do you record the transaction hash, fees and short payments? What does your accountant ask for at month end? *(Write the answer word for word.)*
6. (I, tailored) When a payment has no reference, what does it do to your month end, and to how quickly the buyer's account shows as paid?
7. (N) If this went away tomorrow, what would it be worth to you?
+ Paper Process (only if interest shows): "If you wanted to try something like this, how would that get approved?"
Close: "Who else should I talk to?"

### 7. Strong / Weak / None for Harbourline
- **Strong:** wrong/unreferenced payments monthly or more, costing hours (or money) of Rahul's/Mei's time, and they've tried something (sheet, gateway).
- **Weak:** it happens but the AR sheet copes and month end is a few hours.
- **None:** their bank/gateway or accountant fully handles it.

### 8. Likely objections (honest answers; OBJECTIONS.md / clearline-truth.md)
1. **"Does it work on Tron / watch our address?"** Honest: checking a reported Tron USDT transfer by hash, yes; Tron payment pages and address watching, not built, no date. "I'll follow up in writing on what a pilot could cover today." *(No date. A date is hers alone, and she shouldn't give one.)*
2. **"Our buyers won't use a gateway / we have a gateway"**: ask "What share of your stablecoin payments skip the checkout?" If almost none, not a fit.
3. **"You're a student / solo"**: true; one person, first reply within 1 business day SGT, no SLA; never hide it.
- **Hers to answer, not to improvise:** price (if asked, only the founding offer: US$300 for 30 days, then US$200/month; no credits/refunds/"cancel any time" unless she has decided them), any date, any feature commitment.

### 9. Demo path
Not on this call (learning only). If Strong, offer the 5-minute demo at the end. A demo path will be prepared for the booked demo.

### 10. Fit warnings
- Tron-heavy (see top). Don't offer a pilot needing Tron payment pages or automatic detection; product-manager to confirm what a pilot could cover for Tron payments.
- If their accounting is Xero: real-org connection "not yet" (HARD_QUESTIONS #8); pilot would start on Xero's Demo Company.
- Never say: "posts to Xero automatically", "live with customers", "payments check themselves", "no keys" (say "no wallet keys").

Sources this brief: 0 primary opened this run (web OFF); 1 captured company page (not re-opened); 1 Touches thread; internal repo files.

---

## WOULD SAVE (private Google Doc): `Clearline call prep Saltmarsh Digital 2026-11-03`

**Clearline demo prep: Saltmarsh Digital: Tue 3 Nov 2026, 11:00-11:20 SGT (5-minute demo, agreed on 27 Oct call, scored Strong)**
Lead L202 · Hong Kong · Web3 agency · thread th-202. Internal.

**RISKS / FIT WARNING FIRST**
- **They use QuickBooks** (27 Oct accounting_answer). Clearline is **Xero first, QuickBooks next, no date**: QuickBooks Online is built against documented shapes and **not run on a sandbox**. Don't show or describe posting as something they'd get in a pilot. If asked "when?": "No date yet. I'll tell you honestly when it has run on a sandbox." (Any date is hers alone; she has none to give.)
- Good fit otherwise: their bookkeeper copies payments "from Etherscan", so likely USDC on **Ethereum** (payment pages supported) [ASSUMPTION: inferred from "Etherscan"; confirm the network].
- Invitee `ops@saltmarsh.example` is a shared inbox: person and role **Unknown**. Ask who's joining.

**Desired outcome / next step to propose:** they see their own pain (short USDC payments) handled on fictional data and say how it compares to today. Next step to propose (only if they react well): "Would it help if I wrote down what a pilot could and couldn't cover for you, given QuickBooks?" Anything about a pilot, price or dates is hers to decide on the call.

**What we know (Calls row 27 Oct, Touches th-202):** problem Strong; pain "we lose half a day every week chasing short USDC payments"; volume "about 40"; Q5: "Our bookkeeper copies each payment from Etherscan into QuickBooks at month end, it takes her two days". Evidence URL https://saltmarsh.example/blog/we-now-accept-usdc (2026-06-02) [ASSUMPTION: Leads evidence, not re-opened this run, web OFF].

**People:** Jon Reyes, Head of Finance (Leads): likely Economic Buyer / Champion candidate [ASSUMPTION]; the bookkeeper (name Unknown): likely Champion / Decision Criteria owner for posting [ASSUMPTION]; ops@ attendee: Unknown. Aashmiin: check Jon Reyes on LinkedIn by hand.

**MEDDPICC now:** Metrics Partly ("about 40"/month; "half a day every week"; "two days" at month end) · Pain Known (27 Oct Calls row) · Economic Buyer Unknown (Jon? ask "who else needs to say yes?") · Decision Criteria Partly (QuickBooks needed: inferred from Q5, confirm) · Decision/Paper Process Unknown · Champion Unknown · Competition Unknown (ask what they tried).

**Demo path (5 minutes, tell-show-tell, fictional data from `demo/REQUESTS_DEMO.md`; say "it's a fictional business, all demo data" first):**
1. **Short payment: Brightline Studio (case b)**, mapped to "we lose half a day every week chasing short USDC payments".
   - Tell: "You said short USDC payments cost you half a day every week. Here's one."
   - Show: short by 50.00 USDC; likely cause fees from an exchange withdrawal wallet, labelled "an inference, not a fact"; the polite top-up reply ready to copy; the sender page now asking for exactly 50.00 USDC.
   - Tell + ask: "It's matched, the shortfall is explained, and the reply is drafted. How does that compare with how you handle it today?"
2. **Unidentified payment: Kite (case e)**, mapped to the bookkeeper copying each payment by hand.
   - Tell: "When a payment arrives with no reference…" Show: the suggestion and why (exact amount, known wallet), and that a person confirms with a note. Tell + ask: "It never matches on a guess; a person confirms. Who would do that confirming at Saltmarsh?"
3. **Optional, counterfeit token: Orbit (case c)** only if time: Mark paid greyed out; "it can't be marked paid by mistake."
- **Demo-only wording:** say "in the demo" for anything marked paid automatically (e.g. Acme), and **do not use** the script lines "Nobody touches them" / "Most payments close themselves" (CLAIMS_AUDIT #3, #27-28). Say "ready to mark paid; in a pilot, you confirm each one."
- **If they ask X, the true answer is Y:**
  - "Does it go into QuickBooks?" → "Not yet. Xero first, QuickBooks next, no date."
  - "Does it watch our wallet?" → "Not today: a person gives it the transaction hash; address watching isn't built."
  - "Is anyone using it?" → "Not yet: 0 customers, it's a working demo."
  - "What does it cost?" → only if she chooses: founding pilot US$300 for 30 days, then US$200/month (no credits/refunds/"cancel any time" unless she decides).
  - Anything else unscripted → "I don't know; I'll follow up in writing."

**Strong / Weak / None (for the demo):** Strong reaction = they map it to their weekly chasing and ask what a pilot covers; Weak = "nice, but we need QuickBooks first"; None = their bookkeeper is fine.

**Likely objections:** (1) QuickBooks: honest, no date; ask whether the pain is the chasing (we help today) or the posting (not for QuickBooks yet). (2) "Why not our gateway/Request Finance?" → OBJECTIONS.md answers, labels kept. (3) Solo founder → true; mitigations listed.

---

## Sheet writes (WOULD WRITE)
- **Calls**, L201 row (2026-11-02, Harbourline, status booked): `notes_link` = `[link: Clearline call prep Harbourline Trading 2026-11-02]` (prep). No other column.
- **Calls**, L202: `notes_link` on the 3 Nov demo row = `[link: Clearline call prep Saltmarsh Digital 2026-11-03]`. If no 3 Nov Calls row exists, I don't create one: Log note asks revops-crm-agent to add it.

## Log rows (WOULD APPEND, Log tab)
| timestamp SGT | agent | action | ids | details |
|---|---|---|---|---|
| 2026-11-02 07:07 | sales-closer-assistant | run start | - | PAUSE=FALSE; Google = aashmiin@gmail.com |
| 2026-11-02 07:15 | sales-closer-assistant | prep | L201 | `sales-closer-assistant \| prep \| L201 \| [doc link Harbourline 2026-11-02] \| sources: 0 primary, 1 secondary (captured company page, not re-opened; web OFF)` Fit warning: Tron-heavy |
| 2026-11-02 07:22 | sales-closer-assistant | prep | L202 | `sales-closer-assistant \| prep \| L202 \| [doc link Saltmarsh 2026-11-03] \| sources: 0 primary, 1 secondary (Leads evidence URL not re-opened)` Fit warning: QuickBooks user, QuickBooks not built |
| 2026-11-02 07:23 | sales-closer-assistant | skipped events | - | 2 skipped: "Lunch - Prof Paul Griffin" (mentor), "Dentist" (personal). No prep. |
| 2026-11-02 07:24 | sales-closer-assistant | note | L202 | If no Calls row for 3 Nov demo: revops-crm-agent please add (I don't create rows outside my scope) |

## Section for the 07:27 briefing (3 lines)
1. Preps ready: Harbourline 10:00 today [doc link] (**Tron-heavy: payment pages are Ethereum-only, no address watching; don't offer a Tron pilot**); Saltmarsh demo tomorrow 11:00 [doc link] (**QuickBooks user: no date for QuickBooks, say so**).
2. Q5 is in both briefs word for word; Saltmarsh demo path = short payment (Brightline) + unidentified (Kite), "in the demo" lines flagged.
3. Skipped (no prep): Prof Paul Griffin lunch (mentor), Dentist. Web was off: account facts are from captured pages, not re-opened; worth a 2-minute look at harbourline.example/payments before 10:00.
