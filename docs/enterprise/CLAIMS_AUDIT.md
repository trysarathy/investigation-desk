# Claims audit, 29 Oct 2026

Every product claim in the outward-facing material, checked against the code on `accounting-fixes`. Verdicts:

- **yes**: true today, in the code.
- **delivered with our team**: true for a customer only because the founder does a step by hand.
- **roadmap**: not built.
- **FALSE**: not true today, or contradicts another current claim.

Sources checked (read only; none edited):

| Source | Branch / repo | Files |
|---|---|---|
| Website | `origin/website-fixes` (contains `website-books`) | `website/src/**` |
| Website pricing | `origin/website-pricing` | **Branch does not exist** on `trysarathy/investigation-desk` (checked `git branch -r` and `ls-remote`). Pricing copy was checked in `website-fixes` instead. |
| Mentor brief | `origin/brief-fixes` | `pitch/src/build_brief6.py` |
| Film | `origin/demo-video` | `demo/video/src/build_story.py`, `write_script.py`, and the narration in `demo/video/script_final.md` |
| GTM | `trysarathy/closetrace@gtm-fixes` | `gtm/lean.py`, `gtm/offer.py`, `prompts/CALL_SCRIPT.md` (plus `templates/INVOICE.md`, which `offer.py` points to) |

Key code facts used:
1. **No address watching.** Live transfers are found only from a pasted tx hash (`src/lib/requests/provider.ts`: "No polling or address watching yet"; `README.md` "Not built yet").
2. **Auto-mark paid is demo-only.** `src/lib/requests/service.ts` sets `autoMarkPaid: demo`; `README.md`: "on for demo requests and off for live ones".
3. **Payment pages: Ethereum only**, USDC and USDT (`REQUEST_CHAIN`, `README.md` "What changed in the request model").
4. **Xero**: built and unit-tested, never run against a real Xero organisation (`docs/ACCOUNTING_SYNC.md`).
5. **No month-end report** in the payment-request flow (`grep -ri "month-end" src` finds nothing). The older `/inbox` has a reconciled CSV export for imported provider records only.
6. **No deletion feature** for requests, accounting links or Xero tokens; no Xero disconnect.
7. **No sign-in**; data and Xero tokens are plain JSON.

## Results

| # | Claim (quoted or close paraphrase) | Where | True today? | Fix |
|---|---|---|---|---|
| 1 | "Free during the pilot. No cost, no commitment." | Website `Partners.tsx` perks | **FALSE** | Contradicts the paid offer in `gtm/offer.py` (US$300 / 30 days). Replace with "Founding pilot: US$300 for 30 days, then US$200/month; cancel any time." |
| 2 | "How much does it cost? Free for design partners during the pilot. Pricing comes later…" | Website `Sections.tsx` FAQ | **FALSE** | Same as #1. State the pilot price and "enterprise pricing on request". |
| 3 | "Correct payments tick themselves off." / "the invoice is marked paid… Nobody has to chase it" | Website `HowItWorks.tsx` step 2 | **FALSE** outside the demo | Auto-mark is demo-only and live transfers need a pasted hash (facts 1, 2). Change to "In the demo, correct payments tick themselves off. In a pilot, you confirm each one; automatic marking and address watching are next." |
| 4 | "Clearline asks for each payment clearly, matches it to its invoice…" (subline, meta description) | Website `site.ts`, `layout.tsx` | delivered with our team | Matching works once a transfer is recorded; recording it is manual in live mode (fact 1). Add "once the transfer is recorded" or say pilots include us recording transfers. |
| 5 | "every payment matched to its invoice, every problem explained" | Website `Hero.tsx` | delivered with our team | As #4. |
| 6 | "Payment pages: USDC on Ethereum today." | Website FAQ | yes | Understates: USDT on Ethereum also works (fact 3). Optional: "USDC and USDT on Ethereum". |
| 7 | "Checking a transfer someone reports: USDC and USDT on Ethereum, Tron and BNB Chain, incl. spotting Polygon, Base, Arbitrum, Optimism" | Website FAQ | yes | Live mode, investigation pages (`src/lib/chain/sources.ts`). Note these pages are hidden in demo navigation. |
| 8 | Look-alike address warning on the payment page | Website `HowItWorks.tsx`; film 1:06; brief | yes | `src/app/api/pay/[publicId]/check/route.ts`. |
| 9 | "Checks the token is the real one, from the issuer's own contract"; "A counterfeit can't be marked paid by mistake" | Website step 2–3, Trust; film 1:31 "It refuses to count them" | yes | `src/lib/requests/lifecycle.ts` (only timing flags can be overridden). |
| 10 | "Nothing is written to your books until a person approves"; "Every posting is kept in an audit log" | Website step 4, Trust, FAQ; brief slide 4 | yes | `approveAndPost`, audit in `accounting.json`. Audit is app-level append-only, not tamper-evident; fine as worded. |
| 11 | "Xero connection built and checked in automated tests; … first live test with Xero's demo company is next" | Website step 4 caption, FAQ; brief slide 4 | yes | Accurate (fact 4). Keep. |
| 12 | "Import open invoices from Xero (built; first live test next)" | Website FAQ | yes | `POST /api/accounting/import`. |
| 13 | "Never touches money… never asks for wallet keys" / "never holds, moves or has access to funds" | Website Trust, FAQ; brief; offer "No keys and no access to funds" | yes | `src/lib/chain/` read-only. In the offer email, write "no **wallet** keys": a Xero connection does hand Clearline a write credential to the books. |
| 14 | "52 of 52 … real public USDC and USDT transfers… Automatic matching hasn't been tested on real data yet." | Website Trust; brief slide 5 | yes | `demo/REPORT.md` line 41. Keep the caveat. |
| 15 | "Is it AI? … An AI-written explanation is being built, but it hasn't been tested on real data" | Website FAQ | yes | `src/lib/ai/` is built; off in the image. Could say "built, off by default". |
| 16 | "Design-partner pilots use only what you choose to share, only for the pilot, deleted when you ask." | Website Trust; privacy page "Data from pilots" | delivered with our team | Deletion is manual (fact 6). Add "deleted within 10 business days of your request". |
| 17 | "Form submissions are delivered by Formspree, and the website is hosted by Vercel." | Website `privacy/page.tsx` | **unverified, possibly FALSE** | `deploy.sh` deploys to Vercel, but the brief's QR and contact line point to `grand-paletas-14bbf8.netlify.app` (returns 200). If the live site is on Netlify, the privacy notice names the wrong host. Check which URL is live and make both match. |
| 18 | "Working demo · early access"; "Is it live? Not yet… no customers yet" | Website Hero, FAQ | yes | 0 customers. Keep. |
| 19 | "Built for… If your customers send USDC or USDT straight to your company's address (… Web3 firms, exporters)" | Website `BuiltFor` | delivered with our team | Payment pages and live lookups are Ethereum-only for requests; a business paid in USDT on Tron (common) can't use payment pages yet. Add "on Ethereum today". |
| 20 | Step 1: "Each invoice gets its own payment page… The address comes from your own wallet" | Website step 1 | yes | One address per request supplied by the business; no unique address generation (README "Not built yet"). |
| 21 | Brief: "Real businesses… real payments roughly doubled in 2025" | Brief slide 1 notes | **unsourced** | Not in the slide's source list (Bessemer, Reap). Add the source or drop "roughly doubled". |
| 22 | Brief: "② Match: Correct ones tick themselves off" | Brief slide 4 step boxes | **FALSE** outside the demo | Same as #3. "Match: matched to the invoice; correct ones tick off in the demo". |
| 23 | Brief: "On approval, the payment posts to the invoice in Xero with the transaction hash, token, network and USD value." | Brief slide 4 notes | roadmap (live) / yes (code) | Code is built; it has never posted to a real Xero org. The status line beside it says so; add "(built; not yet run on a real Xero organisation)" to this sentence too. |
| 24 | Brief: "7 payment situations work end to end" | Brief slide 5 | yes | Demo cases, `demo/REQUESTS_DEMO.md`. Say "in the demo". |
| 25 | Brief: "0 customers, working demo" | Brief slides 4–5 | yes | Keep. |
| 26 | Film 1:16: "When a payment arrives correctly, Clearline checks it and ticks the invoice off by itself." | Film narration | **FALSE** outside the demo | Facts 1, 2. Add on-screen "Demo: automatic marking" or re-voice: "…and it's ready to mark paid." |
| 27 | Film 1:22: "Correct payments need no one." | Film narration | **FALSE** | In live mode a person must record the transfer and mark it paid. Cut the line, or caption "in the demo". |
| 28 | Film 1:56: "Payments check themselves." | Film outcome | **FALSE** | Someone must give Clearline the transfer (no address watching). "Payments are checked in seconds." |
| 29 | Film 1:51: "Maya closes her laptop on time." / "Detective work, done in seconds." | Film outcome | illustrative | Not measured with any customer. Acceptable as story; don't repeat as a claim in sales material. |
| 30 | Film 1:40: "Once Maya approves, Clearline posts it to the invoice in her books… and a full audit trail" | Film section 8 | yes (demo books) | Shown with a "Demo books · fictional company" label (`build_story.py`). Real Xero posting not yet run (fact 4). |
| 31 | Film end card: "A working demo." | Film | yes | Keep. |
| 32 | Offer: "payment pages for your stablecoin invoices (USDC/USDT)" | `gtm/offer.py` PILOT_INCLUDES; `CALL_SCRIPT.md` close | yes, **Ethereum only** | Add "on Ethereum". A Tron-USDT customer would be sold something that doesn't exist (roadmap). |
| 33 | Offer: "every payment matched and checked, read-only" | `offer.py`; call script "match and check every payment read-only" | delivered with our team | Transfers are recorded by hand from hashes (fact 1). Say "we record and check every payment" and agree the cadence. |
| 34 | Offer: "a month-end report of every payment, exception and tie-out" | `offer.py`; call script; `templates/INVOICE.md` "month-end receivables report" | delivered with our team | No report feature (fact 5). Say "a month-end report we prepare for you". |
| 35 | Offer: "posting to Xero on your approval, if you use Xero" | `offer.py`; call script | roadmap (live) / yes (code) | Never run against a real Xero org. Say "Xero posting on your approval (built; your pilot is its first live run, tested on Xero's Demo Company first)". |
| 36 | Offer: "To start, I only need your receiving address(es) and your open invoices (or a Xero connection), plus 30 minutes" | `offer.py` | yes | Setup is also manual for account codes (`accounts` in `.data/accounting.json`, no screen); 30 minutes is plausible [GUESS]. |
| 37 | Offer: "No keys and no access to funds." | `offer.py` | yes, with wording fix | See #13: say "no wallet keys". |
| 38 | Offer: "one of 10 founding pilots"; "cancel any time" | `offer.py`, call script | yes (business terms) | Business commitments, not product claims. Keep consistent with the website once #1–2 are fixed. |
| 39 | First email: "building a small tool in this area (Clearline) and researching what happens when stablecoin payments arrive wrong" | `gtm/lean.py` `first_email` | yes | Honest. Keep. |
| 40 | Call script opener: "Today I'm only here to learn… not to sell you anything", then the close offers a paid pilot | `prompts/CALL_SCRIPT.md` | yes, with care | The script only offers when the problem scored Strong. Consider "not to sell you anything today unless you ask" so the close doesn't feel like a switch. |
| 41 | Invoice: "Clearline never holds or moves the customer's funds… not an audit, assurance, tax or legal advice" | `templates/INVOICE.md` | yes | Keep. |

## Top FALSE claims to fix first

1. **"Free during the pilot" / "Free for design partners"** (website perks and FAQ): contradicts the US$300 paid pilot now being offered.
2. **"Correct payments tick themselves off" / "ticks the invoice off by itself"** (website step 2, brief step ②, film 1:16): automatic marking is demo-only and there's no address watching.
3. **"Correct payments need no one"** (film 1:22): a person records and marks every live payment.
4. **"Payments check themselves"** (film outcome): nothing is checked until someone supplies the hash.
5. **Hosting named in the privacy notice** (Vercel) vs the live demo link the brief uses (Netlify): unverified, likely wrong in one place.

Also close to false, because they're sold as product but delivered by hand: "every payment matched" (#33), the
"month-end report" (#34), and Xero posting presented as a ready feature in the paid offer (#35); and "USDC/USDT"
payment pages without saying Ethereum only (#32).
