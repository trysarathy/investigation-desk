# Task 3: Regulation question, Singapore SaaS billing EU customers in USDT

For sales-closer-assistant, for Aashmiin's call. This is not legal or tax advice: professional review is needed for any "can they / must they" question.

## (a) Three sentences she can say on a call
1. "MiCA's stablecoin rules have applied since 30 June 2024, and since 1 July 2026 crypto platforms serving EU clients need a MiCA licence." [VERIFIED by the claims audit, 2026-10-29: R14 EBA page, R24 FSMA Belgium page. Not re-opened by me this run.]
2. "Are your EU customers still paying you in USDT, or have some moved to USDC or EURC since MiCA? That's where we see wrong-token payments against invoices." This is a question, so it makes no claim.
3. "Whether receiving USDT changes anything for your own company is a question for your counsel. Clearline doesn't give legal advice: it's read-only and just verifies and matches what arrives."

Once R18/R20 are opened and promoted, sentence 2 can become a statement: "USDT isn't authorised under MiCA, so EU-licensed platforms stopped offering it in early 2025, and many EU payers now use USDC or EURC." Until then it stays [ASSUMPTION: search] and is not for calls.

## (b) Background (≤250 words)
- **Receiving.** MiCA regulates issuers (EMT/ART titles since 30 Jun 2024 [VERIFIED, claims audit, R14]) and CASPs. A non-EU company receiving USDT for its own invoices is not providing a crypto-asset service by doing so [ASSUMPTION: confirm with EU counsel]. Holding or exchanging crypto *for others* could change that.
- **USDT status.** USDT is not MiCA-authorised [ASSUMPTION: search, R18, R19]. ESMA/Commission 17 Jan 2025: CASPs to restrict non-compliant stablecoins no later than end-Q1 2025; sell-only until then; custody and transfer may continue with a warning [ASSUMPTION: search, R20, R21]. Binance ended EEA spot USDT on 31 Mar 2025 [ASSUMPTION: search, R22]. Holding USDT in self-custody is not illegal for EU residents [ASSUMPTION: search, R19].
- **CASP transition.** It ended 1 Jul 2026 EU-wide with no extension [VERIFIED, claims audit, R24]. The ESMA statement itself (17 Apr 2026) is [ASSUMPTION: search, R25]. Search today also reports a further ESMA reminder on 23 Jun 2026 [ASSUMPTION: search, new, unconfirmed].
- **Practical effect.** EU payers skew to USDC/EURC; expect "wrong token" exceptions on USDT invoices [ASSUMPTION].
- **Singapore side.** Receiving DPT for your own services is not itself a DPT service [ASSUMPTION]. On GST, the pack says using DPT as payment is disregarded [ASSUMPTION: search, R41]. However, today's search results quote IRAS saying fiat-pegged tokens do not qualify as DPT, so USDT/USDC may fall outside that treatment [ASSUMPTION: search, conflicting]. This needs a tax adviser.

## (c) What she must not say
- "USDT is illegal in the EU" or "EU customers can't pay in USDT."
- "You don't need a licence" or "receiving USDT is fine under MiCA." Both are advice; say "worth checking with your counsel".
- "Clearline makes you MiCA-compliant" (or GENIUS/MAS-compliant).
- Anything about GST treatment of USDT/USDC as fact.
- Any [ASSUMPTION: search] fact above presented as checked.

## Live variant: what I opened
| Page | Result | Can I promote? |
|---|---|---|
| ESMA 17 Jan 2025 statement (R20) | WebFetch: host not resolvable / not allowed; curl: proxy 403 | **No.** Stays [ASSUMPTION: search]. Search results agree with the pack (end-Q1 2025, sell-only), but a snippet is not a source. |
| ESMA 17 Apr 2026 statement PDF (R25) | curl: proxy 403 | **No.** Search results agree with the pack (1 Jul 2026, wind-down plans). |
| IRAS GST page (R41) | curl: proxy 403 | **No.** Search surfaced a possible conflict on stablecoins (above). I flag it rather than promote. |

Promoted to [VERIFIED] this run: **none**. The two [VERIFIED] items above come from the claims audit (opened 2026-10-29 by that session), not from me.

## WOULD WRITE: Log rows
- `2026-10-29 SGT | research-intern | fact pack for sales-closer-assistant: SG SaaS / EU USDT / MiCA | — | 3 call lines + background; ESMA (R20, R25) and IRAS (R41) hosts blocked, nothing promoted`
- `2026-10-29 SGT | research-intern | RISK: regulation.md §4 GST line may be wrong for stablecoins | R41 | search results quote IRAS: fiat-pegged tokens do not qualify as DPT; do not use the "disregarded for GST" line for USDT/USDC until IRAS page opened + tax adviser review; owner research-intern (re-open), finance-admin (CA question)`
- WOULD WRITE Risks tab: "SG GST treatment of USDC/USDT payments uncertain (DPT definition may exclude fiat-pegged tokens) | source R41 + search 2026-10-29 | owner finance-admin / Aashmiin's tax adviser | status open".

## Notes
- Page fetches to esma.europa.eu, iras.gov.sg, amf-france.org, centralbank.ie and regulationtomorrow.com all failed (proxy 403 / not resolvable). The sources found by WebSearch were: esma.europa.eu (R20, R25 PDF), elvingerhoss.lu, amf-france.org, centralbank.ie, iras.gov.sg/…/digital-payment-tokens, crowe.com/sg, grantthornton.sg, harneys.com, consob.it. All were search results only.
- In the knowledge pack, the regulation.md GST line needs a correction. The fix goes on a branch, which I didn't make (no pushes in this test).
