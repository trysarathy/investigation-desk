# Deliverability: keeping Aashmiin's Gmail out of spam

Accessed 2026-10-29; re-checked against primary sources 2026-10-31. See README for labels. Google's
sender-guideline, FAQ, sending-limit and Postmaster pages and RFC 8058/3463 were opened on 2026-10-31 and are
[VERIFIED]; vendor advice stays [ASSUMPTION: secondary].

## 1. Google's sender requirements (in force from 1 February 2024)
Source: Google, "Email sender guidelines", https://support.google.com/a/answer/81126 [VERIFIED:
https://support.google.com/a/answer/81126, 2026-10-31] and Google's "Email sender guidelines FAQ"
[VERIFIED: https://support.google.com/a/answer/14229414, 2026-10-31]; secondary summaries (not needed now):
https://mailsuite.com/blog/google-sender-guidelines/ , https://help.close.com/docs/requirements-for-bulk-email-senders ,
https://hunter.io/blog/is-gmail-killing-email-outreach/ [ASSUMPTION: secondary].

**All senders to Gmail accounts** (Google: "Starting February 1, 2024, all email senders who send email to
Gmail accounts must meet the requirements in this section"). Google's FAQ adds that the guidelines apply only
to mail sent **to personal Gmail accounts** (@gmail.com/@googlemail.com), not to mail sent to Google
Workspace accounts:
- SPF **or** DKIM authentication for the sending domain.
- Valid forward and reverse DNS (PTR) for sending IPs; TLS for transmission.
- Messages formatted per RFC 5322; don't impersonate Gmail in the From header.
- **Spam rate reported in Postmaster Tools below 0.3%**; Google's own page also says "Keep spam rates
  reported in Postmaster Tools below 0.10% and avoid ever reaching a spam rate of 0.30% or higher".

**Bulk senders** (Google FAQ: "any email sender that sends close to 5,000 messages or more to personal
Gmail accounts within a 24-hour period"; all mail from the same primary domain counts), in addition:
- SPF **and** DKIM **and** DMARC (a policy of at least `p=none`), with the From domain aligned to SPF or
  DKIM.
- **One-click unsubscribe** for marketing and subscribed mail: `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058,
  [VERIFIED: https://datatracker.ietf.org/doc/html/rfc8058, 2026-10-31]; RFC 8058 also says the message
  MUST carry a valid DKIM signature covering both headers) **plus** a clearly visible unsubscribe link in
  the body. Google's FAQ "recommend[s] that you fulfill unsubscribe requests within **48 hours**".

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
Source: Google, "Limits for sending & getting mail", https://support.google.com/mail/answer/22839
[VERIFIED: https://support.google.com/mail/answer/22839, 2026-10-31]; secondary:
https://overloop.com/blog/gmail-sending-limits , https://trulyinbox.com/blog/gmail-sending-limit-per-day
[ASSUMPTION: secondary].
- Google: "You may see this message if you send an email to a total of more than **500 recipients in a single
  email** and or more than **500 emails sent in a day**", and "you should be able to send emails again within
  **1 to 24 hours**". (corrected 2026-10-31: was "about 500 recipients per day (To + Cc + Bcc counted) ...
  block for up to ~24 h"; the page does not describe To/Cc/Bcc counting.) The same page warns that many
  invalid or bounced addresses can also stop sending for about 24 hours. Google Workspace ~2,000/day
  [ASSUMPTION: search-only; Google's Workspace limits page redirects to knowledge.workspace.google.com,
  blocked 2026-10-31].
- That ceiling is **not** a safe cold-email volume. Vendors suggest a "safe zone" far below it (one cites
  ~150/day and rising risk above ~300) [ASSUMPTION: secondary, trulyinbox.com vendor advice; no primary
  source exists; host blocked 2026-10-31]. Our 75/day cap was set by
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
  bounces, complaints and inbox placement; many teams also run a warm-up service [ASSUMPTION: secondary,
  vendor sources, no primary source exists, e.g. https://www.warmy.io/guides/google-yahoo-sender-requirements/].
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
  repeats on the next attempt, treat as hard. [VERIFIED: https://datatracker.ietf.org/doc/html/rfc3463,
  2026-10-31: class 4.X.X = "Persistent Transient Failure", 5.X.X = "Permanent Failure"; the "retry once then
  treat as hard" rule is our practice, ASSUMPTION. `550` itself is an SMTP reply code (RFC 5321), the
  `5.1.1` part is the RFC 3463 enhanced code.]
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
- Postmaster Tools shows data only for a domain you have verified via a DNS TXT/CNAME record, so it does not
  apply to `@gmail.com` [VERIFIED: https://support.google.com/mail/answer/9981691, 2026-10-31; the gmail.com
  conclusion is our inference]. In domain
  mode, add the domain to Postmaster Tools before ramp week 2.
