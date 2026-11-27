#!/bin/sh
# v1 phase 6: container entrypoint for Dockerfile.prod (web, worker and migrate job alike). One job only: when the host
# provides the managed database's CA certificate (CLEARLINE_DB_CA_CERT, PEM; App Platform binds ${db.CA_CERT}), write
# it to /tmp/clearline-db-ca.pem so connection strings ending in `sslmode=verify-full&sslrootcert=/tmp/clearline-db-ca.pem`
# verify the server. Then exec the command. Prints nothing about the certificate or any variable value.
set -eu
if [ -n "${CLEARLINE_DB_CA_CERT:-}" ]; then
  umask 077
  printf '%s\n' "$CLEARLINE_DB_CA_CERT" > /tmp/clearline-db-ca.pem
fi
exec "$@"
