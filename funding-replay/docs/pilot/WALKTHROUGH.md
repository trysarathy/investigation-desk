# Five-minute founder walkthrough: blank invoice → two people → reconciled, then the contrasting decisions

Synthetic workspace; the payout is recorded manually (no money moves). The clock is pinned so dates line up; you
restart the server twice (next day, repayment day), which is also the persistence check.

## Setup (once, ~1 minute) — from `funding-replay/`
```bash
export PILOT_ENV=dev PILOT_DB=/tmp/walkthrough.db PILOT_SECRET=walkthrough
rm -f /tmp/walkthrough.db*; python3 -m pilot.cli migrate
python3 -m pilot.cli create-org --name "Saltmarsh Payments (Synthetic)" --id ORG-SM
PILOT_NEW_PASSWORD=walk-operator-1 python3 -m pilot.cli create-user --org ORG-SM --email ops@saltmarsh.test --name "Priya Nair" --role operator
PILOT_NEW_PASSWORD=walk-reviewer-1 python3 -m pilot.cli create-user --org ORG-SM --email credit@saltmarsh.test --name "Daniel Koh" --role reviewer
python3 -m pilot.cli create-facility --org ORG-SM --id FAC-SM-01 --name "Supplier advance (Synthetic)" --currency SGD \
  --limit 120,000.00 --fee-flat 60.00 --allocation fees_first --funding-cash 80,000.00 --policy-version "POL-SM v1" --required-evidence balance
python3 -m pilot.cli create-facility --org ORG-SM --id FAC-SM-02 --name "Small-ticket advance (Synthetic)" --currency SGD \
  --limit 100,000.00 --fee-flat 45.00 --allocation fees_first --funding-cash 25,000.00 --policy-version "POL-SM2 v1" --required-evidence balance,invoice
PILOT_CLOCK=2026-12-07T01:00:00Z python3 -m pilot.cli serve --port 8765        # Mon 7 Dec 09:00 SGT
```
Use two browser windows (one private) so the two people are really separate sign-ins.

## 1. Operator enters a deal nobody scripted (1 min)
Window 1, sign in `ops@saltmarsh.test` / `walk-operator-1`. Queue is empty. **New case**: importer *Halyard Coffee
Traders Pte Ltd*, supplier *Finca Altamira Exportadora*, payout **12,400.00 USD**, funding **16,800.00 SGD**, quote
Q-0042 from "Provider FX desk", invoice **INV-FA-2026-0042**, zone Asia/Singapore, deadline 10 Dec 17:00, window
8 Dec 10:00–13:00, facility FAC-SM-01, balance 1,250.00 SGD as of 7 Dec 08:30. Watch: the **duplicate check** says
"No matching record in this provider's book."; route **C feasible**; A not (balance too small/unconfirmed); B infeasible
(contract fixes the date). **Request advance** with a reason.

## 2. A different person decides (1 min)
Window 2, sign in `credit@saltmarsh.test` / `walk-reviewer-1`. Case is under **Awaiting review**. Ctrl-C the server and
start it again (same command) — the case, decision record and evidence are all still there. **Approve and reserve
capacity**. Exposure: **Reserved SGD 16,800.00 — drawn SGD 0.00** (a reservation is not a draw).

## 3. Next day: pay the supplier (1 min)
Restart with `PILOT_CLOCK=2026-12-08T01:30:00Z`. Operator: **Record draw** → principal **SGD 16,800.00** + fee **SGD 60.00**.
**Instruct payout** (manual, ref BANK-0042) → supplier *Instructed*. **Record provider acceptance** → *Accepted* (still
not paid). **Record beneficiary credit** → the key screen:
**"Supplier credited; Halyard Coffee Traders Pte Ltd owes the provider SGD 16,860.00, due …"** — supplier panel green,
provider exposure **Outstanding SGD 16,860.00**, next action *Record repayment to provider* (operator).

## 4. Repayment day: reconcile (1 min)
Restart with `PILOT_CLOCK=2026-12-11T02:00:00Z`. **Record customer receipt (importer's account)** 40,000.00 → *not
repayment*, still **SGD 16,860.00**. **Record repayment to provider** 6,000.00 → **Match repayment** → fee **60.00**,
principal **5,940.00**, remaining **SGD 10,860.00**. Repay **10,860.00** → **Match** → exposure **Ended**, no held cash,
Facilities back to **SGD 120,000.00** available. **Close case** → **Export → HTML** (who, role, times, provenance, reason).

## 5. The contrasting decisions (1 min)
Create two more cases on **FAC-SM-02** (policy requires an invoice record; funding cash SGD 25,000.00): one for
**SGD 18,000.00**, one for **SGD 30,000.00**. Both show *Missing evidence — Policy POL-SM2 v1 requires invoice*. On each,
**Add observation → Invoice** with the same supplier invoice details. The 18,000 case becomes **feasible** — the decision
record shows the blocker *cleared*; the reviewer can still **Decline** (a judgment, recorded separately). The 30,000 case
stays red: **"No money — hard constraint: Provider funding cash SGD 25,000.00 is below the SGD 30,000.00 needed"**; next
action refers it to provider treasury. On the first case, **Replay as known at this checkpoint** shows the earlier view,
with no invoice and no actions.
