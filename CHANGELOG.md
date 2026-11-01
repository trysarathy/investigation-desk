# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **Clearline reads your organisation's timezone from Xero (and QuickBooks)** (branch `feat/org-timezone-read`, on
  top of the change below; awaiting review, QA and Aashmiin's approval). When you connect Xero, Clearline now asks
  for one more read-only permission, "View your organisation settings", and reads the organisation's timezone. It
  reads it again just before anything posts: if it can't, nothing posts; if it changed since you looked at the plan,
  you are asked to check the dates and approve again. Already connected? Reconnect Xero once to grant the new
  permission; until then plans show "Post by hand". QuickBooks (not offered yet) reads the company's timezone the
  same way.
- **Posting dates use your organisation's own timezone, not UTC** (branch `bug/xero-posting-date-timezone-v2`,
  awaiting review, QA and Aashmiin's approval; rule R2 and ADR 0002 still to be signed). Until now every line Clearline
  prepared for Xero or QuickBooks was dated with the UTC date of the payment, so in Singapore anything received between
  midnight and 07:59 landed on the previous day, and on the 1st of a month in the previous month. Each line is now dated
  with the calendar date of the payment's block time in the organisation's timezone (a 07:30 receipt on 1 November in
  Singapore posts on 1 November; the same moment posts on 31 October for a New York organisation). If Clearline doesn't
  know the organisation's timezone, or the payment's block time, it doesn't guess: the plan says "Post by hand" with
  the reason, and nothing posts. A payment that is already in your books still shows as posted, so it is never offered for posting a second time. The demo books use the demo organisation's stated timezone (Singapore). Note: reading
  the timezone from Xero comes in the next change, so until then Xero and QuickBooks plans show "Post by hand".
- **CHANGELOG started.** From today every merged pull request adds an entry here.
