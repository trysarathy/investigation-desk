# Clearline truth file: offer, call script, objections, what the product does today

Read before writing ANY sentence a prospect could see. Sources are Clearline's own files, opened
2026-10-31 [VERIFIED: our repo]. If a source changes, the source wins and this file is stale.

## 1. The offer (Aashmiin's brief; COMPANY_RULES; `proposals-invoices.md`)
- **Founding pilot: US$300 for 30 days, then US$200/month, first 10 businesses**, paid by invoice.
- Enterprise pricing "on request" (i.e. she decides per deal).
- **In the templates but NOT in her brief** (flag every time; she confirms per deal before it goes in a
  proposal or email):
  1. "pilot fee credited against months 2-4" (`PILOT_PROPOSAL_TEMPLATE.md` §6, `OBJECTIONS.md`).
  2. "refunded if we miss criteria 1 and 4 for reasons on our side" (template §3, `OBJECTIONS.md`).
  3. "cancel any time" (claims audit #38: a business term, keep consistent with the website).
  4. Source-code escrow on request, self-hosting, dedicated container (`OBJECTIONS.md`).
  5. Invoicing entity: her Indian proprietorship (template §6) vs anything else.
- The website once said pilots are free: FALSE, being corrected (enterprise claims audit #1-2). If a
  prospect quotes it, the draft for her acknowledges the error plainly.

## 2. The call script (`origin/gtm-os:prompts/CALL_SCRIPT.md`, 15 minutes, learning only)
Open: honest identity: "I'm a student at SMU, and I'm also building a small tool in this area called
Clearline. Today I'm only here to learn how you handle stablecoin payments, not to sell you anything. Is it
OK if I take notes?"
Questions (SPIN tag added by us):
1. (S) Walk me through the last stablecoin payment you received, from invoice to "paid".
2. (S) How many stablecoin payments a month, roughly? Which tokens and networks?
3. (P) When did a payment last arrive wrong (short, wrong network, fake token, no reference)? What happened next?
4. (P/I) Who sorts it out, and how long does it take?
5. (I) **After a stablecoin payment is matched, how does it get into your accounting system today, and how
   long does that take?** Follow-ups: which system (Xero, QuickBooks, NetSuite, other)? Who posts it? How do
   you record the transaction hash, fees and short payments? What does your accountant ask for at month end?
6. (I) What have you tried to fix it (tools, spreadsheets, a gateway)? Why that, why not something else?
7. (N) If this went away tomorrow, what would it be worth to you?
Close: "Who else should I talk to?" Then, only if Strong: "Would you like to see what I'm building, in a
5-minute demo in two weeks? Completely fine if not."
Score: **Strong** = monthly or more, costs hours or money, they've tried to fix it. **Weak** = happens but
rarely/cheaply, or fine with workaround. **None** = doesn't happen, or someone else fully handles it.
**Q5's answer is written word for word** (Calls `accounting_answer`). A prep brief may trim to 5 questions
but **always keeps Q5 verbatim** (RULES.md).

## 3. What the product does today (claims audits + HARD_QUESTIONS + README, 29-31 Oct 2026)
| Claim area | True today | Delivered by us by hand in a pilot | Roadmap / not built |
|---|---|---|---|
| Payment pages per invoice | **USDC and USDT on Ethereum only**; EIP-681 QR; business supplies the address | | Tron, BNB Chain, other networks for payment pages; unique address per invoice |
| Checking a reported transfer (paste hash) | USDC/USDT on Ethereum, Tron, BNB Chain; spots Polygon/Base/Arbitrum/Optimism wrong-network | | |
| Detecting new payments | **No address watching**: a person pastes the hash; no confirmation polling | We record transfers from hashes (agreed cadence) | Address watching, polling ("before any live pilot", HARD_QUESTIONS #4) |
| Marking paid | Auto-mark is **demo only**; live: a person confirms | We mark paid after your confirmation | Automatic marking |
| Counterfeit token, wrong network, frozen sender/destination, look-alike address warning | Yes (warning only when payer pastes into the checker) | | |
| Matching | Works once a transfer is recorded; never on amount alone | | Tested only on simulated data |
| Accounting | Posting plan + **Approve and post**; audit log; idempotency. **Xero built and unit-tested, never run against a real Xero organisation** | Xero account-code setup; pilot = first live run, on Xero's Demo Company first | QuickBooks Online built against documented shapes, not run on a sandbox ("QuickBooks next", **no date**); NetSuite designed, not built |
| Would we connect a customer's real Xero today? | **"Not yet"** (HARD_QUESTIONS #8): no sign-in, tokens stored unencrypted, audit log not tamper-evident, granular scopes pending | | These come before the first live pilot |
| Month-end report | No feature | We prepare it | |
| Deletion | No feature | Manual, within 10 business days | |
| Security | Read-only on-chain, no custody, **no wallet keys**; Xero connection is a write credential to the books (say "no wallet keys", not "no keys") | | No individual sign-in, no SOC 2, no pen test, one-person operation |
| AI explanations | Built; off in the Docker image | | Not tested on real data |
| Evidence | Earlier deposit-investigation engine: 59/59 real public transactions with sample company data, 52/52 held-out; Clearline matching tested on simulated data only | | |
| Customers | **0 customers**; working demo | | |

**Never say:** "posts to Xero automatically", "live with customers", "payments check themselves", "correct
payments need no one", "ticks the invoice off by itself" (outside "in the demo"), "QuickBooks/Tron by
<date>", "SOC 2", "SLA", "no keys" (say "no wallet keys"). Say "once you approve", "Xero first, QuickBooks
next", "in the demo".

**Note on the demo script** (`demo/REQUESTS_DEMO.md`): its lines "Nobody touches them" and "Most payments
close themselves" are demo-only (claims audit #3, #27-28). In any prep brief, add "(in the demo)" or swap
for "ready to mark paid".

## 4. Objections digest (`origin/enterprise-pack:docs/enterprise/OBJECTIONS.md`)
| Objection | Honest core answer | Watch-outs |
|---|---|---|
| Security | Read-only, no custody, no wallet keys; writes to books only on approval; **gaps stated** (no sign-in, plain JSON tokens, no SOC 2/pen test, solo); offer self-host / dedicated container | If SOC 2/SSO required: "we're not ready for you yet" |
| Build it ourselves | Possible; the work is in edge cases (18 rules, tests, 52 held-out transfers) | "The pilot is a cheap way to see the edge cases": the price line is hers to send |
| Our gateway does this | Fine for checkout payments; we add the ones that skip checkout + posting | Ask: "What share skip the checkout?" If almost none, not a fit |
| Bitwave / Request Finance / Cryptio | True, partly; they're broader and more mature; our hypothesis is small firms paid direct, wrong payments explained | Bitwave and Request Finance integration claims are [VERIFIED 28 Oct, their pages] in OBJECTIONS.md; Cryptio is [ASSUMPTION]; certifications unchecked |
| Pricing | The founding offer; ROI calculator with their numbers; below ~20-25 payments/month may not pay back [GUESS] | Credit/refund terms need her OK (§1) |
| Student / solo founder | True; 1 business-day reply SGT; no SLA; mitigations listed | Never hide it |

## 5. Pilot proposal template (`PILOT_PROPOSAL_TEMPLATE.md`), drafting rules
Sections 1-7 + acceptance line. Fill only from Calls/Opportunities and her notes. Keep **out of scope**:
Tron/BNB/other networks for payment pages, non-USD invoices, QuickBooks and NetSuite, team sign-in.
Customer's words quoted exactly or not at all. Every [placeholder] she hasn't filled stays a placeholder
(start date, end date, hosting region, cadence). Flag §1 items. Save as Google Doc
`Clearline pilot proposal - <Company> - DRAFT <date>` (private), Approval Queue `item = proposal`.
