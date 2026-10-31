# Lead evidence: proving a company receives USDC/USDT

Last refreshed 2026-10-29 · owner: research-intern · refresh: monthly, and after every spot check
that finds an error. Feeds the Leads/Targets `evidence_url`, `evidence_line`, `check_before_sending`
columns and the score in `gtm/score.py` (branch `gtm-os`).

## 1. The standard
A lead qualifies only if **a page you opened today** shows the company **receives** USDC or USDT
(or "stablecoins" with those tokens named) **from its own customers**. The page must be the
company's own, or a provider page confirmed on the company's own site.

## 2. Evidence ladder (strongest first)

| Grade | Evidence | Example wording on the page | Tier effect |
|---|---|---|---|
| **E1** | Company's own billing/pricing/checkout/FAQ/docs page naming the token and network | "Invoices can be paid in USDT (TRC-20) or USDC (ERC-20) to the address on your invoice." | Tier 1/2 possible |
| **E2** | Company's own terms, invoice template, help article, or a public receiving address labelled as theirs | "Payment methods: bank transfer, USDC on Ethereum." | Tier 1/2 possible |
| **E3** | Payment provider's case study/store page naming the merchant, **confirmed on the merchant's own site** (e.g. the checkout shows the provider's USDT option) | Provider case study + merchant checkout | Tier 2 |
| **E4** | Named, dated press release or interview from the company saying it accepts stablecoins | "From March we accept USDC for enterprise plans," CFO quoted | Tier 2 (check it's still true) |
| **W1 (weak)** | Self-submitted directory listing only (Cryptwerk and similar), "crypto accepted" with no token named, third-party blog lists | "Accepts: BTC, ETH, USDT" on a directory | Tier 3, next_action "Find stronger evidence before emailing" |
| **W2 (weak)** | Evidence is *outbound* (they pay suppliers or staff in USDC), or they **sell** a stablecoin product (vendor, not buyer) | "We pay contractors in USDC" | Tier 3 or VENDOR |
| **W3 (weak)** | Evidence older than 12 months with nothing newer | 2023 blog post | Flag "older than 12 months" |

Flags for `check_before_sending` (they lower the score in `gtm/score.py`): `via gateway`,
`not direct`, `converts` (gateway settles in fiat), `large listed company`, `evidence weak`,
`evidence from third-party`, `evidence is outbound`, `no page states`, `older than 12 months`.

## 3. Good vs weak: worked examples (fictional companies)
- **Good (E1):** NodeHarbor's pricing page: "Enterprise plans: pay by card, wire or USDC (Base,
  Ethereum). Send to the address on your invoice and email the tx hash to billing@." → direct to
  own wallet, invoice reference by email: Clearline's core case. Tier 1 if the contact is sendable.
- **Good (E3):** A gateway case study names "Pixelmint Studio"; Pixelmint's own checkout shows
  "Pay with USDT via CoinGate". → Tier 2, flag `via gateway`; ask whether the gateway settles in
  crypto or fiat.
- **Weak (W1):** A directory says "TravelNest accepts USDT"; TravelNest's site lists cards only.
  → Tier 3; do not email until stronger evidence.
- **Weak (W2):** "We pay our global team in USDC via Deel." → outbound; not a receivables lead.
- **Weak:** A podcast where the founder says "we've thought about stablecoins". → not evidence.

## 4. Red flags (stop, or drop the lead)
- The token named is a look-alike or bridged token presented as USDT/USDC with no network named;
  or the site asks payers to send to an address that changes between pages.
- Page is a scam pattern: guaranteed returns, "investment plans", no company registration, no
  physical address, domain registered recently [ASSUMPTION: check via whois only if quick].
- Sanctions or enforcement news about the company (search "<company> sanction OR fraud OR
  enforcement"); gambling or adult services in jurisdictions where that is unlawful.
- The company is a mentor's, SMU's, an investor's, her warm network's, or QRE/QCDAO's → never a lead.
- Evidence only on LinkedIn (we don't open/scrape it) or only on social posts.
- Email only available by guessing a pattern → no sendable email → not a Leads row (may be a Target).

## 5. Optional on-chain confirmation (read-only)
Use only when the company **publishes** its receiving address. Look it up on the explorer
(Etherscan for Ethereum/Base, Tronscan for Tron) and check incoming transfers of the **official**
token contract. Never send a test amount, never connect a wallet, never attribute an address the
company hasn't published.

| Token | Chain | Contract | Status |
|---|---|---|---|
| USDT | Ethereum | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | Recorded in Clearline `src/lib/fixtures/index.ts` (main) as checked against issuer sources; also search-reported [L1]. [ASSUMPTION until re-opened today] |
| USDT | Tron | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | Recorded in the same file as checked; not confirmed by today's search [ASSUMPTION until re-opened today] |
| USDC | Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Recorded as confirmed on Circle's contract page in week 3; search-reported [L2]. [ASSUMPTION until re-opened today] |
| Others (Base, Solana, Polygon, BNB Chain) | — | Take only from Circle's/Tether's own pages | Unset. Circle says bridged USDC (e.g. USDC.e) is not issued by Circle [ASSUMPTION: search] [L3]; BNB Chain "USDT" is Binance-Peg, not Tether-issued (product code note) |

An on-chain hit supports E1/E2 evidence; it never replaces a page the company published.

## 6. Recording a lead (columns that carry evidence)
`evidence_url` (the page), `evidence_line` (≤20 words, true, from that page), `first_line` (≤18
words, last 12 months) + `first_line_source` + `first_line_date`, `email` + `email_label`
(VERIFIED-PUBLIC with the URL where you saw it), `check_before_sending` flags, `buyer_or_vendor`.
Tier 3 if evidence is W-grade, regardless of other fields.

## 7. Spot-check failure modes seen in sales research generally [ASSUMPTION]
First line about the wrong company with a similar name; a page that named USDT last year but not
now; an email seen on a cached page that bounces; role inbox labelled as a named person. The
Sunday spot check (weekly wrap) re-opens 10 sent first lines: plan for it.

## Sources (accessed 2026-10-29)
| ID | URL | Tier | How |
|---|---|---|---|
| L1 | https://theta-meta.github.io/network-marketplace/en/supported-protocols/index.html | S3 (copy of Tether page) | Search |
| L2 | https://developers.circle.com/stablecoins/usdc-contract-addresses | P1 | Search |
| L3 | https://circle.com/multi-chain-usdc/ethereum | P1 | Search |
| L4 | Internal: `src/lib/fixtures/index.ts` on `main` of investigation-desk | Internal | Read 2026-10-29 |
| L5 | Internal: `gtm/score.py`, `prompts/RULES.md` on `gtm-os` | Internal | Read 2026-10-29 |

**First refresh to-do:** open Tether's own supported-protocols page (tether.to) and Circle's
contract page; replace L1.
