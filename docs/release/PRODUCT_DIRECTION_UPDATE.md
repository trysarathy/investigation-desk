# Product direction update — proposal for founder approval (13 Nov 2026)

**Status: APPROVED by Aashmiin Kaur on 13 Nov 2026** (in the build session): "Clearline Connect + Clearline Control is
the current direction, with Funding Desk as a specialist funding-exposure workflow." All existing governance, safety,
financial-control and repository restrictions are preserved. Any change to `COMPANY_RULES.md`, `PRODUCT_FACTS.md` or
`AGENTS.md` that reflects this direction needs her separate approval before it is merged into `main`.

## The conflict found in the repository
| Document | What it says Clearline is |
|---|---|
| `company/COMPANY_RULES.md`, `company/PRODUCT_FACTS.md` | Stablecoin payment / invoice matching for finance teams (older direction) |
| `AGENTS.md`, `funding-replay/` on `pilot-operating-desk` | A provider funding desk: decide and follow supplier advances (Nov 2026 direction) |
| Founder build brief, 13 Nov 2026 | **Clearline Connect + Clearline Control**, with the Funding Desk as an integrated specialist workflow |

## Proposed resolution (what this release builds against)
1. The company vision is **Connect (payment orchestration, test mode only) + Control (evidence, reconciliation,
   liquidity, holds, exceptions, funding exposure)** sharing one payment and evidence record.
2. **Control's payment investigation and exception handling** is the first capability to make indispensable
   (recommendation, not a validated market conclusion).
3. The **Funding Desk** stays a specialist workflow. In this release it is linked to payments through an explicit,
   tested projection (`src/lib/clearline`), not a shared production ledger. The authenticated Funding Desk pilot on
   `pilot-operating-desk` is unchanged and separate.
4. All existing rules still apply unchanged: PAUSE, no merging to `main` without founder authorisation, no
   fabricated customers/partners/metrics, no real money or keys, label every claim, human approval for funding and
   compliance decisions, no outbound customer communication.

## Next step
- Items 1–3 above are approved. Updating `COMPANY_RULES.md`, `PRODUCT_FACTS.md` and `AGENTS.md` to match is a separate,
  reviewable change that needs Aashmiin's own approval before merging into `main`; it is not part of this release.
