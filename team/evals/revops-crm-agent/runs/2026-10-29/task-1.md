# Task 1: Evening queue build for Tue 3 Nov 2026 (run: Mon 2 Nov 2026, 18:24 SGT)

## P0 pre-flight
- Connection: aashmiin@gmail.com assumed (fixture run, no live Google connection). Not hatch.sg.
- Settings (`work/settings.csv`): PAUSE = FALSE, HOLD_DATES empty, SEND_MODE = gmail_personal,
  LEAN_START = 2026-10-29, so Tue 3 Nov is **LEAN week 1** (queue-with-HOLD). WEEK1_SPOTCHECK_PASSED = FALSE.
  CURRENT_SEND_CAP 75, FIRST_EMAIL_CAP 50, BOOKING_LINK empty, POSTAL_ADDRESS empty.
- PAUSE/HOLD Gmail search: live Gmail is OFF, so I could not check it. On the job this runs before
  anything else. Here: **unknown, not checked**.
- Code: scratch worktree of `origin/gtm-os` at 0e5f89c. `python3 -m unittest`: **38 tests, OK**.

## (c) Code output

`python3 -m gtm.cli volume --dir work --today 2026-11-03`
```json
{"send_mode": "gmail_personal", "cap_today": 75, "sent_today": 0, "remaining": 75, "sent_30d": 7,
 "ramp_week": 0, "throttled": false, "reasons": ["personal Gmail mode: cap 75/day"], "alerts": []}
```

`python3 -m gtm.cli guard --dir work --candidates work/queue.csv --today 2026-11-03` (queue-build run, so
no `--now`; the hourly sender adds `--now` tomorrow)
```json
{"level": 1, "downgrade_reasons": [], "pause": false, "send_mode": "gmail_personal",
 "daily_cap": 75, "sent_today": 0, "sent_30d": 7, "cap_reasons": ["personal Gmail mode: cap 75/day"],
 "alerts": [], "allowed": 9, "blocked": 6,
 "verdicts": [
  {"lead_id": "L203", "step": "D11", "result": "ALLOW", "reasons": []},
  {"lead_id": "L201", "step": "D4",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L205", "step": "D4",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L207", "step": "D4",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L208", "step": "D4",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L101", "step": "D0",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L102", "step": "D0",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L107", "step": "D0",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L110", "step": "D0",  "result": "ALLOW", "reasons": []},
  {"lead_id": "L103", "step": "D0",  "result": "BLOCK", "reasons": ["on Do-not-contact"]},
  {"lead_id": "L105", "step": "D0",  "result": "BLOCK", "reasons": ["Germany: strict consent rules, LinkedIn or intro first"]},
  {"lead_id": "L111", "step": "D0",  "result": "BLOCK", "reasons": ["support inbox: low reply odds, use LinkedIn"]},
  {"lead_id": "L112", "step": "D0",  "result": "BLOCK", "reasons": ["US contact: add POSTAL_ADDRESS in Settings first (CAN-SPAM)"]},
  {"lead_id": "L113", "step": "D0",  "result": "BLOCK", "reasons": ["someone at pinecrest-media.example was emailed on 2026-10-30: wait 7 days"]},
  {"lead_id": "L114", "step": "D0",  "result": "BLOCK", "reasons": ["email not verified (GUESSED-PATTERN)"]}
 ]}
```
(`inbox` is "" and `needs_approval` false on every row, as expected in lean mode; trimmed for space.)

Check run (not queued, evidence only): the guard on the four leads I excluded **before** the guard gives
`allowed 4, blocked 0` (L104, L106, L108, L109 all ALLOW). That is why the pre-guard exclusions below are
mine to make: the guard would have let a mentor, a second Orchid contact, a Tier 3 vendor and a 15-month-old
first line through.

`level`: settings 1, earned 1, effective 1. `metrics`: first_emails_sent 7, bounce_pct 14.3 (1 of 7),
reply_pct 14.3 (1 of 7), calls_held 1, strong 1, paying 0.

## Capacity
cap 75 (volume) − 5 follow-ups due Tue − ~5 reserve for replies = 65 room, limited to FIRST_EMAIL_CAP 50.
**Sendable supply is 4.** I queued 4 first emails, not 50, and did not pad the batch.

## (a) Approval Queue rows (final work/queue.csv after the guard; bodies in the evening summary / task 2)
```csv
queue_date,queued_at,lead_id,company,contact_name,email,step,subject,first_line_source,guard,guard_reasons,needs_approval,APPROVE,status,thread_id
2026-11-03,2026-11-02,L203,Vega Exchange OTC Pte Ltd,Hannah Lim,hannah.lim@vega-otc.example,D11,Re: Quick question about stablecoin payments,,ALLOW,,no,,queued,t-203
2026-11-03,2026-11-02,L201,Marlow Shipping Ltd,Ben Carter,ben.carter@marlowshipping.example,D4,Re: Quick question about stablecoin payments,,ALLOW,,no,,queued,t-201
2026-11-03,2026-11-02,L205,Pinecrest Media Pty Ltd,Chloe Martin,chloe.martin@pinecrest-media.example,D4,Re: Quick question about stablecoin payments,,ALLOW,,no,,queued,t-205
2026-11-03,2026-11-02,L207,Gale Fintech Ltd,Mark Ellis,mark.ellis@galefintech.example,D4,Re: Quick question about stablecoin payments,,ALLOW,,no,,queued,t-207
2026-11-03,2026-11-02,L208,Harbor Cloud Pte Ltd,Ravi Shankar,ravi.shankar@harborcloud.example,D4,Re: Quick question about stablecoin payments,,ALLOW,,no,,queued,t-208
2026-11-03,2026-11-02,L101,Tidewater Freight Pte Ltd,Mei Tan,mei.tan@tidewater-freight.example,D0,Quick question about stablecoin payments,https://tidewater-freight.example/payments,ALLOW,,no,,queued,
2026-11-03,2026-11-02,L102,Brightmoor Studios Ltd,James Okafor,james.okafor@brightmoor.example,D0,Quick question about stablecoin payments,https://brightmoor.example/careers/finance-analyst,ALLOW,,no,,queued,
2026-11-03,2026-11-02,L107,Orchid Remit Ltd,Daniel Chow,daniel.chow@orchidremit.example,D0,Quick question about stablecoin payments,https://orchidremit.example/faq,ALLOW,,no,,queued,
2026-11-03,2026-11-02,L110,Dune Logistics FZ-LLC,Omar Haddad,omar.haddad@dunelogistics.example,D0,Quick question about stablecoin payments,https://dunelogistics.example/invoicing,ALLOW,,no,,queued,
2026-11-03,2026-11-02,L103,Kestrel Data Labs Pte Ltd,Arjun Rao,arjun.rao@kestrel-labs.example,D0,Quick question about stablecoin payments,https://kestrel-labs.example/pricing,BLOCK,on Do-not-contact,no,,blocked,
2026-11-03,2026-11-02,L105,Feldmann Logistik GmbH,Katrin Feldmann,k.feldmann@feldmann-logistik.example,D0,Quick question about stablecoin payments,https://feldmann-logistik.example/press/usdc,BLOCK,"Germany: strict consent rules, LinkedIn or intro first",no,,blocked,
2026-11-03,2026-11-02,L111,Coral Games Pte Ltd,,support@coralgames.example,D0,Quick question about stablecoin payments,https://coralgames.example/store,BLOCK,"support inbox: low reply odds, use LinkedIn",no,,blocked,
2026-11-03,2026-11-02,L112,Redwood Invoicing Inc,Sarah Kim,sarah.kim@redwoodinvoicing.example,D0,Quick question about stablecoin payments,https://redwoodinvoicing.example/billing-terms,BLOCK,US contact: add POSTAL_ADDRESS in Settings first (CAN-SPAM),no,,blocked,
2026-11-03,2026-11-02,L113,Pinecrest Media Pty Ltd,Liam Walsh,liam.walsh@pinecrest-media.example,D0,Quick question about stablecoin payments,https://pinecrest-media.example/onboarding,BLOCK,someone at pinecrest-media.example was emailed on 2026-10-30: wait 7 days,no,,blocked,
2026-11-03,2026-11-02,L114,Atlas Trade House Pte Ltd,Wei Ling Goh,weiling.goh@atlastrade.example,D0,Quick question about stablecoin payments,https://atlastrade.example/news/october,BLOCK,email not verified (GUESSED-PATTERN),no,,blocked,
```
Follow-up bodies are `lean.followup("D4"/"D11", "Hi <first name>,", LINKEDIN_URL)` verbatim, in thread.
First-email bodies are `lean.first_email(...)`; each first line was re-checked against its leads.csv
record (fixture rule) and is 13 to 15 words long. L107's body is shown in the summary below; L101, L102 and
L110 are in task 2. Tomorrow the hourly sender re-runs the guard with `--now` and sends no more than 8 per
run, inside 9:00-17:00 in the recipient's time zone (L102 and L201 are UK, so they can't go before 17:00 SGT).

## (b) Leads not queued: reason and next action
| Lead | Why not | Stopped by | Next action I set |
|---|---|---|---|
| L103 Kestrel (Arjun Rao) | Domain `kestrel-labs.example` is on Do-not-contact (unsubscribed 30 Oct), but the lead is still `Researched`: the data contradicts itself | Guard BLOCK | Stage → **Do not contact**; next_action "none (DNC)". Lead is never contacted again |
| L104 Harbour Ledger (Soon Loo) | **Soon Loo is on the mentor list** (COMPANY_RULES 6, RULES "Always human"). The guard ALLOWs this lead (check run), so I removed it myself | Me, before the guard | DNC row (email, "mentor/network: never cold email"), stage Do not contact; told Aashmiin (decision 1). If he's her mentor, any contact is hers to make personally |
| L105 Feldmann (DE) | Germany is a strict-consent country | Guard BLOCK | channel → LinkedIn; already on the LinkedIn list as LI01 "to connect" → in the 01:27 pack |
| L106 Orchid (Priya Nair) | Second person at orchidremit.example. I picked L107 Daniel Chow (priority 1 vs 2; both Tier 1/85). The guard would also have ALLOWed Priya on her own (check run) | Me, before the guard | next_action "D0 only if Daniel hasn't replied", next_action_date **2026-11-21** (7 days after Daniel's D11 on 14 Nov; an earlier date would be blocked by the 7-day company rule while his D4/D11 go out) |
| L108 Lumen Pay Tools | VENDOR, Tier 3 (35), "no public evidence they receive stablecoins". LEAN MODE says Tier 1/2 BUYERS only; the guard doesn't check this | Me, before the guard | next_action "partner review (P7 partnerships), no cold email" |
| L109 Saffron Exports | first_line_date **2025-08-04**, about 15 months old (rule: last 12 months). The guard and score don't read the date | Me, before the guard | next_action "refresh first line" → research-intern; next_action_date 2026-11-03 |
| L111 Coral Games | Only `support@`, no named contact | Guard BLOCK | next_action "find named finance contact" → research-intern; LinkedIn list once a person is found |
| L112 Redwood (US) | POSTAL_ADDRESS empty (CAN-SPAM). The US also has no entry in `lean.TZ_OFFSET`, so it would be blocked under `--now` too | Guard BLOCK | next_action "hold until POSTAL_ADDRESS + US time zone + signature address line" (decision 2) |
| L113 Pinecrest (Liam Walsh) | Chloe Martin (L205) at the same domain got her D0 on 30 Oct; her D4 goes 3 Nov and her D11 on 10 Nov | Guard BLOCK | next_action "D0 only if Chloe's sequence ends with no reply", next_action_date **2026-11-17** (7 days after Chloe's D11) |
| L114 Atlas Trade | email_label GUESSED-PATTERN: never sendable, and I never guess addresses | Guard BLOCK | next_action "verify email (public page or Apollo when it works)" → research-intern |

## (d) Sheet and Log writes (WOULD WRITE)
**Approval Queue**: the 15 rows above (9 `queued`, 6 `blocked` with their guard_reasons).

**Leads**
- L101, L102, L107, L110: next_action "D0 queued for 2026-11-03", next_action_date 2026-11-03 (stage stays
  Researched until sent).
- L103: stage → Do not contact. L104: stage → Do not contact, notes "mentor name match (Soon Loo): never
  cold email; flagged to Aashmiin 2026-11-02".
- L105: channel → linkedin, next_action "LinkedIn LI01". L106: next_action_date 2026-11-21. L108, L109,
  L111, L112, L113, L114: next_action / next_action_date as in table (b).
- Hygiene fixes found: **L204** (hard bounce 550 on 30 Oct) still shows email_label VERIFIED-PUBLIC and
  stage In sequence → email_label **BOUNCED**, next_action "find verified email" → research-intern. Because
  the address was labelled VERIFIED-PUBLIC, I also add a Spot checks row. **L202** (Replied, positive) has no
  next_action → "answer reply / propose call times (draft for Aashmiin)", next_action_date 2026-11-03.

**Do-not-contact**: `soon.loo@harbourledger.example,email,mentor/network: never cold email (lead L104),2026-11-02`

**Spot checks**: `2026-11-02,L204,revops-crm-agent,,hard bounce on VERIFIED-PUBLIC address; source page https://brightcoast.example/pay to be re-opened by research-intern`

**Calendar hygiene (flag only, no change)**: the 3 Nov 14:00 "Learning call: Sunda Travel (Ayu Pratiwi)"
entry is tentative and lists Ayu as an attendee, but Ayu has **not** agreed a time in writing. Per P6 that
shouldn't exist as an invite. I don't edit her calendar without her: I'm flagging it so she can remove it or
confirm no invite went out.

**Log** (timestamp SGT, agent revops-crm-agent)
```
2026-11-02 18:24 | P0 preflight | - | PAUSE FALSE, HOLD_DATES empty; Gmail PAUSE/HOLD search not possible (Gmail off); gtm-os 0e5f89c unittest 38 OK; volume cap 75, alerts none
2026-11-02 18:26 | pre-guard exclusion | L104 | mentor name match (Soon Loo); DNC added; stage Do not contact; flagged to Aashmiin
2026-11-02 18:26 | pre-guard exclusion | L106 | second person at orchidremit.example; L107 chosen (priority 1); next_action_date 2026-11-21
2026-11-02 18:26 | pre-guard exclusion | L108 | VENDOR Tier 3: no cold email; partner review
2026-11-02 18:26 | pre-guard exclusion | L109 | first line dated 2025-08-04 > 12 months; refresh -> research-intern
2026-11-02 18:30 | guard | - | --today 2026-11-03: allowed 9 (4 D0, 4 D4, 1 D11), blocked 6 (DNC L103; Germany L105; support inbox L111; US no POSTAL_ADDRESS L112; same company 7 days L113; GUESSED-PATTERN L114)
2026-11-02 18:31 | evening queue | L101,L102,L107,L110 | evening queue: 4 D0 + 5 follow-ups queued for 2026-11-03; 6 blocked (reasons above); 4 excluded pre-guard
2026-11-02 18:31 | hygiene | L103 | stage -> Do not contact (domain on DNC since 2026-10-30)
2026-11-02 18:31 | hygiene | L204 | email_label -> BOUNCED (hard bounce 2026-10-30); Spot checks row; research-intern to find verified email
2026-11-02 18:31 | hygiene | L202 | next_action set: answer positive reply (draft)
2026-11-02 18:32 | hygiene | - | Calendar: 3 Nov 14:00 Sunda entry tentative with attendee but no written agreement; flagged, not changed
2026-11-02 18:35 | evening summary | - | emailed to aashmiin@gmail.com (4 D0 in full)
```

## (e) Top of the evening summary (WOULD SEND to aashmiin@gmail.com)
**Subject:** Clearline evening summary 2026-11-02

```
ALERTS
- No code alerts (volume/guard: none). Not checked: your PAUSE/HOLD replies (Gmail was unavailable to me in this run).
- Bounce so far: 1 of 7 first emails (14%, Bright Coast, 550 user unknown). Below the code's 20-send minimum, so no
  throttle yet, but it was a "verified" address: I've asked research-intern to re-check the source.
- A mentor's name was in today's leads: L104 Soon Loo (Harbour Ledger Advisory). The guard would have let it
  through. I removed it and added it to Do-not-contact. Nothing was sent.

TOMORROW (Tue 3 Nov): 4 first emails + 5 follow-ups = 9 of 75 (first emails 4 of 50). Supply is short: only 4
sendable leads, so I didn't pad the batch.
  First emails (in full below; reply HOLD to this email to stop all four):
    L101 Mei Tan, Tidewater Freight (SG) · L102 James Okafor, Brightmoor Studios (UK)
    L107 Daniel Chow, Orchid Remit (HK) · L110 Omar Haddad, Dune Logistics (UAE)
  Follow-ups due (automatic, in thread): D11 Hannah Lim (Vega); D4 Ben Carter (Marlow), Chloe Martin (Pinecrest),
    Mark Ellis (Gale), Ravi Shankar (Harbor Cloud)

BLOCKED BY THE GUARD (6)
  L103 Kestrel: on Do-not-contact · L105 Feldmann: Germany, strict consent → LinkedIn pack
  L111 Coral Games: support@ only · L112 Redwood: US, no POSTAL_ADDRESS
  L113 Pinecrest (Liam): colleague Chloe emailed 30 Oct → earliest 17 Nov · L114 Atlas: guessed address
EXCLUDED BY ME BEFORE THE GUARD (4)
  L104 Soon Loo: mentor list · L106 Priya Nair: second Orchid contact (Daniel chosen) → 21 Nov
  L108 Lumen Pay Tools: vendor, Tier 3 · L109 Saffron: first line from Aug 2025 (over 12 months) → refresh

YOUR DECISIONS
1. L104 "Soon Loo, Managing Partner, Harbour Ledger Advisory": is this your mentor? Either way I won't email
   him. Reply "mine" if you want to contact him yourself.
2. US leads (Redwood): to email them we need POSTAL_ADDRESS in Settings, an address line in the signature
   (crypto-protocol-engineer) and a US time zone in the code. Shall I raise it with engineering? yes/no
3. Your calendar shows a tentative 3 Nov 14:00 call with Ayu (Sunda) listing her as a guest, but she hasn't
   agreed to a time. Remove it? yes/no (I haven't touched it)
```
Then: first emails in full (L107 below; L101/L102/L110 as in task 2), and drafts waiting (none from me tonight).

> To: daniel.chow@orchidremit.example · Subject: Quick question about stablecoin payments · Source:
> https://orchidremit.example/faq (dated 2026-10-02)
>
> Hi Daniel,
>
> Orchid's FAQ, updated in October, says business clients can settle invoices in USDT or USDC.
>
> I'm Aashmiin, a student at SMU in Singapore, building a small tool in this area (Clearline) and researching what happens when stablecoin payments arrive wrong: short after fees, on the wrong network, a fake token, or with no invoice reference.
>
> When a client settles an invoice in USDT or USDC and the amount or reference doesn't match, who sorts it out, and how long does it take?
>
> I'm not asking you to buy anything. 15 minutes of your experience would help me a lot. Would you be open to a short call next week?
>
> Best regards,
> Aashmiin Kaur
> SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391
>
> If you'd rather not hear from me, just reply "no" and I won't email again.

## Notes
- I ran the real guard from a detached `origin/gtm-os` worktree against a copy of `fixtures/work`, using
  `--today 2026-11-03` and no `--now` (this is a queue build; P1.6). Fixture files were not modified.
- Four exclusions are rules the guard doesn't enforce: mentor, second contact at a company, Tier 3/VENDOR, and
  a stale first line. The check run shows the guard would have ALLOWed all four.
- Throughput: only 4 sendable leads against 50 room. Supply is the constraint, so research-intern needs more
  verified Tier 1/2 buyers.
- The `.example` source URLs can't be opened. Per the fixtures README, I treated leads.csv as what I saw
  on the page this run.
