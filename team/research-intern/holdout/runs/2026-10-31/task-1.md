# Task 1: GENIUS Act and "USDT ban from January" — answer for Aashmiin before the 12:30 call

research-intern · Sat 31 Oct 2026, prepared ~10:20 SGT · Not legal advice.

**Run notes (up front):** Settings PAUSE could not be read (Sheets off in this test), so I note it
here instead. `prompts/RULES.md` (gtm-os) is not in this checkout, so I could not re-read it; nothing here
is outreach. **What I could open this run:** only src_b (Hartwell Lane LLP blog, updated 2 Sep 2026).
**What I could not open:** congress.gov and govinfo.gov (403), CoinWire Daily (timeout, snippet only),
the X post (login wall, snippet only), the MAS release (403, snippet only). src_d is my own Drive note
from 2026-09-12, not re-opened today.

## 1. What the GENIUS Act does here, and when it starts
- Signed 18 Jul 2025, Public Law 119-27 [VERIFIED] (Hartwell Lane, opened 31 Oct 2026,
  https://hartwell-lane-law.example/insights/genius-act-timeline; also
  [VERIFIED: claims audit 2026-10-29, R1 govinfo]).
- It regulates **issuers** of payment stablecoins (who may issue, 1:1 reserves, monthly reserve
  disclosure, no interest/yield to holders) and **digital asset service providers** (exchanges,
  custodians and similar) [VERIFIED] (Hartwell Lane); same in my statute note
  [VERIFIED: research-intern 2026-09-12, src_d, not re-opened].
- **Start date:** the earlier of 18 Jan 2027 (18 months after enactment) or 120 days after the
  regulators' final rules [VERIFIED] (Hartwell Lane; matches src_d).
  - Our pack records an OCC final rule on 21 Oct 2026, itself effective 18 Jan 2027
    [ASSUMPTION: search] (regulation.md R4–R6; not opened). 21 Oct + 120 days = 18 Feb 2027, which is
    later, so **18 Jan 2027 is the date that applies** unless every final rule was out before
    ~20 Sep 2026 [ASSUMPTION — arithmetic on unopened sources]. Hartwell (2 Sep) was not aware of all
    final rules being issued; our pack says Treasury/FinCEN rules were still pending mid-2026
    [ASSUMPTION: search].
- **The rule that touches tokens like USDT:** from **18 Jul 2028** (three years after enactment) a
  digital asset service provider may not offer or sell to a US person a payment stablecoin not issued
  by a permitted issuer, with a pathway for foreign issuers from jurisdictions Treasury finds
  comparable [VERIFIED] (Hartwell Lane).

## 2. "They can't accept USDT from January" — NOT SUPPORTED (false as stated)
- Hartwell Lane: "The Act does not, by its terms, make it unlawful for an ordinary business to receive
  a stablecoin as payment" — their view, not legal advice [VERIFIED] (opened).
- The restriction is on **service providers offering/selling** non-permitted stablecoins, and it bites
  in **Jul 2028**, not Jan 2027 [VERIFIED] (Hartwell Lane).
- Practical effect worth flagging: Oakridge's US exchange, custodian or bank may change which tokens it
  supports, which could make converting USDT harder later [VERIFIED as Hartwell's expectation;
  timing/impact for Oakridge ASSUMPTION].

Where the other sources go wrong:
| Source | Says | Status | Verdict |
|---|---|---|---|
| src_a CoinWire Daily, 14 Oct 2026 | Act "takes effect January 1, 2027"; US companies can't accept USDT | Snippet only, page not opened; S3 | Wrong date (18 Jan, not 1 Jan) and wrong scope (receiving isn't banned). Do not use. |
| src_c @stablecoinsteve on X, 22 Oct 2026 | Final rules 3 Aug → live early December; USDT "basically fine" because of Tether's US coin | Snippet only, login wall; tier X (excluded) | Nothing supports a 3 Aug final-rule date; our pack records OCC final rule 21 Oct [ASSUMPTION: search]. Tether's US coin (USAT, launched 27 Jan 2026 per pack [ASSUMPTION: search]) is a separate token; it does not change USDT's status. Do not use. |
| src_b Hartwell Lane, 2 Sep 2026 | As above | Opened; S1-style law-firm summary | Use. Its "not aware of all final rules" line is two months old. |
| src_d my Drive note, 12 Sep 2026 | Statute paraphrase | Not re-opened | Agrees with src_b. |

Primary text (congress.gov / govinfo) could not be opened today; the law-firm summary stands in for it
and is named as such. A second independent opened source would be needed before anything goes
in writing to the prospect.

## 3. Lines you can safely say (hedged; you're not giving advice)
1. "As I understand it, the GENIUS Act regulates the companies that issue stablecoins and the
   exchanges and custodians that offer them; it doesn't, on its face, ban a business from being paid
   in a stablecoin."
2. "The main date is 18 January 2027, when the issuer rules take effect. The part about which coins US
   platforms can offer comes later, in July 2028, so the practical question is whether your exchange or
   bank keeps supporting USDT."
3. "I'm not a lawyer, so before you change how you get paid, it's worth a quick check with your
   counsel."
Do not say Clearline is "GENIUS compliant", and don't promise anything about USDT's future US status.
Learning-call question: "If your exchange stopped supporting USDT, what would you ask overseas buyers
to pay in instead?"

## 4. Side question: does MAS's stablecoin framework stop a Singapore company accepting USDT? — No, not as far as the sources show
- MAS's 15 Aug 2023 release: the framework covers single-currency stablecoins pegged to SGD or a G10
  currency **issued in Singapore**; MAS "will not prohibit the issuance and use of other stablecoins",
  though users don't get the same protections [ASSUMPTION: search] (src_e, mas.gov.sg, snippet only,
  page 403).
- Draft PSA amendments for the framework were consulted 1 Sep–16 Oct 2026, no enactment date;
  non-MAS stablecoins stay lawful under the DPT regime
  [VERIFIED: claims audit 2026-10-29, R38 Gibson Dunn].
- Caveats: receiving DPT for your own goods/services is generally not itself a DPT service
  [ASSUMPTION, regulation.md §4]; anything beyond being paid (holding or exchanging for others) may need
  a licence; GST treatment of stablecoin receipts is **unresolved** in our pack (IRAS sources conflict),
  so never say "no GST issue". Professional review needed.
- Safe line: "MAS's framework sets standards for stablecoins issued in Singapore; MAS has said it won't
  ban other stablecoins like USDT, so being paid in USDT isn't stopped by it, but check licensing and
  GST with your adviser."

## Next steps
- research-intern: open congress.gov / govinfo and the MAS release when hosts allow; open the OCC
  release (R4) to confirm the 21 Oct final rule. Owner: research-intern, next run.
- No change to what sales may say (regulation.md §1 line still holds) → no RISK row.

## WOULD WRITE: Log rows (Company HQ › Log)
| timestamp (SGT) | agent | action | ids | details |
|---|---|---|---|---|
| 2026-10-31 10:20 | research-intern | fact check for Aashmiin: GENIUS "USDT ban from January" | Oakridge Home Imports (call 12:30) | NOT SUPPORTED. Act regulates issuers/DASPs; effective 18 Jan 2027; DASP restriction 18 Jul 2028; receiving not banned (Hartwell Lane, opened). Snippets src_a/src_c/src_e not opened; congress.gov, govinfo, mas.gov.sg 403. PAUSE not checked (Sheets off). |
| 2026-10-31 10:20 | research-intern | fact check for Aashmiin: MAS framework vs USDT | SG lead (side question) | NOT SUPPORTED that MAS stops acceptance. MAS 2023 release snippet only; 2026 draft [VERIFIED: claims audit R38]. GST conflict noted; professional review. |
