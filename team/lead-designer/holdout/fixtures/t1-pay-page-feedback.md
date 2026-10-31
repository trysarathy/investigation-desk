# Fixture T1: feedback on the sender payment page

From: crypto-finance-user (SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND), Fri 30 Oct 2026, 16:40 SGT

> Tested `/pay/<publicId>` (the page a customer opens to pay an invoice) on a phone at 390 px, in
> dark mode and in light mode. The amount and address are great. But the grey line under the address
> ("Copy it from here, never from your wallet's history: scammers plant look-alike addresses there")
> is the most important sentence on the page and I nearly missed it. The progress labels under the
> bars (Waiting / Seen / Confirming / Received / Paid) and the small print at the bottom were hard
> to read too. Also: on the track, I couldn't tell which step was done and which was "now" without
> squinting at the colours.

Code: `src/app/pay/[publicId]/page.tsx`, styles in `src/app/globals.css` (`.pay*`, `.track`, `.faint`,
tokens on `:root` and the two dark-mode blocks).
