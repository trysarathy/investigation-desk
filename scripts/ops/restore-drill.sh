#!/usr/bin/env bash
# v1 phase 5.7: backup and restore drill, LOCAL ONLY, fictional data only. Never point it at a real database.
#
#   A. seed a source database (fictional provider and merchants, one reconciliation run per entity)
#   B. logical backup:  pg_dump -Fc of the source
#   C. a fresh private cluster (initdb, data checksums, WAL archiving on), roles from scripts/db/setup-local.sh,
#      pg_restore into it; compare row counts + checksums of EVERY table, the migration journal and RLS flags
#   D. point-in-time recovery: pg_basebackup of the restored cluster, marker rows before and after a target time,
#      recover a copy to that time from the WAL archive; check that only the earlier marker is there and the data
#      still matches the source
#   E. the app against the recovered cluster: one job-worker pass (jobs login), `next start` (runtime login),
#      /api/health and /api/ready must both answer 200
#   F. tear everything down (private cluster stopped and removed, source database dropped)
# Timings and results are written between the markers in docs/ops/RESTORE_DRILL.md (counts and checksums only).
#
# Usage (as root, with a local PostgreSQL 16 superuser reachable as PGHOST/PGPORT/PGUSER for the source):
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/ops/restore-drill.sh
# Settings (env): DRILL_SRC_DB (clearline_xe4_drill_src) DRILL_PORT (4454) DRILL_APP_PORT (4422) DRILL_DIR
#   (/home/user/xe4-drill) DRILL_PG_BIN (/usr/lib/postgresql/16/bin) DRILL_RECORD (1: update the doc; 0: print only)
# `next start` needs a production build (`npx next build`); without .next/BUILD_ID the app step uses `next dev`.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
SRC_DB=${DRILL_SRC_DB:-clearline_xe4_drill_src}
PORT=${DRILL_PORT:-4454}
APP_PORT=${DRILL_APP_PORT:-4422}
DIR=${DRILL_DIR:-/home/user/xe4-drill}
BIN=${DRILL_PG_BIN:-/usr/lib/postgresql/16/bin}
RECORD=${DRILL_RECORD:-1}
DB=clearline_drill
OWNER_PW=drill-owner-pw RUN_PW=drill-runtime-pw JOBS_PW=drill-jobs-pw PROV_PW=drill-provisioning-pw # throwaway, local-only, fictional
SRC_HOST=${PGHOST:-/tmp} SRC_PORT=${PGPORT:-54329}
as_pg() { su postgres -s /bin/bash -c "$*"; }
now_ms() { date +%s%3N; }
declare -A T
step() { local name=$1; shift; local s; s=$(now_ms); "$@"; T[$name]=$(( $(now_ms) - s )); echo "drill: ${name} ${T[$name]} ms"; }
APP_PID=""
# the app runs in its own process group (setsid) so the whole npx -> next-server tree stops together
stop_app() { kill -- "-$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true; for _ in $(seq 1 20); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done; APP_PID=""; }
cleanup() {
  [ -n "$APP_PID" ] && stop_app || true
  as_pg "$BIN/pg_ctl -D $DIR/pgdata -m immediate stop" >/dev/null 2>&1 || true
  as_pg "$BIN/pg_ctl -D $DIR/pitr -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DIR"
  PGHOST=$SRC_HOST PGPORT=$SRC_PORT psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$SRC_DB\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

src_owner="postgres://clearline_owner:devowner_pw@127.0.0.1:${SRC_PORT}/${SRC_DB}"
src_runtime="postgres://clearline_runtime:devruntime_pw@127.0.0.1:${SRC_PORT}/${SRC_DB}"
dst_owner="postgres://clearline_owner:${OWNER_PW}@127.0.0.1:${PORT}/${DB}"
dst_runtime="postgres://clearline_runtime:${RUN_PW}@127.0.0.1:${PORT}/${DB}"
dst_jobs="postgres://clearline_jobs:${JOBS_PW}@127.0.0.1:${PORT}/${DB}"
tsx() { npx tsx --conditions=react-server "$@"; }

rm -rf "$DIR"; mkdir -p "$DIR"/wal "$DIR"/out; chown -R postgres:postgres "$DIR"; chmod 700 "$DIR"

# ---- A. source -----------------------------------------------------------------------------------------------------
seed_source() {
  PGHOST=$SRC_HOST PGPORT=$SRC_PORT psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$SRC_DB\"" >/dev/null
  PGHOST=$SRC_HOST PGPORT=$SRC_PORT bash scripts/db/setup-local.sh "$SRC_DB" devowner_pw devruntime_pw devjobs_pw >/dev/null
  DATABASE_OWNER_URL=$src_owner DATABASE_URL=$src_runtime tsx scripts/ops/drill.ts seed
  DATABASE_OWNER_URL=$src_owner tsx scripts/ops/drill.ts fingerprint > "$DIR/out/source.json"
}
step seed seed_source

# ---- B. logical backup ---------------------------------------------------------------------------------------------
dump() { PGHOST=$SRC_HOST PGPORT=$SRC_PORT "$BIN/pg_dump" -Fc -d "$SRC_DB" -f "$DIR/out/source.dump"; }
step dump dump
DUMP_BYTES=$(stat -c %s "$DIR/out/source.dump")

# ---- C. fresh cluster + restore ------------------------------------------------------------------------------------
new_cluster() {
  as_pg "$BIN/initdb -D $DIR/pgdata --data-checksums --auth-local=trust --auth-host=scram-sha-256 -U postgres >/dev/null"
  cat >> "$DIR/pgdata/postgresql.conf" <<EOF
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$DIR'
wal_level = replica
archive_mode = on
archive_command = 'test ! -f $DIR/wal/%f && cp %p $DIR/wal/%f'
archive_timeout = 60
EOF
  as_pg "$BIN/pg_ctl -D $DIR/pgdata -l $DIR/pgdata.log -w start >/dev/null"
}
step initdb new_cluster
restore() {
  PGHOST=$DIR PGPORT=$PORT PGUSER=postgres bash scripts/db/setup-local.sh "$DB" "$OWNER_PW" "$RUN_PW" "$JOBS_PW" "$PROV_PW" >/dev/null
  PGHOST=$DIR PGPORT=$PORT "$BIN/pg_restore" -U postgres --exit-on-error -d "$DB" "$DIR/out/source.dump"
}
step restore restore
verify_restore() {
  DATABASE_OWNER_URL=$dst_owner tsx scripts/ops/drill.ts fingerprint > "$DIR/out/restored.json"
  tsx scripts/ops/drill.ts compare "$DIR/out/source.json" "$DIR/out/restored.json" | tee "$DIR/out/compare-restore.json"
}
step verify_restore verify_restore

# ---- D. point-in-time recovery -------------------------------------------------------------------------------------
psql_dst() { PGHOST=$DIR PGPORT=$PORT psql -U postgres -d "$DB" -qtAX -v ON_ERROR_STOP=1 "$@"; }
basebackup() { as_pg "$BIN/pg_basebackup -h $DIR -p $PORT -U postgres -D $DIR/base -X stream -c fast"; }
step basebackup basebackup
psql_dst -c "CREATE TABLE drill_pitr_marker (n int PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp())" -c "INSERT INTO drill_pitr_marker (n) VALUES (1)"
sleep 1
TARGET=$(psql_dst -c "SELECT clock_timestamp()")
sleep 1
psql_dst -c "INSERT INTO drill_pitr_marker (n) VALUES (2)" -c "SELECT pg_switch_wal()" >/dev/null
sleep 2 # let the archiver copy the switched segment
pitr() {
  as_pg "$BIN/pg_ctl -D $DIR/pgdata -m fast -w stop >/dev/null"
  as_pg "cp -a $DIR/base $DIR/pitr && touch $DIR/pitr/recovery.signal"
  as_pg "cat >> $DIR/pitr/postgresql.conf" <<EOF
archive_mode = off
restore_command = 'cp $DIR/wal/%f %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
EOF
  as_pg "$BIN/pg_ctl -D $DIR/pitr -l $DIR/pitr.log -w -t 120 start >/dev/null"
  for _ in $(seq 1 60); do [ "$(psql_dst -c 'SELECT pg_is_in_recovery()')" = "f" ] && break; sleep 1; done
}
step pitr pitr
MARKERS=$(psql_dst -c "SELECT string_agg(n::text, ',' ORDER BY n) FROM drill_pitr_marker")
[ "$MARKERS" = "1" ] || { echo "drill: PITR FAILED: markers after recovery are '$MARKERS', expected '1'"; exit 1; }
psql_dst -c "DROP TABLE drill_pitr_marker"
verify_pitr() {
  DATABASE_OWNER_URL=$dst_owner tsx scripts/ops/drill.ts fingerprint > "$DIR/out/pitr.json"
  tsx scripts/ops/drill.ts compare "$DIR/out/source.json" "$DIR/out/pitr.json" | tee "$DIR/out/compare-pitr.json"
}
step verify_pitr verify_pitr

# ---- E. the app against the recovered cluster ----------------------------------------------------------------------
worker_pass() { CLEARLINE_DEPLOY_ENV=local CLEARLINE_ALERTS=0 DATABASE_URL=$dst_runtime DATABASE_JOBS_URL=$dst_jobs DATABASE_OWNER_URL="" tsx scripts/jobs/worker.ts --once > "$DIR/out/worker.log"; }
step worker worker_pass
app_up() {
  local mode=start; [ -f .next/BUILD_ID ] || mode=dev
  APP_MODE=$mode
  CLEARLINE_DEPLOY_ENV=local DATABASE_URL=$dst_runtime BETTER_AUTH_SECRET=drill-only-secret-not-for-deployment-0123456789 \
    CLEARLINE_ORIGIN=http://127.0.0.1:$APP_PORT NEXT_TELEMETRY_DISABLED=1 \
    setsid npx next "$mode" -H 127.0.0.1 -p "$APP_PORT" > "$DIR/out/app.log" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 240); do curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null && return 0; sleep 0.5; done
  echo "drill: app did not answer /api/health"; tail -20 "$DIR/out/app.log"; exit 1
}
step app_start app_up
HEALTH=$(curl -sS -w ' %{http_code}' "http://127.0.0.1:$APP_PORT/api/health")
READY=$(curl -sS -w ' %{http_code}' "http://127.0.0.1:$APP_PORT/api/ready")
echo "drill: health $HEALTH"; echo "drill: ready $READY"
stop_app
curl -s -o /dev/null -m 2 "http://127.0.0.1:$APP_PORT/api/health" && { echo "drill: the app did not stop"; exit 1; }
[ "${HEALTH##* }" = 200 ] && [ "${READY##* }" = 200 ] || { echo "drill: app check FAILED"; exit 1; }

# ---- results -------------------------------------------------------------------------------------------------------
C1=$(cat "$DIR/out/compare-restore.json"); C2=$(cat "$DIR/out/compare-pitr.json")
TOTAL=0; for k in seed dump initdb restore verify_restore basebackup pitr verify_pitr worker app_start; do TOTAL=$((TOTAL + T[$k])); done
RESULT=$(cat <<EOF
<!-- drill-results:start -->
**Last run:** $(date -u +"%Y-%m-%d %H:%M UTC") on $(uname -sr), PostgreSQL $("$BIN/postgres" --version | awk '{print $3}'), commit \`$(git rev-parse --short HEAD)\`. [VERIFIED: produced by \`scripts/ops/restore-drill.sh\`; fictional data only]

| Step | Time |
|---|---|
| A. seed the source database (migrate + fictional merchants + one run per entity) | ${T[seed]} ms |
| B. \`pg_dump -Fc\` (${DUMP_BYTES} bytes) | ${T[dump]} ms |
| C1. \`initdb\` a fresh private cluster (port ${PORT}, data checksums, WAL archiving) and start it | ${T[initdb]} ms |
| C2. roles (\`setup-local.sh\`) + \`pg_restore\` | ${T[restore]} ms |
| C3. fingerprint and compare every table | ${T[verify_restore]} ms |
| D1. \`pg_basebackup\` of the restored cluster | ${T[basebackup]} ms |
| D2. stop, recover a copy to the target time from the WAL archive, promote | ${T[pitr]} ms |
| D3. fingerprint and compare again | ${T[verify_pitr]} ms |
| E1. one job-worker pass on the recovered cluster (jobs login; writes the heartbeat) | ${T[worker]} ms |
| E2. \`next ${APP_MODE}\` until \`/api/health\` answers | ${T[app_start]} ms |
| **Total (excluding teardown)** | **${TOTAL} ms** |

- Logical restore vs source: \`${C1}\`
- Point-in-time recovery vs source: \`${C2}\`; marker rows after recovery: \`${MARKERS}\` (expected \`1\`: the row written after the target time is absent)
- \`/api/health\`: \`${HEALTH}\` · \`/api/ready\`: \`${READY}\`
- Teardown: private cluster stopped and its directory removed; source database dropped.
<!-- drill-results:end -->
EOF
)
echo "$RESULT"
if [ "$RECORD" = 1 ]; then
  RESULT="$RESULT" python3 - "$ROOT/docs/ops/RESTORE_DRILL.md" <<'PY'
import os, re, sys
p = sys.argv[1]; s = open(p).read()
s2 = re.sub(r"<!-- drill-results:start -->.*?<!-- drill-results:end -->", lambda m: os.environ["RESULT"], s, flags=re.S)
assert s2 != s or os.environ["RESULT"] in s, "markers not found"
open(p, "w").write(s2)
PY
  echo "drill: results written to docs/ops/RESTORE_DRILL.md"
fi
