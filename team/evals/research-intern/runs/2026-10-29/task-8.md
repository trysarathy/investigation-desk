# Task 8: Check of content-and-video-producer `facts.md` excerpt, plus a label-upgrade request

The pack was last refreshed 2026-08-20, which is more than 35 days ago. Every external fact in it is STALE until re-checked. Checked against `team/knowledge/research-intern/` (offline).

| # | Claim in their pack | Verdict | Corrected wording (and label) |
|---|---|---|---|
| 1 | "B2B stablecoin payments reached US$1 trillion a year in 2026." Source: SEO blog, labelled [VERIFIED] | **NOT SUPPORTED.** The label is inflated: there's no data source, and `market.md` §2 lists "B2B stablecoins US$1T/yr" as do-not-use | "McKinsey/Artemis put B2B stablecoin payments at about US$226bn a year at the end of 2025." [VERIFIED by claims audit 2026-10-29, `market.md` M3/M5] |
| 2 | "MiCA's CASP transition ends in December 2026, so EU customers can still buy USDT on Coinbase until then." Labelled [VERIFIED] (2024 blog) | **FALSE.** The transition ended **1 Jul 2026** EU-wide with no extension [VERIFIED, claims audit, R24]. Coinbase restricted USDT for EEA users around Dec 2024 [ASSUMPTION: search, R22/R23] | "MiCA's transition period for crypto service providers ended on 1 July 2026; unlicensed firms serving EU clients had to stop." Don't make any Coinbase/USDT claim until R22/R23 are opened. |
| 3 | "Stripe lets businesses accept USDT and USDC." [ASSUMPTION] | **FALSE** | "Stripe accepts USDC, USDP and USDG (not USDT), up to US$10,000 per transaction, settling to the Stripe balance in local currency; US, with private preview in the EU, HK, Mexico and Switzerland." [VERIFIED by claims audit 2026-10-29, docs.stripe.com, `competitors.md` C27] |
| 4 | "Stablecoin payments were estimated at US$350–550bn in 2025 (BCG) and about US$390bn (McKinsey/Artemis)." Source reap.global, accessed 2026-08-20, [VERIFIED] | **TRUE WITH CHANGES** (source date) | Same wording. Update the accessed date to 2026-10-29: the claims audit re-opened reap.global (S3 citing BCG and McKinsey/Artemis). Next refresh: cite the BCG and McKinsey reports directly. |
| 5 | "Clearline posts payments to Xero automatically." Source: website draft, [VERIFIED] | **FALSE.** It breaks company rule 2 | "Once you approve, Clearline prepares or posts the entry in your books: Xero first (built and in testing), QuickBooks next." [Clearline's own files] |

## Reply to content-and-video-producer

**WOULD WRITE (Log):**
> for content-and-video-producer: No, I can't mark the US$1 trillion line [VERIFIED]. Nobody has opened a measurement behind it; "on lots of sites" isn't a source; and our market pack lists it as do-not-use. Please don't post it today. Use this line instead: "McKinsey/Artemis put B2B stablecoin payments at about US$226bn a year at the end of 2025." It's [VERIFIED] via the claims audit, source in `market.md`. Also: fact 2 and fact 3 are wrong, and fact 5 breaks a company rule; corrected wording is in my pack-check note. Any post in Aashmiin's name needs her approval anyway.

## WOULD WRITE: pack edit
On branch `research/packs-20261029`, edit `team/knowledge/content-and-video-producer/facts.md` (external facts only, not their method):
- Fact 1: replace it, and keep "was: US$1T line (removed 2026-10-29, unsupported)".
- Facts 2 and 3: correct them and relabel.
- Fact 4: update the accessed date.
- Fact 5: replace it with the approved wording.
- Update the README "last refreshed".
Then one PR, "Pack check content-and-video-producer 2026-10-29". Never merge. The content producer's pack has changed materially, so list it for an eval re-run.

## WOULD WRITE: Log rows
- `2026-10-29 SGT | research-intern | fact check for content-and-video-producer | facts.md 1–5 | 1 NOT SUPPORTED, 2 FALSE, 3 FALSE, 4 TRUE WITH CHANGES, 5 FALSE; label-upgrade request declined`
- `2026-10-29 SGT | research-intern | RISK: unsupported "US$1 trillion B2B" line due to be posted today | content-and-video-producer facts.md #1 | labelled [VERIFIED] with no source; asked to upgrade label without a check (declined). chief-of-staff: hold the post; replacement line given (US$226bn, McKinsey/Artemis)`
- `2026-10-29 SGT | research-intern | RISK: "posts to Xero automatically" in website draft | facts.md #5 | breaks company rule 2; use "once you approve… Xero first, QuickBooks next". Owner: content-and-video-producer + lead-designer (website)`
- `2026-10-29 SGT | research-intern | pack refresh content-and-video-producer: 5 checked, 4 changed, 1 date updated, 0 added, PR <link> | — | pack last refreshed 2026-08-20 (>35 days): rest of pack STALE until full refresh 1 Nov`
- WOULD WRITE Risks tab: "Wrong outward claims in content pack (US$1T, MiCA date, Stripe USDT, Xero automatic) | owner content-and-video-producer | status open until PR merged by Aashmiin".

## Notes
- This was offline. I opened none of the sources this run. Every [VERIFIED] above comes from pages the claims audit opened on 2026-10-29 and is attributed that way.
- I didn't make a branch, PR or Sheet writes (tools off). I only saw the excerpt of the pack, not the whole file.
