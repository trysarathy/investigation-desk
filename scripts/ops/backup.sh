#!/usr/bin/env bash
# v1 phase 5.7: a nightly logical backup for a self-managed PostgreSQL, and the status file the alert rule
# `backup_failure` reads (CLEARLINE_BACKUP_STATUS_FILE; src/server/ops/monitor.ts). On managed hosting with
# point-in-time recovery this is a SECOND, independent copy (docs/ops/BACKUPS.md), not the primary backup.
#
#   DATABASE_OWNER_URL=... CLEARLINE_BACKUP_DIR=/var/backups/clearline CLEARLINE_BACKUP_STATUS_FILE=/var/lib/clearline/backup-status.json \
#     [CLEARLINE_BACKUP_KEEP=14] scripts/ops/backup.sh
#
# Writes <dir>/clearline-<UTC time>.dump (pg_dump -Fc, mode 0600), checks it with `pg_restore --list`, keeps the newest
# CLEARLINE_BACKUP_KEEP dumps, and records {"lastRunAt","lastStatus","lastSuccessAt"} (lastSuccessAt carried over on
# failure). Prints the file name, size and timing only; never the URL. Encrypt the backup directory at rest (the dump
# holds customer data) and copy it off the host (docs/ops/BACKUPS.md).
set -uo pipefail
: "${DATABASE_OWNER_URL:?set DATABASE_OWNER_URL}" "${CLEARLINE_BACKUP_DIR:?set CLEARLINE_BACKUP_DIR}" "${CLEARLINE_BACKUP_STATUS_FILE:?set CLEARLINE_BACKUP_STATUS_FILE}"
KEEP=${CLEARLINE_BACKUP_KEEP:-14}
umask 077
mkdir -p "$CLEARLINE_BACKUP_DIR" "$(dirname "$CLEARLINE_BACKUP_STATUS_FILE")"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
file="$CLEARLINE_BACKUP_DIR/clearline-$(date -u +%Y%m%dT%H%M%SZ).dump"
prev_success=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("lastSuccessAt") or "")
except Exception: print("")' "$CLEARLINE_BACKUP_STATUS_FILE")
s=$(date +%s%3N)
status=failed
if pg_dump -Fc --dbname="$DATABASE_OWNER_URL" -f "$file" 2>/dev/null && pg_restore --list "$file" >/dev/null 2>&1; then
  status=ok
  ls -1t "$CLEARLINE_BACKUP_DIR"/clearline-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
else
  rm -f "$file"
fi
success=$([ "$status" = ok ] && echo "$started" || echo "$prev_success")
tmp="$CLEARLINE_BACKUP_STATUS_FILE.tmp"
python3 -c 'import json,sys; json.dump({"lastRunAt": sys.argv[1], "lastStatus": sys.argv[2], "lastSuccessAt": sys.argv[3] or None}, open(sys.argv[4], "w"))' "$started" "$status" "$success" "$tmp"
mv "$tmp" "$CLEARLINE_BACKUP_STATUS_FILE"
echo "{\"event\":\"backup_${status}\",\"file\":\"$(basename "$file")\",\"bytes\":$( [ -f "$file" ] && stat -c %s "$file" || echo 0),\"ms\":$(( $(date +%s%3N) - s ))}"
[ "$status" = ok ]
