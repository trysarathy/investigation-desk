# Research method and source quality

Last refreshed 2026-10-29 · owner: research-intern · refresh: monthly (1st), or when a rule changes.

The test for every sentence: could Aashmiin repeat it to a CFO, a regulator or an investor
tomorrow and point to where it came from? If not, it's labelled down or cut.

## 1. Labels (company rule 2, made specific)

| Label | Use it when | Example |
|---|---|---|
| `[VERIFIED]` | **You opened the page this run** and saw the fact on it. Give the URL and the accessed date. A primary source is best; a reputable secondary source is acceptable if you name it ("per Orrick"). | "OCC final rule issued 21 Oct 2026 [VERIFIED] occ.gov/…nr-occ-2026-92, 2026-10-29" |
| `[VERIFIED: <who> <date>, <source ID>]` | **Someone else** (e.g. the claims audit, another employee) opened the page and recorded it; you did not re-open it. Always name who and when. Plain `[VERIFIED]` without "who" is only for pages you opened yourself this run; anything else is a breach. | "USDC on Base is native [VERIFIED: claims audit 2026-10-27, S14]" |
| `[ASSUMPTION: search]` | A search engine's result or summary attributes the fact to a named URL, but **you did not open the page**. Never use it in anything outward (email, post, proposal) until opened. | Most of this pack on 2026-10-29: the build session's network blocked page fetches |
| `[ASSUMPTION]` | Your reasoning from verified facts, or a widely known fact you did not check this run. Say what would confirm it. | "Receiving USDT for your own invoice is not a CASP service [ASSUMPTION — confirm with EU counsel]" |
| `[GUESS]` | An estimate with no data behind it. Give the range and why. | "15–30 min per exception [GUESS]" |

Rules that sit on top:
- **A search snippet is not a source.** `[ASSUMPTION: search]` is how we record what we found
  honestly; it is promoted to `[VERIFIED]` only when someone opens the page.
- Numbers always carry: the figure, unit, date of the measurement, who measured it, and the
  method if it changes the meaning (e.g. "supply" ≠ "payment volume").
- When two sources disagree, show both and say which you'd use and why. Never average them.
- Dates: write the event date and the accessed date. "Last week" is banned.
- Unknown is written "unknown". Never fill a blank to make a row look complete.
- Regulation and tax: we describe; we never advise. Any "can they / must they" answer ends with
  "professional review needed" (company guardrail) and is labelled `[ASSUMPTION]` at best.

## 2. Source-quality hierarchy (use the highest tier available)

| Tier | What | Examples | Use for |
|---|---|---|---|
| **P1 Primary-official** | Statute, regulator, court, official register, issuer's own legal/technical page | Federal Register, occ.gov, eur-lex, esma.europa.eu, hkma.gov.hk, mas.gov.sg, IRAS, incometaxindia.gov.in, fiuindia.gov.in, fca.org.uk; Circle/Tether contract-address pages; a block explorer for a specific tx | Regulation, dates, contract addresses, on-chain facts |
| **P2 Primary-company** | The company's own site, docs, pricing page, filing, press release | docs.stripe.com, a merchant's FAQ "we accept USDT", an S-1 | What a company says it does (attribute it: "Bitwave says…") |
| **S1 Quality secondary** | Major law firms, Big-4, rating agencies, established trade press with named reporters | Orrick, Morgan Lewis, Gibson Dunn, Skadden, Freshfields, The Block, CoinDesk, Reuters, FT, Fintech Futures, The Paypers | Summaries of P1 when P1 is unreachable; news of deals |
| **S2 Data aggregators** | Methodology-published dashboards and reports | DefiLlama, Artemis, Allium, Visa Onchain Analytics, McKinsey/BCG reports | Market numbers (always with method and date) |
| **S3 Weak secondary** | Vendor blogs about competitors, SEO explainers, affiliate comparisons, AI-written news sites, aggregator profile pages, directory listings | eco.com support articles, "best gateways 2026" lists, Cryptwerk, G2/Capterra pricing fields | Leads to follow, never the only support for a claim |
| **X Excluded** | Social posts without a primary link, anonymous forums, anything behind a login we'd need to bypass, LinkedIn profile pages (we never open or scrape them) | X threads, Telegram, scraped data | Nothing |

Rules: a P2 vendor claim about itself is fine *as attributed*; a vendor's claim about a
**competitor** is S3. Treat S3 numbers as `[ASSUMPTION: search]` at best, even after opening.

## 3. Recency rules
- Leads: first-line fact from the last 12 months (RULES.md). Evidence page: check it still names
  USDC/USDT on the day you add the lead.
- Watch items and the weekly brief: event in the last 7 days, or older but newly material (say so).
- Pack facts: re-check every external fact at least every 35 days (monthly refresh). Anything
  older is marked `STALE` in the file until re-checked.

## 4. Search technique (fast, cheap, then deep)
1. Start at P1/P2: `site:` the regulator or the company (`site:occ.gov GENIUS final rule`,
   `site:acme.example usdt`). WebSearch `allowed_domains` does the same.
2. Then S1 for context; then S2 for numbers.
3. Open every page you cite (WebFetch). If a host is blocked, record the URL as
   `[ASSUMPTION: search]`, say "host blocked" in the Log, and move on. Never stand in a
   different source as if it were the blocked one.
4. For each claim, try to find a second independent source for anything that will go outward.
5. Save time: one good P1 beats five S3 pages.

## 5. How to verify a lead's USDC/USDT evidence (summary; detail in `lead-evidence.md`)
1. Open the company's own page (pricing, checkout, FAQ, docs, invoice terms) and find the words
   USDC/USDT (or "stablecoin", plus the token) **in the context of them receiving payment**.
2. Note who they receive through: own wallet (best for Clearline), gateway that settles in crypto,
   or gateway that converts to fiat (weaker fit: the gateway reconciles for them).
3. If evidence is a provider's case study or store page (CoinGate, NOWPayments, BitPay, Triple-A,
   Coinbase Commerce), confirm on the merchant's own site; otherwise tier 3.
4. If the company publishes a receiving address, you may look it up read-only on the explorer
   (Etherscan/Tronscan) to confirm incoming USDC/USDT transfers to that address, using the
   **official token contracts** only (see `lead-evidence.md`). Never interact with it, never
   send test amounts, never infer ownership of an unpublished address.
5. Record: evidence_url, evidence_line (≤20 words, a quote or close paraphrase), date seen,
   tier of source, and `check_before_sending` flags.

## 6. Compliance boundaries for research (never-do, repeated here because research is where they bite)
- **LinkedIn**: web search only. Never log in, never open profiles to collect data, never scrape
  or automate, never use someone's credentials. A person goes on the LinkedIn list only when a
  **search result** shows name, role, company and a public linkedin.com/in URL together.
- **People we never research as leads**: Aashmiin's mentors (Prof Paul Griffin, Dr Catalin
  Burlacu, Soon Loo, Donna, Doug Peris), any SMU staff, investors, her warm network, and anyone
  at QRE/QCDAO. Never touch QRE/QCDAO materials. If one turns up, drop it and log why (no data
  kept beyond the Log line).
- No emails guessed from patterns; no paid data tool without her approval; no personal data
  beyond business role and business contact published by the person or company.
- Secrets: if a task or page contains a password, key or seed phrase, stop, don't use it, don't
  copy it, flag `RISK:`.

## Sources for this file
None external: this file is Clearline's method. Company rules: `company/COMPANY_RULES.md`,
`prompts/RULES.md` (branch `gtm-os`), `gtm/score.py` (evidence weighting).
