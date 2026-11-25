#!/usr/bin/env bash
# v1 phase 6: post-deploy smoke test. Read-only: it signs nobody in, changes nothing, sends no data, and needs no
# secret. Run after every staging or production deploy (the deploy workflows do), and against prod-local.
#
#   scripts/deploy/smoke.sh https://staging.clearlineconnect.org [--expect-https]
#
# Checks: the sign-in page answers 200 with the security headers and a per-request CSP nonce; a protected API answers
# 401 without a stack trace; the demo routes are not served (demo code never ships); an unknown path is 404; with
# --expect-https, plain http redirects to https and HSTS-capable TLS verifies (curl's default CA check, never -k).
# Exit 0 when every check passes; prints one line per check (no response bodies, no cookies).
set -uo pipefail
ORIGIN="${1:?usage: smoke.sh <origin> [--expect-https]}"; ORIGIN="${ORIGIN%/}"
HTTPS="${2:-}"
fail=0; n=0
ok() { n=$((n+1)); printf 'ok   %s\n' "$1"; }
bad() { n=$((n+1)); fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fetch() { # path -> writes headers/body, echoes status
  curl -sS --max-time 20 -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' "$ORIGIN$1" 2>/dev/null || echo 000
}
hdr() { grep -i "^$1:" "$TMP/headers" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //'; }

# 1. the sign-in page
s="$(fetch /control/sign-in)"
[ "$s" = 200 ] && ok "sign-in page 200" || bad "sign-in page answered $s (want 200)"
csp="$(hdr content-security-policy)"
case "$csp" in *"'nonce-"*"frame-ancestors 'none'"*|*"frame-ancestors 'none'"*"'nonce-"*) ok "per-request CSP nonce and frame-ancestors 'none'" ;; *) bad "content-security-policy is missing the nonce or frame-ancestors" ;; esac
[ "$(hdr x-frame-options)" = DENY ] && ok "X-Frame-Options DENY" || bad "X-Frame-Options is not DENY"
[ "$(hdr x-content-type-options)" = nosniff ] && ok "X-Content-Type-Options nosniff" || bad "X-Content-Type-Options is not nosniff"
grep -qi '^x-powered-by:' "$TMP/headers" && bad "X-Powered-By is sent" || ok "no X-Powered-By"

# 2. a protected API without a session
s="$(fetch /api/control/merchant/daily)"
[ "$s" = 401 ] && ok "protected API 401 without a session" || bad "protected API answered $s (want 401)"
grep -qiE 'at [A-Za-z_.]+ \(|node_modules|\.next/server' "$TMP/body" && bad "an error body shows a stack trace" || ok "no stack trace in the error body"

# 3. demo code is not served by a production build
for p in /api/control/demo/reset /api/control/demo/switch /api/control/demo/feedback; do
  s="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$ORIGIN$p" 2>/dev/null || echo 000)"
  case "$s" in 404|401|403|405) ok "demo route $p not served ($s)" ;; *) bad "demo route $p answered $s" ;; esac
done

# 4. unknown path
s="$(fetch /clearline-smoke-unknown-path)"
[ "$s" = 404 ] && ok "unknown path 404" || bad "unknown path answered $s (want 404)"

# 5. TLS (deployed environments only)
if [ "$HTTPS" = --expect-https ]; then
  case "$ORIGIN" in https://*) ok "origin is https" ;; *) bad "origin is not https" ;; esac
  host="${ORIGIN#https://}"
  s="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$host/control/sign-in" 2>/dev/null || echo 000)"
  case "$s" in 30[1278]\ https://*) ok "http redirects to https" ;; *) bad "http answered '$s' (want a redirect to https)" ;; esac
  s="$(fetch /control/sign-in)"
  # HSTS: the app does not set it today (a decision for the founder, see HOSTING_PROPOSAL.md); a warning, not a failure
  [ -n "$(hdr strict-transport-security)" ] && ok "Strict-Transport-Security set" || printf 'WARN no Strict-Transport-Security header (decision pending)\n'
fi

echo "smoke: $((n-fail))/$n checks passed against $ORIGIN"
[ "$fail" = 0 ]
