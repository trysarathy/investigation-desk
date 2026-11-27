#!/usr/bin/env bash
# v1 phase 6: first-time setup of a MANAGED PostgreSQL 16 cluster (staging or production) for Clearline. Run by the
# founder from a trusted machine after the cluster exists (docs/ops/HOSTING_PROPOSAL.md, "Provisioning"). Never in CI.
#
#   PGHOST=<cluster host> PGPORT=25060 PGUSER=doadmin PGADMINDB=defaultdb PGSSLMODE=verify-full PGSSLROOTCERT=<ca.pem> \
#     scripts/ops/db-bootstrap.sh clearline
#
# The admin password comes from PGPASSWORD (read it with `read -rs PGPASSWORD; export PGPASSWORD`); the four login
# passwords from CLEARLINE_OWNER_PASSWORD, CLEARLINE_RUNTIME_PASSWORD, CLEARLINE_JOBS_PASSWORD and
# CLEARLINE_PROVISIONING_PASSWORD (from your password manager; never arguments, never printed).
#
# Preflight (stops before changing anything): PostgreSQL 16; TLS in use; the admin login can create roles AND has
# BYPASSRLS. The owner login must be BYPASSRLS (migrations FORCE row-level security and the owner runs them and the admin
# CLI); since PostgreSQL 16 only a role that has BYPASSRLS may grant it. If the platform's admin lacks it, this script
# refuses: the security model is never weakened to fit a host. Then scripts/db/setup-local.sh creates the logins and
# the database exactly as locally and in CI.
set -euo pipefail
db="${1:?database name, e.g. clearline}"
for v in PGHOST PGUSER PGPASSWORD CLEARLINE_OWNER_PASSWORD CLEARLINE_RUNTIME_PASSWORD CLEARLINE_JOBS_PASSWORD CLEARLINE_PROVISIONING_PASSWORD; do
  [ -n "${!v:-}" ] || { echo "db-bootstrap: set $v" >&2; exit 2; }
done
case "${PGSSLMODE:-}" in verify-full|verify-ca|require) ;; *) echo "db-bootstrap: set PGSSLMODE=verify-full (and PGSSLROOTCERT to the cluster's CA certificate)" >&2; exit 2 ;; esac
admindb="${PGADMINDB:-postgres}"
q() { psql -X -v ON_ERROR_STOP=1 -At -d "$admindb" -c "$1"; }

ver="$(q "show server_version_num")"
[ "${ver:0:2}" = 16 ] || { echo "db-bootstrap: the cluster runs PostgreSQL ${ver}; Clearline needs 16" >&2; exit 3; }
[ "$(q "select ssl from pg_stat_ssl where pid = pg_backend_pid()")" = t ] || { echo "db-bootstrap: the connection is not TLS" >&2; exit 3; }
attrs="$(q "select rolcreaterole::text || ',' || rolbypassrls::text from pg_roles where rolname = current_user")"
if [ "$attrs" != "true,true" ]; then
  echo "db-bootstrap: REFUSED. The admin login ($(q 'select current_user')) has createrole,bypassrls = ${attrs}." >&2
  echo "  Clearline's owner login must be BYPASSRLS and only a BYPASSRLS role can create it (PostgreSQL 16)." >&2
  echo "  Nothing was changed. Ask the host's support, or choose the fallback in docs/ops/HOSTING_PROPOSAL.md." >&2
  exit 4
fi
echo "db-bootstrap: preflight passed (PostgreSQL 16, TLS, admin can create roles and has BYPASSRLS)"
PGADMINDB="$admindb" "$(dirname "$0")/../db/setup-local.sh" "$db" "$CLEARLINE_OWNER_PASSWORD" "$CLEARLINE_RUNTIME_PASSWORD" "$CLEARLINE_JOBS_PASSWORD" "$CLEARLINE_PROVISIONING_PASSWORD"
# the runtime, jobs and provisioning logins must never bypass RLS or own anything (checked again by migration 0001/0029/0049)
bad="$(q "select string_agg(rolname, ',') from pg_roles where rolname in ('clearline_runtime','clearline_jobs','clearline_provisioning') and (rolbypassrls or rolsuper or rolcreaterole)")"
[ -z "$bad" ] || { echo "db-bootstrap: these logins have more than they should: $bad" >&2; exit 5; }
echo "db-bootstrap: logins and database ${db} ready; next: migrations run as the pre-deploy job on the first deploy"
