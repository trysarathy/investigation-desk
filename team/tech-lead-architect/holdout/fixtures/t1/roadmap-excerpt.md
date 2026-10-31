# Product roadmap tab (export, 3 Nov 2026 21:10 SGT) - rows with status `next`, in order

| # | Item | Status | Notes from Aashmiin |
|---|---|---|---|
| R1 | Demo test set: 20 test payments against the Xero Demo Company | next | "Exact, partial, over, wrong token, wrong network, look-alike. I want to run all 20 on Day 14 and see each one matched or flagged in plain English." |
| R2 | Post approved entries to Xero demo org, to the cent, dated in the org's timezone | next | "The Demo Company is set to Pacific/Auckland. A payment at 23:30 UTC on 4 Nov must post as 5 Nov." |
| R3 | Exceptions queue: everything unmatched or risky lands in one list | next | "Each row: what happened, why it's flagged, what I can do." |

## Comments on R1 (from the Friday product pass, 31 Oct)
- crypto-finance-user: "It would be a smoother demo if exact matches posted to Xero automatically, no click."
- devops-engineer: "I can add `Require status checks: ci` to the ruleset myself tonight with the admin token so the gate starts merging."
- matching-engine-engineer: "I'd do the 20 fixtures + the match changes + the explanation copy in one PR, it's easier to review together (~900 lines)."
