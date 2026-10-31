# Unverified external facts: open register

Built 2026-10-31 from the five knowledge packs in `team/knowledge/`. Each row is a claim about the outside
world that is still labelled `[ASSUMPTION: search]`, `[ASSUMPTION: search-only]`, `[ASSUMPTION: search summary]`
or `[ASSUMPTION]` (an unchecked fact, not our own reasoning). Rows that are pure Clearline judgement ("what it
means for us", "our choice", "practitioner judgement") are left out on purpose. **Outward-facing** = sales,
content, proposals or a customer-visible page could repeat it, so it must be opened before use. **Internal
only** = it steers our own engineering or ops choices.

Refreshed 2026-10-31: claims that official GitHub repos could settle were opened and relabelled `[VERIFIED: raw.githubusercontent.com/...]`
(the Arbitrum, BNB BEP, Polygon Heimdall, execution-apis, ethereum.org and Tron TIP files, plus GitHub's advisory database). Note: `git clone`
of **public** github.com repos works from this environment, even though github.com web pages and api.github.com return 403. Everdawn-Labs
(USDT0) repos are private, and Tether publishes no official GitHub source for TetherToken.

## Hosts to allow (environment → Network access) to clear the rest
- **Issuers and chain data:** developers.circle.com, circle.com, tether.to, usdt0.to, etherscan.io, docs.etherscan.io, tronscan.org,
  developers.tron.network, docs.polygon.technology, polygon-rpc.com (or any Polygon PoS RPC), docs.alchemy.com, docs.infura.io (infura.io),
  quicknode.com, usenix.org, arxiv.org
- **Market data:** defillama.com, stablecoins.llama.fi, allium.so, mckinsey.com, fireblocks.com, mastercard.com
- **Competitors (their own pages):** cryptio.co, bitwave.io, ledgible.io, taxbit.com, request.finance, coinshift.xyz, integral.xyz,
  tres.finance, cryptoworth.com, lukka.tech, bitpay.com, coinbase.com, docs.stripe.com, triple-a.io, bvnk.com, nowpayments.io,
  coingate.com, theblock.co
- **Regulators and law texts:** congress.gov, govinfo.gov, occ.gov, home.treasury.gov, fincen.gov, eur-lex.europa.eu, eba.europa.eu,
  esma.europa.eu, hkma.gov.hk, elegislation.gov.hk, mas.gov.sg, iras.gov.sg, sso.agc.gov.sg, pdpc.gov.sg, imda.gov.sg,
  incometaxindia.gov.in, fiuindia.gov.in, rbi.org.in, meity.gov.in, cbic-gst.gov.in, gstcouncil.gov.in, fca.org.uk,
  bankofengland.co.uk, ftc.gov, ico.org.uk, gesetze-im-internet.de, ris.bka.gv.at, garanteprivacy.it, boe.es, cnil.fr,
  laws-lois.justice.gc.ca, crtc.gc.ca, legislation.gov.au, acma.gov.au
- **Email, LinkedIn, operating-craft sources:** support.google.com, datatracker.ietf.org (or rfc-editor.org), linkedin.com,
  aboutamazon.com, en.wikipedia.org, blog.aaronkharris.com, visible.vc, bothsidesofthetable.com
- **Funding trackers:** naut.so, stablecoin.nyc, recentfunding.com

---

## research-intern

### Outward-facing
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| market.md §1 | Supply ~US$299.1bn on 28 Oct 2026; USDT ~US$181.8bn, USDC ~US$71.3bn | https://defillama.com/stablecoins | Outward: "market size" line for sales/content |
| market.md §1 | Supply fell from ~US$314.5bn (2 Oct); USDC −US$4.7bn in 30 days | https://defillama.com/stablecoins | Outward |
| market.md §1 | Allium Q3 2026: supply +0.4% to US$305bn at 30 Sep | Allium Q3 2026 report (allium.so) | Outward |
| market.md §2 | ~US$482bn payments Jan–Sep 2026, +45% y/y; Sep record ~US$72bn | Allium Q3 2026 report (allium.so) | Outward |
| market.md §2 | Allium earlier: US$401–527bn payments Jan–Aug 2026 | Allium report (allium.so) | Outward |
| market.md §2 | Business-received ~58–64% of payments; +37% to US$246bn in nine months | Allium report (allium.so) | Outward |
| market.md §3 | Fireblocks survey: 49% use stablecoins for payments; LatAm 71%, NA 39% | https://www.fireblocks.com (State of Stablecoins 2025) | Outward |
| market.md §3 | Mastercard cited ≥US$350bn digital-currency payments in 2025 (BVNK announcement) | Mastercard press release, 17 Mar 2026 (mastercard.com) | Outward |
| market.md §4 | LatAm leads cross-border use; much SG/HK B2B USDT is on Tron | Fireblocks report; claims audit A6 | Outward (ICP pitch) |
| market.md §5 | "USDT about 60% of supply, USDC about 24% (DefiLlama, Oct 2026)" | https://defillama.com/stablecoins | Outward: approved quote line |
| competitors.md #1 | Cryptio features, 400+ enterprises, US$45m Series B 12 Mar 2026 | https://cryptio.co , Cryptio press release | Outward (battlecards) |
| competitors.md #2 | Bitwave AR/AP flow, SOC 1/2, tokens, BVNK partner, RLUSD to Ripple | https://www.bitwave.io/solutions/stablecoin-b2b-payments-enterprise-ar-ap | Outward |
| competitors.md #3 | Ledgible: enterprise GL integrations; custom enterprise pricing | https://ledgible.io/pricing/ | Outward |
| competitors.md #4 | TaxBit: 1099-DA, CARF/DAC8 filing; first CARF/DAC8 season 2026 | https://www.taxbit.com | Outward |
| competitors.md #6 | Coinshift ops product sunset 31 Mar 2026; csUSDL >US$100m TVL | https://coinshift.xyz | Outward ("no longer a competitor") |
| competitors.md #7 | Integral: Web3 bookkeeping; pricing not public (~US$500/month per a competitor) | https://integral.xyz | Outward |
| competitors.md #8 | TRES: multi-source reconciliation, ERC-4626 pricing, SOC 1/2 Type 2 | https://tres.finance | Outward |
| competitors.md #9 | Cryptoworth: QBO integration; from US$99/month | https://cryptoworth.com | Outward |
| competitors.md #10 | Lukka: 100+ chains, SOC 1/2 Type II, acquired Blox accounting | https://lukka.tech | Outward |
| competitors.md #11 | BitPay: QuickBooks on Business plans; USDC/GUSD since 2018; fees 1% or tiered | https://support.bitpay.com/hc/en-us/articles/201895853 , bitpay.com/pricing | Outward |
| competitors.md #12 | Coinbase/Shopify USDC on Base, 34 countries, local-currency settlement | Coinbase or Shopify announcement, Jun 2025 | Outward |
| competitors.md #13 | Stripe stablecoin fee 1.5% | https://docs.stripe.com/crypto/stablecoins (pricing page) | Outward |
| competitors.md #14 | Circle CPN Managed Payments launched 8 Apr 2026; for financial institutions | https://circle.com/pressroom | Outward |
| competitors.md #15 | Triple-A MAS licence history | https://www.mas.gov.sg (Financial Institutions Directory) | Outward |
| competitors.md #16 | Bridge conditional OCC trust-bank approval, Feb 2026 | https://www.occ.gov (news releases) | Outward |
| competitors.md #17 | BVNK 130+ countries, ~US$30bn; Mastercard to buy for ≤US$1.8bn | Mastercard / BVNK press release, 17 Mar 2026 | Outward |
| competitors.md #19 | NOWPayments/CoinGate fees ~0.5–1% | https://nowpayments.io , https://coingate.com pricing | Outward |
| competitors.md "Others" | Jeeves, Noah, Hifi funding Sep–Oct 2026 | each company's own release | Outward |
| regulation.md §1 | GENIUS Act effective earlier of 18 Jan 2027 or 120 days after final rules | https://www.congress.gov (Public Law 119-27 text) | Outward |
| regulation.md §1 | OCC final rule 21 Oct 2026, effective 18 Jan 2027, PPSIs/foreign issuers/custody | https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-92.html | Outward |
| regulation.md §1 | Treasury NPRMs (Apr, 17 Aug 2026); FinCEN/OFAC AML NPRM pending | https://home.treasury.gov , https://www.fincen.gov | Outward |
| regulation.md §1 | Key statutory provisions (law-firm summaries) | Public Law 119-27 text (congress.gov / govinfo.gov) | Outward |
| regulation.md §1 | Tether USAT launched 27 Jan 2026 via Anchorage Digital Bank | https://tether.to (news) | Outward |
| regulation.md §1 | Bridge conditional OCC approval (12 vs 17 Feb 2026) | https://www.occ.gov | Outward |
| regulation.md §2 | Rest of MiCA (incl. CASPs) applied from 30 Dec 2024 | https://eur-lex.europa.eu/eli/reg/2023/1114/oj (Art 149) | Outward |
| regulation.md §2 | EMT duties: authorised issuer, par redemption, no interest, recovery plans | MiCA Title IV, eur-lex | Outward |
| regulation.md §2 | "Significant" EMT/ART thresholds (>10m holders, >€5bn); EBA supervises | MiCA Art 43/56, eur-lex; https://www.eba.europa.eu | Outward |
| regulation.md §2 | USDC/EURC issued in EU by Circle Mint Europe SAS (EMI, 1 Jul 2024) | https://www.circle.com (pressroom); ACPR register | Outward |
| regulation.md §2 | USDT not MiCA-authorised; Tether did not seek authorisation | ESMA interim MiCA register (esma.europa.eu) | Outward |
| regulation.md §2 | ESMA: CASPs restrict non-compliant stablecoins by end-Q1 2025 | https://www.esma.europa.eu (statement on non-MiCA ARTs/EMTs) | Outward |
| regulation.md §2 | Binance ended EEA spot USDT trading 31 Mar 2025 | Binance announcement (binance.com) | Outward |
| regulation.md §2 | Self-custody USDT holding by EU residents not illegal | MiCA text, eur-lex | Outward |
| regulation.md §2 | ESMA end-of-transition statement; ~17% of registrants CASP-authorised by May 2026 | ESMA statement PDF R25; ESMA CASP register | Outward |
| regulation.md §3 | HK Stablecoins Ordinance passage date 21 May 2025 | https://www.elegislation.gov.hk (Cap. 656) | Outward |
| regulation.md §3 | Only licensees may offer FRS to the HK public | Cap. 656, elegislation.gov.hk; https://www.hkma.gov.hk | Outward |
| regulation.md §3 | USDT/USDC unlicensed in HK; professional investors only | https://www.hkma.gov.hk (licensee register) | Outward |
| regulation.md §3 | AML/CFT guideline for issuers incl. travel rule | https://www.hkma.gov.hk | Outward |
| regulation.md §3 | Details of first HK licences (HSBC, Anchorpoint) | https://www.hkma.gov.hk press release 10 Apr 2026 | Outward |
| regulation.md §4 | Circle Singapore holds an MPI licence | https://www.mas.gov.sg (FI Directory) | Outward |
| regulation.md §4 | FSMA DTSP: overseas-only firms need licence, no transition | https://www.mas.gov.sg (DTSP response/guidelines) | Outward |
| regulation.md §4 | Draft SG stablecoin law scope: MAS-regulated label, foreign-coin recognition | https://www.mas.gov.sg consultation, Sep 2026 | Outward |
| regulation.md §4 | IRAS: DPT used as payment disregarded for GST (sources conflict) | https://www.iras.gov.sg (GST on digital payment tokens) | Outward |
| regulation.md §5 | Income Tax Act 2025 carries VDA tax/TDS with renumbered sections | https://incometaxindia.gov.in | Outward |
| regulation.md §5 | FIU-IND registration for VDA SPs; 54 registered by May 2026 | https://fiuindia.gov.in | Outward |
| regulation.md §5 | India stablecoin stance "leans toward prohibition" (Reuters-attributed) | https://rbi.org.in ; Reuters original | Outward |
| regulation.md §5 | FEMA: stablecoins are VDAs; export-realisation questions | https://rbi.org.in (FEMA master directions) | Outward |
| regulation.md §6 | UK regime: issuer rules, £350k capital; BoE for systemic issuers | https://www.fca.org.uk/publication/policy/ps26-10.pdf ; bankofengland.co.uk | Outward |
| regulation.md §6 | PS26/18: hybrid/algorithmic tokens not "qualifying stablecoins" | https://www.fca.org.uk/publication/policy/ps26-18.pdf | Outward |
| regulation.md §6 | UK regime in force 25 Oct 2027; window 30 Sep 2026–28 Feb 2027 | https://www.fca.org.uk | Outward |
| lead-evidence.md §6 | Official USDT (Eth, Tron) and USDC (Eth) contract addresses | https://tether.to/en/supported-protocols/ ; https://developers.circle.com/stablecoins/usdc-contract-addresses | Outward (lead evidence, customer pages) |
| lead-evidence.md §6 | Bridged USDC (USDC.e) is not issued by Circle | https://www.circle.com/multi-chain-usdc | Outward |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| funding-news-sources.md | Tracker URLs (NAUT 13 startups US$316.1m; stablecoin.nyc; recentfunding) exist and list deals | naut.so, stablecoin.nyc, recentfunding.com | Internal: lead discovery only, confirm each deal at source |
| lead-evidence.md §4 | Recent domain registration as scam signal (whois) | whois/RDAP of the domain | Internal |

## revops-crm-agent

### Outward-facing (anything in an email, invoice or proposal)
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| compliance.md §1 | CAN-SPAM: no B2B exemption; postal address; opt-out honoured within 10 business days | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business ; 15 USC 7704 | Outward: governs every US email |
| compliance.md §1 | CAN-SPAM penalties per email, inflation-adjusted (> $16,000) | https://www.ftc.gov (civil penalty adjustments) | Outward |
| compliance.md §2 | PECR: corporate subscribers emailable without consent; sole traders need consent | https://ico.org.uk (PECR electronic mail marketing guide) | Outward |
| compliance.md §3 | GDPR Recital 47 / Art 21 / Art 14 / Art 3(2) as summarised | https://eur-lex.europa.eu/eli/reg/2016/679/oj | Outward |
| compliance.md §3 | ePrivacy Art 13: consent for natural persons; legal persons left to Member States | https://eur-lex.europa.eu/eli/dir/2002/58/oj | Outward |
| compliance.md §3 | Germany UWG §7(2): consent needed, no B2B exemption | https://www.gesetze-im-internet.de/uwg_2004/__7.html | Outward |
| compliance.md §3 | Austria TKG 2021 §174: consent incl. B2B | https://www.ris.bka.gv.at (TKG 2021) | Outward |
| compliance.md §3 | Italy art. 130 / Spain LSSI art. 21: consent even for company addresses | https://www.garanteprivacy.it ; https://www.boe.es (LSSI) | Outward |
| compliance.md §3 | Netherlands B2B rule conflicts between sources | Telecommunicatiewet art 11.7 (wetten.overheid.nl) | Outward |
| compliance.md §3 | France, Ireland allow role-relevant B2B email with opt-out | https://www.cnil.fr ; Irish S.I. 336/2011 | Outward |
| compliance.md §4 | PDPA BCI exclusion; Spam Control Act bulk thresholds 100/1,000/10,000, `<ADV>` | https://sso.agc.gov.sg/Act/SCA2007 ; pdpc.gov.sg ; imda.gov.sg | Outward: sets our 1,000/30-day stop |
| compliance.md §5 | CASL conspicuous-publication test; unsubscribe within 10 business days | https://laws-lois.justice.gc.ca (S.C. 2010, c. 23) ; crtc.gc.ca | Outward |
| compliance.md §6 | Spam Act 2003 inferred consent; unsubscribe honoured within 5 working days | https://www.legislation.gov.au/C2004A01214/latest/text ; acma.gov.au | Outward |
| compliance.md §7 | DPDP Rules notified 13 Nov 2025; phases 13 Nov 2026 / 13 May 2027 | https://www.meity.gov.in (DPDP Rules 2025 gazette) | Outward |
| compliance.md §7 | DPDP is consent-based, no business-contact carve-out | DPDP Act 2023 text, meity.gov.in | Outward |
| compliance.md §7 | TRAI telecom-marketing rules cover calls/SMS, not email | https://www.trai.gov.in (TCCCPR 2018) | Outward |
| proposals-invoices.md | CGST Rule 46 invoice fields for export of services | https://cbic-gst.gov.in (CGST Rules, Rule 46) | Outward: on every invoice (CA to confirm) |
| proposals-invoices.md | LUT endorsement wording "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING…" | CGST Rule 46 / LUT circular, cbic-gst.gov.in | Outward |
| proposals-invoices.md | FEMA/RBI time limit for realising export proceeds | https://rbi.org.in (Master Direction on export of goods and services) | Outward |
| proposals-invoices.md | Under LUT, tax payable if not paid in forex within allowed period | https://gstcouncil.gov.in LUT master circular | Outward |
| cold-email-craft.md §1 | Reply-rate benchmarks (Instantly, Belkins); B2B ~1.5–7% | instantly.ai, belkins.io benchmark reports | Outward if quoted in content |
| deliverability.md | Gmail bulk-sender rules (SPF/DKIM/DMARC, one-click unsubscribe, spam rate) | https://support.google.com/a/answer/81126 | Outward: affects whether emails land |
| deliverability.md | RFC 8058 one-click List-Unsubscribe | https://datatracker.ietf.org/doc/html/rfc8058 | Outward |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| deliverability.md | Gmail sending limits (personal account per-day cap) | https://support.google.com/mail/answer/22839 | Internal: daily cap setting |
| deliverability.md | New-mailbox ramp: ~150/day, risk above ~300 (vendor advice) | vendor blogs (trulyinbox.com) | Internal |
| deliverability.md | Warm-up services common; watch bounces/complaints | vendor sources | Internal |
| deliverability.md | Soft vs hard bounce by RFC 3463 codes | https://datatracker.ietf.org/doc/html/rfc3463 | Internal |
| deliverability.md | Postmaster Tools needs a verified own domain | https://support.google.com/mail/answer/9981691 | Internal |
| linkedin-manual.md §2 | LinkedIn User Agreement 8.2 bans bots/scrapers; graduated enforcement | https://www.linkedin.com/legal/user-agreement | Internal (why we never automate) |
| linkedin-manual.md §3 | Unofficial invite/note limits and character limits | https://www.linkedin.com/help | Internal |

## crypto-protocol-engineer

### Outward-facing (payment pages, security claims, content)
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| issuer-controls.md §4; erc20-trc20.md §4 | Ethereum USDT `0xdAC1…1ec7` is Tether's listed contract | https://tether.to/en/supported-protocols/ | Outward: "genuine USDT" verdicts |
| issuer-controls.md §4; erc20-trc20.md §4 | Ethereum USDC `0xA0b8…eB48` is Circle's listed contract | https://developers.circle.com/stablecoins/usdc-contract-addresses | Outward |
| issuer-controls.md §3/§4; erc20-trc20.md §4 | Arbitrum/Base/OP USDC addresses are on Circle's list | https://developers.circle.com/stablecoins/usdc-contract-addresses | Outward |
| issuer-controls.md §4 | Circle wound down USDC on Tron | https://developers.circle.com ; Circle blog | Outward |
| issuer-controls.md §3; erc20-trc20.md §4 | USDT0 is a LayerZero OFT and may freeze via other names (`isBlocked`) | https://usdt0.to docs; verified source on arbiscan.io | Outward: D09 "checked" claim |
| issuer-controls.md §2 | Tether blocks transfers *from* but not *to* blacklisted addresses | Verified TetherToken source, https://etherscan.io/address/0xdac17f958d2ee523a2206206994597c13d831ec7#code | Outward (freeze explanation) |
| issuer-controls.md §2 | Ethereum TetherToken event indexing may differ from Tron | Same Etherscan verified source | Internal/outward (log filters) |
| issuer-controls.md §4 | Tether discontinued Omni, Kusama, BCH SLP, EOS, Algorand (2023–2025) | https://tether.to/en/news | Outward |
| erc20-trc20.md §3 | Ethereum USDT fee params (`basisPointsRate`, `maximumFee`) exist, set to 0 | Etherscan verified source + `eth_call` | Outward (amount received) |
| address-formats.md (Solana) | Solana USDC mint `EPjF…Dt1v` | https://developers.circle.com/stablecoins/usdc-contract-addresses | Outward (v1.1) |
| attack-patterns.md A1 | USENIX 2025: ~270m poisoning attempts, ~17m victims, ≥US$83.8m lost | https://arxiv.org/abs/2501.16681 ; usenix.org | Outward: content/sales statistic |
| finality-reorgs.md (Polygon) | Polygon milestones "2 to 5 seconds", `finalized` tag, checkpoints every ≥256 blocks | https://docs.polygon.technology/pos/concepts/finality/finality | Outward if quoted as wait times |
| finality-reorgs.md (Polygon) | Pre-milestone advice (128/256 blocks) obsolete | same | Internal |
| secure-read-only-architecture.md | Holding/forwarding funds would need a SG DPT licence (whitepaper) | https://www.mas.gov.sg (PS Act DPT service definition) | Outward (legal positioning) |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| providers.md | Etherscan V2 free tier 3/s, 100k/day, 1,000-record cap from 1 Jul 2026 | https://docs.etherscan.io (rate limits, changelog) | Internal: provider choice |
| providers.md | Etherscan paid plans from ~US$49/month | https://etherscan.io/apis | Internal |
| providers.md | TronGrid keyed ~15 QPS; 403 + 30 s penalty | https://developers.tron.network/reference/rate-limits | Internal |
| providers.md | Alchemy 30M CU, Infura 3M credits/day, QuickNode trial and $49 | docs.alchemy.com, infura.io, quicknode.com/pricing | Internal |
| providers.md | All three offer safe/finalized tags, archive, webhooks | provider docs | Internal |
| erc20-trc20.md §2 | `removed: true` also delivered via `eth_getFilterChanges` (spec states subscriptions only) | client docs (geth.ethereum.org) | Internal |
| erc20-trc20.md §1 | Genuine tokens accept zero-amount `transferFrom` with zero allowance | Etherscan verified sources (USDT, USDC) | Internal (poisoning detection) |
| eip-681.md | `pay-` optional in practice; Tron `tron:` URI conventions vary per wallet | wallet docs (MetaMask, TronLink) | Internal |
| address-formats.md | Same key → same EOA on every EVM chain (inference from ethereum.org) | https://ethereum.org/developers/docs/accounts | Internal |
| address-formats.md | Tron hex body pasted as `0x…` is a valid EVM address | inference; no page | Internal |

## qa-security-engineer

### Outward-facing
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| edge-case-catalogue.md (sources) | Address-poisoning pattern as cited in SPEC (Elliptic, arXiv 2501.16681) | https://arxiv.org/abs/2501.16681 ; elliptic.co | Outward via the security pack |
| owasp.md (logging) | Actor names and IPs are personal data under Singapore PDPA | https://sso.agc.gov.sg/Act/PDPA2012 ; pdpc.gov.sg | Outward (security pack, privacy claims) |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| owasp.md (uploads) | Need for the remaining File Upload cheat-sheet controls | (judgement; the cheat sheet itself is verified) | Internal |
| security-pack-and-claims.md | Typical umask 022 → token file world-readable 0644 | `umask` on the deploy host | Internal |
| secrets-and-supply-chain.md | No runtime PostCSS, so postcss advisories are low practical risk | `next` build output / code search | Internal |

## chief-of-staff

### Outward-facing (investor and advisor updates)
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| investor-advisor-updates.md; okrs-metrics.md (S17) | Aaron Harris: never drop a missed metric; growth, cash, asks | https://blog.aaronkharris.com/investor-updates | Outward: shapes investor updates |
| investor-advisor-updates.md (S18) | YC update format: 3-5 highlights, 1-3 lowlights, 1-3 asks; monthly | https://visible.vc/blog/tips-from-yc-using-asks-metrics-and-a-recap-to-power-your-investor-updates/ | Outward |
| investor-advisor-updates.md (S19) | Suster "Invest in Lines, Not Dots" (2010) | https://bothsidesofthetable.com (exact post) | Outward |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why it matters |
|---|---|---|---|
| briefing-craft.md; README S13 | BLUF origin in AR 25-50 | https://en.wikipedia.org/wiki/BLUF_(communication) (then AR 25-50 itself) | Internal |
| briefing-craft.md; README S14 | Tongue and Quill: "bottom line up front (most of the time)" | same; AF Handbook 33-337 | Internal |
| briefing-craft.md; README S15 | Amazon 2016 letter: Type 1/2 decisions, ~70% information | https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders | Internal |
| briefing-craft.md; README S16 | Amazon 2017 letter: six-page memos read silently | https://www.aboutamazon.com/news/company-news/2017-letter-to-shareholders | Internal |
| briefing-craft.md; README S20 | Completed staff work doctrine (1940s) | https://en.wikipedia.org/wiki/Completed_staff_work | Internal |
