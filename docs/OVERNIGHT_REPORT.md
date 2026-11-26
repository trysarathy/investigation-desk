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

## 2. Work log (times are SGT, read from the clock)

- Routing: a live merchant (data mode "live") with no provider now goes to the merchant workspace; the Setup page and link
  also work on a hosted deployment whose provisioning login comes from the Neon logins.
- Help: "How to get started" page (Get started, first in the merchant navigation) with the steps and three fictional
  sample files (Kestrelbay Synthetic, entity ENT-SG-SYN; samples/ and public/samples/). The pilot gate serves exactly
  those three paths and still refuses every other path (unit test).
- Upload screen: "Pilot: anonymised or sample files only until your data agreement is signed." "Upload files" buttons on
  Overview and Runs.
- Exports: open exceptions CSV and matched payments CSV (Exceptions page). Same role rule as every export (Finance,
  Approver, Admin), entity scope, formula-safe cells, audited. The Xero/QuickBooks DRAFT journal file and the month-end
  pack already existed (Accounting export, Month-end).
- Function time limit, read from clearline-app's own Vercel settings (the docs site is not reachable from here):
  `functionDefaultTimeout: 300` s, Fluid compute on. Decision: no chunking of "Run reconciliation" tonight. Pilot-size
  files reconcile in seconds, and the matching engine stays untouched (safer). Revisit for large files.
- No Vercel Cron added (not needed for a manual run; not verified free on Hobby from here).

## 3. Findings that change the plan

- A provider-file mapping template must belong to a provider organisation (database rule `mapping_templates_provider_chk`,
  migration 0016). With no provider linked, 5 of 6 merchant journeys pass (reconcile, underpayment and write-off approved
  by a second person, evidence, journals); saving a provider-export template is refused. Decision: keep the rule (no
  loosening). The supported path: a platform operator creates the provider organisation (platform console), and the
  company's Admin links it in Setup → Provider. Then the tested journey applies unchanged.
- Preview deployments: clearline-app has no separate test database, and creating one would be a new resource. Decision:
  no Vercel preview tonight; every journey runs locally on production-mode builds against local PostgreSQL. clearline-app's
  build filter only builds v1/integrated, so this branch deploys nowhere.
