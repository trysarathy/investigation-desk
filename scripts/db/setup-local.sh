#!/usr/bin/env bash
# Local / CI PostgreSQL 16 setup for Clearline Control (fictional data only). Creates the two logins:
#   clearline_owner   — owns the schema, runs migrations and the admin CLI (BYPASSRLS; never used by the web app)
#   clearline_runtime — the web app's login: member of clearline_app, NOBYPASSRLS, owns nothing
# Usage: PGHOST=... PGUSER=<superuser> scripts/db/setup-local.sh <database> <owner-password> <runtime-password>
set -euo pipefail
db="${1:?database}"; ownerpw="${2:?owner password}"; runpw="${3:?runtime password}"
psql -v ON_ERROR_STOP=1 -q -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_owner') THEN CREATE ROLE clearline_owner LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerpw}'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_app') THEN CREATE ROLE clearline_app NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clearline_runtime') THEN CREATE ROLE clearline_runtime LOGIN NOBYPASSRLS PASSWORD '${runpw}' IN ROLE clearline_app; END IF;
END \$\$;
SQL
psql -q -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 || psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE \"${db}\" OWNER clearline_owner"
psql -v ON_ERROR_STOP=1 -q -d "${db}" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO clearline_owner; ALTER SCHEMA public OWNER TO clearline_owner;"
echo "database ${db} ready"
