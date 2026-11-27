#!/usr/bin/env bash
# Local / CI PostgreSQL 16 setup for Clearline Control (fictional data only). Creates the three logins:
#   clearline_owner   — owns the schema, runs migrations and the admin CLI (BYPASSRLS; never used by the web app)
#   clearline_runtime — the web app's login: member of clearline_app, NOBYPASSRLS, owns nothing
#   clearline_jobs    — the job worker's queue login (rc8): NOBYPASSRLS, owns nothing; migration 0029 grants it the
#                       job queue only
#   clearline_provisioning — v1 phase 1.1: the platform console's and the setup wizard's login (DATABASE_PROVISIONING_URL):
#                       NOBYPASSRLS, owns nothing, no table privileges; migration 0049 grants it EXECUTE on the prov_*
#                       functions only. Created only when its password is given (5th argument or
#                       CLEARLINE_PROVISIONING_PASSWORD); otherwise the migration creates it without login.
# PGADMINDB (default postgres) is the database the admin connects to first (a managed cluster may name it differently,
# e.g. defaultdb on DigitalOcean; scripts/ops/db-bootstrap.sh sets it).
# Usage: PGHOST=... PGUSER=<superuser> scripts/db/setup-local.sh <database> <owner-password> <runtime-password> [<jobs-password>] [<provisioning-password>]
#   (the jobs password may instead come from CLEARLINE_JOBS_PASSWORD; it is required either way and never printed)
set -euo pipefail
db="${1:?database}"; ownerpw="${2:?owner password}"; runpw="${3:?runtime password}"
jobspw="${4:-${CLEARLINE_JOBS_PASSWORD:-}}"
provpw="${5:-${CLEARLINE_PROVISIONING_PASSWORD:-}}"
[ -n "${jobspw}" ] || { echo "jobs password: pass it as the 4th argument or set CLEARLINE_JOBS_PASSWORD" >&2; exit 2; }
psql -v ON_ERROR_STOP=1 -q -d "${PGADMINDB:-postgres}" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_owner') THEN CREATE ROLE clearline_owner LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerpw}'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_app') THEN CREATE ROLE clearline_app NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_runtime') THEN CREATE ROLE clearline_runtime LOGIN NOBYPASSRLS PASSWORD '${runpw}' IN ROLE clearline_app; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_jobs') THEN CREATE ROLE clearline_jobs LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${jobspw}';
  ELSIF NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname='clearline_jobs') THEN ALTER ROLE clearline_jobs LOGIN PASSWORD '${jobspw}'; END IF;
END \$\$;
SQL
if [ -n "${provpw}" ]; then
psql -v ON_ERROR_STOP=1 -q -d "${PGADMINDB:-postgres}" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_provisioning') THEN CREATE ROLE clearline_provisioning LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${provpw}';
  ELSIF NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname='clearline_provisioning') THEN ALTER ROLE clearline_provisioning LOGIN PASSWORD '${provpw}'; END IF;
END \$\$;
SQL
fi
psql -q -d "${PGADMINDB:-postgres}" -tc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 || psql -v ON_ERROR_STOP=1 -q -d "${PGADMINDB:-postgres}" -c "CREATE DATABASE \"${db}\" OWNER clearline_owner"
psql -v ON_ERROR_STOP=1 -q -d "${db}" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO clearline_owner; ALTER SCHEMA public OWNER TO clearline_owner;"
echo "database ${db} ready"
