# Script: crypto accounting advisory firm (intro offered by Vishal)

Use with `SCRIPT_CORE.md`. Replaces the core's story block. Who: a partner/manager at an accounting,
audit or advisory firm with digital-asset clients. DRAFT, 2026-11-02.
**Partner/channel, not a buyer**; client stories are **second-hand** (source = advisor). Aashmiin is an
accountancy student: it's fine to say so, but don't test her knowledge on the call; listen.
Main hypotheses: **H2** (FX + lot accounting, "stablecoins aren't cash in the books"), **H4**, and H1 from
the books side. Any accounting-standard detail they mention is **their view**; research-intern checks the
primary standard before we repeat it anywhere.

| # | Question | Tests | Supports if they say… | Refutes if they say… |
|---|---|---|---|---|
| 1 | "Tell me about the last client engagement where stablecoins were a big part of the work. What did the client bring you, and what did you have to rebuild?" | H2/H4 | Raw explorer exports, spreadsheets rebuilt by the firm, hours billed | Clean data from a tool |
| 2 | "How did you classify and measure that client's USDC/USDT at period end? What did that take?" | H2 | Not cash; intangible/financial asset debate; manual revaluation | Treated as cash equivalent, trivial |
| 3 | "For clients with non-USD books, walk me through the last FX and gain/loss calculation on stablecoin holdings. What cost basis did you use?" | H2 | Lot tracking by hand, FIFO/average, auditor challenges | Immaterial; automated |
| 4 | "Last time a client's stablecoin payments didn't match invoices, what did you have to do?" | H4 | Matching by hand, client asked for hashes, adjustments | Client's system already matched |
| 5 | "What evidence did the auditor ask for on stablecoin receipts in your last engagement?" | H2/H4 | Hashes, wallet ownership proof, confirmations; time to gather | Bank-style statement accepted |
| 6 | "Have you seen a client release goods on a payment that later turned out wrong, and then had to fix the books?" | H1 | Real cases, write-offs | Never |
| 7 | "Roughly what share of the fee on those engagements went to cleaning up stablecoin data?" | H2/H4 | Their number or range; clients complaining about the fee | Negligible |
| 8 | "Which tools do you or your clients use today for crypto subledgers or reconciliation? What's missing for small clients?" | H2/H4 | Names + gaps (second-hand; label for research-intern) | Fully covered |
| 9 | "Which kind of client feels this most: by size, country, industry, books currency?" | segment | A clear segment (feeds gtm-strategist) | "Everyone equally" |
| 10 | "Would you be willing to introduce me to one or two of those clients, or a colleague who handles more of this?" | advance | Intro offered | Declines |

Never: offer a referral arrangement, ask them to recommend Clearline, or ask for client data. If they want
to see the product: core rules (end of call; "in the demo"; Xero in testing, posts only once approved).
