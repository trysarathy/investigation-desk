# Task 2: After the Harbourline call, Mon 2 Nov 2026 (notes arrived 10:45 SGT)

Live tools OFF: everything is WOULD WRITE / WOULD DRAFT. Nothing sent.

**P0:** PAUSE = FALSE; Google = aashmiin@gmail.com. Offer and non-brief terms noted.
**Deadline:** calendar end 10:30 SGT → **follow-up Gmail draft must exist by 12:30 SGT, Mon 2 Nov 2026** (≤ 2 h metric). Planned creation: ~11:15 → `followup_minutes` ≈ 45.
**Notes quality gate:** *Usable* (who, pain, volume, Q5 verbatim, decision maker, next step all present). Source: her Doc "Harbourline call notes 2 Nov" (her Drive); line references below are bullet numbers in that Doc (b1 = first bullet after "Present").

## Decisions / risks for Aashmiin first
1. **RISK: fit.** ~80% of their volume is Tron (b2). Payment pages are Ethereum-only, address watching isn't built, and a real Xero connection is "not yet" (HARD_QUESTIONS #8). The draft says this plainly and asks product-manager what a pilot can cover for Tron payments. **Decision: OK to send the honest "what a pilot covers today" as written?** (yes/no)
2. **Stage:** you told Mei the founding price when she asked (b12). Did you *offer* the pilot? If yes I set Opportunities stage = Pilot offered; until you say so it stays **Call held**. (yes/no)
3. **Cc Rahul?** I cc'd Rahul Iyer (on the call and already on the thread since Mei added him). Daniel is **not** cc'd: you didn't name him; Mei said she'll forward. (keep cc yes/no)

## (a) Calls row update (WOULD WRITE, Calls tab, row 2026-11-02 / L201)
| column | value |
|---|---|
| status | held |
| problem_score | Strong: ~120 payments/month (monthly+), costs hours ("most of a day" per wrong payment; "about two days every month" to post), and they've tried to fix it (Google Sheet with formulas; looked at a gateway). CALL_SCRIPT definition met. (Her view also Strong, b11.) |
| pain_quotes | "Half the time there's no reference so we match on amount and hope." (Rahul, b1); short payment took "most of a day" to work out which invoice and chase (b3); BNB Chain payment: "we still haven't got it back" (b4); "If it saves us the month-end scramble, I'd pay for it." (Mei, b7) |
| current_workaround | per notes: buyer emails PI number and sends USDT; Rahul checks Tronscan and matches by amount in the AR spreadsheet, tells Mei; Mei keys each into Xero as a bank receipt with a Tronscan screenshot; tried a Google Sheet with formulas; looked at a gateway but buyers won't use a checkout link (b1, b5, b6) |
| volume_per_month | "around 120 a month, about 80% Tron, rest Ethereum, all USDT" (Mei, b2) |
| accounting_answer | "Rahul gives me the list on the 28th, I key each one into Xero as a bank receipt and attach a Tronscan screenshot. It takes me about two days every month and the auditors still ask for more." |
| next_step | Demo Thu 5 Nov 15:00 SGT with Mei + Rahul; Mei to forward the invite to Daniel (CFO) "if it looks good"; Aashmiin to send recap + what a pilot would cover (b11) |
| notes_link | [link: "Harbourline call notes 2 Nov", her Drive] |
| followup_draft_at | 2026-11-02 ~11:15 SGT (column only once she OKs adding it; until then in Log) |

## (b) MEDDPICC + value block (WOULD WRITE: Opportunities `notes` for O-201 + summary Doc)
| Field | State | Note (source) → next question |
|---|---|---|
| Metrics | Known (partial baseline) | ~120/month, 80% Tron (b2); one short payment "most of a day" (b3); posting "about two days every month" (Q5). → Ask: how many wrong/unreferenced per month? |
| Economic Buyer | Partly | Mei approves tools under S$5k on her card; bigger → Daniel (CFO) (b9). US$300 is under her limit, but Daniel "will want to see the audit trail". → "Would Daniel need to sign off even though it's under your card limit?" |
| Decision Criteria | Partly | Audit trail for Daniel/auditors (b9, Q5); Tron coverage / address watching (Rahul, b10); buyers won't use a checkout link (b6). → "What would the auditors need to see per payment?" |
| Decision Process | Partly | Demo 5 Nov → Mei forwards to Daniel "if it looks good" (b11). → "After the demo, what happens next on your side?" |
| Paper Process | Unknown (Partly for small spend) | Card payment under S$5k (b9); PO/contract needs Unknown. → "If you went ahead, would an invoice paid by card or transfer work, or is there a vendor form?" |
| Identify Pain | Known | Unreferenced payments matched "on amount and hope" (b1); short payment "most of a day" (b3); BNB funds not recovered (b4); two days month end + auditors (Q5) |
| Champion | Partly | Mei: advocate with budget authority; untested as champion (will forward "if it looks good"). Rahul: user, asked the Tron question. → test at demo: will Mei bring Daniel in herself? |
| Competition | Known | "none in use" (b10); tried a Google Sheet; looked at a gateway, rejected because buyers won't use a checkout link (b6). Do-nothing = the spreadsheet. |

**Value block (their words; capabilities mapped to clearline-truth.md §3)**
- **Before:** Tronscan + AR spreadsheet matching by amount; Mei keys each payment into Xero with a Tronscan screenshot (b1, Q5).
- **Negative consequences:** "most of a day" per wrong payment (b3); "about two days every month" posting; "the auditors still ask for more" (Q5); a BNB Chain payment "we still haven't got it back" (b4).
- **Required capabilities → status:**
  - Match unreferenced USDT payments to invoices → **by hand + today**: matching works once a transfer is recorded; we record transfers from hashes by hand. **Ethereum payments: in the request flow today. Tron payments: not in the request flow; whether a pilot can record/match them by hand is UNCONFIRMED → product-manager.**
  - Watch their Tron address automatically (Rahul) → **roadmap, no date** (address watching not built; Tron payment pages not built).
  - Explain short payments (exchange fees) → **today** (once recorded; Ethereum request flow).
  - Spot wrong network (BNB Chain) → **today** in the checker when a hash is pasted (Ethereum, Tron, BNB). **Recovery of funds: never** (we don't touch funds).
  - Post to Xero with an audit trail → **built, never run on a real Xero organisation**; pilot = first live run, Demo Company first; real-org connection "not yet" until sign-in, token encryption, granular scopes (HARD_QUESTIONS #8, #20). Audit log is app-level append-only, not tamper-evident (CLAIMS_AUDIT #10).
- **After / PBO:** "If it saves us the month-end scramble, I'd pay for it." (b7)
- **Metrics:** as above; per-payment posting minutes Unknown.
- **Proof points we may use:** earlier engine 52/52 held-out real transfers (with the caveat: Clearline matching tested only on simulated data). 0 customers.

## (c) Gmail follow-up DRAFT (WOULD DRAFT: `create_draft`, reply in thread th-201; NOT sent)
- **To:** mei.tan@harbourline.example
- **Cc:** rahul.iyer@harbourline.example  *(see decision 3)*
- **Subject:** Re: Quick question about stablecoin payments
- **Body:**

> Hi Mei,
>
> Thank you, and thank Rahul too, for the time this morning. It was really useful to hear how it works on your side.
>
> What I heard:
> - Around 120 USDT payments a month, about 80% on Tron and the rest on Ethereum, and often with no reference, so Rahul matches them by amount in the AR spreadsheet.
> - A short payment after an exchange fee a few weeks ago took most of a day to trace to its invoice and chase, and one payment sent on BNB Chain still hasn't come back.
> - At month end you key each payment into Xero as a bank receipt with a Tronscan screenshot. That takes about two days, and the auditors still ask for more.
>
> Rahul asked whether Clearline can watch your Tron address automatically. I promised to answer in writing, so honestly:
> - **Not today.** Clearline doesn't watch addresses yet: a person gives it the transaction hash. Payment pages for invoices work for USDC and USDT on Ethereum only; Tron payment pages aren't built. Both are on the roadmap, and I don't have a date for either.
> - **What it can do today:** check a transfer someone reports (on Ethereum, Tron or BNB Chain) to confirm it's the genuine token, on the right network, to the right address. For Ethereum payments it then matches the transfer to its invoice, explains a short or wrong one in plain English with a reply drafted, and, once you approve, prepares the posting for Xero with the transaction hash, token and network, with every posting kept in an audit log.
> - **What a pilot would cover:** [AASHMIIN: confirm with product-manager what a pilot can honestly cover for your Tron payments (e.g. us recording and checking them by hand), then fill this line, or delete it and say only the Ethereum share is covered today.] In a pilot we record transfers from their hashes ourselves, and you confirm each payment before it's marked paid. Xero posting is built and tested, but it has never run against a real Xero organisation: your pilot would be its first live run, starting on Xero's Demo Company so you can check the test postings before anything touches your books. [AASHMIIN: confirm you're ready to say a pilot can include Xero at all, given sign-in and token storage come first.]
> - On the BNB Chain payment: Clearline would flag a wrong-network payment when it's checked, but it never holds or moves funds, so it can't recover one.
>
> As I mentioned, the founding pilot is US$300 for 30 days, then US$200/month, for the first 10 businesses.
>
> Next step, as agreed: the demo on Thursday 5 November at 15:00 SGT with you and Rahul. I'll show it on fictional data, using cases like the short payment and the payment with no reference. If it looks useful, you mentioned you might forward it to Daniel, and I'm happy to go through the audit trail for him. I've also drafted a short plan we could go through together, so you can tell me what's wrong with it: [link to MAP once you share it]
>
> Thanks again,
> Aashmiin

*(Outward check: draft only ✓; only the approved offer, which she quoted on the call; no credit/refund/"cancel any time" ✓; no date or feature promised, roadmap says "no date" ✓; product lines match §3 ✓; quotes and numbers from her notes ✓; recipients not DNC/mentor/warm network ✓.)*

## (d) MAP draft (WOULD SAVE: private Google Doc `Clearline MAP - Harbourline Trading - DRAFT 2026-11-02`)

**Mutual action plan: Harbourline Trading × Clearline. DRAFT for discussion with Harbourline, not agreed.**
"Here's a draft plan; what's wrong with it?" Owner names are people, not teams. Dates: Clearline-side `[date: Aashmiin to set]`; customer-side only where they said them.

**Pre-pilot dependencies Aashmiin must confirm before this goes to Harbourline:**
- HARD_QUESTIONS #8: would we let a pilot customer connect their real Xero today? "Not yet": sign-in, encrypted token storage, tamper-evident audit log, granular scopes (#20) come first.
- HARD_QUESTIONS #4: address watching and confirmation polling "before any live pilot"; Tron (≈80% of their volume) is not in the payment-request flow. product-manager: what can a pilot cover for Tron?

| # | Step | Owner (Harbourline) | Owner (Clearline) | Due | Status |
|---|---|---|---|---|---|
| 1 | Discovery call: current process, volume, systems | Mei Tan, Rahul Iyer | Aashmiin | 2 Nov 2026 | Done |
| 2 | Demo on fictional data | Mei Tan, Rahul Iyer (+ Daniel if Mei forwards) | Aashmiin | Thu 5 Nov 2026 15:00 SGT (agreed on call) | Booked |
| 3 | Security review: `SECURITY_OVERVIEW.md` + any questionnaire; answer follow-ups | [name: ask] | Aashmiin | [date: Aashmiin to set] | |
| 4 | Decide hosting: your infrastructure or dedicated container (region) | [name: ask] | Aashmiin | [date: Aashmiin to set] | |
| 5 | Agree success criteria and baseline times (e.g. "most of a day" per wrong payment; "about two days" month-end posting) | Mei Tan [confirm] | Aashmiin | [date: Aashmiin to set] | |
| 6 | Data processing terms reviewed | [legal: ask] | Aashmiin | [date: Aashmiin to set] | |
| 7 | Pilot proposal signed; invoice sent and paid (founding pilot US$300) | [approver: Mei Tan or Daniel (CFO)? ask] | Aashmiin | [date: Aashmiin to set] | |
| 8 | Setup: deploy, shared password / IP allow-list, receiving addresses, open invoices | [name: ask, Rahul?] | Aashmiin | Day 1 [date: Aashmiin to set] | |
| 9 | Xero: connect Demo Company, test postings, customer checks them; then live org (**only after dependencies above**) | [Xero admin: ask, Mei?] | Aashmiin | Day 3-7 [Aashmiin to confirm] | |
| 10 | Weekly 20-minute check-in: exceptions, timings, issues | [finance lead: ask] | Aashmiin | Weekly | |
| 11 | Day-15 midpoint | [finance lead: ask] | Aashmiin | Day 15 | |
| 12 | Month-end report delivered (prepared by us) | | Aashmiin | Day 30 | |
| 13 | Day-30 review against criteria; continue / stop | [approver: ask] | Aashmiin | Day 30 | |
| 14 | If stop: data deleted, Xero app revoked, written confirmation | [IT contact: ask] | Aashmiin | Day 30 + 10 business days | |
| 15 | If continue: monthly plan from day 31 (US$200/month) [AASHMIIN: template adds "pilot fee credited months 2-4": not in your brief, confirm or delete] | [approver: ask] | Aashmiin | Day 31 | |

Steps 3, 4, 6 kept: Harbourline's size and IT/legal needs are Unknown; trim only once Mei says they don't apply.

**Risks we both watch:** ~80% of payments on Tron, where payment pages and address watching aren't built (no date); no sign-in yet (shared password); transfers recorded by hand; first live Xero run happens in this pilot, and a real-org connection waits on the pre-pilot dependencies; audit log is app-level, not tamper-evident (Daniel's audit-trail ask); one-person support; Economic Buyer (Daniel) not yet met.

## (e) Sheet writes (WOULD WRITE)
**Opportunities, O-201:**
| column | value |
|---|---|
| stage | Call held (→ Pilot offered only if Aashmiin confirms decision 2) |
| pilot_scope | (blank until fit confirmed) |
| next_step | Demo with Mei + Rahul; Mei may forward to Daniel (CFO) |
| next_step_date | 2026-11-05 |
| notes | MEDDPICC + value block above (summary Doc link) |
| map_link | [link: Clearline MAP - Harbourline Trading - DRAFT 2026-11-02] |
| proposal_status | not drafted (no proposal until she asks; P3) |
| risks | Tron ≈80% (Ethereum-only payment pages; no address watching); real Xero connection "not yet"; CFO not met, wants audit trail; BNB loss expectation (we can't recover funds) |
| help | product-manager: what can a pilot cover for Tron payments? Aashmiin: confirm Xero readiness before offering Xero in a pilot |

**Approval Queue (append):**
| item | ref | what to check |
|---|---|---|
| follow-up draft | Gmail draft [id] "Re: Quick question about stablecoin payments" → Mei, cc Rahul | Fill/delete the two [AASHMIIN] lines (Tron coverage, Xero readiness); keep or drop Rahul cc |
| MAP draft | [Doc link] | Confirm pre-pilot dependencies and the flagged credit term before sharing with Mei |
| decision | O-201 stage | Did you offer the pilot on the call (→ Pilot offered)? yes/no |

**Log (append):**
| timestamp SGT | agent | action | ids | details |
|---|---|---|---|---|
| 2026-11-02 10:46 | sales-closer-assistant | run start (notes arrived) | L201 | PAUSE=FALSE; notes Usable |
| 2026-11-02 11:05 | sales-closer-assistant | Calls row update | L201 | status held, score Strong, Q5 verbatim, notes_link |
| 2026-11-02 11:15 | sales-closer-assistant | summary | L201, O-201 | `sales-closer-assistant \| summary \| L201 \| score=S \| draft=[gmail draft id] \| map=[doc link] \| followup_minutes=45` (thread th-201; draft id noted here for revops Touches) |
| 2026-11-02 11:20 | sales-closer-assistant | MAP draft | O-201 | [doc link], private, not shared |
| 2026-11-02 11:22 | sales-closer-assistant | Opportunities update | O-201 | stage Call held, next_step, map_link, risks, help |
| 2026-11-02 11:23 | sales-closer-assistant | hand-offs | L201 | product-manager (Tron/address-watching ask + quotes); revops-crm-agent (demo hold); gtm-strategist (segment learning) |

## (f) Hand-offs
- **product-manager:** Rahul's ask, verbatim: "can it watch our Tron address automatically?"; ~80% Tron volume; Q5 verbatim (Xero bank receipt + Tronscan screenshot, auditors "still ask for more"); BNB wrong-network loss. Question back: what can a pilot honestly cover for Tron payments, and when (no date to customers until she approves)?
- **revops-crm-agent:** demo Thu 5 Nov 15:00 SGT, Mei + Rahul, agreed on the call. Calendar hold once agreed in writing (the follow-up confirms it); Mei will forward to Daniel herself. Touches row for the draft (id in Log).
- **gtm-strategist:** segment learning: SG exporter, Tron-heavy USDT, buyers in VN/UAE "won't use a checkout link"; gateway not a substitute.
- **chief-of-staff:** the 3 decisions above to the top of the 18:27 end of day / Approval Queue.

**Follow-up draft must exist by: 12:30 SGT, Mon 2 Nov 2026.**
