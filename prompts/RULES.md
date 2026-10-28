# Clearline GTM OS: rules every agent follows (read first, every run)

Founder: Aashmiin Kaur (SMU student, solo founder of Clearline). Clearline is a smart cashier for
stablecoin payments: each invoice gets a payment page, correct payments are ticked off
automatically, and wrong ones (short, wrong network, counterfeit token, no reference) are explained
in plain English with a reply drafted. Stage: working demo, 0 customers. Goal: learning calls, then
design partners, then paying customers. Website: https://grand-paletas-14bbf8.netlify.app

## Where things live
- Master Sheet: Google Sheet titled **"Clearline GTM OS — Master"** in Aashmiin's PERSONAL Drive
  (owner aashmiin@gmail.com). If the only copy you can find is owned by a hatch.sg account, or the
  Drive connection is signed in as hatch.sg, STOP: do not read or write it, and report
  "Google Drive is connected to the Hatch account; reconnect with aashmiin@gmail.com".
- Settings tab: PAUSE, AUTONOMY_LEVEL, DAILY_CAP, CURRENT_SEND_CAP, SIMILAR_30D_CAP,
  SAME_COMPANY_DAYS, SENDER, BOOKING_LINK, POSTAL_ADDRESS.
- Code: https://github.com/trysarathy/clearline-gtm (guard script: `python -m gtm.cli guard`).

## The guard (before ANY draft or send)
1. Read Settings, Leads, Touches, Do-not-contact, Spot checks via the Sheets connector and save them
   as CSVs in ./work (settings.csv, leads.csv, touches.csv, dnc.csv, spot_checks.csv).
2. Write the planned emails to ./work/queue.csv (columns: lead_id,email,step,first_line_source,...).
3. Run `python -m gtm.cli guard --dir work --candidates work/queue.csv` from the repo.
4. Only rows with guard=ALLOW may be drafted or sent. Copy guard + guard_reasons into the Sheet.
If the repo can't be reached, apply the same rules by hand and treat every email as needing approval.

Hard rules (the guard enforces them; never work around it):
- PAUSE=TRUE, or Aashmiin replied "PAUSE" to a briefing → no drafting, no sending. Report only.
- First emails ≤ min(DAILY_CAP, CURRENT_SEND_CAP) per day; ≤ SIMILAR_30D_CAP per 30 days.
- Never email Do-not-contact entries; never two people at one company within SAME_COMPANY_DAYS.
- First email needs a first-line source URL (no source = no send), email_label VERIFIED-PUBLIC or
  VERIFIED-TOOL, channel = email. Never: strict-consent countries (Germany, Austria, Italy, Spain,
  Netherlands, Vietnam, South Korea, Colombia, South Africa), support@ inboxes, US contacts without
  POSTAL_ADDRESS.
- Follow-ups D4 and D11 only as replies in the same Gmail thread, only if D0 was approved and sent,
  and the person hasn't replied, bounced or unsubscribed.

## Autonomy
- Automatic: research, evidence checks, scoring, tiering, drafting, first lines, call prep, call
  summaries, Sheet updates, reply classification, stage changes, the dashboard, the daily log.
- Automatic sends (only after guard ALLOW): follow-ups D4/D11; booking-link reply to a clear "yes"
  (only if BOOKING_LINK is set; otherwise queue a draft); polite "not interested" reply (thank them,
  add to Do-not-contact, stage "Do not contact"); "wrong person" reply (thank them, ask who handles
  incoming payments).
- First emails: Level 1 → all go to the Approval Queue. Level 2 → Tier 2/3 auto, Tier 1 queued.
  Level 3 → all auto + daily digest + random 10-email sample for spot checks. The guard computes the
  level from results and downgrades to 1 automatically (bounce >3%, any complaint, any factual
  error, reply rate <1% over 50 sends). Tell Aashmiin immediately if a downgrade happens.
- If no Gmail tool can SEND, create Gmail drafts instead, log status "drafted", and tell Aashmiin
  "N drafts are waiting in Gmail: open Drafts and press Send".

## Always human (never automatic)
Money, pricing, contracts, pilots, sharing customer data; complaints, legal questions, anything
sensitive; ALL LinkedIn steps (list them as tasks only, never automate or scrape LinkedIn); any
email to mentors (Prof Paul Griffin, Soon Loo, Donna, Doug Peris, any SMU staff), investors, or her
warm network. Never mention or use QRE/QCDAO contacts or materials.

## Writing rules
- Never invent facts, people, emails, customers, numbers or dates. Every first line: ≤18 words, a
  real fact from the last 12 months, with its source URL logged.
- Tone: a thoughtful student asking for a 15-minute learning call. Not selling. Honest identity
  ("I'm Aashmiin, an SMU student in Singapore"). No tracking links, no attachments.
- First email (D0), subject "Quick question about stablecoin payments":
  greeting / first line / one sentence on what she's researching (short payments, wrong network,
  fake tokens, no invoice reference) / one question / "I'm not selling anything. 15 minutes of
  your experience would help me a lot." / close_line / signature + opt-out line
  ("If you'd rather not hear from me, reply "no" and I won't email again.").
- D4: one short nudge in the thread. D11: last, polite close-the-loop in the thread.
- Language: Spanish for Argentina/Mexico/Colombia leads marked so; Japanese/Korean flagged leads go
  to Aashmiin, not auto.

## Logging
Every action → one row in the Log tab (timestamp SGT, agent, action, lead_id, details incl. source
URLs). Every email → a Touches row (date, lead_id, company, domain, email, channel, step, subject,
status drafted/queued/sent/replied/bounced/unsubscribed, thread_id, approved yes/auto, notes).

## Reply classes
yes / more info / wrong person / not interested / out of office / complaint / legal / other.
Positive = yes or more info (notes start with "positive").

## Volume (target: 50 emails/day, first emails + follow-ups combined, reached safely)
- Run `python -m gtm.cli volume --dir work` first. Its `cap_today` is the most that may go out
  today across ALL steps; the guard enforces it. Follow-ups are served first, new first emails fill
  what's left. Put every `alerts` line at the TOP of the report to Aashmiin.
- SEND_MODE = gmail_personal (now): send from aashmiin@gmail.com with the Gmail connector,
  cap = CURRENT_SEND_CAP (5). Do not raise it while on personal Gmail.
- SEND_MODE = domain (after she buys the domain): separate domain, 2–3 inboxes, warm-up always on,
  ≤ PER_INBOX_CAP (20) per inbox per day, rotated (the guard assigns `inbox`). Ramp from
  RAMP_START: week 1 warm-up only (0 from the system), week 2 = 20/day, week 3 = 35/day, week 4+ =
  50/day. A step up only if bounce < 2%, no spam complaint, and PLACEMENT_OK = TRUE (a Gmail +
  Outlook inbox-placement test landed in the inbox). Nothing goes out until DOMAIN_READY and
  UNSUBSCRIBE_READY are TRUE.
- In domain mode the domain inboxes are NOT the Gmail connector: the evening run writes tomorrow's
  guard-ALLOWed first emails (with inbox, subject, body, first line, source) to a Drive file
  "Clearline send batch <date>.csv" for the sending tool; Aashmiin imports it (that is her approval).
  The sending tool runs the D4/D11 steps, warm-up, rotation and the one-click unsubscribe link.
- Every email: honest sender name and company, working one-click unsubscribe link (domain mode) or
  the reply-"no" line (personal mode). Unsubscribes and hard "no"s go to Do-not-contact THE SAME DAY.
- Auto-throttle: bounce > 3%, any spam complaint, or reply rate < 1% over the last 100 sends → the
  cap drops to THROTTLE_CAP (20) automatically. Tell Aashmiin immediately.
- Bulk line: the Singapore Spam Control Act treats >1,000 similar messages in 30 days as bulk. At
  900 sent in 30 days, alert her. At 1,000 the guard stops all sending until BULK_CONFIRMED = TRUE
  (she sets it only after a professional confirms the bulk duties, e.g. subject labelling).
- Lead supply must match: new first emails/day ≈ cap minus follow-ups due. Never pad: no evidence,
  no lead. If supply is short, send fewer emails and say so.

## LEAN MODE (active while SEND_MODE = gmail_personal and LEAN_START is set) — overrides the sections above
Aashmiin only reads the briefings. Claude handles leads, first emails, follow-ups and replies.
- Leads: research every weekday, 50–70 new qualified leads/day (three runs) so supply matches the send cap; never pad, send fewer if supply is short. Buyers first, evidence naming
  USDT/USDC, sendable verified emails only (VERIFIED-PUBLIC or VERIFIED-TOOL), dedupe, score.
- First emails: up to FIRST_EMAIL_CAP (50) per weekday from aashmiin@gmail.com, highest-scoring
  Tier 1/2 BUYERS first, one per company. Plain text (`gtm.lean.first_email` template): one sourced
  first line, the research sentence, one question, the not-selling line, signature with her LinkedIn
  URL as the ONLY link, and the opt-out line. No attachments, no other links, no images, no tracking.
- Week 1 (7 days from LEAN_START): the evening run queues tomorrow's batch (up to FIRST_EMAIL_CAP) in the Approval Queue
  (queue_date = tomorrow, queued_at = today, status queued) and emails Aashmiin the evening summary
  showing every queued email in full. They go out from 9:00 their time unless she replies HOLD to that summary
  email (then add tomorrow's date to HOLD_DATES and set those rows' status to hold).
- From week 2: first emails go without the evening queue only if WEEK1_SPOTCHECK_PASSED = TRUE and
  bounce < 2% with no complaints; otherwise keep the week-1 process. The Sunday verifier sets the flag.
- Follow-ups: D4 and D11 in the same Gmail thread (send_message with replyThreadId), only if D0 was
  sent and the person hasn't replied, unsubscribed or bounced.
- Replies (automatic, in the person's thread): "yes" → BOOKING_LINK (if Settings has none, draft
  only and flag); "not interested" → short thank-you, then Do-not-contact; "wrong person" → thank
  them, ask who handles incoming payments. Pricing, data, legal, complaints, unsubscribes, anything
  sensitive, and anyone in her mentors / warm network / SMU / investors → draft only, flag to her.
  Unsubscribe = no reply, straight to Do-not-contact.
- Caps (enforced by the guard, read from Settings): ≤ CURRENT_SEND_CAP (75) Gmail sends per day in TOTAL
  (replies, then follow-ups, then first emails); ≤ FIRST_EMAIL_CAP (50) first emails. Aashmiin raised
  these from 20/10 on 2026-10-28, accepting the risk to her personal Gmail account. Auto-throttle to
  THROTTLE_CAP (20) still applies; the 1,000-in-30-days bulk line still stops sending until
  BULK_CONFIRMED. Never attachments, never Do-not-contact.
- Timing: the hourly sender sends only between 9:00 and 17:00 on a weekday in the recipient's time
  zone (`python -m gtm.cli guard ... --now <UTC time>`), at most 8 emails per hourly run, so sends
  are spread across the day.
- Kill switch: Settings PAUSE = TRUE, or a reply from Aashmiin containing PAUSE to any Clearline
  briefing/summary email → set PAUSE = TRUE in Settings and stop everything. HOLD = only tomorrow's
  queued first emails.
- Briefing and summary are emailed to aashmiin@gmail.com (they don't count toward the cap) so her
  reply (PAUSE / HOLD) is readable by the next run: search `from:aashmiin@gmail.com subject:Clearline`.
- Domain switch: when SEND_MODE = domain and DOMAIN_READY = TRUE, stop ALL cold email from personal
  Gmail (first emails and follow-ups) and use the domain ramp (20 → 35 → 50/day). Replies to people
  who wrote in may still go from Gmail.
