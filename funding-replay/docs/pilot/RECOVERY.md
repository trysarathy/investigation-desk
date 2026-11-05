# Pilot desk — backup and recovery

Synthetic / sandbox pilot. Nothing here moves money. The database is one SQLite file (`PILOT_DB`, WAL mode).

## Backup

```sh
PILOT_DB=/data/pilot.db python3 -m pilot.cli backup /backups/pilot-2026-11-18T0900Z.db
```

- Uses the SQLite online backup API (`pilot.ops.backup`): safe while the server is running; WAL content is
  included.
- Runs `PRAGMA integrity_check` on the copy; refuses (and keeps nothing) if the copy is not `ok`.
- Writes the backup and `<dest>.sha256` (`sha256sum` format; check with `sha256sum -c <dest>.sha256`).
- Never overwrites an existing file: give every backup a new, time-stamped name.
- Recommended: before and after each pilot session, and hourly while operating. Copy backups off the host.

## Restore

```sh
# 1. stop the server (no writes may happen during a restore)
# 2.
PILOT_DB=/data/pilot.db python3 -m pilot.cli restore /backups/pilot-2026-11-18T0900Z.db
# 3. start the server; check GET /api/health  -> {"ok": true, "db": "ok", "migrations": N}
```

`pilot.ops.restore` refuses, and changes nothing, if the backup file is missing, its `.sha256` manifest is
missing or does not match, or the file fails `integrity_check`. Otherwise it checkpoints the current database,
moves it (with any `-wal`/`-shm`) aside as `pilot.db.pre-restore-<UTC timestamp>`, and copies the backup in.
The replaced file is kept for inspection; delete it only once the restore has been reviewed.

After a restore run `python3 -m pilot.cli migrate` (forward-only; applies anything newer than the backup).

---

## Operator recovery procedures

### 1. Interrupted or failed CSV import

Imports are **all-or-nothing**: the file is validated completely, and cases are created in one transaction
only when every row is valid. There is never a partial import.

1. If the import showed errors: nothing was created. Fix every listed row (`Row N` is the N-th data row below
   the header, i.e. spreadsheet line N+1; `Header:` lines are about the column names) and import again.
2. If the browser closed, the connection dropped or the server restarted mid-import: re-run **the same file**.
   Each row carries an idempotency key derived from its content, so rows already created are returned, not
   duplicated. Do not edit the file between the two attempts (an edited row is a new row).
3. Check the queue (`All open`) or search by reference to confirm the cases exist exactly once.
4. Rows flagged "duplicate of row M" are the same importer + supplier + payout + deadline + reference: remove
   one or give each a distinct reference.

### 2. Uncertain payout (status unknown / timeout)

An unknown outcome is **not** a failure. The money may already be on its way.

1. **Do not re-instruct.** The desk refuses a second attempt while the first is `unknown`.
2. Use **"Query payout status"** on the case. It asks the provider (sandbox: the simulator) with the **same**
   reference; it never re-submits. Repeat later if still unknown.
3. If still unknown near the deadline: contact provider operations with the case id, payout reference and
   provider reference. Record what they say as a note (and evidence if they send a confirmation), with
   provenance `external_record` only when a document is attached.
4. Record the outcome when confirmed: accepted / credited / failed / returned.
5. Only after the attempt is confirmed **failed** or **returned** can a **reviewer** use "Authorise
   re-instruction"; then an operator instructs a new attempt (new attempt number, new reference).
   Never after `unknown`.
6. Sandbox events can arrive twice or out of order; the desk de-duplicates by provider event id and keeps
   "credited" once seen. You do not need to correct these by hand.

### 3. Failed reconciliation (repayments that do not match)

Nothing is netted, and an unmatched amount never reduces what is owed.

| item | what you see | what to do |
|---|---|---|
| unmatched — wrong currency | repayment in a currency other than the facility's | reviewer: **Return unmatched amount** with reason and return reference. Principal is unchanged. |
| unmatched — excess | more received than owed | reviewer returns the excess (reason + reference) |
| possible duplicate | same bank ref + amount + date as an earlier item | operator **resolve duplicate**: confirm it is a second real payment (then match it) or mark it a duplicate (not counted) |
| wrong match | allocation applied to the wrong item | reviewer **reverse match** with reason; amounts are restored, then match correctly |

Keep the case open (hold) until the identities on the case all show "holds". Close only when credited, nothing
owed and nothing unallocated, unmatched or pending; otherwise a reviewer uses *close with exception* with a
disposition and reason — amounts still owed stay on record.

### 4. Restoring from backup — what is lost and how to re-enter

Everything recorded **after** the backup's time is not in the restored database: events, evidence uploads,
notes, reservations, draws, payout attempts, repayments, user/session changes. Users must log in again.

1. Before restoring, export the history (`Export → JSON`) of every case touched since the backup, if the
   server still runs; or open `pilot.db.pre-restore-<timestamp>` read-only afterwards to see what was there.
2. Restore (above), then `migrate`, then start the server.
3. Re-enter the missing records in their original order, with their original `effective_at` (when it
   happened); `known_at` will be the re-entry time, which is correct — the history then shows it was re-keyed.
   Add the reason "Re-entered after restore from backup <file>".
4. Sandbox payouts: the sandbox tables are restored too. Re-run "Query payout status" with the same reference;
   do not instruct again.
   (With a real provider — not in this pilot — query the provider first: a payment instructed after the backup
   still exists at the provider even though our record of it was lost.)
5. Idempotency keys: a command retried with the same key and body after the restore is executed once (the
   stored response from before the backup is gone, so it runs fresh); CSV imports can be re-run with the same file.
6. Re-upload evidence files; the desk lists them by SHA-256 so you can compare against the export.
7. Review every re-entered case with a second person before acting on it.
