# Overnight report — 27 Nov 2026 (SGT)

Branch: `v1/overnight-import` (from v1/integrated 6ad9605). No Vercel project builds this branch (every project's ignored-build
step allows only main, release/v1, demo/integrated or v1/integrated), so a push here deploys nothing.

## Link checks (read-only)

| Time (SGT) | app.clearlineconnect.org/control/sign-in | demo branch link /control/sign-in |
|---|---|---|
| 03:14 | 200, "Sign in · Clearline Control" | 302 to Vercel login (protected, as expected); branch link → dpl_8RLxH7o1GMKkUTouAPi8KXmqkeEQ |

Production deployments recorded before any work (for rollback): clearline-app `dpl_5Ws3E1bB3JzxTtEuNbkTXMrQMxTn` (6ad9605);
investigation-desk `dpl_GbhsHQyqLkg3GbWGdEXJThsD9Wnf` (b83f38e, untouched). No production deploy is planned tonight (founder's
top-priority instruction).

## 1. What already exists, and why v1 shows "coming in a following change"

- v1 has two Control surfaces. `/control/merchant/*` is the full merchant workspace that the demo's finance@ uses: uploads,
  column mapping, normalise, runs ("Run reconciliation"), exceptions, approvals, write-offs, evidence, month-end pack, ledger
  journal preview, setup wizard, access review. The older `/control/(app)/*` pages (overview, reconciliation, settings) are the
  rc5 read-only pilot pages, where the placeholder "Statement import and matching controls are coming in a following change"
  lives (`src/app/control/(app)/reconciliation/page.tsx:18`).
- `/control` sends a merchant to `/control/merchant` only when it is linked to a payment provider
  (`src/app/control/(app)/page.tsx:15`, `k.kind === "merchant" && k.hasProvider`). The live organisation "Clearline" was
  created by the admin CLI (`create-merchant`) without a provider, so it lands on the read-only pages.
- So the fix is to route (and allow) a merchant without a provider into the merchant workspace, not to rewrite import.
