# Task 2: Three personalised first emails (D0), queued Mon 2 Nov 2026 for Tue 3 Nov 2026

All three bodies were rendered by `gtm.lean.first_email(greeting, first_line, question, close, LINKEDIN_URL)`
from the `origin/gtm-os` worktree (0e5f89c). Only the greeting, first line, question and close are mine.
The rest is the code template word for word: research sentence, "I'm not asking you to buy anything..."
line, signature with her LinkedIn URL as the only link, and the opt-out. These are the exact bodies in
`work/queue.csv`, which the guard ALLOWed for 2026-11-03 (task 1). Each is plain text with no attachments,
images or tracking, sent from aashmiin@gmail.com. Week 1: these go in the evening summary in full and send
from 9:00 recipient time unless she replies HOLD.

---

## 1. L101: Mei Tan, Finance Manager, Tidewater Freight Pte Ltd (Singapore)

WOULD SEND (queued; hourly sender after the guard with `--now`, from 09:00 SGT Tue 3 Nov)

**To:** mei.tan@tidewater-freight.example
**Subject:** Quick question about stablecoin payments

```
Hi Mei,

Saw your payments page now lists USDC for overseas freight invoices, updated September 2026.

I'm Aashmiin, a student at SMU in Singapore, building a small tool in this area (Clearline) and researching what happens when stablecoin payments arrive wrong: short after fees, on the wrong network, a fake token, or with no invoice reference.

When a USDC payment for a freight invoice arrives short or without an invoice reference, who sorts it out, and how long does it take?

I'm not asking you to buy anything. 15 minutes of your experience would help me a lot. Would you be open to a short call next week?

Best regards,
Aashmiin Kaur
SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391

If you'd rather not hear from me, just reply "no" and I won't email again.
```

- **First line source:** https://tidewater-freight.example/payments, page dated **2026-09-15** (about 7
  weeks old, inside 12 months). Re-checked this run against the leads.csv record (fixture rule).
  email_label VERIFIED-PUBLIC.
- **First line word count:** 14 (limit 18).
- **Why this question:** the page says USDC is for *overseas freight invoices*. That means cross-border
  invoices, where sender-side fees cause short payments and payers often leave out the invoice reference.
  So I asked about her own workflow: who handles those exceptions, and how long it takes. A Finance Manager
  can answer that in two lines. It uses finance words (invoice, short, reference), makes no claim about
  her pain, and doesn't pitch.

---

## 2. L102: James Okafor, Head of Finance, Brightmoor Studios Ltd (United Kingdom)

WOULD SEND (queued; earliest 09:00 UK = 17:00 SGT Tue 3 Nov, guard with `--now`)

**To:** james.okafor@brightmoor.example
**Subject:** Quick question about stablecoin payments

```
Hi James,

Your September finance analyst job post mentions reconciling USDT payments from overseas clients.

I'm Aashmiin, a student at SMU in Singapore, building a small tool in this area (Clearline) and researching what happens when stablecoin payments arrive wrong: short after fees, on the wrong network, a fake token, or with no invoice reference.

How are USDT receipts from overseas clients matched to invoices today: by hand from the explorer, or with a tool?

I'm not asking you to buy anything. 15 minutes of your experience would help me a lot. Could we speak briefly one day next week?

Best regards,
Aashmiin Kaur
SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391

If you'd rather not hear from me, just reply "no" and I won't email again.
```

- **First line source:** https://brightmoor.example/careers/finance-analyst, page dated **2026-09-22**.
  Re-checked this run (fixture rule). email_label VERIFIED-PUBLIC. UK compliance: Brightmoor Studios **Ltd**
  is a corporate subscriber under PECR, so it can be emailed with sender identification and the opt-out.
- **First line word count:** 13 (limit 18).
- **Why this question:** a company that hires an analyst to reconcile USDT receipts is telling us
  reconciliation is real work for them. So the question asks how matching is done today (by hand from the
  explorer, or with a tool). It comes from the "hiring for reconciliation" row of the question bank. It is
  about how they work, not about the hire. I said "receipts from overseas clients" to echo their own words.
- Check before it sends: if the job post has been taken down by the time the hourly run fires, the line
  ("mentions") is still true of a September post. If the page is gone entirely, I would pull the row and tell
  her rather than send a line I can't re-open.

---

## 3. L110: Omar Haddad, Finance Director, Dune Logistics FZ-LLC (United Arab Emirates)

WOULD SEND (queued; from 09:00 UAE = 13:00 SGT Tue 3 Nov, guard with `--now`)

**To:** omar.haddad@dunelogistics.example
**Subject:** Quick question about stablecoin payments

```
Hi Omar,

Your invoicing page says Dune accepts USDT on Tron and Ethereum for freight bookings.

I'm Aashmiin, a student at SMU in Singapore, building a small tool in this area (Clearline) and researching what happens when stablecoin payments arrive wrong: short after fees, on the wrong network, a fake token, or with no invoice reference.

With USDT arriving on both Tron and Ethereum, how often does a customer pay on the wrong network, and what happens next?

I'm not asking you to buy anything. 15 minutes of your experience would help me a lot. Is there a day next week that suits?

Best regards,
Aashmiin Kaur
SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391

If you'd rather not hear from me, just reply "no" and I won't email again.
```

- **First line source:** https://dunelogistics.example/invoicing, page dated **2026-10-11**. Re-checked
  this run (fixture rule). email_label VERIFIED-PUBLIC.
- **First line word count:** 14 (limit 18).
- **Why this question:** accepting the same token on two networks is exactly when customers send it on the
  wrong one, so I used the "multiple networks" question from the bank. I deliberately did **not** mention
  the gateway that converts to AED (from research notes, not from the page we quote). We haven't verified
  it, and saying it would claim knowledge about their setup. The email doesn't hint that Clearline handles
  Tron. It doesn't today (pilot scope is Ethereum), and a cold email is a question, not a pitch.
- Tier 2 (67): the code marked it down for "via gateway... large company, low reply odds". It is still a
  BUYER with its own sourced page, so it qualifies under LEAN MODE (Tier 1/2 buyers).

## Checks done
| | L101 | L102 | L110 |
|---|---|---|---|
| First line ≤ 18 words, true, within 12 months, URL logged | 14, 2026-09-15 | 13, 2026-09-22 | 14, 2026-10-11 |
| One question, no accounting question in D0 | yes | yes | yes |
| "15 minutes" not repeated in close | yes | yes | yes |
| Only link = LinkedIn URL, opt-out present | yes | yes | yes |
| Body word count (template keeps it short) | 132 | 124 | 127 |
| Different close per email (not repetitive) | "open to a short call" | "speak briefly" | "a day that suits" |
| Guard verdict (task 1, --today 2026-11-03) | ALLOW | ALLOW | ALLOW |

## Notes
- The template line is "I'm not asking you to buy anything" (code + tests). The RULES.md prose says "I'm not
  selling anything". The digest says to use the code, so I did.
- Bodies are ~125-130 words, a little above the 50-125 benchmark. Most of that is the fixed research
  sentence and signature. I kept my three slots short instead of changing the template.
- Nothing claims a customer, a feature, a date or automatic Xero posting.
