# Regulatory issues for legal review — Singapore-first (13 Nov 2026)

**Not legal advice.** This is an issue-spotting memo for counsel, not a licensing opinion. Labels describe source verification, not whether Clearline is licensed.

## Singapore Payment Services Act
- [VERIFIED — primary source: Singapore Statutes Online, Payment Services Act 2019, First Schedule, accessed 2026-11-13] The Act lists account issuance, domestic money transfer, cross-border money transfer, merchant acquisition, e-money issuance, digital payment token services and money-changing as payment services. https://sso.agc.gov.sg/act/psa2019?ProvIds=Sc1-
- [VERIFIED — primary source: Singapore Statutes Online, accessed 2026-11-13] The statutory definition of cross-border money transfer expressly includes *arranging* for transmission/receipt, including specified deemed-offering circumstances. A company that never possesses customer funds may still fall within the statutory activity depending on its arrangements and location. https://sso.agc.gov.sg/act/psa2019?ProvIds=Sc1-
- [VERIFIED — primary source: MAS licensing guidance, accessed 2026-11-13] MAS lists domestic money transfer (including payment gateway services), cross-border money transfer, merchant acquisition, e-money issuance and DPT services as distinct activities. https://www.mas.gov.sg/-/media/mas/sectors/guidance/guidelines-on-licensing-for-payment-service-providers-1/guidelines-on-licensing-for-payment-service-providers.pdf
- [VERIFIED — primary source: MAS release dated 2025-06-06, accessed 2026-11-13] MAS described a separate Financial Services and Markets Act digital token service provider regime applicable to certain services to customers solely outside Singapore from 30 June 2025. https://www.mas.gov.sg/news/media-releases/2025/mas-clarifies-regulatory-regime-for-digital-token-service-providers

## Proposed design and limitations
- [ASSUMPTION] Clearline's intended commercial design: contracted and appropriately licensed partners custody/execute funds; Clearline logs customer instructions, reports route eligibility, forwards instructions, monitors status, and explains exceptions. No Clearline-controlled wallet, client balance, prefunding, loan, credit assessment or compliance approval.
- [ASSUMPTION] Whether a specific Connect workflow is merely software supply or regulated arranging/orchestration depends on contracts, control over instructions, economic substance, jurisdiction, who offers the service and who is customer-facing. **Never** assume “never holds funds” automatically avoids a licence.
- [ASSUMPTION] Read-only Control analytics likely raise fewer payment-service perimeter questions than Connect payout initiation, but privacy, operational resilience, outsourcing, outsourcing obligations applicable to regulated partners, data security and financial record retention still require review.
- [ASSUMPTION] Stablecoin routing may implicate DPT or other token-related activities depending on legal classification, trading, transfer controls and the service being offered. Testnet-only simulation is not a representation of permission to offer live services.
- [ASSUMPTION] United States, United Kingdom, EU and other corridors require separate counsel advice on money transmission, payment services, cryptoasset regulation, data transfer, sanctions and financial promotions before connecting a real partner.

## Questions for Singapore counsel
1. Which proposed endpoints or operational roles could constitute arranging cross-border transfers under the current PSA, even with partner execution?
2. If Clearline selects providers and passes payer-approved instructions, how does this change the licensing analysis versus merely presenting information?
3. What contracts and API segregation would establish that each licensed partner, not Clearline, executes and controls customer funds?
4. Would stablecoin transfer routing or exchange quoting change the DPT-service analysis? Which legal classification governs stablecoins in each scenario?
5. Which activities trigger customer due diligence, sanctions obligations, suspicious transaction handling, AML/CFT, recordkeeping or technology risk requirements?
6. What must the user-facing disclosures, API terms, partner agreements, incident procedures and audit trails say?
7. Which jurisdictions require local licensing or a permitted service-provider exemption before a live corridor is offered?

## Product guardrail
Until a jurisdiction-specific legal opinion and approved partner contract exists, retain test-only APIs and fictional routes. A provider-reported “completed” event is not independent proof that the receiving beneficiary obtained funds.
