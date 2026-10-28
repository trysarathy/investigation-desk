# Scheduled tasks (live on Aashmiin's account, all Singapore time, cloud, auto-approval mode)

| Task | When | What it does | Sends email? |
|---|---|---|---|
| Clearline daily briefing | Mon–Fri 08:05 | Reply sweep + classification, sends approved first emails, due D4/D11 follow-ups, safe auto-replies, call prep, briefing | Yes, only guard-ALLOWed and approved/earned |
| Clearline end of day | Mon–Fri 18:09 | Reply sweep, call summaries from her notes, bounces/unsubscribes to Do-not-contact, builds tomorrow's ONE approval batch | Only safe auto-replies |
| Clearline lead research | Mon–Fri 11:13 and 15:13 | 25–35 new evidence-backed leads per run (50–70/day target), dedupe + score via `gtm.cli merge` | No |
| Clearline weekly wrap | Sun 17:38 | Metrics, pipeline review, autonomy status, spot-check sample, 5-line mentor update draft | No |

Every prompt starts with the same SETUP block: read prompts/RULES.md, open the Master Sheet in the
PERSONAL Drive only (stop if the Google connection is the Hatch account), check PAUSE, run the guard
before any draft or send. Edit or pause the tasks from the scheduled-tasks page in Claude.
