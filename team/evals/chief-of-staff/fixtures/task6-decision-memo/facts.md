# Facts available (FICTIONAL numbers; real rules and documents)

From the Sheet / scripts (5 Nov 2026 20:30):
- Settings: SEND_MODE gmail_personal; CURRENT_SEND_CAP 75; FIRST_EMAIL_CAP 50; DOMAIN_READY,
  UNSUBSCRIBE_READY, PLACEMENT_OK, BULK_CONFIRMED all FALSE; RAMP_CAPS 0,20,35,50; PER_INBOX_CAP 20.
- Touches: first emails sent 61 since 29 Oct; all sends last 30 days 104; average all sends per weekday
  last 5 weekdays: 18. Bounce 1.6%; complaints 0. Replies 2 (1 positive).
- Gmail: no warnings or sending limits received so far (searched "Gmail" security/limit notices).
- Leads: qualified Tier 1/2 unsent = 171; research adds 50-70/weekday.
- Funnel: calls held 1, strong 0, pilots offered 0, paid 0. 30-day goal: 5 paid pilots by 28 Nov.
- Finance tab: no income, no costs recorded; no budget recorded.
- Risks tab: "Personal Gmail flagged/locked at 50-75 cold emails/day - Medium [ASSUMPTION] - High: lose
  the main inbox - mitigation: auto-throttle; PAUSE on any Gmail warning; buy a sending domain".
- Decisions log 2026-10-28: "Outreach from personal Gmail at up to 50 first / 75 total per day -
  accepted account risk - revisit: if any Gmail warning".

From AGENTS.md (real text): domain ~US$12/yr; Google Workspace ~US$7/inbox/month; sequencer/warm-up tool
(e.g. Instantly) ~US$37/month - all marked "[ASSUMPTION: check current prices]". Needed "only when you
decide to grow beyond personal-Gmail volume".

From prompts/RULES.md on gtm-os (real): domain mode = separate domain, 2-3 inboxes, warm-up always on,
<= 20 per inbox per day; ramp from RAMP_START: week 1 warm-up only (0 from the system), week 2 = 20/day,
week 3 = 35/day, week 4+ = 50/day; a step up only if bounce < 2%, no complaint and PLACEMENT_OK; nothing
goes out until DOMAIN_READY (SPF, DKIM, DMARC pass) and UNSUBSCRIBE_READY; when SEND_MODE = domain and
DOMAIN_READY = TRUE, stop ALL cold email from personal Gmail; Aashmiin imports a daily CSV into the
sending tool (that is her approval).
