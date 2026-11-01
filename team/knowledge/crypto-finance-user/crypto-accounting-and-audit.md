# Accounting and audit for stablecoins: what a controller worries about

Accessed 2026-10-31. **fasb.org, ifrs.org, aicpa-cima.com and pcaobus.org were blocked** from this
environment. Nothing in this file is `[VERIFIED]`. It is enough for a simulated controller to ask the
right questions; it is **not** accounting advice and must never be stated to a customer as fact.
Every answer ends with "confirm with your auditor" (professional review).

## 1. US GAAP: ASU 2023-08 (ASC 350-60) and why stablecoins are usually outside it
- ASU 2023-08 (issued 13 Dec 2023) requires crypto assets **in scope** to be measured at fair value
  with changes in net income, presented separately from other intangibles; effective for fiscal years
  beginning after 15 Dec 2024, early adoption permitted.
  Source: [Ledgible](https://ledgible.io/news/understanding-the-fasbs-updated-digital-asset-accounting-standards-2023-08/) (opened);
  [Deloitte DART FAQ](https://dart.deloitte.com/USDART/home/publications/deloitte/heads-up/2024/faq-fasb-crypto-assets-standard-asu-2023-08) (search).
  `[ASSUMPTION: secondary, Ledgible + Deloitte DART]`
- Scope needs **all six** criteria: (1) meets the definition of an intangible asset; (2) does **not**
  give the holder enforceable rights to or claims on underlying goods, services or other assets;
  (3) on a distributed ledger / blockchain; (4) secured through cryptography; (5) fungible; (6) not
  created or issued by the reporting entity or its related parties. `[ASSUMPTION: secondary, Ledgible + Deloitte DART]`
- **Stablecoins:** Ledgible: "There are no mentions of wrapped tokens or stablecoins in this ASU" and
  stablecoins "can be seen as a claim to an underlying asset", so they may fail criterion 2. Deloitte's
  FAQ (per search) says some stablecoins may be intangible assets but fail scope (enforceable claims),
  and others are not intangible assets at all (possibly financial assets). Commentary (Bloomberg Law,
  per search) notes companies still ask whether stablecoins can be cash equivalents.
  `[ASSUMPTION: secondary, Ledgible + search]`
- **What the controller does with this:** treats "is USDC cash?" as an open policy question for their
  auditor; wants the tool to keep stablecoin receipts in a **separate account per token** so any later
  reclassification is easy; never wants a vendor to tell them the answer. `[GUESS: persona judgement]`

## 2. IFRS (and Singapore SFRS(I), which mirrors IFRS `[ASSUMPTION]`)
- IFRS Interpretations Committee agenda decision, **June 2019, "Holdings of cryptocurrencies"**: a
  holding of cryptocurrency is not a financial asset (and not cash); IAS 2 applies if held for sale in
  the ordinary course of business, otherwise IAS 38 (intangible assets).
  Source: [IFRS agenda decision PDF](https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf) (search only);
  [EY summary](https://www.ey.com/en_gl/technical/ifrs-technical-resources/holdings-of-cryptocurrencies) (search).
  `[ASSUMPTION: secondary, search]`
- That decision's "cryptocurrency" is a narrow subset that excludes tokens giving the holder rights
  (stablecoins backed by a redemption claim arguably fall outside it); classification of a fiat-backed
  stablecoin under IFRS (financial asset under IFRS 9 vs intangible) depends on the token's terms.
  `[ASSUMPTION: secondary, search — not confirmed in the decision text]`
- 2025 FASB-IASB education session paper on cryptocurrencies exists ([ifrs.org AP38](https://www.ifrs.org/content/dam/ifrs/meetings/2025/october/fasb-iasb-education-meeting/ap38-cryptocurrencies.pdf), search only). `[ASSUMPTION: secondary, search]`

## 3. Audit: existence, ownership (rights and obligations), completeness
- **AICPA practice aid "Accounting for and Auditing of Digital Assets"** (non-authoritative; Q&A
  format; June 2024 update added chapter 5 on existence, rights and obligations and chapter 6 on
  valuation). Chapter 5 covers procedures for self-custodied and third-party-held assets, evaluating
  the reliability of information from a blockchain, and digital asset confirmations.
  Sources: [AICPA news](https://www.aicpa-cima.com/news/article/aicpa-updates-practice-aid-for-digital-assets),
  [NJCPA](https://njcpa.org/about/article/2024/06/10/aicpa-updates-practice-aid-for-digital-assets),
  [Maner CPA](https://manercpa.com/digital-assets-considerations-for-existence-rights-obligations-and-valuation/) (all search).
  `[ASSUMPTION: secondary, search]`
- **PCAOB Spotlight (June 2023), "Inspection Observations Related to Public Company Audits Involving
  Crypto Assets"**: deficiencies around existence, valuation and rights and obligations; access to
  private keys does not by itself prove sole ownership. Earlier 2020 Spotlight gave considerations and
  audit-committee questions. Sources: [pcaobus.org PDF](https://pcaobus.org/documents/crypto-assets-spotlight.pdf),
  [PCAOB 2020 release](https://pcaobus.org/news-events/news-releases/news-release-detail/pcaob-posts-spotlight-on-audits-involving-cryptoassets),
  [Deloitte DART](https://dart.deloitte.com/USDART/home/news/all-news/2023/jun/pcaob-crypto-observations) (search).
  `[ASSUMPTION: secondary, search]`

**Translation into what a controller asks a payment-verification tool** (`[GUESS: persona judgement]`):
- "Your tool reads public chain data. How does that help me show the **auditor** we own the wallet?"
  (Honest answer: it doesn't; ownership evidence comes from custody/key controls. Clearline gives
  per-payment **occurrence and accuracy** evidence: tx hash, token contract, network, confirmations,
  approver and time.)
- "Is the chain data you show reproducible? If I re-run it in March for the auditor, do I get the same
  answer?" (Spec: every verdict records rule version, settings version and evidence hashes
  [INTERNAL: docs/SPEC.md §6].)
- "Can I export the evidence for a sample of 25 payments for the PBC list?"
- "Who approved each posting, and can I prove that person was who the log says?" (Gap today: names are
  typed, not authenticated [INTERNAL: demo/WHAT_TO_SAY.md].)

## 4. Valuation of stablecoin receipts
- Clearline values USDC/USDT at par and says so on each line ("par: no price feed connected"); blocks
  automatic posting > 0.5% off par [INTERNAL: docs/ACCOUNTING_SYNC.md].
- A controller will accept par **as a written policy** for invoice settlement, and will ask what happens
  on a depeg day and who chose 0.5%. `[GUESS: persona judgement]`

## First refresh to-do (research-intern)
Open and relabel: FASB ASU 2023-08 (fasb.org), the IFRS June 2019 agenda decision PDF, AICPA practice
aid page, PCAOB 2023 Spotlight PDF. Hosts: fasb.org, ifrs.org, aicpa-cima.com, pcaobus.org.
