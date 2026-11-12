# Regulatory notes — Singapore and cross-border payments

*Prepared 13 November 2026. Product research, not legal advice. The operational classification of Clearline requires a Singapore payments lawyer and potentially local counsel in each corridor.*

## Primary sources actually reviewed

- [VERIFIED — Singapore Statutes Online, accessed 2026-11-13] **Payment Services Act 2019, First Schedule.** https://sso.agc.gov.sg/Act/PSA2019?ProvIds=Sc1- . Lists cross-border money transfer, domestic transfer and digital payment token services among activities potentially regulated by the Act. The First Schedule includes deeming provisions for arranging transfers in Singapore.
- [VERIFIED — MAS, accessed 2026-11-13] **Licensing for Payment Service Providers.** https://www.mas.gov.sg/regulation/payments/licensing-for-payment-service-providers . MAS explains licensing requirements for regulated payment services, including standard and major payment institution licences.
- [VERIFIED — MAS, published 2026-10-14] **Enforcement notice on third-party operation under another PSP licence.** https://www.mas.gov.sg/regulation/enforcement/enforcement-actions/2026/mas-revokes-major-payment-institution-license-of-sir-money-changer-pte-ltd-smc . MAS emphasizes that a licensee must not allow a third party to independently operate a regulated payment business under its name and must retain oversight/control.

## Architecture and risk analysis

- [ASSUMPTION — product proposal] **Connect** provides neutral payment-intent and quote orchestration across fiat and stablecoin routes. A licensed partner alone carries out the actual payout, and Clearline does not accept or hold customer funds.
- [VERIFIED — Singapore Statutes Online, accessed 2026-11-13] **Non-custody is not automatically an exemption.** The PS Act covers certain arrangements for domestic/cross-border transfers, and digital payment token service definitions may cover transmission/arrangement activities. Whether Clearline crosses the legal threshold depends on the actual money flows, commercial control, instruction authority and contractual role.
- [ASSUMPTION — requires counsel] A genuinely independent read-only **Control** tool that solely reconciles authorized records may be less likely to itself carry on a regulated payment service than a platform which initiates and routes actual payment instructions. It still has privacy, cybersecurity, outsourcing, AML-related and other obligations to examine.
- [ASSUMPTION — requires counsel] Routing rules, quote selection, who decides which partner is eligible, custody and instruction-signing permissions may change the regulatory analysis. Saying "the partner executes" does not by itself settle whether Clearline facilitates a regulated activity.
- [ASSUMPTION — requires counsel] USDC handling, smart-contract integration and the actual identity of the entity transmitting or arranging DPT transfers will affect the analysis. Base Sepolia in the **fictional demo** is testnet data and is not a regulated payment service in operation.
- [VERIFIED — MAS, published 2026-10-14] MAS has publicly taken action where a third party independently conducted cross-border remittance business under a licensee's name; partnership structures must preserve the licensee's oversight and are not a generic licence rental arrangement.

## Questions for qualified Singapore counsel

1. Do payment intent creation, quote solicitation, route eligibility checks or partner instruction dispatch constitute arranging cross-border transfers or DPT services in the proposed exact structure?
2. If Clearline never receives funds, what roles, exemptions or licensing obligations still apply?
3. Who is the provider of record, merchant/beneficiary contracting party and party with discretionary payout authority?
4. Who performs customer identification, sanctions/AML, Travel Rule assessments (where applicable), transaction monitoring and suspicious-activity reporting?
5. Does the provider retain real supervision, control of accounts/keys, price-setting, execution and complaints/incident handling?
6. What contractual indemnities, data processing, outsourcing, technology-risk and international privacy obligations apply?
7. Does a different fiat corridor, on-chain route or regulated stablecoin treatment change the analysis?
8. What is allowed to be marketed or demonstrated before licensing, onboarding and customer consent?

## Current release constraint

**No actual payment instruction, client financial data, provider key or independent compliance decision is allowed by this preview.** Quotes and payouts are fictional. The next phase requires legal and provider agreement review before a live Connect path.
