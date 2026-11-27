# Bank APIs and open banking: options for Singapore and the UAE

Status: options note only. Nothing here is built, connected, contracted or signed up for. Clearline v1 reads bank
statements that a person uploads (CSV, XLSX, MT940, camt.053, camt.054, BAI2), and a second person confirms them.
Those lines stay at evidence level `imported_two_person_confirmed`. `bank_authenticated` is reserved, and nothing sets
it. A bank API is the only route that could ever justify it, and making that change is a separate decision that needs
approval.

Labels: [VERIFIED] means a public source was checked on 2026-11-25 (secondary sources are marked as such).
[ASSUMPTION] means our reading, not checked with a bank or a regulator. None of this is legal advice.
Clearline makes no regulatory or compliance claims.

## Why it matters

- An uploaded file can be edited before upload. Every format's checks (balances, BAI2 control totals) catch
  accidents, not forgery. A statement fetched directly from the bank over an authenticated channel would be stronger
  evidence. [ASSUMPTION]
- What we would need is read-only data: account balances and transactions. Clearline never initiates payments (it is
  read-only on money), so payment-initiation APIs are out of scope.

## Singapore

| Option | What it is | Fit for Clearline |
|---|---|---|
| Bank corporate APIs (bilateral) | MAS keeps a Financial Industry API Register of open APIs that financial institutions publish. Large banks run developer portals with account-information APIs for corporate clients. [VERIFIED: MAS API register exists, source 1] | Most direct route. Each bank needs its own onboarding, legal agreement and credentials held by the merchant. [ASSUMPTION] |
| ABS–MAS Finance-as-a-Service API Playbook | Industry guidance from 2016 on common APIs and API security and governance. It is not a mandatory open-banking regime. [VERIFIED, sources 2–3] | Useful as a design reference. It does not give third parties any right of access. [ASSUMPTION] |
| SGFinDex | A consent-based data exchange built on Singpass for individuals' financial data, launched in December 2020. [VERIFIED, sources 4–5] | Not a fit: it serves individuals, not corporate accounts. [ASSUMPTION] |
| Host-to-host / SWIFT files | The bank delivers MT940/camt.053/camt.054 files over SFTP or SWIFT. | Formats we already parse. The delivery channel, not the format, would make the file "bank-sent". [ASSUMPTION] |

Singapore has no mandatory open-banking regime that requires banks to share corporate account data with third
parties. [VERIFIED from secondary trackers, source 6; to be confirmed with counsel]

## UAE

| Option | What it is | Fit for Clearline |
|---|---|---|
| CBUAE Open Finance (Nebras API hub, Al Tareq consent layer) | The CBUAE Open Finance Regulation was issued in 2024. Participation is mandatory for CBUAE-licensed institutions in scope. A central API hub (Nebras) and a consent layer (Al Tareq) are being rolled out in phases, and some banks went live in 2025–2026. [VERIFIED: regulation issued, sources 7–9; go-live dates from press and vendor sources only, 10–11] | The most promising long-term route. A third party has to be licensed or authorised under the regime, which is a legal and licensing question, not an engineering one. [ASSUMPTION; see docs/LEGAL_QUESTIONS.md] |
| Bank corporate APIs (bilateral) | Several UAE banks offer corporate APIs. [ASSUMPTION: not checked bank by bank] | As in Singapore: one integration per bank, with credentials held by the merchant. |
| Free zones (DIFC, ADGM) | Have their own financial regulators and frameworks. [ASSUMPTION: not reviewed] | Needs review if a merchant banks with a free-zone institution. |

## Options compared (no decision taken)

1. **Keep uploads (today).** No cost and no third-party risk. The evidence level stays at
   `imported_two_person_confirmed`.
2. **Bank-delivered files (host-to-host or SFTP) into a Clearline inbox.** Reuses the existing parsers. To raise the
   evidence level we would need proof of origin, such as channel authentication or signed files. [ASSUMPTION]
3. **Account-information APIs (bilateral bank APIs, UAE Open Finance).** The strongest evidence, but it needs per-bank
   or regime onboarding, secure storage of tokens (secrets through environment variables or a vault only), consent
   management, and a legal review of licensing in each jurisdiction.

Any option that sets `bank_authenticated` changes a control and needs approval. No interface or stub has been built.
If one is built, it should follow the pattern of a pluggable interface with a local stand-in, with no calls to real
services.

## Sources

1. MAS, Financial Industry API Register: https://www.mas.gov.sg/development/fintech/financial-industry-api-register
2. MAS, "The API Economy": https://www.mas.gov.sg/development/fintech/technologies---apis
3. Singapore Government Developer Portal, MAS API resources: https://developer.tech.gov.sg/products/categories/data-and-apis/mas-api/overview
4. Smart Nation, SGFinDex: https://www.smartnation.gov.sg/initiatives/sgfindex
5. ABS, SGFinDex: https://www.abs.org.sg/consumer-banking/sgfindex
6. Open Banking Tracker, Singapore SGFinDex (secondary): https://openbankingtracker.com/regulation/singapore-sgfindex
7. WAM, "CBUAE issues Open Finance Regulation": https://wam.ae/en/article/b3vkckr-cbuae-issues-open-finance-regulation-ensure
8. Clifford Chance briefing, UAE Open Finance Regulation (May 2024): https://cliffordchance.com/content/dam/cliffordchance/briefings/2024/05/uae-open-finance-regulation.pdf
9. Pinsent Masons, UAE open finance guide: https://www.pinsentmasons.com/out-law/guides/uae-open-finance
10. Open Banking Expo, Commercial Bank of Dubai activation (press): https://www.openbankingexpo.com/news/commercial-bank-of-dubai-sets-milestone-with-open-finance-activation/
11. Facephi, Open Finance in the UAE (vendor summary): https://facephi.com/observatory/en/open-finance-eau-2026/
