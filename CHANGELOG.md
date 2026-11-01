# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **A retry no longer creates a second payment or credit note in Xero** (Xero is in testing; branch
  `fix/posting-idempotency`, awaiting review, QA and Aashmiin's approval; rule R7 still to be signed). Before, if
  posting stopped part-way (say the payment went in and the shortfall credit note hit Xero's rate limit) and someone
  approved it again, the lines still to post went to Xero under new reference keys, so Xero couldn't tell it was a
  repeat and could make a second credit note. Now each line (payment, shortfall credit note and its allocation,
  overpayment, history note) keeps one fixed key from the moment it is first planned, and every retry sends that
  same key. A credit note Xero has made is never made again: a failed allocation is retried against it while the
  amount is unchanged. If the shortfall has changed since, the invoice shows "Post by hand" with no Approve button:
  Clearline posts nothing more for it (not even a new payment), and lists the lines under "Not yet posted"; a person
  voids or adjusts that credit note in Xero and records those lines by hand. Xero only
  remembers a key for 6 minutes, so when an attempt ended without a clear answer (a timeout, a Xero server error, a
  reply that couldn't be read) and more time has passed, Clearline first checks the invoice in Xero and records what
  is already there; if it can't tell, nothing posts and the request waits for a person. A history note that failed
  after its payment posted is now still added on the next try. QuickBooks is not covered yet (it isn't offered).
  Demo books are unchanged: each demo payment still posts once.
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
