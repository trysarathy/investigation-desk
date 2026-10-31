# Deliverability: keeping Aashmiin's Gmail out of spam

Accessed 2026-10-29. See README for labels. Primary Google pages could not be opened from the build
session (host blocked); every Google fact below is **[ASSUMPTION: search-only]** until research-intern opens
the URL and upgrades it.

## 1. Google's sender requirements (in force from 1 February 2024)
Source: Google, "Email sender guidelines", https://support.google.com/mail/answer/81126 (also
https://support.google.com/a/answer/81126) [ASSUMPTION: search-only]; secondary summaries:
https://mailsuite.com/blog/google-sender-guidelines/ , https://help.close.com/docs/requirements-for-bulk-email-senders ,
https://hunter.io/blog/is-gmail-killing-email-outreach/ [ASSUMPTION: search-only].

**All senders to Gmail accounts** (search results quote: "All email senders who send emails to Gmail
accounts must meet the requirements in this section"):
- SPF **or** DKIM authentication for the sending domain.
- Valid forward and reverse DNS (PTR) for sending IPs; TLS for transmission.
- Messages formatted per RFC 5322; don't impersonate Gmail in the From header.
- **Spam rate reported in Postmaster Tools below 0.3%**; secondary sources say Google recommends staying
  below **0.1%** and never reaching 0.3%.

**Bulk senders** (about **5,000+ messages a day to personal Gmail accounts**), in addition:
- SPF **and** DKIM **and** DMARC (a policy of at least `p=none`), with the From domain aligned to SPF or
  DKIM.
- **One-click unsubscribe** for marketing and subscribed mail: `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058,
  https://datatracker.ietf.org/doc/html/rfc8058 [ASSUMPTION: search-only]) **plus** a clearly visible
  unsubscribe link in the body; honour unsubscribes **within 2 days**.

**What it means for Clearline today** [ASSUMPTION]:
- We send ≤ 75/day from `aashmiin@gmail.com`, far below the 5,000/day bulk threshold, so the bulk-only
  rules do not formally apply. The **spam-rate ceiling (0.3%) applies to everyone**, and at our volume one
  or two "Report spam" clicks a day is already above it. That is why RULES.md treats **any** complaint as an
  auto-throttle and an autonomy downgrade.
- Mail from `@gmail.com` is authenticated by Google itself; we cannot add our own SPF/DKIM/DMARC or a
  `List-Unsubscribe` header through the Gmail connector. Our substitute is the reply-"no" opt-out line in
  every cold email and follow-up, honoured the same day. In **domain mode** the sending tool must add the
  RFC 8058 header (`UNSUBSCRIBE_READY`) and the domain needs SPF/DKIM/DMARC (`DOMAIN_READY`).

## 2. Personal Gmail sending limits
Source: Google, "Gmail sending limits", https://support.google.com/mail/answer/22839 [ASSUMPTION:
search-only]; secondary: https://overloop.com/blog/gmail-sending-limits ,
https://trulyinbox.com/blog/gmail-sending-limit-per-day [ASSUMPTION: search-only].
- A personal Gmail account can send to about **500 recipients per day** (To + Cc + Bcc counted); going over
  gives a temporary block ("You have reached a limit for sending mail") for up to ~24 h. Google Workspace is
  ~2,000/day.
- That ceiling is **not** a safe cold-email volume. Vendors suggest a "safe zone" far below it (one cites
  ~150/day and rising risk above ~300) [ASSUMPTION: search-only, vendor advice]. Our 75/day cap was set by
  Aashmiin knowing the risk (RULES.md LEAN MODE). Never raise it; never use Cc/Bcc to multiply recipients.
- A Gmail block or suspension would also cut off her briefings, replies and calendar invites. Protecting the
  account matters more than any day's volume.

## 3. Practices that protect reputation (what we do)
| Practice | Why | How we do it |
|---|---|---|
| Spread sends | Bursts look like bulk | Hourly sender at :49, ≤ 8 per run, 9:00-17:00 recipient time |
| Plain text, one link, no attachments, no tracking pixels | Links/images/tracking raise spam scoring; tracking is also a privacy issue | `gtm.lean` templates only; LinkedIn URL is the only link |
| Verified, named addresses only | Bounces and role inboxes hurt reputation | `email_label` VERIFIED-PUBLIC/VERIFIED-TOOL; no guessed patterns; no support@ |
| Real personalisation | Replies are the strongest positive signal; generic mail gets "Report spam" | Sourced first line ≤ 18 words, one relevant question |
| Easy opt-out, honoured same day | People who can't opt out press "Report spam" | Opt-out line on every cold email; DNC the same day |
| Follow-ups in thread only, max 2 | Thread replies read as conversation | D4 and D11 only, `replyThreadId` |
| Stop on any reply | Continuing after a reply is the fastest route to complaints | Guard STOP_STATUSES |

## 4. Warm-up (domain mode only; not active)
- Industry practice: a new domain/inbox starts with low daily volume and rises over weeks while watching
  bounces, complaints and inbox placement; many teams also run a warm-up service [ASSUMPTION: search-only,
  vendor sources, e.g. https://www.warmy.io/guides/google-yahoo-sender-requirements/].
- Our rule is fixed in code (`gtm/volume.py`): week 1 = 0 from the system, week 2 = 20/day, week 3 = 35,
  week 4+ = 50, ≤ 20 per inbox, step up only with bounce < 2%, no complaint and `PLACEMENT_OK` (a Gmail +
  Outlook seed test landed in the inbox). Buying the domain/inboxes/tool is spending money: Aashmiin decides
  (AGENTS.md "Outside paid tools").

## 5. Bounces
- **Hard bounce** (permanent, SMTP 5.x.x, e.g. `550 5.1.1 user unknown`): mark the Touches row `bounced`
  the same day, stop the sequence (guard does this), set the lead's `email_label` to `BOUNCED`, and
  re-check the source page: a bounce on a VERIFIED-PUBLIC address means the page is stale or we misread it.
  Log it; if it happened to a VERIFIED address, add a Spot checks row (it may be a factual error).
- **Soft bounce** (temporary, 4.x.x, mailbox full, greylisting): note it; do not resend the same day; if it
  repeats on the next attempt, treat as hard. [ASSUMPTION: standard SMTP practice, RFC 3463 codes]
- **Thresholds** (code): bounce > 3% over ≥ 20 first emails → auto-throttle to 20/day and autonomy level 1;
  week-2 direct sending and every ramp step need bounce < 2%. Our own target: < 2%.
- Small numbers mislead: 2 bounces in 11 sends is 18% but below the 20-send minimum the code uses. Report
  the raw counts and investigate both addresses; do not wait for the threshold.

## 6. Spam complaints
- Any reply saying "spam", "report", "how did you get my email" is treated as a **complaint**: Touches status
  `complaint` (the guard and throttle read it), Do-not-contact the same day (whole domain if they ask for
  "anyone at"), draft-only apology for Aashmiin, `RISK:` Log row, top of the next briefing. The code then
  throttles to 20/day and downgrades autonomy; tell her immediately.
- Never argue, never cite the law at the person, never send anything further automatically.

## 7. Monitoring
- Daily: sends by step, bounces (hard/soft), replies, complaints, unsubscribes, 30-day total vs 1,000.
- Postmaster Tools needs a verified own domain, so it does not apply to `@gmail.com` [ASSUMPTION]. In domain
  mode, add the domain to Postmaster Tools before ramp week 2.
