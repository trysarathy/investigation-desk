# Five-minute walkthrough: blank invoice → two roles → reconciled payment

Synthetic workspace, fictional invoice, sandbox payout. The clock is pinned so the dates line up; you restart the
server twice to move to the next day and to repayment day (this is also the persistence test).

```bash
cd funding-replay
export PILOT_ENV=dev PILOT_DB=/tmp/walkthrough.db PILOT_SECRET=walkthrough
rm -f /tmp/walkthrough.db*; python3 -m pilot.cli migrate && python3 -m pilot.cli seed
PILOT_CLOCK=2026-11-30T01:00:00Z python3 -m pilot.cli serve --port 8765     # Mon 30 Nov 09:00 SGT
```
Open http://127.0.0.1:8765. Watch two panels on the case: **Supplier delivery** and **Provider exposure**.

**1. Operator creates the case (Mon 09:00).** Sign in `operator@harbourline.test` / `pilot-dev-operator`.
The queue is empty. **New case**:
- Importer: Tamarind Freight Holdings Pte Ltd. Supplier: Ostrava Precision s.r.o.
- Payout: 37,820.40 USD. Funding: 51,276.15 SGD, quote Q-TF-1129-03.
- Time zone: Asia/Singapore. Deadline: 4 Dec 2026, 18:00. Original window: 1 Dec 10:00, cutoff 13:00.
- Balance: 9,800.00 SGD as of 30 Nov 08:00, source "Importer bank portal screenshot".
- Expected receipt: 64,500.00 SGD on 8 Dec, payer Brightwater Logistics. Reference INV-OP-2026-1187.

You get a case id (CL-2026-…). Upload any small file under **Evidence**: it shows **External record**; the balance
shows **Operator-entered** (not bank-confirmed). Routes: **A unknown — not "short"** (the balance will be 26 h old at
Tuesday's 10:00 window; limit 24 h: add a newer balance), **B infeasible** (contract fixes the funding date),
**C feasible**. Click **Request advance**, give a reason.
Exposure still **None**. Sign out.

**2. Reviewer approves (a different person).** Sign in `reviewer@harbourline.test` / `pilot-dev-reviewer`. The case
is under **Awaiting review**; its button opens it. Check the evidence, then **Approve and reserve capacity** (the
dialog states the consequence first). Exposure: **Reserved SGD 51,276.15, drawn SGD 0.00**. The operator could not
have done this: the server refuses her (403), and the requester can never approve her own request. Sign out.

**3. Next day (restart).** Ctrl-C, then `PILOT_CLOCK=2026-12-01T01:30:00Z python3 -m pilot.cli serve --port 8765`.
Sign in as the operator: same case id, owner, decision, evidence and reservation. **Record draw** → principal
**SGD 51,276.15**, fee **SGD 150.00** outstanding; reserved back to 0. **Instruct payout** → route *sandbox*,
scenario *timeout_then_accept*. Supplier delivery: **Unknown** — not failed, not paid; *Instruct payout* is refused
("never re-submit"). Click **Query payout status** (same reference) → **Accepted** (still not credited). Click
**Sandbox simulation: deliver next provider event** → **Credited**.

The moment: **"Supplier credited; Tamarind Freight Holdings Pte Ltd owes the provider SGD 51,426.15, due Mon 7 Dec
2026, 17:00 SGT."** Supplier panel green; provider exposure **Outstanding SGD 51,426.15**; next action **Record
repayment to provider** (operator).

**4. Repayment day (restart).** `PILOT_CLOCK=2026-12-07T02:00:00Z python3 -m pilot.cli serve --port 8765`.
- **Record customer receipt (importer's account)** 64,500.00 SGD → listed as *not repayment*; exposure still
  **SGD 51,426.15**.
- **Record repayment to provider** 30,000.00 SGD → *received, not matched*; exposure unchanged. **Match repayment**
  → fees **SGD 150.00**, principal **SGD 29,850.00**; remaining principal **SGD 21,426.15**, fees **SGD 0.00**.
- **Record repayment to provider** 21,426.15 SGD → **Match repayment** → exposure **Ended**. **Facilities**:
  available back to **SGD 500,000.00**.
- **Close case**, then **Export → HTML**: every step with who, role, effective/known time, provenance and reason.

Optional (1 minute): on a second case, **Record payout failure** shows where the money was last evidenced and asks a
reviewer to **Authorize reinstruction**; a repayment in **USD** is held as unmatched, blocks close, and the reviewer
uses **Return unmatched amount** — principal never changes.
