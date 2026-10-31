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

**8 verified, 1 corrected, 23 still unverified (31 Oct)** (23 includes two items split out of partly verified rows: UK GDPR from PECR, Workspace limit from Gmail limits). Verified 2026-10-31 from primary text: PECR (ico.org.uk),
Italy art. 130 (garanteprivacy.it), Spain LSSI art. 21 (boe.es), CASL (laws-lois.justice.gc.ca), RBI nine-month
realisation (rbi.org.in), Gmail sender guidelines + FAQ (support.google.com), RFC 8058, RFC 3463, Postmaster Tools.
Corrected: Gmail personal sending limit wording (deliverability.md §2). The Workspace ~2,000/day half of that row
is split out below. Blocked hosts 2026-10-31: www.ftc.gov, uscode.house.gov, law.cornell.edu, www.govinfo.gov,
eur-lex.europa.eu (bot check), gesetze-im-internet.de, ris.bka.gv.at (503), wetten.overheid.nl, www.cnil.fr,
irishstatutebook.ie, legislation.gov.uk, www.pdpc.gov.sg, www.imda.gov.sg, sso.agc.gov.sg section text (403; TOC
only), www.legislation.gov.au, www.acma.gov.au, www.meity.gov.in, egazette.gov.in, trai.gov.in,
taxinformation.cbic.gov.in, knowledge.workspace.google.com, www.linkedin.com (linkedin.com = reCAPTCHA),
crtc.gc.ca (403), vendor sites.

### Outward-facing (anything in an email, invoice or proposal)
| File | Claim (≤ 15 words) | Primary source to open | Why still unverified |
|---|---|---|---|
| compliance.md §1 | CAN-SPAM: no B2B exemption; postal address; opt-out honoured within 10 business days | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business ; 15 USC 7704 | www.ftc.gov, uscode, cornell, govinfo blocked |
| compliance.md §1 | CAN-SPAM penalties per email, inflation-adjusted (> $16,000) | https://www.ftc.gov (civil penalty adjustments) | www.ftc.gov blocked |
| compliance.md §2 | UK GDPR legitimate-interest / Art 14 / Art 21 points | https://www.legislation.gov.uk (UK GDPR) | legislation.gov.uk blocked (PECR part verified) |
| compliance.md §3 | GDPR Recital 47 / Art 21 / Art 14 / Art 3(2) as summarised | https://eur-lex.europa.eu/eli/reg/2016/679/oj | eur-lex bot-check page, no text |
| compliance.md §3 | ePrivacy Art 13: consent for natural persons; legal persons left to Member States | https://eur-lex.europa.eu/eli/dir/2002/58/oj | eur-lex bot-check page |
| compliance.md §3 | Germany UWG §7(2): consent needed, no B2B exemption | https://www.gesetze-im-internet.de/uwg_2004/__7.html | host blocked |
| compliance.md §3 | Austria TKG 2021 §174: consent incl. B2B | https://www.ris.bka.gv.at (TKG 2021) | 503 |
| compliance.md §3 | Netherlands B2B rule conflicts between sources | Telecommunicatiewet art 11.7 (wetten.overheid.nl) | host blocked (RULES.md treats NL as strict anyway) |
| compliance.md §3 | France, Ireland allow role-relevant B2B email with opt-out | https://www.cnil.fr ; Irish S.I. 336/2011 | www.cnil.fr, irishstatutebook.ie blocked |
| compliance.md §4 | PDPA BCI exclusion; Spam Control Act bulk thresholds 100/1,000/10,000, `<ADV>`, 10 business days | https://sso.agc.gov.sg/Act/SCA2007 ; pdpc.gov.sg ; imda.gov.sg | SSO showed TOC only (s 6, s 11 exist); text/PDF 403; pdpc/imda blocked. Sets our 1,000/30-day stop |
| compliance.md §6 | Spam Act 2003 inferred consent; unsubscribe honoured within 5 working days | https://www.legislation.gov.au/C2004A01214/latest/text ; acma.gov.au | both blocked |
| compliance.md §7 | DPDP Rules notified 13 Nov 2025; phases 13 Nov 2026 / 13 May 2027 | https://www.meity.gov.in (DPDP Rules 2025 gazette) | meity, egazette blocked |
| compliance.md §7 | DPDP is consent-based, no business-contact carve-out | DPDP Act 2023 text, meity.gov.in | blocked |
| compliance.md §7 | TRAI telecom-marketing rules cover calls/SMS, not email | https://www.trai.gov.in (TCCCPR 2018) | blocked |
| proposals-invoices.md | CGST Rule 46 invoice fields for export of services | CGST Rules, Rule 46 (taxinformation.cbic.gov.in) | blocked; cbic-gst.gov.in has no Rules text (CA to confirm) |
| proposals-invoices.md | LUT endorsement wording "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING…" | CGST Rule 46 | blocked |
| proposals-invoices.md | Under LUT, tax payable if not paid in forex within allowed period | CGST Rule 96A(1) | LUT circular opened but does not state it; Rule 96A unread |
| cold-email-craft.md §1 | Reply-rate benchmarks (Instantly, Belkins); B2B ~1.5–7% | instantly.ai, belkins.io benchmark reports | blocked; vendor data at best |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why still unverified |
|---|---|---|---|
| deliverability.md §2 | Google Workspace sending limit ~2,000/day | https://support.google.com/a/answer/166852 | redirects to knowledge.workspace.google.com, blocked |
| deliverability.md | New-mailbox ramp: ~150/day, risk above ~300 (vendor advice) | vendor blogs (trulyinbox.com) | no primary exists; vendor host blocked |
| deliverability.md | Warm-up services common; watch bounces/complaints | vendor sources | no primary exists |
| linkedin-manual.md §2 | LinkedIn User Agreement 8.2 bans bots/scrapers; graduated enforcement | https://www.linkedin.com/legal/user-agreement | www blocked; apex = reCAPTCHA |
| linkedin-manual.md §3 | Unofficial invite/note limits and character limits | https://www.linkedin.com/help | blocked; LinkedIn does not publish them |

## crypto-protocol-engineer
16 verified, 3 corrected, 16 still unverified (31 Oct)

Verified 31 Oct on primary sources: Circle's USDC list (Ethereum, Arbitrum, Base, OP, Polygon PoS, Solana; no Tron), Tether's
supported-protocols list (Ethereum and Tron USD₮; legacy chains deprecated), USDT0 freeze functions on-chain (`isBlocked`,
`addToBlockedList`, `destroyBlockedFunds`; LayerZero OFT adapter), Tron USDT transfer *to* a blacklisted address not blocked
(simulated), arXiv poisoning figures, Polygon finality docs, Etherscan rate limits/changelog, Infura pricing, geth `removed` on
filters, FiatToken zero-amount `transferFrom`, ERC-681 optional `pay-`, Tron solidification (developers.tron.network). Corrected:
Polygon checkpoints are a governance-set length (was "every ≥256 blocks"); TronGrid publishes no fixed QPS/penalty, 429 or 403
(was "~15 QPS, 403 + 30 s"); Tether lists XAU₮ (no USD₮) on BNB Chain (was "neither issuer lists BNB Chain").

### Outward-facing (payment pages, security claims, content)
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| issuer-controls.md §2 | Ethereum TetherToken does not block transfers *to* blacklisted addresses (Tron verified) | Etherscan verified source of `0xdAC1…1ec7`, or an Ethereum RPC `eth_call` simulation | etherscan.io 403; every Ethereum RPC blocked |
| issuer-controls.md §2 | Ethereum TetherToken event indexing may differ from Tron | same | same |
| erc20-trc20.md §3 | Ethereum USDT `basisPointsRate`/`maximumFee` exist and are 0 | Ethereum RPC `eth_call` | no Ethereum RPC reachable |
| issuer-controls.md §3 | USDT0 block events, and whether `isBlocked` also stops the recipient | https://docs.usdt0.to ; verified source on arbiscan.io | docs.usdt0.to, arbiscan.io unreachable; repos private |
| issuer-controls.md §4 | Circle's announcement winding down USDC on Tron (absence from list verified) | https://www.circle.com/blog | circle.com unreachable |
| issuer-controls.md §4 | Dates of Tether's legacy-chain exits (2023-2025, Aug 2025 revision) | https://tether.io/news/tether-provides-update-on-transition-plan-for-legacy-blockchains/ | tether.io unreachable |
| erc20-trc20.md §4 | Polygon PoS USDC decimals (address verified on Circle's list) | Polygon RPC `decimals()` | polygon-rpc.com "tenant disabled"; others blocked |
| secure-read-only-architecture.md | Holding/forwarding funds would need a SG DPT licence (whitepaper) | https://sso.agc.gov.sg/Act/PSA2019 ; https://www.mas.gov.sg | sso.agc.gov.sg 403; mas.gov.sg unreachable |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| providers.md | Etherscan paid plans from ~US$49/month | https://etherscan.io/api/pricing | 403 |
| providers.md | Etherscan error text "Max rate limit reached" | docs.etherscan.io error pages | not on the pages opened |
| providers.md | Alchemy 30M CU/month (`eth_call` 26 CU); QuickNode trial and $49 | alchemy.com docs/pricing, quicknode.com/pricing | both unreachable |
| providers.md | All three offer safe/finalized tags and webhooks (Infura archive verified) | provider docs | Alchemy/QuickNode unreachable; Infura tag pages not read |
| erc20-trc20.md §1 | Ethereum USDT accepts zero-amount `transferFrom` with zero allowance (USDC verified) | Etherscan verified source | etherscan.io 403 |
| eip-681.md | Wallets accept plain `ethereum:`; Tron `tron:` URI conventions vary per wallet | MetaMask, TronLink docs | metamask.io, docs.tronlink.org unreachable |
| address-formats.md | Same key → same EOA on every EVM chain | inference from ethereum.org (derivation verified) | no page states it |
| address-formats.md | Tron hex body pasted as `0x…` is a valid EVM address | inference; no page | no page states it |

## qa-security-engineer
1 verified, 0 corrected, 5 still unverified (31 Oct)

Verified 31 Oct: the CMU address-poisoning paper cited in SPEC (arXiv 2501.16681, abstract and PDF). Nothing contradicted.

### Outward-facing
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| edge-case-catalogue.md (sources) | Elliptic's address-poisoning write-up as cited in SPEC (arXiv half verified) | elliptic.co (exact post from SPEC) | elliptic.co unreachable |
| owasp.md (logging) | Actor names and IPs are personal data under Singapore PDPA | https://sso.agc.gov.sg/Act/PDPA2012 ; pdpc.gov.sg | sso.agc.gov.sg 403; pdpc.gov.sg unreachable |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| owasp.md (uploads) | Need for the remaining File Upload cheat-sheet controls | (judgement; the cheat sheet itself is verified) | judgement, not a fact |
| security-pack-and-claims.md | Typical umask 022 → token file world-readable 0644 | `umask` on the deploy host | needs the host (Dockerfile sets no umask) |
| secrets-and-supply-chain.md | No runtime PostCSS, so postcss advisories are low practical risk | Next build output | grep of `src/`, config clean; Next bundle not inspected |

## chief-of-staff
1 verified, 1 corrected, 7 still unverified (31 Oct)

Verified 31 Oct: S17 Aaron Harris essay on his own blog (monthly; growth, cash/burn, asks high, shorter; "Removing things because
you can't hit your milestones is bad"). Corrected: the "3-5 highlights, 1-3 lowlights, 1-3 asks" counts are not in S18 (Visible.vc,
opened) or S17; now labelled house format. S18 is secondary and only corroborates S17, so it is no longer listed.

### Outward-facing (investor and advisor updates)
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| investor-advisor-updates.md (S19) | Suster "Invest in Lines, Not Dots" (2010) | https://bothsidesofthetable.com (exact post) | bothsidesofthetable.com, medium.com unreachable |

### Internal only
| File | Claim (≤ 15 words) | Primary source to open | Why still open |
|---|---|---|---|
| briefing-craft.md; README S13 | BLUF origin in AR 25-50 | AR 25-50 (armypubs.army.mil) | only Wikipedia (secondary) opened; armypubs unreachable |
| briefing-craft.md; README S14 | Tongue and Quill: "bottom line up front (most of the time)" | AF Handbook 33-337 (e-publishing.af.mil) | not on the Wikipedia page; host unreachable |
| briefing-craft.md; README S15 | Amazon 2016 letter: Type 1/2 decisions, ~70% information | https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders | aboutamazon.com, sec.gov unreachable |
| briefing-craft.md; README S16 | Amazon 2017 letter: six-page memos read silently | https://www.aboutamazon.com/news/company-news/2017-letter-to-shareholders | same |
| briefing-craft.md; README S20 | Completed staff work: rough draft fine, half-baked not; 1940s US/Canadian | original memo (primary) | only Wikipedia (secondary) opened; it lacks those two details |
| briefing-craft.md §6 | Typical reading speed 200-250 words per minute | a reading-speed study | no source opened |
