# Product direction update — proposal for founder approval (13 Nov 2026)

**Status: proposed, not yet approved.** Governance documents are not edited by this release; this file records the
conflict and the proposed resolution so Aashmiin can approve or amend it.

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

## What needs Aashmiin's decision
- Approve (or amend) items 1–3 so `COMPANY_RULES.md`, `PRODUCT_FACTS.md` and `AGENTS.md` can be updated in a
  separate, reviewable change.
- Until then, agents should treat this file as the working direction for the customer-trial release only.
