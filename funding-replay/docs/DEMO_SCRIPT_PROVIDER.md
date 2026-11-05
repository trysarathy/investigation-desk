# 90-second mentor demo — provider funding desk

**Everything is simulated.** Northwind Foods SG and Harbor Provisions are fictional. FAC-NW-01 is a simulated
facility, not a credit line. No provider has agreed to fund anything, no credit was approved and no money
moves. The "Reviewer" and "Operator" switches are simulated roles, not log-ins.

Open https://clearline-funding-desk.vercel.app (or the local build's `index.html`). Case: **Reference week (with Thursday surprise)**.
Click **Reset** first.

The one line to land: **"The supplier has its money. The provider is still owed money."**

| Time | Click | What should change on screen |
|---|---|---|
| 0:00 | (nothing) | Header: **Fri 13 Nov 2026, 15:00 SGT**. Headline: "Decision needed: how does Harbor Provisions get paid by Wed 18 Nov?" Three routes side by side: A importer funds Friday, B importer funds later without an advance, C provider advance under a simulated facility. Nothing reserved, no exposure. |
| 0:10 | **Request advance** | Headline "Advance requested — awaiting reviewer approval". Still nothing reserved. |
| 0:15 | Switch to **Reviewer (Simulated role)** → read the consequence text → **Reserve capacity** | Reserved **SGD 135,382.50**; company available drops from SGD 300,000.00 to **SGD 164,617.50**. Principal outstanding stays **SGD 0.00**: reserving draws no cash and pays no one. |
| 0:25 | **Record simulated draw** → **Instruct payout** → **Provider accepts payout** | Principal outstanding **SGD 135,382.50**, fee SGD 150.00. Delivery moves instructed → accepted. Headline says supplier credit is *not yet evidenced*: acceptance is not credit. |
| 0:35 | **Record beneficiary credit** | **The Wednesday moment.** Clock **Wed 18 Nov**. Headline: **"Supplier credited; importer repayment outstanding."** Delivery side: complete. Exposure side: **Outstanding SGD 135,532.50** (principal 135,382.50 + fees 150.00), the provider (FAC-NW-01) is owed by Northwind, due Fri 20 Nov 17:00 SGT, next action "Collect and match…". Say the line. |
| 0:50 | **Advance to Wed 23:00**, then **Advance to Thu 19 Nov 10:00** | The clock moves; every amount stays the same. Time passing creates no money. |
| 0:55 | **Record customer receipt (importer's account)** | The SGD 140,000 receipt appears as a *customer receipt, not repayment*. Exposure is still **SGD 135,532.50**. |
| 1:05 | **Importer pays provider SGD 100,000.00** → **Match repayment** | Before matching it shows as received but not matched, and exposure is unchanged. After matching: fees SGD 0.00 (paid first), principal **SGD 35,532.50** remaining. |
| 1:15 | **Importer pays provider SGD 35,532.50 (balance)** → **Match repayment** → **Close case** | Exposure **Ended**. Capacity back to SGD 300,000.00. Case closed. |
| 1:25 | **Reset** → **Request advance** → Reviewer → **Decline** | "Advance declined — nothing reserved". No reservation, no draw, no exposure ("No advance drawn"). The importer funds at Friday's window or the payout doesn't go ahead. |

Optional if asked (case picker): **Stale importer balance**: "We need a newer bank balance before reviewing
this advance". **Fixed contractual funding date**: "Later funding unavailable". **Credit headroom, no deployable
cash**: authorised to lend is not the same as cash available. **Competing payout reservation**: the same cash
can't be reserved twice. **Returned supplier payout**: shows where the money is, who owns it and the next
action, with no automatic second payment. **Every route infeasible**: says so and compares no costs.

Then stop and ask one of the advisor questions in `docs/FOUNDER_NOTE_PROVIDER.md`. Don't say "approved
credit", "we fund" or "savings".
