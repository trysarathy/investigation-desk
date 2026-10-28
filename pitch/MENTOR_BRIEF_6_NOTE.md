# 6-slide mentor brief: note

## Update, 28 Oct 2026: new positioning ("in your books")

**What changed (slides 1, 3 and 4 only; slides 2, 5 and 6 are unchanged):**

- **Slide 1, problem:** the letterbox analogy is replaced by two sourced numbers.
  - Real stablecoin payments are growing, and most are between businesses.
  - The pain is that payments arrive wrong, and someone has to match them and get them into the books by hand (marked † as my belief).
- **Slide 3, gap:** "nobody explains the mess" is gone, because it was too strong.
  - It now says plainly that the big platforms (Stripe, Circle, Coinbase) are becoming one-stop shops.
  - It also says that Bitwave and Request Finance already sync to Xero, QuickBooks and NetSuite.
  - What still looks manual: a small business paid straight into its own wallet, the payments that arrive wrong, and posting them correctly. This is marked as a hypothesis I'm testing in calls.
- **Slide 4, solution:** the headline is now "Stablecoin payments, matched, explained and in your books."
  - It has the four steps: Ask, Match, Explain, In your books.
  - It shows Clearline's own "In your books" panel, captioned "demo mode, fictional company". The screenshot is Clearline's own panel, not Xero's interface.
  - A status box reads: Xero built and tested in demo mode, QuickBooks next, 0 customers.
  - The 60-second video and QR are kept. The video predates the books step, so it shows steps 1–3 only (this is said in the speaker notes).
- Every slide with a number has a source line, and the speaker notes carry the full quotes and links.

**Sources (each checked against the page text on 28 Oct 2026):**

| Claim | Source | Label |
|---|---|---|
| ~$400B real-world stablecoin payments in 2025, ~60% B2B | Bessemer Venture Partners, "Stablecoins: from DeFi primitive to global financial infrastructure", 22 Apr 2026, bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure | [VERIFIED]; the 60% is Bessemer's estimate (◦) |
| Only ~$350–550B of $28–62T in 2025 stablecoin transfers were real payments | Reap, "Stablecoin Statistics & Data 2026", 14 Aug 2026, citing BIS, BCG × Allium, McKinsey, reap.global/blog/stablecoin-statistics-2026 | [VERIFIED] |
| Stripe, Circle and Coinbase becoming one-stop shops | Bessemer, same article | [VERIFIED] |
| Bitwave syncs stablecoin payments to ERPs (NetSuite, Xero, QuickBooks, Sage) | bitwave.io/request-a-demo-stablecoin-b2b-payments | [VERIFIED] |
| Request Finance syncs to QuickBooks Online, Xero, NetSuite | help.request.finance/en/articles/13038304-accounting-integrations-overview | [VERIFIED] |
| The wedge (small businesses paid directly; wrong payments and posting them) | none yet: to test in customer calls | [ASSUMPTION] † |
| Status: Xero built and tested in demo mode, QuickBooks next, 0 customers | the agreed status wording for the new story (not re-tested for this update) | as stated |

Dropped from the old slides, because they are not in the new source list:
- the McKinsey/Artemis US$226B figure;
- the Stripe docs and HitPay citations;
- the wallet-warning examples.

**Check before sending:**
- **Where the QR leads:** the QR on slide 4 opens the 60-second video on GitHub, on the `pitch-deck` branch. That link breaks once the branch is merged and deleted.
- **Your repo is public:** anyone with the link can see the video and the decks in it, not only mentors.
- **Slide 6 wording:** question 1 still asks about "the direct-payment gap", which still fits the new gap slide.

**Rebuild:**

```bash
cd pitch
python3 src/build_brief6.py Clearline_Mentor_Brief_6.pptx demo_live_60s.mp4
soffice --headless --convert-to pdf Clearline_Mentor_Brief_6.pptx
pdftoppm -png -r 110 Clearline_Mentor_Brief_6.pdf slides_brief6/slide   # then a 2-column contact sheet of slides_brief6/
```

## Original version (26 Oct 2026)

1. **What changed:** six plain-English slides, in the order problem → why it hurts → the gap → what I built → how good it is → three questions.
   - Every number keeps its source (◦ = estimate, † = my belief), with full sources in the speaker notes.
   - No pricing or market-size claims.
2. **Cold read:** each of the six questions is answered by one slide.
   - No hype words.
   - Body text is 18pt or larger, apart from the source lines.
