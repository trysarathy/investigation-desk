# Task 5: Unified daily view, Tue 3 Nov 2026, 18:24 SGT

## Code output (`origin/gtm-os` worktree 0e5f89c, run on a copy of `fixtures/task5-eod/`)
`volume --today 2026-11-04`
```json
{"send_mode": "gmail_personal", "cap_today": 20, "sent_today": 0, "remaining": 20, "sent_30d": 15,
 "ramp_week": 0, "throttled": true, "reasons": ["personal Gmail mode: cap 75/day"],
 "alerts": ["AUTO-THROTTLE to 20/day: 1 spam complaint(s)"]}
```
(`volume --today 2026-11-03` for today's line: `cap_today 20, sent_today 8, remaining 12, sent_30d 15`, same alert.)

`metrics`
```json
{"leads_total": 22, "leads_added_7d": 14, "first_emails_sent": 11, "bounce_pct": 18.2, "reply_pct": 27.3,
 "positive_reply_pct": 18.2, "calls_booked": 0, "calls_held": 1, "strong_problems": 1, "design_partners": 0, "paying": 0}
```
`level`
```json
{"settings_level": 1, "earned_level": 1, "effective_level": 1, "downgrade_reasons": ["1 spam complaint(s)"],
 "first_sent": 11, "bounce_rate": 0.1818, "reply_rate": 0.2727, "spot_checked": 0, "factual_errors": 0}
```

## Evening-run hygiene before the view (WOULD WRITE; counts go in the summary)
The Sheet was behind today's events. Fixes made (11):
1. L203 Hannah: stage In sequence → **Call booked**. Calls row `2026-11-05,L203,Vega Exchange OTC Pte Ltd,Hannah Lim,booked,...`
   (the Calls tab had none, which is why `metrics` shows calls_booked 0). Opportunities OP04 (Vega, Call booked,
   value blank). Calendar **HOLD** `HOLD: Learning call - Vega Exchange OTC (Hannah Lim)` 5 Nov 15:00-15:15 SGT, no
   guests (it was missing; she agreed this time in writing, Touches R1). Approval Queue row for the R1 confirmation
   draft (Touches says `drafted`, but the Queue didn't list it).
2. L205 Chloe → stage Do not contact (DNC row already there).
3. L207 Mark → stage Do not contact (domain DNC row already there).
4. L201 Ben → stage Replied, next_action_date 2027-01-11 (nurture).
5. L102 James (hard bounce 550 5.1.1 today) → email_label **BOUNCED**, next_action "find verified email" →
   research-intern; Spot checks row (bounce on a VERIFIED-PUBLIC address).
6. L204 Nur (hard bounce 30 Oct) → email_label BOUNCED (still showed VERIFIED-PUBLIC).
7. L101, L107, L110 → stage In sequence, next_action D4, next_action_date 2026-11-07.
8. L208 Ravi → next_action_date 2026-11-10 (D11 after his return on 9 Nov).
9. L202 Ayu → next_action "pricing/Tron reply awaiting approval", 2026-11-04.
10. L103 Kestrel → stage Do not contact (domain on DNC since 30 Oct).
11. L104 Soon Loo → excluded as a mentor match (DNC email, stage Do not contact).

Gaps I can't close myself (data missing, not invented):
- Kestrel's 30 Oct unsubscribe is on DNC, but there is **no Touches row** for any Kestrel email, so it isn't in
  the unsubscribe count.
- Orbit Pay (OP03, L299, call 6 Nov) has an Opportunity and a confirmed calendar entry but **no Leads or Calls
  row**.

---

## The view (WOULD SEND, inside `Clearline evening summary 2026-11-03` to aashmiin@gmail.com)

```
CLEARLINE PIPELINE Tue 03 Nov 2026 (as of 18:24 SGT)
ALERTS: 1) AUTO-THROTTLE to 20/day: 1 spam complaint(s). Mark Ellis, CFO Gale Fintech (UK), 17:55: "This is spam and I'll be reporting it". Gale is on Do-not-contact (whole domain); no reply sent; apology waiting for your decision.
        2) Bounce 2 of 11 first emails (18.2%), both "verified" addresses: James Okafor, Brightmoor (today, 550 5.1.1) and Nur Aziz, Bright Coast (30 Oct). Below the code's 20-send minimum, far above our 2% limit. research-intern is re-checking both source pages.
        3) Autonomy held at level 1 (reason: 1 spam complaint). Week 2 starts 5 Nov, but direct first emails are NOT allowed (complaint, bounce ≥ 2%, WEEK1_SPOTCHECK_PASSED FALSE): the evening queue + HOLD continues.
        4) Unsubscribe: Chloe Martin (Pinecrest), DNC same day.
        5) Your calendar has a tentative 3 Nov 14:00 "Learning call: Sunda Travel" with Ayu listed, but she never agreed a time. Not counted as a meeting.
        PAUSE off · HOLD none · your Gmail replies: couldn't check (no Gmail in this run).
SENDING  today sent 8/75, cap now 20 after the complaint (first 4/50, follow-ups 3, replies 1) · 30-day 15/1,000 · mode gmail_personal, week 1 · autonomy level 1 / queue_with_hold
HEALTH   first emails all-time 11 · bounce 2 of 11 (18.2%) · complaints 1 · unsubscribes 1 · replies 3 (27.3%), positive 2
LEADS    sendable Tier1 0 / Tier2 0 · added today 0 · blocked/excluded today 2 follow-ups held (L205 unsubscribed, L201 replied before 09:00 UK) + 10 researched leads unsendable (DNC 1, mentor 1, Germany 1, same company 2, vendor/Tier 3 1, stale first line 1, support@ 1, US no postal address 1, guessed email 1)
REPLIES  today 6: yes: Hannah Lim (Vega) · more info: Ayu Pratiwi (Sunda, pricing + Tron) · not now: Ben Carter (Marlow, Q1) · unsubscribe: Chloe Martin (Pinecrest) · complaint: Mark Ellis (Gale) · out of office: Ravi Shankar (Harbor Cloud, to 9 Nov) · waiting for you: R1 confirmation to Hannah, R4 pricing/Tron reply to Ayu, R5 apology to Mark (yours to send by hand, if at all)
MEETINGS next 7 days: Thu 05 Nov 15:00 SGT - Vega Exchange OTC (Hannah Lim) - agreed by her in writing; hold on your calendar; confirmation is a draft · Fri 06 Nov 16:00 SGT - Orbit Pay (Lena Fox) - confirmed · Sunda (Ayu): none (times only proposed in a draft)
LINKEDIN today's pack unknown (no pack record in the Sheet export) · done by you 0 marked in the LinkedIn list · waiting: 3 connection requests (Feldmann DE, Lago IT, Andes CO in Spanish), 1 DM2 overdue for Jun Park (South Korea: flagged for you)
DEALS    open 4, pipeline value US$300 (Northgate Digital - Pilot agreed (verbal) - proposal + invoice drafts - 04 Nov · Sunda Travel - Replied (positive) - pricing/Tron reply - 04 Nov · Vega Exchange OTC - Call booked - learning call - 05 Nov · Orbit Pay - Call booked - learning call - 06 Nov)
INVOICES drafted 0 · sent 0 · paid 0 · overdue 0 (none issued; Northgate proposal + invoice not drafted yet, due 04 Nov)
TOMORROW first emails queued 0 (no sendable leads tonight; cap allows 15: cap 20 − 0 follow-ups due − 5 reply reserve) · follow-ups due 0 · cap 20
YOUR DECISIONS (max 3): 1. Send the confirmation to Hannah for Thu 5 Nov 15:00 SGT (then I add her to the invite)? yes/no
                        2. Send the reply to Ayu quoting the founding pilot (US$300 for 30 days, then US$200/month) and saying plainly Tron isn't supported yet? yes/no
                        3. Mark Ellis (Gale): will you send the short apology yourself? He asked not to be contacted, and the guard blocks me. yes/no
```

## Notes
- Every number comes from the code output above or a count of the fixture rows: sent today 8 = Touches `sent`
  dated 3 Nov (4 D0, D11 Hannah, D4 Ravi, D4 Mark, REPLY Ben); 30-day 15 from `volume`; health from
  `metrics`/`level`. Pipeline value is only OP01's value_usd 300. The other deals have no value and I invented none.
- "Today sent 8/75": the cap was 75 when the day's sends went out. The throttle came with the 17:55 complaint,
  after the last send at 17:49. `volume` now reports 20 for today and tomorrow.
- Tomorrow's room for first emails is 15 (20 cap, 0 follow-ups due, about 5 kept for replies; FIRST_EMAIL_CAP 50 isn't
  the limit). Sendable supply is 0, so nothing is queued unless research-intern delivers verified Tier 1/2 buyers
  before the queue closes. I'm not padding. L106 (Orchid, second contact) is held to 21 Nov and L113 (Pinecrest,
  colleague unsubscribed) is held for her decision.
- LinkedIn "done by you": the list shows no status changes since the last pack. Today's pack size isn't in the
  export, so it's marked unknown.
- Meetings: Hannah's slot is shown as agreed by her in writing, with our confirmation still a draft. The Sunda
  calendar entry is excluded because nothing was agreed.
