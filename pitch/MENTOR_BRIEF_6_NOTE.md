# 6-slide mentor brief: note

## Follow-up fixes, 28 Oct 2026 (after review)

- **Slide 2:** title is now "Odd payments are explained, not chased". The unsourced "hours lost" figure is gone from the slide and the notes; the box reads "Without a tool: customers waiting, and the risk of accepting fake money."
- **Slide 4:** a caption under the video says "Film shows steps 1–3; step 4 coming in the next cut". The QR now opens the public website's demo page, https://grand-paletas-14bbf8.netlify.app/demo/ (the video isn't on `main`, so a GitHub link would break when `pitch-deck` is deleted). The QR was decoded from the rendered slide to check it.
- **Slide 6:** the personal Gmail address is replaced by the website (grand-paletas-14bbf8.netlify.app); LinkedIn stays.
- **"~$400B"** everywhere (slide 1 figure and footer).

## Update, 28 Oct 2026: new positioning ("in your books")

**What changed (slides 1, 3 and 4, plus question 1 on slide 6 and slide 2's source line; slide 5 is unchanged):**

- **Slide 1, problem:** the letterbox analogy is replaced by two sourced numbers.
  - Real stablecoin payments are growing, an estimated ~60% between businesses (Bessemer's estimate).
  - The pain is that payments arrive wrong, and someone has to match them and get them into the books by hand (marked † as my belief).
- **Slide 3, gap:** "nobody explains the mess" is gone, because it was too strong.
  - It now says plainly that the big platforms (Stripe, Circle, Coinbase) are becoming one-stop shops.
  - It also says that Bitwave and Request Finance already sync to Xero, QuickBooks and NetSuite.
  - What still looks manual: a small business paid straight into its own wallet, the payments that arrive wrong, and posting them correctly. This is marked as a hypothesis I'm testing in calls.
- **Slide 4, solution:** the headline is now "Stablecoin payments, matched, explained and in your books."
  - It has the four steps: Ask, Match, Explain, In your books.
  - Step 4 reads "Posted to your books on approval (Xero first)".
  - It shows Clearline's own "In your books" panel, captioned "demo mode, fictional company". The screenshot is Clearline's own panel, not Xero's interface.
  - A status box reads: Xero connection built and checked in automated tests; posting rules tested in demo mode with a fictional company; first live test with Xero's demo company is next. QuickBooks next, NetSuite on the roadmap. 0 customers, working demo.
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
| Status: Xero connection built and checked in automated tests; posting rules tested in demo mode with a fictional company; first live test with Xero's demo company is next. QuickBooks next, NetSuite on the roadmap. 0 customers, working demo. | the agreed status wording for the new story (not re-tested for this update) | as stated |

Dropped from the old slides, because they are not in the new source list:
- the McKinsey/Artemis US$226B figure;
- the Stripe docs and HitPay citations;
- the wallet-warning examples.

**Check before sending:**
- **Where the QR leads:** fixed; it now opens the public website's demo page (see the follow-up fixes above). That Netlify site must stay up, and should be redeployed with the latest build.
- **Your repo is public:** anyone with the link can see the video and the decks in it, not only mentors.
- **Slide 6 wording:** question 1 now asks about "the wrong-payments gap", to match slide 3. That is the only change on slide 6.
- **The four wrong-payment cases (slides 1 and 2):** they come from the product's demo cases. Only counterfeit USDT and wrong network are also seen in real transactions (demo/REPORT.md). How often each happens is not measured. Slide 2's footer and notes now say the same: fake USDT (13) and wrong network (6) are from real transactions (demo/REPORT.md); short payments and missing references are demo cases.

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
