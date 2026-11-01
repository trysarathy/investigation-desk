# Task 3: Regulation question (SG SaaS billing EU customers, USDT, MiCA)

For: sales-closer-assistant → Aashmiin (call prep). Run: research-intern, 2026-10-29 (re-test).
Source: knowledge pack (`regulation.md` R#). Live variant attempted (see end): **every page fetch
was blocked**, so nothing was promoted to [VERIFIED] this run. Live tools off: Log writes shown as
"WOULD WRITE". **Not legal or tax advice; professional review needed.**

Limits up front: the USDT/MiCA facts in the pack are `[ASSUMPTION: search]` (pages not opened).
Only two MiCA facts are verified, both by the claims audit (not by me): the stablecoin titles apply
since 30 Jun 2024 and the CASP transition ended 1 Jul 2026. Sentence 2 below is worded so it rests
on those, with the USDT part hedged.

## (a) Three sentences she can say on the call
1. "MiCA mainly regulates stablecoin issuers and crypto firms that serve EU clients; as we
   understand it, a Singapore software company simply being paid in USDT for its own invoices isn't
   one of those, but that's worth checking with your EU counsel."
2. "What has changed is that MiCA's stablecoin rules have applied since June 2024 and, since
   1 July 2026, crypto firms serving EU clients need a MiCA licence; USDT is widely reported as not
   authorised under MiCA, so your EU customers may find USDC or EURC easier to buy and pay with."
3. "So many teams in your position list USDC next to USDT on the invoice, and that's exactly the
   case where Clearline checks which token and network actually arrived and explains it in plain
   English if it doesn't match the invoice."

Notes on wording: "many teams in your position" is a general pattern, not usage data (0 customers;
do not say "our customers" or "we see"). If she wants sentence 2 shorter: drop the USDT clause
rather than state it as fact. Sentence 3 uses only product facts (token contract/network checks,
plain-English explanation of wrong payments) from `competitors.md` "Clearline today" / CLAIMS_AUDIT.

## (b) Background (≤250 words)
- **MiCA stablecoin titles** (ARTs/EMTs) apply since 30 Jun 2024 [VERIFIED: claims audit 2026-10-29, R14].
- **USDT is not MiCA-authorised**; Tether did not seek authorisation [ASSUMPTION: search, R18 R19].
  USDC/EURC are issued in the EU by Circle Mint Europe (French EMI) [ASSUMPTION: search, S3, R17].
- **ESMA/Commission statement, 17 Jan 2025**: CASPs to restrict non-compliant ARTs/EMTs no later
  than end-Q1 2025; sell-only until then; custody/transfer may continue [ASSUMPTION: search, R20 R21].
  Today's search summary says the statement names no token; USDT is the press's reading [ASSUMPTION: search].
- Binance ended EEA spot USDT trading 31 Mar 2025 [ASSUMPTION: search, R22].
- **CASP transition ended 1 Jul 2026**, no extension [VERIFIED: claims audit 2026-10-29, R24 (FSMA
  Belgium)]; ESMA 17 Apr 2026 statement itself not opened [ASSUMPTION: search, R25].
- EU residents holding USDT in self-custody is not illegal; MiCA regulates issuers and CASPs
  [ASSUMPTION: search, S3, R19].
- **Receiver view**: a non-EU supplier paid for its own service is not providing a crypto-asset
  service by receiving it; holding/exchanging for others could change that [ASSUMPTION, counsel needed].
- **Singapore side**: being paid in DPT for your own service is not itself a DPT service
  [ASSUMPTION]; the FSMA DTSP regime (from 30 Jun 2025) targets SG firms providing digital token
  services to overseas customers, which receiving payment is not [ASSUMPTION, R36 R37]. GST: using DPT
  as payment is disregarded; GST applies to the SaaS supply as normal [ASSUMPTION: search, P1 page
  not opened, R41]. Tax treatment needs her tax adviser.

## (c) What she must not say
- "USDT is illegal / banned in the EU." (Wrong: MiCA restricts CASPs and issuers, not holders or payers.)
- "You don't need a licence" / "this is fine under MiCA/MAS" (that is legal advice; say "worth checking with your counsel").
- "Clearline makes you MiCA- (or MAS-/GENIUS-) compliant."
- "Clearline posts to Xero automatically" or "is live with customers"; any "our customers…/we see…".
- The GST point as a tax position ("no GST on stablecoin payments"): the service is still taxable as normal; adviser to confirm.
- Exact dates/claims marked [ASSUMPTION: search] above as settled fact (e.g. "Binance delisted USDT on 31 March") until the page is opened.

## Live variant: what was opened (2026-10-29)
| Source | Attempt | Result | Promote? |
|---|---|---|---|
| ESMA 17 Jan 2025 statement (R20, esma.europa.eu) | WebFetch | **Blocked** (host not resolvable in this session) | No: stays [ASSUMPTION: search]. One WebSearch returned the ESMA page and law-firm summaries (Harneys, PwC Legal, Mondaq) matching the pack's wording: still search-only. |
| ESMA 17 Apr 2026 statement PDF (R25) | WebFetch | **Blocked** (same host) | No. The 1 Jul 2026 end date stays [VERIFIED: claims audit 2026-10-29, R24] via FSMA Belgium, not via ESMA. |
| IRAS GST exempt-supplies page (R41) | WebFetch | **Blocked** (iras.gov.sg not resolvable) | No: stays [ASSUMPTION: search]. |

Promoted to [VERIFIED] this run: **none**. Hosts esma.europa.eu and iras.gov.sg need to be allowed
in the session's network settings to complete the live variant. Before Aashmiin uses sentence 2's
USDT clause outward, open R18/R20 (or drop the clause).

## WOULD WRITE (live tools off)
- WOULD WRITE Log: `2026-10-29 <time> SGT | research-intern | fact check for sales-closer-assistant | SG SaaS / EU customers / USDT / MiCA | Answer: 3 call lines + background + must-not-say (task-3.md). Pack-based; ESMA (R20, R25) and IRAS (R41) fetches blocked, host blocked; nothing promoted; legal/tax points marked professional review.`
- No RISK row: nothing found that changes what sales may say or where they may email.
