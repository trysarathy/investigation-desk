# Discovery script: core (20 minutes, learning only)

Owner: sales-closer-assistant. Drafted 2026-11-02 for the 7-day discovery sprint after the Protégé Ventures
advisor call (Matt, Vishal; 1-2 Nov). **DRAFT for Aashmiin.** Nothing here is sent; she runs every call.
Role versions: `SCRIPT_FINANCE_CONTROLLER.md`, `SCRIPT_OPS_SALES.md`, `SCRIPT_TREASURY_PAYMENTS.md`,
`SCRIPT_OTC_DESK.md`, `SCRIPT_CRYPTO_ACCOUNTING_ADVISORY.md`. Log every call in `CALLS_TEMPLATE.md` columns.

## Why this sprint
Advisor verdict (her notes of the call, not a quote): "not too sure what you're building". Matt: find the
biggest pain first. Vishal: why fix it in the books at period end instead of the moment payment comes in?
So this week we **stop describing Clearline and listen**. Goal: by day 7, one pain that is frequent,
costly and already being worked around, heard from real people in their own words.

## The four hypotheses (what we're testing, not what we believe)
| ID | Hypothesis | Supported if we hear… | Refuted if we hear… |
|---|---|---|---|
| **H1** | Ops/sales (who release goods or services) need a trusted "this payment has really arrived, in full" signal **at the moment of payment**, separate from finance closing the books later | A recent story of goods held or released wrongly because nobody could confirm a stablecoin payment; a person whose job includes checking; a workaround (screenshots, "send me the hash", waiting for finance) | They release on a screenshot and it has never gone wrong; or a gateway/OTC desk already confirms it for them |
| **H2** | Non-USD companies (e.g. SGD, EUR, INR books) struggle with **stablecoin FX and lot accounting** (each USDC/USDT holding at its own cost; gain/loss on conversion), because stablecoins are not cash in the books | A recent month-end story of FX/gain-loss work done by hand; an auditor/accountant query; a spreadsheet of lots; money paid to an adviser for it | Their books are in USD; or they convert to fiat instantly and book it as a bank receipt; or the accountant handles it in minutes |
| **H3** | Businesses doing cross-border payments **pre-fund** (park money ahead of payouts) and stablecoins could reduce that pain. **Research only this sprint: no product intent, no solution talk** | A concrete pre-funding amount, time locked, or cost they named | Pre-funding is not their problem or is already solved by their bank/PSP |
| **H4** | Today's Clearline problem: matching stablecoin payments to invoices and getting them into Xero takes real time and goes wrong | A recent story of a short/wrong/unreferenced payment and hours spent; month-end posting by hand | They get few payments, or a gateway/accountant fully handles it |

Each role script maps every question to H1-H4 and what answer supports or refutes it.

## Mom Test principles (Rob Fitzpatrick, *The Mom Test*, 2013)
Labels (COMPANY_RULES rule 2): the book and its site were **not opened**. `momtestbook.com` failed to
resolve in this session (blocked, 2026-11-02), so everything below is
`[ASSUMPTION: secondary, Shortform "What Is the Mom Test? 3 Rules" https://www.shortform.com/blog/what-is-the-mom-test/ ; mtlynch.io book report https://mtlynch.io/book-reports/the-mom-test/ ; search summaries 2026-11-02]`,
consistent with `team/knowledge/gtm-strategist/frameworks.md` §8 (also [ASSUMPTION], book not opened).
To upgrade to [VERIFIED], Aashmiin or research-intern opens the book or momtestbook.com.

1. **Talk about their life, not your idea.**
2. **Ask about specifics in the past, not generics or opinions about the future.**
3. **Talk less, listen more.**
4. **Compliments, "fluff" and ideas are not data.** Fluff = generics ("we usually…"), future promises
   ("we would…"), hypotheticals ("we might…"). When you hear fluff, anchor back to a real past instance.
5. **Commitment and advancement are the real signal**: time, reputation (an intro), or money/data. A
   meeting that ends with "keep me posted" and no next step is a polite no.
6. **Dig beneath feature requests**: "Why do you want that? What would it let you do? How are you
   coping today?"

## Ground rules for Aashmiin on every call
- **Past behaviour only.** "Tell me about the last time…", "Walk me through…", "What happened next?"
- **No pitching.** No product description unless asked; then **one plain sentence** and back to them:
  "I'm building a small tool that checks stablecoin payments against invoices; but today I'd really like
  to hear how it works for you." (True today per `company/PRODUCT_FACTS.md`; never more than this.)
- **No leading questions** ("Isn't it painful when…?"), **no hypotheticals** ("Would you use…?"),
  **no future promises** asked for or given ("Would you buy…?", "I'll have that by…").
- **No demo until the end**, and only if they ask, or after every question is done and the problem
  sounded Strong. Demo truth: say "in the demo" for anything demo-only; payment pages are Ethereum-only;
  Xero is in testing and posts only once a person approves; 0 customers. Never mention H1/H2/H3 as
  things Clearline does: it doesn't today.
- **No promises, no prices.** If asked about price: "We're offering a small founding pilot; I'm happy to
  send details after." She decides whether to say the approved offer; nothing else.
- **Silence is fine.** Count to five before filling it.
- **If they are an advisor/partner (OTC desk, advisory firm)**, they tell you about *their clients*:
  second-hand evidence. Log it with source = advisor; it never counts as a customer pain on its own.

## The 20-minute call
**0:00-1:30 Open (honest identity; adapted from `prompts/CALL_SCRIPT.md` on `gtm-os`)**
"Thank you for making time. I'm a student at SMU, and I'm also building a small tool in this area called
Clearline. Today I'm only here to learn how stablecoin payments work for you, not to sell anything. Is it
OK if I take notes? I'll only quote you publicly if you say yes at the end."

**1:30-3:30 Context (S)**
1. "What's your role, and what does a normal week look like for you?"
2. "Do you receive or send stablecoins today? Roughly how often, in the last month?" (If none: "When did
   you last come close: a customer asking to pay that way?" Then go to the role script's non-user path.)

**3:30-15:00 The story (role script, 8-12 questions; follow the answers, don't read a form)**
3. "Walk me through the **last** stablecoin payment you received, from the moment it was due to the
   moment everyone treated it as done." (anchor every later question to this story)
4. "At what point did someone release the goods/service? Who decided, and what did they look at?" (H1)
5. **"After a stablecoin payment is matched, how does it get into your accounting system today, and how
   long does that take?"** (verbatim CALL_SCRIPT Q5; H4; write the answer **word for word**)
   Follow-ups: which system? who posts it? how do you record the hash, fees and short payments? what does
   your accountant ask for at month end?
6. "What currency are your books in? Tell me about the last month end: how did the stablecoin side get
   valued?" (H2)
7. "When did a payment last go wrong? What happened next, who sorted it out, how long did it take?" (H1/H4)
8. "What have you tried to fix it (tools, spreadsheets, a gateway, an adviser)? Why that one? What did
   it cost?" (cost from **their** numbers only)
(The role script replaces 4-8 with its own set; Q5 always stays word for word.)

**15:00-18:00 Size and priority (still past tense)**
9. "Of the things we talked about, which one took the most of your time last month?" (biggest pain:
   Matt's point)
10. "Have you spent money or hired anyone because of it?" (replaces CALL_SCRIPT Q7 "what would it be
    worth": that's a hypothetical; we ask what they already spent)

**18:00-20:00 Commitment / advancement asks (ask at least one; write the answer)**
- **Intro**: "Who else should I talk to, someone who deals with this more than you? Would you be willing
  to introduce me?"
- **Data sample**: "Would you be open to sharing one anonymised example, e.g. a redacted payment record or
  month-end schedule, so I understand it properly?" (Never ask for keys, wallet access or system logins:
  COMPANY_RULES rule 3.)
- **Follow-up**: "Could I come back to you in two weeks with what I've learned, for 15 minutes?"
- **Quote permission**: "Is it OK if I quote you, without your name, when I describe what I'm learning?"
  (→ column "OK to quote publicly?")
- **Demo**: only now, and only if they asked or the problem was Strong: "Would you like to see what I'm
  building, a 5-minute demo another day? Completely fine if not."

## Bad questions (never ask)
`[ASSUMPTION: secondary, Mom Test summaries above]` plus our own examples:
| Don't ask | Why | Ask instead |
|---|---|---|
| "Do you think this is a good idea?" | Asks for an opinion/compliment | "How do you handle this today?" |
| "Would you use / buy a tool that…?" | Hypothetical; invites a polite yes | "What have you tried? What happened?" |
| "How much would you pay for this?" | Future promise, unreliable | "What does it cost you today? Have you paid for anything to fix it?" |
| "Isn't it painful when payments arrive short?" | Leading | "When did a payment last arrive different from the invoice?" |
| "What would your dream tool do?" | Feature fantasy | "Why do you want that? What would it let you do?" |
| "Do you usually / normally…?" | Generic; invites fluff | "Tell me about the last time…" |
| "Would it help if you knew the moment payment arrived?" | Leading + hypothetical (H1) | "When did someone last release goods before the money was confirmed?" |
| "Wouldn't stablecoin FX be easier if…?" | Pitch disguised as a question (H2) | "Walk me through last month's FX on the stablecoin balance." |
| Any sentence starting "We do / Clearline can…" | Pitching; plus over-claim risk | Stay on their story |

## Note-taking rules
1. **Their exact words in quotes**, only when you wrote them down as they said them. Otherwise write
   `per notes: …`. Never tidy a paraphrase into a quote.
2. **Numbers exactly as said, with units** ("about 30 a month", "half a day"). No number → "Unknown".
3. Mark each line: **F** = fact about the past, **O** = opinion, **FUT** = future/hypothetical (ignored for
   scoring), **C** = commitment they made.
4. Q5 answer word for word, every call.
5. Write who said it (name, role) and the date. Within 2 hours, copy into the Calls template row.
6. Note anything they asked us for (feature asks) with the "why" they gave.
7. No secrets or customer data in notes (wallet keys, logins, their clients' names unless OK'd).

## Scoring the call (Strong / Weak / None)
Base: `prompts/CALL_SCRIPT.md` (gtm-os), plus Mom Test commitment.
- **Strong**: happens **monthly or more**, costs **hours or money** (their numbers), they've **already tried
  to fix it**, AND they gave at least one commitment (intro, data sample, follow-up date).
- **Weak**: it happens but rarely/cheaply, or they're fine with the workaround, or pain is real but no
  commitment ("keep me posted").
- **None**: doesn't happen, or someone else (gateway, OTC desk, accountant) fully handles it.
- Score **per hypothesis tested** (a call can be Strong for H2 and None for H1).
- Evidence grade (gtm-strategist `frameworks.md` §8): A paid/data/access · B dated next step · C specific
  past story with numbers · D compliment/hypothetical (logged, never counted).
- Advisor/partner calls: score the *lead quality* of what they described (second-hand), and mark
  source = advisor. Never count it as a customer Strong.

## After the call
Calls-template row within 2 h; thank-you draft (she sends); hand-offs: pains/quotes → product-manager,
segment learning → gtm-strategist, facts to check → research-intern. Day 7: tally Strong/Weak/None per
hypothesis; only rows from real calls count.
