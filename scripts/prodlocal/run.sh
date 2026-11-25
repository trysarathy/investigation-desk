#!/usr/bin/env bash
# Production-like local run of Clearline WITHOUT Docker: the same topology as docker-compose.prod-local.yml and the
# hosting proposal (docs/ops/HOSTING_PROPOSAL.md), as local processes. See docs/ops/PROD_LOCAL.md.
#
#   scripts/prodlocal/run.sh up       private PostgreSQL 16 cluster, roles, migrations, a PLAIN production `next build`
#                                     (+ the demo/recorded-chain absence checks), the S3 stand-in, `next start`
#                                     (NODE_ENV=production, CLEARLINE_DEPLOY_ENV=local) and the job worker
#   scripts/prodlocal/run.sh down     stop the app, the worker, the stand-in and the cluster (state is kept)
#   scripts/prodlocal/run.sh status   what is running
#   scripts/prodlocal/run.sh env      print the NAMES of the variables the app gets (never values)
#   scripts/prodlocal/run.sh destroy  down, then delete .prodlocal/ (database, uploads, generated secrets)
#
# Everything lives in .prodlocal/ (git-ignored): the cluster, generated secrets (mode 600, never printed), stored
# objects (ciphertext only), logs and pids. Ports (override with PRODLOCAL_*_PORT): app 4440, PostgreSQL 4441,
# object storage stand-in 4443. Binds 127.0.0.1 only. Fictional data only; nothing here is a deployment secret.
# SKIP_BUILD=1 reuses an existing .next build (it must be a plain build: the checks below run either way).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
STATE="${PRODLOCAL_DIR:-$ROOT/.prodlocal}"
APP_PORT="${PRODLOCAL_APP_PORT:-4440}"
PG_PORT="${PRODLOCAL_PG_PORT:-4441}"
S3_PORT="${PRODLOCAL_S3_PORT:-4443}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DB=clearline_prodlocal
SECRETS="$STATE/secrets.env"
log() { printf '[prodlocal] %s\n' "$*"; }

# PostgreSQL refuses to run as root: run the cluster as the postgres user when we are root.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

secrets() {
  mkdir -p "$STATE"; chmod 700 "$STATE"
  if [ ! -f "$SECRETS" ]; then
    umask 077
    r() { openssl rand -hex 24; }
    {
      echo "PG_SUPER_PW=$(r)"; echo "OWNER_PW=$(r)"; echo "RUNTIME_PW=$(r)"; echo "JOBS_PW=$(r)"; echo "PROV_PW=$(r)"
      echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
      echo "CLEARLINE_UPLOAD_KEY=$(openssl rand -base64 32)"
      echo "S3_KEY_ID=prodlocal-$(openssl rand -hex 6)"; echo "S3_SECRET=$(r)"
    } > "$SECRETS"
    log "generated local-only secrets in .prodlocal/secrets.env (mode 600; never printed)"
  fi
  # shellcheck disable=SC1090
  set -a; . "$SECRETS"; set +a
}

app_env() {
  local base="postgres://%s:%s@127.0.0.1:$PG_PORT/$DB"
  export DATABASE_URL; DATABASE_URL="$(printf "$base" clearline_runtime "$RUNTIME_PW")"
  export DATABASE_OWNER_URL; DATABASE_OWNER_URL="$(printf "$base" clearline_owner "$OWNER_PW")"
  export DATABASE_JOBS_URL; DATABASE_JOBS_URL="$(printf "$base" clearline_jobs "$JOBS_PW")"
  export DATABASE_PROVISIONING_URL; DATABASE_PROVISIONING_URL="$(printf "$base" clearline_provisioning "$PROV_PW")"
  export CLEARLINE_CONTROL_PILOT=1 CLEARLINE_ORIGIN="http://127.0.0.1:$APP_PORT" CLEARLINE_DEPLOY_ENV=local
  export BETTER_AUTH_SECRET CLEARLINE_UPLOAD_KEY NEXT_TELEMETRY_DISABLED=1
  export CLEARLINE_UPLOAD_STORE=s3 CLEARLINE_S3_ENDPOINT="http://127.0.0.1:$S3_PORT" CLEARLINE_S3_BUCKET=clearline-uploads-prodlocal \
         CLEARLINE_S3_REGION=sgp1 CLEARLINE_S3_ACCESS_KEY_ID="$S3_KEY_ID" CLEARLINE_S3_SECRET_ACCESS_KEY="$S3_SECRET" \
         CLEARLINE_S3_STANDIN_DIR="$STATE/objects"
  # e-mail: the local outbox stand-in (one JSON file per message); no real provider is ever called
  export CLEARLINE_EMAIL_OUTBOX_DIR="$STATE/outbox"
  # never a demo, test or recorded-chain switch in a production-like run
  unset CLEARLINE_DEMO_BUILD CLEARLINE_TEST_BUILD CLEARLINE_CHAIN_RECORDING CLEARLINE_CHAIN_LIVE DEMO_MODE || true
}

pg_up() {
  local data="$STATE/pg"
  mkdir -p "$STATE/run"
  if [ "$(id -u)" = 0 ]; then chown postgres "$STATE" "$STATE/run"; fi
  if [ ! -f "$data/PG_VERSION" ]; then
    log "initdb (PostgreSQL 16, private cluster, scram-sha-256)"
    local pwfile="$STATE/run/pgpw"; (umask 077; printf '%s\n' "$PG_SUPER_PW" > "$pwfile")
    [ "$(id -u)" = 0 ] && chown postgres "$pwfile"
    as_pg "$PGBIN/initdb" -D "$data" -U postgres --pwfile="$pwfile" --auth=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
    rm -f "$pwfile"
  fi
  if ! as_pg "$PGBIN/pg_ctl" -D "$data" status >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl" -D "$data" -l "$STATE/run/pg.log" -w -o "-p $PG_PORT -k $STATE/run -c listen_addresses=127.0.0.1" start >/dev/null
    log "PostgreSQL 16 on 127.0.0.1:$PG_PORT"
  fi
  export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres PGPASSWORD="$PG_SUPER_PW"
  scripts/db/setup-local.sh "$DB" "$OWNER_PW" "$RUNTIME_PW" "$JOBS_PW" "$PROV_PW" >/dev/null
  unset PGPASSWORD
}

migrate() {
  log "migrations (owner login)"
  DATABASE_OWNER_URL="$DATABASE_OWNER_URL" npx drizzle-kit migrate >"$STATE/run/migrate.log" 2>&1 || { tail -20 "$STATE/run/migrate.log" >&2; exit 1; }
}

build() {
  if [ "${SKIP_BUILD:-}" != 1 ] || [ ! -f .next/BUILD_ID ]; then
    log "plain production build (next build; no demo, test or recorded-chain switch)"
    npx next build >"$STATE/run/build.log" 2>&1 || { tail -40 "$STATE/run/build.log" >&2; exit 1; }
  fi
  node scripts/build/check-chain-recording.mjs --expect absent >/dev/null
  node scripts/build/check-chain-recording.mjs --marker demo --expect absent >/dev/null
  log "build checks: recorded-chain path absent, demo markers absent"
}

start_bg() { # name, command...
  local name="$1"; shift
  if [ -f "$STATE/run/$name.pid" ] && kill -0 "$(cat "$STATE/run/$name.pid")" 2>/dev/null; then return; fi
  setsid nohup "$@" >"$STATE/run/$name.log" 2>&1 < /dev/null &
  echo $! > "$STATE/run/$name.pid"
}

wait_http() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  return 1
}

up() {
  command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
  secrets; app_env; pg_up; migrate; build
  start_bg s3 npx tsx scripts/prodlocal/s3-standin.ts
  start_bg app npx next start -H 127.0.0.1 -p "$APP_PORT"
  start_bg worker npx tsx --conditions=react-server scripts/jobs/worker.ts --interval-seconds 60
  wait_http "http://127.0.0.1:$APP_PORT/control/sign-in" 120 || { tail -30 "$STATE/run/app.log" >&2; exit 1; }
  log "app      http://127.0.0.1:$APP_PORT/control/sign-in (NODE_ENV=production, CLEARLINE_DEPLOY_ENV=local)"
  log "worker   pid $(cat "$STATE/run/worker.pid") (jobs login)"
  log "storage  S3 stand-in on 127.0.0.1:$S3_PORT (objects in .prodlocal/objects, ciphertext only)"
  log "smoke:   scripts/deploy/smoke.sh http://127.0.0.1:$APP_PORT"
}

stop_pid() { local f="$STATE/run/$1.pid"; [ -f "$f" ] || return 0; local p; p="$(cat "$f")"; if kill -0 "$p" 2>/dev/null; then kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; fi; rm -f "$f"; }

down() {
  for n in app worker s3; do stop_pid "$n"; done
  if [ -f "$STATE/pg/PG_VERSION" ]; then as_pg "$PGBIN/pg_ctl" -D "$STATE/pg" -m fast stop >/dev/null 2>&1 || true; fi
  log "stopped (state kept in .prodlocal/)"
}

status() {
  for n in app worker s3; do
    if [ -f "$STATE/run/$n.pid" ] && kill -0 "$(cat "$STATE/run/$n.pid")" 2>/dev/null; then echo "$n: running (pid $(cat "$STATE/run/$n.pid"))"; else echo "$n: stopped"; fi
  done
  if [ -f "$STATE/pg/PG_VERSION" ] && as_pg "$PGBIN/pg_ctl" -D "$STATE/pg" status >/dev/null 2>&1; then echo "postgres: running (port $PG_PORT)"; else echo "postgres: stopped"; fi
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  env) secrets; app_env; env | cut -d= -f1 | grep -E '^(DATABASE_|CLEARLINE_|BETTER_AUTH|NEXT_TELEMETRY)' | sort ;;
  destroy) down; rm -rf "$STATE"; log "deleted .prodlocal/" ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
