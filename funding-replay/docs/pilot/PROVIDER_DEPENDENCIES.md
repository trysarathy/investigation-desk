# What still requires a provider or licensed partner

Clearline in this build **records and reconciles**; it does not move money, hold funds or lend. Everything that
would make those things real is outside the product and needs a counterparty:

| Capability | Status in this build | Needs |
|---|---|---|
| Executing supplier payouts | Manual route: operator records the external payment reference + evidence from the provider's own system. Sandbox connector simulates accepted/credited/failed/returned/timeout. | A payment provider's API, credentials, a signed integration agreement, and their event/webhook semantics (see `CONNECTOR.md`). |
| Providing the advance (credit) | Facility limits, fees and policy versions are configuration; "approve and reserve" records a decision. No credit is originated. | The provider's (or a licensed lender/partner's) own credit approval, lending licence or exemption, and facility agreement with the importer. |
| Holding or moving the funding cash | Funding-account cash is a recorded figure used for capacity checks. | The provider's treasury/bank accounts; Clearline never holds funds or keys. |
| Bank-confirmed balances and receipts | Operator-entered or external-record evidence (uploaded file), labelled as such; never shown as bank-confirmed. | Bank statement feeds/APIs (e.g. via the provider's bank) with permission. |
| Regulatory determination | None made. | Legal advice in Singapore (and the supplier's jurisdiction) on payment services, lending and outsourcing; the provider's compliance sign-off. |
| KYC / sanctions screening | Out of scope. | The provider's existing compliance stack. |
| Pilot hosting with real (anonymised) data | Production-style container built and tested locally (pilot mode, persistent volume, restart, backup → restore into a fresh volume); not hosted. | A hosting account in the founder's name (e.g. Fly.io, Singapore region), a data-processing agreement with the provider, and written authorisation to load anonymised data. |
