# Pilot data policy (draft for the founder and the provider to agree before any real data)

**Default: synthetic only.** No real borrower, importer or supplier data is loaded into any Clearline environment
until the founder gives written authorisation for a named provider trial and a data-processing agreement is signed.
Development, tests and screenshots never use real data.

| Topic | Rule in this build |
|---|---|
| Permitted data | Case facts an operator already holds for a payment the provider agreed to support: party names, invoice and customer references, amounts and currencies, deadlines, the evidence they relied on (redacted where possible), approvals, payout references, repayment references. **Not permitted:** bank credentials, private keys, card data, national ID numbers, account numbers beyond the last 4 digits, personal data not needed for the case. |
| Purpose | Recording and reconciling the provider's own funding decisions and exposure for the pilot; producing the provider's own case history and pilot report. No other use, no model training, no sharing with other customers. |
| Separation | One organisation per provider; every query is org-scoped server-side (tested by direct URL, search, evidence download, export and every command). The public mentor demo is a separate static site with synthetic data and shares no database, cookies, keys or storage with the pilot. |
| Location | A single container with its database file on a volume in the region the provider chooses (proposed: Singapore). Backups stay in the same jurisdiction. |
| Access | Named users created by the privileged CLI only; roles operator / reviewer / viewer; no shared accounts; sessions expire after 12 h idle; disabling a user revokes their sessions immediately. |
| Logs | Server logs carry case ids, event types and outcomes only — never party names, amounts, evidence content, passwords or tokens. |
| Retention | Pilot term + 30 days, then export to the provider and delete. The provider may request earlier deletion at any time. |
| Deletion | Stop the server, export each case history (`/api/cases/{id}/export`), hand the exports and a final backup to the provider, then destroy the volume and all backups; record the deletion date in the pilot log. Events are append-only inside the product, so deletion is of the whole database, not of individual rows. |
| Restoration | `python3 -m pilot.cli restore <backup>` refuses corrupt or mismatched files and keeps the replaced database; restoring brings back exactly the records as of the backup (see `RECOVERY.md`). |
| Incidents | Any suspected exposure: stop the server, preserve the volume, tell the provider the same day. |
