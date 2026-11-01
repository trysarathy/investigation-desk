# Task 3: Reply triage, Tue 3 Nov 2026 (six replies; each handled in the first :49 run after it arrived)

Settings: PAUSE FALSE, **BOOKING_LINK empty**, so a "yes" gets a **draft**, not an automatic booking link.
Calendar: `work/calendar.csv`.

## Alerts (top of the next email to Aashmiin; sent the same evening)
- **SPAM COMPLAINT (R5, Mark Ellis, Gale Fintech, UK).** The code now **auto-throttles to 20/day**
  (`volume`: `"AUTO-THROTTLE to 20/day: 1 spam complaint(s)"`). The guard reports
  `downgrade_reasons: ["1 spam complaint(s)"]`, so autonomy is held at level 1 (it was already 1).
  Week-2 direct sending is now ruled out until the complaint count is 0 (`lean.first_email_policy`).
- One unsubscribe (R3). No PAUSE/HOLD found in Settings. I couldn't check Gmail for her replies (it's off
  in this run).

## Guard on the reply rows (`--today 2026-11-03 --now 2026-11-03T09:49:00Z`, after today's Touches and DNC rows were written)
```json
{"level": 1, "downgrade_reasons": ["1 spam complaint(s)"], "pause": false, "send_mode": "gmail_personal",
 "daily_cap": 20, "alerts": ["AUTO-THROTTLE to 20/day: 1 spam complaint(s)"], "allowed": 3, "blocked": 1,
 "verdicts": [["L203","REPLY","ALLOW",[]], ["L201","REPLY","ALLOW",[]], ["L202","REPLY","ALLOW",[]],
              ["L207","REPLY","BLOCK",["on Do-not-contact"]]]}
```
(Rows: R1 confirmation draft, R2 automatic thank-you, R4 draft, R5 apology. R3 and R6 get no reply, so
they aren't candidates. `sent_today`/`sent_30d` in this run cover only the touches I re-created for the
simulation, so I don't quote them as day totals.)

---

## R1: Hannah Lim, Vega Exchange OTC (L203, t-203), 10:12. **Class: yes (positive)**
She named a specific time in writing: **Thu 5 Nov, 15:00 SGT, 15 minutes**.
- **Calendar check:** 5 Nov has "SMU class 13:00-13:45". 15:00-15:15 is free, and it's inside Singapore
  9:00-17:00 on a weekday. → **WOULD WRITE (Calendar):** event on her calendar
  `HOLD: Learning call - Vega Exchange OTC (Hannah Lim)`, 2026-11-05 15:00-15:15 SGT, **no guests**. No
  invite goes out until she approves the confirmation. Description: thread t-203 link +
  prompts/CALL_SCRIPT.md link + "Q5 accounting question word for word".
- **Draft for Aashmiin (not automatic, because BOOKING_LINK isn't set).** WOULD WRITE Gmail draft, reply in
  thread t-203. Guard: ALLOW.
  > Thank you, Hannah, that's really kind. Thursday 5 November at 15:00 Singapore time works for me, 15 minutes. I'll send a calendar invite shortly.
  >
  > Aashmiin
- When she approves: I add hannah.lim@vega-otc.example as a guest on the HOLD event (that sends the invite)
  and rename it `Learning call - Vega Exchange OTC (Hannah Lim)`.
- **Sheet:** Touches `2026-11-03,L203,Vega Exchange OTC Pte Ltd,vega-otc.example,hannah.lim@vega-otc.example,email,inbound,Re: Quick question about stablecoin payments,replied,t-203,,"positive: yes (R1) agreed Thu 5 Nov 15:00 SGT in writing",`
  + Touches `...,REPLY,Re: Quick question about stablecoin payments,drafted,t-203,,confirmation draft for 5 Nov 15:00 (BOOKING_LINK not set),`.
  Leads L203 stage In sequence → **Call booked**, last_touch 2026-11-03, next_action "learning call",
  next_action_date 2026-11-05. Calls `2026-11-05,L203,Vega Exchange OTC Pte Ltd,Hannah Lim,booked,,"We do get USDT sent on the wrong network now and then and it's a pain.",,,call 5 Nov 15:00 SGT,,`.
  Opportunities (new) `L203,Vega Exchange OTC Pte Ltd,Call booked,,,Learning call 5 Nov 15:00 SGT,2026-11-05,"Raised wrong-network USDT unprompted",OP04,Hannah Lim,,USD,not drafted,not drafted`
  (value_usd blank: no deal value exists, so I invent none). Approval Queue `item = reply draft`, waiting.
  LinkedIn list LI02 notes += "replied by email 3 Nov, call booked: no LinkedIn DM (one channel at a time)".
- **Hand-off:** sales-closer-assistant (call-prep brief using the CALL_SCRIPT questions, Q5 word for word;
  her quote about wrong-network USDT goes in it).
- Her D11 went out at 09:49, before her reply. Her sequence is now stopped (guard: replied).

## R2: Ben Carter, Marlow Shipping (L201, t-201), 16:40. **Class: not interested → sub-class "not now"**
- **Automatic (guard ALLOW, step REPLY, thread t-201).** Sent at the 17:49 SGT run (09:49 UK, his working
  hours). WOULD SEND:
  > Thank you, Ben, that makes sense. I'll leave it for now.
  >
  > Aashmiin
- **No DNC.** He asked us to try again in Q1, which is not a refusal. The sequence stops (D11 on 10 Nov won't
  go: the guard sees `replied`).
- **Sheet:** Touches inbound `replied`, notes "not now (R2): try again in Q1". Touches REPLY `sent`, approved
  `auto`, notes "thank-you; nurture 2027-01-11". Leads L201 stage → **Replied**, next_action "re-contact Q1
  (new D0, approval rules apply)", next_action_date **2027-01-11** (first full working week of Q1).
- No Calendar action, no hand-off.

## R3: Chloe Martin, Pinecrest Media (L205, t-205), 08:05. **Class: unsubscribe**
- **No reply** (RULES: unsubscribe = no reply).
- **DNC the same day:** `chloe.martin@pinecrest-media.example,email,unsubscribe request (R3),2026-11-03`.
  Email only: she asked to remove herself, not her company.
- Her D4 queued for today must not go. It doesn't: Touches now shows `unsubscribed`, so the 09:49 guard
  blocks it (stop status + DNC). Approval Queue row L205 D4 → `blocked`.
- **Sheet:** Touches inbound `unsubscribed`, notes "R3 remove me". Leads L205 stage → **Do not contact**,
  next_action "none". Log row.
- L113 (Liam Walsh, same company) stays parked. I won't queue him on 17 Nov without asking Aashmiin first,
  because a colleague just opted out.

## R4: Ayu Pratiwi, Sunda Travel (L202, t-202), 11:30. **Class: more info (positive) + pricing + product question → draft only**
- **Draft for Aashmiin** (pricing = always human). WOULD WRITE Gmail draft in thread t-202; guard ALLOW:
  > Thank you, Ayu, fair questions.
  >
  > Price: we're offering a small number of founding pilots: US$300 for 30 days, then US$200/month if you want to continue, cancel any time.
  >
  > Tron: today the pilot covers USDC and USDT on Ethereum. Tron isn't supported yet, and since most of your customers pay that way I'd rather be straight with you about it than over-promise.
  >
  > Even so, I'd value 15 minutes to hear how Tron payments are handled on your side today. Would one of these suit (Jakarta time, Singapore in brackets)?
  > - Thursday 5 November, 10:00 (11:00 SGT)
  > - Friday 6 November, 10:00 (11:00 SGT)
  > - Monday 9 November, 14:00 (15:00 SGT)
  >
  > Aashmiin
- Slots: inside her free time per calendar.csv (busy: 4 Nov 10:00-10:30, 5 Nov 13:00-13:45, 5 Nov 15:00
  Hannah hold, 6 Nov 16:00 Orbit Pay) and inside Ayu's 9:00-17:00 (Indonesia UTC+7), at least 1 business
  day after she approves at 07:30 on 4 Nov. **No hold** (no agreed time). [ASSUMPTION] calendar.csv is her
  complete free/busy.
- For her to confirm before sending: (1) quoting US$300 / US$200 to Ayu (her price, her call; I left out
  "credited against months 2-4"); (2) the Tron line is true today. It matches the pilot template's scope
  (out of scope: Tron) [VERIFIED: fixtures/pilot_proposal_template.md], but the product should be re-checked
  before sending. No date for Tron is given or implied.
- **Calendar:** the existing 3 Nov 14:00 "Learning call: Sunda Travel (Ayu Pratiwi)" tentative entry lists
  Ayu as an attendee, but she never agreed a time (the note says so). It breaks P6. I flag it to Aashmiin
  to delete (I don't remove it myself without her OK). The time has passed, and it is **not** counted as a
  meeting.
- **Sheet:** Touches inbound `replied`, notes "positive: more info (R4) pricing + Tron question". Touches
  REPLY `drafted`. Leads L202 stays **Replied**, next_action "pricing/Tron reply awaiting approval",
  next_action_date 2026-11-04. Opportunities OP02 next_step "Answer pricing + Tron question (draft) and
  propose 3 call slots", next_step_date 2026-11-04. Approval Queue `item = reply draft` (R4 pricing reply),
  waiting.
- **Hand-off:** product-manager, Product roadmap row: "Tron support asked by Sunda Travel (L202): 'And does
  it work with USDT on Tron? Most of our customers pay that way.' 2026-11-03". (Second Tron request:
  Northgate also has USDT on Tron.)

## R5: Mark Ellis, Gale Fintech (L207, t-207), 17:55. **Class: complaint**
- **DNC now, whole domain** (he said "anyone at Gale"):
  `galefintech.example,domain,complaint: asked that nobody at Gale is contacted (R5),2026-11-03`.
- **Nothing is sent automatically.** The apology is **draft text only**, in the Approval Queue for her. I
  did **not** create a Gmail draft, because once he's on DNC the guard returns **BLOCK "on Do-not-contact"**
  and only ALLOW rows may be drafted. Whether to answer him at all is her decision. He asked not to be
  contacted, but he also asked how we got his address (in the UK he has a right to know the source:
  ask a lawyer if unsure). If she decides to answer, she sends it herself from her own Gmail.
  Text for her (short, no argument, no legal citations):
  > I'm sorry, Mark. I found your address on [source page] and wrote to ask about stablecoin payments. I've removed you and won't contact you or anyone at Gale again.
  >
  > Aashmiin
  ([source page] stays a placeholder on purpose. leads.csv records `email_label` VERIFIED-PUBLIC but not
  *which* page showed the address. The candidates are evidence_url https://galefintech.example/payments
  and first_line_source https://galefintech.example/treasury. research-intern confirms which one before
  she sends anything. I won't guess.)
- **Sheet:** Touches inbound `complaint`, notes "R5 complaint: says spam, will report; asked nobody at Gale
  be contacted". Leads L207 stage → **Do not contact**. Approval Queue `item = complaint reply (guard BLOCK:
  DNC; her decision)`. Log `RISK: spam complaint from L207 Gale Fintech; DNC domain; auto-throttle 20/day;
  autonomy held at 1`.
- **Tell Aashmiin immediately:** top of tonight's summary (alerts above).
- Note: his D4 went at 17:49 SGT, 6 minutes before his reply. The complaint was probably a reaction to the
  second email. Root-cause check: was the address on a public Gale page (VERIFIED-PUBLIC)? I've asked
  research-intern to re-open the source page, and I'll add a Spot checks row if it wasn't there.

## R6: Ravi Shankar, Harbor Cloud (L208, t-208), 09:51. **Class: out of office**
- **No reply.** Return date **Mon 9 Nov**. His D4 went at 09:49 (before the auto-reply). D11 was due 10 Nov
  (30 Oct + 11) and stays on **Tue 10 Nov**, the first business day after his return. next_action_date
  2026-11-10.
- **Do not email finance@harborcloud.example.** It's a role inbox named in an auto-reply, not verified and
  not a lead.
- **Sheet:** Touches inbound `out of office`, notes "R6 OOO until 2026-11-09". Leads L208 stays In sequence,
  next_action "D11 after return", next_action_date 2026-11-10.

---

## Do-not-contact rows added today (same day)
```
chloe.martin@pinecrest-media.example,email,unsubscribe request (R3),2026-11-03
galefintech.example,domain,complaint: asked that nobody at Gale is contacted (R5),2026-11-03
```

## Log (WOULD WRITE)
```
2026-11-03 08:49 | reply | L205 | reply L205 classified unsubscribe; no reply; DNC email; stage Do not contact; D4 blocked by guard
2026-11-03 10:49 | reply | L208 | reply L208 classified out of office (until 2026-11-09); D11 kept 2026-11-10; finance@ not contacted
2026-11-03 10:49 | reply | L203 | reply L203 classified yes; time agreed in writing 5 Nov 15:00 SGT; HOLD created (no guests); confirmation drafted; Calls booked; stage Call booked; OP04
2026-11-03 10:49 | meeting | L203 | meeting L203 2026-11-05 15:00 SGT hold created
2026-11-03 11:49 | reply | L202 | reply L202 classified more info + pricing/Tron; draft for approval; roadmap row (Tron) to product-manager
2026-11-03 16:49 | reply | L201 | reply L201 classified not now (Q1); auto thank-you queued for 17:49 (09:49 UK); next_action_date 2027-01-11; no DNC
2026-11-03 17:49 | send | L201 | REPLY sent in t-201 (guard ALLOW)
2026-11-03 18:24 | reply | L207 | RISK: spam complaint from Mark Ellis (Gale Fintech); DNC domain galefintech.example; stage Do not contact; apology text in Approval Queue only (guard BLOCK DNC); AUTO-THROTTLE to 20/day; autonomy held at 1
2026-11-03 18:24 | hygiene | L202 | Calendar 3 Nov 14:00 Sunda tentative entry has no written agreement: flagged to Aashmiin, not counted
```

## Told to Aashmiin immediately (top of tonight's summary)
1. Spam complaint from Mark Ellis, CFO of Gale Fintech (UK), arrived 6 minutes after his D4. Gale is on
   Do-not-contact (whole domain). The code throttled sending to 20/day. An apology is waiting for your
   decision. It can only go from you, by hand, since he asked not to be contacted.
2. Hannah Lim (Vega) agreed **Thu 5 Nov 15:00 SGT** in writing. Hold is on your calendar (no invite yet).
   Approve the confirmation draft and I'll send the invite.
3. Ayu (Sunda) asked the price and about Tron. The draft quotes the founding pilot price and says plainly
   that Tron isn't supported. It needs your OK.

## What changes for tomorrow's sending (Wed 4 Nov)
- **Cap drops from 75 to 20** (`volume --today 2026-11-04`: `cap_today 20, throttled true, alerts
  ["AUTO-THROTTLE to 20/day: 1 spam complaint(s)"]`). Replies first, then follow-ups, then first emails
  inside 20. FIRST_EMAIL_CAP 50 is irrelevant while throttled. The throttle stays as long as the complaint
  is in the 100-send window. I don't change Settings.
- **Stopped sequences:** Hannah (call booked), Ben (not now; nurture 11 Jan), Chloe (DNC), Mark/Gale (DNC,
  whole domain), Ayu (replied). Ravi's D11 moves to 10 Nov. No D4/D11 falls due on 4 Nov (the next D4s are
  the 3 Nov first emails on 7 Nov).
- **Week-1 process continues** (complaint ≠ 0 rules out direct sending in week 2 too). Tonight's queue for
  4 Nov must fit the 20 cap, minus replies she approves (R1, R4).
- Pinecrest: L113 stays parked (colleague unsubscribed); I'll ask before using him.
- One proposed fix for the complaint (P12): the complaint came after the **D4** (second email to someone
  who hadn't asked). I suggest the gtm-strategist review the D4 wording and timing for UK finance leaders.
  I'm not changing anything without her.

## Notes
- Auto vs draft follows RULES.md exactly: automatic only for R2 (not now / not interested family, through
  the guard). R1 is a draft because BOOKING_LINK is empty. R4 is a draft (pricing/product). R5 has no
  automatic contact and isn't a Gmail draft, since the guard BLOCKs it on DNC. R3 and R6 get no reply.
- Calendar hold only for R1, where the time was agreed in writing. None for Ayu.
- The guard simulation used a copy of `fixtures/work` with today's Touches/DNC rows appended. The fixtures
  themselves were not changed.
